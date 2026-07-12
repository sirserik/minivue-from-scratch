#!/usr/bin/env bash
# check-book-sync.sh — keeps the two books in lockstep with the code.
#
# The MiniVue book exists in two languages that teach the SAME engine:
#   book/ru/chapters/  (Russian)
#   book/en/chapters/  (English)
#
# Rule (hard): if you change the framework source under packages/, you must
# update BOTH books in the same commit — otherwise the book drifts from the
# code it documents. This script enforces that on the staged changes.
#
# It also warns (soft) if you touched one book but not the other.
#
# Bypass for a genuinely doc-irrelevant code change:
#   git commit --no-verify
#
# Exit codes: 0 = ok, 1 = blocked.

set -euo pipefail

# Staged files (Added/Copied/Modified/Renamed), NUL-safe not needed for our paths.
staged="$(git diff --cached --name-only --diff-filter=ACMR)"

# Nothing staged under our watched areas → nothing to check.
match() { printf '%s\n' "$staged" | grep -Eq "$1"; }

code_changed=false;  match '^packages/'          && code_changed=true
ru_changed=false;    match '^book/ru/chapters/'  && ru_changed=true
en_changed=false;    match '^book/en/chapters/'  && en_changed=true

fail=false

if $code_changed; then
  if ! $ru_changed || ! $en_changed; then
    fail=true
    echo "──────────────────────────────────────────────────────────────────"
    echo " BOOK SYNC: framework code changed, but both books were not updated."
    echo "──────────────────────────────────────────────────────────────────"
    echo "  You staged changes under packages/. The book documents that code,"
    echo "  so BOTH language editions must be updated in the same commit:"
    echo
    $ru_changed && echo "    [x] book/ru/chapters/  (updated)" \
                || echo "    [ ] book/ru/chapters/  (MISSING — update the Russian book)"
    $en_changed && echo "    [x] book/en/chapters/  (updated)" \
                || echo "    [ ] book/en/chapters/  (MISSING — update the English book)"
    echo
    echo "  If this code change genuinely needs no book edit (refactor, test,"
    echo "  tooling), bypass the check with:"
    echo "      git commit --no-verify"
    echo "──────────────────────────────────────────────────────────────────"
  fi
fi

# Soft warning: books drifting apart even without a code change.
if ! $fail && { { $ru_changed && ! $en_changed; } || { $en_changed && ! $ru_changed; }; }; then
  echo "book-sync warning: only one language edition changed — remember the"
  echo "other book teaches the same material and may need the same edit."
fi

$fail && exit 1
exit 0
