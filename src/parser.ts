import type { ComparatorKind, Span, Token } from "./types";
import { TokenKind, isComparatorKind } from "./types";
import { tokenize } from "./lexer";
import {
  DepthLimitError,
  EmptyExpressionError,
  ExpectedExpressionError,
  ExpectedIdentifierError,
  ExpectedValueError,
  InputLengthError,
  InvalidFunctionNameError,
  InvalidNegationError,
  UnclosedDelimiterError,
  UnexpectedTokenError,
  invariant,
} from "./errors";

interface NodeBase {
  span: Span;
}

/**
 * Root node of the concrete syntax tree.
 *
 * Corresponds to the EBNF production `filter = [expression]`.
 * An empty or whitespace-only input produces a `FilterNode` with
 * `expression: null`.
 */
export interface FilterNode extends NodeBase {
  type: "Filter";
  /** The top-level expression, or `null` for empty filters. */
  expression: ExpressionNode | null;
}

/**
 * A sequence of AND-joined sequences.
 *
 * Corresponds to `expression = sequence {WS AND WS sequence}`.
 */
export interface ExpressionNode extends NodeBase {
  type: "Expression";
  /** One or more sequences joined by explicit `AND`. */
  sequences: SequenceNode[];
}

/**
 * A run of implicitly AND-joined factors (whitespace-separated).
 *
 * Corresponds to `sequence = factor {WS factor}`.
 */
export interface SequenceNode extends NodeBase {
  type: "Sequence";
  /** One or more factors separated by whitespace (implicit AND). */
  factors: FactorNode[];
}

/**
 * A group of OR-joined terms.
 *
 * Corresponds to `factor = term {WS OR WS term}`.
 * OR binds tighter than AND in AIP-160.
 */
export interface FactorNode extends NodeBase {
  type: "Factor";
  /** One or more terms joined by explicit `OR`. */
  terms: TermNode[];
}

/**
 * An optionally negated simple expression.
 *
 * Corresponds to `term = [NOT WS | "-"] simple`.
 */
export interface TermNode extends NodeBase {
  type: "Term";
  /** Whether the term is preceded by `NOT` or `-`. */
  negated: boolean;
  /** The inner expression (restriction or composite). */
  simple: SimpleNode;
}

/** A term's inner expression: a {@link RestrictionNode} or a {@link CompositeNode}. */
export type SimpleNode = RestrictionNode | CompositeNode;

/**
 * A field restriction or bare value (global search).
 *
 * Corresponds to `restriction = comparable [comparator arg]`.
 * When `comparator` and `arg` are `null`, this is a bare value
 * used for global text search.
 */
export interface RestrictionNode extends NodeBase {
  type: "Restriction";
  /** The left-hand side: a field path or function call. */
  comparable: ComparableNode;
  /** The comparison operator, or `null` for bare values (global restrictions). */
  comparator: ComparatorKind | null;
  /** The right-hand side value, or `null` for bare values. */
  arg: ArgNode | null;
}

/** The left-hand side of a restriction: a {@link MemberNode} or {@link FunctionCallNode}. */
export type ComparableNode = MemberNode | FunctionCallNode;

/**
 * A field path (e.g. `a.b.c`).
 *
 * Corresponds to `member = value {"." field}`.
 */
