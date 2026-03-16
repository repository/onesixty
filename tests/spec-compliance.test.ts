import { describe, expect, it } from "vitest";
import { ExpectedValueError, FilterError, parse } from "../src";
import { catchError, matches, parses } from "./helpers";

describe("AIP-160: empty filter", () => {
  // "filter : [expression]": the expression is optional
  it("empty string matches everything", () => {
    expect(matches("", {})).toBe(true);
    expect(matches("", { a: 1, b: "two" })).toBe(true);
  });

  it("whitespace-only matches everything", () => {
    expect(matches("   ", {})).toBe(true);
    expect(matches(" \t\n\r ", { x: 7 })).toBe(true);
  });
});

describe("AIP-160: literals", () => {
  // "A bare literal value is a value to be matched against."
  // "Literals appearing alone should usually be matched anywhere in field values."
  it("bare text literal matched against any field", () => {
    expect(matches("Madoka", { name: "Madoka", power: 7 })).toBe(true);
    expect(matches("Madoka", { title: "Homura Madoka's Diary" })).toBe(true);
    expect(matches("Madoka", { unrelated: "nothing" })).toBe(false);
  });

  it("bare numeric literal matched against numeric fields", () => {
    expect(matches("7", { count: 7 })).toBe(true);
    expect(matches("7", { label: "item7" })).toBe(true);
    expect(matches("7", { label: "no match" })).toBe(false);
  });

  it("bare quoted string literal", () => {
    expect(matches('"hello world"', { msg: "hello world" })).toBe(true);
    expect(matches('"hello world"', { msg: "goodbye" })).toBe(false);
  });

  // "Literals separated by whitespace are considered to have a fuzzy variant of AND"
  // "Victor Hugo is roughly equivalent to Victor AND Hugo"
  it("whitespace-separated literals act as implicit AND", () => {
    expect(matches("Homura Madoka", { name: "Homura Madoka" })).toBe(true);
    expect(matches("Homura Madoka", { first: "Homura", last: "Madoka" })).toBe(true);
    expect(matches("Homura Madoka", { name: "Homura" })).toBe(false);
    expect(matches("Homura Madoka", { name: "Madoka" })).toBe(false);
  });

  it("globalSearchFields limits literal search scope", () => {
    const target = { name: "Madoka", secret: "Madoka" };
    expect(matches("Madoka", target, { globalSearchFields: ["name"] })).toBe(true);
    expect(matches("Madoka", target, { globalSearchFields: ["secret"] })).toBe(true);
    expect(matches("Madoka", target, { globalSearchFields: ["other"] })).toBe(false);
  });
});

describe("AIP-160: logical operators", () => {
  // "AND: True if a and b are true"
  describe("AND", () => {
    it("both true", () => {
      expect(matches("a = 1 AND b = 2", { a: 1, b: 2 })).toBe(true);
    });

    it("first false", () => {
      expect(matches("a = 1 AND b = 2", { a: 9, b: 2 })).toBe(false);
    });

    it("second false", () => {
      expect(matches("a = 1 AND b = 2", { a: 1, b: 9 })).toBe(false);
    });

    it("both false", () => {
      expect(matches("a = 1 AND b = 2", { a: 9, b: 9 })).toBe(false);
    });

    it("three-way AND", () => {
      expect(matches("a = 1 AND b = 2 AND c = 3", { a: 1, b: 2, c: 3 })).toBe(true);
      expect(matches("a = 1 AND b = 2 AND c = 3", { a: 1, b: 2, c: 9 })).toBe(false);
    });

    // "AND is case-sensitive"
    it("AND is case-sensitive: lowercase 'and' is not an operator", () => {
      // "a and b" parses as three implicit-AND globals: "a", "and", "b"
      expect(parses("a and b")).toBe(true);
      // This should look for "and" as a literal
      expect(matches("a and b", { x: "a and b" })).toBe(true);
    });
  });

  // "OR: True if any of a, b, c are true"
  describe("OR", () => {
    it("first true", () => {
      expect(matches("a = 1 OR b = 2", { a: 1, b: 9 })).toBe(true);
    });

    it("second true", () => {
      expect(matches("a = 1 OR b = 2", { a: 9, b: 2 })).toBe(true);
    });

    it("both true", () => {
      expect(matches("a = 1 OR b = 2", { a: 1, b: 2 })).toBe(true);
    });

    it("both false", () => {
      expect(matches("a = 1 OR b = 2", { a: 9, b: 9 })).toBe(false);
    });

    it("three-way OR", () => {
      expect(matches("a = 1 OR a = 2 OR a = 3", { a: 2 })).toBe(true);
      expect(matches("a = 1 OR a = 2 OR a = 3", { a: 4 })).toBe(false);
    });

    // "OR is case-sensitive"
    it("OR is case-sensitive: lowercase 'or' is not an operator", () => {
      expect(parses("a or b")).toBe(true);
      expect(matches("a or b", { x: "a or b" })).toBe(true);
    });
  });

  // "the OR operator has higher precedence than AND"
  // "a AND b OR c evaluates: a AND (b OR c)"
  describe("precedence: OR binds tighter than AND", () => {
    it("spec example: a AND b OR c = a AND (b OR c)", () => {
      // a=1 AND (b=2 OR b=3): b=3 matches the OR, a=1 matches
      expect(matches("a = 1 AND b = 2 OR b = 3", { a: 1, b: 3 })).toBe(true);
      // If AND had higher precedence: (a=1 AND b=2) OR b=3: b=2 fails AND,
      // but b=3 alone would match the OR. We verify this does NOT happen:
      expect(matches("a = 1 AND b = 2 OR b = 3", { a: 9, b: 3 })).toBe(false);
    });

    it("a AND b OR c AND d: both ANDs must hold", () => {
      // Parses as: Seq(a=1) AND Seq(Factor(b=2 OR b=3) Factor(c=4 OR c=5))
      // = a=1 AND (b=2 OR b=3) AND (c=4 OR c=5)
      expect(matches("a = 1 AND b = 2 OR b = 3 AND c = 4 OR c = 5", { a: 1, b: 3, c: 5 })).toBe(
        true,
      );
      expect(matches("a = 1 AND b = 2 OR b = 3 AND c = 4 OR c = 5", { a: 9, b: 3, c: 5 })).toBe(
        false,
      );
    });

    it("explicit parentheses can override precedence", () => {
      // (a=1 AND b=2) OR c=3: c=3 alone should suffice
      expect(matches("(a = 1 AND b = 2) OR c = 3", { a: 9, b: 9, c: 3 })).toBe(true);
      // Without parens, a AND b OR c means a AND (b OR c)
      expect(matches("a = 1 AND b = 2 OR c = 3", { a: 9, b: 9, c: 3 })).toBe(false);
    });
  });
});

