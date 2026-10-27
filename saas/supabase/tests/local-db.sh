#!/usr/bin/env bash
# Rebuilds a test database on a plain local Postgres (no Docker): the Supabase
# stand-in from shim.sql, then every migration in order.
# Usage: DATABASE_URL=postgresql://postgres@127.0.0.1:54322/cookiemaker_test npm run db:local
set -euo pipefail
: "${DATABASE_URL:?Falta DATABASE_URL}"
case "$DATABASE_URL" in
  *@127.0.0.1[:/]*|*@localhost[:/]*) ;;
  *) echo "db:local solo trabaja con una base local (127.0.0.1 o localhost)." >&2; exit 1 ;;
esac
db="${DATABASE_URL##*/}"
admin="${DATABASE_URL%/*}/postgres"
here="$(cd "$(dirname "$0")" && pwd)"
psql "$admin" -q -v ON_ERROR_STOP=1 -c "drop database if exists \"$db\"" -c "create database \"$db\""
psql "$DATABASE_URL" -q -v ON_ERROR_STOP=1 -f "$here/shim.sql"
for f in "$here"/../migrations/*.sql; do
  psql "$DATABASE_URL" -q -v ON_ERROR_STOP=1 -f "$f"
done
echo "Base lista: $DATABASE_URL"
