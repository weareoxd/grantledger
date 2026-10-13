#!/usr/bin/env bash
# Copy the grants data from one GrantLedger database to another, so production doesn't have to
# download and import everything again (the federal file alone is 2.3 GB).
#
#   scripts/data-transfer.sh export                 dump the local database (DATABASE_URL in .env)
#   scripts/data-transfer.sh status-prod            check production is ready for an import (read-only)
#   scripts/data-transfer.sh import-prod <dump>     load a dump into production, through an SSM tunnel
#   scripts/data-transfer.sh import <dump> <url>    load a dump into any database (e.g. a local test)
#
# What moves: the grants data (organizations, ministries, programs, recipients, awards, fiscal
# years), the rollup behind the lists, the import history and the worker's settings (including
# each source's last download, so the worker skips files that haven't changed). What doesn't:
# users, sessions, MCP clients and tokens, and the job queue; production keeps its own.
#
# Importing replaces those tables' rows in one transaction. Until it commits, the site keeps
# serving the old data (rows are deleted, not truncated, so readers aren't blocked). Both
# databases must be on the same migrations: deploy the app first, which applies them on start.
#
# The Postgres tools run from the postgres:16 image (production runs PostgreSQL 16), so nothing
# needs installing but Docker, the AWS CLI and its Session Manager plugin.
set -euo pipefail

cd "$(dirname "$0")/.."

PG_IMAGE=postgres:16
APP=grantledger
SCHEMA=grantledger
CLUSTER=DevCluster
EXPORT_DIR=data/exports
# Parents before children for loading; deleted in the reverse order
TABLES=(organization ministry program recipient recipient_alias fiscal_year award award_rollup import_run app_setting)

die() {
  echo "error: $*" >&2
  exit 1
}

# psql/pg_dump/pg_restore from the postgres image; "localhost" in a URL means this machine.
pg() {
  docker run --rm -i --add-host=host.docker.internal:host-gateway \
    -e PGPASSWORD -e PGSSLMODE -e PGSSLROOTCERT ${PG_MOUNTS:-} "$PG_IMAGE" "$@"
}

docker_url() {
  sed -E 's#@(localhost|127\.0\.0\.1)([:/])#@host.docker.internal\2#' <<<"$1"
}

local_database_url() {
  [ -f .env ] || die "no .env file"
  local url
  url=$(grep -E '^DATABASE_URL=' .env | tail -1 | cut -d= -f2-)
  [ -n "$url" ] || die "DATABASE_URL isn't set in .env"
  docker_url "$url"
}

# The migrations a database has applied, oldest first.
migrations() {
  pg psql "$1" -At -v ON_ERROR_STOP=1 \
    -c "SELECT hash FROM $SCHEMA.__drizzle_migrations ORDER BY created_at, id" 2>/dev/null
}

export_data() {
  local url stamp file
  url=$(local_database_url)
  mkdir -p "$EXPORT_DIR"
  stamp=$(date +%Y%m%d-%H%M%S)
  file="$EXPORT_DIR/grantledger-data-$stamp.dump"
  local args=()
  for table in "${TABLES[@]}"; do args+=(-t "$SCHEMA.$table"); done
  echo "Exporting the grants data to $file ..."
  pg pg_dump "$url" --format=custom --data-only --no-owner --no-privileges "${args[@]}" >"$file.partial"
  mv "$file.partial" "$file"
  migrations "$url" >"$file.migrations" || die "couldn't read the local database's migrations"
  echo "Saved $file ($(du -h "$file" | cut -f1)), with $(wc -l <"$file.migrations" | tr -d ' ') migrations."
  echo "Load it into production with:  make data-import-prod FILE=$file"
}