describe("AIP-160: negation operators", () => {
  // "NOT: True if a is not true"
  it("NOT negates an expression", () => {
    expect(matches("NOT a = 1", { a: 2 })).toBe(true);
    expect(matches("NOT a = 1", { a: 1 })).toBe(false);
  });

  // "-: True if a is not true"
  it("- negates an expression", () => {
    expect(matches("-a = 1", { a: 2 })).toBe(true);
    expect(matches("-a = 1", { a: 1 })).toBe(false);
  });

  // "used interchangeably" "must support both formats"
  it("NOT and - are interchangeable", () => {
    const target = { file: ".java" };
    expect(matches('NOT file = ".java"', target)).toBe(false);
    expect(matches('-file = ".java"', target)).toBe(false);
    const other = { file: ".py" };
    expect(matches('NOT file = ".java"', other)).toBe(true);
    expect(matches('-file = ".java"', other)).toBe(true);
  });

  // Spec example: "NOT (a OR b)"
  it("NOT with composite expression", () => {
    expect(matches("NOT (a = 1 OR b = 2)", { a: 3, b: 4 })).toBe(true);
    expect(matches("NOT (a = 1 OR b = 2)", { a: 1, b: 4 })).toBe(false);
    expect(matches("NOT (a = 1 OR b = 2)", { a: 3, b: 2 })).toBe(false);
  });

  // Spec example: '-file:".java"'
  it("- with has restriction (spec example)", () => {
    expect(matches('-file:".java"', { file: ".java" })).toBe(false);
    expect(matches('-file:".java"', { file: ".py" })).toBe(true);
  });

  // "NOT is case-sensitive and must be followed by at least one whitespace"
  it("NOT must be followed by whitespace: NOT() is a function call", () => {
    const fn = () => true;
    expect(matches("NOT()", {}, { functions: { NOT: fn } })).toBe(true);
  });

  it("NOT (with space) is negation", () => {
    expect(matches("NOT (a = 1)", { a: 2 })).toBe(true);
    expect(matches("NOT (a = 1)", { a: 1 })).toBe(false);
  });

  it("NOT is case-sensitive: 'not' is not negation", () => {
    // "not" is a bare literal (global restriction), not negation
    expect(matches("not", { x: "not here" })).toBe(true);
  });

  it("double negation requires parentheses", () => {
    // NOT NOT is invalid: NOT expects a simple expression, not another NOT keyword
    expect(() => parse("NOT NOT a = 1")).toThrow(FilterError);
    // Use parentheses for double negation
    expect(matches("NOT (NOT a = 1)", { a: 1 })).toBe(true);
    expect(matches("NOT (NOT a = 1)", { a: 2 })).toBe(false);
  });

  it("- negation applied to a has restriction", () => {
    expect(matches("-tags:secret", { tags: ["public", "open"] })).toBe(true);
    expect(matches("-tags:secret", { tags: ["secret", "open"] })).toBe(false);
  });

  // Spec says - can also be numeric negation on RHS: "-30"
  it("negative numeric literal on RHS (not negation)", () => {
    expect(matches("temp = -30", { temp: -30 })).toBe(true);
    expect(matches("temp = -30", { temp: 30 })).toBe(false);
    expect(matches("temp > -10", { temp: 0 })).toBe(true);
    expect(matches("temp > -10", { temp: -20 })).toBe(false);
  });
});

