# Local development. `make` (or `make help`) lists every command.
#
#   make start   database in the background, web app + worker in the foreground (Ctrl+C stops them)
#   make stop    stop the database (its data is kept)

.DEFAULT_GOAL := help
SHELL := /bin/bash

COMPOSE := docker compose
# Runs psql / pg_dump inside the postgres container with its own credentials.
PG := $(COMPOSE) exec -T postgres sh -c
BACKUP_DIR := data/backups

.PHONY: help setup install start dev worker stop restart status db db-logs db-shell studio \
	migrate generate auth-generate seed-admin user users import-alberta import-federal rollup stats \
	data-export data-status-prod data-import-prod \
	mcp-call mcp-stdio backup restore test test-unit test-db test-watch lint fix typecheck check \
	build prod image prod-up prod-down clean clean-db

help: ## List commands
	@awk 'BEGIN {FS = ":.*## "} /^[a-zA-Z_-]+:.*## / {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

# --- Setup ------------------------------------------------------------------

setup: ## First-time setup: .env with generated secrets, and the dependencies
	@if [ -f .env ]; then echo ".env already exists"; else cp .env.example .env && \
		sed -i.bak -e "s|^BETTER_AUTH_SECRET=$$|BETTER_AUTH_SECRET=$$(openssl rand -base64 32)|" \
			-e "s|^MCP_API_KEY=$$|MCP_API_KEY=$$(openssl rand -base64 32 | tr -d '/+=')|" \
			-e "s|^MCP_JWT_SECRET=$$|MCP_JWT_SECRET=$$(openssl rand -base64 48)|" \
			.env && \
		rm -f .env.bak && \
		echo "Created .env with generated secrets: set ADMIN_EMAIL and the GOOGLE_OAUTH2_* values"; fi
	npm ci

install: ## Install dependencies exactly as locked (npm ci)
	npm ci

.env:
	@echo "No .env file. Run 'make setup' first." && exit 1

node_modules: package-lock.json
	npm ci
	@touch node_modules

# --- Run --------------------------------------------------------------------

start: .env node_modules db ## Start the database (background), then the web app and worker (foreground)
	npm run dev:all

dev: .env node_modules db ## Start only the web app (http://localhost:3000)
	npm run dev

worker: .env node_modules db ## Start only the worker (imports on schedule, or from the Worker page)
	npm run worker:dev

stop: ## Stop the database (data is kept)
	$(COMPOSE) stop

restart: ## Stop, then start again
	@$(MAKE) --no-print-directory stop
	@$(MAKE) --no-print-directory start

status: ## Show the containers
	$(COMPOSE) ps

db: .env ## Start only the database, in the background, and wait until it is ready
	$(COMPOSE) up -d --wait --remove-orphans postgres

db-logs: ## Follow the database logs
	$(COMPOSE) logs -f postgres

db-shell: db ## Open psql in the database
	$(COMPOSE) exec postgres sh -c 'psql -U "$$POSTGRES_USER" -d "$$POSTGRES_DB"'

studio: db ## Browse the database with Drizzle Studio
	npm run db:studio

# --- Data -------------------------------------------------------------------

migrate: db ## Apply database migrations (the web app and worker also do this on start)
	npm run db:migrate

generate: ## Generate a SQL migration after changing src/lib/db/schema.ts
	npm run db:generate

auth-generate: ## Regenerate src/lib/db/auth-schema.ts from better-auth.config.ts
	npm run auth:generate

seed-admin: db ## Create the admin user for ADMIN_EMAIL
	npm run seed:admin

user: db ## Add someone, or change their role: make user EMAIL=alice@example.org [ROLE=admin]
	@test -n "$(EMAIL)" || (echo "Usage: make user EMAIL=<google email> [ROLE=admin|user]"; exit 2)
	npm run --silent users -- add "$(EMAIL)" $(ROLE)

users: db ## List everyone with an account
	npm run --silent users -- list

import-alberta: db ## Import Alberta files directly (no worker): make import-alberta FILES="data/alberta/*.csv"
	@test -n "$(FILES)" || (echo 'Usage: make import-alberta FILES="data/alberta/*.csv"'; exit 2)
	npm run import -- alberta $(FILES)

