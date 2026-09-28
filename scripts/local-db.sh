#!/usr/bin/env bash
# Local Postgres 16 that behaves like Supabase for Inquira's purposes.
# Usage: scripts/local-db.sh up|down|reset|psql
# Port 54322 (Supabase CLI's default local DB port). Data in .pgdata/ (gitignored).
set -euo pipefail
cd "$(dirname "$0")/.."
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
[ -x "$PGBIN/pg_ctl" ] || PGBIN="$(dirname "$(command -v pg_ctl)")"
DATA="$PWD/.pgdata"
PORT="${LOCAL_PG_PORT:-54322}"
LOG="$DATA/../.pg.log"
as_pg() { if [ "$(id -u)" = "0" ]; then runuser -u postgres -- "$@"; else "$@"; fi; }

up() {
  if [ ! -f "$DATA/PG_VERSION" ]; then
    mkdir -p "$DATA"; [ "$(id -u)" = "0" ] && chown postgres:postgres "$DATA"
    as_pg "$PGBIN/initdb" -D "$DATA" -U postgres --auth=trust -E UTF8 --locale=C.UTF-8 >/dev/null
    echo "listen_addresses='127.0.0.1'" >> "$DATA/postgresql.conf"
    echo "port=$PORT" >> "$DATA/postgresql.conf"
    echo "unix_socket_directories='/tmp'" >> "$DATA/postgresql.conf"
  fi
  touch "$LOG"; [ "$(id -u)" = "0" ] && chown postgres:postgres "$LOG"
  if ! as_pg "$PGBIN/pg_ctl" -D "$DATA" status >/dev/null 2>&1; then
    as_pg "$PGBIN/pg_ctl" -D "$DATA" -l "$LOG" -w start >/dev/null
  fi
  psql "postgres://postgres@127.0.0.1:$PORT/postgres" -q -v ON_ERROR_STOP=1 -c "alter user postgres password 'postgres'" >/dev/null
  psql "postgres://postgres@127.0.0.1:$PORT/postgres" -q -v ON_ERROR_STOP=1 -f scripts/local-db/supabase-shim.sql >/dev/null
  echo "Local Postgres up: postgres://postgres:postgres@127.0.0.1:$PORT/postgres"
}
down() { as_pg "$PGBIN/pg_ctl" -D "$DATA" -m fast stop >/dev/null 2>&1 || true; echo "stopped"; }
reset() { down; rm -rf "$DATA" "$LOG"; up; }
case "${1:-up}" in
  up) up ;; down) down ;; reset) reset ;;
  psql) shift; psql "postgres://postgres:postgres@127.0.0.1:$PORT/postgres" "$@" ;;
  *) echo "usage: $0 up|down|reset|psql"; exit 1 ;;
esac
