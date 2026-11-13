#!/usr/bin/env bash
# Copy the built plugin into a vault.
# Usage: ./scripts/install.sh /path/to/vault
set -euo pipefail
vault="${1:-}"
if [ -z "$vault" ]; then
  echo "usage: $0 /path/to/vault" >&2
  exit 1
fi
dest="$vault/.obsidian/plugins/agent-deck"
mkdir -p "$dest"
cp main.js manifest.json styles.css README.md README.en.md versions.json "$dest/"
cp docs/task-workflow.zh-CN.md "$dest/README-交接.md"
echo "installed to $dest"
