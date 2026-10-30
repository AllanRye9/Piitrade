#!/usr/bin/env bash
#
# dev.sh — start the WHOLE local development stack with one command, using as little memory as possible.
#
#     ./dev/dev.sh              start everything (database, backend, frontend, nginx) and stay in the foreground
#     ./dev/dev.sh --lan        same, but also reachable from your phone / other machines on the network
#     ./dev/dev.sh status       what is running and how much memory each part uses
#     ./dev/dev.sh stop         stop everything (also what Ctrl-C does)
#     ./dev/dev.sh logs [name]  follow logs: backend | frontend | nginx | db   (default: all)
#     ./dev/dev.sh seed         load the seed data (admin user, categories, packages) into the dev database
#     ./dev/dev.sh doctor       check that the tools it needs are installed
#     ./dev/dev.sh reset-db     delete the managed local database (asks first)
#
# Then open  http://localhost:8080  (one origin: nginx → Next.js for pages, → backend for /api and /uploads).
#
# This script only ADDS files under dev/. It does not change the production code, Dockerfiles, package.json
# or any deploy configuration: everything it needs is passed to the services as environment variables.
# Options (ports, memory caps, extra CORS origins, …) are listed in dev/.env.local.example.

set -uo pipefail
set -m   # job control: every background service gets its own process group, so it can be stopped cleanly

DEV_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$DEV_DIR/.." && pwd)"
BACKEND="$ROOT/backend"
FRONTEND="$ROOT/frontend"
RUN="$DEV_DIR/.run"
DATA="$DEV_DIR/.data"
LOGS="$RUN/logs"
PIDS="$RUN/pids"

# ── output helpers ────────────────────────────────────────────────────────────────────────────────────────
if [ -t 1 ]; then B=$'\033[1m'; D=$'\033[2m'; G=$'\033[32m'; Y=$'\033[33m'; R=$'\033[31m'; Z=$'\033[0m'; else B=""; D=""; G=""; Y=""; R=""; Z=""; fi
say()  { printf '%s\n' "$*"; }
step() { printf '%s▸%s %s\n' "$B" "$Z" "$*"; }
ok()   { printf '  %s✓%s %s\n' "$G" "$Z" "$*"; }
warn() { printf '  %s!%s %s\n' "$Y" "$Z" "$*" >&2; }
die()  { printf '%s✗ %s%s\n' "$R" "$*" "$Z" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

# ── args ───────────────────────────────────────────────────────────────────────────────────────────────────
CMD="up"; LAN_FLAG=""; NOWATCH_FLAG=""
for a in "$@"; do
  case "$a" in
    up|stop|status|logs|seed|doctor|reset-db) CMD="$a" ;;
    --lan) LAN_FLAG=1 ;;
    --no-watch) NOWATCH_FLAG=1 ;;
    -h|--help|help) sed -n '2,22p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) if [ "$CMD" = "logs" ]; then LOG_TARGET="$a"; else die "Unknown argument: $a (try --help)"; fi ;;
  esac
done
LOG_TARGET="${LOG_TARGET:-all}"

# ── config (shell env > dev/.env.local > defaults) ─────────────────────────────────────────────────────────
if [ -f "$DEV_DIR/.env.local" ]; then
  # shellcheck disable=SC1090
  set -a; source <(sed 's/\r$//' "$DEV_DIR/.env.local"); set +a
fi
PORT="${DEV_PORT:-8080}"
BACKEND_PORT="${DEV_BACKEND_PORT:-5000}"
FRONTEND_PORT="${DEV_FRONTEND_PORT:-3000}"
LAN="${LAN_FLAG:-${DEV_LAN:-0}}"
FRONTEND_HEAP="${DEV_FRONTEND_HEAP_MB:-768}"
BACKEND_HEAP="${DEV_BACKEND_HEAP_MB:-256}"
WATCH="${DEV_BACKEND_WATCH:-1}"; [ -n "$NOWATCH_FLAG" ] && WATCH=0
AUTO_MIGRATE="${DEV_AUTO_MIGRATE:-1}"