export interface MemberNode extends NodeBase {
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
export interface FunctionCallNode extends NodeBase {
  type: "FunctionCall";
  /** The function name segments (e.g. `["math", "abs"]` for `math.abs()`). */
  name: ValueNode[];
  /** The function arguments (may be empty). */
  args: ArgNode[];
}

/** A function or comparator argument: a {@link ComparableNode} or {@link CompositeNode}. */
export type ArgNode = ComparableNode | CompositeNode;

/**
 * A parenthesized sub-expression (e.g. `(a OR b)`).
 *
 * Corresponds to `composite = "(" expression ")"`.
 */
export interface CompositeNode extends NodeBase {
  type: "Composite";
  /** The enclosed expression. */
  expression: ExpressionNode;
}

/**
 * A leaf text or string literal value.
 *
 * Wraps a single {@link Token} (either `Text` or `String` kind).
 */
export interface ValueNode extends NodeBase {
  type: "Value";
  /** The underlying token. */
  token: Token;
}

/**
 * Discriminated union of all concrete syntax tree node types.
 *
 * Use the `type` field to narrow to a specific node interface.
 */
export type CSTNode =
  | FilterNode
  | ExpressionNode
  | SequenceNode
  | FactorNode
  | TermNode
  | RestrictionNode
  | CompositeNode
  | MemberNode
  | FunctionCallNode
  | ValueNode;

export type { ComparatorKind };

const KEYWORDS = new Set([TokenKind.And, TokenKind.Or, TokenKind.Not]);

// Precedence (loosest -> tightest):
//
//   Expression  =  Sequence { AND Sequence }     <- explicit AND (loosest)
//   Sequence    =  Factor { Factor }              <- implicit AND (juxtaposition)
//   Factor      =  Term { OR Term }               <- OR
//   Term        =  [NOT | -] Simple               <- negation (tightest)
//
// This means implicit AND (whitespace) binds tighter than OR, and explicit
// AND binds the loosest. For example:
//
//   a OR b c AND d OR e
//   -> (a OR (b c)) AND (d OR e)
//   -> (a OR (b AND c)) AND (d OR e)

class Parser {
  private pos = 0;
  private depth = 0;

  public constructor(
    private readonly tokens: Token[],
    private readonly source: string,
    private readonly maxDepth: number,
  ) {}

  public parse(): FilterNode {
    if (this.at(TokenKind.EOF)) {
      const span = this.peek();
      return { type: "Filter", expression: null, span: { start: span.start, end: span.end } };
    }
    const expression = this.parseExpression();
    if (!this.at(TokenKind.EOF)) {
      throw new UnexpectedTokenError(this.peek(), this.source);
    }
    return { type: "Filter", expression, span: expression.span };
  }

  // Expression: sequence {AND sequence}

  private parseExpression(): ExpressionNode {
    const first = this.parseSequence();
    let last = first;
    const sequences: SequenceNode[] = [first];

    while (this.at(TokenKind.And)) {
      const andToken = this.advance();
      this.expectExpressionAfter(andToken);
      last = this.parseSequence();
      sequences.push(last);
    }

    return {
      type: "Expression",
      sequences,
      span: this.spanFromTo(first.span, last.span),
    };
  }

  // Sequence: factor {factor}

  private parseSequence(): SequenceNode {
    const first = this.parseFactor();
    let last = first;
    const factors: FactorNode[] = [first];

    while (this.canStartFactor()) {
      last = this.parseFactor();
      factors.push(last);
    }

    return {
      type: "Sequence",
      factors,
      span: this.spanFromTo(first.span, last.span),
    };
  }

  // Factor: term {OR term}

  private parseFactor(): FactorNode {
    const first = this.parseTerm();
    let last = first;
    const terms: TermNode[] = [first];

    while (this.at(TokenKind.Or)) {
      const orToken = this.advance();
      this.expectExpressionAfter(orToken);
      last = this.parseTerm();
      terms.push(last);
    }

    return {
      type: "Factor",
      terms,
      span: this.spanFromTo(first.span, last.span),
    };
  }

  // Term: [NOT | -] simple

  private parseTerm(): TermNode {
    const kind = this.peek().kind;
    if (kind === TokenKind.Not || kind === TokenKind.Minus) {
      const negToken = this.advance();
      if (!this.canStartSimple()) {
        throw new ExpectedExpressionError(negToken, this.peek(), this.source);
      }
      const simple = this.parseSimple();
      return { type: "Term", negated: true, simple, span: this.spanFromTo(negToken, simple.span) };
    }

    const simple = this.parseSimple();
    return { type: "Term", negated: false, simple, span: simple.span };
  }

  // Simple: restriction | composite

  private parseSimple(): SimpleNode {
    if (this.at(TokenKind.LParen)) {
      return this.parseComposite();
    }
    return this.parseRestriction();
  }

  // Composite: ( expression )

