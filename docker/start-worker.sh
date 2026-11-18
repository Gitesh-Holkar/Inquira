#!/bin/sh
# Starts the scheduler once the app has written the shared keys.
set -e
f="${DATA_DIR:-/data}/secrets.env"
until [ -f "$f" ]; do sleep 2; done
set -a
. "$f"
set +a
exec node scripts/worker.mjs