lan_ip() {
  local ip=""
  if have ipconfig; then ip="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)"; fi
  if [ -z "$ip" ] && have hostname; then ip="$(hostname -I 2>/dev/null | awk '{print $1}')"; fi
  if [ -z "$ip" ] && have ifconfig; then ip="$(ifconfig 2>/dev/null | awk '/inet / && $2!="127.0.0.1"{print $2; exit}')"; fi
  printf '%s' "$ip"
}

HOST_NAME="localhost"; BIND="127.0.0.1"
if [ "$LAN" = "1" ]; then
  HOST_NAME="${DEV_HOST:-$(lan_ip)}"
  [ -n "$HOST_NAME" ] || die "--lan: could not detect your LAN IP; set DEV_HOST=<ip> in dev/.env.local"
  BIND="0.0.0.0"
fi
PUBLIC_ORIGIN="http://$HOST_NAME:$PORT"

# CORS allow-list handed to the backend (it reads CORS_ORIGIN; the same list guards the cookie endpoints).
# Normally the browser only talks to nginx (same origin), so CORS never triggers; this list covers the cases
# where it does: opening the Next dev server directly on :$FRONTEND_PORT, 127.0.0.1 vs localhost, a phone on the LAN.
build_cors() {
  local list="http://localhost:$PORT,http://127.0.0.1:$PORT,http://localhost:$FRONTEND_PORT,http://127.0.0.1:$FRONTEND_PORT"
  if [ "$LAN" = "1" ]; then list="$list,http://$HOST_NAME:$PORT,http://$HOST_NAME:$FRONTEND_PORT"; fi
  [ -n "${DEV_EXTRA_ORIGINS:-}" ] && list="$list,$DEV_EXTRA_ORIGINS"
  [ -n "${CORS_ORIGIN:-}" ] && list="$list,$CORS_ORIGIN"
  printf '%s' "$list" | tr ',' '\n' | sed 's#/*$##' | awk 'NF && !seen[$0]++' | paste -sd, -
}

# ── process helpers ────────────────────────────────────────────────────────────────────────────────────────
pid_of()   { [ -f "$PIDS/$1" ] && cat "$PIDS/$1" 2>/dev/null; }
alive()    { [ -n "${1:-}" ] && kill -0 "$1" 2>/dev/null; }
# Resident memory (MB) of a process and all its descendants — portable across Linux and macOS.
tree_mb() {
  [ -n "${1:-}" ] || { echo 0; return; }
  ps -A -o pid=,ppid=,rss= 2>/dev/null | awk -v root="$1" '
    { pid[NR]=$1; ppid[NR]=$2; rss[NR]=$3; n=NR }
    END { inset[root]=1; changed=1
          while (changed) { changed=0; for (i=1;i<=n;i++) if (!(pid[i] in inset) && (ppid[i] in inset)) { inset[pid[i]]=1; changed=1 } }
          for (i=1;i<=n;i++) if (pid[i] in inset) s+=rss[i]; printf "%d\n", s/1024 }'
}
tcp_open() { (exec 3<>"/dev/tcp/$1/$2") 2>/dev/null; }
wait_for() { # wait_for <seconds> <command...>
  local t="$1"; shift; local i=0
  while [ "$i" -lt "$t" ]; do "$@" >/dev/null 2>&1 && return 0; sleep 1; i=$((i + 1)); done; return 1
}
stop_group() { # polite stop of a process group, then force
  local p="$1" sig="${2:-TERM}"; alive "$p" || return 0
  kill "-$sig" -- "-$p" 2>/dev/null || kill "-$sig" "$p" 2>/dev/null || true
  local i=0; while alive "$p" && [ "$i" -lt 50 ]; do sleep 0.1; i=$((i + 1)); done
  alive "$p" && { kill -KILL -- "-$p" 2>/dev/null || kill -KILL "$p" 2>/dev/null || true; }
  return 0
}

