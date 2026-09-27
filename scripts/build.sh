#!/usr/bin/env bash
# Vercel's build step (npm run build), for Git and CLI deploys alike.
#
# MAINTENANCE_MODE=1 (a Vercel environment variable) ships maintenance/index.html in place of
# the app: vercel.json's catch-all route serves public/index.html for every page, so every URL
# shows the maintenance page. Git deploys always build with vercel.json, so an env var is the
# switch that survives a push. To end maintenance, remove the variable and redeploy.
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ "${MAINTENANCE_MODE:-}" == "1" ]]; then
  echo "MAINTENANCE_MODE=1: publishing the maintenance page instead of the app."
  rm -rf public
  mkdir public
  cp maintenance/index.html public/index.html
  exit 0
fi

(cd react-app && npm ci && npm run build)
rm -rf public
cp -R react-app/dist public