import-federal: db ## Import the federal file directly (no worker): make import-federal FILE=data/federal/grants.csv
	npm run import -- federal $(or $(FILE),data/federal/grants.csv)

rollup: db ## Rebuild the award rollup behind the lists, then check it against the awards
	npm run rollup
	npm run rollup -- --check

stats: db ## Print the dataset statistics the experiment notes quote
	npm run --silent stats

mcp-call: ## Call the MCP server: make mcp-call ARGS="call award_totals '{\"group_by\":\"organization\"}'"
	npm run --silent mcp-call -- $(or $(ARGS),list-tools)

mcp-stdio: ## Run the MCP server over stdio (for Claude Desktop)
	npm run --silent mcp-stdio

data-export: db ## Export the grants data for production: data/exports/grantledger-data-….dump
	scripts/data-transfer.sh export

data-status-prod: ## Check production's database is ready for an import (read-only, through a tunnel)
	scripts/data-transfer.sh status-prod

data-import-prod: ## Replace production's grants data with an export (asks first): make data-import-prod FILE=…
	@test -n "$(FILE)" || (echo "Usage: make data-import-prod FILE=data/exports/grantledger-data-….dump"; exit 2)
	scripts/data-transfer.sh import-prod "$(FILE)"

backup: db ## Back up the database to data/backups/
	@mkdir -p $(BACKUP_DIR)
	@file=$(BACKUP_DIR)/grantledger-$$(date +%Y%m%d-%H%M%S).dump; \
		if $(PG) 'pg_dump -U "$$POSTGRES_USER" -d "$$POSTGRES_DB" -Fc' > "$$file.partial"; then \
			mv "$$file.partial" "$$file" && echo "Saved $$file"; \
		else rm -f "$$file.partial"; echo "Backup failed"; exit 1; fi

restore: db ## Restore a backup (replaces current data): make restore FILE=data/backups/….dump
	@test -f "$(FILE)" || (echo "Usage: make restore FILE=path/to/backup.dump" && exit 1)
	@read -r -p "Replace the current database with $(FILE)? Type 'yes': " answer; \
		[ "$$answer" = yes ] || (echo "Cancelled" && exit 1)
	$(PG) 'pg_restore -U "$$POSTGRES_USER" -d "$$POSTGRES_DB" --clean --if-exists' < "$(FILE)"

# --- Quality ----------------------------------------------------------------

test: db ## Run all the tests (the database tests use DATABASE_URL_TEST)
	npm test

test-unit: ## Run the tests that need no database
	npm run test:unit

test-db: db ## Run the database tests
	npm run test:db

test-watch: ## Run the tests in watch mode
	npm run test:watch

lint: ## Check formatting and lint rules (Biome)
	npm run lint

fix: ## Fix formatting and lint issues where possible
	npm run lint:fix

typecheck: ## Type-check
	npm run typecheck

check: lint typecheck test ## Everything CI runs before the build: lint, typecheck, tests

# --- Build ------------------------------------------------------------------

build: node_modules ## Production build (.next/standalone, dist/)
	npm run build

prod: .env build db ## Build and run the production web server locally (foreground)
	rm -rf .next/standalone/.next/static
	cp -r .next/static .next/standalone/.next/static
	npm start

image: ## Build the Docker image for this machine (grantledger:local: web server and worker)
	docker build -t grantledger:local .

prod-up: .env ## Run the production image with Docker Compose (on :3000)
	$(COMPOSE) --profile prod up -d --build

prod-down: ## Stop the production image
	$(COMPOSE) --profile prod down

# --- Clean up ---------------------------------------------------------------

clean: ## Remove containers and build output; the database volume is kept
	$(COMPOSE) --profile prod down --remove-orphans
	rm -rf .next dist

clean-db: ## Delete the database volume and all its data (asks first; consider make backup)
	@read -r -p "Delete the local database and all its data? Type 'delete': " answer; \
		[ "$$answer" = delete ] || (echo "Cancelled" && exit 1)
	$(COMPOSE) --profile prod down -v
