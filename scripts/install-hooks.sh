#!/usr/bin/env bash
# Enables the repo's git hooks for this clone.
# Run once after cloning:  bash scripts/install-hooks.sh
set -euo pipefail
ROOT="$(git rev-parse --show-toplevel)"
git -C "$ROOT" config core.hooksPath .githooks
echo "Git hooks enabled (core.hooksPath = .githooks)."
echo "The pre-commit hook now keeps book/ru and book/en in sync with packages/."
