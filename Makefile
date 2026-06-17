# Quest Board — build & codegen orchestration.
# Run `make help` for the common targets.

GOBIN := $(shell go env GOPATH)/bin
STATIC := backend/internal/static

.PHONY: help generate gen-backend gen-frontend frontend embed backend build run dev-server tools clean

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

tools: ## Install codegen tools (sqlc, oapi-codegen)
	go install github.com/sqlc-dev/sqlc/cmd/sqlc@latest
	go install github.com/oapi-codegen/oapi-codegen/v2/cmd/oapi-codegen@latest

generate: gen-backend gen-frontend ## Regenerate all code from SQL + OpenAPI

gen-backend: ## sqlc (DB) + oapi-codegen (Go server) from queries/ and openapi.yaml
	cd backend && PATH="$(GOBIN):$$PATH" sqlc generate
	cd backend && PATH="$(GOBIN):$$PATH" oapi-codegen -config oapi-codegen.yaml ../openapi.yaml

gen-frontend: ## Generate the typed TS client from openapi.yaml
	cd frontend && npm run gen:api

frontend: ## Build the SPA (assumes deps installed)
	cd frontend && npm run build

embed: frontend ## Build the SPA and copy it into the Go embed directory
	rm -rf $(STATIC)/assets
	mkdir -p $(STATIC)/assets
	touch $(STATIC)/assets/.gitkeep
	cp frontend/dist/index.html $(STATIC)/index.html
	cp -r frontend/dist/assets/. $(STATIC)/assets/

backend: ## Build the Go server binary (embeds whatever is in internal/static)
	cd backend && go build -o ../bin/server ./cmd/server

build: embed backend ## Full production build: SPA -> embed -> single Go binary

run: ## Run the server from source (uses .env)
	cd backend && go run ./cmd/server

clean: ## Remove build artifacts
	rm -rf bin frontend/dist
