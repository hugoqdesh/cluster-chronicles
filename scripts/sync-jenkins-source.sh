#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

kubectl apply -f manifests/namespaces/namespaces.yaml

kubectl -n cicd create configmap sherlock-backend-source \
  --from-file=apps/backend/Dockerfile \
  --from-file=apps/backend/package.json \
  --from-file=apps/backend/package-lock.json \
  --from-file=apps/backend/server.js \
  --from-file=apps/backend/.dockerignore \
  --dry-run=client -o yaml | kubectl apply -f -

kubectl -n cicd create configmap sherlock-frontend-source \
  --from-file=apps/frontend/Dockerfile \
  --from-file=apps/frontend/index.html \
  --from-file=apps/frontend/nginx.conf \
  --from-file=apps/frontend/.dockerignore \
  --dry-run=client -o yaml | kubectl apply -f -
