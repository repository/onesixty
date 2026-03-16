import type { ASTNode, ASTRestrictionNode, ComparisonOperator, GlobalNode } from "./transform";
import { isRecord } from "./types";
import { UnknownFunctionError } from "./errors";

/**
 * Options for the {@link evaluate} function.
 *
 * Controls custom function resolution, field search behavior,
 * wildcard semantics, and traversal limits.
 */
export interface EvaluateOptions {
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

type Defaultable =
  | "unknownFunction"
  | "resolveRhsMembers"
  | "wildcardNotEquals"
  | "maxTraversalDepth";

type Resolved<T extends EvaluateOptions> = Required<Pick<T, Defaultable>> & Omit<T, Defaultable>;

const DEFAULTS: Required<Pick<EvaluateOptions, Defaultable>> = {
  unknownFunction: "throw",
  resolveRhsMembers: false,
  wildcardNotEquals: false,
  maxTraversalDepth: 32,
};

function resolveOptions<T extends EvaluateOptions>(options?: T): Resolved<T> {
  return options ? { ...DEFAULTS, ...options } : (DEFAULTS as Resolved<T>);
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
export function evaluate(
  node: ASTNode | null,
  target: Record<string, unknown>,
  options?: EvaluateOptions,
): boolean {
  if (node === null) return true;
  return evaluateNode(node, target, resolveOptions(options));
}

function evaluateNode(
  node: ASTNode,
  target: Record<string, unknown>,
  options: Resolved<EvaluateOptions>,
): boolean {
  switch (node.type) {
    case "and":
      return node.children.every((c) => evaluateNode(c, target, options));
    case "or":
      return node.children.some((c) => evaluateNode(c, target, options));
    case "not":
      return !evaluateNode(node.child, target, options);
    case "restriction":
      return evaluateRestriction(node, target, options);
    case "global":
      return evaluateGlobal(node, target, options);
    case "function":
      return !!evaluateFunction(node.qualifiedName, node.args, target, options);
    case "value":
      return !!node.value;
    case "member":
      return !!resolve(target, node.path);
    default: {
      const _exhaustive: never = node;
      return _exhaustive;
    }
  }
}

function evaluateRestriction(
  node: ASTRestrictionNode,
  target: Record<string, unknown>,
  options: Resolved<EvaluateOptions>,
): boolean {
  const argValue = resolveArgValue(node.arg, target, options);
  const wildcardEnabled = node.arg.type === "value" && node.arg.quoted;
  const comparable = node.comparable;

  if (comparable.type === "function") {
    const fnResult = evaluateFunction(comparable.qualifiedName, comparable.args, target, options);
    if (fnResult == null) return false;
    if (node.comparator === ":") return evaluateHas(fnResult, argValue);
    return compare(fnResult, node.comparator, argValue, wildcardEnabled, options);
  }

  const fieldPath = comparable.path;

  if (node.comparator === ":") {
    return evaluateHasRestriction(target, fieldPath, argValue, options.maxTraversalDepth);
  }

  const fieldValue = resolve(target, fieldPath);

  // Unset field -> skip (non-match), even for !=
  if (fieldValue == null) return false;

  return compare(fieldValue, node.comparator, argValue, wildcardEnabled, options);
}

function evaluateGlobal(
  node: GlobalNode,
  target: Record<string, unknown>,
  options: Resolved<EvaluateOptions>,
): boolean {
  const inner = node.value;
  if (inner.type === "function") {
    return !!evaluateFunction(inner.qualifiedName, inner.args, target, options);
  }

  if (inner.type === "member") {
    return isPresent(resolve(target, inner.path));
  }

  if (!inner.value) return false;
  const searchTerm = inner.value;

  if (options.globalSearchFields) {
    return searchGlobalFields(target, options.globalSearchFields, searchTerm);
  }

  return searchValues(target, searchTerm, options.maxTraversalDepth);
}

function evaluateFunction(
  qualifiedName: string,
  args: ASTNode[],
  target: Record<string, unknown>,
  options: Resolved<EvaluateOptions>,
): unknown {
  const fn = options.functions?.[qualifiedName];

  if (!fn) {
    if (options.unknownFunction === "false") return false;
    throw new UnknownFunctionError(qualifiedName);
  }

  const resolvedArgs = args.map((arg) => resolveArgValue(arg, target, options));
  return fn(...resolvedArgs);
}

function resolveArgValue(
  node: ASTNode,
  target: Record<string, unknown>,
  options: Resolved<EvaluateOptions>,
): unknown {
  switch (node.type) {
    case "value":
      return node.value;
    case "member":
      if (options.resolveRhsMembers) return resolve(target, node.path);
      return node.path.join(".");
    case "function":
      return evaluateFunction(node.qualifiedName, node.args, target, options);
    default:
      return evaluateNode(node, target, options);
  }
}

function resolve(target: unknown, path: string[]): unknown {
  let current: unknown = target;
  for (const key of path) {
    if (!isRecord(current)) return undefined;
    if (!Object.prototype.hasOwnProperty.call(current, key)) return undefined;
    current = current[key];
  }
  return current;
}

type FanoutResult =
  | { type: "resolved"; value: unknown }
  | { type: "fanout"; array: unknown[]; remaining: string[] };

function resolveWithArrayFanout(target: unknown, path: string[]): FanoutResult {
  let current: unknown = target;
  for (let i = 0; i < path.length; i++) {
    if (Array.isArray(current)) {
      return { type: "fanout", array: current, remaining: path.slice(i) };
    }
    if (!isRecord(current)) return { type: "resolved", value: undefined };
    const key = path[i];
    if (key === undefined) break;
    if (!Object.prototype.hasOwnProperty.call(current, key))
      return { type: "resolved", value: undefined };
    current = current[key];
  }
  return { type: "resolved", value: current };
}

function evaluateHasRestriction(
  target: unknown,
  fieldPath: string[],
  argValue: unknown,
  depth = DEFAULTS.maxTraversalDepth,
): boolean {
  if (depth <= 0) return false;
  const result = resolveWithArrayFanout(target, fieldPath);

  if (result.type === "fanout") {
    return result.array.some((el) =>
      evaluateHasRestriction(el, result.remaining, argValue, depth - 1),
    );
  }

  if (result.value == null) return false;

  return evaluateHas(result.value, argValue);
}

function evaluateHas(fieldValue: unknown, argValue: unknown): boolean {
  const argStr = String(argValue);

  if (argStr === "*") {
    return isPresent(fieldValue);
  }

  if (Array.isArray(fieldValue)) {
    return fieldValue.some((el) => {
      if (isRecord(el)) {
        return Object.prototype.hasOwnProperty.call(el, argStr);
      }
      const coerced = coerce(argValue, el);
      return el === coerced;
    });
  }

  if (isRecord(fieldValue)) {
    return Object.prototype.hasOwnProperty.call(fieldValue, argStr);
  }

  const coerced = coerce(argValue, fieldValue);
  return fieldValue === coerced;
}

/** JS-truthy presence: `0` and `false` are present; `null`, `undefined`,
 *  `""`, `[]`, and `{}` are not. */
function isPresent(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === "string") return value.length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (isRecord(value)) return Object.keys(value).length > 0;
  return true;
}

function compare(
  fieldValue: unknown,
  comparator: ComparisonOperator,
  argValue: unknown,
  wildcardEnabled: boolean,
  options: Resolved<EvaluateOptions>,
): boolean {
  const coerced = coerce(argValue, fieldValue);

  switch (comparator) {
    case "=":
      return equalsWith(fieldValue, coerced, wildcardEnabled);
    case "!=":
      if (options.wildcardNotEquals) return !equalsWith(fieldValue, coerced, wildcardEnabled);
      return fieldValue !== coerced;
    case "<":
      return orderCompare(fieldValue, coerced) < 0;
    case "<=":
      return orderCompare(fieldValue, coerced) <= 0;
    case ">":
      return orderCompare(fieldValue, coerced) > 0;
    case ">=":
      return orderCompare(fieldValue, coerced) >= 0;
  }
}

function equalsWith(fieldValue: unknown, argValue: unknown, wildcardEnabled: boolean): boolean {
  if (wildcardEnabled && typeof fieldValue === "string" && typeof argValue === "string") {
    return matchWildcard(fieldValue, argValue);
  }
  return fieldValue === argValue;
}

function orderCompare(a: unknown, b: unknown): number {
  if (typeof a === "number" && typeof b === "number") {
    return a - b;
  }
  if (typeof a === "string" && typeof b === "string") {
    return a < b ? -1 : a > b ? 1 : 0;
  }
  return NaN;
}

function matchWildcard(value: string, pattern: string): boolean {
  if (!pattern.includes("*")) return value === pattern;
  const parts = pattern.split("*");
  let pos = 0;
  const first = parts[0] ?? "";
  if (first !== "" && !value.startsWith(first)) return false;
  pos = first.length;
  for (let i = 1; i < parts.length - 1; i++) {
    const seg = parts[i] ?? "";
    if (seg === "") continue;
    const idx = value.indexOf(seg, pos);
    if (idx === -1) return false;
    pos = idx + seg.length;
  }
  const last = parts[parts.length - 1] ?? "";
  if (last !== "" && !value.endsWith(last)) return false;
  if (last !== "" && value.length - last.length < pos) return false;
  return true;
}

function coerce(argValue: unknown, fieldValue: unknown): unknown {
  if (typeof argValue !== "string") return argValue;

  if (typeof fieldValue === "number") {
    const n = Number(argValue);
    return Number.isNaN(n) ? argValue : n;
  }
  if (typeof fieldValue === "boolean") {
    if (argValue === "true") return true;
    if (argValue === "false") return false;
    return argValue;
  }
  return argValue;
}

function searchGlobalFields(
  target: Record<string, unknown>,
  fields: string[],
  term: string,
): boolean {
  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(target, field)) continue;
    const value = target[field];
    if (value == null) continue;
    if (typeof value !== "string" && typeof value !== "number") continue;
    const str = String(value);
    if (str === term || str.includes(term)) return true;
  }
  return false;
}

function searchValues(obj: unknown, term: string, depth = DEFAULTS.maxTraversalDepth): boolean {
  if (depth <= 0 || obj == null) return false;
  if (typeof obj === "string" || typeof obj === "number") {
    const str = String(obj);
    return str === term || str.includes(term);
  }
  if (Array.isArray(obj)) return obj.some((el) => searchValues(el, term, depth - 1));
  if (isRecord(obj)) {
    return Object.values(obj).some((v) => searchValues(v, term, depth - 1));
  }
  return false;
}

export {
  resolve,
  evaluateHasRestriction,
  evaluateHas,
  compare,
  isPresent,
  searchGlobalFields,
  searchValues,
  resolveOptions,
};
export type { Resolved };
