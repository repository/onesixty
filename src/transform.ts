import type { ComparatorKind, Span } from "./types";
import { TokenKind } from "./types";
import { invariant } from "./errors";
import type {
  ArgNode,
  CompositeNode,
  ExpressionNode,
  FactorNode,
  FilterNode,
  FunctionCallNode,
  MemberNode,
  RestrictionNode,
  SequenceNode,
  TermNode,
} from "./parser";

/**
 * The six comparison operators supported by AIP-160.
 *
 * Does not include `:` (has). See {@link Comparator} for the full set.
 */
export type ComparisonOperator = "=" | "!=" | "<" | "<=" | ">" | ">=";

/**
 * All AIP-160 comparators: the six {@link ComparisonOperator}s plus the
 * `:` (has) operator for membership/presence checks.
 */
export type Comparator = ComparisonOperator | ":";

/**
 * Logical AND of two or more child expressions.
 *
 * Produced from explicit `AND` keywords and from implicit AND
 * (whitespace-separated terms). Nested ANDs are flattened into a single node.
 */
export interface AndNode {
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
export interface OrNode {
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
export interface NotNode {
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
export interface ASTRestrictionNode {
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
export interface GlobalNode {
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
export interface ASTValueNode {
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
export interface ASTMemberNode {
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
export interface ASTFunctionNode {
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
export type ASTNode =
  | AndNode
  | OrNode
  | NotNode
  | ASTRestrictionNode
  | GlobalNode
  | ASTValueNode
  | ASTMemberNode
  | ASTFunctionNode;

const COMPARATOR_MAP: Record<ComparatorKind, Comparator> = {
  [TokenKind.Equals]: "=",
  [TokenKind.NotEquals]: "!=",
  [TokenKind.LessThan]: "<",
  [TokenKind.LessEquals]: "<=",
  [TokenKind.GreaterThan]: ">",
  [TokenKind.GreaterEquals]: ">=",
  [TokenKind.Has]: ":",
};

export const VALID_COMPARATORS: ReadonlySet<string> = new Set(Object.values(COMPARATOR_MAP));

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
export function transform(filter: FilterNode): ASTNode | null {
  if (!filter.expression) return null;
  return transformExpression(filter.expression);
}

function transformExpression(node: ExpressionNode): ASTNode {
  const first = node.sequences[0];
  invariant(first !== undefined, "Expression must have at least one sequence");
  if (node.sequences.length === 1) return transformSequence(first);
  const children = node.sequences.map(transformSequence);
  return { type: "and", children: flattenAnd(children), span: node.span };
}

function transformSequence(node: SequenceNode): ASTNode {
  const first = node.factors[0];
  invariant(first !== undefined, "Sequence must have at least one factor");
  if (node.factors.length === 1) return transformFactor(first);
  const children = node.factors.map(transformFactor);
  return { type: "and", children: flattenAnd(children), span: node.span };
}

function transformFactor(node: FactorNode): ASTNode {
  const first = node.terms[0];
  invariant(first !== undefined, "Factor must have at least one term");
  if (node.terms.length === 1) return transformTerm(first);
  const children = node.terms.map(transformTerm);
  return { type: "or", children: flattenOr(children), span: node.span };
}

function transformTerm(node: TermNode): ASTNode {
  const inner = transformSimple(node.simple);
  if (!node.negated) return inner;
  return { type: "not", child: inner, span: node.span };
}

function transformSimple(node: RestrictionNode | CompositeNode): ASTNode {
  if (node.type === "Composite") return transformComposite(node);
  return transformRestriction(node);
}

function transformComposite(node: CompositeNode): ASTNode {
  return transformExpression(node.expression);
}

function transformRestriction(node: RestrictionNode): ASTNode {
  if (node.comparator == null || node.arg == null) {
    const value = transformComparable(node.comparable);
    return { type: "global", value, span: node.span };
  }

  const comparator = COMPARATOR_MAP[node.comparator];
  const comparable = transformRestrictionSubject(node.comparable);
  const arg = transformArg(node.arg);
  return { type: "restriction", comparable, comparator, arg, span: node.span };
}

/** Transform a restriction LHS. Always produces member or function, never collapses to value. */
function transformRestrictionSubject(
  node: MemberNode | FunctionCallNode,
): ASTMemberNode | ASTFunctionNode {
  if (node.type === "FunctionCall") return transformFunction(node);
  const path = memberPath(node);
  if (isNumericPath(path)) {
    return { type: "member", path: [path.join(".")], span: node.span };
  }
  return { type: "member", path, span: node.span };
}

function transformComparable(
  node: MemberNode | FunctionCallNode,
): ASTValueNode | ASTMemberNode | ASTFunctionNode {
  if (node.type === "FunctionCall") return transformFunction(node);
  return transformMember(node);
}

function transformMember(node: MemberNode): ASTValueNode | ASTMemberNode {
  const path = memberPath(node);
  if (node.fields.length === 0) {
    return {
      type: "value",
      value: node.value.token.value,
      quoted: node.value.token.kind === TokenKind.String,
      span: node.span,
    };
  }
  if (isNumericPath(path)) {
    return { type: "value", value: path.join("."), quoted: false, span: node.span };
  }
  return { type: "member", path, span: node.span };
}

function memberPath(node: MemberNode): string[] {
  const path = [node.value.token.value];
  for (const f of node.fields) path.push(f.token.value);
  return path;
}

function isNumericPath(path: string[]): boolean {
  if (path.length < 2) return false;
  const joined = path.join(".");
  const n = Number(joined);
  return !Number.isNaN(n) && Number.isFinite(n);
}

function transformFunction(node: FunctionCallNode): ASTFunctionNode {
  const name = node.name.map((n) => n.token.value);
  const args = node.args.map(transformArg);
  return { type: "function", name, qualifiedName: name.join("."), args, span: node.span };
}

function transformArg(node: ArgNode): ASTNode {
  if (node.type === "Composite") return transformComposite(node);
  return transformComparable(node);
}

function flattenAnd(children: ASTNode[]): ASTNode[] {
  if (!children.some((c) => c.type === "and")) return children;
  const result: ASTNode[] = [];
  for (const c of children) {
    if (c.type === "and") result.push(...c.children);
    else result.push(c);
  }
  return result;
}

function flattenOr(children: ASTNode[]): ASTNode[] {
  if (!children.some((c) => c.type === "or")) return children;
  const result: ASTNode[] = [];
  for (const c of children) {
    if (c.type === "or") result.push(...c.children);
    else result.push(c);
  }
  return result;
}
