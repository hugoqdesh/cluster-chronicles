#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

registry_port="$(docker port cluster-chronicles 5000/tcp | awk -F: 'NR == 1 { print $NF }')"
[[ -n "$registry_port" ]] || { echo "Minikube registry port not found" >&2; exit 1; }
curl -fsS --max-time 5 "http://127.0.0.1:${registry_port}/v2/" >/dev/null

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

for app in backend frontend; do
  image="sherlock-${app}:v1"
  target="127.0.0.1:${registry_port}/sherlock-${app}:v1"

  docker build -t "$image" "apps/$app"
  docker save -o "$tmp_dir/$app.tar" "$image"
  crane push --insecure "$tmp_dir/$app.tar" "$target"
  crane digest --insecure "$target" >/dev/null
  echo "Pushed $target"
done
