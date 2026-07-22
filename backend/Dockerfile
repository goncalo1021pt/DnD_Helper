# Multi-stage build: Vite SPA -> embedded into a static Go binary.
# Build context is the repo root (see docker-compose.yml).

# --- Stage 1: build the SPA ---
FROM node:26-alpine AS frontend
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY openapi.yaml /app/openapi.yaml
COPY frontend ./
RUN npm run gen:api && npm run build

# --- Stage 2: build the Go binary with the SPA embedded ---
FROM golang:1.25-alpine AS backend
WORKDIR /app/backend
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend ./
# Embed the freshly built SPA.
COPY --from=frontend /app/frontend/dist/index.html ./internal/static/index.html
COPY --from=frontend /app/frontend/dist/assets/ ./internal/static/assets/
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /server ./cmd/server

# --- Stage 3: minimal runtime ---
FROM alpine:3.20
RUN apk add --no-cache ca-certificates
COPY --from=backend /server /server
EXPOSE 8080
ENTRYPOINT ["/server"]
