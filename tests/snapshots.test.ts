import { describe, expect, it } from "vitest";
import {
  tokenize,
  parse,
  transform,
  evaluate,
  evaluateAsync,
  filter,
  filterAsync,
  compile,
  CompiledFilter,
  FilterError,
  TokenKind,
  isComparatorKind,
} from "../src";

describe("snapshot: tokenize", () => {
  it("simple restriction", () => {
    expect(tokenize("power >= 5")).toMatchSnapshot();
  });

  it("complex expression", () => {
    expect(tokenize('name = "Madoka" AND (power > 5 OR status:active)')).toMatchSnapshot();
  });

  it("function call", () => {
    expect(tokenize("regex(m.key, '^prod.*$')")).toMatchSnapshot();
  });

  it("negation and has", () => {
    expect(tokenize('NOT tags:* AND -file:".java"')).toMatchSnapshot();
  });

  it("empty input", () => {
    expect(tokenize("")).toMatchSnapshot();
  });

  it("keywords as function names", () => {
    expect(tokenize("NOT() AND() OR.check()")).toMatchSnapshot();
  });
});

describe("snapshot: parse", () => {
  it("empty filter", () => {
    expect(parse("")).toMatchSnapshot();
  });

  it("bare literal", () => {
    expect(parse("mitakihara")).toMatchSnapshot();
  });

  it("simple restriction", () => {
    expect(parse("power >= 5")).toMatchSnapshot();
  });

  it("string comparison", () => {
    expect(parse('name = "Madoka"')).toMatchSnapshot();
  });

  it("AND expression", () => {
    expect(parse("a = 1 AND b = 2")).toMatchSnapshot();
  });

  it("OR expression", () => {
    expect(parse("a = 1 OR b = 2")).toMatchSnapshot();
  });

  it("implicit AND (sequence)", () => {
    expect(parse("Mitakihara Magical Girls")).toMatchSnapshot();
  });

  it("precedence: a AND b OR c", () => {
    expect(parse("a AND b OR c")).toMatchSnapshot();
  });

  it("NOT negation", () => {
    expect(parse("NOT a = 1")).toMatchSnapshot();
  });

  it("minus negation", () => {
    expect(parse('-file:".java"')).toMatchSnapshot();
  });

  it("composite (parenthesized)", () => {
    expect(parse("(a = 1 OR b = 2)")).toMatchSnapshot();
  });

  it("field traversal", () => {
    expect(parse('a.b.c = "foo"')).toMatchSnapshot();
  });

  it("has operator", () => {
    expect(parse("m.foo:*")).toMatchSnapshot();
  });

  it("function call no args", () => {
    expect(parse("fn()")).toMatchSnapshot();
  });

  it("function call with args", () => {
    expect(parse("regex(m.key, '^prod$')")).toMatchSnapshot();
  });

  it("qualified function", () => {
    expect(parse("math.mem('30mb')")).toMatchSnapshot();
  });

  it("function as restriction arg", () => {
    expect(parse("x <= cohort(request.user)")).toMatchSnapshot();
  });

  it("negative numeric arg", () => {
    expect(parse("a = -3.14")).toMatchSnapshot();
  });

  it("complex expression", () => {
    expect(
      parse('power >= 5 AND (name = "Madoka" OR status:active) AND NOT disabled = true'),
    ).toMatchSnapshot();
  });
});

describe("snapshot: transform", () => {
  it("empty filter", () => {
    expect(transform(parse(""))).toMatchSnapshot();
  });

  it("bare literal", () => {
    expect(transform(parse("mitakihara"))).toMatchSnapshot();
  });

  it("simple restriction", () => {
    expect(transform(parse("power >= 5"))).toMatchSnapshot();
  });

  it("AND expression", () => {
    expect(transform(parse("a = 1 AND b = 2"))).toMatchSnapshot();
  });

  it("OR expression", () => {
    expect(transform(parse("a = 1 OR b = 2"))).toMatchSnapshot();
  });

  it("NOT expression", () => {
    expect(transform(parse("NOT a = 1"))).toMatchSnapshot();
  });

  it("implicit AND flattened", () => {
    expect(transform(parse("a b AND c d"))).toMatchSnapshot();
  });

  it("field traversal becomes path array", () => {
    expect(transform(parse("a.b.c = x"))).toMatchSnapshot();
  });

  it("dotted numeric arg collapsed to value", () => {
    expect(transform(parse("a = 2.5"))).toMatchSnapshot();
  });

  it("dotted non-numeric arg stays as member", () => {
    expect(transform(parse("a = b.c"))).toMatchSnapshot();
  });

  it("function call", () => {
    expect(transform(parse("regex(m.key, '^prod$')"))).toMatchSnapshot();
  });

  it("function as LHS of comparison", () => {
    expect(transform(parse("fn() = 42"))).toMatchSnapshot();
  });

  it("keyword function name", () => {
    expect(transform(parse("NOT()"))).toMatchSnapshot();
  });

  it("keywords as field names", () => {
    expect(transform(parse("a.OR.NOT = 1"))).toMatchSnapshot();
  });

  it("complex expression", () => {
    expect(
      transform(parse('power >= 5 AND (name = "Madoka" OR status:active) AND NOT disabled = true')),
    ).toMatchSnapshot();
  });
});

