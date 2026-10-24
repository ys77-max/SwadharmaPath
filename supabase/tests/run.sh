#!/usr/bin/env bash
# Runs every migration (in order) and the RLS tests against a throwaway database on a local Postgres 15+.
#   PGHOST=localhost PGUSER=postgres ./supabase/tests/run.sh
set -euo pipefail
cd "$(dirname "$0")"
DB=${DB:-swadharmapath_test}
psql -q -v ON_ERROR_STOP=1 -d postgres -c "drop database if exists $DB" -c "create database $DB"
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase_stub.sql
for m in ../migrations/*.sql; do
  # A failing migration stops the run; only notices are silenced.
  PGOPTIONS='--client-min-messages=warning' psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$m"
done
psql -q -v ON_ERROR_STOP=1 -d "$DB" -c "select 1 from public.careers limit 1" >/dev/null
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f fixtures.sql -f test_helpers.sql
PGPASSWORD=authenticator psql -q -v ON_ERROR_STOP=1 -h "${PGHOST:-localhost}" -U authenticator -d "$DB" -f rls_test.sql
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f owner_test.sql
PGPASSWORD=authenticator psql -q -v ON_ERROR_STOP=1 -h "${PGHOST:-localhost}" -U authenticator -d "$DB" -f library_archive_test.sql
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f archive_owner_test.sql
