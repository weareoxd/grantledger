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
# Importing uploads the rows in chunks into staging tables (a dropped connection costs one chunk,
# and running the command again carries on where it stopped), checks every table arrived whole,
# then swaps them in with one transaction on the server. Until it commits, the site keeps serving
# the old data. Both databases must be on the same migrations: deploy the app first, which
# applies them on start.
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
# Every connection from here is named, so an orphaned one (from a dropped attempt) can be told
# apart from the app's own connections, which use the same database user.
export PGAPPNAME=grantledger-transfer

pg() {
  docker run --rm -i --add-host=host.docker.internal:host-gateway \
    -e PGPASSWORD -e PGSSLMODE -e PGSSLROOTCERT -e PGAPPNAME ${PG_MOUNTS:-} "$PG_IMAGE" "$@"
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

# Rows per uploaded chunk: each is one COPY in its own transaction, so a dropped connection costs
# at most one chunk, which is sent again.
CHUNK_ROWS=${CHUNK_ROWS:-100000}
# The big tables are swapped in batches of this many ids (one short statement each)
SWAP_IDS=${SWAP_IDS:-100000}
BATCHED=(recipient award award_rollup)

batched() {
  local table
  for table in "${BATCHED[@]}"; do [ "$table" = "$1" ] && return 0; done
  return 1
}

# stop_orphans <url>: ends this script's connections left behind by a dropped attempt. The server
# doesn't notice a vanished client until it next writes to it, so such a session can hold its
# locks for minutes; only connections named grantledger-transfer are touched, never the app's.
stop_orphans() {
  pg psql "$1" -At -q -c "
    SELECT count(pg_terminate_backend(pid)) FROM pg_stat_activity
     WHERE application_name = '$PGAPPNAME' AND usename = current_user AND pid <> pg_backend_pid()" |
    awk '$1 > 0 { print "  ended " $1 " connection(s) left over from a dropped attempt" }'
}
# How to get a working connection back after a failure: a no-op locally, the tunnel for production
RECONNECT=true

# prepare_chunks <dump> <dir>: each table's rows as COPY-format chunk files under <dir>/<table>/,
# with its column list and row count, plus the sequences' positions. Reused while it's complete.
prepare_chunks() {
  local dump=$1 work=$2 name
  name=$(basename "$dump")
  if [ -f "$work/.ready" ] && [ "$(cat "$work/.ready")" = "$name" ]; then return; fi
  rm -rf "$work"
  mkdir -p "$work"
  echo "Splitting $name into chunks of $CHUNK_ROWS rows ..."
  local here
  here=$(cd "$(dirname "$dump")" && pwd)
  for table in "${TABLES[@]}"; do
    mkdir -p "$work/$table"
    PG_MOUNTS="-v $here:/dumps:ro" pg pg_restore --data-only -n "$SCHEMA" -t "$table" -f - "/dumps/$name" |
      awk -v header="$work/$table/columns" -v count="$work/$table/rows" '
        /^COPY / { match($0, /\(.*\)/); print substr($0, RSTART, RLENGTH) > header; copying = 1; next }
        copying && $0 == "\\." { copying = 0; next }
        copying { rows++; print }
        END { print rows + 0 > count }
      ' | split -l "$CHUNK_ROWS" -a 4 - "$work/$table/chunk-"
    [ -s "$work/$table/columns" ] || die "$name has no rows section for $table"
  done
  # Where each id sequence stood, so new rows don't reuse ids
  PG_MOUNTS="-v $here:/dumps:ro" pg sh -c '
    pg_restore -l "/dumps/$1" | grep "SEQUENCE SET" >/tmp/sequences.list
    pg_restore -L /tmp/sequences.list -f - "/dumps/$1"
  ' -- "$name" | grep "setval" >"$work/sequences.sql" || true
  echo "$name" >"$work/.ready"
}

# load_chunk <url> <dump name> <table> <chunk>: copies one chunk into the table's staging copy,
# recording it in the same transaction; retried, reconnecting, until it's in (exactly once).
load_chunk() {
  local url=$1 name=$2 table=$3 chunk=$4 columns attempt done
  columns=$(cat "$CHUNKS/$table/columns")
  for attempt in 1 2 3 4 5 6; do
    # Recorded already (a previous attempt committed, but its reply was lost)? Only asked after
    # a failure; a check that can't connect means reconnect and ask again, not upload again
    if [ "$attempt" -gt 1 ]; then
      if ! done=$(pg psql "$url" -At -c "SELECT 1 FROM $SCHEMA.transfer_progress
        WHERE dump = '$name' AND tbl = '$table' AND chunk = '$chunk'" 2>/dev/null); then
        echo "  couldn't check $table/$chunk (attempt $attempt); reconnecting ..."
        "$RECONNECT"
        sleep $((attempt * 5))
        continue
      fi
      [ "$done" = 1 ] && return 0
    fi
    if pg psql "$url" -1 -q -v ON_ERROR_STOP=1 \
      -c "\\copy $SCHEMA.transfer_$table $columns FROM '/chunks/$table/$chunk'" \
      -c "INSERT INTO $SCHEMA.transfer_progress VALUES ('$name', '$table', '$chunk')" >/dev/null; then
      return 0
    fi
    echo "  $table/$chunk didn't go through (attempt $attempt); reconnecting and trying again ..."
    "$RECONNECT"
    sleep $((attempt * 5))
  done
  die "couldn't load $table/$chunk after 6 attempts; run the same command again to carry on"
}

# import_into <dump> <url>: replace the target's grants data with the dump's (PGSSLMODE and
# PGSSLROOTCERT apply when set).
#
# The rows go up in chunks into staging copies of the tables (grantledger.transfer_*), each chunk
# committed on its own and recorded in grantledger.transfer_progress, so a dropped connection
# costs one chunk and running the command again carries on where it stopped. Once every table's
# count matches the export, one transaction swaps the data in on the server; until it commits,
# the site serves the old data.
import_into() {
  local dump=$1 url=$2 name
  [ -f "$dump" ] || die "no such file: $dump"
  [ -f "$dump.migrations" ] || die "$dump.migrations is missing (it's written next to the dump)"
  name=$(basename "$dump")

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

  # A session left by an earlier, dropped attempt may still hold locks on these tables
  stop_orphans "$url"

  CHUNKS="$(cd "$EXPORT_DIR" && pwd)/.chunks-${name%.dump}"
  prepare_chunks "$dump" "$CHUNKS"
  local base_mounts="${PG_MOUNTS:-}"
  PG_MOUNTS="$base_mounts -v $CHUNKS:/chunks:ro"

  # Staging tables: kept from an earlier, interrupted run of the same dump; otherwise made afresh
  # Fail rather than wait if something holds the tables (the site's reads never block this)
  local setup="SET lock_timeout = '60s'; CREATE TABLE IF NOT EXISTS $SCHEMA.transfer_progress
    (dump text NOT NULL, tbl text NOT NULL, chunk text NOT NULL, PRIMARY KEY (dump, tbl, chunk));"
  local other
  # -q: only the count, not the CREATE TABLE status line
  other=$(pg psql "$url" -At -q -v ON_ERROR_STOP=1 -c "$setup" \
    -c "SELECT count(*) FROM $SCHEMA.transfer_progress WHERE dump <> '$name'")
  if [ "$other" != 0 ]; then
    setup="SET lock_timeout = '60s'; TRUNCATE $SCHEMA.transfer_progress;"
    for table in "${TABLES[@]}"; do setup+="DROP TABLE IF EXISTS $SCHEMA.transfer_$table;"; done
    pg psql "$url" -q -v ON_ERROR_STOP=1 -c "$setup" >/dev/null
  fi
  setup="SET lock_timeout = '60s';"
  for table in "${TABLES[@]}"; do
    setup+="CREATE UNLOGGED TABLE IF NOT EXISTS $SCHEMA.transfer_$table (LIKE $SCHEMA.$table);"
  done
  pg psql "$url" -q -v ON_ERROR_STOP=1 -c "$setup" >/dev/null

  local total loaded
  total=$(find "$CHUNKS" -name 'chunk-*' | wc -l | tr -d ' ')
  loaded=$(pg psql "$url" -At -c "SELECT count(*) FROM $SCHEMA.transfer_progress WHERE dump = '$name'")
  echo "Uploading $total chunks ($loaded already there from an earlier run) ..."
  # What's there already, in one query: each check would otherwise be its own connection
  # through the tunnel, and every connection is a chance for it to drop
  pg psql "$url" -At -F / -v ON_ERROR_STOP=1 -c "SELECT tbl, chunk FROM $SCHEMA.transfer_progress
    WHERE dump = '$name'" >"$CHUNKS/.uploaded" || die "couldn't read the upload progress; run the command again"
  for table in "${TABLES[@]}"; do
    for file in "$CHUNKS/$table"/chunk-*; do
      [ -e "$file" ] || continue
      grep -qx "$table/$(basename "$file")" "$CHUNKS/.uploaded" && continue
      load_chunk "$url" "$name" "$table" "$(basename "$file")"
      loaded=$((loaded + 1))
      printf '\r  %d/%d chunks (%s)       ' "$((loaded > total ? total : loaded))" "$total" "$table"
    done
  done
  echo

  echo "Checking every table arrived whole ..."
  local expected actual
  for table in "${TABLES[@]}"; do
    expected=$(cat "$CHUNKS/$table/rows")
    actual=$(pg psql "$url" -At -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM $SCHEMA.transfer_$table")
    [ "$expected" = "$actual" ] ||
      die "$table: $actual rows staged but the export has $expected (nothing was replaced)"
  done

  # The swap, on the server: the old rows out (children first), the staged rows in (parents
  # first), the sequences where the export left them. The big tables go in batches of id ranges,
  # each a short statement: the tunnel drops a connection that's silent for long, and a single
  # statement moving millions of rows is silent until it ends.
  # Highest id on each side, as live_max_<table> and staged_max_<table> (macOS's bash 3.2 has
  # no associative arrays)
  local ids
  for table in "${BATCHED[@]}"; do
    ids=$(pg psql "$url" -At -F ' ' -v ON_ERROR_STOP=1 -c "
      SELECT coalesce((SELECT max(id) FROM $SCHEMA.$table), 0),
             coalesce((SELECT max(id) FROM $SCHEMA.transfer_$table), 0)")
    printf -v "live_max_$table" '%s' "${ids% *}"
    printf -v "staged_max_$table" '%s' "${ids#* }"
  done
  local live staged
  {
    echo "SET LOCAL lock_timeout = '60s';"
    for ((i = ${#TABLES[@]} - 1; i >= 0; i--)); do
      table=${TABLES[i]}
      if batched "$table"; then
        live="live_max_$table"
        for ((from = 0; from <= ${!live}; from += SWAP_IDS)); do
          echo "DELETE FROM $SCHEMA.$table WHERE id >= $from AND id < $((from + SWAP_IDS));"
        done
      fi
      echo "DELETE FROM $SCHEMA.$table;"
      echo "\\echo '  cleared $table'"
    done
    for table in "${TABLES[@]}"; do
      if batched "$table"; then
        staged="staged_max_$table"
        for ((from = 0; from <= ${!staged}; from += SWAP_IDS)); do
          echo "INSERT INTO $SCHEMA.$table OVERRIDING SYSTEM VALUE SELECT * FROM $SCHEMA.transfer_$table WHERE id >= $from AND id < $((from + SWAP_IDS));"
          echo "\\echo '  $table: up to id $((from + SWAP_IDS - 1)) of ${!staged}'"
        done
      else
        echo "INSERT INTO $SCHEMA.$table OVERRIDING SYSTEM VALUE SELECT * FROM $SCHEMA.transfer_$table;"
        echo "\\echo '  $table done'"
      fi
    done
    cat "$CHUNKS/sequences.sql"
  } >"$CHUNKS/swap.sql"

  echo "Swapping the data in (one transaction; the site serves the old data until it commits) ..."
  local attempt
  for attempt in 1 2 3; do
    stop_orphans "$url"
    # Query results to /dev/null; the \echo progress lines still show
    if pg psql "$url" -1 -q -v ON_ERROR_STOP=1 -o /dev/null -f /chunks/swap.sql; then break; fi
    # A dropped connection rolls the swap back (or it committed and the reply was lost): running
    # it again is safe either way
    [ "$attempt" = 3 ] && die "the swap didn't go through; run the same command again to retry it"
    echo "  the swap didn't go through (attempt $attempt); reconnecting and trying again ..."
    "$RECONNECT"
    sleep 10
  done

  echo "Removing the staging tables ..."
  local cleanup="DROP TABLE $SCHEMA.transfer_progress;"
  for table in "${TABLES[@]}"; do cleanup+="DROP TABLE IF EXISTS $SCHEMA.transfer_$table;"; done
  pg psql "$url" -q -v ON_ERROR_STOP=1 -c "$cleanup" >/dev/null
  PG_MOUNTS="$base_mounts"
  rm -rf "$CHUNKS"

  # The data is in. Clearing out the replaced rows now is a courtesy (autovacuum would get to it),
  # so a dropped connection here only earns a note.
  echo "Cleaning up the replaced rows and refreshing the planner's statistics ..."
  for table in "${TABLES[@]}"; do
    pg psql "$url" -q -c "VACUUM (ANALYZE) $SCHEMA.$table" >/dev/null 2>&1 ||
      echo "  (skipped $table; autovacuum will do it)"
  done

  pg psql "$url" -At -F ': ' -c "
    SELECT 'awards', count(*) FROM $SCHEMA.award
    UNION ALL SELECT 'recipients', count(*) FROM $SCHEMA.recipient
    UNION ALL SELECT 'rollup rows', count(*) FROM $SCHEMA.award_rollup"
  echo "Done."
}

TUNNEL_PID=""

open_tunnel() {
  echo "Opening a tunnel to the database through $TUNNEL_INSTANCE (localhost:$TUNNEL_LOCAL_PORT) ..."
  aws ssm start-session --target "$TUNNEL_INSTANCE" \
    --document-name AWS-StartPortForwardingSessionToRemoteHost \
    --parameters "{\"host\":[\"$TUNNEL_HOST\"],\"portNumber\":[\"$TUNNEL_PORT\"],\"localPortNumber\":[\"$TUNNEL_LOCAL_PORT\"]}" \
    >"$TUNNEL_TMP/tunnel.log" 2>&1 &
  TUNNEL_PID=$!
  # Closed by close_tunnel; disowned so bash doesn't report that as "Terminated"
  disown "$TUNNEL_PID"
  for _ in $(seq 60); do
    nc -z localhost "$TUNNEL_LOCAL_PORT" 2>/dev/null && return 0
    kill -0 "$TUNNEL_PID" 2>/dev/null || die "the tunnel didn't open: $(cat "$TUNNEL_TMP/tunnel.log")"
    sleep 0.5
  done
  die "the tunnel didn't open in time"
}

close_tunnel() {
  [ -n "$TUNNEL_PID" ] || return 0
  pkill -P "$TUNNEL_PID" 2>/dev/null || true
  kill "$TUNNEL_PID" 2>/dev/null || true
  TUNNEL_PID=""
}

# After a dropped connection: a fresh tunnel (the old session may be half-broken)
reopen_tunnel() {
  close_tunnel
  sleep 2
  open_tunnel
}

# connect_prod: opens a tunnel to production's database and sets PROD_URL (plus PGPASSWORD,
# PGSSLMODE, PGSSLROOTCERT and PG_MOUNTS for `pg`). The tunnel closes when the script exits.
connect_prod() {
  command -v aws >/dev/null || die "the AWS CLI is needed"
  command -v session-manager-plugin >/dev/null ||
    die "the AWS Session Manager plugin is needed (brew install --cask session-manager-plugin)"
  aws sts get-caller-identity >/dev/null 2>&1 || die "not signed in to AWS, or the session expired: sign in again (aws login), then rerun"

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
  TUNNEL_INSTANCE=$(aws ecs describe-container-instances --cluster "$CLUSTER" \
    --container-instances "$(aws ecs list-container-instances --cluster "$CLUSTER" --query 'containerInstanceArns[0]' --output text)" \
    --query 'containerInstances[0].ec2InstanceId' --output text)
  TUNNEL_HOST=$host
  TUNNEL_PORT=$port
  TUNNEL_LOCAL_PORT=${LOCAL_PORT:-15432}
  TUNNEL_TMP=$tmp
  trap 'close_tunnel; rm -rf "$TUNNEL_TMP"' EXIT
  open_tunnel
  RECONNECT=reopen_tunnel

  # TLS checked against the RDS CA (verify-ca: the tunnel's address isn't the certificate's name)
  export PGSSLMODE=verify-ca PGSSLROOTCERT=/certs/ca.pem
  PG_MOUNTS="-v $tmp:/certs:ro"
  PROD_URL="postgres://$user@host.docker.internal:$TUNNEL_LOCAL_PORT/$name"
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