# ── database ───────────────────────────────────────────────────────────────────────────────────────────────
DEFAULT_DB_URL="postgresql://marketplace:marketplace_secret@localhost:55432/marketplace_db?schema=public"
env_file_value() { # env_file_value <file> <KEY>
  [ -f "$1" ] || return 0
  sed 's/\r$//' "$1" | grep -E "^[[:space:]]*$2=" | tail -1 | sed -E "s/^[[:space:]]*$2=//; s/^[\"']//; s/[\"'][[:space:]]*\$//"
}
resolve_db_url() {
  local u="${DATABASE_URL:-}"
  [ -z "$u" ] && u="$(env_file_value "$BACKEND/.env.local" DATABASE_URL)"
  [ -z "$u" ] && u="$(env_file_value "$BACKEND/.env" DATABASE_URL)"
  [ -z "$u" ] && u="$DEFAULT_DB_URL"
  DB_URL="$u"
  local re='^postgres(ql)?://([^:@/]+):([^@]*)@([^:/@]+):?([0-9]*)/([^?]*)'
  [[ "$u" =~ $re ]] || die "DATABASE_URL is not a postgresql://user:password@host:port/db URL"
  DB_USER="${BASH_REMATCH[2]}"; DB_PASS="${BASH_REMATCH[3]}"; DB_HOST="${BASH_REMATCH[4]}"
  DB_PORT="${BASH_REMATCH[5]:-5432}"; DB_NAME="${BASH_REMATCH[6]}"
}
is_local_host() { case "$1" in localhost|127.0.0.1|::1) return 0 ;; *) return 1 ;; esac; }

# Memory-lean Postgres settings for development only (fsync off: fast, and a crash just means "reset the dev DB").
PG_FLAGS="-c shared_buffers=32MB -c max_connections=25 -c work_mem=2MB -c maintenance_work_mem=16MB -c effective_cache_size=64MB -c wal_buffers=1MB -c max_wal_size=256MB -c fsync=off -c synchronous_commit=off -c full_page_writes=off -c autovacuum_max_workers=1 -c max_worker_processes=2 -c max_parallel_workers=0 -c max_parallel_workers_per_gather=0"

find_pg_bin() { # prints the directory that contains initdb/pg_ctl, or nothing
  local d
  if have initdb && have pg_ctl; then dirname "$(command -v initdb)"; return; fi
  for d in /usr/lib/postgresql/*/bin /opt/homebrew/opt/postgresql@*/bin /opt/homebrew/opt/postgresql/bin \
           /usr/local/opt/postgresql@*/bin /usr/local/opt/postgresql/bin /usr/pgsql-*/bin "/c/Program Files/PostgreSQL/"*/bin; do
    [ -x "$d/initdb" ] && [ -x "$d/pg_ctl" ] && { printf '%s' "$d"; return; }
  done
}

ensure_db() {
  resolve_db_url
  if tcp_open "$DB_HOST" "$DB_PORT"; then ok "database: using the PostgreSQL already listening on $DB_HOST:$DB_PORT"; return 0; fi
  is_local_host "$DB_HOST" || die "Cannot reach the database at $DB_HOST:$DB_PORT (it is not on this machine, so I cannot start it)."
  step "starting a lean local PostgreSQL on port $DB_PORT"
  mkdir -p "$LOGS" "$DATA"
  if have docker && docker info >/dev/null 2>&1; then
    local name="piitrade-dev-db-$DB_PORT"
    if docker ps -a --format '{{.Names}}' | grep -qx "$name"; then docker start "$name" >/dev/null
    else
      # shellcheck disable=SC2086
      docker run -d --name "$name" -p "127.0.0.1:$DB_PORT:5432" \
        -e POSTGRES_USER="$DB_USER" -e POSTGRES_PASSWORD="$DB_PASS" -e POSTGRES_DB="$DB_NAME" \
        -v "piitrade-dev-pgdata-$DB_PORT:/var/lib/postgresql/data" postgres:16-alpine $PG_FLAGS >/dev/null \
        || die "docker could not start PostgreSQL"
    fi
    echo "docker:$name" > "$RUN/db.state"
    wait_for 40 tcp_open "$DB_HOST" "$DB_PORT" || die "PostgreSQL (docker) did not come up; see: docker logs $name"
    ok "database: docker container $name"; return 0
  fi
  local bin; bin="$(find_pg_bin)"
  [ -n "$bin" ] || die "No database available. Install Docker (https://docs.docker.com/get-docker/) or PostgreSQL 14+ (brew install postgresql@16 / sudo apt install postgresql), or set DATABASE_URL to one you already run."
  if [ "$(id -u)" = "0" ]; then die "PostgreSQL refuses to run as root. Run ./dev/dev.sh as your normal user."; fi
  local dir="$DATA/pg-$DB_PORT"
  if [ ! -f "$dir/PG_VERSION" ]; then
    mkdir -p "$dir"; printf '%s' "$DB_PASS" > "$RUN/.pgpw"
    "$bin/initdb" -D "$dir" -U "$DB_USER" -E UTF8 --auth-local=trust --auth-host=scram-sha-256 --pwfile="$RUN/.pgpw" >"$LOGS/db-init.log" 2>&1 \
      || { rm -f "$RUN/.pgpw"; die "initdb failed, see $LOGS/db-init.log"; }
    rm -f "$RUN/.pgpw"
  fi
  # shellcheck disable=SC2086
  "$bin/pg_ctl" -D "$dir" -l "$LOGS/db.log" -w -t 40 -o "-p $DB_PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=$RUN $PG_FLAGS" start >/dev/null \
    || die "PostgreSQL did not start, see $LOGS/db.log"
  echo "pg:$bin:$dir" > "$RUN/db.state"
  PGPASSWORD="$DB_PASS" "$bin/psql" -h 127.0.0.1 -p "$DB_PORT" -U "$DB_USER" -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" 2>/dev/null | grep -q 1 \
    || PGPASSWORD="$DB_PASS" "$bin/createdb" -h 127.0.0.1 -p "$DB_PORT" -U "$DB_USER" "$DB_NAME" \
    || die "could not create database $DB_NAME"
  ok "database: private PostgreSQL cluster in dev/.data/pg-$DB_PORT"
}