describe("AIP-160: comparison operators", () => {
  // Spec: "a = true - True if a is true"
  describe("= (equals)", () => {
    it("numeric equality", () => {
      expect(matches("a = 42", { a: 42 })).toBe(true);
      expect(matches("a = 42", { a: 43 })).toBe(false);
    });

    it("string equality", () => {
      expect(matches('a = "foo"', { a: "foo" })).toBe(true);
      expect(matches('a = "foo"', { a: "bar" })).toBe(false);
    });

    it("boolean equality via coercion", () => {
      expect(matches("a = true", { a: true })).toBe(true);
      expect(matches("a = true", { a: false })).toBe(false);
      expect(matches("a = false", { a: false })).toBe(true);
    });
  });

  // Spec: "a != 42 - True unless a equals 42"
  describe("!= (not equals)", () => {
    it("numeric inequality", () => {
      expect(matches("a != 42", { a: 43 })).toBe(true);
      expect(matches("a != 42", { a: 42 })).toBe(false);
    });

    it("string inequality", () => {
      expect(matches('a != "foo"', { a: "bar" })).toBe(true);
      expect(matches('a != "foo"', { a: "foo" })).toBe(false);
    });

    it("unset field with != is non-match (spec: skip on unset)", () => {
      expect(matches("a != 42", { a: null })).toBe(false);
      expect(matches("a != 42", {})).toBe(false);
    });
  });

  // Spec: "a < 42 - True if a is a numeric value below 42"
  describe("< (less than)", () => {
    it("numeric", () => {
      expect(matches("a < 10", { a: 5 })).toBe(true);
      expect(matches("a < 10", { a: 10 })).toBe(false);
      expect(matches("a < 10", { a: 15 })).toBe(false);
    });

    it("string lexicographic", () => {
      expect(matches('a < "foo"', { a: "bar" })).toBe(true);
      expect(matches('a < "bar"', { a: "foo" })).toBe(false);
    });
  });

  // Spec: "a > 'foo' - True if a is lexically ordered after 'foo'"
  describe("> (greater than)", () => {
    it("numeric", () => {
      expect(matches("a > 10", { a: 15 })).toBe(true);
      expect(matches("a > 10", { a: 10 })).toBe(false);
      expect(matches("a > 10", { a: 5 })).toBe(false);
    });

    it("string lexicographic (spec example)", () => {
      expect(matches('a > "foo"', { a: "zoo" })).toBe(true);
      expect(matches('a > "foo"', { a: "bar" })).toBe(false);
    });
  });

  // Spec: "a <= 'foo' - True if a is 'foo' or lexically before it"
  describe("<= (less than or equal)", () => {
    it("numeric", () => {
      expect(matches("a <= 10", { a: 10 })).toBe(true);
      expect(matches("a <= 10", { a: 5 })).toBe(true);
      expect(matches("a <= 10", { a: 15 })).toBe(false);
    });

    it("string lexicographic (spec example)", () => {
      expect(matches('a <= "foo"', { a: "foo" })).toBe(true);
      expect(matches('a <= "foo"', { a: "bar" })).toBe(true);
      expect(matches('a <= "foo"', { a: "zoo" })).toBe(false);
    });
  });

  // Spec: "a >= 42 - True if a is a numeric value of 42 or higher"
  describe(">= (greater than or equal)", () => {
    it("numeric (spec example)", () => {
      expect(matches("a >= 42", { a: 42 })).toBe(true);
      expect(matches("a >= 42", { a: 100 })).toBe(true);
      expect(matches("a >= 42", { a: 10 })).toBe(false);
    });

    it("string lexicographic", () => {
      expect(matches('a >= "foo"', { a: "foo" })).toBe(true);
      expect(matches('a >= "foo"', { a: "zoo" })).toBe(true);
      expect(matches('a >= "foo"', { a: "bar" })).toBe(false);
    });
  });

  // "field names must appear on the left-hand side"
  // "the right-hand side only accepts literals"
  it("RHS is treated as literal, not field reference", () => {
    expect(matches("a = b", { a: "b", b: "something" })).toBe(true);
    expect(matches("a = b", { a: "something", b: "something" })).toBe(false);
  });

  // "restrictions are not whitespace sensitive"
  // Spec example: "package=com.google"
  describe("whitespace insensitivity", () => {
    it("no spaces around operator", () => {
      expect(matches("a=1", { a: 1 })).toBe(true);
    });

    it("spaces around operator", () => {
      expect(matches("a = 1", { a: 1 })).toBe(true);
    });

    it("spec example: package=com.google", () => {
      expect(matches("package=com.google", { package: "com.google" })).toBe(true);
    });

    it("spec example: msg != 'hello'", () => {
      expect(matches("msg != 'hello'", { msg: "world" })).toBe(true);
      expect(matches("msg != 'hello'", { msg: "hello" })).toBe(false);
    });
  });

  // Type coercion: "Booleans expect true and false literal values"
  describe("type coercion", () => {
    it("boolean: true and false are case-sensitive", () => {
      expect(matches("a = true", { a: true })).toBe(true);
      expect(matches("a = false", { a: false })).toBe(true);
      // Case variants do NOT coerce
      expect(matches("a = TRUE", { a: true })).toBe(false);
      expect(matches("a = True", { a: true })).toBe(false);
      expect(matches("a = False", { a: false })).toBe(false);
    });

    it("numbers: standard integer representation", () => {
      expect(matches("a = 0", { a: 0 })).toBe(true);
      expect(matches("a = 999", { a: 999 })).toBe(true);
    });

    // "For floats, exponents are supported (e.g. 2.997e9)"
    it("numbers: float with exponent (spec example)", () => {
      expect(matches("a = 2.997e9", { a: 2.997e9 })).toBe(true);
    });

    it("numbers: standard float", () => {
      expect(matches("a = 3.14", { a: 3.14 })).toBe(true);
    });

    // "The identifiers true, false, and null only carry intrinsic meaning
    //  when used in the context of a typed field reference"
    it("true/false/null as bare literals are just text", () => {
      // When used as a global restriction, "true" is just the text "true"
      expect(matches("true", { label: "true" })).toBe(true);
      expect(matches("false", { label: "false" })).toBe(true);
      expect(matches("null", { label: "null" })).toBe(true);
    });

    it("incompatible types: number vs quoted string -> NaN (false)", () => {
      expect(matches('a > "hello"', { a: 42 })).toBe(false);
      expect(matches('a <= "hello"', { a: 42 })).toBe(false);
    });

    it("string field vs unquoted number -> lexicographic comparison", () => {
      // "hello" > "10" is true lexicographically (both strings)
      expect(matches("a > 10", { a: "hello" })).toBe(true);
      // "abc" < "10" is false lexicographically
      expect(matches("a < 10", { a: "abc" })).toBe(false);
    });
  });

  // Wildcards: "services should support wildcards using the * character"
  // "a = '*.foo' is true if a ends with '.foo'"
  describe("wildcard matching with = operator", () => {
    it("suffix wildcard (spec example): a = '*.foo'", () => {
      expect(matches('a = "*.foo"', { a: "bar.foo" })).toBe(true);
      expect(matches('a = "*.foo"', { a: ".foo" })).toBe(true);
      expect(matches('a = "*.foo"', { a: "bar.baz" })).toBe(false);
    });

    it("prefix wildcard", () => {
      expect(matches('a = "foo.*"', { a: "foo.bar" })).toBe(true);
      expect(matches('a = "foo.*"', { a: "foo." })).toBe(true);
      expect(matches('a = "foo.*"', { a: "baz.bar" })).toBe(false);
    });

    it("both ends wildcard (contains)", () => {
      expect(matches('a = "*mid*"', { a: "premidpost" })).toBe(true);
      expect(matches('a = "*mid*"', { a: "mid" })).toBe(true);
      expect(matches('a = "*mid*"', { a: "nomatch" })).toBe(false);
    });

    it("star alone matches any non-empty string", () => {
      expect(matches('a = "*"', { a: "anything" })).toBe(true);
      expect(matches('a = "*"', { a: "" })).toBe(true);
      expect(matches('a = "*"', { a: "x" })).toBe(true);
    });

    // Wildcards are a STRING (quoted) feature per the EBNF
    it("wildcards only apply to quoted strings, not unquoted TEXT", () => {
      expect(matches("a = *", { a: "anything" })).toBe(false);
      expect(matches("a = *", { a: "*" })).toBe(true);
      expect(matches("a = foo*", { a: "foobar" })).toBe(false);
      expect(matches("a = foo*", { a: "foo*" })).toBe(true);
    });

    it("exact match when no wildcard in quoted string", () => {
      expect(matches('a = "foo"', { a: "foo" })).toBe(true);
      expect(matches('a = "foo"', { a: "foobar" })).toBe(false);
    });

    it("wildcards do NOT apply to != by default", () => {
      expect(matches('a != "*.foo"', { a: "bar.foo" })).toBe(true);
      expect(matches('a != "*.foo"', { a: "*.foo" })).toBe(false);
    });

    it("wildcards with regex-special chars are not treated as regex", () => {
      expect(matches('a = "test[0]*"', { a: "test[0]xyz" })).toBe(true);
      expect(matches('a = "test[0]*"', { a: "testXyz" })).toBe(false);
    });
  });
});

