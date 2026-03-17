import type { Span, Token } from "./types";
import { TokenKind, isComparatorKind } from "./types";

/**
 * Thrown when an internal assumption is violated. Indicates a bug in onesixty,
 * not invalid user input. If you encounter this error, please report it.
 */
export class InvariantError extends Error {
  constructor(message: string) {
    super(`onesixty internal error: ${message}. This is a bug, please report it.`);
  }
}

export function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new InvariantError(message);
}

function formatToken(token: Token): string {
  switch (token.kind) {
    case TokenKind.Text:
      return `'${token.value}'`;
    case TokenKind.String:
      return `"${token.value}"`;
    case TokenKind.EOF:
      return "end of input";
    case TokenKind.And:
      return "keyword 'AND'";
    case TokenKind.Or:
      return "keyword 'OR'";
    case TokenKind.Not:
      return "keyword 'NOT'";
    default:
      return `'${token.value}'`;
  }
}

function isKeyword(kind: TokenKind): boolean {
  return kind === TokenKind.And || kind === TokenKind.Or || kind === TokenKind.Not;
}

function spanOf(token: Token): Span {
  return { start: token.start, end: token.end };
}

/**
 * Base class for all errors thrown by the onesixty filter pipeline.
 *
 * Every error carries a human-readable {@link description}, an optional
 * {@link span} pointing into the original source, and an optional array
 * of {@link hints} with suggestions for fixing the problem. Subclasses add
 * structured, machine-readable data specific to each error kind.
 *
 * @example
 * ```ts
 * try {
 *   parse('a AND AND b');
 * } catch (e) {
 *   if (e instanceof FilterError) {
 *     console.log(e.description); // "Expected an expression after 'AND', ..."
 *     console.log(e.span);        // { start: 6, end: 9 }
 *     console.log(e.hints);       // ["Remove the duplicate 'AND', ..."]
 *   }
 * }
 * ```
 */
export class FilterError extends Error {
  /** Actionable suggestions for resolving this error. May be empty. */
  public hints: string[];

  public constructor(
    public description: string,
    public span: Span | null,
    public source: string | null,
    hints?: string[],
  ) {
    super(description);
    this.hints = hints ?? [];
  }
}

/**
 * Base class for errors originating in the lexer (tokenization) stage.
 *
 * Always has a non-null {@link span} and {@link source}.
 */
export class LexerError extends FilterError {
  declare public span: Span;
  declare public source: string;
  public constructor(description: string, span: Span, source: string, hints?: string[]) {
    super(description, span, source, hints);
  }
}

/**
 * Base class for errors originating in the parser stage.
 *
 * Always has a non-null {@link span} and {@link source}.
 */
export class ParserError extends FilterError {
  declare public span: Span;
  declare public source: string;
  public constructor(description: string, span: Span, source: string, hints?: string[]) {
    super(description, span, source, hints);
  }
}

/**
 * Base class for errors originating in the evaluator stage.
 *
 * These errors have no {@link span} or {@link source} since they occur
 * at runtime, not during parsing.
 */
export class EvaluateError extends FilterError {
  public constructor(description: string, hints?: string[]) {
    super(description, null, null, hints);
  }
}

/**
 * Thrown when the lexer encounters a character that is not valid in any
 * token position (e.g. a bare `!` not followed by `=`).
 */
export class UnexpectedCharacterError extends LexerError {
  public constructor(
    public readonly character: string,
    span: Span,
    source: string,
  ) {
    const hints: string[] = [];
    if (character === "!") {
      hints.push("Did you mean '!=' (not equals)?");
    }
    super(`Unexpected character '${character}'`, span, source, hints);
  }
}

/**
 * Thrown when a quoted string literal reaches the end of input without
 * a closing quote.
 */
export class UnterminatedStringError extends LexerError {
  public constructor(
    public readonly quote: string,
    span: Span,
    source: string,
  ) {
    super("Unterminated string", span, source, [`Missing closing ${quote} quote`]);
  }
}

/**
 * Thrown when the parser encounters trailing content after a complete
 * filter expression (e.g. an unmatched `)` in `a = 1)`).
 */
export class UnexpectedTokenError extends ParserError {
  public constructor(
    public readonly token: Token,
    source: string,
  ) {
    const hints: string[] = [];
    if (token.kind === TokenKind.RParen) {
      hints.push("No matching '(' found for this ')'");
    }
    super(`Unexpected ${formatToken(token)} after filter expression`, spanOf(token), source, hints);
  }
}

/**
 * Thrown when the parser expects a filter expression (after `AND`, `OR`,
 * `NOT`, or `-`) but finds something else (e.g. `a AND AND b`).
 */
export class ExpectedExpressionError extends ParserError {
  public constructor(
    public readonly after: Token,
    public readonly found: Token,
    source: string,
  ) {
    const hints: string[] = [];
    if (after.kind === found.kind) {
      hints.push(`Remove the duplicate '${after.value}', or add an expression between them`);
    } else if (found.kind === TokenKind.And || found.kind === TokenKind.Or) {
      hints.push(
        `'${found.value}' cannot directly follow '${after.value}'. Add an expression between them`,
      );
    }
    if (isComparatorKind(found.kind)) {
      hints.push(
        `If '${after.value}' is a field name, wrap it in quotes: "${after.value}" ${found.value} ...`,
      );
    }
    super(
      `Expected an expression after '${after.value}', found ${formatToken(found)}`,
      spanOf(found),
      source,
      hints,
    );
  }
}

/**
 * Thrown when the parser expects a value, argument, or field name (after a
 * comparator, comma, dot, or minus) but finds something else
 * (e.g. `a = AND` or `fn(a,)`).
 */
