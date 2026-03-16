import { describe, expect, it } from "vitest";
import {
  CompiledFilter,
  InputLengthError,
  InvalidFieldTypeError,
  UnknownNodeTypeError,
  UnsupportedVersionError,
  compile,
  filter,
  filterAsync,
} from "../src";
import type { SerializedFilter } from "../src";
import { catchError } from "./helpers";

describe("filter", () => {
  it("matches a simple restriction", () => {
    expect(filter("power = 5", { power: 5 })).toBe(true);
  });

  it("rejects a mismatch", () => {
    expect(filter("power = 5", { power: 8 })).toBe(false);
  });

  it("empty filter matches everything", () => {
    expect(filter("", {})).toBe(true);
    expect(filter("", { a: 1 })).toBe(true);
  });

  it("forwards parse options (maxLength)", () => {
    expect(() => filter("a = 1", {}, { maxLength: 2 })).toThrow(InputLengthError);
  });

  it("forwards evaluate options (unknownFunction)", () => {
    expect(filter("unknown()", {}, { unknownFunction: "false" })).toBe(false);
  });

  it("forwards evaluate options (functions)", () => {
    expect(filter("check()", {}, { functions: { check: () => true } })).toBe(true);
  });

  it("forwards evaluate options (globalSearchFields)", () => {
    expect(filter("Madoka", { name: "Madoka", id: 1 }, { globalSearchFields: ["name"] })).toBe(
      true,
    );
    expect(filter("Madoka", { name: "Madoka", id: 1 }, { globalSearchFields: ["id"] })).toBe(false);
  });
});

describe("filterAsync", () => {
  it("works with async functions", async () => {
    const result = await filterAsync(
      "check()",
      {},
      {
        functions: { check: async () => true },
      },
    );
    expect(result).toBe(true);
  });

  it("forwards parse options", async () => {
    await expect(filterAsync("a = 1", {}, { maxLength: 2 })).rejects.toThrow(InputLengthError);
  });

  it("empty filter matches everything", async () => {
    expect(await filterAsync("", {})).toBe(true);
  });

  it("forwards evaluate options (unknownFunction)", async () => {
    expect(await filterAsync("unknown()", {}, { unknownFunction: "false" })).toBe(false);
  });

  it("forwards evaluate options (globalSearchFields)", async () => {
    expect(
      await filterAsync("Madoka", { name: "Madoka", id: 1 }, { globalSearchFields: ["name"] }),
    ).toBe(true);
    expect(
      await filterAsync("Madoka", { name: "Madoka", id: 1 }, { globalSearchFields: ["id"] }),
    ).toBe(false);
  });
});

describe("compile", () => {
  it("compiles and evaluates", () => {
    const f = compile("power >= 5");
    expect(f.evaluate({ power: 7 })).toBe(true);
    expect(f.evaluate({ power: 2 })).toBe(false);
  });

  it("compile once, evaluate many", () => {
    const f = compile("status = contracted");
    const items = [{ status: "contracted" }, { status: "fallen" }, { status: "contracted" }];
    const results = items.map((item) => f.evaluate(item));
    expect(results).toEqual([true, false, true]);
  });

  it("binds functions at compile time", () => {
    const f = compile("check()", { functions: { check: () => true } });
    expect(f.evaluate({})).toBe(true);
  });

  it("binds globalSearchFields at compile time", () => {
    const f = compile("Madoka", { globalSearchFields: ["name"] });
    expect(f.evaluate({ name: "Madoka" })).toBe(true);
    expect(f.evaluate({ other: "Madoka" })).toBe(false);
  });

  it("preserves expression", () => {
    const f = compile("a = 1 AND b:*");
    expect(f.expression).toBe("a = 1 AND b:*");
  });

  it("empty filter compiles to null ast", () => {
    const f = compile("");
    expect(f.ast).toBeNull();
    expect(f.evaluate({ anything: true })).toBe(true);
  });
});

describe("compile + evaluateAsync", () => {
  it("async functions passed at evaluate time", async () => {
    const f = compile("check()");
    const result = await f.evaluateAsync({}, { check: async () => true });
    expect(result).toBe(true);
  });

  it("compile-time options still apply", async () => {
    const f = compile("Madoka", { globalSearchFields: ["name"] });
    const result = await f.evaluateAsync({ name: "Madoka" });
    expect(result).toBe(true);
  });

  it("async functions override compile-time sync functions", async () => {
    const f = compile("check()", { functions: { check: () => false } });
    const result = await f.evaluateAsync({}, { check: async () => true });
    expect(result).toBe(true);
  });
});