stop_db() {
  [ -f "$RUN/db.state" ] || return 0
  local st; st="$(cat "$RUN/db.state")"
  case "$st" in
    docker:*) docker stop "${st#docker:}" >/dev/null 2>&1 && ok "database stopped (docker)" ;;
    pg:*) local rest="${st#pg:}"; local bin="${rest%%:*}" dir="${rest#*:}"
          "$bin/pg_ctl" -D "$dir" -m fast -w stop >/dev/null 2>&1 && ok "database stopped" ;;
  esac
  rm -f "$RUN/db.state"
}

# ── dependencies ───────────────────────────────────────────────────────────────────────────────────────────
ensure_node() {
  have node || die "Node.js is not installed (need 20 or newer): https://nodejs.org"
  local major; major="$(node -p 'process.versions.node.split(".")[0]')"
  [ "$major" -ge 20 ] || die "Node $major found, need 20 or newer"
}
npm_install_if_needed() { # <dir> <label> <extra npm flags>
  local dir="$1" label="$2" flags="${3:-}"
  if [ ! -f "$dir/node_modules/.package-lock.json" ] || [ "$dir/package-lock.json" -nt "$dir/node_modules/.package-lock.json" ]; then
    step "installing $label dependencies (first run only)"
    # shellcheck disable=SC2086
    ( cd "$dir" && npm ci --no-audit --no-fund $flags >"$LOGS/npm-$label.log" 2>&1 ) \
      || ( cd "$dir" && npm install --no-audit --no-fund --legacy-peer-deps >>"$LOGS/npm-$label.log" 2>&1 ) \
      || die "npm install failed for $label, see $LOGS/npm-$label.log"
    ok "$label dependencies installed"
  fi
}
ensure_prisma_client() {
  local sum; sum="$(cksum < "$BACKEND/prisma/schema.prisma")"
  if [ ! -d "$BACKEND/node_modules/@prisma/client" ] || [ "$(cat "$RUN/schema.cksum" 2>/dev/null)" != "$sum" ]; then
    step "generating the Prisma client"
    ( cd "$BACKEND" && DATABASE_URL="$DB_URL" npx --no-install prisma generate >"$LOGS/prisma-generate.log" 2>&1 ) \
      || die "prisma generate failed, see $LOGS/prisma-generate.log"
    printf '%s' "$sum" > "$RUN/schema.cksum"
    ok "Prisma client generated"
  fi
}

