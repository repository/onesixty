# Changelog

## 0.2.0

### Features

- **Tolerant parsing:** `parse(input, { tolerant: true })` collects all errors and returns a best-effort CST instead of throwing on the first syntax error. Useful for editor integrations, as-you-type validation, and multi-error diagnostics.
- **Tolerant tokenization:** `tokenize(input, { tolerant: true })` returns a `TokenizeResult` with the token stream and any lexer errors.
- **`toCleanTree()`:** narrows a tolerant `ParseResult` to a strict `FilterNode` when error-free, or returns `null`. Safe to pass directly to `transform()`.
- **`hasErrorNodes()`:** walks a tolerant CST and returns `true` if any `ErrorNode` is present.
- **`ErrorNode` CST type:** new node type representing recovered syntax errors, with the original error, skipped tokens, and `expectedAt` span for editor diagnostics.

### New exports

`toCleanTree`, `hasErrorNodes`, `ErrorNode`, `ParseResult`, `TokenizeResult`, `MaybeError`

## 0.1.3

Minor test improvements.

## 0.1.2

Enable npm provenance attestation on publish.

## 0.1.1

Package metadata and CI fixes.

## 0.1.0

Initial release.

### Features

- **Full AIP-160 grammar:** comparisons (`=`, `!=`, `<`, `<=`, `>`, `>=`), `AND`/`OR`/`NOT`, field traversal (`.`), has operator (`:`), functions, wildcards, parentheses
- **`filter()`:** one-shot parse + evaluate in a single call
- **`compile()`:** parse once, evaluate many times with `CompiledFilter.evaluate()`
- **`evaluateAsync()`:** async variant supporting custom functions that return promises
- **Serialization:** `CompiledFilter.toJSON()` / `CompiledFilter.fromJSON()` for persistence to databases, caches, or network transfer
- **Structured errors:** typed error classes (`InputLengthError`, `DepthLimitError`, `UnexpectedTokenError`, etc.) with source spans and contextual hints
- **Full CST and AST:** `parse()` produces a concrete syntax tree (for tooling), `transform()` produces an abstract syntax tree (for evaluation or custom backends)
- **Security hardening:** input length limits, recursion depth limits, prototype chain guards, error message truncation
- **Zero dependencies**
