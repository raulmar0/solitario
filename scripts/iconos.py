#!/usr/bin/env python3
"""Genera los PNG del icono sin dependencias: zlib + struct de la stdlib.

No hay rasterizador de SVG en la máquina, así que la pica se dibuja por
geometría, con supermuestreo x4 para que los bordes queden suaves.
"""
import struct, zlib
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
SS = 4                      # supermuestreo

VERDE_1 = (0x18, 0x76, 0x4a)
VERDE_2 = (0x09, 0x3a, 0x24)
CREMA   = (0xfd, 0xfc, 0xf8)


def dentro_redondeado(x, y, lado, radio):
    if radio <= 0:
        return True
    cx = min(max(x, radio), lado - radio)
    cy = min(max(y, radio), lado - radio)
    return (x - cx) ** 2 + (y - cy) ** 2 <= radio * radio


def dentro_pica(u, v):
    """Pica en coordenadas normalizadas: punta arriba en v=-0.5, pie en v=0.48.

    Los lóbulos se solapan en el centro a propósito: si solo se tocan, queda un
    punto de un píxel sin pintar justo en medio.
    """
    r = 0.21
    if (u + 0.19) ** 2 + (v - 0.10) ** 2 <= r * r: return True     # lóbulo izquierdo
    if (u - 0.19) ** 2 + (v - 0.10) ** 2 <= r * r: return True     # lóbulo derecho
    if -0.50 <= v <= 0.10 and abs(u) <= 0.30 * (v + 0.50) / 0.60:  # punta
        return True
    if 0.10 <= v <= 0.48:                                          # pie, que se abre abajo
        t = (v - 0.10) / 0.38
        return abs(u) <= 0.045 + 0.22 * t * t
    return False


def lienzo(lado, alto_pica, redondear):
    """Filas RGBA del icono: verde en degradado con una pica crema encima."""
    g = lado * SS
    radio = g * 0.22 if redondear else 0
    cx = cy = g / 2
    escala = g * alto_pica
    filas = []
    for py in range(lado):
        fila = bytearray()
        for px in range(lado):
            acum = [0, 0, 0, 0]
            for sy in range(SS):
                for sx in range(SS):
                    x = px * SS + sx + 0.5
                    y = py * SS + sy + 0.5
                    if not dentro_redondeado(x, y, g, radio):
                        continue                                    # esquina: se queda transparente
                    t = (x / g) * 0.35 + (y / g) * 0.65
                    fondo = tuple(round(VERDE_1[i] + (VERDE_2[i] - VERDE_1[i]) * t) for i in range(3))
                    color = CREMA if dentro_pica((x - cx) / escala, (y - cy) / escala) else fondo
                    acum[0] += color[0]; acum[1] += color[1]; acum[2] += color[2]; acum[3] += 255
            n = SS * SS
            a = acum[3] // n
            # Se guarda sin premultiplicar: el color medio es el de las muestras que sí pintaron.
            if a:
                fila += bytes((acum[0] * 255 // acum[3], acum[1] * 255 // acum[3], acum[2] * 255 // acum[3], a))
            else:
                fila += b'\x00\x00\x00\x00'
        filas.append(bytes(fila))
    return filas


def escribir_png(destino, filas, lado):
    cruda = b''.join(b'\x00' + f for f in filas)
    def chunk(tipo, datos):
        return (struct.pack('>I', len(datos)) + tipo + datos
                + struct.pack('>I', zlib.crc32(tipo + datos) & 0xffffffff))
    png = (b'\x89PNG\r\n\x1a\n'
           + chunk(b'IHDR', struct.pack('>IIBBBBB', lado, lado, 8, 6, 0, 0, 0))   # 6 = RGBA
           + chunk(b'IDAT', zlib.compress(cruda, 9))
           + chunk(b'IEND', b''))
    destino.write_bytes(png)
    return len(png)


if __name__ == '__main__':
    (RAIZ / 'icons').mkdir(exist_ok=True)
    # alto_pica: cuánto ocupa la pica. El maskable la deja más pequeña para que
    # sobreviva al recorte circular de Android, y va sin esquinas redondeadas
    # porque el propio sistema recorta. El de Apple, igual: iOS pone su máscara.
    for nombre, lado, alto, redondear in [
        ('icon-192.png', 192, 0.66, True),
        ('icon-512.png', 512, 0.66, True),
        ('maskable-512.png', 512, 0.46, False),
        ('apple-touch-icon.png', 180, 0.62, False),
    ]:
        peso = escribir_png(RAIZ / 'icons' / nombre, lienzo(lado, alto, redondear), lado)
        print(f'{nombre:24} {lado}x{lado}  {peso/1024:5.1f} KB')