# ── nginx ──────────────────────────────────────────────────────────────────────────────────────────────────
find_nginx() {
  local c; for c in nginx /opt/homebrew/bin/nginx /usr/local/bin/nginx /usr/sbin/nginx /usr/local/sbin/nginx; do
    if have "$c" || [ -x "$c" ]; then command -v "$c" 2>/dev/null || echo "$c"; return; fi
  done
}
render_nginx_conf() {
  mkdir -p "$RUN/tmp" "$LOGS"
  sed -e "s#@RUN@#$RUN#g" -e "s#@PORT@#$PORT#g" -e "s#@BIND@#$BIND#g" \
      -e "s#@BACKEND_PORT@#$BACKEND_PORT#g" -e "s#@FRONTEND_PORT@#$FRONTEND_PORT#g" \
      "$DEV_DIR/nginx.dev.conf.template" > "$RUN/nginx.conf"
}

# ── commands ───────────────────────────────────────────────────────────────────────────────────────────────
cmd_doctor() {
  step "tools"
  have node && ok "node $(node -v)" || warn "node: missing (need 20+)"
  have npm && ok "npm $(npm -v)" || warn "npm: missing"
  local n; n="$(find_nginx)"; [ -n "$n" ] && ok "nginx: $n" || warn "nginx: missing → brew install nginx | sudo apt install nginx"
  if have docker && docker info >/dev/null 2>&1; then ok "docker: available (used for PostgreSQL if needed)"; else say "  · docker: not available"; fi
  local pb; pb="$(find_pg_bin)"; [ -n "$pb" ] && ok "postgres binaries: $pb" || say "  · postgres binaries: not found"
  resolve_db_url; say "  · database target: $DB_HOST:$DB_PORT/$DB_NAME  (reachable now: $(tcp_open "$DB_HOST" "$DB_PORT" && echo yes || echo no))"
  say "  · ports: app $PORT · backend $BACKEND_PORT · frontend $FRONTEND_PORT"
}

cmd_status() {
  local total=0 name pid mb
  printf '%s%-10s %-8s %-9s %s%s\n' "$B" "service" "pid" "memory" "address" "$Z"
  for name in nginx backend frontend; do
    pid="$(pid_of "$name")"
    if alive "$pid"; then
      mb="$(tree_mb "$pid")"; total=$((total + mb))
      case "$name" in nginx) addr="http://localhost:$PORT" ;; backend) addr="127.0.0.1:$BACKEND_PORT" ;; frontend) addr="127.0.0.1:$FRONTEND_PORT" ;; esac
      printf '%-10s %-8s %-9s %s\n' "$name" "$pid" "${mb} MB" "$addr"
    else printf '%-10s %s\n' "$name" "${D}not running${Z}"; fi
  done
  resolve_db_url
  if tcp_open "$DB_HOST" "$DB_PORT"; then
    local dbmb=""; local dpid; dpid="$(pgrep -f "postgres.*-p $DB_PORT" 2>/dev/null | head -1)"
    [ -n "$dpid" ] && { dbmb="$(tree_mb "$dpid") MB"; total=$((total + ${dbmb% MB})); }
    printf '%-10s %-8s %-9s %s\n' "database" "${dpid:--}" "${dbmb:--}" "$DB_HOST:$DB_PORT"
  else printf '%-10s %s\n' "database" "${D}not running${Z}"; fi
  printf '%s%-10s %-8s %s%s\n' "$B" "total" "" "${total} MB" "$Z"
}

cmd_stop() {
  local any=0 name pid
  for name in frontend backend; do
    pid="$(pid_of "$name")"; if alive "$pid"; then stop_group "$pid"; ok "$name stopped"; any=1; fi; rm -f "$PIDS/$name"
  done
  pid="$(pid_of nginx)"; if alive "$pid"; then stop_group "$pid" QUIT; ok "nginx stopped"; any=1; fi; rm -f "$PIDS/nginx"
  stop_db
  [ "$any" = 1 ] || say "nothing was running"
}

cmd_logs() {
  mkdir -p "$LOGS"
  local files=""
  case "$LOG_TARGET" in
    all) files="$LOGS/backend.log $LOGS/frontend.log $LOGS/nginx.log $LOGS/db.log" ;;
    backend|frontend|nginx|db) files="$LOGS/$LOG_TARGET.log" ;;
    *) die "logs: choose backend | frontend | nginx | db" ;;
  esac
  for f in $files; do [ -f "$f" ] || : > "$f"; done
  # shellcheck disable=SC2086
  exec tail -n 40 -F $files
}