describe("serialization", () => {
  it("round-trips through JSON", () => {
    const original = compile("a = 1 AND b:*");
    const json = JSON.stringify(original.toSerialized());
    const restored = CompiledFilter.fromSerialized(JSON.parse(json));
    expect(restored.evaluate({ a: 1, b: "x" })).toBe(true);
    expect(restored.evaluate({ a: 2, b: "x" })).toBe(false);
  });

  it("preserves expression through round-trip", () => {
    const original = compile("power >= 5");
    const restored = CompiledFilter.fromSerialized(original.toSerialized());
    expect(restored.expression).toBe("power >= 5");
  });

  it("serialized format has v, expression, ast", () => {
    const serialized = compile("a = 1").toSerialized();
    expect(serialized.v).toBe(1);
    expect(serialized.expression).toBe("a = 1");
    expect(serialized.ast).not.toBeNull();
    expect(serialized.ast!.type).toBe("restriction");
  });

  it("null ast round-trips (empty filter)", () => {
    const serialized = compile("").toSerialized();
    expect(serialized.ast).toBeNull();
    const restored = CompiledFilter.fromSerialized(serialized);
    expect(restored.evaluate({})).toBe(true);
  });

  it("fromSerialized with options (functions)", () => {
    const serialized = compile("check()").toSerialized();
    const restored = CompiledFilter.fromSerialized(serialized, {
      functions: { check: () => true },
    });
    expect(restored.evaluate({})).toBe(true);
  });

  it("complex expression round-trips", () => {
    const expr = 'power >= 5 AND name = "Madoka" AND corrupted = false';
    const original = compile(expr);
    const restored = CompiledFilter.fromSerialized(
      JSON.parse(JSON.stringify(original.toSerialized())),
    );
    expect(restored.evaluate({ power: 7, name: "Madoka", corrupted: false })).toBe(true);
    expect(restored.evaluate({ power: 7, name: "Madoka", corrupted: true })).toBe(false);
  });

  it("function calls round-trip", () => {
    const expr = "check('Madoka')";
    const serialized = compile(expr).toSerialized();
    const restored = CompiledFilter.fromSerialized(serialized, {
      functions: { check: (v: unknown) => v === "Madoka" },
    });
    expect(restored.evaluate({})).toBe(true);
  });
});