# import_into <dump> <url>: replace the target's grants data with the dump's (PGSSLMODE and
# PGSSLROOTCERT apply when set).
import_into() {
  local dump=$1 url=$2
  [ -f "$dump" ] || die "no such file: $dump"
  [ -f "$dump.migrations" ] || die "$dump.migrations is missing (it's written next to the dump)"
  local here
  here=$(cd "$(dirname "$dump")" && pwd)

  echo "Checking the target is on the dump's migrations ..."
  local target
  target=$(migrations "$url") ||
    die "the target has no $SCHEMA schema yet: deploy the app first (it applies the migrations on start)"
  [ "$target" = "$(cat "$dump.migrations")" ] ||
    die "the target's migrations differ from the dump's: deploy the same version of the app, then export again"

  local state
  state=$(pg psql "$url" -At -c "SELECT state FROM $SCHEMA.worker_status WHERE id = 'worker'" 2>/dev/null || true)
  case "$state" in
  downloading | importing | pruning | rollup)
    die "the target's worker is busy ($state): wait for it to finish, or pause imports on the Worker page"
    ;;
  esac

  local deletes=""
  for ((i = ${#TABLES[@]} - 1; i >= 0; i--)); do
    deletes+="DELETE FROM $SCHEMA.${TABLES[i]};"
  done

  echo "Loading $(basename "$dump") (one transaction; the site serves the old data until it commits) ..."
  PG_MOUNTS="${PG_MOUNTS:-} -v $here:/dumps:ro" pg sh -c '
    set -e
    {
      echo "BEGIN;"
      echo "SET LOCAL lock_timeout = '"'"'60s'"'"';"
      echo "$1"
      pg_restore --data-only --no-owner --no-privileges -f - "/dumps/$2"
      echo "COMMIT;"
    } | psql "$3" -q -v ON_ERROR_STOP=1 >/dev/null
  ' -- "$deletes" "$(basename "$dump")" "$url"

  echo "Cleaning up the replaced rows and refreshing the planner's statistics ..."
  # One -c per table: VACUUM can't run inside the transaction a multi-statement -c would make
  local vacuum=()
  for table in "${TABLES[@]}"; do vacuum+=(-c "VACUUM (ANALYZE) $SCHEMA.$table"); done
  pg psql "$url" -q -v ON_ERROR_STOP=1 "${vacuum[@]}" >/dev/null

  pg psql "$url" -At -F ': ' -c "
    SELECT 'awards', count(*) FROM $SCHEMA.award
    UNION ALL SELECT 'recipients', count(*) FROM $SCHEMA.recipient
    UNION ALL SELECT 'rollup rows', count(*) FROM $SCHEMA.award_rollup"
  echo "Done."
}

# connect_prod: opens a tunnel to production's database and sets PROD_URL (plus PGPASSWORD,
# PGSSLMODE, PGSSLROOTCERT and PG_MOUNTS for `pg`). The tunnel closes when the script exits.
connect_prod() {
  command -v aws >/dev/null || die "the AWS CLI is needed"
  command -v session-manager-plugin >/dev/null ||
    die "the AWS Session Manager plugin is needed (brew install --cask session-manager-plugin)"
  aws sts get-caller-identity >/dev/null 2>&1 || die "sign in to AWS first (aws sso login)"

  # The app's own database user, from its secret; nothing here is printed
  local secret host port name user
  secret=$(aws secretsmanager get-secret-value --secret-id "$APP" --query SecretString --output text)
  host=$(jq -r .DATABASE_HOST <<<"$secret")
  port=$(jq -r '.DATABASE_PORT // "5432"' <<<"$secret")
  name=$(jq -r .DATABASE_NAME <<<"$secret")
  user=$(jq -r .DATABASE_USER <<<"$secret")
  export PGPASSWORD
  PGPASSWORD=$(jq -r .DATABASE_PASSWORD <<<"$secret")
  [ "$host" != null ] && [ "$user" != null ] || die "the $APP secret has no DATABASE_* keys"

  local tmp
  tmp=$(mktemp -d)
  chmod 700 "$tmp"
  jq -r .DATABASE_PGSSLCA_BASE64 <<<"$secret" | base64 --decode >"$tmp/ca.pem"
  unset secret

  # The database is in private subnets: tunnel to it through the ECS host, as the platform does
  local instance local_port tunnel
  instance=$(aws ecs describe-container-instances --cluster "$CLUSTER" \
    --container-instances "$(aws ecs list-container-instances --cluster "$CLUSTER" --query 'containerInstanceArns[0]' --output text)" \
    --query 'containerInstances[0].ec2InstanceId' --output text)
  local_port=${LOCAL_PORT:-15432}
  echo "Opening a tunnel to the database through $instance (localhost:$local_port) ..."
  aws ssm start-session --target "$instance" \
    --document-name AWS-StartPortForwardingSessionToRemoteHost \
    --parameters "{\"host\":[\"$host\"],\"portNumber\":[\"$port\"],\"localPortNumber\":[\"$local_port\"]}" \
    >"$tmp/tunnel.log" 2>&1 &
  tunnel=$!
  trap 'pkill -P '"$tunnel"' 2>/dev/null; kill '"$tunnel"' 2>/dev/null; rm -rf "'"$tmp"'"' EXIT
  for _ in $(seq 60); do
    nc -z localhost "$local_port" 2>/dev/null && break
    kill -0 "$tunnel" 2>/dev/null || die "the tunnel didn't open: $(cat "$tmp/tunnel.log")"
    sleep 0.5
  done
  nc -z localhost "$local_port" 2>/dev/null || die "the tunnel didn't open in time"

  # TLS checked against the RDS CA (verify-ca: the tunnel's address isn't the certificate's name)
  export PGSSLMODE=verify-ca PGSSLROOTCERT=/certs/ca.pem
  PG_MOUNTS="-v $tmp:/certs:ro"
  PROD_URL="postgres://$user@host.docker.internal:$local_port/$name"
}

import_prod() {
  local dump=$1
  [ -f "$dump" ] || die "no such file: $dump"
  echo "This replaces production's grants data ($APP) with $(basename "$dump")."
  if [ "${YES:-}" != "1" ]; then
    read -r -p "Type '$APP' to go on: " answer
    [ "$answer" = "$APP" ] || die "cancelled"
  fi
  connect_prod
  import_into "$dump" "$PROD_URL"
}

# Read-only: whether production is ready for an import, and what it holds now.
status_prod() {
  connect_prod
  local applied
  if ! applied=$(migrations "$PROD_URL"); then
    pg psql "$PROD_URL" -At -c "SELECT 'connected as ' || current_user || ' to ' || current_database()" ||
      die "couldn't connect to production's database"
    echo "No $SCHEMA tables yet: deploy the app (it applies the migrations on start), then import."
    return
  fi
  echo "Migrations applied: $(grep -c . <<<"$applied")"
  local latest
  latest=$(ls -t "$EXPORT_DIR"/*.dump.migrations 2>/dev/null | head -1 || true)
  if [ -n "$latest" ]; then
    if [ "$applied" = "$(cat "$latest")" ]; then
      echo "They match the latest export ($(basename "${latest%.migrations}"))."
    else
      echo "They differ from the latest export ($(basename "${latest%.migrations}")): deploy, then export again."
    fi
  fi
  pg psql "$PROD_URL" -At -F ': ' -c "
    SELECT 'worker', coalesce((SELECT state::text FROM $SCHEMA.worker_status WHERE id = 'worker'), 'never started')
    UNION ALL SELECT 'awards', count(*)::text FROM $SCHEMA.award
    UNION ALL SELECT 'recipients', count(*)::text FROM $SCHEMA.recipient"
}

case "${1:-}" in
export) export_data ;;
import) [ $# -eq 3 ] || die "usage: $0 import <dump> <postgres url>"; import_into "$2" "$(docker_url "$3")" ;;
import-prod) [ $# -eq 2 ] || die "usage: $0 import-prod <dump>"; import_prod "$2" ;;
status-prod) status_prod ;;
*) die "usage: $0 export | status-prod | import-prod <dump> | import <dump> <postgres url>" ;;
esac
