#!/usr/bin/env bash
# Собирает PDF учебника MiniVue из book/chapters/*.md.
# Использование: bash book/build/build-pdf.sh [output.pdf] [файл1.md ...]

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="${1:-$ROOT/book/MiniVue-from-scratch.pdf}"
shift || true

if [ "$#" -gt 0 ]; then
  FILES=("$@")
else
  # Порядок глав = порядок изучения слоёв.
  FILES=(
    "$ROOT/book/chapters/00-intro.md"
    "$ROOT/book/chapters/00b-javascript-minimum.md"
    "$ROOT/book/chapters/01-reactivity.md"
    "$ROOT/book/chapters/02-vdom.md"
    "$ROOT/book/chapters/03-components.md"
    "$ROOT/book/chapters/04-compiler.md"
    "$ROOT/book/chapters/05-router.md"
    "$ROOT/book/chapters/06-store.md"
    "$ROOT/book/chapters/07-ssr.md"
    "$ROOT/book/chapters/08-forms.md"
    "$ROOT/book/chapters/09-reactivity-extras.md"
    "$ROOT/book/chapters/10-directives.md"
  )
fi

EXISTING=()
for f in "${FILES[@]}"; do
  if [ -f "$f" ]; then
    EXISTING+=("$f")
  else
    echo "skip: $f (нет файла)" >&2
  fi
done

echo "Сборка PDF: ${#EXISTING[@]} глав → $OUT"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

pandoc \
  -s \
  "$ROOT/book/build/metadata.yaml" \
  "${EXISTING[@]}" \
  --pdf-engine=xelatex \
  --top-level-division=chapter \
  --highlight-style=tango \
  --listings=false \
  -o "$TMP/book.tex"

cd "$TMP"
# Три прогона xelatex — чтобы оглавление, ссылки и номера страниц сошлись.
for i in 1 2 3; do
  echo "  xelatex pass $i/3..."
  xelatex -interaction=batchmode -halt-on-error book.tex >/dev/null 2>&1 || {
    xelatex -interaction=nonstopmode book.tex 2>&1 | tail -30
    exit 1
  }
done

mv "$TMP/book.pdf" "$OUT"
cd "$ROOT"

echo "Готово: $OUT ($(du -h "$OUT" | cut -f1))"
