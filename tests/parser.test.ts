import { describe, expect, it } from "vitest";
import {
  DepthLimitError,
  EmptyExpressionError,
  ExpectedExpressionError,
  ExpectedIdentifierError,
  ExpectedValueError,
  InputLengthError,
  InvalidFunctionNameError,
  InvalidNegationError,
  TokenKind,
  UnclosedDelimiterError,
  UnexpectedTokenError,
  parse,
} from "../src";
import { catchError, narrow } from "./helpers";
import type {
  CompositeNode,
  FactorNode,
  FunctionCallNode,
  MemberNode,
  RestrictionNode,
  SequenceNode,
  TermNode,
} from "../src";

function restriction(input: string): RestrictionNode {
  const tree = parse(input);
  const expr = tree.expression!;
  expect(expr.sequences).toHaveLength(1);
  const seq = expr.sequences[0];
  expect(seq.factors).toHaveLength(1);
  const factor = seq.factors[0];
  expect(factor.terms).toHaveLength(1);
  const term = factor.terms[0];
  expect(term.negated).toBe(false);
  return narrow<RestrictionNode>(term.simple, "Restriction");
}

function member(input: string): MemberNode {
  const r = restriction(input);
  return narrow<MemberNode>(r.comparable, "Member");
}

function fieldValues(m: MemberNode): string[] {
  return m.fields.map((f) => f.token.value);
}

function sequences(input: string): SequenceNode[] {
  return parse(input).expression!.sequences;
}

function factors(input: string): FactorNode[] {
  const seqs = sequences(input);
  expect(seqs).toHaveLength(1);
  return seqs[0].factors;
}

function terms(input: string): TermNode[] {
  const facs = factors(input);
  expect(facs).toHaveLength(1);
  return facs[0].terms;
}

