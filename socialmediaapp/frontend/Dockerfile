# Frontend image — builds the Angular app and serves it with nginx.
# Supports building behind a corporate proxy / internal registry via build args:
#   docker build --build-arg HTTP_PROXY=http://proxy:port \
#                --build-arg HTTPS_PROXY=http://proxy:port \
#                --build-arg NPM_REGISTRY=https://artifactory/api/npm/npm/ .

# ---- Build stage ----
FROM node:20-alpine AS build

ARG HTTP_PROXY
ARG HTTPS_PROXY
ARG NPM_REGISTRY
ENV HTTP_PROXY=${HTTP_PROXY} HTTPS_PROXY=${HTTPS_PROXY}

WORKDIR /app
COPY package*.json ./
RUN if [ -n "$NPM_REGISTRY" ]; then npm config set registry "$NPM_REGISTRY"; fi \
  && npm ci --no-audit --no-fund

COPY . .
RUN npm run build

# ---- Serve stage ----
FROM nginx:alpine
COPY --from=build /app/dist/socialmediaapp/browser /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