describe("AIP-160: traversal operator (.)", () => {
  // Spec examples:
  // "a.b = true - True if a has a boolean b field that is true"
  // "a.b > 42 - True if a has a numeric b field that is above 42"
  // "a.b.c = 'foo' - True if a.b has a string c field that is 'foo'"
  it("spec example: a.b = true", () => {
    expect(matches("a.b = true", { a: { b: true } })).toBe(true);
    expect(matches("a.b = true", { a: { b: false } })).toBe(false);
  });

  it("spec example: a.b > 42", () => {
    expect(matches("a.b > 42", { a: { b: 50 } })).toBe(true);
    expect(matches("a.b > 42", { a: { b: 30 } })).toBe(false);
  });

  it("spec example: a.b.c = 'foo'", () => {
    expect(matches('a.b.c = "foo"', { a: { b: { c: "foo" } } })).toBe(true);
    expect(matches('a.b.c = "foo"', { a: { b: { c: "bar" } } })).toBe(false);
  });

  it("deep traversal (4 levels)", () => {
    expect(matches("a.b.c.d = 1", { a: { b: { c: { d: 1 } } } })).toBe(true);
    expect(matches("a.b.c.d = 1", { a: { b: { c: { d: 2 } } } })).toBe(false);
  });

  // "if any non-primitive field in the chain is not set on the entry,
  //  the entry should be skipped i.e. not match"
  describe("unset field in traversal chain -> skip", () => {
    it("top-level field unset", () => {
      expect(matches("a.b = 42", {})).toBe(false);
    });

    it("intermediate field null", () => {
      expect(matches("a.b = 42", { a: null })).toBe(false);
    });

    it("intermediate field undefined", () => {
      expect(matches("a.b = 42", { a: undefined })).toBe(false);
    });

    it("intermediate field missing in nested object", () => {
      expect(matches("a.b.c = 42", { a: {} })).toBe(false);
    });

    // "This applies even when the comparison is a !=, which would imply
    //  matching on empty values"
    it("!= on unset traversal still skips (does NOT match)", () => {
      expect(matches("a.b != 42", {})).toBe(false);
      expect(matches("a.b != 42", { a: null })).toBe(false);
      expect(matches("a.b != 42", { a: {} })).toBe(false);
    });

    it("all comparison operators skip on unset traversal", () => {
      expect(matches("a.b = 42", { a: null })).toBe(false);
      expect(matches("a.b != 42", { a: null })).toBe(false);
      expect(matches("a.b < 42", { a: null })).toBe(false);
      expect(matches("a.b <= 42", { a: null })).toBe(false);
      expect(matches("a.b > 42", { a: null })).toBe(false);
      expect(matches("a.b >= 42", { a: null })).toBe(false);
      expect(matches("a.b:42", { a: null })).toBe(false);
    });
  });

  // "The . operator must not be used to traverse through a repeated field
  //  or list, except for specific use with the : operator"
  describe("dot must NOT traverse arrays (except with :)", () => {
    it("= does not traverse into array by numeric index", () => {
      expect(matches("a.0 = x", { a: ["x", "y"] })).toBe(false);
    });

    it("= does not traverse into array of objects", () => {
      expect(matches("a.0.foo = 42", { a: [{ foo: 42 }] })).toBe(false);
    });

    it("!= does not traverse into array", () => {
      expect(matches("a.0 != x", { a: ["x", "y"] })).toBe(false);
    });

    it("> does not traverse into array", () => {
      expect(matches("a.0 > 0", { a: [5, 10] })).toBe(false);
    });

    it(": operator CAN traverse through arrays (fanout)", () => {
      expect(matches("a.foo:42", { a: [{ foo: 42 }, { foo: 99 }] })).toBe(true);
      expect(matches("a.foo:42", { a: [{ foo: 1 }, { foo: 2 }] })).toBe(false);
    });
  });

  it("traversal through non-object returns false", () => {
    expect(matches("a.b = 1", { a: 42 })).toBe(false);
    expect(matches("a.b = 1", { a: "string" })).toBe(false);
    expect(matches("a.b = 1", { a: true })).toBe(false);
  });
});

describe("AIP-160: has operator (:)", () => {
  // "Repeated fields query to see if the repeated structure contains
  //  a matching element"
  describe("repeated fields (arrays)", () => {
    // Spec: "r:42 - True if r contains 42"
    it("spec example: r:42", () => {
      expect(matches("r:42", { r: [10, 42, 100] })).toBe(true);
      expect(matches("r:42", { r: [10, 100] })).toBe(false);
    });

    // Spec: "r.foo:42 - True if r contains an element e such that e.foo = 42"
    it("spec example: r.foo:42 (element containment with traversal)", () => {
      expect(matches("r.foo:42", { r: [{ foo: 42 }, { foo: 99 }] })).toBe(true);
      expect(matches("r.foo:42", { r: [{ foo: 1 }, { foo: 2 }] })).toBe(false);
    });

    it("string elements", () => {
      expect(matches("tags:mitakihara", { tags: ["mitakihara", "kazamino"] })).toBe(true);
      expect(matches("tags:kamihama", { tags: ["mitakihara", "kazamino"] })).toBe(false);
    });

    it("mixed types in array: type-aware matching", () => {
      expect(matches("mix:42", { mix: ["hello", 42, true] })).toBe(true);
      expect(matches("mix:hello", { mix: ["hello", 42, true] })).toBe(true);
    });

    it("deep nested traversal with fanout", () => {
      const target = {
        departments: [
          { teams: [{ lead: "Mami" }, { lead: "Sayaka" }] },
          { teams: [{ lead: "Nagisa" }] },
        ],
      };
      expect(matches("departments.teams.lead:Sayaka", target)).toBe(true);
      expect(matches("departments.teams.lead:Kyubey", target)).toBe(false);
    });

    // "e.0.foo = 42 and e[0].foo = 42 are not valid filters"
    it("cannot query specific array index (e.0.foo)", () => {
      // With non-: operators, arrays block traversal
      expect(matches("e.0.foo = 42", { e: [{ foo: 42 }] })).toBe(false);
    });
  });

  // "Maps, structs, messages can query either for the presence of a field
  //  in the map or a specific value"
  describe("maps/objects", () => {
    // Spec: "m:foo - True if m contains the key 'foo'"
    it("spec example: m:foo (key presence)", () => {
      expect(matches("m:foo", { m: { foo: 1, bar: 2 } })).toBe(true);
      expect(matches("m:baz", { m: { foo: 1, bar: 2 } })).toBe(false);
    });

    // Spec: "m.foo:* - True if m contains the key 'foo'"
    it("spec example: m.foo:* (key presence via traversal)", () => {
      expect(matches("m.foo:*", { m: { foo: "anything" } })).toBe(true);
      expect(matches("m.foo:*", { m: { bar: 1 } })).toBe(false);
    });

    // Spec: "m.foo:42 - True if m.foo is 42"
    it("spec example: m.foo:42 (specific value)", () => {
      expect(matches("m.foo:42", { m: { foo: 42 } })).toBe(true);
      expect(matches("m.foo:42", { m: { foo: 99 } })).toBe(false);
    });
  });

  // "checking for the presence of a top-level resource field is possible
  //  with the * value"
  describe("presence with *", () => {
    // Spec: "r:* - True if repeated field r is present"
    it("repeated field present", () => {
      expect(matches("r:*", { r: [1, 2] })).toBe(true);
    });

    // Spec: "p:* - True if map field p is present"
    it("map field present", () => {
      expect(matches("p:*", { p: { key: "val" } })).toBe(true);
    });

    // Spec: "m:* - True if message field m is present"
    it("message field present", () => {
      expect(matches("m:*", { m: { nested: true } })).toBe(true);
    });

    // "for map and repeated fields, there is no semantic difference between
    //  an unset field and 'set with empty value'"
    it("empty array is not present", () => {
      expect(matches("r:*", { r: [] })).toBe(false);
    });

    it("empty object is not present", () => {
      expect(matches("m:*", { m: {} })).toBe(false);
    });

    it("null field is not present", () => {
      expect(matches("r:*", { r: null })).toBe(false);
    });

    it("undefined/missing field is not present", () => {
      expect(matches("r:*", {})).toBe(false);
    });

    it("empty string is not present", () => {
      expect(matches("s:*", { s: "" })).toBe(false);
    });

    it("zero is present (non-default in JS context)", () => {
      expect(matches("n:*", { n: 0 })).toBe(true);
    });

    it("false is present (non-default in JS context)", () => {
      expect(matches("b:*", { b: false })).toBe(true);
    });

    it("non-empty string is present", () => {
      expect(matches("s:*", { s: "hello" })).toBe(true);
    });
  });

  describe("has with unset fields", () => {
    it("null field with has value: non-match", () => {
      expect(matches("a:foo", { a: null })).toBe(false);
    });

    it("null intermediate in has path: non-match", () => {
      expect(matches("a.b:foo", { a: null })).toBe(false);
    });

    it("partially null array fanout", () => {
      expect(matches("r.foo:42", { r: [{ foo: null }, { foo: 42 }] })).toBe(true);
      expect(matches("r.foo:42", { r: [{ foo: null }, { foo: 99 }] })).toBe(false);
    });
  });
});