describe("parse", () => {
  describe("empty and trivial", () => {
    it("empty string", () => {
      const tree = parse("");
      expect(tree.type).toBe("Filter");
      expect(tree.expression).toBeNull();
    });

    it("whitespace only", () => {
      const tree = parse("   ");
      expect(tree.expression).toBeNull();
    });
  });

  describe("global restrictions (bare values)", () => {
    it("text value", () => {
      const r = restriction("prod");
      expect(r.comparable.type).toBe("Member");
      expect(narrow<MemberNode>(r.comparable, "Member").value.token.value).toBe("prod");
      expect(r.comparator).toBeNull();
      expect(r.arg).toBeNull();
    });

    it("numeric text", () => {
      const r = restriction("42");
      expect(narrow<MemberNode>(r.comparable, "Member").value.token.value).toBe("42");
      expect(r.comparator).toBeNull();
    });

    it("string value", () => {
      const r = restriction('"hello"');
      expect(narrow<MemberNode>(r.comparable, "Member").value.token.kind).toBe(TokenKind.String);
      expect(narrow<MemberNode>(r.comparable, "Member").value.token.value).toBe("hello");
      expect(r.comparator).toBeNull();
    });

    it("multiple bare values (implicit AND)", () => {
      const facs = factors("Homura Madoka");
      expect(facs).toHaveLength(2);
    });
  });

  describe("field restrictions with each comparator", () => {
    it("equals", () => {
      const r = restriction("a = b");
      expect(r.comparator).toBe(TokenKind.Equals);
      expect(r.arg!.type).toBe("Member");
    });

    it("not equals", () => {
      expect(restriction("a != b").comparator).toBe(TokenKind.NotEquals);
    });

    it("less than", () => {
      expect(restriction("a < b").comparator).toBe(TokenKind.LessThan);
    });

    it("less equals", () => {
      expect(restriction("a <= b").comparator).toBe(TokenKind.LessEquals);
    });

    it("greater than", () => {
      expect(restriction("a > b").comparator).toBe(TokenKind.GreaterThan);
    });

    it("greater equals", () => {
      expect(restriction("a >= b").comparator).toBe(TokenKind.GreaterEquals);
    });

    it("has", () => {
      expect(restriction("a:b").comparator).toBe(TokenKind.Has);
    });

    it("no spaces (restrictions not whitespace sensitive)", () => {
      const r = restriction("a=b");
      expect(r.comparator).toBe(TokenKind.Equals);
      expect(narrow<MemberNode>(r.comparable, "Member").value.token.value).toBe("a");
      expect(narrow<MemberNode>(r.arg, "Member").value.token.value).toBe("b");
    });
  });

  describe("traversal (dot paths)", () => {
    it("single field", () => {
      const m = member("a.b = true");
      expect(m.value.token.value).toBe("a");
      expect(fieldValues(m)).toEqual(["b"]);
    });

    it("multiple fields", () => {
      const m = member('a.b.c = "foo"');
      expect(m.value.token.value).toBe("a");
      expect(fieldValues(m)).toEqual(["b", "c"]);
    });

    it("numeric field (map key)", () => {
      const r = restriction("expr.type_map.1.type");
      const m = narrow<MemberNode>(r.comparable, "Member");
      expect(m.value.token.value).toBe("expr");
      expect(fieldValues(m)).toEqual(["type_map", "1", "type"]);
    });
  });

  describe("AND expressions", () => {
    it("two sequences", () => {
      const seqs = sequences("a AND b");
      expect(seqs).toHaveLength(2);
    });

    it("three sequences", () => {
      const seqs = sequences("a AND b AND c");
      expect(seqs).toHaveLength(3);
    });
  });

  describe("OR factors", () => {
    it("two terms", () => {
      const t = terms("a OR b");
      expect(t).toHaveLength(2);
    });

    it("three terms", () => {
      const t = terms("a OR b OR c");
      expect(t).toHaveLength(3);
    });
  });

  describe("precedence: OR binds tighter than AND", () => {
    it("a AND b OR c", () => {
      const seqs = sequences("a AND b OR c");
      expect(seqs).toHaveLength(2);
      expect(seqs[0].factors).toHaveLength(1);
      expect(seqs[0].factors[0].terms).toHaveLength(1);
      expect(seqs[1].factors).toHaveLength(1);
      expect(seqs[1].factors[0].terms).toHaveLength(2);
    });

    it("a AND (b OR c) equivalent", () => {
      const seqs = sequences("a AND (b OR c)");
      expect(seqs).toHaveLength(2);
    });
  });

  describe("implicit AND (sequence with multiple factors)", () => {
    it("Mitakihara Magical Girls OR Holy Quintet", () => {
      const facs = factors("Mitakihara Magical Girls OR Holy Quintet");
      expect(facs).toHaveLength(4);
      expect(facs[0].terms).toHaveLength(1);
      expect(facs[1].terms).toHaveLength(1);
      expect(facs[2].terms).toHaveLength(2);
      expect(facs[3].terms).toHaveLength(1);
    });
  });

  describe("negation", () => {
    it("NOT keyword", () => {
      const t = terms("NOT a");
      expect(t).toHaveLength(1);
      expect(t[0].negated).toBe(true);
      expect(t[0].simple.type).toBe("Restriction");
    });

    it("minus operator", () => {
      const t = terms("-a");
      expect(t).toHaveLength(1);
      expect(t[0].negated).toBe(true);
    });

    it("NOT with composite", () => {
      const t = terms("NOT (a OR b)");
      expect(t).toHaveLength(1);
      expect(t[0].negated).toBe(true);
      expect(t[0].simple.type).toBe("Composite");
    });

    it("minus with restriction", () => {
      const t = terms('-file:".java"');
      expect(t).toHaveLength(1);
      expect(t[0].negated).toBe(true);
      const r = narrow<RestrictionNode>(t[0].simple, "Restriction");
      expect(r.comparator).toBe(TokenKind.Has);
    });
  });

  describe("composites (parentheses)", () => {
    it("simple parenthesized value", () => {
      const tree = parse("(a)");
      const expr = tree.expression!;
      const simple = expr.sequences[0].factors[0].terms[0].simple;
      expect(simple.type).toBe("Composite");
      const inner = narrow<CompositeNode>(simple, "Composite").expression;
      expect(inner.sequences).toHaveLength(1);
    });

    it("parenthesized AND", () => {
      const tree = parse("(a AND b)");
      const composite = narrow<CompositeNode>(
        tree.expression!.sequences[0].factors[0].terms[0].simple,
        "Composite",
      );
      expect(composite.expression.sequences).toHaveLength(2);
    });

    it("composite in AND expression", () => {
      const seqs = sequences("a AND (b OR c)");
      expect(seqs).toHaveLength(2);
      const term = seqs[1].factors[0].terms[0];
      expect(term.simple.type).toBe("Composite");
    });
  });

  describe("function calls", () => {
    it("no args", () => {
      const r = restriction("fn()");
      expect(r.comparable.type).toBe("FunctionCall");
      const fn = narrow<FunctionCallNode>(r.comparable, "FunctionCall");
      expect(fn.name).toHaveLength(1);
      expect(fn.name[0].token.value).toBe("fn");
      expect(fn.args).toHaveLength(0);
    });

    it("one arg", () => {
      const fn = narrow<FunctionCallNode>(restriction("fn(a)").comparable, "FunctionCall");
      expect(fn.args).toHaveLength(1);
      expect(fn.args[0].type).toBe("Member");
    });

    it("two args", () => {
      const fn = narrow<FunctionCallNode>(restriction("fn(a, b)").comparable, "FunctionCall");
      expect(fn.args).toHaveLength(2);
    });

    it("qualified name", () => {
      const fn = narrow<FunctionCallNode>(
        restriction("math.mem('30mb')").comparable,
        "FunctionCall",
      );
      expect(fn.name).toHaveLength(2);
      expect(fn.name[0].token.value).toBe("math");
      expect(fn.name[1].token.value).toBe("mem");
      expect(fn.args).toHaveLength(1);
    });

    it("complex args", () => {
      const fn = narrow<FunctionCallNode>(
        restriction("regex(m.key, '^.*prod.*$')").comparable,
        "FunctionCall",
      );
      expect(fn.args).toHaveLength(2);
      const firstArg = narrow<MemberNode>(fn.args[0], "Member");
      expect(firstArg.type).toBe("Member");
      expect(firstArg.value.token.value).toBe("m");
      expect(firstArg.fields).toHaveLength(1);

      const secondArg = narrow<MemberNode>(fn.args[1], "Member");
      expect(secondArg.value.token.kind).toBe(TokenKind.String);
    });
  });

  describe("keyword function names (adjacency-based)", () => {
    it("NOT(): no space: is a function call", () => {
      const r = restriction("NOT()");
      expect(r.comparable.type).toBe("FunctionCall");
      const fn = narrow<FunctionCallNode>(r.comparable, "FunctionCall");
      expect(fn.name[0].token.value).toBe("NOT");
      expect(fn.args).toHaveLength(0);
    });

    it("AND(): no space: is a function call", () => {
      const r = restriction("AND()");
      expect(r.comparable.type).toBe("FunctionCall");
      const fn = narrow<FunctionCallNode>(r.comparable, "FunctionCall");
      expect(fn.name[0].token.value).toBe("AND");
    });

    it("OR(): no space: is a function call", () => {
      const r = restriction("OR()");
      expect(r.comparable.type).toBe("FunctionCall");
      const fn = narrow<FunctionCallNode>(r.comparable, "FunctionCall");
      expect(fn.name[0].token.value).toBe("OR");
    });

    it("NOT (x): with space: is negation", () => {
      const tree = parse("NOT (x)");
      const term = narrow<TermNode>(tree.expression!.sequences[0].factors[0].terms[0], "Term");
      expect(term.negated).toBe(true);
    });

    it("NOT.foo(): qualified keyword function", () => {
      const r = restriction("NOT.foo()");
      expect(r.comparable.type).toBe("FunctionCall");
      const fn = narrow<FunctionCallNode>(r.comparable, "FunctionCall");
      expect(fn.name[0].token.value).toBe("NOT");
      expect(fn.name[1].token.value).toBe("foo");
    });

    it("a AND(): implicit AND with keyword function", () => {
      const tree = parse("a AND()");
      const seq = tree.expression!.sequences[0];
      expect(seq.factors).toHaveLength(2);
      const second = narrow<RestrictionNode>(seq.factors[1].terms[0].simple, "Restriction");
      expect(second.comparable.type).toBe("FunctionCall");
      expect(narrow<FunctionCallNode>(second.comparable, "FunctionCall").name[0].token.value).toBe(
        "AND",
      );
    });

    it("a AND b: with spaces: is still a binary operator", () => {
      const tree = parse("a AND b");
      expect(tree.expression!.sequences).toHaveLength(2);
    });

    it("NOT(x): no space: is function call with arg", () => {
      const r = restriction("NOT(x)");
      expect(r.comparable.type).toBe("FunctionCall");
      const fn = narrow<FunctionCallNode>(r.comparable, "FunctionCall");
      expect(fn.name[0].token.value).toBe("NOT");
      expect(fn.args).toHaveLength(1);
    });

    it("fn (): with space: is NOT a function call", () => {
      const tree = parse("fn (a)");
      const seq = tree.expression!.sequences[0];
      expect(seq.factors).toHaveLength(2);
      expect(seq.factors[0].terms[0].simple.type).toBe("Restriction");
      expect(
        narrow<RestrictionNode>(seq.factors[0].terms[0].simple, "Restriction").comparable.type,
      ).toBe("Member");
      expect(seq.factors[1].terms[0].simple.type).toBe("Composite");
    });
  });

  describe("function call as restriction arg", () => {
    it("x <= cohort(request.user)", () => {
      const r = restriction("x <= cohort(request.user)");
      expect(r.comparator).toBe(TokenKind.LessEquals);
      expect(r.arg!.type).toBe("FunctionCall");
      const fn = narrow<FunctionCallNode>(r.arg, "FunctionCall");
      expect(fn.name[0].token.value).toBe("cohort");
      expect(fn.args).toHaveLength(1);
    });
  });

  describe("keywords as field names (after dots)", () => {
    it("a.AND = true", () => {
      const r = restriction("a.AND = true");
      const m = narrow<MemberNode>(r.comparable, "Member");
      expect(m.value.token.value).toBe("a");
      expect(m.fields).toHaveLength(1);
      expect(m.fields[0].token.kind).toBe(TokenKind.And);
      expect(m.fields[0].token.value).toBe("AND");
    });

    it("a.OR.NOT = 1", () => {
      const r = restriction("a.OR.NOT = 1");
      const m = narrow<MemberNode>(r.comparable, "Member");
      expect(fieldValues(m)).toEqual(["OR", "NOT"]);
    });
  });

  describe("complete spec expressions", () => {
    it('power >= 5 AND name = "Madoka"', () => {
      const seqs = sequences('power >= 5 AND name = "Madoka"');
      expect(seqs).toHaveLength(2);

      const r1 = narrow<RestrictionNode>(seqs[0].factors[0].terms[0].simple, "Restriction");
      expect(narrow<MemberNode>(r1.comparable, "Member").value.token.value).toBe("power");
      expect(r1.comparator).toBe(TokenKind.GreaterEquals);

      const r2 = narrow<RestrictionNode>(seqs[1].factors[0].terms[0].simple, "Restriction");
      expect(narrow<MemberNode>(r2.comparable, "Member").value.token.value).toBe("name");
      expect(r2.comparator).toBe(TokenKind.Equals);
    });

    it("a < 10 OR a >= 100", () => {
      const t = terms("a < 10 OR a >= 100");
      expect(t).toHaveLength(2);
      expect(narrow<RestrictionNode>(t[0].simple, "Restriction").comparator).toBe(
        TokenKind.LessThan,
      );
      expect(narrow<RestrictionNode>(t[1].simple, "Restriction").comparator).toBe(
        TokenKind.GreaterEquals,
      );
    });

    it("experiment.rollout <= cohort(request.user)", () => {
      const r = restriction("experiment.rollout <= cohort(request.user)");
      expect(r.comparator).toBe(TokenKind.LessEquals);
      expect(r.arg!.type).toBe("FunctionCall");
    });

    it("(msg.endsWith('world') AND retries < 10)", () => {
      const tree = parse("(msg.endsWith('world') AND retries < 10)");
      const composite = narrow<CompositeNode>(
        tree.expression!.sequences[0].factors[0].terms[0].simple,
        "Composite",
      );
      expect(composite.type).toBe("Composite");
      expect(composite.expression.sequences).toHaveLength(2);
    });

    it("m.foo:*", () => {
      const r = restriction("m.foo:*");
      expect(r.comparator).toBe(TokenKind.Has);
      expect(narrow<MemberNode>(r.arg, "Member").value.token.value).toBe("*");
    });

    it("r:42", () => {
      const r = restriction("r:42");
      expect(r.comparator).toBe(TokenKind.Has);
      expect(narrow<MemberNode>(r.arg, "Member").value.token.value).toBe("42");
    });
  });

  describe("spans", () => {
    it("filter spans entire input", () => {
      const tree = parse("a = b");
      expect(tree.span).toEqual({ start: 0, end: 5 });
    });

    it("empty filter span", () => {
      const tree = parse("");
      expect(tree.span).toEqual({ start: 0, end: 0 });
    });

    it("member span covers value and fields", () => {
      const m = member("a.b.c = x");
      expect(m.span).toEqual({ start: 0, end: 5 });
    });

    it("composite span covers parens", () => {
      const tree = parse("(a)");
      const composite = narrow<CompositeNode>(
        tree.expression!.sequences[0].factors[0].terms[0].simple,
        "Composite",
      );
      expect(composite.span).toEqual({ start: 0, end: 3 });
    });

    it("function call span covers name through closing paren", () => {
      const fn = narrow<FunctionCallNode>(restriction("fn(a, b)").comparable, "FunctionCall");
      expect(fn.span).toEqual({ start: 0, end: 8 });
    });

    it("restriction span covers comparable through arg", () => {
      const r = restriction("power >= 5");
      expect(r.span).toEqual({ start: 0, end: 10 });
    });

    it("global restriction span equals comparable span", () => {
      const r = restriction("mitakihara");
      expect(r.span).toEqual({ start: 0, end: 10 });
    });
  });

  describe("error messages", () => {
    it("keyword at start", () => {
      const err = catchError(() => parse("AND"), ExpectedIdentifierError);
      expect(err.description).toContain("keyword 'AND'");
      expect(err.hints.length).toBeGreaterThan(0);
    });

    it("trailing AND", () => {
      const err = catchError(() => parse("a AND"), ExpectedExpressionError);
      expect(err.description).toContain("after 'AND'");
      expect(err.description).toContain("end of input");
    });

    it("double AND", () => {
      const err = catchError(() => parse("a AND AND b"), ExpectedExpressionError);
      expect(err.description).toContain("after 'AND'");
      expect(err.hints).toContain("Remove the duplicate 'AND', or add an expression between them");
    });

    it("trailing OR", () => {
      const err = catchError(() => parse("a OR"), ExpectedExpressionError);
      expect(err.description).toContain("after 'OR'");
    });

    it("duplicate OR", () => {
      const err = catchError(() => parse("a OR OR b"), ExpectedExpressionError);
      expect(err.description).toContain("after 'OR'");
      expect(err.hints).toContain("Remove the duplicate 'OR', or add an expression between them");
    });

    it("AND directly after OR", () => {
      const err = catchError(() => parse("a OR AND b"), ExpectedExpressionError);
      expect(err.hints.some((h) => h.includes("'AND' cannot directly follow 'OR'"))).toBe(true);
    });

    it("unclosed parenthesis", () => {
      const err = catchError(() => parse("(a"), UnclosedDelimiterError);
      expect(err.description).toContain("Unclosed parenthesis");
      expect(err.hints.length).toBeGreaterThan(0);
    });

    it("empty parentheses", () => {
      const err = catchError(() => parse("()"), EmptyExpressionError);
      expect(err.description).toContain("inside parentheses");
    });

    it("missing value after comparator", () => {
      const err = catchError(() => parse("a ="), ExpectedValueError);
      expect(err.description).toContain("after '='");
      expect(err.description).toContain("end of input");
    });

    it("double equals hint", () => {
      const err = catchError(() => parse("a == b"), ExpectedValueError);
      expect(err.hints.some((h) => h.includes("=="))).toBe(true);
    });

    it("keyword as value with hint", () => {
      const err = catchError(() => parse("a = AND"), ExpectedValueError);
      expect(err.hints.some((h) => h.includes("quotes"))).toBe(true);
    });

    it("NOT as field name hint", () => {
      const err = catchError(() => parse("NOT = true"), ExpectedExpressionError);
      expect(err.hints.some((h) => h.includes("NOT"))).toBe(true);
    });

    it("unmatched closing paren", () => {
      const err = catchError(() => parse("a)"), UnexpectedTokenError);
      expect(err.description).toContain("Unexpected");
      expect(err.hints.some((h) => h.includes("'('"))).toBe(true);
    });

    it("missing field name after dot", () => {
      const err = catchError(() => parse("a . = b"), ExpectedValueError);
      expect(err.description).toContain("field name after '.'");
    });

    it("error spans point at offending token", () => {
      const err = catchError(() => parse("a AND AND b"), ExpectedExpressionError);
      expect(err.span?.start).toBe(6);
    });

    it("error includes source string", () => {
      const err = catchError(() => parse("a AND"), ExpectedExpressionError);
      expect(err.source).toBe("a AND");
    });

    it("quoted string as function name", () => {
      const err = catchError(() => parse('"quoted"()'), InvalidFunctionNameError);
      expect(err.description).toContain("Quoted strings cannot be used as function names");
      expect(err.hints.some((h) => h.includes("Remove the quotes"))).toBe(true);
    });

    it("quoted string in qualified function name", () => {
      const err = catchError(() => parse('"a"."b"()'), InvalidFunctionNameError);
      expect(err.description).toContain("Quoted strings cannot be used as function names");
    });

    it("single-quoted string as function name", () => {
      const err = catchError(() => parse("'single'()"), InvalidFunctionNameError);
      expect(err.description).toContain("Quoted strings cannot be used as function names");
    });

    it("quoted string only in qualified part of function name", () => {
      const err = catchError(() => parse('foo."bar"()'), InvalidFunctionNameError);
      expect(err.description).toContain("Quoted strings cannot be used as function names");
    });

    it("OR directly after AND", () => {
      const err = catchError(() => parse("a AND OR b"), ExpectedExpressionError);
      expect(err.description).toContain("after 'AND'");
      expect(err.hints.some((h) => h.includes("'OR' cannot directly follow 'AND'"))).toBe(true);
    });

    it("keyword as value after comparator suggests quoting", () => {
      const err = catchError(() => parse("a = AND"), ExpectedValueError);
      expect(err.hints.some((h) => h.includes('wrap it in quotes: "AND"'))).toBe(true);
    });

    it("missing argument after comma in function call", () => {
      const err = catchError(() => parse("fn(a,)"), ExpectedValueError);
      expect(err.description).toContain("after ','");
    });

    it("missing closing paren on function call", () => {
      const err = catchError(() => parse("fn(a"), UnclosedDelimiterError);
      expect(err.description).toContain("Expected ')' to close function call");
    });
  });

  describe("negative values on RHS", () => {
    it("integer: a = -30", () => {
      const r = restriction("a = -30");
      expect(r.comparator).toBe(TokenKind.Equals);
      const arg = narrow<MemberNode>(r.arg, "Member");
      expect(arg.type).toBe("Member");
      expect(arg.value.token.value).toBe("-30");
      expect(arg.fields).toHaveLength(0);
    });

    it("float: a = -3.14", () => {
      const r = restriction("a = -3.14");
      const arg = narrow<MemberNode>(r.arg, "Member");
      expect(arg.value.token.value).toBe("-3");
      expect(arg.fields).toHaveLength(1);
      expect(arg.fields[0].token.value).toBe("14");
    });

    it("comparison: a > -10", () => {
      const r = restriction("a > -10");
      expect(r.comparator).toBe(TokenKind.GreaterThan);
      const arg = narrow<MemberNode>(r.arg, "Member");
      expect(arg.value.token.value).toBe("-10");
    });

    it("in function arg: fn(-30)", () => {
      const r = restriction("fn(-30)");
      const fn = narrow<FunctionCallNode>(r.comparable, "FunctionCall");
      expect(fn.args).toHaveLength(1);
      const arg = narrow<MemberNode>(fn.args[0], "Member");
      expect(arg.value.token.value).toBe("-30");
    });

    it("in function arg list: fn(a, -30)", () => {
      const r = restriction("fn(a, -30)");
      const fn = narrow<FunctionCallNode>(r.comparable, "FunctionCall");
      expect(fn.args).toHaveLength(2);
      const arg = narrow<MemberNode>(fn.args[1], "Member");
      expect(arg.value.token.value).toBe("-30");
    });

    it("span covers minus through value", () => {
      const r = restriction("a = -30");
      const arg = narrow<MemberNode>(r.arg, "Member");
      expect(arg.span.start).toBe(4);
      expect(arg.span.end).toBe(7);
    });

    it("error: negative dotted path", () => {
      const err = catchError(() => parse("a = -b.c"), InvalidNegationError);
      expect(err.description).toContain("numeric value");
    });

    it("error: negative with nothing after", () => {
      expect(() => parse("a = -")).toThrow(ExpectedValueError);
    });
  });

  describe("keyword as function argument", () => {
    it("fn(AND): keyword as arg is a parse error", () => {
      const err = catchError(() => parse("fn(AND)"), ExpectedValueError);
      expect(err.description).toContain("after '('");
      expect(err.hints.some((h) => h.includes('"AND"'))).toBe(true);
    });

    it("fn(OR): keyword as arg is a parse error", () => {
      const err = catchError(() => parse("fn(OR)"), ExpectedValueError);
      expect(err.hints.some((h) => h.includes('"OR"'))).toBe(true);
    });

    it("fn(NOT): keyword as arg is a parse error", () => {
      const err = catchError(() => parse("fn(NOT)"), ExpectedValueError);
      expect(err.hints.some((h) => h.includes('"NOT"'))).toBe(true);
    });

    it("fn(a, AND): keyword as second arg is a parse error", () => {
      const err = catchError(() => parse("fn(a, AND)"), ExpectedValueError);
      expect(err.description).toContain("after ','");
    });
  });

  describe("quoted string member with dot traversal", () => {
    it('"quoted".field = value parses as member with dot path', () => {
      const r = restriction('"quoted".field = x');
      const m = narrow<MemberNode>(r.comparable, "Member");
      expect(m.value.token.kind).toBe(TokenKind.String);
      expect(m.value.token.value).toBe("quoted");
      expect(fieldValues(m)).toEqual(["field"]);
    });

    it('"a"."b" parses as member with dot-separated values', () => {
      const r = restriction('"a"."b"');
      const m = narrow<MemberNode>(r.comparable, "Member");
      expect(m.value.token.value).toBe("a");
      expect(m.fields).toHaveLength(1);
      expect(m.fields[0].token.value).toBe("b");
    });
  });

  describe("negative value applied to function call", () => {
    it("a = -fn() throws InvalidNegationError with function target", () => {
      const err = catchError(() => parse("a = -fn()"), InvalidNegationError);
      expect(err.target).toBe("function");
      expect(err.description).toContain("function call");
    });
  });

  describe("recursion depth limit", () => {
    it("deeply nested parens (200) throws DepthLimitError", () => {
      const input = "(".repeat(200) + "a" + ")".repeat(200);
      const err = catchError(() => parse(input), DepthLimitError);
      expect(err.description).toContain("depth");
    });

    it("moderate nesting (50) parses fine", () => {
      const input = "(".repeat(50) + "a" + ")".repeat(50);
      expect(() => parse(input)).not.toThrow();
    });

    it("custom maxDepth is respected", () => {
      const input = "(".repeat(10) + "a" + ")".repeat(10);
      expect(() => parse(input, { maxDepth: 5 })).toThrow(DepthLimitError);
      expect(() => parse(input, { maxDepth: 10 })).not.toThrow();
    });
  });

  describe("input length limit", () => {
    it("rejects input exceeding default maxLength (8192)", () => {
      const input = "a ".repeat(5000); // 10000 chars
      expect(() => parse(input)).toThrow(InputLengthError);
      expect(() => parse(input)).toThrow(/maximum length/);
    });

    it("accepts input within default maxLength", () => {
      const input = "a ".repeat(4000); // 8000 chars
      expect(() => parse(input)).not.toThrow();
    });

    it("custom maxLength is respected", () => {
      const input = "a ".repeat(100); // 200 chars
      expect(() => parse(input, { maxLength: 50 })).toThrow(InputLengthError);
      expect(() => parse(input, { maxLength: 200 })).not.toThrow();
    });

    it("maxLength: Infinity disables the limit", () => {
      const input = "a ".repeat(10000);
      expect(() => parse(input, { maxLength: Infinity })).not.toThrow();
    });
  });
});
