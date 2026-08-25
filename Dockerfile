# Sitio estático: no hay build, solo se sirven los ficheros.
FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY index.html styles.css manifest.webmanifest sw.js /usr/share/nginx/html/
COPY src /usr/share/nginx/html/src
COPY icons /usr/share/nginx/html/icons

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
