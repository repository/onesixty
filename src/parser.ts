import type { ComparatorKind, Span, Token } from "./types";
import { TokenKind, isComparatorKind } from "./types";
import { tokenize } from "./lexer";
import type { LexerError, ParserError } from "./errors";
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
 * Resolves to {@link ErrorNode} when `T` is `true`, or `never` when `false`.
 *
 * Used throughout the CST interfaces so that strict-mode types
 * (`T = false`, the default) never include `ErrorNode` in their unions,
 * while tolerant-mode types (`T = true`) do.
 */
export type MaybeError<T extends boolean> = T extends true ? ErrorNode : never;

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
export type FilterNode<T extends boolean = false> = FilterNodeBase<T> &
  (T extends true
    ? { /** Tokens after the expression that could not be parsed. */ trailing: ErrorNode | null }
    : unknown);

/**
 * A sequence of AND-joined sequences.
 *
 * Corresponds to `expression = sequence {WS AND WS sequence}`.
 */
export interface ExpressionNode<T extends boolean = false> extends NodeBase {
  type: "Expression";
  /** One or more sequences joined by explicit `AND`. */
  sequences: SequenceNode<T>[];
}

/**
 * A run of implicitly AND-joined factors (whitespace-separated).
 *
 * Corresponds to `sequence = factor {WS factor}`.
 */
export interface SequenceNode<T extends boolean = false> extends NodeBase {
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
export interface FactorNode<T extends boolean = false> extends NodeBase {
  type: "Factor";
  /** One or more terms joined by explicit `OR`. */
  terms: TermNode<T>[];
}

/**
 * An optionally negated simple expression.
 *
 * Corresponds to `term = [NOT WS | "-"] simple`.
 */
export interface TermNode<T extends boolean = false> extends NodeBase {
  type: "Term";
  /** Whether the term is preceded by `NOT` or `-`. */
  negated: boolean;
  /** The inner expression (restriction or composite). */
  simple: SimpleNode<T> | MaybeError<T>;
}

/** A term's inner expression: a {@link RestrictionNode} or a {@link CompositeNode}. */
export type SimpleNode<T extends boolean = false> = RestrictionNode<T> | CompositeNode<T>;

/**
 * A field restriction or bare value (global search).
 *
 * Corresponds to `restriction = comparable [comparator arg]`.
 * When `comparator` and `arg` are `null`, this is a bare value
 * used for global text search.
 */
export interface RestrictionNode<T extends boolean = false> extends NodeBase {
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
export type ComparableNode<T extends boolean = false> = MemberNode | FunctionCallNode<T>;

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
export interface FunctionCallNode<T extends boolean = false> extends NodeBase {
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
export type ArgNode<T extends boolean = false> = ComparableNode<T> | CompositeNode<T>;

/**
 * A parenthesized sub-expression (e.g. `(a OR b)`).
 *
 * Corresponds to `composite = "(" expression ")"`.
 */
export interface CompositeNode<T extends boolean = false> extends NodeBase {
  type: "Composite";
  /** The enclosed expression. */
  expression: ExpressionNode<T> | MaybeError<T>;
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
 * A placeholder node representing invalid syntax that the parser
 * recovered from.
 *
 * Only present in the CST when parsing with `tolerant: true`.
 * Contains the original error and any tokens that were skipped
 * during recovery.
 */
export interface ErrorNode extends NodeBase {
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
export type CSTNode<T extends boolean = false> =
  | FilterNode<T>
  | ExpressionNode<T>
  | SequenceNode<T>
  | FactorNode<T>
  | TermNode<T>
  | RestrictionNode<T>
  | CompositeNode<T>
  | MemberNode
  | FunctionCallNode<T>
  | ValueNode
  | MaybeError<T>;

export type { ComparatorKind };

const KEYWORDS = new Set([TokenKind.And, TokenKind.Or, TokenKind.Not]);

// Synchronization sets for error recovery.
// SYNC_EXPRESSION includes comparators so partial restrictions like `= 1` aren't
// entirely skipped when the comparable fails - this preserves more structure for
// syntax highlighting.
const SYNC_EXPRESSION = new Set([
  TokenKind.And,
  TokenKind.Or,
  TokenKind.RParen,
  TokenKind.EOF,
  TokenKind.Equals,
  TokenKind.NotEquals,
  TokenKind.LessThan,
  TokenKind.LessEquals,
  TokenKind.GreaterThan,
  TokenKind.GreaterEquals,
  TokenKind.Has,
]);
const SYNC_ARG = new Set([
  TokenKind.Comma,
  TokenKind.RParen,
  TokenKind.And,
  TokenKind.Or,
  TokenKind.EOF,
]);

// Precedence (loosest -> tightest):
//
//   Expression  =  Sequence { AND Sequence }      <- explicit AND (loosest)
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
  private hitErrorLimit = false;
  public readonly errors: (ParserError | LexerError)[] = [];
  public trailing: ErrorNode | null = null;

