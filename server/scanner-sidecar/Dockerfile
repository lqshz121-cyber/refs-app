FROM node:22-alpine
WORKDIR /app
COPY runtime/attachment-storage.mjs runtime/attachment-storage.mjs
COPY scanner-sidecar scanner-sidecar
CMD ["node","scanner-sidecar/main.mjs"]
