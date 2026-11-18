#!/bin/sh
# Starts Inquira in the Docker image: prepares keys, database and data, then serves the app.
set -e
npx tsx scripts/local-setup.ts
set -a
. "${DATA_DIR:-/data}/secrets.env"
set +a
exec npx next start -H 0.0.0.0 -p 3000