  public constructor(
    private readonly tokens: Token[],
    private readonly source: string,
    private readonly maxDepth: number,
    private readonly tolerant: boolean,
    private readonly maxErrors: number,
  ) {
    const last = tokens[tokens.length - 1];
    invariant(last !== undefined && last.kind === TokenKind.EOF, "Token stream must end with EOF");
  }

  private shouldRecover(error: ParserError): true {
    if (!this.tolerant) throw error;
    this.errors.push(error);
    if (this.errors.length >= this.maxErrors) {
      this.hitErrorLimit = true;
    }
    return true;
  }

  private recover(error: ParserError, syncSet: Set<TokenKind>): ErrorNode {
    this.shouldRecover(error);
    const start = this.peek();
    const skipped: Token[] = [];
    while (!this.at(TokenKind.EOF) && !syncSet.has(this.peek().kind)) {
      skipped.push(this.advance());
    }
    const last = skipped[skipped.length - 1];
    const expectedAt: Span = { start: start.start, end: start.end };
    return {
      type: "Error",
      error,
      skipped,
      expectedAt,
      span: { start: start.start, end: last ? last.end : start.start },
    };
  }

  private recoverEmpty(error: ParserError, at: Token): ErrorNode {
    this.shouldRecover(error);
    const expectedAt: Span = { start: at.start, end: at.start };
    return {
      type: "Error",
      error,
      skipped: [],
      expectedAt,
      span: { start: at.start, end: at.start },
    };
  }

  private synthesizeMember(position: number): MemberNode {
    const placeholder: ValueNode = {
      type: "Value",
      token: { kind: TokenKind.Text, value: "", start: position, end: position },
      span: { start: position, end: position },
    };
    return { type: "Member", value: placeholder, fields: [], span: placeholder.span };
  }

  public parse(): FilterNodeBase<true> {
    if (this.at(TokenKind.EOF)) {
      const span = this.peek();
      return { type: "Filter", expression: null, span: { start: span.start, end: span.end } };
    }
    const expression = this.parseExpression();
    if (!this.at(TokenKind.EOF) && !this.hitErrorLimit) {
      const error = new UnexpectedTokenError(this.peek(), this.source);
      this.shouldRecover(error);
      const start = this.peek();
      const skipped: Token[] = [];
      while (!this.at(TokenKind.EOF)) {
        skipped.push(this.advance());
      }
      const last = skipped[skipped.length - 1];
      this.trailing = {
        type: "Error",
        error,
        skipped,
        expectedAt: { start: start.start, end: start.end },
        span: { start: start.start, end: last ? last.end : start.start },
      };
    }
    return { type: "Filter", expression, span: expression.span };
  }

  // Expression: sequence {AND sequence}