  private parseComposite(): CompositeNode {
    if (this.depth + 1 > this.maxDepth) {
      throw new DepthLimitError(this.maxDepth, this.peek(), this.source);
    }
    this.depth++;

    const lparen = this.advance();

    if (this.at(TokenKind.RParen)) {
      this.depth--;
      throw new EmptyExpressionError(this.peek(), this.source);
    }

    const expression = this.parseExpression();

    if (!this.at(TokenKind.RParen)) {
      throw new UnclosedDelimiterError("parenthesis", this.peek(), this.source, lparen.start);
    }

    const rparen = this.advance();
    this.depth--;
    return { type: "Composite", expression, span: { start: lparen.start, end: rparen.end } };
  }

  // Restriction: comparable [comparator arg]

  private parseRestriction(): RestrictionNode {
    const comparable = this.parseComparable();

    const comparator = this.comparatorKind();
    if (comparator != null) {
      const comparatorToken = this.advance();
      const arg = this.parseArg(comparatorToken);
      return {
        type: "Restriction",
        comparable,
        comparator,
        arg,
        span: this.spanFromTo(comparable.span, arg.span),
      };
    }

    return { type: "Restriction", comparable, comparator: null, arg: null, span: comparable.span };
  }

  // Comparable: member | function

  private parseComparable(): ComparableNode {
    const head = this.parseValue();

    if (this.peek().kind !== TokenKind.Dot) {
      const next = this.peek();
      if (next.kind === TokenKind.LParen && next.start === head.span.end) {
        return this.parseFunctionCall(head, []);
      }
      return { type: "Member", value: head, fields: [], span: head.span };
    }

    const fields: ValueNode[] = [];
    while (true) {
      const dot = this.eat(TokenKind.Dot);
      if (!dot) break;
      fields.push(this.parseField(dot));
    }

    const lastField = fields[fields.length - 1];
    invariant(lastField !== undefined, "Expected at least one field after dot");

    const lparen = this.peek();
    if (lparen.kind === TokenKind.LParen) {
      if (lparen.start === lastField.span.end) {
        return this.parseFunctionCall(head, fields);
      }
    }

    const lastSpan = lastField.span;
    return { type: "Member", value: head, fields, span: this.spanFromTo(head.span, lastSpan) };
  }

  // FunctionCall: name "(" [argList] ")"

  private parseFunctionCall(head: ValueNode, nameParts: ValueNode[]): FunctionCallNode {
    // EBNF: function uses `name` not `field`: name : TEXT | keyword (no STRING)
    for (const part of [head, ...nameParts]) {
      if (part.token.kind === TokenKind.String) {
        throw new InvalidFunctionNameError(part.token, this.source);
      }
    }
    const lparen = this.advance();
    let args: ArgNode[] = [];
    if (!this.at(TokenKind.RParen)) {
      args = this.parseArgList(lparen);
    }

    if (!this.at(TokenKind.RParen)) {
      throw new UnclosedDelimiterError("functionCall", this.peek(), this.source);
    }

    const rparen = this.advance();
    return {
      type: "FunctionCall",
      name: [head, ...nameParts],
      args,
      span: { start: head.span.start, end: rparen.end },
    };
  }

  // Arg: comparable | composite

  private parseArg(after: Token): ArgNode {
    switch (this.peek().kind) {
      case TokenKind.LParen:
        return this.parseComposite();
      case TokenKind.Text:
      case TokenKind.String:
        return this.parseComparable();
      case TokenKind.Minus:
        return this.parseNegativeValue();
      default:
        throw new ExpectedValueError(after, this.peek(), this.source);
    }
  }

  // ArgList: arg {"," arg}

  private parseArgList(lparen: Token): ArgNode[] {
    const args: ArgNode[] = [this.parseArg(lparen)];

    while (true) {
      const comma = this.eat(TokenKind.Comma);
      if (!comma) break;
      if (
        !this.at(TokenKind.Text) &&
        !this.at(TokenKind.String) &&
        !this.at(TokenKind.LParen) &&
        !this.at(TokenKind.Minus)
      ) {
        throw new ExpectedValueError(comma, this.peek(), this.source);
      }
      args.push(this.parseArg(comma));
    }

    return args;
  }

