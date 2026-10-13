#!/bin/bash
# The container's entry point: runs the Next.js server and the import worker side by side, as
# the platform runs one container per app. A shell script rather than Node, so supervising the
# two costs a few MB rather than a third Node process (the task's memory is small).
#
# - A process that exits on its own is started again after a growing pause (1s, 2s, 4s, ... up
#   to 30s; back to 1s once it has stayed up for a minute), so a database that isn't reachable
#   yet doesn't spin.
# - SIGTERM (ECS stopping the task) or SIGINT goes to both, and the script exits once they have.
#   ECS kills the task 2 seconds after SIGTERM.
#
# WORKER_MAX_OLD_SPACE_MB caps the worker's heap (default 256): an import then collects garbage
# sooner instead of growing (the federal file peaks about 340 MB rather than about 480 MB).
set -u

STATE_DIR=$(mktemp -d)

log() {
  printf '{"time":"%s","level":"info","scope":"container","msg":"%s"}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)" "$1"
}

# supervise <name> <node arguments...>: runs `node <arguments>`, again whenever it exits
supervise() {
  local name=$1 delay=1 started code
  shift
  while true; do
    started=$SECONDS
    node "$@" &
    echo $! > "$STATE_DIR/$name.pid"
    log "started $name (pid $!)"
    wait $!
    code=$?
    # Gone: a stop mustn't signal its pid, which another process may get
    rm -f "$STATE_DIR/$name.pid"
    [ -e "$STATE_DIR/stopping" ] && exit 0
    if ((SECONDS - started > 60)); then delay=1; fi
    log "$name exited with $code; starting it again in ${delay}s"
    sleep "$delay"
    delay=$((delay * 2 > 30 ? 30 : delay * 2))
  done
}

stop() {
  local pidfile pid alive pids=()
  touch "$STATE_DIR/stopping"
  log "stopping ($1)"
  for pidfile in "$STATE_DIR"/*.pid; do
    [ -e "$pidfile" ] || continue
    pid=$(cat "$pidfile")
    kill -s "$1" "$pid" 2>/dev/null && pids+=("$pid")
  done
  # Let them shut down (the worker stops its queue and closes the pool), up to 1.8s: ECS kills
  # the task 2s after SIGTERM. They aren't this shell's children, so poll rather than wait.
  for _ in $(seq 18); do
    alive=0
    for pid in "${pids[@]}"; do kill -0 "$pid" 2>/dev/null && alive=1; done
    ((alive)) || break
    sleep 0.1
  done
  # Supervisors sleeping between restarts have nothing left to wait for
  kill "$WEB" "$WORKER" 2>/dev/null
  exit 0
}
trap 'stop TERM' TERM
trap 'stop INT' INT

supervise web server.js &
WEB=$!
supervise worker "--max-old-space-size=${WORKER_MAX_OLD_SPACE_MB:-256}" dist/worker/index.mjs &
WORKER=$!
wait