  private parseExpression(): ExpressionNode<true> {
    const first = this.parseSequence();
    let last: SequenceNode<true> = first;
    const sequences: SequenceNode<true>[] = [first];

    while (this.at(TokenKind.And) && !this.hitErrorLimit) {
      const andToken = this.advance();
      if (!this.canStartExpression()) {
        const errorNode = this.recoverEmpty(
          new ExpectedExpressionError(andToken, this.peek(), this.source),
          this.peek(),
        );
        const term: TermNode<true> = {
          type: "Term",
          negated: false,
          simple: errorNode,
          span: errorNode.span,
        };
        const factor: FactorNode<true> = { type: "Factor", terms: [term], span: errorNode.span };
        const seq: SequenceNode<true> = {
          type: "Sequence",
          factors: [factor],
          span: errorNode.span,
        };
        last = seq;
        sequences.push(last);
        continue;
      }
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

  private parseSequence(): SequenceNode<true> {
    const first = this.parseFactor();
    let last: FactorNode<true> = first;
    const factors: FactorNode<true>[] = [first];

    while (this.canStartFactor() && !this.hitErrorLimit) {
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

  private parseFactor(): FactorNode<true> {
    const first = this.parseTerm();
    let last: TermNode<true> = first;
    const terms: TermNode<true>[] = [first];

    while (this.at(TokenKind.Or) && !this.hitErrorLimit) {
      const orToken = this.advance();
      if (!this.canStartExpression()) {
        const errorNode = this.recoverEmpty(
          new ExpectedExpressionError(orToken, this.peek(), this.source),
          this.peek(),
        );
        const term: TermNode<true> = {
          type: "Term",
          negated: false,
          simple: errorNode,
          span: errorNode.span,
        };
        last = term;
        terms.push(last);
        continue;
      }
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

  private parseTerm(): TermNode<true> {
    const kind = this.peek().kind;
    if (kind === TokenKind.Not || kind === TokenKind.Minus) {
      const negToken = this.advance();
      if (!this.canStartSimple()) {
        const errorNode = this.recoverEmpty(
          new ExpectedExpressionError(negToken, this.peek(), this.source),
          this.peek(),
        );
        return {
          type: "Term",
          negated: true,
          simple: errorNode,
          span: { start: negToken.start, end: negToken.end },
        };
      }
      const simple = this.parseSimple();
      return { type: "Term", negated: true, simple, span: this.spanFromTo(negToken, simple.span) };
    }

    const simple = this.parseSimple();
    return { type: "Term", negated: false, simple, span: simple.span };
  }

  // Simple: restriction | composite

  private parseSimple(): SimpleNode<true> | ErrorNode {
    if (this.at(TokenKind.LParen)) {
      return this.parseComposite();
    }
    return this.parseRestriction();
  }

  // Composite: ( expression )

  private parseComposite(): CompositeNode<true> | ErrorNode {
    if (this.depth + 1 > this.maxDepth) {
      return this.recoverDepthLimit(new DepthLimitError(this.maxDepth, this.peek(), this.source));
    }
    this.depth++;

    const lparen = this.advance();

    if (this.at(TokenKind.RParen)) {
      this.depth--;
      const error = new EmptyExpressionError(this.peek(), this.source);
      this.shouldRecover(error);
      const rparen = this.advance();
      const errorNode: ErrorNode = {
        type: "Error",
        error,
        skipped: [],
        expectedAt: { start: rparen.start, end: rparen.start },
        span: { start: rparen.start, end: rparen.start },
      };
      return {
        type: "Composite",
        expression: errorNode,
        span: { start: lparen.start, end: rparen.end },
      };
    }

    const expression = this.parseExpression();

    if (!this.at(TokenKind.RParen)) {
      this.shouldRecover(
        new UnclosedDelimiterError("parenthesis", this.peek(), this.source, lparen.start),
      );
      this.depth--;
      return {
        type: "Composite",
        expression,
        span: { start: lparen.start, end: expression.span.end },
      };
    }

    const rparen = this.advance();
    this.depth--;
    return { type: "Composite", expression, span: { start: lparen.start, end: rparen.end } };
  }

  private recoverDepthLimit(error: DepthLimitError): ErrorNode {
    this.shouldRecover(error);
    const start = this.peek();
    const skipped: Token[] = [];
    let nesting = 0;
    while (!this.at(TokenKind.EOF)) {
      if (this.peek().kind === TokenKind.RParen && nesting === 0) break;
      const token = this.advance();
      skipped.push(token);
      if (token.kind === TokenKind.LParen) nesting++;
      if (token.kind === TokenKind.RParen) nesting--;
    }
    const last = skipped[skipped.length - 1];
    return {
      type: "Error",
      error,
      skipped,
      expectedAt: { start: start.start, end: start.end },
      span: { start: start.start, end: last ? last.end : start.start },
    };
  }

  // Restriction: comparable [comparator arg]

  private parseRestriction(): RestrictionNode<true> | ErrorNode {
    const comparable = this.parseComparable();
    if (comparable.type === "Error") return comparable;

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

  private parseComparable(): ComparableNode<true> | ErrorNode {
    const head = this.parseValue();
    if (head.type === "Error") return head;
    return this.parseComparableRest(head);
  }

  private parseComparableRest(head: ValueNode): ComparableNode<true> {
    if (this.peek().kind !== TokenKind.Dot) {
      const next = this.peek();
      if (next.kind === TokenKind.LParen && next.start === head.span.end) {
        return this.parseFunctionCall(head, []);
      }
      return { type: "Member", value: head, fields: [], span: head.span };
    }

    const fields: ValueNode[] = [];
    let lastErrorNode: ErrorNode | null = null;
    while (!this.hitErrorLimit) {
      const dot = this.eat(TokenKind.Dot);
      if (!dot) break;
      const field = this.parseField(dot);
      if (field.type === "Error") {
        lastErrorNode = field;
        break;
      }
      fields.push(field);
    }

    if (fields.length === 0) {
      return { type: "Member", value: head, fields: [], span: head.span };
    }

    const lastField = fields[fields.length - 1];
    invariant(lastField !== undefined, "Expected at least one field after dot");

    if (lastErrorNode === null) {
      const lparen = this.peek();
      if (lparen.kind === TokenKind.LParen) {
        if (lparen.start === lastField.span.end) {
          return this.parseFunctionCall(head, fields);
        }
      }
    }

    const lastSpan = lastField.span;
    return { type: "Member", value: head, fields, span: this.spanFromTo(head.span, lastSpan) };
  }

  // FunctionCall: name "(" [argList] ")"

  private parseFunctionCall(head: ValueNode, nameParts: ValueNode[]): FunctionCallNode<true> {
    // EBNF: function uses `name` not `field`: name : TEXT | keyword (no STRING)
    for (const part of [head, ...nameParts]) {
      if (part.token.kind === TokenKind.String) {
        this.shouldRecover(new InvalidFunctionNameError(part.token, this.source));
        break;
      }
    }
    const lparen = this.advance();
    let args: (ArgNode<true> | ErrorNode)[] = [];
    if (!this.at(TokenKind.RParen)) {
      args = this.parseArgList(lparen);
    }

    if (!this.at(TokenKind.RParen)) {
      this.shouldRecover(new UnclosedDelimiterError("functionCall", this.peek(), this.source));
      const lastArg = args[args.length - 1];
      const endPos = lastArg ? lastArg.span.end : lparen.end;
      return {
        type: "FunctionCall",
        name: [head, ...nameParts],
        args,
        span: { start: head.span.start, end: endPos },
      };
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

  private parseArg(after: Token): ArgNode<true> | ErrorNode {
    switch (this.peek().kind) {
      case TokenKind.LParen:
        return this.parseComposite();
      case TokenKind.Text:
      case TokenKind.String:
        return this.parseComparable();
      case TokenKind.Minus:
        return this.parseNegativeValue();
      default: {
        this.shouldRecover(new ExpectedValueError(after, this.peek(), this.source));
        return this.synthesizeMember(after.end);
      }
    }
  }

  // ArgList: arg {"," arg}

  private parseArgList(lparen: Token): (ArgNode<true> | ErrorNode)[] {
    const args: (ArgNode<true> | ErrorNode)[] = [this.parseArg(lparen)];

    while (!this.hitErrorLimit) {
      const comma = this.eat(TokenKind.Comma);
      if (!comma) break;
      if (
        !this.at(TokenKind.Text) &&
        !this.at(TokenKind.String) &&
        !this.at(TokenKind.LParen) &&
        !this.at(TokenKind.Minus)
      ) {
        this.shouldRecover(new ExpectedValueError(comma, this.peek(), this.source));
        args.push(this.synthesizeMember(comma.end));
        continue;
      }
      args.push(this.parseArg(comma));
    }

    return args;
  }

  // NegativeValue: "-" comparable

  private parseNegativeValue(): MemberNode | ErrorNode {
    const minusToken = this.advance();
    if (!this.at(TokenKind.Text) && !this.at(TokenKind.String)) {
      return this.recover(new ExpectedValueError(minusToken, this.peek(), this.source), SYNC_ARG);
    }
    const comparable = this.parseComparable();
    if (comparable.type === "Error") return comparable;
    if (comparable.type !== "Member") {
      const error = new InvalidNegationError("function", minusToken, this.source);
      this.shouldRecover(error);
      return {
        type: "Error",
        error,
        skipped: [minusToken],
        expectedAt: { start: minusToken.start, end: minusToken.end },
        span: { start: minusToken.start, end: comparable.span.end },
      };
    }
    // For dotted paths, only allow if the result forms a valid number (e.g. -3.14)
    if (comparable.fields.length > 0) {
      const joined =
        "-" +
        [comparable.value.token.value, ...comparable.fields.map((f) => f.token.value)].join(".");
      if (Number.isNaN(Number(joined))) {
        this.shouldRecover(new InvalidNegationError("fieldPath", minusToken, this.source));
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

  private parseValue(): ValueNode | ErrorNode {
    if (this.at(TokenKind.Text) || this.at(TokenKind.String)) {
      const token = this.advance();
      return { type: "Value", token, span: { start: token.start, end: token.end } };
    }

    return this.recover(new ExpectedIdentifierError(this.peek(), this.source), SYNC_EXPRESSION);
  }

  // Field: value | keyword (after a dot)

  private parseField(dot: Token): ValueNode | ErrorNode {
    if (this.at(TokenKind.Text) || this.at(TokenKind.String) || KEYWORDS.has(this.peek().kind)) {
      const token = this.advance();
      return { type: "Value", token, span: { start: token.start, end: token.end } };
    }

    return this.recover(new ExpectedValueError(dot, this.peek(), this.source), SYNC_EXPRESSION);
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

  private canStartExpression(): boolean {
    return this.canStartSimple() || this.at(TokenKind.Not) || this.at(TokenKind.Minus);
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
export interface ParseResult {
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
export function parse(input: string, options?: ParseOptions & { tolerant?: false }): FilterNode;
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
export function parse(input: string, options: ParseOptions & { tolerant: true }): ParseResult;
export function parse(input: string, options?: ParseOptions): FilterNode | ParseResult {
  const maxLength = options?.maxLength ?? 8192;
  const tolerant = options?.tolerant === true;
  const maxErrors = options?.maxErrors ?? 20;

  if (input.length > maxLength) {
    const error = new InputLengthError(maxLength, { start: maxLength, end: input.length }, input);
    if (!tolerant) throw error;
    return {
      cst: {
        type: "Filter" as const,
        expression: null,
        trailing: null,
        span: { start: 0, end: input.length },
      },
      errors: [error],
      ok: false,
    };
  }

  let tokens: Token[];
  let lexerErrors: LexerError[] = [];

  if (tolerant) {
    const result = tokenize(input, { tolerant: true });
    tokens = result.tokens;
    lexerErrors = result.errors;
  } else {
    tokens = tokenize(input);
  }

  const parser = new Parser(tokens, input, options?.maxDepth ?? 64, tolerant, maxErrors);
  for (const e of lexerErrors) {
    parser.errors.push(e);
  }

  const base = parser.parse();

  if (tolerant) {
    const cst: FilterNode<true> = { ...base, trailing: parser.trailing };
    return {
      cst,
      errors: parser.errors,
      ok: parser.errors.length === 0,
    };
  }

  // In strict mode the parser throws on any error, so no ErrorNodes were
  // ever constructed. The cast is safe: FilterNodeBase<true> with no ErrorNodes
  // is structurally identical to FilterNode<false>.
  return base as unknown as FilterNode;
}

/**
 * Walk a CST and return `true` if any node is an {@link ErrorNode}.
 *
 * Useful for checking whether a tolerant parse produced a clean tree
 * before passing it to {@link transform}.
 */
export function hasErrorNodes(node: CSTNode<true>): boolean {
  if (node.type === "Error") return true;
  switch (node.type) {
    case "Filter":
      return (
        (node.expression !== null && hasErrorNodes(node.expression)) ||
        (node.trailing !== undefined && node.trailing !== null)
      );
    case "Expression":
      return node.sequences.some(hasErrorNodes);
    case "Sequence":
      return node.factors.some(hasErrorNodes);
    case "Factor":
      return node.terms.some(hasErrorNodes);
    case "Term":
      return hasErrorNodes(node.simple);
    case "Restriction":
      return hasErrorNodes(node.comparable) || (node.arg !== null && hasErrorNodes(node.arg));
    case "Composite":
      return hasErrorNodes(node.expression);
    case "Member":
      return false;
    case "FunctionCall":
      return node.args.some(hasErrorNodes);
    case "Value":
      return false;
  }
}

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
export function toCleanTree(result: ParseResult): FilterNode | null {
  if (!result.ok) return null;
  return result.cst as unknown as FilterNode;
}