cmd_seed() {
  ensure_node; mkdir -p "$RUN" "$LOGS"; resolve_db_url
  tcp_open "$DB_HOST" "$DB_PORT" || die "The dev database is not running. Start the stack first: ./dev/dev.sh"
  step "seeding $DB_NAME (admin user, categories, packages)"
  ( cd "$BACKEND" && DATABASE_URL="$DB_URL" TS_NODE_TRANSPILE_ONLY=true node -r ts-node/register/transpile-only prisma/seed.ts ) || die "seed failed"
  ok "seeded"
}

cmd_reset_db() {
  resolve_db_url
  printf 'This deletes ALL data in the managed local database (%s:%s). Type "yes" to continue: ' "$DB_HOST" "$DB_PORT"
  read -r answer; [ "$answer" = "yes" ] || die "aborted"
  cmd_stop
  rm -rf "$DATA/pg-$DB_PORT"
  have docker && docker rm -f "piitrade-dev-db-$DB_PORT" >/dev/null 2>&1 && docker volume rm "piitrade-dev-pgdata-$DB_PORT" >/dev/null 2>&1
  ok "database removed; it is recreated on the next ./dev/dev.sh"
}

cleanup_done=0
cleanup() {
  [ "$cleanup_done" = 1 ] && return; cleanup_done=1
  trap - INT TERM EXIT
  say ""; step "shutting down"
  cmd_stop >/dev/null 2>&1 || true
  stop_db
  ok "stopped. Bye!"
}