describe("AIP-160: functions", () => {
  // "The filtering language supports a function call syntax"
  // "call(arg...) syntax"
  it("zero-arg function", () => {
    expect(matches("check()", {}, { functions: { check: () => true } })).toBe(true);
    expect(matches("check()", {}, { functions: { check: () => false } })).toBe(false);
  });

  it("function with arguments", () => {
    const fn = (field: unknown, pattern: unknown) => String(field).match(String(pattern)) !== null;
    expect(
      matches(
        "regex(m.key, '^mitakihara')",
        { m: { key: "mitakihara-central" } },
        {
          functions: { regex: fn },
          resolveRhsMembers: true,
        },
      ),
    ).toBe(true);
  });

  it("qualified function name (dot-separated)", () => {
    expect(matches("math.abs()", {}, { functions: { "math.abs": () => 42 } })).toBe(true);
  });

  // "simple and qualified function names may include keywords: NOT, AND, OR"
  it("keyword as function name", () => {
    expect(matches("NOT()", {}, { functions: { NOT: () => true } })).toBe(true);
    expect(matches("AND()", {}, { functions: { AND: () => true } })).toBe(true);
    expect(matches("OR()", {}, { functions: { OR: () => true } })).toBe(true);
  });

  it("function as LHS of comparison", () => {
    expect(matches("fn() = 42", {}, { functions: { fn: () => 42 } })).toBe(true);
    expect(matches("fn() = 42", {}, { functions: { fn: () => 99 } })).toBe(false);
    expect(matches("fn() != 42", {}, { functions: { fn: () => 99 } })).toBe(true);
    expect(matches("fn() > 10", {}, { functions: { fn: () => 20 } })).toBe(true);
    expect(matches("fn() > 10", {}, { functions: { fn: () => 5 } })).toBe(false);
  });

  it("function with has operator", () => {
    expect(matches("fn():42", {}, { functions: { fn: () => [10, 42, 100] } })).toBe(true);
    expect(matches("fn():99", {}, { functions: { fn: () => [10, 42, 100] } })).toBe(false);
    expect(matches("fn():*", {}, { functions: { fn: () => [1] } })).toBe(true);
    expect(matches("fn():*", {}, { functions: { fn: () => null } })).toBe(false);
  });

  it("function returning null used in comparison", () => {
    expect(matches("fn() = 42", {}, { functions: { fn: () => null } })).toBe(false);
    expect(matches("fn() != 42", {}, { functions: { fn: () => null } })).toBe(false);
  });

  it("function args receive resolved values", () => {
    const result = matches(
      "check(hello, 42)",
      {},
      {
        functions: { check: (...args) => args[0] === "hello" && args[1] === "42" },
      },
    );
    expect(result).toBe(true);
  });
});

