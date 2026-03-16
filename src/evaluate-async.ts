import type { ASTNode, ASTRestrictionNode, GlobalNode } from "./transform";
import type { EvaluateOptions, Resolved } from "./evaluate";
import {
  resolve,
  evaluateHasRestriction,
  evaluateHas,
  compare,
  isPresent,
  searchGlobalFields,
  searchValues,
  resolveOptions,
} from "./evaluate";
import { UnknownFunctionError } from "./errors";

type MaybePromise<T> = T | Promise<T>;

/**
 * Options for {@link evaluateAsync}.
 *
 * Identical to {@link EvaluateOptions} except that `functions` may return
 * promises. All other options behave the same as in the sync evaluator.
 */
export interface AsyncEvaluateOptions extends Omit<EvaluateOptions, "functions"> {
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
export async function evaluateAsync(
  node: ASTNode | null,
  target: Record<string, unknown>,
  options?: AsyncEvaluateOptions,
): Promise<boolean> {
  if (node === null) return true;
  return evaluateNodeAsync(node, target, resolveOptions(options));
}

async function evaluateNodeAsync(
  node: ASTNode,
  target: Record<string, unknown>,
  options: Resolved<AsyncEvaluateOptions>,
): Promise<boolean> {
  switch (node.type) {
    case "and":
      for (const c of node.children) {
        if (!(await evaluateNodeAsync(c, target, options))) return false;
      }
      return true;
    case "or":
      for (const c of node.children) {
        if (await evaluateNodeAsync(c, target, options)) return true;
      }
      return false;
    case "not":
      return !(await evaluateNodeAsync(node.child, target, options));
    case "restriction":
      return evaluateRestrictionAsync(node, target, options);
    case "global":
      return evaluateGlobalAsync(node, target, options);
    case "function":
      return !!(await evaluateFunctionAsync(node.qualifiedName, node.args, target, options));
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

async function evaluateRestrictionAsync(
  node: ASTRestrictionNode,
  target: Record<string, unknown>,
  options: Resolved<AsyncEvaluateOptions>,
): Promise<boolean> {
  const argValue = await resolveArgValueAsync(node.arg, target, options);
  const wildcardEnabled = node.arg.type === "value" && node.arg.quoted;
  const comparable = node.comparable;

  if (comparable.type === "function") {
    const fnResult = await evaluateFunctionAsync(
      comparable.qualifiedName,
      comparable.args,
      target,
      options,
    );
    if (fnResult == null) return false;
    if (node.comparator === ":") return evaluateHas(fnResult, argValue);
    return compare(fnResult, node.comparator, argValue, wildcardEnabled, options);
  }

  const fieldPath = comparable.path;

  if (node.comparator === ":") {
    return evaluateHasRestriction(target, fieldPath, argValue, options.maxTraversalDepth);
  }

  const fieldValue = resolve(target, fieldPath);
  if (fieldValue == null) return false;

  return compare(fieldValue, node.comparator, argValue, wildcardEnabled, options);
}

async function evaluateGlobalAsync(
  node: GlobalNode,
  target: Record<string, unknown>,
  options: Resolved<AsyncEvaluateOptions>,
): Promise<boolean> {
  const inner = node.value;
  if (inner.type === "function") {
    return !!(await evaluateFunctionAsync(inner.qualifiedName, inner.args, target, options));
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

async function evaluateFunctionAsync(
  qualifiedName: string,
  args: ASTNode[],
  target: Record<string, unknown>,
  options: Resolved<AsyncEvaluateOptions>,
): Promise<unknown> {
  const fn = options.functions?.[qualifiedName];

  if (!fn) {
    if (options.unknownFunction === "false") return false;
    throw new UnknownFunctionError(qualifiedName);
  }

  const resolvedArgs: unknown[] = [];
  for (const arg of args) {
    resolvedArgs.push(await resolveArgValueAsync(arg, target, options));
  }
  return await fn(...resolvedArgs);
}

async function resolveArgValueAsync(
  node: ASTNode,
  target: Record<string, unknown>,
  options: Resolved<AsyncEvaluateOptions>,
): Promise<unknown> {
  switch (node.type) {
    case "value":
      return node.value;
    case "member":
      if (options.resolveRhsMembers) return resolve(target, node.path);
      return node.path.join(".");
    case "function":
      return evaluateFunctionAsync(node.qualifiedName, node.args, target, options);
    default:
      return evaluateNodeAsync(node, target, options);
  }
}
