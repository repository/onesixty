/**
 * Identifies the kind of a lexer {@link Token}.
 *
 * Tokens fall into five categories: keywords (`And`, `Or`, `Not`),
 * comparators (`Equals` through `Has`), punctuation (`LParen` through `Minus`),
 * values (`Text`, `String`), and the terminal `EOF`.
 */
export enum TokenKind {
  /** The `AND` keyword (case-sensitive). */
  And,
  /** The `OR` keyword (case-sensitive). */
  Or,
  /** The `NOT` keyword (case-sensitive). */
  Not,

  /** The `=` comparator. */
  Equals,
  /** The `!=` comparator. */
  NotEquals,
  /** The `<` comparator. */
  LessThan,
  /** The `<=` comparator. */
  LessEquals,
  /** The `>` comparator. */
  GreaterThan,
  /** The `>=` comparator. */
  GreaterEquals,
  /** The `:` (has) operator. */
  Has,

  /** A `(` delimiter. */
  LParen,
  /** A `)` delimiter. */
  RParen,
  /** A `.` field traversal operator. */
  Dot,
  /** A `,` function argument separator. */
  Comma,
  /** A `-` minus sign (negation or negative numeric literal). */
  Minus,

  /** An unquoted text value (identifiers, numbers, wildcards). */
  Text,
  /** A quoted string literal (single or double quotes). Escape sequences are resolved. */
  String,

  /** End of input. Always the last token in the stream. */
  EOF,
}

/**
 * A single token produced by the lexer.
 *
 * Tokens carry their {@link TokenKind}, raw string value, and byte offsets
 * into the original source string.
 */
export interface Token {
  /** The syntactic category of this token. */
  kind: TokenKind;
  /** The raw text of this token. For {@link TokenKind.String} tokens, escape sequences are already resolved. */
  value: string;
  /** Zero-based byte offset of the first character (inclusive). */
  start: number;
  /** Zero-based byte offset past the last character (exclusive). */
  end: number;
}

/**
 * A half-open byte range `[start, end)` within the source string.
 *
 * Used on CST nodes, AST nodes, and error classes to pinpoint the
 * relevant portion of the original filter expression.
 */
export interface Span {
  /** Zero-based byte offset of the first character (inclusive). */
  start: number;
  /** Zero-based byte offset past the last character (exclusive). */
  end: number;
}

/**
 * The subset of {@link TokenKind} values that represent comparison operators
 * and the has (`:`) operator.
 *
 * @see {@link isComparatorKind}
 */
export type ComparatorKind =
  | TokenKind.Equals
  | TokenKind.NotEquals
  | TokenKind.LessThan
  | TokenKind.LessEquals
  | TokenKind.GreaterThan
  | TokenKind.GreaterEquals
  | TokenKind.Has;

const COMPARATOR_KINDS: ReadonlySet<TokenKind> = new Set<TokenKind>([
  TokenKind.Equals,
  TokenKind.NotEquals,
  TokenKind.LessThan,
  TokenKind.LessEquals,
  TokenKind.GreaterThan,
  TokenKind.GreaterEquals,
  TokenKind.Has,
]);

/**
 * Type-narrowing predicate that checks whether a {@link TokenKind} is a
 * {@link ComparatorKind}.
 *
 * @param kind - The token kind to test.
 * @returns `true` if `kind` is one of the seven comparator token kinds.
 */
export function isComparatorKind(kind: TokenKind): kind is ComparatorKind {
  return COMPARATOR_KINDS.has(kind);
}

/** @internal */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
