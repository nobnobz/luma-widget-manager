#!/bin/sh
# Build the same-origin site and Caddy include as one reviewed deployment artifact.
set -eu
cd "$(dirname "$0")/.."
NEXT_PUBLIC_BASE_PATH=/widgets ./scripts/with-external-cache.sh npm run build
./scripts/with-external-cache.sh node scripts/package-sync-editor.mjs