export class ExpectedValueError extends ParserError {
  public constructor(
    public readonly after: Token,
    public readonly found: Token,
    source: string,
  ) {
    let expected: string;
    switch (after.kind) {
      case TokenKind.Dot:
        expected = "a field name";
        break;
      case TokenKind.Comma:
      case TokenKind.LParen:
        expected = "an argument";
        break;
      default:
        expected = "a value";
        break;
    }
    const hints: string[] = [];
    if (after.kind === TokenKind.Equals && found.kind === TokenKind.Equals) {
      hints.push("Did you mean '=' (single equals)? AIP-160 uses '=' not '=='");
    }
    if (isKeyword(found.kind)) {
      hints.push(
        `If you meant the literal text "${found.value}", wrap it in quotes: "${found.value}"`,
      );
    }
    super(
      `Expected ${expected} after '${after.value}', found ${formatToken(found)}`,
      spanOf(found),
      source,
      hints,
    );
  }
}

/**
 * Thrown when the parser expects a field name or value at the start of a
 * comparable but finds a keyword or other non-value token
 * (e.g. `AND` at the start of input).
 */
export class ExpectedIdentifierError extends ParserError {
  public constructor(
    public readonly found: Token,
    source: string,
  ) {
    const hints: string[] = [];
    if (isKeyword(found.kind)) {
      hints.push(`'${found.value}' is a keyword. If it's a field name, wrap it in quotes`);
    }
    super(
      `Expected a field name or value, found ${formatToken(found)}`,
      spanOf(found),
      source,
      hints,
    );
  }
}

/**
 * Thrown when parentheses contain no expression (e.g. `()`).
 */
export class EmptyExpressionError extends ParserError {
  public constructor(
    public readonly token: Token,
    source: string,
  ) {
    super("Expected an expression inside parentheses", spanOf(token), source);
  }
}

/**
 * Thrown when a `(` or function call `fn(` is never closed by a matching `)`.
 */
export class UnclosedDelimiterError extends ParserError {
  public constructor(
    public readonly delimiter: "parenthesis" | "functionCall",
    public readonly found: Token,
    source: string,
    public readonly openPosition?: number,
  ) {
    const delimiterDisplay = delimiter === "functionCall" ? "function call" : delimiter;
    let description: string;
    let hints: string[] | undefined;
    if (openPosition != null) {
      description = `Unclosed ${delimiterDisplay}: expected ')' to match '(' at position ${openPosition}`;
      hints = [`Add ')' to match '(' at position ${openPosition}`];
    } else {
      description = `Expected ')' to close ${delimiterDisplay}, found ${formatToken(found)}`;
    }
    super(description, spanOf(found), source, hints);
  }
}

/**
 * Thrown when a quoted string is used as a function name
 * (e.g. `"fn"()`). AIP-160 requires unquoted function names.
 */
export class InvalidFunctionNameError extends ParserError {
  public constructor(
    public readonly token: Token,
    source: string,
  ) {
    super("Quoted strings cannot be used as function names", spanOf(token), source, [
      `Remove the quotes: ${token.value}`,
    ]);
  }
}

/**
 * Thrown when the `-` minus sign is applied to a function call or a
 * non-numeric dotted field path on the RHS of a comparator.
 */
export class InvalidNegationError extends ParserError {
  public constructor(
    public readonly target: "function" | "fieldPath",
    public readonly token: Token,
    source: string,
  ) {
    const description =
      target === "function"
        ? "Negative sign can only be applied to a value, not a function call"
        : "Negative sign can only be applied to a numeric value, not a field path";
    super(description, spanOf(token), source);
  }
}

/**
 * Thrown when parenthesized nesting exceeds the configured
 * {@link ParseOptions.maxDepth} limit.
 */
export class DepthLimitError extends ParserError {
  public constructor(
    public readonly maxDepth: number,
    public readonly token: Token,
    source: string,
  ) {
    super(`Maximum nesting depth exceeded (${maxDepth})`, spanOf(token), source);
  }
}

/**
 * Thrown when the input string exceeds the configured
 * {@link ParseOptions.maxLength} limit.
 */
export class InputLengthError extends ParserError {
  public constructor(
    public readonly maxLength: number,
    span: Span,
    source: string,
  ) {
    super(`Filter exceeds maximum length of ${maxLength} characters`, span, source);
  }
}

/**
 * Thrown when the evaluator encounters a function call whose name is not
 * in the provided `functions` registry and `unknownFunction` is `"throw"`
 * (the default).
 */
export class UnknownFunctionError extends EvaluateError {
  public constructor(public readonly functionName: string) {
    super(`Unknown function: ${functionName}`);
  }
}

/**
 * Thrown by {@link CompiledFilter.fromSerialized} when the serialized data has an
 * unrecognized or missing format version.
 */
export class UnsupportedVersionError extends FilterError {
  public constructor(public readonly version: unknown) {
    super(`Unsupported serialized filter version: ${String(version)}`, null, null);
  }
}

/**
 * Thrown by {@link CompiledFilter.fromSerialized} when the serialized AST contains
 * a node with an unrecognized `type` discriminant.
 */
export class UnknownNodeTypeError extends FilterError {
  public constructor(
    public readonly path: string,
    public readonly nodeType: string,
  ) {
    super(`Unknown AST node type '${nodeType}' at '${path}'`, null, null);
  }
}

/**
 * Thrown by {@link CompiledFilter.fromSerialized} when a field in the serialized
 * data has an incorrect type (e.g. a number where a string was expected).
 */
export class InvalidFieldTypeError extends FilterError {
  public constructor(
    public readonly path: string,
    public readonly expected: "string" | "boolean" | "array" | "object" | "span" | "comparator",
  ) {
    super(`Expected ${expected} at '${path}'`, null, null);
  }
}
