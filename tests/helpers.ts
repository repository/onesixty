import { expect } from "vitest";
import { evaluate, evaluateAsync, parse, transform } from "../src";
import type { ASTNode, AsyncEvaluateOptions, EvaluateOptions, ParseOptions } from "../src";

export function catchError<E extends Error>(
  fn: () => unknown,
  ErrorClass: new (...args: never[]) => E,
): E {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(ErrorClass);
    return e as E;
  }
  expect.unreachable("Expected function to throw");
}

export function narrow<T extends { type: string }>(
  node: { type: string } | null | undefined,
  expectedType: T["type"],
): T {
  expect(node).not.toBeNull();
  expect(node).not.toBeUndefined();
  expect(node!.type).toBe(expectedType);
  return node as T;
}

export function ast(input: string): ASTNode | null {
  return transform(parse(input));
}

export function matches(
  filter: string,
  target: Record<string, unknown>,
  options?: EvaluateOptions,
): boolean {
  return evaluate(transform(parse(filter)), target, options);
}

export function matchesAsync(
  filter: string,
  target: Record<string, unknown>,
  options?: AsyncEvaluateOptions,
): Promise<boolean> {
  return evaluateAsync(transform(parse(filter)), target, options);
}

export function parses(filter: string, options?: ParseOptions): boolean {
  try {
    parse(filter, options);
    return true;
  } catch {
    return false;
  }
}
