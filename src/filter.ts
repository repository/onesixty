import type { ASTNode } from "./transform";
import { VALID_COMPARATORS, transform } from "./transform";
import { isRecord } from "./types";
import { parse } from "./parser";
import { evaluate } from "./evaluate";
import type { EvaluateOptions } from "./evaluate";
import { evaluateAsync } from "./evaluate-async";
import type { AsyncEvaluateOptions } from "./evaluate-async";
import { InvalidFieldTypeError, UnknownNodeTypeError, UnsupportedVersionError } from "./errors";

/**
 * Combined parse and evaluation options for the {@link filter} and
 * {@link compile} convenience functions.
 *
 * Extends {@link EvaluateOptions} with the parser limits from
 * {@link ParseOptions}.
 */
export interface FilterOptions extends EvaluateOptions {
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
export interface AsyncFilterOptions extends Omit<FilterOptions, "functions"> {
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
export interface SerializedFilter {
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
export function filter(
  expression: string,
  target: Record<string, unknown>,
  options?: FilterOptions,
): boolean {
  const ast = transform(parse(expression, options));
  return evaluate(ast, target, options);
}

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
export async function filterAsync(
  expression: string,
  target: Record<string, unknown>,
  options?: AsyncFilterOptions,
): Promise<boolean> {
  const ast = transform(parse(expression, options));
  return evaluateAsync(ast, target, options);
}

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
export function compile(expression: string, options?: FilterOptions): CompiledFilter {
  const ast = transform(parse(expression, options));
  return new CompiledFilter(expression, ast, options);
}

/**
 * A pre-compiled AIP-160 filter that can be evaluated against many targets
 * without re-parsing. Create via {@link compile} or {@link CompiledFilter.fromSerialized}.
 */
export class CompiledFilter {
  /** @internal Use {@link compile} or {@link CompiledFilter.fromSerialized} to create instances. */
  public constructor(
    /** The original filter expression string. */
    public readonly expression: string,
    /** The compiled AST, or `null` for empty filters. */
    public readonly ast: ASTNode | null,
    private readonly options?: EvaluateOptions,
  ) {}

  /**
   * Evaluate this filter against a target object.
   *
   * @param target - The object to test against the filter.
   * @returns `true` if the target matches the filter.
   * @throws {@link UnknownFunctionError} if a function call is unresolved and `unknownFunction` is `"throw"`.
   */
  public evaluate(target: Record<string, unknown>): boolean {
    return evaluate(this.ast, target, this.options);
  }

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
  public async evaluateAsync(
    target: Record<string, unknown>,
    functions?: AsyncFilterOptions["functions"],
  ): Promise<boolean> {
    const options: AsyncEvaluateOptions | undefined = functions
      ? { ...this.options, functions }
      : this.options;
    return evaluateAsync(this.ast, target, options);
  }

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
  public toSerialized(): SerializedFilter {
    return { v: 1, expression: this.expression, ast: this.ast };
  }

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
  public static fromSerialized(data: SerializedFilter, options?: EvaluateOptions): CompiledFilter {
    validateSerializedFilter(data);
    return new CompiledFilter(data.expression, data.ast, options);
  }
}

function validateSerializedFilter(data: unknown): asserts data is SerializedFilter {
  if (!isRecord(data)) {
    throw new InvalidFieldTypeError("", "object");
  }
  if (data.v !== 1) {
    throw new UnsupportedVersionError(data.v);
  }
  if (typeof data.expression !== "string") {
    throw new InvalidFieldTypeError("expression", "string");
  }
  if (data.ast !== null) {
    validateASTNode(data.ast, "ast");
  }
}

function validateASTNode(node: unknown, path: string): asserts node is ASTNode {
  if (!isRecord(node)) {
    throw new InvalidFieldTypeError(path, "object");
  }

  switch (node.type) {
    case "and":
    case "or":
      validateSpan(node, path);
      validateNodeArray(node.children, `${path}.children`);
      break;
    case "not":
      validateSpan(node, path);
      validateASTNode(node.child, `${path}.child`);
      break;
    case "restriction":
      validateSpan(node, path);
      validateASTNode(node.comparable, `${path}.comparable`);
      if (typeof node.comparator !== "string" || !VALID_COMPARATORS.has(node.comparator)) {
        throw new InvalidFieldTypeError(`${path}.comparator`, "comparator");
      }
      validateASTNode(node.arg, `${path}.arg`);
      break;
    case "global":
      validateSpan(node, path);
      validateASTNode(node.value, `${path}.value`);
      break;
    case "value":
      validateSpan(node, path);
      if (typeof node.value !== "string") {
        throw new InvalidFieldTypeError(`${path}.value`, "string");
      }
      if (typeof node.quoted !== "boolean") {
        throw new InvalidFieldTypeError(`${path}.quoted`, "boolean");
      }
      break;
    case "member":
      validateSpan(node, path);
      validateStringArray(node.path, `${path}.path`);
      break;
    case "function":
      validateSpan(node, path);
      validateStringArray(node.name, `${path}.name`);
      if (typeof node.qualifiedName !== "string") {
        throw new InvalidFieldTypeError(`${path}.qualifiedName`, "string");
      }
      validateNodeArray(node.args, `${path}.args`);
      break;
    default:
      throw new UnknownNodeTypeError(path, String(node.type));
  }
}

function validateSpan(node: Record<string, unknown>, path: string): void {
  const span = node.span;
  if (!isRecord(span) || typeof span.start !== "number" || typeof span.end !== "number") {
    throw new InvalidFieldTypeError(`${path}.span`, "span");
  }
}

function validateNodeArray(value: unknown, path: string): void {
  if (!Array.isArray(value)) {
    throw new InvalidFieldTypeError(path, "array");
  }
  for (let i = 0; i < value.length; i++) {
    validateASTNode(value[i], `${path}[${i}]`);
  }
}

function validateStringArray(value: unknown, path: string): void {
  if (!Array.isArray(value)) {
    throw new InvalidFieldTypeError(path, "array");
  }
  for (let i = 0; i < value.length; i++) {
    if (typeof value[i] !== "string") {
      throw new InvalidFieldTypeError(`${path}[${i}]`, "string");
    }
  }
}
