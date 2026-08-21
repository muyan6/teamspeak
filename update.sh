#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FULL_UPDATE=false

usage() {
  cat <<'EOF'
Usage: bash update.sh [--full]

Without arguments, only installs dependencies, builds, and restarts services
affected by the pulled changes. Use --full to force a complete rebuild.
EOF
}

case "${1:-}" in
  "") ;;
  --full) FULL_UPDATE=true ;;
  -h|--help)
    usage
    exit 0
    ;;
  *)
    usage >&2
    exit 1
    ;;
esac

cd "$SCRIPT_DIR"

if [[ ! -d .git ]]; then
  echo "Error: update.sh must be run from a Git checkout."
  exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Error: the working tree has local changes. Commit, stash, or discard them before updating."
  exit 1
fi

install_dependencies() {
  local directory="$1"

  echo "Installing dependencies in ${directory}..."
  if [[ -f "${directory}/package-lock.json" ]]; then
    (cd "$directory" && npm ci)
  else
    (cd "$directory" && npm install)
  fi
}

build_backend=false
build_frontend=false
install_backend=false
install_frontend=false
restart_backend=false

echo "Fetching updates..."
git fetch --prune origin
before="$(git rev-parse HEAD)"
git pull --ff-only
after="$(git rev-parse HEAD)"

if [[ "$FULL_UPDATE" == true ]]; then
  install_backend=true
  install_frontend=true
  build_backend=true
  build_frontend=true
  restart_backend=true
else
  if [[ "$before" != "$after" ]]; then
    while IFS= read -r changed_file; do
      case "$changed_file" in
        backend/package.json|backend/package-lock.json)
          install_backend=true
          build_backend=true
          restart_backend=true
          ;;
        backend/src/*|backend/tsconfig*.json)
          build_backend=true
          restart_backend=true
          ;;
        frontend/package.json|frontend/package-lock.json)
          install_frontend=true
          build_frontend=true
          ;;
        frontend/src/*|frontend/public/*|frontend/index.html|frontend/vite.config.*|frontend/tsconfig*.json|frontend/*.d.ts)
          build_frontend=true
          ;;
      esac
    done < <(git diff --name-only "$before" "$after")
  fi

  if [[ ! -d backend/node_modules ]]; then
    install_backend=true
    build_backend=true
    restart_backend=true
  fi

  if [[ ! -d frontend/node_modules ]]; then
    install_frontend=true
    build_frontend=true
  fi

  if [[ ! -f backend/dist/index.js ]]; then
    build_backend=true
    restart_backend=true
  fi

  if [[ ! -f frontend/dist/index.html ]]; then
    build_frontend=true
  fi
fi

if [[ "$install_backend" == true ]]; then
  install_dependencies backend
fi

if [[ "$install_frontend" == true ]]; then
  install_dependencies frontend
fi

if [[ "$build_backend" == true ]]; then
  echo "Building backend..."
  (cd backend && npm run build)
fi

if [[ "$build_frontend" == true ]]; then
  echo "Building frontend..."
  (cd frontend && npm run build)
fi

if [[ "$restart_backend" == true ]]; then
  if ! command -v pm2 >/dev/null 2>&1; then
    echo "Warning: backend was updated, but PM2 is not installed. Start or restart the service manually."
  elif pm2 describe ts3-monitor >/dev/null 2>&1; then
    echo "Restarting PM2 process ts3-monitor..."
    pm2 restart ts3-monitor --update-env
  else
    echo "Warning: backend was updated, but PM2 process ts3-monitor was not found. Start it manually."
  fi
fi

if [[ "$before" == "$after" && "$FULL_UPDATE" == false && "$install_backend" == false && "$install_frontend" == false && "$build_backend" == false && "$build_frontend" == false ]]; then
  echo "Already up to date. No build or restart was required."
else
  echo "Update completed."
fi
