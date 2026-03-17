import { bench, describe, beforeAll } from "vitest";
import { AipFilter, parseFilterString } from "@tcn/aip-160";

// @tcn/aip-160 is fully async due to lazy grammar compilation.
// We pre-warm the instance so benchmarks measure steady-state performance,
// not one-time grammar loading.
const aip = new AipFilter();
beforeAll(async () => {
  await aip.filter("a = 1", [{ a: 1 }]);
});

const EXPR = 'power >= 5 AND status = "contracted"';
const TARGET = [{ power: 7, status: "contracted", name: "Madoka" }];

describe("pipeline stages", () => {
  bench("parseFilterString", async () => {
    await parseFilterString(EXPR);
  });

  bench("filter (end-to-end, single item)", async () => {
    await aip.filter(EXPR, TARGET);
  });
});

describe("compile-once vs re-parse", () => {
  // @tcn/aip-160 has no compile step - every call re-parses.
  bench("filter() x100", async () => {
    for (let i = 0; i < 100; i++) {
      await aip.filter(EXPR, TARGET);
    }
  });
});

const SIMPLE_EXPR = "a = 1";
const SIMPLE_TARGET = [{ a: 1 }];

const MEDIUM_EXPR = "a = 1 AND b = 2 AND d > 10";
const MEDIUM_TARGET = [{ a: 1, b: 2, c: "contracted", d: 20 }];

// @tcn/aip-160 doesn't support the full onesixty feature set (no `:` has
// operator, no `NOT wildcard`), so we use the closest equivalent expressions.
const COMPLEX_EXPR = "(a = 1 OR b = 2) AND d > 10";
const COMPLEX_TARGET = [{ a: 1, b: 3, c: "yes", d: 15, g: "kyubey" }];

const NESTED_TARGET = [
  {
    a: { b: { c: { d: { e: { f: { name: "madoka" } } } } } },
    x: { y: "other" },
  },
];

describe("expression complexity", () => {
  bench("simple: a = 1", async () => {
    await aip.filter(SIMPLE_EXPR, SIMPLE_TARGET);
  });

  bench("medium: 3 restrictions", async () => {
    await aip.filter(MEDIUM_EXPR, MEDIUM_TARGET);
  });

  bench("complex: OR + nested path", async () => {
    await aip.filter(COMPLEX_EXPR, COMPLEX_TARGET);
  });

  bench("global search: bare value on nested object", async () => {
    await aip.filter('"madoka"', NESTED_TARGET);
  });
});

// Large expression: 50 chained AND restrictions
const LARGE_EXPR = Array.from({ length: 50 }, (_, i) => `f${i} = ${i}`).join(" AND ");
const LARGE_TARGET = [Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`f${i}`, i]))];

// Deep nesting: 32 levels of parentheses
const DEEP_EXPR = "(".repeat(32) + "a = 1" + ")".repeat(32);

// Large target: 1000 keys, filter hits the last one
const LARGE_OBJ_TARGET = [
  Object.fromEntries(Array.from({ length: 1000 }, (_, i) => [`key${i}`, i])),
];

describe("stress: large expressions", () => {
  bench("parseFilterString (50 restrictions)", async () => {
    await parseFilterString(LARGE_EXPR);
  });

  bench("filter (50 restrictions)", async () => {
    await aip.filter(LARGE_EXPR, LARGE_TARGET);
  });
});

describe("stress: deep nesting", () => {
  bench("parseFilterString (32 levels)", async () => {
    await parseFilterString(DEEP_EXPR);
  });

  bench("filter (32 levels)", async () => {
    await aip.filter(DEEP_EXPR, [{ a: 1 }]);
  });
});

describe("stress: large targets", () => {
  bench("filter last key in 1000-key object", async () => {
    await aip.filter("key999 = 999", LARGE_OBJ_TARGET);
  });

  bench("global search miss on 1000-key object", async () => {
    await aip.filter('"nonexistent"', LARGE_OBJ_TARGET);
  });
});
