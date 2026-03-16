import { describe, expect, it } from "vitest";
import { UnknownFunctionError, evaluate, evaluateAsync } from "../src";
import { matches, matchesAsync } from "./helpers";

describe("evaluate", () => {
  describe("empty filter", () => {
    it("null AST matches everything", () => {
      expect(evaluate(null, {})).toBe(true);
      expect(evaluate(null, { a: 1 })).toBe(true);
    });
  });

  describe("simple restrictions", () => {
    it("equals match", () => {
      expect(matches("power = 5", { power: 5 })).toBe(true);
    });

    it("equals mismatch", () => {
      expect(matches("power = 5", { power: 6 })).toBe(false);
    });

    it("string match", () => {
      expect(matches('name = "Madoka"', { name: "Madoka" })).toBe(true);
    });

    it("string mismatch", () => {
      expect(matches('name = "Madoka"', { name: "Homura" })).toBe(false);
    });

    it("boolean match", () => {
      expect(matches("active = true", { active: true })).toBe(true);
    });

    it("boolean mismatch", () => {
      expect(matches("active = true", { active: false })).toBe(false);
    });
  });

  describe("each comparator with numbers", () => {
    it("equals", () => {
      expect(matches("a = 10", { a: 10 })).toBe(true);
      expect(matches("a = 10", { a: 11 })).toBe(false);
    });

    it("not equals", () => {
      expect(matches("a != 10", { a: 11 })).toBe(true);
      expect(matches("a != 10", { a: 10 })).toBe(false);
    });

    it("less than", () => {
      expect(matches("a < 10", { a: 5 })).toBe(true);
      expect(matches("a < 10", { a: 10 })).toBe(false);
      expect(matches("a < 10", { a: 15 })).toBe(false);
    });

    it("less equals", () => {
      expect(matches("a <= 10", { a: 10 })).toBe(true);
      expect(matches("a <= 10", { a: 5 })).toBe(true);
      expect(matches("a <= 10", { a: 15 })).toBe(false);
    });

    it("greater than", () => {
      expect(matches("a > 10", { a: 15 })).toBe(true);
      expect(matches("a > 10", { a: 10 })).toBe(false);
    });

    it("greater equals", () => {
      expect(matches("a >= 10", { a: 10 })).toBe(true);
      expect(matches("a >= 10", { a: 15 })).toBe(true);
      expect(matches("a >= 10", { a: 5 })).toBe(false);
    });
  });

  describe("comparators with strings", () => {
    it("string equals", () => {
      expect(matches('a = "foo"', { a: "foo" })).toBe(true);
      expect(matches('a = "foo"', { a: "bar" })).toBe(false);
    });

    it("string not equals", () => {
      expect(matches('a != "foo"', { a: "bar" })).toBe(true);
    });

    it("string ordering", () => {
      expect(matches('a > "bar"', { a: "foo" })).toBe(true);
      expect(matches('a < "foo"', { a: "bar" })).toBe(true);
    });
  });

  describe("type coercion", () => {
    it("number field with text arg", () => {
      expect(matches("grief = 30", { grief: 30 })).toBe(true);
    });

    it("boolean field with text arg", () => {
      expect(matches("active = true", { active: true })).toBe(true);
      expect(matches("active = false", { active: false })).toBe(true);
    });

    it("string field with unquoted arg", () => {
      expect(matches("name = Madoka", { name: "Madoka" })).toBe(true);
    });

    it("float coercion", () => {
      expect(matches("count = 3.14", { count: 3.14 })).toBe(true);
    });
  });

  describe("field traversal", () => {
    it("nested field", () => {
      expect(matches("a.b = 1", { a: { b: 1 } })).toBe(true);
    });

    it("deep nested field", () => {
      expect(matches('a.b.c = "x"', { a: { b: { c: "x" } } })).toBe(true);
    });

    it("unset intermediate returns false", () => {
      expect(matches("a.b = 1", { a: null })).toBe(false);
    });

    it("unset intermediate with != still returns false", () => {
      expect(matches("a.b != 1", { a: null })).toBe(false);
    });

    it("missing field returns false", () => {
      expect(matches("a.b = 1", {})).toBe(false);
    });

    it("missing top-level field returns false", () => {
      expect(matches("x = 1", {})).toBe(false);
    });
  });

  describe("has operator (:): arrays", () => {
    it("array contains value", () => {
      expect(matches("tags:foo", { tags: ["foo", "bar"] })).toBe(true);
    });

    it("array does not contain value", () => {
      expect(matches("tags:baz", { tags: ["foo", "bar"] })).toBe(false);
    });

    it("array contains number", () => {
      expect(matches("tags:42", { tags: [1, 42, 3] })).toBe(true);
    });

    it("array presence with *", () => {
      expect(matches("tags:*", { tags: ["foo"] })).toBe(true);
    });

    it("empty array is not present", () => {
      expect(matches("tags:*", { tags: [] })).toBe(false);
    });

    it("array of objects: r.foo:42 fans out", () => {
      expect(matches("r.foo:42", { r: [{ foo: 42 }, { foo: 99 }] })).toBe(true);
    });

    it("array of objects: no match", () => {
      expect(matches("r.foo:42", { r: [{ foo: 1 }, { foo: 2 }] })).toBe(false);
    });

    it("array of objects: presence check", () => {
      expect(matches("r.foo:*", { r: [{ foo: "a" }, { bar: "b" }] })).toBe(true);
    });

    it("array of objects: deep path", () => {
      expect(matches("r.a.b:1", { r: [{ a: { b: 1 } }, { a: { b: 2 } }] })).toBe(true);
      expect(matches("r.a.b:3", { r: [{ a: { b: 1 } }, { a: { b: 2 } }] })).toBe(false);
    });

    it("nested array field: items.tags:foo", () => {
      expect(
        matches("items.tags:foo", { items: [{ tags: ["foo", "bar"] }, { tags: ["baz"] }] }),
      ).toBe(true);
      expect(matches("items.tags:qux", { items: [{ tags: ["foo"] }, { tags: ["bar"] }] })).toBe(
        false,
      );
    });
  });

  describe("has operator (:): maps/objects", () => {
    it("key exists", () => {
      expect(matches("m:foo", { m: { foo: 1 } })).toBe(true);
    });

    it("key does not exist", () => {
      expect(matches("m:bar", { m: { foo: 1 } })).toBe(false);
    });

    it("nested key with *", () => {
      expect(matches("m.foo:*", { m: { foo: 1 } })).toBe(true);
    });

    it("nested key value check", () => {
      expect(matches("m.foo:42", { m: { foo: 42 } })).toBe(true);
      expect(matches("m.foo:42", { m: { foo: 99 } })).toBe(false);
    });
  });

  describe("has operator (:): presence with *", () => {
    it("string field present", () => {
      expect(matches("name:*", { name: "Madoka" })).toBe(true);
    });

    it("missing field", () => {
      expect(matches("name:*", {})).toBe(false);
    });

    it("null field", () => {
      expect(matches("name:*", { name: null })).toBe(false);
    });

    it("empty string is not present", () => {
      expect(matches("name:*", { name: "" })).toBe(false);
    });

    it("number field present", () => {
      expect(matches("rank:*", { rank: 0 })).toBe(true);
    });

    it("boolean field present", () => {
      expect(matches("active:*", { active: false })).toBe(true);
    });
  });

  describe("wildcard matching", () => {
    it("suffix wildcard", () => {
      expect(matches('name = "*.foo"', { name: "bar.foo" })).toBe(true);
      expect(matches('name = "*.foo"', { name: "bar.baz" })).toBe(false);
    });

    it("prefix wildcard", () => {
      expect(matches('name = "foo.*"', { name: "foo.bar" })).toBe(true);
      expect(matches('name = "foo.*"', { name: "baz.bar" })).toBe(false);
    });

    it("star matches anything", () => {
      expect(matches('name = "*"', { name: "anything" })).toBe(true);
    });

    it("both ends wildcard", () => {
      expect(matches('name = "*mid*"', { name: "premidpost" })).toBe(true);
      expect(matches('name = "*mid*"', { name: "nothing" })).toBe(false);
    });
  });

  describe("AND / OR / NOT", () => {
    it("AND both true", () => {
      expect(matches("a = 1 AND b = 2", { a: 1, b: 2 })).toBe(true);
    });

    it("AND one false", () => {
      expect(matches("a = 1 AND b = 2", { a: 1, b: 3 })).toBe(false);
    });

    it("OR one true", () => {
      expect(matches("a = 1 OR b = 2", { a: 1, b: 3 })).toBe(true);
    });

    it("OR both false", () => {
      expect(matches("a = 1 OR b = 2", { a: 3, b: 3 })).toBe(false);
    });

    it("NOT true", () => {
      expect(matches("NOT a = 1", { a: 2 })).toBe(true);
    });

    it("NOT false", () => {
      expect(matches("NOT a = 1", { a: 1 })).toBe(false);
    });
  });

  describe("precedence: OR binds tighter than AND", () => {
    it("a = 1 AND b = 2 OR b = 3: matches { a: 1, b: 3 }", () => {
      expect(matches("a = 1 AND b = 2 OR b = 3", { a: 1, b: 3 })).toBe(true);
    });

    it("a = 1 AND b = 2 OR b = 3: fails { a: 2, b: 2 }", () => {
      expect(matches("a = 1 AND b = 2 OR b = 3", { a: 2, b: 2 })).toBe(false);
    });
  });

  describe("global restrictions", () => {
    it("bare text matches field value", () => {
      expect(matches("Madoka", { name: "Madoka", power: 7 })).toBe(true);
    });

    it("bare text no match", () => {
      expect(matches("Madoka", { name: "Homura", power: 7 })).toBe(false);
    });

    it("number coerced to string for search", () => {
      expect(matches("7", { name: "Madoka", power: 7 })).toBe(true);
    });

    it("partial match in string field", () => {
      expect(matches("Mad", { name: "Madoka" })).toBe(true);
    });

    it("custom globalSearchFields", () => {
      expect(
        matches("Madoka", { name: "Madoka", secret: "Madoka" }, { globalSearchFields: ["name"] }),
      ).toBe(true);
      expect(
        matches("Madoka", { name: "Homura", secret: "Madoka" }, { globalSearchFields: ["name"] }),
      ).toBe(false);
    });
  });

  describe("function calls", () => {
    it("custom function returning truthy", () => {
      expect(matches("active()", {}, { functions: { active: () => true } })).toBe(true);
    });

    it("custom function returning falsy", () => {
      expect(matches("active()", {}, { functions: { active: () => false } })).toBe(false);
    });

    it("unknown function throws by default", () => {
      expect(() => matches("unknown()", {})).toThrow(UnknownFunctionError);
    });

    it("unknown function returns false with option", () => {
      expect(matches("unknown()", {}, { unknownFunction: "false" })).toBe(false);
    });

    it("function with args", () => {
      const fn = (...args: unknown[]) => args[0] === "hello";
      expect(matches("check('hello')", {}, { functions: { check: fn } })).toBe(true);
      expect(matches("check('world')", {}, { functions: { check: fn } })).toBe(false);
    });

    it("qualified function name", () => {
      const fn = () => true;
      expect(matches("math.check()", {}, { functions: { "math.check": fn } })).toBe(true);
    });

    it("keyword function name NOT(): no space", () => {
      const fn = () => true;
      expect(matches("NOT()", {}, { functions: { NOT: fn } })).toBe(true);
    });

    it("keyword function name AND(): no space", () => {
      const fn = () => true;
      expect(matches("AND()", {}, { functions: { AND: fn } })).toBe(true);
    });

    it("NOT (a) with space is still negation", () => {
      expect(matches("NOT (a = 1)", { a: 2 })).toBe(true);
      expect(matches("NOT (a = 1)", { a: 1 })).toBe(false);
    });
  });

  describe("complex spec expressions", () => {
    it('rank >= 3 AND name = "Madoka"', () => {
      expect(matches('rank >= 3 AND name = "Madoka"', { rank: 5, name: "Madoka" })).toBe(true);
      expect(matches('rank >= 3 AND name = "Madoka"', { rank: 1, name: "Madoka" })).toBe(false);
      expect(matches('rank >= 3 AND name = "Madoka"', { rank: 5, name: "Homura" })).toBe(false);
    });

    it("m.foo:*", () => {
      expect(matches("m.foo:*", { m: { foo: "bar" } })).toBe(true);
      expect(matches("m.foo:*", { m: { baz: 1 } })).toBe(false);
    });

    it("NOT (a = 1 OR b = 2)", () => {
      expect(matches("NOT (a = 1 OR b = 2)", { a: 3, b: 4 })).toBe(true);
      expect(matches("NOT (a = 1 OR b = 2)", { a: 1, b: 4 })).toBe(false);
      expect(matches("NOT (a = 1 OR b = 2)", { a: 3, b: 2 })).toBe(false);
    });

    it("a < 10 OR a >= 100", () => {
      expect(matches("a < 10 OR a >= 100", { a: 5 })).toBe(true);
      expect(matches("a < 10 OR a >= 100", { a: 100 })).toBe(true);
      expect(matches("a < 10 OR a >= 100", { a: 50 })).toBe(false);
    });
  });

  describe("edge cases", () => {
    it("empty object matches empty filter", () => {
      expect(evaluate(null, {})).toBe(true);
    });

    it("null field value", () => {
      expect(matches("a = 1", { a: null })).toBe(false);
    });

    it("nested traversal through null", () => {
      expect(matches("a.b.c = 1", { a: { b: null } })).toBe(false);
    });

    it("field exists but is undefined", () => {
      expect(matches("a = 1", { a: undefined })).toBe(false);
    });

    it("null field skipped for != (spec: unset = non-match)", () => {
      expect(matches("a != 1", { a: null })).toBe(false);
    });

    it("null field skipped for > (spec: unset = non-match)", () => {
      expect(matches("a > 1", { a: null })).toBe(false);
    });

    it("null leaf field skipped for !=", () => {
      expect(matches("a.b != 1", { a: { b: null } })).toBe(false);
    });

    it("incompatible types with <= returns false", () => {
      expect(matches('a <= "hello"', { a: 42 })).toBe(false);
    });

    it("incompatible types with >= returns false", () => {
      expect(matches('a >= "hello"', { a: 42 })).toBe(false);
    });
  });

  describe("mid-pattern wildcards", () => {
    it("wildcard in the middle", () => {
      expect(matches('name = "foo*bar"', { name: "foo123bar" })).toBe(true);
    });

    it("wildcard in the middle: no match", () => {
      expect(matches('name = "foo*bar"', { name: "foobaz" })).toBe(false);
    });

    it("multiple wildcards", () => {
      expect(matches('name = "a*b*c"', { name: "aXbYc" })).toBe(true);
    });

    it("multiple wildcards: no match", () => {
      expect(matches('name = "a*b*c"', { name: "aXcYb" })).toBe(false);
    });

    it("wildcard with regex-special chars in pattern", () => {
      expect(matches('name = "foo*[bar]"', { name: "foo123[bar]" })).toBe(true);
      expect(matches('name = "foo*[bar]"', { name: "foo123bar" })).toBe(false);
    });
  });

  describe("global restrictions: recursive search", () => {
    it("matches nested string field", () => {
      expect(matches("Madoka", { user: { name: "Madoka" } })).toBe(true);
    });

    it("no match in nested field", () => {
      expect(matches("Madoka", { user: { name: "Homura" } })).toBe(false);
    });

    it("matches number in nested array", () => {
      expect(matches("42", { data: { counts: [42, 99] } })).toBe(true);
    });

    it("globalSearchFields still limits to top-level", () => {
      expect(
        matches(
          "Madoka",
          { name: "Homura", user: { name: "Madoka" } },
          { globalSearchFields: ["name"] },
        ),
      ).toBe(false);
    });
  });

  describe("dotted member as bare global restriction", () => {
    it("truthy nested field matches", () => {
      expect(matches("a.b", { a: { b: "hello" } })).toBe(true);
    });

    it("null nested field does not match", () => {
      expect(matches("a.b", { a: { b: null } })).toBe(false);
    });

    it("missing nested field does not match", () => {
      expect(matches("a.b", { a: {} })).toBe(false);
    });

    it("missing top-level does not match", () => {
      expect(matches("a.b", { x: 1 })).toBe(false);
    });
  });

  describe("function as LHS of comparison", () => {
    it("fn() = 42: match", () => {
      expect(matches("fn() = 42", {}, { functions: { fn: () => 42 } })).toBe(true);
    });

    it("fn() = 42: mismatch", () => {
      expect(matches("fn() = 42", {}, { functions: { fn: () => 99 } })).toBe(false);
    });

    it("fn() != 42", () => {
      expect(matches("fn() != 42", {}, { functions: { fn: () => 99 } })).toBe(true);
    });

    it("fn() > 10", () => {
      expect(matches("fn() > 10", {}, { functions: { fn: () => 20 } })).toBe(true);
      expect(matches("fn() > 10", {}, { functions: { fn: () => 5 } })).toBe(false);
    });

    it("fn():*: present", () => {
      expect(matches("fn():*", {}, { functions: { fn: () => "yes" } })).toBe(true);
    });

    it("fn():*: null result", () => {
      expect(matches("fn():*", {}, { functions: { fn: () => null } })).toBe(false);
    });

    it("qualified function math.check() = ok", () => {
      expect(matches("math.check() = ok", {}, { functions: { "math.check": () => "ok" } })).toBe(
        true,
      );
    });
  });

  describe("has operator: null field values", () => {
    it("null field with has equality: non-match", () => {
      expect(matches("a:foo", { a: null })).toBe(false);
    });

    it("null field with has presence: non-match", () => {
      expect(matches("a:*", { a: null })).toBe(false);
    });

    it("null nested field with has: non-match", () => {
      expect(matches("a.b:foo", { a: { b: null } })).toBe(false);
    });

    it("null nested field with has presence: non-match", () => {
      expect(matches("a.b:*", { a: { b: null } })).toBe(false);
    });

    it("null intermediate in has path: non-match", () => {
      expect(matches("a.b:foo", { a: null })).toBe(false);
    });

    it("null field in array fanout path: non-match", () => {
      expect(matches("r.foo:42", { r: [{ foo: null }, { foo: 99 }] })).toBe(false);
      expect(matches("r.foo:42", { r: [{ foo: null }, { foo: 42 }] })).toBe(true);
    });
  });

  describe("member as RHS of comparison", () => {
    it("bare text on RHS is a literal, not a field reference", () => {
      // "a = b" -> b is the literal string "b", not field b
      expect(matches("a = b", { a: "b" })).toBe(true);
      expect(matches("a = b", { a: "hello", b: "hello" })).toBe(false);
    });

    it("dotted member on RHS is literal by default", () => {
      expect(matches("a = b.c", { a: "b.c" })).toBe(true);
      expect(matches("a = b.c", { a: 42, b: { c: 42 } })).toBe(false);
    });

    it("dotted member on RHS resolves with opt-in", () => {
      const opts = { resolveRhsMembers: true };
      expect(matches("a = b.c", { a: 42, b: { c: 42 } }, opts)).toBe(true);
    });

    it("dotted member on RHS resolves to different value: mismatch", () => {
      const opts = { resolveRhsMembers: true };
      expect(matches("a = b.c", { a: 42, b: { c: 99 } }, opts)).toBe(false);
    });

    it("unresolved member arg produces undefined with opt-in: non-match for =", () => {
      const opts = { resolveRhsMembers: true };
      expect(matches("a = b.c", { a: "hello" }, opts)).toBe(false);
    });

    it("unresolved member arg with != and opt-in: values differ so true", () => {
      const opts = { resolveRhsMembers: true };
      // b.c doesn't exist -> undefined. "hello" != undefined -> true
      expect(matches("a != b.c", { a: "hello" }, opts)).toBe(true);
    });
  });

  describe("numeric literal edge cases", () => {
    it("dotted float as arg", () => {
      expect(matches("a = 2.5", { a: 2.5 })).toBe(true);
    });

    it("scientific notation as arg", () => {
      expect(matches("a = 2.997e9", { a: 2.997e9 })).toBe(true);
    });

    it("negative number via minus (negation, not literal)", () => {
      expect(matches("-a = 1", { a: 1 })).toBe(false);
      expect(matches("-a = 1", { a: 2 })).toBe(true);
    });

    it("dotted non-number stays as member path with opt-in", () => {
      expect(matches("a = b.c", { a: "x", b: { c: "x" } }, { resolveRhsMembers: true })).toBe(true);
    });

    it("integer coercion", () => {
      expect(matches("a = 42", { a: 42 })).toBe(true);
      expect(matches("a = 42", { a: 43 })).toBe(false);
    });
  });

  describe("type coercion edge cases", () => {
    it("boolean coercion is case-sensitive", () => {
      expect(matches("active = TRUE", { active: true })).toBe(false);
      expect(matches("active = False", { active: false })).toBe(false);
    });

    it("non-numeric string does not coerce to number", () => {
      expect(matches("hope = hello", { hope: 42 })).toBe(false);
    });

    it("numeric string coerces to number for comparison", () => {
      expect(matches("grief > 10", { grief: 20 })).toBe(true);
    });

    it("string field compared to unquoted text", () => {
      expect(matches("name = Madoka", { name: "Madoka" })).toBe(true);
      expect(matches("name = Madoka", { name: "madoka" })).toBe(false);
    });
  });

  describe("has operator: array of objects without traversal", () => {
    it("r:foo checks key presence in object elements", () => {
      expect(matches("r:foo", { r: [{ foo: 42 }, { bar: 1 }] })).toBe(true);
    });

    it("r:baz: key not found in any element", () => {
      expect(matches("r:baz", { r: [{ foo: 42 }, { bar: 1 }] })).toBe(false);
    });

    it("r:42 on array of objects: checks key '42', not value", () => {
      expect(matches("r:42", { r: [{ foo: 42 }] })).toBe(false);
    });
  });

  describe("has operator: primitives", () => {
    it("string field: exact match", () => {
      expect(matches("name:Madoka", { name: "Madoka" })).toBe(true);
    });

    it("string field: substring does not match (use wildcards)", () => {
      expect(matches("name:ado", { name: "Madoka" })).toBe(false);
    });

    it("string field: case sensitive", () => {
      expect(matches("name:madoka", { name: "Madoka" })).toBe(false);
      expect(matches("name:MADOKA", { name: "Madoka" })).toBe(false);
    });

    it("string field: no match", () => {
      expect(matches("name:xyz", { name: "Madoka" })).toBe(false);
    });

    it("number field has value", () => {
      expect(matches("power:7", { power: 7 })).toBe(true);
    });

    it("number field does not have value", () => {
      expect(matches("power:7", { power: 99 })).toBe(false);
    });

    it("boolean field has true", () => {
      expect(matches("active:true", { active: true })).toBe(true);
    });

    it("boolean field has false", () => {
      expect(matches("active:false", { active: false })).toBe(true);
    });
  });

  describe("function with composite argument", () => {
    it("function receives boolean from AND expression", () => {
      const fn = (...args: unknown[]) => args[0] === true;
      expect(
        matches("check((a = 1 AND b = 2))", { a: 1, b: 2 }, { functions: { check: fn } }),
      ).toBe(true);
      expect(
        matches("check((a = 1 AND b = 2))", { a: 1, b: 3 }, { functions: { check: fn } }),
      ).toBe(false);
    });
  });

  describe("implicit AND with mixed restrictions", () => {
    it("bare value AND restriction", () => {
      expect(matches("Madoka power = 7", { name: "Madoka", power: 7 })).toBe(true);
      expect(matches("Madoka power = 7", { name: "Homura", power: 7 })).toBe(false);
    });

    it("multiple bare values", () => {
      expect(matches("Homura Madoka", { name: "Homura Madoka" })).toBe(true);
      expect(matches("Homura Madoka", { name: "Madoka" })).toBe(false);
    });
  });

  describe("wildcard != (opt-in)", () => {
    it("!= without flag uses strict equality", () => {
      expect(matches('name != "*.foo"', { name: "bar.foo" })).toBe(true);
      expect(matches('name != "*.foo"', { name: "*.foo" })).toBe(false);
    });

    it("!= with wildcardNotEquals uses wildcard matching", () => {
      const opts = { wildcardNotEquals: true };
      expect(matches('name != "*.foo"', { name: "bar.foo" }, opts)).toBe(false);
      expect(matches('name != "*.foo"', { name: "bar.baz" }, opts)).toBe(true);
    });
  });

  describe("negative numeric literals on RHS", () => {
    it("a = -30", () => {
      expect(matches("a = -30", { a: -30 })).toBe(true);
      expect(matches("a = -30", { a: 30 })).toBe(false);
    });

    it("a > -10", () => {
      expect(matches("a > -10", { a: 0 })).toBe(true);
      expect(matches("a > -10", { a: -20 })).toBe(false);
    });

    it("a = -3.14", () => {
      expect(matches("a = -3.14", { a: -3.14 })).toBe(true);
    });

    it("fn(-30) passes negative arg", () => {
      const fn = (...args: unknown[]) => args[0] === "-30";
      expect(matches("fn(-30)", {}, { functions: { fn } })).toBe(true);
    });
  });

  describe("has operator: array string elements", () => {
    it("exact match on string element", () => {
      expect(matches("tags:foo", { tags: ["foo", "bar"] })).toBe(true);
    });

    it("substring does not match (use wildcards)", () => {
      expect(matches("tags:fo", { tags: ["foo", "bar"] })).toBe(false);
    });

    it("case sensitive", () => {
      expect(matches("tags:FOO", { tags: ["foo", "bar"] })).toBe(false);
    });

    it("no match", () => {
      expect(matches("tags:xyz", { tags: ["foo", "bar"] })).toBe(false);
    });
  });

  describe("has operator: function result", () => {
    it("fn():value where fn returns array", () => {
      const fn = () => ["foo", "bar"];
      expect(matches("fn():foo", {}, { functions: { fn } })).toBe(true);
      expect(matches("fn():baz", {}, { functions: { fn } })).toBe(false);
    });

    it("fn():key where fn returns object", () => {
      const fn = () => ({ hello: 1 });
      expect(matches("fn():hello", {}, { functions: { fn } })).toBe(true);
      expect(matches("fn():nope", {}, { functions: { fn } })).toBe(false);
    });
  });

  describe("empty string comparisons", () => {
    it('a = "" matches empty string', () => {
      expect(matches('a = ""', { a: "" })).toBe(true);
      expect(matches('a = ""', { a: "x" })).toBe(false);
    });

    it('a != "" matches non-empty string', () => {
      expect(matches('a != ""', { a: "x" })).toBe(true);
      expect(matches('a != ""', { a: "" })).toBe(false);
    });

    it('a:"": has with empty string on string field (exact equality)', () => {
      expect(matches('a:""', { a: "hello" })).toBe(false);
      expect(matches('a:""', { a: "" })).toBe(true);
    });

    it('a:"": has with empty string on null field', () => {
      expect(matches('a:""', { a: null })).toBe(false);
    });
  });

  describe("deeply nested array fanout", () => {
    it("multi-level fanout: a.b.c:1", () => {
      const target = {
        a: [{ b: [{ c: 1 }, { c: 2 }] }, { b: [{ c: 3 }] }],
      };
      expect(matches("a.b.c:1", target)).toBe(true);
      expect(matches("a.b.c:3", target)).toBe(true);
      expect(matches("a.b.c:99", target)).toBe(false);
    });
  });

  describe("dot must not traverse arrays (spec compliance)", () => {
    it("a.0.foo = 42 does not traverse into array by index", () => {
      expect(matches("a.0.foo = 42", { a: [{ foo: 42 }] })).toBe(false);
    });

    it("a.0 = x does not resolve array element", () => {
      expect(matches("a.0 = x", { a: ["x", "y"] })).toBe(false);
    });

    it("has operator still fans out through arrays", () => {
      expect(matches("a.foo:42", { a: [{ foo: 42 }] })).toBe(true);
    });
  });

  describe("unquoted vs quoted wildcards", () => {
    it("a = * (unquoted) does NOT wildcard-match", () => {
      expect(matches("a = *", { a: "anything" })).toBe(false);
    });

    it('a = "*" (quoted) wildcard-matches any string', () => {
      expect(matches('a = "*"', { a: "anything" })).toBe(true);
    });

    it("a = * matches literal asterisk", () => {
      expect(matches("a = *", { a: "*" })).toBe(true);
    });

    it("a = foo* (unquoted) does NOT wildcard-match", () => {
      expect(matches("a = foo*", { a: "foobar" })).toBe(false);
    });

    it('a = "foo*" (quoted) does wildcard-match', () => {
      expect(matches('a = "foo*"', { a: "foobar" })).toBe(true);
    });

    it("a = foo* with literal value foo*", () => {
      expect(matches("a = foo*", { a: "foo*" })).toBe(true);
    });
  });

  describe("prototype-key protection", () => {
    it("constructor.name does not traverse prototype", () => {
      expect(matches('constructor.name = "Object"', {})).toBe(false);
    });

    it("toString does not traverse prototype", () => {
      expect(matches('toString = "x"', {})).toBe(false);
    });

    it("own property named constructor still works", () => {
      expect(matches('constructor = "x"', { constructor: "x" })).toBe(true);
    });
  });

  describe("NaN/Infinity edge cases", () => {
    it("a > 0 with NaN field", () => {
      expect(matches("a > 0", { a: NaN })).toBe(false);
    });

    it("a = NaN: NaN !== NaN", () => {
      expect(matches("a = NaN", { a: NaN })).toBe(false);
    });
  });

  describe("globalSearchFields with non-existent field", () => {
    it("returns false when configured fields don't exist", () => {
      expect(matches("Madoka", { name: "Madoka" }, { globalSearchFields: ["nonexistent"] })).toBe(
        false,
      );
    });
  });

  describe("has operator prototype-key protection", () => {
    it("m:constructor does not match via prototype", () => {
      expect(matches("m:constructor", { m: { a: 1 } })).toBe(false);
    });

    it("m:toString does not match via prototype", () => {
      expect(matches("m:toString", { m: { a: 1 } })).toBe(false);
    });

    it("tags:constructor does not match via prototype on array elements", () => {
      expect(matches("tags:constructor", { tags: [{ a: 1 }] })).toBe(false);
    });

    it("own property named constructor still works", () => {
      expect(matches("m:constructor", { m: { constructor: "yes" } })).toBe(true);
    });
  });

  describe("searchValues depth limit", () => {
    it("does not crash on deeply nested objects", () => {
      let obj: Record<string, unknown> = { value: "needle" };
      for (let i = 0; i < 100; i++) {
        obj = { nested: obj };
      }
      expect(matches("needle", obj)).toBe(false);
    });

    it("still finds values within depth limit", () => {
      const obj = { a: { b: { c: "needle" } } };
      expect(matches("needle", obj)).toBe(true);
    });

    it("respects custom maxTraversalDepth", () => {
      const obj = { a: { b: { c: "needle" } } };
      expect(matches("needle", obj, { maxTraversalDepth: 2 })).toBe(false);
      expect(matches("needle", obj, { maxTraversalDepth: 4 })).toBe(true);
    });
  });

  describe("unset fields return false for all operators", () => {
    it("a < 10 with missing field", () => {
      expect(matches("a < 10", {})).toBe(false);
    });

    it("a <= 10 with missing field", () => {
      expect(matches("a <= 10", {})).toBe(false);
    });

    it("a >= 10 with missing field", () => {
      expect(matches("a >= 10", {})).toBe(false);
    });

    it("a:foo with missing field", () => {
      expect(matches("a:foo", {})).toBe(false);
    });
  });

  describe("numeric map key evaluation", () => {
    it("expr.type_map.1.type resolves numeric string key", () => {
      expect(
        matches("expr.type_map.1.type = INT", {
          expr: { type_map: { "1": { type: "INT" } } },
        }),
      ).toBe(true);
    });

    it("numeric key mismatch", () => {
      expect(
        matches("expr.type_map.1.type = INT", {
          expr: { type_map: { "2": { type: "INT" } } },
        }),
      ).toBe(false);
    });

    it("numeric key with has operator", () => {
      expect(matches("m.1:*", { m: { "1": "present" } })).toBe(true);
      expect(matches("m.1:*", { m: { "2": "present" } })).toBe(false);
    });
  });

  describe("has operator with wildcards on array elements", () => {
    it('tags:"foo*" does not wildcard-match array elements', () => {
      expect(matches('tags:"foo*"', { tags: ["foobar", "baz"] })).toBe(false);
    });

    it('tags:"foo" exact match still works', () => {
      expect(matches('tags:"foo"', { tags: ["foo", "bar"] })).toBe(true);
    });

    it('r.name:"prod*" does not wildcard-match in array fanout', () => {
      expect(matches('r.name:"prod*"', { r: [{ name: "prod-east" }, { name: "staging" }] })).toBe(
        false,
      );
    });
  });

  describe("quoted string member on LHS", () => {
    it('"key".field resolves through object', () => {
      expect(matches('"a".b = 1', { a: { b: 1 } })).toBe(true);
    });

    it('"key".field mismatch', () => {
      expect(matches('"a".b = 1', { a: { b: 2 } })).toBe(false);
    });

    it('"key" without dots works as field name', () => {
      expect(matches('"name" = Madoka', { name: "Madoka" })).toBe(true);
    });
  });

  describe("has operator does not apply wildcards", () => {
    it('a:"foo*" does not wildcard-match primitives', () => {
      expect(matches('a:"foo*"', { a: "foobar" })).toBe(false);
    });

    it('a:"*" is presence check, not wildcard', () => {
      expect(matches('a:"*"', { a: "anything" })).toBe(true);
    });
  });

  describe("function as LHS returning null (non-has comparators)", () => {
    it("fn() = 42 where fn returns null -> false", () => {
      expect(matches("fn() = 42", {}, { functions: { fn: () => null } })).toBe(false);
    });

    it("fn() != 42 where fn returns null -> false", () => {
      expect(matches("fn() != 42", {}, { functions: { fn: () => null } })).toBe(false);
    });

    it("fn() > 0 where fn returns null -> false", () => {
      expect(matches("fn() > 0", {}, { functions: { fn: () => null } })).toBe(false);
    });
  });

  describe("isPresent edge cases", () => {
    it("empty object is not present", () => {
      expect(matches("a:*", { a: {} })).toBe(false);
    });

    it("non-empty object is present", () => {
      expect(matches("a:*", { a: { x: 1 } })).toBe(true);
    });
  });

  describe("globalSearchFields with number values", () => {
    it("matches number field via globalSearchFields", () => {
      expect(matches("42", { count: 42 }, { globalSearchFields: ["count"] })).toBe(true);
    });

    it("skips boolean values in globalSearchFields", () => {
      expect(matches("true", { active: true }, { globalSearchFields: ["active"] })).toBe(false);
    });

    it("skips object values in globalSearchFields", () => {
      expect(matches("foo", { data: { foo: 1 } }, { globalSearchFields: ["data"] })).toBe(false);
    });

    it("skips array values in globalSearchFields", () => {
      expect(matches("foo", { tags: ["foo"] }, { globalSearchFields: ["tags"] })).toBe(false);
    });
  });

  describe("incompatible type ordering", () => {
    it("a < 'hello' with number field returns false", () => {
      expect(matches('a < "hello"', { a: 42 })).toBe(false);
    });

    it("a > 'hello' with number field returns false", () => {
      expect(matches('a > "hello"', { a: 42 })).toBe(false);
    });
  });

  describe("additional NaN edge cases", () => {
    it("a >= NaN returns false", () => {
      expect(matches("a >= NaN", { a: 5 })).toBe(false);
    });
  });

  describe("evaluateHasRestriction depth limit", () => {
    it("does not crash on deeply nested arrays", () => {
      let obj: unknown = [{ foo: 42 }];
      for (let i = 0; i < 200; i++) {
        obj = [obj];
      }
      expect(matches("r.foo:42", { r: obj })).toBe(false);
    });

    it("still works within depth limit", () => {
      const target = {
        r: [[{ foo: 42 }]],
      };
      expect(matches("r.foo:42", target)).toBe(true);
    });
  });

  describe("globalSearchFields prototype protection", () => {
    it("does not access prototype keys", () => {
      expect(matches("x", {}, { globalSearchFields: ["constructor"] })).toBe(false);
      expect(matches("x", {}, { globalSearchFields: ["toString"] })).toBe(false);
    });

    it("own property still works", () => {
      expect(matches("Madoka", { name: "Madoka" }, { globalSearchFields: ["name"] })).toBe(true);
    });
  });
});

