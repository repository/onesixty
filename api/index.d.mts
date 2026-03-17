//#region src/types.d.ts
/**
 * Identifies the kind of a lexer {@link Token}.
 *
 * Tokens fall into five categories: keywords (`And`, `Or`, `Not`),
 * comparators (`Equals` through `Has`), punctuation (`LParen` through `Minus`),
 * values (`Text`, `String`), and the terminal `EOF`.
 */
declare enum TokenKind {
  /** The `AND` keyword (case-sensitive). */
  And = 0,
  /** The `OR` keyword (case-sensitive). */
  Or = 1,
  /** The `NOT` keyword (case-sensitive). */
  Not = 2,
  /** The `=` comparator. */
  Equals = 3,
  /** The `!=` comparator. */
  NotEquals = 4,
  /** The `<` comparator. */
  LessThan = 5,
  /** The `<=` comparator. */
  LessEquals = 6,
  /** The `>` comparator. */
  GreaterThan = 7,
  /** The `>=` comparator. */
  GreaterEquals = 8,
  /** The `:` (has) operator. */
  Has = 9,
  /** A `(` delimiter. */
  LParen = 10,
  /** A `)` delimiter. */
  RParen = 11,
  /** A `.` field traversal operator. */
  Dot = 12,
  /** A `,` function argument separator. */
  Comma = 13,
  /** A `-` minus sign (negation or negative numeric literal). */
  Minus = 14,
  /** An unquoted text value (identifiers, numbers, wildcards). */
  Text = 15,
  /** A quoted string literal (single or double quotes). Escape sequences are resolved. */
  String = 16,
  /** End of input. Always the last token in the stream. */
  EOF = 17
}
/**
 * A single token produced by the lexer.
 *
 * Tokens carry their {@link TokenKind}, raw string value, and byte offsets
 * into the original source string.
 */
