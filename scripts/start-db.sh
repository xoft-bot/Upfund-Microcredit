#!/usr/bin/env bash
set -eu
command -v initdb >/dev/null && command -v pg_ctl >/dev/null && command -v createdb >/dev/null \
  || { echo "postgres binaries not found on PATH" >&2; exit 1; }
PGDATA="${PGDATA:-$HOME/pgdata}"
if [ ! -f "$PGDATA/PG_VERSION" ]; then
  rm -rf "$PGDATA"
  printf 'localtest' > "$HOME/.pgpw.tmp"
  initdb -D "$PGDATA" -U ubuntu --auth=scram-sha-256 --pwfile="$HOME/.pgpw.tmp"
  rm -f "$HOME/.pgpw.tmp"
fi
SOCK="$PGDATA/sockets"
mkdir -p "$SOCK"
if ! pg_ctl -D "$PGDATA" status >/dev/null 2>&1; then
  pg_ctl -D "$PGDATA" -o "-k $SOCK -p 5432 -c listen_addresses=localhost" -l "$PGDATA/server.log" start -w
fi
export PGPASSWORD=localtest
exists=$(psql -h localhost -U ubuntu -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='upfund_test'")
[ "$exists" = "1" ] || createdb -h localhost -U ubuntu upfund_test
echo "Local Postgres ready. Run: export DATABASE_URL=postgresql://ubuntu:localtest@localhost:5432/upfund_test"
