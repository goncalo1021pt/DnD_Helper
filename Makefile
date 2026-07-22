# Quest Board — build & codegen orchestration.
# Run `make help` for the common targets.

GOBIN := $(shell go env GOPATH)/bin
STATIC := backend/internal/static

.PHONY: help generate gen-backend gen-frontend frontend embed backend build run test prod deploy down restart ps logs dev-server tools clean count countFrontend countBackend countDB

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

# Codegen tools are PINNED so `make generate` is reproducible and the CI drift
# check is deterministic. oapi-codegen v2.7.1 generated the committed api.gen.go
# (v2.8.0 changes the output substantially); sqlc v1.31.1 matches the committed
# db/. Bump these deliberately, then `make generate` and commit the result.
tools: ## Install codegen tools (sqlc, oapi-codegen) at pinned versions
	go install github.com/sqlc-dev/sqlc/cmd/sqlc@v1.31.1
	go install github.com/oapi-codegen/oapi-codegen/v2/cmd/oapi-codegen@v2.7.1

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

test: ## Run the WHOLE app locally in containers at http://localhost:8080 (no tunnel)
	APP_ENV=development BASE_URL=http://localhost:8080 \
		docker compose --profile full up -d --build postgres app
	@echo ""
	@echo "  ▶ Quest Board running at http://localhost:8080  (dev login enabled)"
	@echo "    logs: make logs S=app   ·   stop: make down"

prod: ## Build & start the full PRODUCTION stack (app + postgres + cloudflared)
	docker compose --profile full up -d --build

deploy: prod ## Alias for 'prod'

down: ## Stop & remove the stack (keeps the pgdata volume)
	docker compose --profile full down

restart: ## Restart the app container (re-runs migrations on startup)
	docker compose --profile full restart app

ps: ## Show stack status
	docker compose --profile full ps

logs: ## Follow logs (use: make logs S=app|postgres|cloudflared)
	docker compose --profile full logs -f $(S)

clean: ## Remove build artifacts
	rm -rf bin frontend/dist

# --- Line counts (handwritten code only — generated files are excluded) ---
# Generated: api.gen.go, schema.d.ts, and sqlc output (db.go, models.go, *.sql.go).

FRONTEND_TS  = find frontend/src -type f \( -name '*.ts' -o -name '*.tsx' \) ! -name 'schema.d.ts' -print0 | xargs -0 -r cat | wc -l
FRONTEND_CSS = find frontend/src -type f -name '*.css' -print0 | xargs -0 -r cat | wc -l
BACKEND_GO   = find backend -type f -name '*.go' ! -name '*.gen.go' ! -name '*.sql.go' ! -path 'backend/internal/db/db.go' ! -path 'backend/internal/db/models.go' -print0 | xargs -0 -r cat | wc -l
DB_SQL       = find backend/queries backend/internal/db/migrations -type f -name '*.sql' -print0 | xargs -0 -r cat | wc -l
SPEC_YAML    = cat openapi.yaml | wc -l

countFrontend: ## Count handwritten frontend lines (TypeScript + CSS)
	@printf "  \033[36m%-12s\033[0m %6d lines\n" "TypeScript" $$($(FRONTEND_TS))
	@printf "  \033[36m%-12s\033[0m %6d lines\n" "CSS"        $$($(FRONTEND_CSS))

countBackend: ## Count handwritten backend lines (Go)
	@printf "  \033[36m%-12s\033[0m %6d lines\n" "Go"         $$($(BACKEND_GO))

countDB: ## Count SQL lines (queries + migrations)
	@printf "  \033[36m%-12s\033[0m %6d lines\n" "SQL"        $$($(DB_SQL))

count: ## Total handwritten lines per language across the whole repo
	@ts=$$($(FRONTEND_TS)); css=$$($(FRONTEND_CSS)); go=$$($(BACKEND_GO)); sql=$$($(DB_SQL)); yaml=$$($(SPEC_YAML)); \
	printf "  \033[36m%-12s\033[0m %6d lines\n" "TypeScript" $$ts; \
	printf "  \033[36m%-12s\033[0m %6d lines\n" "CSS"        $$css; \
	printf "  \033[36m%-12s\033[0m %6d lines\n" "Go"         $$go; \
	printf "  \033[36m%-12s\033[0m %6d lines\n" "SQL"        $$sql; \
	printf "  \033[36m%-12s\033[0m %6d lines\n" "OpenAPI"    $$yaml; \
	printf "  %-12s %6s\n" "------------" "------"; \
	printf "  \033[1m%-12s\033[0m %6d lines\n" "Total"       $$((ts + css + go + sql + yaml))
