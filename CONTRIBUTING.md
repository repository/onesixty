# Contributing

Thanks for your interest in contributing to onesixty!

## Setup

```bash
git clone https://github.com/repository/onesixty.git
cd onesixty
pnpm install
```

## Development

```bash
pnpm test          # run tests
pnpm typecheck     # type-check with tsgo
pnpm lint          # lint with oxlint
pnpm fmt           # format with oxfmt
pnpm bench         # run benchmarks
pnpm build         # build dist/
pnpm playground    # interactive REPL for testing expressions
```

## Before submitting a PR

1. **Tests pass:** `pnpm test`
2. **Types check:** `pnpm typecheck`
3. **Lint clean:** `pnpm lint`
4. **Format clean:** `pnpm fmt:check`
5. **API surface:** if you changed the public API, run `pnpm api:extract` and commit the updated `api/index.d.mts`

## Adding a new feature

1. Check the [AIP-160 spec](https://google.aip.dev/160) and [EBNF grammar](reference/ebnf-filtering.txt) if the change relates to parsing or evaluation semantics.
2. Add tests first. The existing test files are organized by pipeline stage.
3. Run `pnpm bench` before and after to check for performance regressions.

## Reporting bugs

Open an issue with:

- The filter expression that triggers the bug
- The target object you're evaluating against
- Expected vs actual behavior
- onesixty version