describe("snapshot: evaluate", () => {
  const ast = (expr: string) => transform(parse(expr));

  it("null AST", () => {
    expect(evaluate(null, {})).toMatchSnapshot();
  });

  it("simple match", () => {
    expect(evaluate(ast("power = 5"), { power: 5 })).toMatchSnapshot();
  });

  it("simple mismatch", () => {
    expect(evaluate(ast("power = 5"), { power: 3 })).toMatchSnapshot();
  });

  it("AND", () => {
    expect(evaluate(ast("a = 1 AND b = 2"), { a: 1, b: 2 })).toMatchSnapshot();
  });

  it("OR", () => {
    expect(evaluate(ast("a = 1 OR b = 2"), { a: 1, b: 9 })).toMatchSnapshot();
  });

  it("NOT", () => {
    expect(evaluate(ast("NOT a = 1"), { a: 2 })).toMatchSnapshot();
  });

  it("field traversal", () => {
    expect(evaluate(ast("a.b.c = 1"), { a: { b: { c: 1 } } })).toMatchSnapshot();
  });

  it("unset field returns false", () => {
    expect(evaluate(ast("a.b = 1"), {})).toMatchSnapshot();
  });

  it("unset field with != returns false", () => {
    expect(evaluate(ast("a != 1"), { a: null })).toMatchSnapshot();
  });

  it("has operator: array", () => {
    expect(evaluate(ast("tags:foo"), { tags: ["foo", "bar"] })).toMatchSnapshot();
  });

  it("has operator: map key", () => {
    expect(evaluate(ast("m:foo"), { m: { foo: 1 } })).toMatchSnapshot();
  });

  it("has operator: presence", () => {
    expect(evaluate(ast("a:*"), { a: "yes" })).toMatchSnapshot();
  });

  it("has operator: array fanout", () => {
    expect(evaluate(ast("r.foo:42"), { r: [{ foo: 42 }, { foo: 1 }] })).toMatchSnapshot();
  });

  it("wildcard match", () => {
    expect(evaluate(ast('name = "*.foo"'), { name: "bar.foo" })).toMatchSnapshot();
  });

  it("global restriction", () => {
    expect(evaluate(ast("Madoka"), { name: "Homura Madoka" })).toMatchSnapshot();
  });

  it("type coercion: number", () => {
    expect(evaluate(ast("power = 5"), { power: 5 })).toMatchSnapshot();
  });

  it("type coercion: boolean", () => {
    expect(evaluate(ast("active = true"), { active: true })).toMatchSnapshot();
  });

  it("function call", () => {
    const node = ast("check()");
    expect(evaluate(node, {}, { functions: { check: () => true } })).toMatchSnapshot();
  });

  it("function as LHS", () => {
    const node = ast("fn() = 42");
    expect(evaluate(node, {}, { functions: { fn: () => 42 } })).toMatchSnapshot();
  });
});

describe("snapshot: evaluateAsync", () => {
  const ast = (expr: string) => transform(parse(expr));

  it("async function", async () => {
    const node = ast("check()");
    expect(
      await evaluateAsync(node, {}, { functions: { check: async () => true } }),
    ).toMatchSnapshot();
  });

  it("mixed sync and async", async () => {
    const node = ast("a = 1 AND check()");
    expect(
      await evaluateAsync(node, { a: 1 }, { functions: { check: async () => true } }),
    ).toMatchSnapshot();
  });
});

