# Backend image — stateless Express proxy.
# Supports building behind a corporate proxy via build args:
#   docker build --build-arg HTTP_PROXY=http://proxy:port --build-arg HTTPS_PROXY=http://proxy:port .
FROM node:20-alpine

ARG HTTP_PROXY
ARG HTTPS_PROXY
ARG NPM_REGISTRY
ENV HTTP_PROXY=${HTTP_PROXY} HTTPS_PROXY=${HTTPS_PROXY}

WORKDIR /app

COPY package*.json ./
# Point npm at an internal registry if provided (e.g. Artifactory/Nexus).
RUN if [ -n "$NPM_REGISTRY" ]; then npm config set registry "$NPM_REGISTRY"; fi \
  && npm ci --omit=dev --no-audit --no-fund

COPY src ./src

# Unset proxy at runtime so it doesn't affect outbound API calls unexpectedly.
ENV HTTP_PROXY= HTTPS_PROXY=

EXPOSE 3000
CMD ["node", "src/server.js"]