describe("AIP-160: EBNF grammar coverage", () => {
  // "expression : sequence {WS AND WS sequence}"
  describe("expression (AND of sequences)", () => {
    it("single sequence", () => {
      expect(parses("a = 1")).toBe(true);
    });

    it("two sequences joined by AND", () => {
      expect(parses("a = 1 AND b = 2")).toBe(true);
    });

    it("three sequences joined by AND", () => {
      expect(parses("a = 1 AND b = 2 AND c = 3")).toBe(true);
    });
  });

  // "sequence : factor {WS factor}"
  describe("sequence (whitespace-separated factors)", () => {
    it("single factor", () => {
      expect(parses("a")).toBe(true);
    });

    it("multiple factors (implicit AND)", () => {
      expect(parses("a b c")).toBe(true);
    });

    // Spec example: "New York Giants OR Yankees"
    // = Seq(Factor(New), Factor(York), Factor(Giants OR Yankees))
    it("spec example: Mitakihara Magical Girls OR Witches (parses)", () => {
      expect(parses("Mitakihara Magical Girls OR Witches")).toBe(true);
      // "Mitakihara Magical (Girls OR Witches)" is equivalent per the spec
      // Space between Magical and ( means it's NOT a function call
      expect(parses("Mitakihara Magical (Girls OR Witches)")).toBe(true);
    });

    it("spec example: Mitakihara Magical Girls OR Witches (evaluates)", () => {
      // All three factors must match: "Mitakihara" AND "Magical" AND ("Girls" OR "Witches")
      expect(
        matches("Mitakihara Magical Girls OR Witches", { bio: "Mitakihara Magical Girls fan" }),
      ).toBe(true);
      expect(
        matches("Mitakihara Magical Girls OR Witches", { bio: "Mitakihara Magical Witches fan" }),
      ).toBe(true);
      expect(
        matches("Mitakihara Magical Girls OR Witches", { bio: "Mitakihara Magical Quintet fan" }),
      ).toBe(false);
    });
  });

  // "factor : term {WS OR WS term}"
  describe("factor (OR of terms)", () => {
    it("single term", () => {
      expect(parses("a = 1")).toBe(true);
    });

    it("two terms joined by OR", () => {
      expect(parses("a = 1 OR a = 2")).toBe(true);
    });
  });

  // "term : [(NOT WS | MINUS)] simple"
  describe("term (optional negation)", () => {
    it("unnegated", () => {
      expect(parses("a = 1")).toBe(true);
    });

    it("NOT negation", () => {
      expect(parses("NOT a = 1")).toBe(true);
    });

    it("MINUS negation", () => {
      expect(parses("-a = 1")).toBe(true);
    });
  });

  // "simple : restriction | composite"
  // "composite : LPAREN expression RPAREN"
  describe("composite (parenthesized)", () => {
    it("simple parenthesized value", () => {
      expect(parses("(a)")).toBe(true);
    });

    it("nested expression in parens", () => {
      expect(parses("(a AND b)")).toBe(true);
    });

    it("deeply nested parens", () => {
      expect(parses("((a))")).toBe(true);
      expect(parses("(((a)))")).toBe(true);
    });

    it("composite in AND", () => {
      expect(parses("a AND (b OR c)")).toBe(true);
    });

    // Spec example: "(msg.endsWith('world') AND retries < 10)"
    it("spec example with function in composite", () => {
      expect(parses("(msg.endsWith('world') AND retries < 10)")).toBe(true);
    });
  });

  // "restriction : comparable [comparator arg]"
  describe("restriction", () => {
    it("global restriction (no comparator)", () => {
      expect(parses("mitakihara")).toBe(true);
    });

    it("restriction with comparator and arg", () => {
      expect(parses("a = b")).toBe(true);
    });

    // Spec examples from EBNF
    it("spec example: package=com.google", () => {
      expect(parses("package=com.google")).toBe(true);
    });

    it("spec example: map:key", () => {
      expect(parses("map:key")).toBe(true);
    });
  });

  // "member : value {DOT field}"
  describe("member", () => {
    it("simple value", () => {
      expect(parses("mitakihara")).toBe(true);
    });

    it("dotted field reference", () => {
      expect(parses("a.b.c")).toBe(true);
    });

    // EBNF example: "expr.type_map.1.type"
    it("EBNF example: expr.type_map.1.type", () => {
      expect(parses("expr.type_map.1.type")).toBe(true);
    });
  });

  // "function : name {DOT name} LPAREN [argList] RPAREN"
  describe("function", () => {
    it("simple function", () => {
      expect(parses("fn()")).toBe(true);
    });

    it("qualified function", () => {
      expect(parses("math.mem('30mb')")).toBe(true);
    });

    // EBNF example: "regex(m.key, '^.*mitakihara.*$')"
    it("EBNF example: regex(m.key, '^.*mitakihara.*$')", () => {
      expect(parses("regex(m.key, '^.*mitakihara.*$')")).toBe(true);
    });

    it("function with composite arg", () => {
      expect(parses("fn((a AND b))")).toBe(true);
    });
  });

  // "value : TEXT | STRING"
  describe("value", () => {
    it("TEXT value", () => {
      expect(parses("hello")).toBe(true);
    });

    it("double-quoted STRING", () => {
      expect(parses('"hello"')).toBe(true);
    });

    it("single-quoted STRING", () => {
      expect(parses("'hello'")).toBe(true);
    });
  });

  // "field : value | keyword": keywords allowed after dot
  describe("field (after dot)", () => {
    it("keyword AND after dot is a field name", () => {
      expect(parses("a.AND = true")).toBe(true);
      expect(matches("a.AND = 1", { a: { AND: 1 } })).toBe(true);
    });

    it("keyword OR after dot is a field name", () => {
      expect(parses("a.OR = true")).toBe(true);
      expect(matches("a.OR = 1", { a: { OR: 1 } })).toBe(true);
    });

    it("keyword NOT after dot is a field name", () => {
      expect(parses("a.NOT = true")).toBe(true);
      expect(matches("a.NOT = 1", { a: { NOT: 1 } })).toBe(true);
    });

    it("multiple keywords as fields", () => {
      expect(matches("a.OR.NOT = 1", { a: { OR: { NOT: 1 } } })).toBe(true);
    });
  });

  // "name : TEXT | keyword": keywords allowed in function names
  describe("name (function names)", () => {
    it("keyword function names are valid", () => {
      expect(parses("NOT()")).toBe(true);
      expect(parses("AND()")).toBe(true);
      expect(parses("OR()")).toBe(true);
    });

    it("qualified keyword function: NOT.check()", () => {
      expect(parses("NOT.check()")).toBe(true);
    });
  });

  // "arg : comparable | composite": keywords are NOT in the value production
  describe("arg (keyword rejection)", () => {
    it("fn(AND) is a parse error: keywords are not values", () => {
      const err = catchError(() => parse("fn(AND)"), ExpectedValueError);
      expect(err.description).toContain("after '('");
    });

    it("fn(OR) is a parse error", () => {
      const err = catchError(() => parse("fn(OR)"), ExpectedValueError);
      expect(err.description).toContain("after '('");
    });

    it("fn(NOT) is a parse error", () => {
      const err = catchError(() => parse("fn(NOT)"), ExpectedValueError);
      expect(err.description).toContain("after '('");
    });
  });

  // "member : value {DOT field}" where "value : TEXT | STRING"
  describe("quoted string as member head", () => {
    it('"quoted".field parses as member', () => {
      expect(parses('"quoted".field = x')).toBe(true);
    });

    it('"quoted".field evaluates correctly', () => {
      expect(matches('"key".val = 1', { key: { val: 1 } })).toBe(true);
    });
  });

  // EBNF example: "expr.type_map.1.type": numeric map key evaluation
  describe("numeric map key (evaluation)", () => {
    it("expr.type_map.1.type resolves numeric string key in object", () => {
      expect(
        matches("expr.type_map.1.type = INT", {
          expr: { type_map: { "1": { type: "INT" } } },
        }),
      ).toBe(true);
    });

    it("numeric key miss returns false", () => {
      expect(matches("m.1 = x", { m: { "2": "x" } })).toBe(false);
    });
  });

  describe("all comparators parse", () => {
    const comparators = ["=", "!=", "<", "<=", ">", ">=", ":"];
    for (const op of comparators) {
      it(`'a ${op} b' parses`, () => {
        expect(parses(`a ${op} b`)).toBe(true);
      });
    }
  });
});