interface Token {
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
interface Span {
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
type ComparatorKind = TokenKind.Equals | TokenKind.NotEquals | TokenKind.LessThan | TokenKind.LessEquals | TokenKind.GreaterThan | TokenKind.GreaterEquals | TokenKind.Has;
/**
 * Type-narrowing predicate that checks whether a {@link TokenKind} is a
 * {@link ComparatorKind}.
 *
 * @param kind - The token kind to test.
 * @returns `true` if `kind` is one of the seven comparator token kinds.
 */
declare function isComparatorKind(kind: TokenKind): kind is ComparatorKind;
//#endregion
//#region src/errors.d.ts
/**
 * Thrown when an internal assumption is violated. Indicates a bug in onesixty,
 * not invalid user input. If you encounter this error, please report it.
 */
declare class InvariantError extends Error {
  constructor(message: string);
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
declare class FilterError extends Error {
  description: string;
  span: Span | null;
  source: string | null;
  /** Actionable suggestions for resolving this error. May be empty. */
  hints: string[];
  constructor(description: string, span: Span | null, source: string | null, hints?: string[]);
}
/**
 * Base class for errors originating in the lexer (tokenization) stage.
 *
 * Always has a non-null {@link span} and {@link source}.
 */
declare class LexerError extends FilterError {
  span: Span;
  source: string;
  constructor(description: string, span: Span, source: string, hints?: string[]);
}
/**
 * Base class for errors originating in the parser stage.
 *
 * Always has a non-null {@link span} and {@link source}.
 */
declare class ParserError extends FilterError {
  span: Span;
  source: string;
  constructor(description: string, span: Span, source: string, hints?: string[]);
}
/**
 * Base class for errors originating in the evaluator stage.
 *
 * These errors have no {@link span} or {@link source} since they occur
 * at runtime, not during parsing.
 */
declare class EvaluateError extends FilterError {
  constructor(description: string, hints?: string[]);
}
/**
 * Thrown when the lexer encounters a character that is not valid in any
 * token position (e.g. a bare `!` not followed by `=`).
 */
declare class UnexpectedCharacterError extends LexerError {
  readonly character: string;
  constructor(character: string, span: Span, source: string);
}
/**
 * Thrown when a quoted string literal reaches the end of input without
 * a closing quote.
 */
declare class UnterminatedStringError extends LexerError {
  readonly quote: string;
  constructor(quote: string, span: Span, source: string);
}
/**
 * Thrown when the parser encounters trailing content after a complete
 * filter expression (e.g. an unmatched `)` in `a = 1)`).
 */
declare class UnexpectedTokenError extends ParserError {
  readonly token: Token;
  constructor(token: Token, source: string);
}
/**
 * Thrown when the parser expects a filter expression (after `AND`, `OR`,
 * `NOT`, or `-`) but finds something else (e.g. `a AND AND b`).
 */
declare class ExpectedExpressionError extends ParserError {
  readonly after: Token;
  readonly found: Token;
  constructor(after: Token, found: Token, source: string);
}
/**
 * Thrown when the parser expects a value, argument, or field name (after a
 * comparator, comma, dot, or minus) but finds something else
 * (e.g. `a = AND` or `fn(a,)`).
 */
declare class ExpectedValueError extends ParserError {
  readonly after: Token;
  readonly found: Token;
  constructor(after: Token, found: Token, source: string);
}
/**
 * Thrown when the parser expects a field name or value at the start of a
 * comparable but finds a keyword or other non-value token
 * (e.g. `AND` at the start of input).
 */
declare class ExpectedIdentifierError extends ParserError {
  readonly found: Token;
  constructor(found: Token, source: string);
}
/**
 * Thrown when parentheses contain no expression (e.g. `()`).
 */
declare class EmptyExpressionError extends ParserError {
  readonly token: Token;
  constructor(token: Token, source: string);
}
/**
 * Thrown when a `(` or function call `fn(` is never closed by a matching `)`.
 */
declare class UnclosedDelimiterError extends ParserError {
  readonly delimiter: "parenthesis" | "functionCall";
  readonly found: Token;
  readonly openPosition?: number | undefined;
  constructor(delimiter: "parenthesis" | "functionCall", found: Token, source: string, openPosition?: number | undefined);
}
/**
 * Thrown when a quoted string is used as a function name
 * (e.g. `"fn"()`). AIP-160 requires unquoted function names.
 */
declare class InvalidFunctionNameError extends ParserError {
  readonly token: Token;
  constructor(token: Token, source: string);
}
/**
 * Thrown when the `-` minus sign is applied to a function call or a
 * non-numeric dotted field path on the RHS of a comparator.
 */
declare class InvalidNegationError extends ParserError {
  readonly target: "function" | "fieldPath";
  readonly token: Token;
  constructor(target: "function" | "fieldPath", token: Token, source: string);
}
/**
 * Thrown when parenthesized nesting exceeds the configured
 * {@link ParseOptions.maxDepth} limit.
 */
declare class DepthLimitError extends ParserError {
  readonly maxDepth: number;
  readonly token: Token;
  constructor(maxDepth: number, token: Token, source: string);
}
/**
 * Thrown when the input string exceeds the configured
 * {@link ParseOptions.maxLength} limit.
 */
declare class InputLengthError extends ParserError {
  readonly maxLength: number;
  constructor(maxLength: number, span: Span, source: string);
}
/**
 * Thrown when the evaluator encounters a function call whose name is not
 * in the provided `functions` registry and `unknownFunction` is `"throw"`
 * (the default).
 */
declare class UnknownFunctionError extends EvaluateError {
  readonly functionName: string;
  constructor(functionName: string);
}
/**
 * Thrown by {@link CompiledFilter.fromSerialized} when the serialized data has an
 * unrecognized or missing format version.
 */
declare class UnsupportedVersionError extends FilterError {
  readonly version: unknown;
  constructor(version: unknown);
}
/**
 * Thrown by {@link CompiledFilter.fromSerialized} when the serialized AST contains
 * a node with an unrecognized `type` discriminant.
 */
declare class UnknownNodeTypeError extends FilterError {
  readonly path: string;
  readonly nodeType: string;
  constructor(path: string, nodeType: string);
}
/**
 * Thrown by {@link CompiledFilter.fromSerialized} when a field in the serialized
 * data has an incorrect type (e.g. a number where a string was expected).
 */
declare class InvalidFieldTypeError extends FilterError {
  readonly path: string;
  readonly expected: "string" | "boolean" | "array" | "object" | "span" | "comparator";
  constructor(path: string, expected: "string" | "boolean" | "array" | "object" | "span" | "comparator");
}
//#endregion
//#region src/lexer.d.ts
/**
 * Result of tokenizing with `tolerant: true`.
 */
interface TokenizeResult {
  /** Token stream, always terminated by an `EOF` token. */
  tokens: Token[];
  /** Lexer errors collected during tokenization. Empty on success. */
  errors: LexerError[];
}
/**
 * Tokenize an AIP-160 filter expression into a stream of tokens.
 *
 * @param input - The raw filter expression string.
 * @returns An array of tokens, always terminated by an `EOF` token.
 *
 * @example
 * ```ts
 * tokenize('age >= 21 AND name = "Alice"');
 * // [Text("age"), GreaterEquals(">="), Text("21"), And("AND"),
 * //  Text("name"), Equals("="), String("Alice"), EOF]
 * ```
 */
declare function tokenize(input: string): Token[];
/**
 * Tokenize in tolerant mode: collect errors instead of throwing.
 *
 * @param input - The raw filter expression string.
 * @param options - Must include `tolerant: true`.
 * @returns A {@link TokenizeResult} with the token stream and any errors.
 */
declare function tokenize(input: string, options: {
  tolerant: true;
}): TokenizeResult;
//#endregion
//#region src/parser.d.ts
interface NodeBase {
  span: Span;
}
/**
 * Resolves to {@link ErrorNode} when `T` is `true`, or `never` when `false`.
 *
 * Used throughout the CST interfaces so that strict-mode types
 * (`T = false`, the default) never include `ErrorNode` in their unions,
 * while tolerant-mode types (`T = true`) do.
 */
type MaybeError<T extends boolean> = T extends true ? ErrorNode : never;
/** @internal Base for {@link FilterNode}; use `FilterNode` in consumer code. */
interface FilterNodeBase<T extends boolean = false> extends NodeBase {
  type: "Filter";
  /** The top-level expression, or `null` for empty filters. */
  expression: ExpressionNode<T> | MaybeError<T> | null;
}
/**
 * Root node of the concrete syntax tree.
 *
 * Corresponds to the EBNF production `filter = [expression]`.
 * An empty or whitespace-only input produces a `FilterNode` with
 * `expression: null`.
 *
 * In tolerant mode (`FilterNode<true>`), an additional `trailing` field
 * holds an {@link ErrorNode} wrapping any tokens after the expression.
 */
type FilterNode<T extends boolean = false> = FilterNodeBase<T> & (T extends true ? {
  trailing: ErrorNode | null;
} : unknown);
/**
 * A sequence of AND-joined sequences.
 *
 * Corresponds to `expression = sequence {WS AND WS sequence}`.
 */
interface ExpressionNode<T extends boolean = false> extends NodeBase {
  type: "Expression";
  /** One or more sequences joined by explicit `AND`. */
  sequences: SequenceNode<T>[];
}
/**
 * A run of implicitly AND-joined factors (whitespace-separated).
 *
 * Corresponds to `sequence = factor {WS factor}`.
 */
interface SequenceNode<T extends boolean = false> extends NodeBase {
  type: "Sequence";
  /** One or more factors separated by whitespace (implicit AND). */
  factors: FactorNode<T>[];
}
/**
 * A group of OR-joined terms.
 *
 * Corresponds to `factor = term {WS OR WS term}`.
 * OR binds tighter than AND in AIP-160.
 */
interface FactorNode<T extends boolean = false> extends NodeBase {
  type: "Factor";
  /** One or more terms joined by explicit `OR`. */
  terms: TermNode<T>[];
}
/**
 * An optionally negated simple expression.
 *
 * Corresponds to `term = [NOT WS | "-"] simple`.
 */
interface TermNode<T extends boolean = false> extends NodeBase {
  type: "Term";
  /** Whether the term is preceded by `NOT` or `-`. */
  negated: boolean;
  /** The inner expression (restriction or composite). */
  simple: SimpleNode<T> | MaybeError<T>;
}
/** A term's inner expression: a {@link RestrictionNode} or a {@link CompositeNode}. */
type SimpleNode<T extends boolean = false> = RestrictionNode<T> | CompositeNode<T>;
/**
 * A field restriction or bare value (global search).
 *
 * Corresponds to `restriction = comparable [comparator arg]`.
 * When `comparator` and `arg` are `null`, this is a bare value
 * used for global text search.
 */
interface RestrictionNode<T extends boolean = false> extends NodeBase {
  type: "Restriction";
  /** The left-hand side: a field path or function call. */
  comparable: ComparableNode<T>;
  /** The comparison operator, or `null` for bare values (global restrictions). */
  comparator: ComparatorKind | null;
  /**
   * The right-hand side value, or `null` for bare values.
   *
   * In tolerant mode, insertion-based recovery may synthesize a zero-width
   * placeholder {@link MemberNode} (empty `value.token.value`, `span.start === span.end`)
   * when the value is missing (e.g. `a = AND ...`). The corresponding error is
   * recorded in {@link ParseResult.errors}.
   */
  arg: ArgNode<T> | MaybeError<T> | null;
}
/** The left-hand side of a restriction: a {@link MemberNode} or {@link FunctionCallNode}. */
type ComparableNode<T extends boolean = false> = MemberNode | FunctionCallNode<T>;
/**
 * A field path (e.g. `a.b.c`).
 *
 * Corresponds to `member = value {"." field}`.
 */
interface MemberNode extends NodeBase {
  type: "Member";
  /** The leading name segment. */
  value: ValueNode;
  /** Additional dot-separated field segments (may be empty). */
  fields: ValueNode[];
}
/**
 * A function call (e.g. `fn(a, b)` or `math.abs(x)`).
 *
 * Corresponds to `function = name "(" [argList] ")"`.
 * Only produced when `(` is immediately adjacent to the name (no whitespace).
 */
interface FunctionCallNode<T extends boolean = false> extends NodeBase {
  type: "FunctionCall";
  /** The function name segments (e.g. `["math", "abs"]` for `math.abs()`). */
  name: ValueNode[];
  /**
   * The function arguments (may be empty).
   *
   * In tolerant mode, insertion-based recovery may synthesize a zero-width
   * placeholder {@link MemberNode} (empty `value.token.value`, `span.start === span.end`)
   * when an argument is missing (e.g. `fn(a,)`). The corresponding error is
   * recorded in {@link ParseResult.errors}.
   */
  args: (ArgNode<T> | MaybeError<T>)[];
}
/** A function or comparator argument: a {@link ComparableNode} or {@link CompositeNode}. */
type ArgNode<T extends boolean = false> = ComparableNode<T> | CompositeNode<T>;
/**
 * A parenthesized sub-expression (e.g. `(a OR b)`).
 *
 * Corresponds to `composite = "(" expression ")"`.
 */
interface CompositeNode<T extends boolean = false> extends NodeBase {
  type: "Composite";
  /** The enclosed expression. */
  expression: ExpressionNode<T> | MaybeError<T>;
}
/**
 * A leaf text or string literal value.
 *
 * Wraps a single {@link Token} (either `Text` or `String` kind).
 */
interface ValueNode extends NodeBase {
  type: "Value";
  /** The underlying token. */
  token: Token;
}
/**
 * A placeholder node representing invalid syntax that the parser
 * recovered from.
 *
 * Only present in the CST when parsing with `tolerant: true`.
 * Contains the original error and any tokens that were skipped
 * during recovery.
 */
interface ErrorNode extends NodeBase {
  type: "Error";
  /** The error that was recovered from. */
  error: ParserError | LexerError;
  /** Tokens that were skipped during recovery (may be empty). */
  skipped: Token[];
  /** Position where the parser expected something. For editor diagnostics. */
  expectedAt: Span;
}
/**
 * Discriminated union of all concrete syntax tree node types.
 *
 * Use the `type` field to narrow to a specific node interface.
 */
type CSTNode<T extends boolean = false> = FilterNode<T> | ExpressionNode<T> | SequenceNode<T> | FactorNode<T> | TermNode<T> | RestrictionNode<T> | CompositeNode<T> | MemberNode | FunctionCallNode<T> | ValueNode | MaybeError<T>;
/**
 * Options for the {@link parse} function.
 *
 * Controls safety limits that prevent malicious or pathological input
 * from consuming excessive resources.
 */
interface ParseOptions {
  /**
   * Maximum nesting depth for parenthesized expressions.
   * @default 64
   */
  maxDepth?: number;
  /**
   * Maximum allowed input length in characters.
   * @default 8192
   */
  maxLength?: number;
  /**
   * When `true`, collect errors and return a best-effort CST instead of
   * throwing on the first error. The return type changes to {@link ParseResult}.
   * @default false
   */
  tolerant?: boolean;
  /**
   * Maximum number of errors to collect before stopping recovery.
   * Only meaningful when `tolerant` is `true`. Lexer errors count toward
   * this budget. The actual count may slightly exceed this limit when
   * errors occur during stack unwinding.
   * @default 20
   */
  maxErrors?: number;
}
/**
 * Result of parsing with `tolerant: true`.
 *
 * The CST uses `FilterNode<true>` so that {@link ErrorNode} appears in the
 * type unions. Use {@link toCleanTree} to narrow to `FilterNode` (strict)
 * before passing to {@link transform}.
 */
interface ParseResult {
  /** The CST root. Always returned, even when errors were found. */
  cst: FilterNode<true>;
  /** All errors collected during lexing and parsing. Empty on success. */
  errors: (LexerError | ParserError)[];
  /** `true` when no errors were found during lexing or parsing. */
  ok: boolean;
}
/**
 * Parse an AIP-160 filter expression into a concrete syntax tree (CST).
 *
 * The CST preserves source positions (spans) for every node, making it
 * suitable for error reporting and editor tooling.
 *
 * @param input - The raw filter expression string.
 * @param options - Optional parser limits (depth, length).
 * @returns A `FilterNode` root whose `.expression` is `null` for empty input.
 * @throws {@link InputLengthError} if `input` exceeds `maxLength`.
 * @throws {@link DepthLimitError} if nesting exceeds `maxDepth`.
 *
 * @example
 * ```ts
 * const cst = parse('status = "active" AND age >= 21');
 * ```
 */
declare function parse(input: string, options?: ParseOptions & {
  tolerant?: false;
}): FilterNode;
/**
 * Parse in tolerant mode: collect errors instead of throwing.
 *
 * Returns a {@link ParseResult} containing the best-effort CST and all
 * errors found. The CST may contain {@link ErrorNode}s as placeholders
 * for invalid syntax.
 *
 * @param input - The raw filter expression string.
 * @param options - Must include `tolerant: true`.
 * @returns A {@link ParseResult} with the CST and any errors.
 *
 * @example
 * ```ts
 * const { cst, errors, ok } = parse('a AND AND b', { tolerant: true });
 * if (!ok) {
 *   for (const error of errors) console.log(error.description);
 * }
 * ```
 */
declare function parse(input: string, options: ParseOptions & {
  tolerant: true;
}): ParseResult;
/**
 * Walk a CST and return `true` if any node is an {@link ErrorNode}.
 *
 * Useful for checking whether a tolerant parse produced a clean tree
 * before passing it to {@link transform}.
 */
declare function hasErrorNodes(node: CSTNode<true>): boolean;
/**
 * Narrow a tolerant parse result to a strict `FilterNode` if it contains no errors.
 *
 * Returns the narrowed `FilterNode` when the result is error-free,
 * or `null` if it has any errors (including insertion-recovery placeholders
 * that don't appear as {@link ErrorNode}s in the tree). The returned value
 * is safe to pass to {@link transform}.
 *
 * @example
 * ```ts
 * const result = parse(input, { tolerant: true });
 * const clean = toCleanTree(result);
 * if (clean) {
 *   const ast = transform(clean);
 * }
 * ```
 */
declare function toCleanTree(result: ParseResult): FilterNode | null;
//#endregion
//#region src/transform.d.ts
/**
 * The six comparison operators supported by AIP-160.
 *
 * Does not include `:` (has). See {@link Comparator} for the full set.
 */
type ComparisonOperator = "=" | "!=" | "<" | "<=" | ">" | ">=";
/**
 * All AIP-160 comparators: the six {@link ComparisonOperator}s plus the
 * `:` (has) operator for membership/presence checks.
 */
type Comparator = ComparisonOperator | ":";
/**
 * Logical AND of two or more child expressions.
 *
 * Produced from explicit `AND` keywords and from implicit AND
 * (whitespace-separated terms). Nested ANDs are flattened into a single node.
 */
interface AndNode {
  type: "and";
  /** Two or more child expressions, all of which must match. */
  children: ASTNode[];
  /** Source span covering all children. */
  span: Span;
}
/**
 * Logical OR of two or more child expressions.
 *
 * Produced from explicit `OR` keywords. Nested ORs are flattened.
 * OR binds tighter than AND in AIP-160.
 */
interface OrNode {
  type: "or";
  /** Two or more child expressions, at least one of which must match. */
  children: ASTNode[];
  /** Source span covering all children. */
  span: Span;
}
/**
 * Logical negation of a child expression.
 *
 * Produced from the `NOT` keyword or the `-` prefix operator.
 */
interface NotNode {
  type: "not";
  /** The expression to negate. */
  child: ASTNode;
  /** Source span from the `NOT`/`-` through the child. */
  span: Span;
}
/**
 * A field comparison (e.g. `age >= 21`, `name:*`, `fn() = 42`).
 *
 * The left-hand side ({@link comparable}) is a field path or function call.
 * The right-hand side ({@link arg}) is any expression.
 */
interface ASTRestrictionNode {
  type: "restriction";
  /** The left-hand side: a field path or function call. */
  comparable: ASTMemberNode | ASTFunctionNode;
  /** The comparison or has operator. */
  comparator: Comparator;
  /** The right-hand side value or expression. */
  arg: ASTNode;
  /** Source span from the comparable through the arg. */
  span: Span;
}
/**
 * A bare value or field reference used for global text search.
 *
 * Produced when a value appears without a comparator (e.g. `prod` or `"hello"`).
 * During evaluation, the value is searched across all fields (or
 * {@link EvaluateOptions.globalSearchFields} if configured).
 */
interface GlobalNode {
  type: "global";
  /** The search value: a literal, field path, or function call. */
  value: ASTValueNode | ASTMemberNode | ASTFunctionNode;
  /** Source span of the value. */
  span: Span;
}
/**
 * A literal value (text or quoted string).
 *
 * For unquoted text, {@link quoted} is `false` and {@link value} is the raw text.
 * For quoted strings, {@link quoted} is `true` and {@link value} has escape
 * sequences resolved.
 */
interface ASTValueNode {
  type: "value";
  /** The string content (escape sequences already resolved for quoted strings). */
  value: string;
  /** Whether the value was enclosed in quotes in the source. Affects wildcard matching. */
  quoted: boolean;
  /** Source span of the value (including quotes if quoted). */
  span: Span;
}
/**
 * A dotted field path (e.g. `user.address.city`).
 *
 * Each segment is a string in the {@link path} array.
 * Numeric dot-paths (e.g. `2.5`) are collapsed into a single-element
 * {@link ASTValueNode} instead.
 */
interface ASTMemberNode {
  type: "member";
  /** The field path segments (e.g. `["user", "address", "city"]`). */
  path: string[];
  /** Source span from the first segment through the last. */
  span: Span;
}
/**
 * A function call (e.g. `cohort(request.user)` or `math.abs(x)`).
 *
 * Can appear as the left-hand side of a restriction (`fn() = 42`),
 * as a global expression (`fn()`), or as a restriction argument.
 */
interface ASTFunctionNode {
  type: "function";
  /** The function name segments (e.g. `["math", "abs"]`). */
  name: string[];
  /** Pre-joined function name (e.g. `"math.abs"`). Used as the key into {@link EvaluateOptions.functions}. */
  qualifiedName: string;
  /** The function's arguments. */
  args: ASTNode[];
  /** Source span from the name through the closing `)`. */
  span: Span;
}
/**
 * Discriminated union of all abstract syntax tree node types.
 *
 * Use the `type` field to narrow to a specific node interface.
 * Every node is fully JSON-serializable (no functions, classes, or symbols).
 */
type ASTNode = AndNode | OrNode | NotNode | ASTRestrictionNode | GlobalNode | ASTValueNode | ASTMemberNode | ASTFunctionNode;
/**
 * Transform a concrete syntax tree (CST) into a simplified abstract syntax
 * tree (AST) suitable for evaluation.
 *
 * Flattens nested AND/OR chains, converts CST member nodes into path arrays,
 * and collapses numeric dot-paths (e.g. `-3.14`) into single values.
 *
 * @param filter - The CST root returned by {@link parse}.
 * @returns The AST root, or `null` if the filter expression was empty.
 *
 * @example
 * ```ts
 * const ast = transform(parse('a = 1 AND b = 2'));
 * // { type: "and", children: [ ...two restriction nodes ] }
 * ```
 */
declare function transform(filter: FilterNode): ASTNode | null;
//#endregion
//#region src/evaluate.d.ts
/**
 * Options for the {@link evaluate} function.
 *
 * Controls custom function resolution, field search behavior,
 * wildcard semantics, and traversal limits.
 */
interface EvaluateOptions {
  /**
   * Custom function implementations. Key is the dot-joined function name
   * (e.g. `"math.mem"`). Called with resolved argument values.
   */
  functions?: Record<string, (...args: unknown[]) => unknown>;
  /**
   * How to handle calls to functions not in the `functions` registry.
   * @default "throw"
   */
  unknownFunction?: "throw" | "false";
  /**
   * Fields to search for global (bare value) restrictions.
   * Only these top-level fields are checked (flat lookup, not recursive).
   * If not provided, all nested string/number values are searched recursively.
   */
  globalSearchFields?: string[];
  /**
   * When `true`, dotted paths on the RHS of comparisons (e.g. `a = b.c`)
   * resolve against the target object. When `false`, they are treated as
   * literal strings. The AIP-160 spec says RHS only accepts literals;
   * enable this for field-to-field comparisons.
   * @default false
   */
  resolveRhsMembers?: boolean;
  /**
   * When `true`, the `!=` operator supports wildcard patterns (e.g. `"*.foo"`)
   * just like `=`. When `false`, `!=` uses strict equality.
   * The AIP-160 spec only defines wildcards for `=`.
   * @default false
   */
  wildcardNotEquals?: boolean;
  /**
   * Maximum recursion depth for object traversal in global searches
   * and has-operator array fanout.
   * @default 32
   */
  maxTraversalDepth?: number;
}
/**
 * Evaluate a compiled AST against a target object.
 *
 * @param node - The AST root returned by {@link transform}, or `null` (always returns `true`).
 * @param target - The object to evaluate the filter against.
 * @param options - Evaluation options (custom functions, search fields, etc.).
 * @returns `true` if the target matches the filter.
 * @throws {@link UnknownFunctionError} if a function call is unresolved and `unknownFunction` is `"throw"`.
 *
 * @example
 * ```ts
 * const ast = transform(parse('age >= 21'));
 * evaluate(ast, { age: 25 }); // true
 * evaluate(ast, { age: 18 }); // false
 * ```
 */
declare function evaluate(node: ASTNode | null, target: Record<string, unknown>, options?: EvaluateOptions): boolean;
//#endregion
//#region src/evaluate-async.d.ts
type MaybePromise<T> = T | Promise<T>;
/**
 * Options for {@link evaluateAsync}.
 *
 * Identical to {@link EvaluateOptions} except that `functions` may return
 * promises. All other options behave the same as in the sync evaluator.
 */
interface AsyncEvaluateOptions extends Omit<EvaluateOptions, "functions"> {
  /** Custom function implementations. May return promises.
   *  Key is the dot-joined function name (e.g. "math.mem"). */
  functions?: Record<string, (...args: unknown[]) => MaybePromise<unknown>>;
}
/**
 * Async variant of {@link evaluate} that supports async custom functions.
 *
 * AND/OR evaluation is sequential with short-circuit semantics: if the
 * first child of an AND is `false`, subsequent children are not evaluated.
 *
 * @param node - The AST root, or `null` (always resolves to `true`).
 * @param target - The object to evaluate the filter against.
 * @param options - Evaluation options; `functions` may return promises.
 * @returns A promise resolving to `true` if the target matches.
 * @throws {@link UnknownFunctionError} if a function call is unresolved and `unknownFunction` is `"throw"`.
 *
 * @example
 * ```ts
 * const ast = transform(parse('authorized()'));
 * await evaluateAsync(ast, request, {
 *   functions: { authorized: async () => checkAuth(request) },
 * });
 * ```
 */
declare function evaluateAsync(node: ASTNode | null, target: Record<string, unknown>, options?: AsyncEvaluateOptions): Promise<boolean>;
//#endregion
//#region src/filter.d.ts
/**
 * Combined parse and evaluation options for the {@link filter} and
 * {@link compile} convenience functions.
 *
 * Extends {@link EvaluateOptions} with the parser limits from
 * {@link ParseOptions}.
 */
interface FilterOptions extends EvaluateOptions {
  /**
   * Maximum nesting depth for parenthesized expressions.
   * @default 64
   */
  maxDepth?: number;
  /**
   * Maximum allowed input length in characters.
   * @default 8192
   */
  maxLength?: number;
}
/**
 * Async variant of {@link FilterOptions}.
 *
 * Identical except that `functions` may return promises.
 */
interface AsyncFilterOptions extends Omit<FilterOptions, "functions"> {
  /** Custom function implementations. May return promises. */
  functions?: AsyncEvaluateOptions["functions"];
}
/**
 * JSON-serializable representation of a compiled filter, produced by
 * {@link CompiledFilter.toSerialized} and consumed by {@link CompiledFilter.fromSerialized}.
 *
 * Safe to persist to a database, send over the network, or store in a cache.
 * Contains the original expression (for debugging) and the pre-compiled AST
 * (for evaluation without re-parsing).
 */
interface SerializedFilter {
  /** Format version for forward compatibility. */
  v: 1;
  /** The original filter expression string. */
  expression: string;
  /** The compiled AST. */
  ast: ASTNode | null;
}
/**
 * Parse and evaluate an AIP-160 filter expression in one shot.
 *
 * For repeated evaluation of the same expression, use {@link compile} instead
 * to avoid re-parsing on every call.
 *
 * @param expression - The AIP-160 filter string (e.g. `'age >= 21'`).
 * @param target - The object to test against the filter.
 * @param options - Parser and evaluation options.
 * @returns `true` if the target matches the filter.
 * @throws {@link InputLengthError} if the expression exceeds `maxLength`.
 * @throws {@link DepthLimitError} if nesting exceeds `maxDepth`.
 * @throws {@link UnknownFunctionError} if a function call is unresolved and `unknownFunction` is `"throw"`.
 *
 * @example
 * ```ts
 * filter('status = "active"', { status: "active", name: "Alice" }); // true
 * ```
 */
declare function filter(expression: string, target: Record<string, unknown>, options?: FilterOptions): boolean;
/**
 * Async variant of {@link filter} that supports async custom functions.
 *
 * @param expression - The AIP-160 filter string.
 * @param target - The object to test against the filter.
 * @param options - Parser and evaluation options; `functions` may return promises.
 * @returns A promise resolving to `true` if the target matches.
 * @throws {@link InputLengthError} if the expression exceeds `maxLength`.
 * @throws {@link DepthLimitError} if nesting exceeds `maxDepth`.
 * @throws {@link UnknownFunctionError} if a function call is unresolved and `unknownFunction` is `"throw"`.
 *
 * @example
 * ```ts
 * await filterAsync('check()', data, {
 *   functions: { check: async () => fetchFlag('enabled') },
 * });
 * ```
 */
declare function filterAsync(expression: string, target: Record<string, unknown>, options?: AsyncFilterOptions): Promise<boolean>;
/**
 * Compile an AIP-160 filter expression for repeated evaluation.
 *
 * Parses and transforms the expression once. The returned
 * {@link CompiledFilter} can then be evaluated against many targets without
 * re-parsing.
 *
 * @param expression - The AIP-160 filter string.
 * @param options - Parser and evaluation options baked into the compiled filter.
 * @returns A reusable compiled filter instance.
 * @throws {@link InputLengthError} if the expression exceeds `maxLength`.
 * @throws {@link DepthLimitError} if nesting exceeds `maxDepth`.
 *
 * @example
 * ```ts
 * const f = compile('age >= 21 AND status = "active"');
 * f.evaluate({ age: 25, status: "active" }); // true
 * f.evaluate({ age: 18, status: "active" }); // false
 * ```
 */
declare function compile(expression: string, options?: FilterOptions): CompiledFilter;
/**
 * A pre-compiled AIP-160 filter that can be evaluated against many targets
 * without re-parsing. Create via {@link compile} or {@link CompiledFilter.fromSerialized}.
 */
declare class CompiledFilter {
  /** The original filter expression string. */
  readonly expression: string;
  /** The compiled AST, or `null` for empty filters. */
  readonly ast: ASTNode | null;
  private readonly options?;
  /** @internal Use {@link compile} or {@link CompiledFilter.fromSerialized} to create instances. */
  constructor(/** The original filter expression string. */

  expression: string, /** The compiled AST, or `null` for empty filters. */

  ast: ASTNode | null, options?: EvaluateOptions | undefined);
  /**
   * Evaluate this filter against a target object.
   *
   * @param target - The object to test against the filter.
   * @returns `true` if the target matches the filter.
   * @throws {@link UnknownFunctionError} if a function call is unresolved and `unknownFunction` is `"throw"`.
   */
  evaluate(target: Record<string, unknown>): boolean;
  /**
   * Async variant of {@link evaluate} that supports async custom functions.
   *
   * @param target - The object to test against the filter.
   * @param functions - Optional async function overrides. Merged with any
   *   functions bound at compile time, with these taking precedence.
   * @returns A promise resolving to `true` if the target matches.
   * @throws {@link UnknownFunctionError} if a function call is unresolved and `unknownFunction` is `"throw"`.
   *
   * @example
   * ```ts
   * const f = compile('authorized(resource)');
   * await f.evaluateAsync(request, {
   *   authorized: async (r) => checkPermission(r),
   * });
   * ```
   */
  evaluateAsync(target: Record<string, unknown>, functions?: AsyncFilterOptions["functions"]): Promise<boolean>;
  /**
   * Serialize this filter to a JSON-safe object for storage or transfer.
   *
   * @returns A plain object safe to pass to `JSON.stringify`.
   *
   * @example
   * ```ts
   * const json = JSON.stringify(compile('age >= 21').toSerialized());
   * ```
   */
  toSerialized(): SerializedFilter;
  /**
   * Deserialize and validate a previously serialized filter.
   *
   * The entire structure is validated before returning. Malformed input
   * from an untrusted source will throw rather than cause runtime errors
   * during evaluation.
   *
   * @param data - The serialized filter object (e.g. from `JSON.parse`).
   * @param options - Evaluation options to bind to the restored filter.
   * @returns A compiled filter ready for evaluation.
   * @throws {@link UnsupportedVersionError} if the version field is unrecognized.
   * @throws {@link UnknownNodeTypeError} if the AST contains invalid node types.
   * @throws {@link InvalidFieldTypeError} if any field has the wrong type.
   *
   * @example
   * ```ts
   * const json = '{"v":1,"expression":"age >= 21","ast":{...}}';
   * const f = CompiledFilter.fromSerialized(JSON.parse(json));
   * f.evaluate({ age: 25 }); // true
   * ```
   */
  static fromSerialized(data: SerializedFilter, options?: EvaluateOptions): CompiledFilter;
}
//#endregion
export { type ASTFunctionNode, type ASTMemberNode, type ASTNode, type ASTRestrictionNode, type ASTValueNode, type AndNode, type ArgNode, type AsyncEvaluateOptions, type AsyncFilterOptions, type CSTNode, type ComparableNode, type Comparator, type ComparatorKind, type ComparisonOperator, CompiledFilter, type CompositeNode, DepthLimitError, EmptyExpressionError, type ErrorNode, EvaluateError, type EvaluateOptions, ExpectedExpressionError, ExpectedIdentifierError, ExpectedValueError, type ExpressionNode, type FactorNode, FilterError, type FilterNode, type FilterOptions, type FunctionCallNode, type GlobalNode, InputLengthError, InvalidFieldTypeError, InvalidFunctionNameError, InvalidNegationError, InvariantError, LexerError, type MaybeError, type MemberNode, type NotNode, type OrNode, type ParseOptions, type ParseResult, ParserError, type RestrictionNode, type SequenceNode, type SerializedFilter, type SimpleNode, type Span, type TermNode, type Token, TokenKind, type TokenizeResult, UnclosedDelimiterError, UnexpectedCharacterError, UnexpectedTokenError, UnknownFunctionError, UnknownNodeTypeError, UnsupportedVersionError, UnterminatedStringError, type ValueNode, compile, evaluate, evaluateAsync, filter, filterAsync, hasErrorNodes, isComparatorKind, parse, toCleanTree, tokenize, transform };