describe("snapshot: filter", () => {
  it("match", () => {
    expect(filter("power >= 5", { power: 9 })).toMatchSnapshot();
  });

  it("mismatch", () => {
    expect(filter("power >= 5", { power: 2 })).toMatchSnapshot();
  });

  it("empty filter", () => {
    expect(filter("", { anything: true })).toMatchSnapshot();
  });

  it("with options", () => {
    expect(filter("check()", {}, { functions: { check: () => true } })).toMatchSnapshot();
  });
});

describe("snapshot: filterAsync", () => {
  it("async match", async () => {
    expect(
      await filterAsync("check()", {}, { functions: { check: async () => true } }),
    ).toMatchSnapshot();
  });
});

describe("snapshot: compile", () => {
  it("compiled filter evaluates", () => {
    const f = compile("power >= 5");
    expect(f.evaluate({ power: 9 })).toMatchSnapshot();
    expect(f.evaluate({ power: 2 })).toMatchSnapshot();
  });

  it("expression preserved", () => {
    expect(compile("a = 1 AND b:*").expression).toMatchSnapshot();
  });

  it("AST structure", () => {
    expect(compile("a = 1 AND b:*").ast).toMatchSnapshot();
  });

  it("toSerialized", () => {
    expect(compile("power >= 5").toSerialized()).toMatchSnapshot();
  });

  it("toSerialized: empty filter", () => {
    expect(compile("").toSerialized()).toMatchSnapshot();
  });

  it("fromSerialized round-trip", () => {
    const original = compile('power >= 5 AND name = "Madoka"');
    const json = JSON.stringify(original.toSerialized());
    const restored = CompiledFilter.fromSerialized(JSON.parse(json));
    expect(restored.expression).toMatchSnapshot();
    expect(restored.evaluate({ power: 9, name: "Madoka" })).toMatchSnapshot();
    expect(restored.evaluate({ power: 2, name: "Madoka" })).toMatchSnapshot();
  });
});

describe("snapshot: errors", () => {
  function captureError(fn: () => unknown) {
    try {
      fn();
    } catch (e) {
      if (e instanceof FilterError) {
        return {
          type: e.constructor.name,
          description: e.description,
          span: e.span,
          hints: e.hints,
        };
      }
      throw e;
    }
    throw new Error("Expected error");
  }

  it("unterminated string", () => {
    expect(captureError(() => tokenize('"hello'))).toMatchSnapshot();
  });

  it("unexpected character", () => {
    expect(captureError(() => tokenize("a ! b"))).toMatchSnapshot();
  });

  it("trailing AND", () => {
    expect(captureError(() => parse("a AND"))).toMatchSnapshot();
  });

  it("empty parentheses", () => {
    expect(captureError(() => parse("()"))).toMatchSnapshot();
  });

  it("unclosed parenthesis", () => {
    expect(captureError(() => parse("(a"))).toMatchSnapshot();
  });

  it("missing value after comparator", () => {
    expect(captureError(() => parse("a ="))).toMatchSnapshot();
  });

  it("double equals hint", () => {
    expect(captureError(() => parse("a == b"))).toMatchSnapshot();
  });

  it("keyword as value", () => {
    expect(captureError(() => parse("a = AND"))).toMatchSnapshot();
  });

  it("keyword at start", () => {
    expect(captureError(() => parse("AND"))).toMatchSnapshot();
  });

  it("quoted function name", () => {
    expect(captureError(() => parse('"fn"()'))).toMatchSnapshot();
  });

  it("depth limit", () => {
    expect(captureError(() => parse("(".repeat(200) + "a" + ")".repeat(200)))).toMatchSnapshot();
  });

  it("input length limit", () => {
    expect(captureError(() => parse("a ".repeat(5000)))).toMatchSnapshot();
  });

  it("unmatched closing paren", () => {
    expect(captureError(() => parse("a)"))).toMatchSnapshot();
  });

  it("negative field path", () => {
    expect(captureError(() => parse("a = -b.c"))).toMatchSnapshot();
  });
});

describe("snapshot: TokenKind enum", () => {
  it("all token kinds", () => {
    const kinds: Record<string, number> = {};
    for (const [key, value] of Object.entries(TokenKind)) {
      if (typeof value === "number") kinds[key] = value;
    }
    expect(kinds).toMatchSnapshot();
  });

  it("isComparatorKind", () => {
    const results: Record<string, boolean> = {};
    for (const [key, value] of Object.entries(TokenKind)) {
      if (typeof value === "number") {
        results[key] = isComparatorKind(value);
      }
    }
    expect(results).toMatchSnapshot();
  });
});