describe("AIP-160: spec examples (end-to-end)", () => {
  it("a = true", () => {
    expect(matches("a = true", { a: true })).toBe(true);
    expect(matches("a = true", { a: false })).toBe(false);
  });

  it("a != 42", () => {
    expect(matches("a != 42", { a: 10 })).toBe(true);
    expect(matches("a != 42", { a: 42 })).toBe(false);
  });

  it("a < 42", () => {
    expect(matches("a < 42", { a: 10 })).toBe(true);
    expect(matches("a < 42", { a: 42 })).toBe(false);
  });

  it('a > "foo"', () => {
    expect(matches('a > "foo"', { a: "zoo" })).toBe(true);
    expect(matches('a > "foo"', { a: "bar" })).toBe(false);
  });

  it('a <= "foo"', () => {
    expect(matches('a <= "foo"', { a: "foo" })).toBe(true);
    expect(matches('a <= "foo"', { a: "bar" })).toBe(true);
    expect(matches('a <= "foo"', { a: "zoo" })).toBe(false);
  });

  it("a >= 42", () => {
    expect(matches("a >= 42", { a: 42 })).toBe(true);
    expect(matches("a >= 42", { a: 100 })).toBe(true);
    expect(matches("a >= 42", { a: 10 })).toBe(false);
  });

  it("a.b = true", () => {
    expect(matches("a.b = true", { a: { b: true } })).toBe(true);
  });

  it("a.b > 42", () => {
    expect(matches("a.b > 42", { a: { b: 50 } })).toBe(true);
  });

  it('a.b.c = "foo"', () => {
    expect(matches('a.b.c = "foo"', { a: { b: { c: "foo" } } })).toBe(true);
  });

  it("r:42", () => {
    expect(matches("r:42", { r: [42] })).toBe(true);
  });

  it("r.foo:42", () => {
    expect(matches("r.foo:42", { r: [{ foo: 42 }] })).toBe(true);
  });

  it("m:foo", () => {
    expect(matches("m:foo", { m: { foo: 1 } })).toBe(true);
  });

  it("m.foo:*", () => {
    expect(matches("m.foo:*", { m: { foo: 1 } })).toBe(true);
    expect(matches("m.foo:*", { m: {} })).toBe(false);
  });

  it("m.foo:42", () => {
    expect(matches("m.foo:42", { m: { foo: 42 } })).toBe(true);
  });

  // From the EBNF examples
  it("NOT (a OR b)", () => {
    expect(matches("NOT (a = 1 OR b = 2)", { a: 3, b: 4 })).toBe(true);
    expect(matches("NOT (a = 1 OR b = 2)", { a: 1, b: 4 })).toBe(false);
  });

  it('-file:".java"', () => {
    expect(matches('-file:".java"', { file: ".java" })).toBe(false);
    expect(matches('-file:".java"', { file: ".py" })).toBe(true);
  });

  // EBNF: "a b AND c AND d" equivalent to "(a b) AND c AND d"
  it("a b AND c AND d (sequence + AND)", () => {
    const target = { x: "a b c d" };
    expect(matches("a b AND c AND d", target)).toBe(true);
    const partial = { x: "a c d" };
    expect(matches("a b AND c AND d", partial)).toBe(false);
  });

  // EBNF restriction examples
  it("restriction example: package=com.google", () => {
    expect(matches("package=com.google", { package: "com.google" })).toBe(true);
  });

  // EBNF: "2.5 >= 2.4"
  it("EBNF example: 2.5 >= 2.4 (numeric literal comparison)", () => {
    // 2.5 on LHS is unusual but valid per grammar
    expect(parses("2.5 >= 2.4")).toBe(true);
  });

  // EBNF: "experiment.rollout <= cohort(request.user)"
  it("EBNF example: experiment.rollout <= cohort(request.user)", () => {
    expect(parses("experiment.rollout <= cohort(request.user)")).toBe(true);
    const fn = (_: unknown) => 0.5;
    expect(
      matches(
        "experiment.rollout <= cohort(request.user)",
        { experiment: { rollout: 0.3 } },
        {
          functions: { cohort: fn },
        },
      ),
    ).toBe(true);
  });

  // EBNF: "a < 10 OR a >= 100"
  it("a < 10 OR a >= 100", () => {
    expect(matches("a < 10 OR a >= 100", { a: 5 })).toBe(true);
    expect(matches("a < 10 OR a >= 100", { a: 100 })).toBe(true);
    expect(matches("a < 10 OR a >= 100", { a: 50 })).toBe(false);
  });
});

describe("AIP-160: parse errors", () => {
  it("trailing AND", () => {
    expect(() => parse("a AND")).toThrow(FilterError);
  });

  it("trailing OR", () => {
    expect(() => parse("a OR")).toThrow(FilterError);
  });

  it("leading AND", () => {
    expect(() => parse("AND a")).toThrow(FilterError);
  });

  it("leading OR", () => {
    expect(() => parse("OR a")).toThrow(FilterError);
  });

  it("double AND", () => {
    expect(() => parse("a AND AND b")).toThrow(FilterError);
  });

  it("double OR", () => {
    expect(() => parse("a OR OR b")).toThrow(FilterError);
  });

  it("AND directly after OR", () => {
    expect(() => parse("a OR AND b")).toThrow(FilterError);
  });

  it("OR directly after AND", () => {
    expect(() => parse("a AND OR b")).toThrow(FilterError);
  });

  it("unclosed parenthesis", () => {
    expect(() => parse("(a")).toThrow(FilterError);
  });

  it("unmatched closing parenthesis", () => {
    expect(() => parse("a)")).toThrow(FilterError);
  });

  it("empty parentheses", () => {
    expect(() => parse("()")).toThrow(FilterError);
  });

  it("missing value after comparator", () => {
    expect(() => parse("a =")).toThrow(FilterError);
  });

  it("double equals is invalid (not ==)", () => {
    const err = catchError(() => parse("a == b"), FilterError);
    expect(err.hints.some((h) => h.includes("=="))).toBe(true);
  });

  it("bare ! is invalid", () => {
    const err = catchError(() => parse("a ! b"), FilterError);
    expect(err.hints.some((h) => h.includes("!="))).toBe(true);
  });

  it("unterminated string", () => {
    expect(() => parse('"hello')).toThrow(FilterError);
  });

  it("keyword as bare value gets helpful hint", () => {
    const err = catchError(() => parse("a = AND"), FilterError);
    expect(err.hints.some((h) => h.includes("quotes"))).toBe(true);
  });

  it("quoted string cannot be function name", () => {
    const err = catchError(() => parse('"fn"()'), FilterError);
    expect(err.description).toContain("function name");
  });

  it("recursion depth limit", () => {
    const deep = "(".repeat(200) + "a" + ")".repeat(200);
    expect(() => parse(deep)).toThrow(FilterError);
  });

  it("moderate nesting is fine", () => {
    const moderate = "(".repeat(50) + "a" + ")".repeat(50);
    expect(() => parse(moderate)).not.toThrow();
  });

  it("custom maxDepth", () => {
    const input = "(".repeat(10) + "a" + ")".repeat(10);
    expect(() => parse(input, { maxDepth: 5 })).toThrow(FilterError);
    expect(() => parse(input, { maxDepth: 10 })).not.toThrow();
  });
});

