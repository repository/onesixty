import { bench, describe } from "vitest";
import { tokenize, parse, transform, evaluate, filter, compile, CompiledFilter } from "../src";

const EXPR = 'power >= 5 AND status = "contracted"';
const TARGET = { power: 7, status: "contracted", name: "Madoka" };
const AST = transform(parse(EXPR));
const COMPILED = compile(EXPR);

describe("pipeline stages", () => {
  bench("tokenize", () => {
    tokenize(EXPR);
  });

  bench("parse", () => {
    parse(EXPR);
  });

  bench("parse + transform", () => {
    transform(parse(EXPR));
  });

  bench("evaluate (pre-compiled)", () => {
    evaluate(AST, TARGET);
  });

  bench("filter (end-to-end)", () => {
    filter(EXPR, TARGET);
  });
});

describe("compile-once vs re-parse", () => {
  bench("compile() + evaluate() x100", () => {
    const f = compile(EXPR);
    for (let i = 0; i < 100; i++) {
      f.evaluate(TARGET);
    }
  });

  bench("filter() x100", () => {
    for (let i = 0; i < 100; i++) {
      filter(EXPR, TARGET);
    }
  });
});

const SIMPLE_EXPR = "a = 1";
const SIMPLE_TARGET = { a: 1 };

const MEDIUM_EXPR = "a = 1 AND b = 2 AND c:* AND d > 10";
const MEDIUM_TARGET = { a: 1, b: 2, c: "contracted", d: 20 };

const COMPLEX_EXPR = '(a = 1 OR b = 2) AND c:* AND d.e.f >= 10 AND NOT g = "foo*"';
const COMPLEX_TARGET = { a: 1, b: 3, c: "yes", d: { e: { f: 15 } }, g: "kyubey" };

const FANOUT_TARGET = {
  items: Array.from({ length: 100 }, (_, i) => ({
    tags: i === 99 ? ["soul_gem"] : ["grief_seed", "witch_kiss"],
  })),
};

const NESTED_TARGET = {
  a: { b: { c: { d: { e: { f: { name: "madoka" } } } } } },
  x: { y: "other" },
};

describe("expression complexity", () => {
  bench("simple: a = 1", () => {
    filter(SIMPLE_EXPR, SIMPLE_TARGET);
  });

  bench("medium: 4 restrictions", () => {
    filter(MEDIUM_EXPR, MEDIUM_TARGET);
  });

  bench("complex: OR + nested path + NOT + wildcard", () => {
    filter(COMPLEX_EXPR, COMPLEX_TARGET);
  });

  bench("has fanout: items.tags:soul_gem (100 elements)", () => {
    filter("items.tags:soul_gem", FANOUT_TARGET);
  });

  bench("global search: bare value on nested object", () => {
    filter("madoka", NESTED_TARGET);
  });
});

const SERIALIZED = COMPILED.toSerialized();
const SERIALIZED_JSON = JSON.stringify(SERIALIZED);

describe("serialization", () => {
  bench("toSerialized", () => {
    COMPILED.toSerialized();
  });

  bench("fromSerialized (with validation)", () => {
    CompiledFilter.fromSerialized(SERIALIZED);
  });

  bench("full round-trip (stringify + parse + fromSerialized)", () => {
    CompiledFilter.fromSerialized(JSON.parse(SERIALIZED_JSON));
  });
});

// Large expression: 50 chained AND restrictions
const LARGE_EXPR = Array.from({ length: 50 }, (_, i) => `f${i} = ${i}`).join(" AND ");
const LARGE_TARGET = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`f${i}`, i]));
const LARGE_COMPILED = compile(LARGE_EXPR);

// Deep nesting: 32 levels of parentheses
const DEEP_EXPR = "(".repeat(32) + "a = 1" + ")".repeat(32);
const DEEP_COMPILED = compile(DEEP_EXPR);

// Large target: 1000 keys, filter hits the last one
const LARGE_OBJ_TARGET = Object.fromEntries(Array.from({ length: 1000 }, (_, i) => [`key${i}`, i]));

// Array fanout stress: 1000 elements with nested arrays
const FANOUT_STRESS_TARGET = {
  items: Array.from({ length: 1000 }, (_, i) => ({
    tags: i === 999 ? ["madoka"] : ["a", "b", "c"],
  })),
};

describe("stress: large expressions", () => {
  bench("tokenize (50 restrictions)", () => {
    tokenize(LARGE_EXPR);
  });

  bench("parse (50 restrictions)", () => {
    parse(LARGE_EXPR);
  });

  bench("filter (50 restrictions)", () => {
    filter(LARGE_EXPR, LARGE_TARGET);
  });

  bench("compiled evaluate (50 restrictions)", () => {
    LARGE_COMPILED.evaluate(LARGE_TARGET);
  });
});

describe("stress: deep nesting", () => {
  bench("parse (32 levels)", () => {
    parse(DEEP_EXPR);
  });

  bench("filter (32 levels)", () => {
    filter(DEEP_EXPR, { a: 1 });
  });

  bench("compiled evaluate (32 levels)", () => {
    DEEP_COMPILED.evaluate({ a: 1 });
  });
});

describe("stress: large targets", () => {
  bench("filter last key in 1000-key object", () => {
    filter("key999 = 999", LARGE_OBJ_TARGET);
  });

  bench("global search miss on 1000-key object", () => {
    filter("nonexistent", LARGE_OBJ_TARGET);
  });

  bench("has fanout: items.tags:madoka (1000 elements)", () => {
    filter("items.tags:madoka", FANOUT_STRESS_TARGET);
  });
});