describe("evaluateAsync", () => {
  it("null AST returns true", async () => {
    expect(await evaluateAsync(null, {})).toBe(true);
  });

  it("works with sync functions (no-op await)", async () => {
    expect(await matchesAsync("active()", {}, { functions: { active: () => true } })).toBe(true);
  });

  it("async function returning truthy", async () => {
    const fn = async () => true;
    expect(await matchesAsync("active()", {}, { functions: { active: fn } })).toBe(true);
  });

  it("async function returning falsy", async () => {
    const fn = async () => false;
    expect(await matchesAsync("active()", {}, { functions: { active: fn } })).toBe(false);
  });

  it("async function with args", async () => {
    const fn = async (...args: unknown[]) => args[0] === "hello";
    expect(await matchesAsync("check('hello')", {}, { functions: { check: fn } })).toBe(true);
    expect(await matchesAsync("check('world')", {}, { functions: { check: fn } })).toBe(false);
  });

  it("AND short-circuits: second async fn not called if first is false", async () => {
    let called = false;
    const fns = {
      first: async () => false,
      second: async () => {
        called = true;
        return true;
      },
    };
    expect(await matchesAsync("first() AND second()", {}, { functions: fns })).toBe(false);
    expect(called).toBe(false);
  });

  it("OR short-circuits: second async fn not called if first is true", async () => {
    let called = false;
    const fns = {
      first: async () => true,
      second: async () => {
        called = true;
        return true;
      },
    };
    expect(await matchesAsync("first() OR second()", {}, { functions: fns })).toBe(true);
    expect(called).toBe(false);
  });

  it("NOT with async function", async () => {
    const fn = async () => true;
    expect(await matchesAsync("NOT active()", {}, { functions: { active: fn } })).toBe(false);
  });

  it("async function as LHS of comparison", async () => {
    const fn = async () => 42;
    expect(await matchesAsync("fn() = 42", {}, { functions: { fn } })).toBe(true);
    expect(await matchesAsync("fn() = 99", {}, { functions: { fn } })).toBe(false);
  });

  it("async function as global restriction", async () => {
    const fn = async () => "yes";
    expect(await matchesAsync("fn()", {}, { functions: { fn } })).toBe(true);
  });

  it("mixed sync and async functions", async () => {
    const fns = {
      syncFn: () => true,
      asyncFn: async () => true,
    };
    expect(await matchesAsync("syncFn() AND asyncFn()", {}, { functions: fns })).toBe(true);
  });

  it("unknown function throws by default", async () => {
    await expect(matchesAsync("unknown()", {})).rejects.toThrow(UnknownFunctionError);
  });

  it("unknown function returns false with option", async () => {
    expect(await matchesAsync("unknown()", {}, { unknownFunction: "false" })).toBe(false);
  });

  it("async function with has operator", async () => {
    const fn = async () => ["foo", "bar"];
    expect(await matchesAsync("fn():foo", {}, { functions: { fn } })).toBe(true);
    expect(await matchesAsync("fn():baz", {}, { functions: { fn } })).toBe(false);
  });

  it("non-function filters work the same as sync", async () => {
    expect(await matchesAsync("wishes = 3", { wishes: 3 })).toBe(true);
    expect(await matchesAsync("wishes = 3", { wishes: 4 })).toBe(false);
    expect(await matchesAsync("a = 1 AND b = 2", { a: 1, b: 2 })).toBe(true);
    expect(await matchesAsync("tags:foo", { tags: ["foo", "bar"] })).toBe(true);
  });

  it("respects maxTraversalDepth", async () => {
    const obj = { a: { b: { c: "needle" } } };
    expect(await matchesAsync("needle", obj, { maxTraversalDepth: 2 })).toBe(false);
    expect(await matchesAsync("needle", obj, { maxTraversalDepth: 4 })).toBe(true);
  });

  it("globalSearchFields does not access prototype keys", async () => {
    expect(await matchesAsync("x", {}, { globalSearchFields: ["constructor"] })).toBe(false);
  });

  it("dotted member as bare global restriction", async () => {
    expect(await matchesAsync("a.b", { a: { b: "hello" } })).toBe(true);
    expect(await matchesAsync("a.b", { a: { b: null } })).toBe(false);
  });

  it("resolveRhsMembers option", async () => {
    expect(
      await matchesAsync("a = b.c", { a: 42, b: { c: 42 } }, { resolveRhsMembers: true }),
    ).toBe(true);
    expect(
      await matchesAsync("a = b.c", { a: 42, b: { c: 99 } }, { resolveRhsMembers: true }),
    ).toBe(false);
  });

  it("wildcardNotEquals option", async () => {
    expect(
      await matchesAsync('name != "*.foo"', { name: "bar.foo" }, { wildcardNotEquals: true }),
    ).toBe(false);
    expect(
      await matchesAsync('name != "*.foo"', { name: "bar.baz" }, { wildcardNotEquals: true }),
    ).toBe(true);
  });

  it("async function as LHS returning null: equals", async () => {
    expect(await matchesAsync("fn() = 42", {}, { functions: { fn: async () => null } })).toBe(
      false,
    );
  });

  it("async function as LHS returning null: not equals", async () => {
    expect(await matchesAsync("fn() != 42", {}, { functions: { fn: async () => null } })).toBe(
      false,
    );
  });

  it("async function as LHS returning null: greater than", async () => {
    expect(await matchesAsync("fn() > 0", {}, { functions: { fn: async () => null } })).toBe(false);
  });

  it("async function result with has operator on object", async () => {
    const fn = async () => ({ name: "Alice", hope: 30 });
    expect(await matchesAsync("fn():name", {}, { functions: { fn } })).toBe(true);
    expect(await matchesAsync("fn():missing", {}, { functions: { fn } })).toBe(false);
  });

  it("async function result with has operator presence check", async () => {
    const fn = async () => "hello";
    expect(await matchesAsync("fn():*", {}, { functions: { fn } })).toBe(true);
    const nullFn = async () => null;
    expect(await matchesAsync("fn():*", {}, { functions: { fn: nullFn } })).toBe(false);
  });

  it("async function result with type coercion: number to string", async () => {
    const fn = async () => 42;
    expect(await matchesAsync("fn() = 42", {}, { functions: { fn } })).toBe(true);
    expect(await matchesAsync("fn() >= 40", {}, { functions: { fn } })).toBe(true);
    expect(await matchesAsync("fn() < 40", {}, { functions: { fn } })).toBe(false);
  });

  it("async function as RHS arg in restriction", async () => {
    const cohort = async () => 0.5;
    expect(
      await matchesAsync(
        "experiment.rollout <= cohort(request.user)",
        { experiment: { rollout: 0.3 } },
        { functions: { cohort } },
      ),
    ).toBe(true);
    expect(
      await matchesAsync(
        "experiment.rollout <= cohort(request.user)",
        { experiment: { rollout: 0.8 } },
        { functions: { cohort } },
      ),
    ).toBe(false);
  });
});
