FROM node:22-alpine
RUN apk add --no-cache openssl
WORKDIR /app
COPY runtime/attachment-storage.mjs runtime/attachment-storage.mjs
COPY scanner-sidecar scanner-sidecar
CMD ["sh","-ec","mkdir -p /tmp/tls && openssl req -x509 -newkey rsa:2048 -nodes -keyout /tmp/tls/key.pem -out /tmp/tls/cert.pem -subj /CN=refs-scanner -days 1 >/dev/null 2>&1 && SCANNER_TLS_KEY=/tmp/tls/key.pem SCANNER_TLS_CERT=/tmp/tls/cert.pem node scanner-sidecar/main.mjs"]