  // NegativeValue: "-" comparable

  private parseNegativeValue(): MemberNode {
    const minusToken = this.advance();
    if (!this.at(TokenKind.Text) && !this.at(TokenKind.String)) {
      throw new ExpectedValueError(minusToken, this.peek(), this.source);
    }
    const comparable = this.parseComparable();
    if (comparable.type !== "Member") {
      throw new InvalidNegationError("function", minusToken, this.source);
    }
    // For dotted paths, only allow if the result forms a valid number (e.g. -3.14)
    if (comparable.fields.length > 0) {
      const joined =
        "-" +
        [comparable.value.token.value, ...comparable.fields.map((f) => f.token.value)].join(".");
      if (Number.isNaN(Number(joined))) {
        throw new InvalidNegationError("fieldPath", minusToken, this.source);
      }
    }
    const oldToken = comparable.value.token;
    const syntheticToken: Token = {
      kind: oldToken.kind,
      value: "-" + oldToken.value,
      start: minusToken.start,
      end: oldToken.end,
    };
    const syntheticValue: ValueNode = {
      type: "Value",
      token: syntheticToken,
      span: { start: minusToken.start, end: oldToken.end },
    };
    return {
      type: "Member",
      value: syntheticValue,
      fields: comparable.fields,
      span: { start: minusToken.start, end: comparable.span.end },
    };
  }

  // Value: TEXT | STRING

  private parseValue(): ValueNode {
    if (this.at(TokenKind.Text) || this.at(TokenKind.String)) {
      const token = this.advance();
      return { type: "Value", token, span: { start: token.start, end: token.end } };
    }

    throw new ExpectedIdentifierError(this.peek(), this.source);
  }

  // Field: value | keyword (after a dot)

  private parseField(dot: Token): ValueNode {
    if (this.at(TokenKind.Text) || this.at(TokenKind.String) || KEYWORDS.has(this.peek().kind)) {
      const token = this.advance();
      return { type: "Value", token, span: { start: token.start, end: token.end } };
    }

    throw new ExpectedValueError(dot, this.peek(), this.source);
  }

  private peek(): Token {
    const token = this.tokens[this.pos];
    invariant(token !== undefined, "Unexpected end of token stream");
    return token;
  }

  private advance(): Token {
    const token = this.peek();
    if (token.kind !== TokenKind.EOF) {
      this.pos++;
    }
    return token;
  }

  private at(kind: TokenKind): boolean {
    return this.peek().kind === kind;
  }

  private eat(kind: TokenKind): Token | null {
    if (this.at(kind)) {
      return this.advance();
    }
    return null;
  }

  private expectExpressionAfter(operator: Token): void {
    if (this.canStartSimple() || this.at(TokenKind.Not) || this.at(TokenKind.Minus)) return;
    throw new ExpectedExpressionError(operator, this.peek(), this.source);
  }

  private canStartSimple(): boolean {
    const kind = this.peek().kind;
    return kind === TokenKind.Text || kind === TokenKind.String || kind === TokenKind.LParen;
  }

  private canStartFactor(): boolean {
    const kind = this.peek().kind;
    return (
      kind === TokenKind.Text ||
      kind === TokenKind.String ||
      kind === TokenKind.Not ||
      kind === TokenKind.Minus ||
      kind === TokenKind.LParen
    );
  }

  private comparatorKind(): ComparatorKind | null {
    const kind = this.peek().kind;
    return isComparatorKind(kind) ? kind : null;
  }

  private spanFromTo(start: Span, end: Span): Span {
    return { start: start.start, end: end.end };
  }
}

/**
 * Options for the {@link parse} function.
 *
 * Controls safety limits that prevent malicious or pathological input
 * from consuming excessive resources.
 */
export interface ParseOptions {
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
export function parse(input: string, options?: ParseOptions): FilterNode {
  const maxLength = options?.maxLength ?? 8192;
  if (input.length > maxLength) {
    throw new InputLengthError(maxLength, { start: maxLength, end: input.length }, input);
  }
  const tokens = tokenize(input);
  return new Parser(tokens, input, options?.maxDepth ?? 64).parse();
}
