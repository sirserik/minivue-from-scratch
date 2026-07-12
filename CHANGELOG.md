# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- English edition of the companion book (`book/en/`), alongside the Russian
  original (`book/ru/`).
- `pre-commit` hook that keeps both book editions in sync with `packages/`
  (`scripts/check-book-sync.sh`, enabled via `scripts/install-hooks.sh`).
- GitHub Actions CI running the test suite on Node 18/20/22.
- Issue forms, pull-request template, Code of Conduct, and `CONTRIBUTING.md`.

### Changed
- Book restructured into per-language folders; `build-pdf.sh` now takes a
  language argument (`ru` / `en` / `all`) and emits `MiniVue-from-scratch-<lang>.pdf`.

## [0.1.0]

### Added
- All 12 layers of the framework, from reactivity to SSR, with 104 tests.
- The Kanban capstone app (`examples/kanban`) with unit and e2e tests.
- Browser playground demos for every layer.
- The companion book (13 chapters).
