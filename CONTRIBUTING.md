# Contributing to MiniVue

Thanks for helping out! A few things keep this repo coherent.

## Enable the git hooks (once)

```bash
bash scripts/install-hooks.sh
```

This sets `core.hooksPath` to `.githooks` for your clone (git can't ship this
setting inside the repo, so every clone runs it once).

## The book and the code move together

MiniVue is a *teaching* project: every subsystem under `packages/` is explained
by a book chapter. The book ships in **two languages that document the same
engine**:

```
book/ru/chapters/   Russian edition
book/en/chapters/   English edition
```

**Rule:** if you change the framework source under `packages/`, update **both**
books in the same commit. Otherwise the book drifts from the code it teaches —
the one thing this project can't afford. The `pre-commit` hook enforces this:

- Change `packages/**` without touching **both** `book/ru/chapters/` and
  `book/en/chapters/` → the commit is **blocked**.
- Touch only one language edition → you get a **warning** (the other book
  usually needs the same edit).

Chapter files map 1:1 by name across languages (`01-reactivity.md` in `ru/`
mirrors `01-reactivity.md` in `en/`), so the parallel edit is easy to find.

### Genuinely doc-irrelevant code change?

Refactors, test-only changes and tooling sometimes don't touch the narrative.
Bypass the hook for that commit:

```bash
git commit --no-verify
```

Use it sparingly — if the behavior a chapter describes changed, the chapter
changed too.

## Building the books

```bash
bash book/build/build-pdf.sh ru     # → book/MiniVue-from-scratch-ru.pdf
bash book/build/build-pdf.sh en     # → book/MiniVue-from-scratch-en.pdf
bash book/build/build-pdf.sh all    # both (default)
```

Requires `pandoc` 3.x and `xelatex` (TeX Live).

## Running the code

```bash
npm test          # 104 tests on node:test
npm run serve     # live playground at http://localhost:5173/playground/
npm run e2e       # headless-Chrome e2e for the Kanban capstone
```

## Good first contributions

- Improve the English translation (it was seeded from the Russian original —
  polish welcome).
- New playground demos or edge-case tests.
- Typo/clarity fixes — but apply them to **both** language editions.