cmd_up() {
  mkdir -p "$LOGS" "$PIDS" "$DATA"
  local running=""; for n in backend frontend nginx; do alive "$(pid_of $n)" && running=1; done
  if [ -n "$running" ]; then warn "the stack is already running:"; cmd_status; say "Stop it with ./dev/dev.sh stop"; exit 0; fi

  say "${B}Piitrade local development${Z}"
  ensure_node
  have curl || die "curl is required"
  local NGINX; NGINX="$(find_nginx)"
  [ -n "$NGINX" ] || die "nginx is not installed.  macOS: brew install nginx   Ubuntu/WSL: sudo apt install nginx   (Windows: use WSL2)"
  for p in "$PORT" "$BACKEND_PORT" "$FRONTEND_PORT"; do
    tcp_open 127.0.0.1 "$p" && die "port $p is already in use (change it with DEV_PORT / DEV_BACKEND_PORT / DEV_FRONTEND_PORT in dev/.env.local)"
  done

  trap cleanup INT TERM EXIT
  npm_install_if_needed "$BACKEND" backend "--legacy-peer-deps"
  npm_install_if_needed "$FRONTEND" frontend ""
  ensure_db
  ensure_prisma_client

  local CORS; CORS="$(build_cors)"
  : > "$LOGS/backend.log"; : > "$LOGS/frontend.log"; : > "$LOGS/nginx.log"

  # nginx first, so the public port is claimed and the config is validated before the heavy services start.
  step "starting nginx on $BIND:$PORT"
  render_nginx_conf
  local nginx_opts=(-c "$RUN/nginx.conf" -p "$RUN/")
  "$NGINX" "${nginx_opts[@]}" -e "$LOGS/nginx-boot.log" -t >"$LOGS/nginx-test.log" 2>&1 && nginx_opts+=(-e "$LOGS/nginx-boot.log")
  "$NGINX" "${nginx_opts[@]}" -t >>"$LOGS/nginx-test.log" 2>&1 || { cat "$LOGS/nginx-test.log" >&2; die "nginx rejected the generated config"; }
  "$NGINX" "${nginx_opts[@]}" >"$LOGS/nginx-out.log" 2>&1 &
  echo $! > "$PIDS/nginx"

  step "starting backend (Express + Prisma) on :$BACKEND_PORT"
  local watch_args=()
  [ "$WATCH" = "1" ] && watch_args=(--watch-path=src --watch-preserve-output)
  (
    cd "$BACKEND" || exit 1
    exec env \
      NODE_ENV=development PORT="$BACKEND_PORT" DATABASE_URL="$DB_URL" \
      CORS_ORIGIN="$CORS" FRONTEND_URL="$PUBLIC_ORIGIN" API_BASE_URL="$PUBLIC_ORIGIN" \
      AUTO_MIGRATE_ON_START="$([ "$AUTO_MIGRATE" = "1" ] && echo true || echo false)" \
      JWT_SECRET="${JWT_SECRET:-dev-only-access-secret-change-me-0123456789}" \
      JWT_REFRESH_SECRET="${JWT_REFRESH_SECRET:-dev-only-refresh-secret-change-me-9876543210}" \
      ADMIN_PASSWORD="${ADMIN_PASSWORD:-Admin@123!}" \
      RATE_LIMIT_MAX="${RATE_LIMIT_MAX:-100000}" \
      TS_NODE_TRANSPILE_ONLY=true \
      node --max-old-space-size="$BACKEND_HEAP" ${watch_args[@]+"${watch_args[@]}"} -r ts-node/register/transpile-only src/index.ts
  ) >>"$LOGS/backend.log" 2>&1 &
  echo $! > "$PIDS/backend"

  step "starting frontend (Next.js dev, heap cap ${FRONTEND_HEAP} MB) on :$FRONTEND_PORT"
  (
    cd "$FRONTEND" || exit 1
    exec env \
      NEXT_PUBLIC_API_URL="$PUBLIC_ORIGIN" BACKEND_INTERNAL_URL="http://127.0.0.1:$BACKEND_PORT" \
      NEXT_TELEMETRY_DISABLED=1 NODE_OPTIONS="--max-old-space-size=$FRONTEND_HEAP" \
      node node_modules/next/dist/bin/next dev -p "$FRONTEND_PORT" -H 127.0.0.1
  ) >>"$LOGS/frontend.log" 2>&1 &
  echo $! > "$PIDS/frontend"

  # Wait for the backend (first start also runs migrations) and the frontend (first compile is the slow one).
  printf '  waiting for the backend '
  if wait_for 180 curl -fsS -o /dev/null "http://127.0.0.1:$BACKEND_PORT/health"; then printf '%s✓%s\n' "$G" "$Z"
  else printf '%s✗%s\n' "$R" "$Z"; tail -n 25 "$LOGS/backend.log" >&2; die "the backend did not become healthy, see $LOGS/backend.log"; fi
  printf '  waiting for the frontend '
  if wait_for 240 curl -sS -o /dev/null "http://127.0.0.1:$FRONTEND_PORT/"; then printf '%s✓%s\n' "$G" "$Z"
  else printf '%s✗%s\n' "$R" "$Z"; tail -n 25 "$LOGS/frontend.log" >&2; die "the frontend did not start, see $LOGS/frontend.log"; fi

  say ""
  say "${B}Ready${Z}"
  say "  App        ${G}$PUBLIC_ORIGIN${Z}        ${D}(open this one: pages + /api + /uploads on one origin)${Z}"
  say "  Backend    http://127.0.0.1:$BACKEND_PORT   ${D}health: /health${Z}"
  say "  Frontend   http://127.0.0.1:$FRONTEND_PORT   ${D}(direct; CORS allow-list is set for it)${Z}"
  say "  CORS       $CORS"
  say "  Logs       ./dev/dev.sh logs   ${D}· memory: ./dev/dev.sh status · seed data: ./dev/dev.sh seed · stop: Ctrl-C${Z}"
  [ "$LAN" = "1" ] && say "  ${Y}LAN mode:${Z} other devices can open $PUBLIC_ORIGIN (this is a development stack, do not expose it to the internet)"
  say ""
  cmd_status
  say "${D}Memory is highest while pages compile for the first time and settles afterwards (typically under 1 GB in total).${Z}"
  say "${D}Next may restart itself once or twice early on to stay under its memory cap; nginx shows a self-refreshing page meanwhile.${Z}"

  # Stay in the foreground; if a service dies, say so and shut the rest down.
  while true; do
    for n in nginx backend frontend; do
      if ! alive "$(pid_of $n)"; then
        warn "$n stopped unexpectedly. Last log lines:"; tail -n 20 "$LOGS/$n.log" 2>/dev/null >&2
        exit 1
      fi
    done
    sleep 2
  done
}

case "$CMD" in
  up) cmd_up ;;
  stop) cmd_stop ;;
  status) cmd_status ;;
  logs) cmd_logs ;;
  seed) cmd_seed ;;
  doctor) cmd_doctor ;;
  reset-db) cmd_reset_db ;;
esac