describe("AIP-160: complex combinations", () => {
  it("NOT with OR (NOT applies to term, not entire expression)", () => {
    // "NOT a = 1 OR b = 2" = "(NOT a=1) OR b=2"
    // Wait: NOT applies to the term, and OR is within a factor.
    // So: Factor(NOT(a=1) OR b=2) = OR(NOT(a=1), b=2)
    expect(matches("NOT a = 1 OR b = 2", { a: 1, b: 2 })).toBe(true); // NOT false, OR true
    expect(matches("NOT a = 1 OR b = 2", { a: 1, b: 9 })).toBe(false); // NOT false, OR false
    expect(matches("NOT a = 1 OR b = 2", { a: 9, b: 9 })).toBe(true); // NOT true, OR ignored
  });

  it("nested NOT in parentheses", () => {
    expect(matches("NOT (NOT a = 1)", { a: 1 })).toBe(true);
    expect(matches("NOT (NOT a = 1)", { a: 2 })).toBe(false);
  });

  it("implicit AND mixed with restriction", () => {
    // "Madoka power = 7" = implicit-AND(global("Madoka"), restriction(power=7))
    expect(matches("Madoka power = 7", { name: "Madoka", power: 7 })).toBe(true);
    expect(matches("Madoka power = 7", { name: "Homura", power: 7 })).toBe(false);
    expect(matches("Madoka power = 7", { name: "Madoka", power: 99 })).toBe(false);
  });

  it("implicit AND with negation", () => {
    // "NOT a b" = implicit-AND(NOT(global(a)), global(b))
    expect(matches("NOT a b", { x: "b" })).toBe(true); // NOT(a) true since no "a", "b" matches
    expect(matches("NOT a b", { x: "a b" })).toBe(false); // NOT(a) false since "a" found
  });

  it("complex mix: a = 1 b = 2 OR b = 3 AND c = 4", () => {
    // Sequence1: Factor(a=1) Factor(b=2 OR b=3)
    // AND
    // Sequence2: Factor(c=4)
    // = (a=1 AND (b=2 OR b=3)) AND c=4
    expect(matches("a = 1 b = 2 OR b = 3 AND c = 4", { a: 1, b: 3, c: 4 })).toBe(true);
    expect(matches("a = 1 b = 2 OR b = 3 AND c = 4", { a: 1, b: 3, c: 9 })).toBe(false);
    expect(matches("a = 1 b = 2 OR b = 3 AND c = 4", { a: 1, b: 9, c: 4 })).toBe(false);
  });

  it("deeply parenthesized expression", () => {
    expect(matches("((((a = 1))))", { a: 1 })).toBe(true);
    expect(matches("((((a = 1))))", { a: 2 })).toBe(false);
  });

  it("parenthesized precedence override", () => {
    // "(a = 1 AND b = 2) OR c = 3"
    // Without parens: a=1 AND (b=2 OR c=3)
    // With parens: (a=1 AND b=2) OR c=3
    expect(matches("(a = 1 AND b = 2) OR c = 3", { a: 9, b: 9, c: 3 })).toBe(true);
    expect(matches("(a = 1 AND b = 2) OR c = 3", { a: 1, b: 2, c: 9 })).toBe(true);
    expect(matches("(a = 1 AND b = 2) OR c = 3", { a: 1, b: 9, c: 9 })).toBe(false);
  });

  it("function in complex expression", () => {
    // Function args receive the literal text "a", not the field value
    // To use field values, the function must accept field names and resolve them
    const isPositive = (v: unknown) => Number(v) > 0;
    const opts = { functions: { isPositive } };
    expect(matches("isPositive(5) AND b > 10", { b: 20 }, opts)).toBe(true);
    expect(matches("isPositive(-1) AND b > 10", { b: 20 }, opts)).toBe(false);
    expect(matches("isPositive(-1) OR b > 10", { b: 20 }, opts)).toBe(true);
  });

  it("has with function result and comparison", () => {
    const getTags = () => ["mitakihara", "v2", "stable"];
    expect(
      matches(
        "getTags():mitakihara AND version = 2",
        { version: 2 },
        {
          functions: { getTags },
        },
      ),
    ).toBe(true);
    expect(
      matches(
        "getTags():kamihama AND version = 2",
        { version: 2 },
        {
          functions: { getTags },
        },
      ),
    ).toBe(false);
  });

  it("wildcards in traversed field comparison", () => {
    expect(matches('config.name = "mitakihara-*"', { config: { name: "mitakihara-east" } })).toBe(
      true,
    );
    expect(matches('config.name = "mitakihara-*"', { config: { name: "kazamino-east" } })).toBe(
      false,
    );
  });

  it("negation of has with presence", () => {
    expect(matches("NOT tags:*", { tags: [] })).toBe(true);
    expect(matches("NOT tags:*", { tags: ["mitakihara"] })).toBe(false);
  });

  it("multiple has checks combined with AND", () => {
    expect(matches("tags:mitakihara AND tags:v2", { tags: ["mitakihara", "v2", "stable"] })).toBe(
      true,
    );
    expect(matches("tags:mitakihara AND tags:v2", { tags: ["mitakihara", "stable"] })).toBe(false);
  });

  it("has with array fanout combined with other restrictions", () => {
    const target = {
      items: [
        { name: "widget", price: 10 },
        { name: "gadget", price: 50 },
      ],
      status: "contracted",
    };
    expect(matches('items.name:widget AND status = "contracted"', target)).toBe(true);
    expect(matches('items.name:missing AND status = "contracted"', target)).toBe(false);
  });
});

describe("AIP-160: security and robustness", () => {
  it("prototype keys are not traversable", () => {
    expect(matches('constructor.name = "Object"', {})).toBe(false);
    expect(matches('toString = "x"', {})).toBe(false);
    expect(matches('__proto__.constructor = "x"', {})).toBe(false);
    expect(matches("hasOwnProperty = 1", {})).toBe(false);
    expect(matches("valueOf = 1", {})).toBe(false);
  });

  it("own properties with prototype-like names still work", () => {
    expect(matches('constructor = "mine"', { constructor: "mine" })).toBe(true);
    expect(matches("toString = 1", { toString: 1 })).toBe(true);
  });

  it("recursion depth is bounded", () => {
    const deep = "(".repeat(100) + "a" + ")".repeat(100);
    expect(() => parse(deep)).toThrow(FilterError);
  });

  it("NaN field: ordering comparisons return false", () => {
    expect(matches("a = 0", { a: NaN })).toBe(false);
    // NaN !== 0 is true in JS, so != returns true
    expect(matches("a != 0", { a: NaN })).toBe(true);
    expect(matches("a > 0", { a: NaN })).toBe(false);
    expect(matches("a < 0", { a: NaN })).toBe(false);
    expect(matches("a >= 0", { a: NaN })).toBe(false);
    expect(matches("a <= 0", { a: NaN })).toBe(false);
  });

  it("Infinity comparisons behave correctly", () => {
    expect(matches("a > 999999", { a: Infinity })).toBe(true);
    expect(matches("a < 0", { a: -Infinity })).toBe(true);
  });
});

describe("AIP-160: unicode support", () => {
  it("accented characters in field names", () => {
    expect(matches("café = 1", { café: 1 })).toBe(true);
  });

  it("accented characters in values", () => {
    expect(matches('name = "José"', { name: "José" })).toBe(true);
  });

  it("CJK characters in strings", () => {
    expect(matches('name = "日本語"', { name: "日本語" })).toBe(true);
    expect(matches('name = "日本語"', { name: "中文" })).toBe(false);
  });

  it("emoji in quoted strings", () => {
    expect(matches('tag = "🎉"', { tag: "🎉" })).toBe(true);
  });

  it("unicode in global search", () => {
    expect(matches("café", { label: "café latte" })).toBe(true);
  });
});
