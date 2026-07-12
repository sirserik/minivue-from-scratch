#!/usr/bin/env bash
# Builds the MiniVue book PDF from book/<lang>/chapters/*.md.
#
# Usage:
#   bash book/build/build-pdf.sh [ru|en|all]
#
#   ru    — build the Russian book   → book/MiniVue-from-scratch-ru.pdf
#   en    — build the English book   → book/MiniVue-from-scratch-en.pdf
#   all   — build both (default)
#
# Chapters and title metadata live per language under book/ru/ and book/en/.
# The two books must stay in sync: every code change should be reflected in
# BOTH. See scripts/check-book-sync.sh (enforced by the pre-commit hook).

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LANGS_ARG="${1:-all}"

case "$LANGS_ARG" in
  ru)  LANGS=(ru) ;;
  en)  LANGS=(en) ;;
  all) LANGS=(ru en) ;;
  *)   echo "usage: build-pdf.sh [ru|en|all]" >&2; exit 2 ;;
esac

build_one() {
  local lang="$1"
  local dir="$ROOT/book/$lang"
  local meta="$dir/metadata.yaml"
  local out="$ROOT/book/MiniVue-from-scratch-$lang.pdf"

  # Chapters in reading order (sort keeps 00 < 00b < 01 < ... < 12).
  local FILES=()
  while IFS= read -r f; do FILES+=("$f"); done < <(ls "$dir"/chapters/*.md | sort)

  echo "[$lang] building ${#FILES[@]} chapters → $out"

  local TMP
  TMP="$(mktemp -d)"
  trap 'rm -rf "$TMP"' RETURN

  pandoc \
    -s \
    "$meta" \
    "${FILES[@]}" \
    --pdf-engine=xelatex \
    --top-level-division=chapter \
    --highlight-style=tango \
    --listings=false \
    -o "$TMP/book.tex"

  ( cd "$TMP"
    for i in 1 2 3; do
      echo "  [$lang] xelatex pass $i/3..."
      xelatex -interaction=batchmode -halt-on-error book.tex >/dev/null 2>&1 || {
        xelatex -interaction=nonstopmode book.tex 2>&1 | tail -30
        exit 1
      }
    done )

  mv "$TMP/book.pdf" "$out"
  echo "  [$lang] done: $out ($(du -h "$out" | cut -f1))"
}

for lang in "${LANGS[@]}"; do
  build_one "$lang"
done
