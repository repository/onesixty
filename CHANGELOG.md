# Changelog

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
