#!/usr/bin/env python3
"""Genera los PNG del icono sin dependencias: zlib + struct de la stdlib.

No hay rasterizador de SVG en la máquina, así que el dibujo se hace por
geometría, con supermuestreo x4 para que los bordes queden suaves.

El icono es una mano abierta en abanico sobre el tapete: dos cartas boca abajo
—con el azul del reverso del juego— y una boca arriba con su pica. Una pica
suelta la tiene media baraja de aplicaciones; tres cartas en abanico se leen como
«esto es un solitario» ya de lejos, y de cerca traen los tres colores de la
partida: el verde de la mesa, el azul del dorso y el crema de la cara.

`icons/icon.svg` dibuja lo mismo a mano. Si se cambia aquí la geometría, hay que
cambiarla también allí: hay una prueba que comprueba que los dos existan, pero
que se parezcan es cosa nuestra.
"""
import math
import struct
import zlib
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
SS = 4                      # supermuestreo

# --- paleta, la misma del juego ---
VERDE_1 = (0x18, 0x76, 0x4a)      # tapete arriba a la izquierda
VERDE_2 = (0x09, 0x3a, 0x24)      # …y abajo a la derecha
CREMA   = (0xfd, 0xfc, 0xf8)      # la cara de la carta
FILO    = (0xa9, 0xba, 0xae)      # la junta entre carta y carta
AZUL_1  = (0x2f, 0x5f, 0xa8)      # el dorso, como en styles.css
AZUL_2  = (0x1c, 0x3d, 0x75)
TINTA   = (0x16, 0x23, 0x2b)      # la pica

# --- geometría del abanico, en fracciones del lado del icono ---
CARTA_ANCHO = 0.325
CARTA_ALTO = 0.455
CARTA_RADIO = 0.035
PIVOTE = (0.5, 0.88)              # las cartas giran sobre la mano, no sobre su centro
CENTRO_CARTA = (0.5, 0.48)
ANGULOS = (-24.0, 0.0, 24.0)      # izquierda, centro (la que se ve), derecha
FILO_GROSOR = 0.011               # lo que mide la junta entre cartas
BORDE_DORSO = 0.026               # el marco claro del reverso
PICA_ALTO = 0.30                  # alto de la pica, en fracción del lado


def mezcla(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def dentro_redondeado(x, y, lado, radio):
    """El recorte de las esquinas del propio icono."""
    if radio <= 0:
        return True
    cx = min(max(x, radio), lado - radio)
    cy = min(max(y, radio), lado - radio)
    return (x - cx) ** 2 + (y - cy) ** 2 <= radio * radio


def distancia_rect(x, y, cx, cy, w, h, r):
    """Distancia con signo al rectángulo redondeado: negativa dentro."""
    dx = abs(x - cx) - (w / 2 - r)
    dy = abs(y - cy) - (h / 2 - r)
    fuera = math.hypot(max(dx, 0.0), max(dy, 0.0))
    return fuera + min(max(dx, dy), 0.0) - r


def gira(x, y, px, py, grados):
    """El punto visto desde la carta: se deshace el giro del abanico."""
    a = math.radians(-grados)
    ca, sa = math.cos(a), math.sin(a)
    dx, dy = x - px, y - py
    return px + dx * ca - dy * sa, py + dx * sa + dy * ca


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


def color_de_carta(u, v, giro, boca_arriba):
    """El color de un punto que ya se sabe que cae dentro de esta carta."""
    d = distancia_rect(u, v, *CENTRO_CARTA, CARTA_ANCHO, CARTA_ALTO, CARTA_RADIO)
    if d > -FILO_GROSOR:
        return FILO                                   # la junta con la de al lado
    if boca_arriba:
        pu = (u - CENTRO_CARTA[0]) / PICA_ALTO
        pv = (v - CENTRO_CARTA[1]) / PICA_ALTO
        return TINTA if dentro_pica(pu, pv) else CREMA
    # Dorso: azul en degradado con un marco claro, como el reverso del juego.
    if d > -(FILO_GROSOR + BORDE_DORSO):
        return mezcla(CREMA, AZUL_1, 0.35)
    t = (u - 0.2) * 0.4 + (v - 0.2) * 0.6
    return mezcla(AZUL_1, AZUL_2, min(1.0, max(0.0, t + 0.35)))


def color_del_punto(u, v):
    """Qué hay en ese punto del diseño: una carta del abanico o el tapete."""
    # De delante hacia atrás: la del medio tapa a las otras dos.
    for giro, boca_arriba in ((ANGULOS[1], True), (ANGULOS[0], False), (ANGULOS[2], False)):
        gu, gv = gira(u, v, *PIVOTE, giro)
        if distancia_rect(gu, gv, *CENTRO_CARTA, CARTA_ANCHO, CARTA_ALTO, CARTA_RADIO) <= 0:
            return color_de_carta(gu, gv, giro, boca_arriba)
    t = u * 0.35 + v * 0.65
    return mezcla(VERDE_1, VERDE_2, min(1.0, max(0.0, t)))


def lienzo(lado, escala, redondear):
    """Filas RGBA del icono. `escala` encoge el abanico sin mover el tapete."""
    g = lado * SS
    radio = g * 0.22 if redondear else 0
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
                        continue                        # esquina: se queda transparente
                    # A coordenadas de diseño (0..1), con el abanico encogido
                    # alrededor del centro para que quepa en la zona segura.
                    u = 0.5 + (x / g - 0.5) / escala
                    v = 0.5 + (y / g - 0.5) / escala
                    color = color_del_punto(u, v)
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
    # escala: cuánto ocupa el abanico. El maskable lo encoge para sobrevivir al
    # recorte circular de Android (la zona segura es el 80% central) y va sin
    # esquinas redondeadas porque recorta el propio sistema. El de Apple, igual:
    # iOS pone su máscara, y ahí solo hace falta apartarse un poco del filo.
    for nombre, lado, escala, redondear in [
        ('icon-192.png', 192, 1.00, True),
        ('icon-512.png', 512, 1.00, True),
        ('maskable-512.png', 512, 0.74, False),
        ('apple-touch-icon.png', 180, 0.92, False),
    ]:
        peso = escribir_png(RAIZ / 'icons' / nombre, lienzo(lado, escala, redondear), lado)
        print(f'{nombre:24} {lado}x{lado}  {peso/1024:5.1f} KB')