describe("fromSerialized validation", () => {
  it("rejects non-object input", () => {
    catchError(
      () => CompiledFilter.fromSerialized("bad" as unknown as SerializedFilter),
      InvalidFieldTypeError,
    );
    catchError(
      () => CompiledFilter.fromSerialized(42 as unknown as SerializedFilter),
      InvalidFieldTypeError,
    );
    catchError(
      () => CompiledFilter.fromSerialized(null as unknown as SerializedFilter),
      InvalidFieldTypeError,
    );
    catchError(
      () => CompiledFilter.fromSerialized([] as unknown as SerializedFilter),
      InvalidFieldTypeError,
    );
  });

  it("rejects missing v", () => {
    const err = catchError(
      () =>
        CompiledFilter.fromSerialized({ expression: "", ast: null } as unknown as SerializedFilter),
      UnsupportedVersionError,
    );
    expect(err.version).toBeUndefined();
  });

  it("rejects wrong v", () => {
    const err = catchError(
      () =>
        CompiledFilter.fromSerialized({
          v: 2,
          expression: "",
          ast: null,
        } as unknown as SerializedFilter),
      UnsupportedVersionError,
    );
    expect(err.version).toBe(2);
  });

  it("rejects missing expression", () => {
    const err = catchError(
      () => CompiledFilter.fromSerialized({ v: 1, ast: null } as unknown as SerializedFilter),
      InvalidFieldTypeError,
    );
    expect(err.path).toBe("expression");
    expect(err.expected).toBe("string");
  });

  it("rejects invalid AST node type", () => {
    const err = catchError(
      () =>
        CompiledFilter.fromSerialized({
          v: 1,
          expression: "x",
          ast: { type: "bogus", span: { start: 0, end: 1 } },
        } as unknown as SerializedFilter),
      UnknownNodeTypeError,
    );
    expect(err.nodeType).toBe("bogus");
    expect(err.path).toBe("ast");
  });

  it("rejects AST node missing required fields", () => {
    const err = catchError(
      () =>
        CompiledFilter.fromSerialized({
          v: 1,
          expression: "x",
          ast: { type: "value", span: { start: 0, end: 1 } },
        } as unknown as SerializedFilter),
      InvalidFieldTypeError,
    );
    expect(err.path).toBe("ast.value");
    expect(err.expected).toBe("string");
  });

  it("rejects AST with bad span", () => {
    const err = catchError(
      () =>
        CompiledFilter.fromSerialized({
          v: 1,
          expression: "x",
          ast: { type: "value", value: "x", quoted: false, span: "bad" },
        } as unknown as SerializedFilter),
      InvalidFieldTypeError,
    );
    expect(err.path).toBe("ast.span");
    expect(err.expected).toBe("span");
  });

  it("rejects AST with bad children type", () => {
    const err = catchError(
      () =>
        CompiledFilter.fromSerialized({
          v: 1,
          expression: "x",
          ast: { type: "and", children: "not-array", span: { start: 0, end: 1 } },
        } as unknown as SerializedFilter),
      InvalidFieldTypeError,
    );
    expect(err.path).toBe("ast.children");
    expect(err.expected).toBe("array");
  });

  it("rejects deeply nested invalid node", () => {
    const err = catchError(
      () =>
        CompiledFilter.fromSerialized({
          v: 1,
          expression: "x",
          ast: {
            type: "and",
            children: [
              { type: "value", value: "a", quoted: false, span: { start: 0, end: 1 } },
              { type: "INVALID", span: { start: 2, end: 3 } },
            ],
            span: { start: 0, end: 3 },
          },
        } as unknown as SerializedFilter),
      UnknownNodeTypeError,
    );
    expect(err.nodeType).toBe("INVALID");
    expect(err.path).toBe("ast.children[1]");
  });

  it("rejects not node missing child", () => {
    const err = catchError(
      () =>
        CompiledFilter.fromSerialized({
          v: 1,
          expression: "x",
          ast: { type: "not", span: { start: 0, end: 1 } },
        } as unknown as SerializedFilter),
      InvalidFieldTypeError,
    );
    expect(err.path).toBe("ast.child");
    expect(err.expected).toBe("object");
  });

  it("rejects restriction with invalid comparator", () => {
    const err = catchError(
      () =>
        CompiledFilter.fromSerialized({
          v: 1,
          expression: "x",
          ast: {
            type: "restriction",
            comparable: { type: "member", path: ["a"], span: { start: 0, end: 1 } },
            comparator: "INVALID",
            arg: { type: "value", value: "1", quoted: false, span: { start: 4, end: 5 } },
            span: { start: 0, end: 5 },
          },
        } as unknown as SerializedFilter),
      InvalidFieldTypeError,
    );
    expect(err.path).toBe("ast.comparator");
    expect(err.expected).toBe("comparator");
  });

  it("rejects global node missing value", () => {
    const err = catchError(
      () =>
        CompiledFilter.fromSerialized({
          v: 1,
          expression: "x",
          ast: { type: "global", span: { start: 0, end: 1 } },
        } as unknown as SerializedFilter),
      InvalidFieldTypeError,
    );
    expect(err.path).toBe("ast.value");
    expect(err.expected).toBe("object");
  });

  it("rejects member with non-string path elements", () => {
    const err = catchError(
      () =>
        CompiledFilter.fromSerialized({
          v: 1,
          expression: "x",
          ast: { type: "member", path: [1, 2], span: { start: 0, end: 1 } },
        } as unknown as SerializedFilter),
      InvalidFieldTypeError,
    );
    expect(err.path).toBe("ast.path[0]");
    expect(err.expected).toBe("string");
  });

  it("rejects function node with non-string qualifiedName", () => {
    const err = catchError(
      () =>
        CompiledFilter.fromSerialized({
          v: 1,
          expression: "x",
          ast: {
            type: "function",
            name: ["fn"],
            qualifiedName: 42,
            args: [],
            span: { start: 0, end: 1 },
          },
        } as unknown as SerializedFilter),
      InvalidFieldTypeError,
    );
    expect(err.path).toBe("ast.qualifiedName");
    expect(err.expected).toBe("string");
  });

  it("rejects function node with non-array name", () => {
    const err = catchError(
      () =>
        CompiledFilter.fromSerialized({
          v: 1,
          expression: "x",
          ast: {
            type: "function",
            name: "bad",
            qualifiedName: "fn",
            args: [],
            span: { start: 0, end: 1 },
          },
        } as unknown as SerializedFilter),
      InvalidFieldTypeError,
    );
    expect(err.path).toBe("ast.name");
    expect(err.expected).toBe("array");
  });

  it("rejects or node with non-array children", () => {
    const err = catchError(
      () =>
        CompiledFilter.fromSerialized({
          v: 1,
          expression: "x",
          ast: { type: "or", children: "bad", span: { start: 0, end: 1 } },
        } as unknown as SerializedFilter),
      InvalidFieldTypeError,
    );
    expect(err.path).toBe("ast.children");
    expect(err.expected).toBe("array");
  });

  it("rejects non-string expression (number)", () => {
    const err = catchError(
      () =>
        CompiledFilter.fromSerialized({
          v: 1,
          expression: 42,
          ast: null,
        } as unknown as SerializedFilter),
      InvalidFieldTypeError,
    );
    expect(err.path).toBe("expression");
    expect(err.expected).toBe("string");
  });

  it("accepts valid null ast", () => {
    const f = CompiledFilter.fromSerialized({ v: 1, expression: "", ast: null });
    expect(f.evaluate({})).toBe(true);
  });
});
