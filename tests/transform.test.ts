import { describe, expect, it } from "vitest";
import type {
  ASTFunctionNode,
  ASTMemberNode,
  ASTRestrictionNode,
  ASTValueNode,
  AndNode,
  GlobalNode,
  NotNode,
  OrNode,
} from "../src";
import { ast as t, narrow } from "./helpers";

describe("transform", () => {
  describe("empty/null", () => {
    it("empty string returns null", () => {
      expect(t("")).toBeNull();
    });

    it("whitespace only returns null", () => {
      expect(t("   ")).toBeNull();
    });
  });

  describe("single-child collapsing", () => {
    it("bare text becomes global with value", () => {
      const node = t("mitakihara")!;
      const g = narrow<GlobalNode>(node, "global");
      const v = narrow<ASTValueNode>(g.value, "value");
      expect(v.value).toBe("mitakihara");
      expect(v.quoted).toBe(false);
    });

    it("bare string becomes global with quoted value", () => {
      const g = narrow<GlobalNode>(t('"hello"')!, "global");
      const v = narrow<ASTValueNode>(g.value, "value");
      expect(v.value).toBe("hello");
      expect(v.quoted).toBe(true);
    });

    it("simple restriction collapses all wrappers", () => {
      const node = t("a = b")!;
      const r = narrow<ASTRestrictionNode>(node, "restriction");
      expect(r.comparable).toMatchObject({ type: "member", path: ["a"] });
      expect(r.comparator).toBe("=");
      expect(narrow<ASTValueNode>(r.arg, "value").value).toBe("b");
    });
  });

  describe("AND", () => {
    it("two sequences", () => {
      const node = narrow<AndNode>(t("a AND b")!, "and");
      expect(node.children).toHaveLength(2);
      expect(narrow<GlobalNode>(node.children[0], "global").value).toMatchObject({ value: "a" });
      expect(narrow<GlobalNode>(node.children[1], "global").value).toMatchObject({ value: "b" });
    });

    it("three sequences", () => {
      const node = narrow<AndNode>(t("a AND b AND c")!, "and");
      expect(node.children).toHaveLength(3);
    });
  });

  describe("OR", () => {
    it("two terms", () => {
      const node = narrow<OrNode>(t("a OR b")!, "or");
      expect(node.children).toHaveLength(2);
    });

    it("three terms", () => {
      const node = narrow<OrNode>(t("a OR b OR c")!, "or");
      expect(node.children).toHaveLength(3);
    });
  });

  describe("precedence: OR binds tighter than AND", () => {
    it("a AND b OR c", () => {
      const node = narrow<AndNode>(t("a AND b OR c")!, "and");
      expect(node.children).toHaveLength(2);
      expect(node.children[0].type).toBe("global");
      const or = narrow<OrNode>(node.children[1], "or");
      expect(or.children).toHaveLength(2);
    });

    it("a OR b AND c OR d", () => {
      const node = narrow<AndNode>(t("a OR b AND c OR d")!, "and");
      expect(node.children).toHaveLength(2);
      expect(narrow<OrNode>(node.children[0], "or").children).toHaveLength(2);
      expect(narrow<OrNode>(node.children[1], "or").children).toHaveLength(2);
    });
  });

  describe("implicit AND", () => {
    it("whitespace-separated values", () => {
      const node = narrow<AndNode>(t("a b c")!, "and");
      expect(node.children).toHaveLength(3);
    });
  });

  describe("AND flattening", () => {
    it("implicit AND inside explicit AND flattens", () => {
      // "a b AND c d" -> CST has Expression[Sequence[a,b], Sequence[c,d]]
      // Without flattening: And{And{a,b}, And{c,d}}
      // With flattening: And{a, b, c, d}
      const node = narrow<AndNode>(t("a b AND c d")!, "and");
      expect(node.children).toHaveLength(4);
      expect(node.children.every((c) => c.type === "global")).toBe(true);
    });
  });

  describe("negation", () => {
    it("NOT keyword", () => {
      const node = narrow<NotNode>(t("NOT a")!, "not");
      expect(node.child.type).toBe("global");
    });

    it("minus operator", () => {
      const node = narrow<NotNode>(t("-a")!, "not");
      expect(node.child.type).toBe("global");
    });
  });

  describe("composites unwrapped", () => {
    it("parenthesized value unwraps", () => {
      const node = t("(a)")!;
      expect(node.type).toBe("global");
    });

    it("parenthesized AND unwraps", () => {
      const node = narrow<AndNode>(t("(a AND b)")!, "and");
      expect(node.children).toHaveLength(2);
    });

    it("NOT (a OR b) unwraps composite", () => {
      const node = narrow<NotNode>(t("NOT (a OR b)")!, "not");
      const or = narrow<OrNode>(node.child, "or");
      expect(or.children).toHaveLength(2);
    });
  });

  describe("restrictions with each comparator", () => {
    const cases: [string, string][] = [
      ["a = b", "="],
      ["a != b", "!="],
      ["a < b", "<"],
      ["a <= b", "<="],
      ["a > b", ">"],
      ["a >= b", ">="],
      ["a:b", ":"],
    ];
    for (const [input, expected] of cases) {
      it(`"${input}" -> comparator "${expected}"`, () => {
        expect(narrow<ASTRestrictionNode>(t(input)!, "restriction").comparator).toBe(expected);
      });
    }
  });

  describe("field paths", () => {
    it("single field", () => {
      expect(narrow<ASTRestrictionNode>(t("a.b = true")!, "restriction").comparable).toMatchObject({
        type: "member",
        path: ["a", "b"],
      });
    });

    it("multiple fields", () => {
      expect(narrow<ASTRestrictionNode>(t("a.b.c = x")!, "restriction").comparable).toMatchObject({
        type: "member",
        path: ["a", "b", "c"],
      });
    });

    it("single name", () => {
      expect(narrow<ASTRestrictionNode>(t("power = 5")!, "restriction").comparable).toMatchObject({
        type: "member",
        path: ["power"],
      });
    });
  });

  describe("value vs member args", () => {
    it("simple text value", () => {
      const arg = narrow<ASTRestrictionNode>(t("a = 5")!, "restriction").arg;
      const v = narrow<ASTValueNode>(arg, "value");
      expect(v.value).toBe("5");
      expect(v.quoted).toBe(false);
    });

    it("quoted string value", () => {
      const arg = narrow<ASTRestrictionNode>(t('a = "Madoka"')!, "restriction").arg;
      const v = narrow<ASTValueNode>(arg, "value");
      expect(v.value).toBe("Madoka");
      expect(v.quoted).toBe(true);
    });

    it("dotted numeric arg becomes value", () => {
      const arg = narrow<ASTRestrictionNode>(t("a >= 2.5")!, "restriction").arg;
      const v = narrow<ASTValueNode>(arg, "value");
      expect(v.value).toBe("2.5");
      expect(v.quoted).toBe(false);
    });

    it("dotted scientific notation becomes value", () => {
      const arg = narrow<ASTRestrictionNode>(t("a = 2.997e9")!, "restriction").arg;
      const v = narrow<ASTValueNode>(arg, "value");
      expect(v.value).toBe("2.997e9");
    });

    it("non-numeric dotted path stays as member", () => {
      const arg = narrow<ASTRestrictionNode>(t("a = b.c")!, "restriction").arg;
      const m = narrow<ASTMemberNode>(arg, "member");
      expect(m.path).toEqual(["b", "c"]);
    });

    it("multi-dot non-number stays as member", () => {
      const arg = narrow<ASTRestrictionNode>(t("a = 1.2.3")!, "restriction").arg;
      const m = narrow<ASTMemberNode>(arg, "member");
      expect(m.path).toEqual(["1", "2", "3"]);
    });
  });

  describe("function calls", () => {
    it("standalone function becomes global", () => {
      const node = t("fn()")!;
      const g = narrow<GlobalNode>(node, "global");
      const fn = narrow<ASTFunctionNode>(g.value, "function");
      expect(fn.name).toEqual(["fn"]);
      expect(fn.args).toHaveLength(0);
    });

    it("function as restriction arg", () => {
      const r = narrow<ASTRestrictionNode>(t("x <= cohort(u)")!, "restriction");
      expect(r.comparator).toBe("<=");
      const fn = narrow<ASTFunctionNode>(r.arg, "function");
      expect(fn.name).toEqual(["cohort"]);
    });

    it("qualified function name", () => {
      const g = narrow<GlobalNode>(t("math.mem('30mb')")!, "global");
      const fn = narrow<ASTFunctionNode>(g.value, "function");
      expect(fn.name).toEqual(["math", "mem"]);
      expect(fn.args).toHaveLength(1);
      expect(narrow<ASTValueNode>(fn.args[0], "value").value).toBe("30mb");
    });

    it("keyword function name NOT()", () => {
      const g = narrow<GlobalNode>(t("NOT()")!, "global");
      const fn = narrow<ASTFunctionNode>(g.value, "function");
      expect(fn.name).toEqual(["NOT"]);
      expect(fn.args).toHaveLength(0);
    });

    it("keyword function name AND()", () => {
      const g = narrow<GlobalNode>(t("AND()")!, "global");
      const fn = narrow<ASTFunctionNode>(g.value, "function");
      expect(fn.name).toEqual(["AND"]);
    });

    it("qualified keyword function NOT.check()", () => {
      const g = narrow<GlobalNode>(t("NOT.check()")!, "global");
      const fn = narrow<ASTFunctionNode>(g.value, "function");
      expect(fn.name).toEqual(["NOT", "check"]);
    });

    it("function with multiple args", () => {
      const g = narrow<GlobalNode>(t("regex(m.key, '^.*prod.*$')")!, "global");
      const fn = narrow<ASTFunctionNode>(g.value, "function");
      expect(fn.args).toHaveLength(2);
      expect(narrow<ASTMemberNode>(fn.args[0], "member").path).toEqual(["m", "key"]);
      expect(narrow<ASTValueNode>(fn.args[1], "value").value).toBe("^.*prod.*$");
    });
  });

  describe("keywords as fields preserved", () => {
    it("keyword after dot in field path", () => {
      expect(
        narrow<ASTRestrictionNode>(t("a.AND = true")!, "restriction").comparable,
      ).toMatchObject({
        type: "member",
        path: ["a", "AND"],
      });
    });

    it("multiple keyword fields", () => {
      expect(
        narrow<ASTRestrictionNode>(t("a.OR.NOT = 1")!, "restriction").comparable,
      ).toMatchObject({
        type: "member",
        path: ["a", "OR", "NOT"],
      });
    });
  });

  describe("spans preserved", () => {
    it("restriction span", () => {
      const r = narrow<ASTRestrictionNode>(t("a = b")!, "restriction");
      expect(r.span).toEqual({ start: 0, end: 5 });
    });

    it("global span", () => {
      const g = narrow<GlobalNode>(t("mitakihara")!, "global");
      expect(g.span).toEqual({ start: 0, end: 10 });
    });

    it("null filter has no span", () => {
      expect(t("")).toBeNull();
    });
  });

  describe("OR flattening", () => {
    it("a OR b OR c produces flat or node (no nested or children)", () => {
      const node = narrow<OrNode>(t("a OR b OR c")!, "or");
      expect(node.children).toHaveLength(3);
      for (const child of node.children) {
        expect(child.type).not.toBe("or");
      }
    });
  });

  describe("numeric LHS path collapsing", () => {
    it("2.5 on LHS becomes collapsed value path", () => {
      const g = narrow<GlobalNode>(t("2.5")!, "global");
      expect(g.value.type).toBe("value");
      expect(narrow<ASTValueNode>(g.value, "value").value).toBe("2.5");
    });

    it("2.5 as comparable in restriction", () => {
      const r = narrow<ASTRestrictionNode>(t("2.5 >= 2.4")!, "restriction");
      expect(r.comparable.type).toBe("member");
      expect(narrow<ASTMemberNode>(r.comparable, "member").path).toEqual(["2.5"]);
    });
  });

  describe("complex spec expressions", () => {
    it('power >= 5 AND name = "Madoka"', () => {
      const node = narrow<AndNode>(t('power >= 5 AND name = "Madoka"')!, "and");
      expect(node.children).toHaveLength(2);

      const r1 = narrow<ASTRestrictionNode>(node.children[0], "restriction");
      expect(r1.comparable).toMatchObject({ type: "member", path: ["power"] });
      expect(r1.comparator).toBe(">=");
      expect(narrow<ASTValueNode>(r1.arg, "value").value).toBe("5");

      const r2 = narrow<ASTRestrictionNode>(node.children[1], "restriction");
      expect(r2.comparable).toMatchObject({ type: "member", path: ["name"] });
      expect(r2.comparator).toBe("=");
      const r2v = narrow<ASTValueNode>(r2.arg, "value");
      expect(r2v.value).toBe("Madoka");
      expect(r2v.quoted).toBe(true);
    });

    it("Mitakihara Magical Girls OR Holy Quintet", () => {
      const node = narrow<AndNode>(t("Mitakihara Magical Girls OR Holy Quintet")!, "and");
      expect(node.children).toHaveLength(4);
      expect(node.children[0].type).toBe("global");
      expect(node.children[1].type).toBe("global");

      const or = narrow<OrNode>(node.children[2], "or");
      expect(or.children).toHaveLength(2);
      expect(node.children[3].type).toBe("global");
    });

    it("NOT (a OR b)", () => {
      const node = narrow<NotNode>(t("NOT (a OR b)")!, "not");
      const or = narrow<OrNode>(node.child, "or");
      expect(or.children).toHaveLength(2);
    });

    it("experiment.rollout <= cohort(request.user)", () => {
      const r = narrow<ASTRestrictionNode>(
        t("experiment.rollout <= cohort(request.user)")!,
        "restriction",
      );
      expect(r.comparable).toMatchObject({ type: "member", path: ["experiment", "rollout"] });
      expect(r.comparator).toBe("<=");
      const fn = narrow<ASTFunctionNode>(r.arg, "function");
      expect(fn.name).toEqual(["cohort"]);
    });

    it("m.foo:*", () => {
      const r = narrow<ASTRestrictionNode>(t("m.foo:*")!, "restriction");
      expect(r.comparable).toMatchObject({ type: "member", path: ["m", "foo"] });
      expect(r.comparator).toBe(":");
      expect(narrow<ASTValueNode>(r.arg, "value").value).toBe("*");
    });
  });

  describe("function as LHS of comparison", () => {
    it("fn() = 42: function as comparable", () => {
      const r = narrow<ASTRestrictionNode>(t("fn() = 42")!, "restriction");
      const fn = narrow<ASTFunctionNode>(r.comparable, "function");
      expect(fn.name).toEqual(["fn"]);
      expect(r.comparator).toBe("=");
      expect(narrow<ASTValueNode>(r.arg, "value").value).toBe("42");
    });

    it("qualified function math.check() >= 10", () => {
      const r = narrow<ASTRestrictionNode>(t("math.check() >= 10")!, "restriction");
      const fn = narrow<ASTFunctionNode>(r.comparable, "function");
      expect(fn.name).toEqual(["math", "check"]);
      expect(r.comparator).toBe(">=");
      expect(narrow<ASTValueNode>(r.arg, "value").value).toBe("10");
    });

    it("fn():*: has operator with function comparable", () => {
      const r = narrow<ASTRestrictionNode>(t("fn():*")!, "restriction");
      const fn = narrow<ASTFunctionNode>(r.comparable, "function");
      expect(fn.name).toEqual(["fn"]);
      expect(r.comparator).toBe(":");
      expect(narrow<ASTValueNode>(r.arg, "value").value).toBe("*");
    });

    it("fn() without comparator is still global", () => {
      const node = t("fn()")!;
      const g = narrow<GlobalNode>(node, "global");
      expect(g.value.type).toBe("function");
    });
  });

  describe("bare numeric values", () => {
    it("integer stays as string value", () => {
      const g = narrow<GlobalNode>(t("123")!, "global");
      const v = narrow<ASTValueNode>(g.value, "value");
      expect(v.value).toBe("123");
      expect(v.quoted).toBe(false);
    });

    it("dotted float as arg becomes value, not member", () => {
      const r = narrow<ASTRestrictionNode>(t("a = 2.5")!, "restriction");
      expect(r.arg.type).toBe("value");
      expect(narrow<ASTValueNode>(r.arg, "value").value).toBe("2.5");
    });

    it("dotted float as comparable becomes value, not member", () => {
      const g = narrow<GlobalNode>(t("2.5")!, "global");
      expect(g.value.type).toBe("value");
      expect(narrow<ASTValueNode>(g.value, "value").value).toBe("2.5");
    });

    it("triple-dotted number 1.2.3 stays as member (not a valid number)", () => {
      const r = narrow<ASTRestrictionNode>(t("a = 1.2.3")!, "restriction");
      expect(r.arg.type).toBe("member");
    });
  });
});
