import { describe, expect, it } from "vitest";
import {
  parse,
  transform,
  evaluate,
  hasErrorNodes,
  toCleanTree,
  tokenize,
  type ParseResult,
  type ErrorNode,
  UnexpectedTokenError,
  ExpectedExpressionError,
  ExpectedValueError,
  EmptyExpressionError,
  UnclosedDelimiterError,
  InvalidFunctionNameError,
  InvalidNegationError,
  DepthLimitError,
  InputLengthError,
  UnexpectedCharacterError,
  UnterminatedStringError,
} from "../src";

function tolerant(input: string, options?: { maxDepth?: number; maxLength?: number }): ParseResult {
  return parse(input, { tolerant: true, ...options });
}

describe("tolerant parsing", () => {
  describe("backward compatibility", () => {
    it("strict mode still throws on first error", () => {
      expect(() => parse("a AND AND b")).toThrow(ExpectedExpressionError);
    });

    it("strict mode returns FilterNode directly", () => {
      const cst = parse("a = 1");
      expect(cst.type).toBe("Filter");
    });

    it("valid input in tolerant mode returns ok: true", () => {
      const result = tolerant("a = 1 AND b = 2");
      expect(result.ok).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.cst.type).toBe("Filter");
    });

    it("empty input in tolerant mode returns ok: true", () => {
      const result = tolerant("");
      expect(result.ok).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.cst.expression).toBeNull();
    });

    it("whitespace-only input in tolerant mode returns ok: true", () => {
      const result = tolerant("   ");
      expect(result.ok).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.cst.expression).toBeNull();
    });
  });

  describe("lexer recovery", () => {
    it("recovers from bare !", () => {
      const result = tokenize("a ! b", { tolerant: true });
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toBeInstanceOf(UnexpectedCharacterError);
      expect(result.tokens.length).toBeGreaterThanOrEqual(3);
    });

    it("recovers from unterminated string", () => {
      const result = tokenize('a = "hello', { tolerant: true });
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toBeInstanceOf(UnterminatedStringError);
      const stringToken = result.tokens.find((t) => t.value === "hello");
      expect(stringToken).toBeDefined();
    });

    it("recovers from unterminated string with escape (slow path)", () => {
      const result = tokenize('a = "hel\\"lo', { tolerant: true });
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toBeInstanceOf(UnterminatedStringError);
      const stringToken = result.tokens.find((t) => t.kind === 16);
      expect(stringToken).toBeDefined();
    });

    it("collects multiple lexer errors", () => {
      const result = tokenize("a ! b ! c", { tolerant: true });
      expect(result.errors).toHaveLength(2);
    });

    it("lexer errors are included in parse result", () => {
      const result = tolerant("a ! b");
      expect(result.errors.length).toBeGreaterThanOrEqual(1);
      expect(result.errors[0]).toBeInstanceOf(UnexpectedCharacterError);
    });
  });

  describe("parser recovery - trailing content", () => {
    it("recovers from unexpected token after expression", () => {
      const result = tolerant("a = 1)");
      expect(result.ok).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toBeInstanceOf(UnexpectedTokenError);
      expect(result.cst.expression).not.toBeNull();
    });

    it("wraps trailing tokens in an ErrorNode on the CST", () => {
      const result = tolerant("a = 1) AND b = 2");
      expect(result.ok).toBe(false);
      expect(result.cst.trailing).not.toBeNull();
      expect(result.cst.trailing!.type).toBe("Error");
      expect(result.cst.trailing!.skipped.length).toBeGreaterThan(0);
      expect(hasErrorNodes(result.cst)).toBe(true);
    });

    it("trailing is null for valid input", () => {
      const result = tolerant("a = 1");
      expect(result.cst.trailing).toBeNull();
    });
  });

  describe("parser recovery - expected expression after operator", () => {
    it("recovers from AND AND", () => {
      const result = tolerant("a AND AND b");
      expect(result.ok).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toBeInstanceOf(ExpectedExpressionError);
      expect(result.cst.expression).not.toBeNull();
    });

    it("recovers from OR OR", () => {
      const result = tolerant("a OR OR b");
      expect(result.ok).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toBeInstanceOf(ExpectedExpressionError);
    });

    it("recovers from trailing AND", () => {
      const result = tolerant("a AND");
      expect(result.ok).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toBeInstanceOf(ExpectedExpressionError);
    });

    it("recovers from trailing OR", () => {
      const result = tolerant("a OR");
      expect(result.ok).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toBeInstanceOf(ExpectedExpressionError);
    });
  });

  describe("parser recovery - NOT/- without expression", () => {
    it("recovers from NOT followed by AND", () => {
      const result = tolerant("NOT AND a");
      expect(result.ok).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toBeInstanceOf(ExpectedExpressionError);
    });

    it("recovers from dangling NOT at end", () => {
      const result = tolerant("a NOT");
      expect(result.ok).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("parser recovery - composite expressions", () => {
    it("recovers from empty parentheses ()", () => {
      const result = tolerant("()");
      expect(result.ok).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toBeInstanceOf(EmptyExpressionError);
      expect(result.cst.expression).not.toBeNull();
    });

    it("recovers from unclosed parenthesis", () => {
      const result = tolerant("(a = 1");
      expect(result.ok).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toBeInstanceOf(UnclosedDelimiterError);
      expect(result.cst.expression).not.toBeNull();
    });

    it("recovers from depth limit exceeded", () => {
      const result = tolerant("((a))", { maxDepth: 1 });
      expect(result.ok).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toBeInstanceOf(DepthLimitError);
    });
  });

  describe("parser recovery - function calls", () => {
    it("recovers from string as function name", () => {
      const result = tolerant('"fn"()');
      expect(result.ok).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toBeInstanceOf(InvalidFunctionNameError);
      expect(result.cst.expression).not.toBeNull();
    });

    it("recovers from unclosed function call", () => {
      const result = tolerant("fn(a, b");
      expect(result.ok).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toBeInstanceOf(UnclosedDelimiterError);
    });
  });

  describe("parser recovery - expected value", () => {
    it("recovers from missing value after comparator", () => {
      const result = tolerant("a = AND b = 1");
      expect(result.ok).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toBeInstanceOf(ExpectedValueError);
    });

    it("preserves subsequent restrictions after missing value", () => {
      const result = tolerant("a = AND b = 1 AND c = 2");
      expect(result.ok).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toBeInstanceOf(ExpectedValueError);

      const expr = result.cst.expression;
      expect(expr).not.toBeNull();
      expect(expr!.type).toBe("Expression");
      if (expr!.type === "Expression") {
        expect(expr!.sequences).toHaveLength(3);
      }
    });

    it("recovers from trailing comma in function args", () => {
      const result = tolerant("fn(a,)");
      expect(result.ok).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toBeInstanceOf(ExpectedValueError);
    });

    it("recovers from missing field after dot", () => {
      const result = tolerant("a. = 1");
      expect(result.ok).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toBeInstanceOf(ExpectedValueError);
    });
  });

  describe("parser recovery - negation errors", () => {
    it("recovers from minus before function call", () => {
      const result = tolerant("a = -fn()");
      expect(result.ok).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toBeInstanceOf(InvalidNegationError);
    });

    it("recovers from minus before non-numeric path", () => {
      const result = tolerant("a = -b.c");
      expect(result.ok).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toBeInstanceOf(InvalidNegationError);
    });
  });

  describe("parser recovery - expected identifier", () => {
    it("recovers from keyword at value position", () => {
      const result = tolerant("= 1");
      expect(result.ok).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("parser recovery - input length", () => {
    it("returns error for input exceeding maxLength", () => {
      const result = tolerant("a".repeat(100), { maxLength: 10 });
      expect(result.ok).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toBeInstanceOf(InputLengthError);
      expect(result.cst.expression).toBeNull();
    });
  });

  describe("multiple errors", () => {
    it("collects multiple errors in one pass", () => {
      const result = tolerant("(a AND AND b) OR ()");
      expect(result.ok).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(2);
    });

    it("collects errors from nested constructs", () => {
      const result = tolerant("() AND ()");
      expect(result.ok).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(2);
    });

    it("respects maxErrors limit", () => {
      const result = parse("() () () () ()", { tolerant: true, maxErrors: 10 });
      expect(result.errors.length).toBeGreaterThanOrEqual(5);

      const limited = parse("() () () () ()", { tolerant: true, maxErrors: 2 });
      expect(limited.errors).toHaveLength(2);
      expect(limited.ok).toBe(false);
      expect(limited.cst.type).toBe("Filter");
    });
  });

  describe("hasErrorNodes", () => {
    it("returns false for clean CST", () => {
      const result = tolerant("a = 1 AND b = 2");
      expect(hasErrorNodes(result.cst)).toBe(false);
    });

    it("returns true for CST with errors", () => {
      const result = tolerant("a AND AND b");
      expect(hasErrorNodes(result.cst)).toBe(true);
    });

    it("returns false for empty filter", () => {
      const result = tolerant("");
      expect(hasErrorNodes(result.cst)).toBe(false);
    });
  });

  describe("toCleanTree", () => {
    it("returns null for CST with error nodes", () => {
      const result = tolerant("a AND AND b");
      expect(toCleanTree(result)).toBeNull();
    });

    it("returns strict FilterNode for clean tolerant CST", () => {
      const result = tolerant("a = 1");
      expect(result.ok).toBe(true);
      const clean = toCleanTree(result);
      expect(clean).not.toBeNull();
      const ast = transform(clean!);
      expect(ast).not.toBeNull();
    });

    it("returns null when expression is clean but trailing has errors", () => {
      const result = tolerant("a = 1)");
      expect(result.cst.expression).not.toBeNull();
      expect(result.cst.trailing).not.toBeNull();
      expect(toCleanTree(result)).toBeNull();
    });
  });

  describe("error node structure", () => {
    it("error nodes have correct type and fields", () => {
      const result = tolerant("a AND AND b");
      const errorNode = findErrorNode(result.cst);
      expect(errorNode).not.toBeNull();
      expect(errorNode!.type).toBe("Error");
      expect(errorNode!.error).toBeInstanceOf(ExpectedExpressionError);
      expect(Array.isArray(errorNode!.skipped)).toBe(true);
      expect(errorNode!.span).toBeDefined();
      expect(errorNode!.expectedAt).toBeDefined();
    });
  });

  describe("expectedAt positions", () => {
    it("points to the token after AND when expression is missing", () => {
      const result = tolerant("a AND AND b");
      const errorNode = findErrorNode(result.cst);
      expect(errorNode).not.toBeNull();
      expect(errorNode!.expectedAt.start).toBe(6);
    });

    it("points to the position after comparator for missing value", () => {
      const result = tolerant("a = AND b");
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toBeInstanceOf(ExpectedValueError);
      expect(result.errors[0].span.start).toBeLessThanOrEqual(4);
    });

    it("points inside empty parentheses", () => {
      const result = tolerant("()");
      const errorNode = findErrorNode(result.cst);
      expect(errorNode).not.toBeNull();
      expect(errorNode!.expectedAt.start).toBe(1);
    });

    it("points at EOF for trailing operator", () => {
      const result = tolerant("a AND");
      const errorNode = findErrorNode(result.cst);
      expect(errorNode).not.toBeNull();
      expect(errorNode!.expectedAt.start).toBe(5);
    });
  });

  describe("insertion-based recovery", () => {
    it("synthesizes placeholder for missing arg value", () => {
      const result = tolerant("a = AND b = 1");
      expect(result.ok).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toBeInstanceOf(ExpectedValueError);

      const expr = result.cst.expression;
      expect(expr).not.toBeNull();
      expect(expr!.type).toBe("Expression");
      if (expr!.type === "Expression") {
        expect(expr!.sequences).toHaveLength(2);
      }
    });

    it("preserves restriction before unmatched paren", () => {
      const result = tolerant("a = ) b = 1");
      expect(result.ok).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(1);
      expect(result.errors[0]).toBeInstanceOf(ExpectedValueError);

      const expr = result.cst.expression;
      expect(expr).not.toBeNull();
      expect(expr!.type).toBe("Expression");
    });

    it("synthesizes placeholder for missing arg after comma", () => {
      const result = tolerant("fn(a,)");
      expect(result.ok).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toBeInstanceOf(ExpectedValueError);
    });

    it("handles multiple consecutive missing values", () => {
      const result = tolerant("a = AND b = AND c = AND d = 1");
      expect(result.ok).toBe(false);
      expect(result.errors).toHaveLength(3);
      result.errors.forEach((e) => expect(e).toBeInstanceOf(ExpectedValueError));
      const expr = result.cst.expression;
      expect(expr).not.toBeNull();
      expect(expr!.type).toBe("Expression");
      if (expr!.type === "Expression") {
        expect(expr!.sequences).toHaveLength(4);
      }
    });
  });

  describe("graceful maxErrors", () => {
    it("never throws in tolerant mode regardless of error count", () => {
      const result = parse("AND AND AND AND AND AND AND AND", {
        tolerant: true,
        maxErrors: 3,
      });
      expect(result.errors).toHaveLength(3);
      expect(result.ok).toBe(false);
      expect(result.cst.type).toBe("Filter");
    });
  });

  describe("toCleanTree rejects all error cases", () => {
    it.each([
      ["insertion recovery", "a = AND b = 1"],
      ["ErrorNode in tree", "a AND AND b"],
      ["unclosed paren", "(a = 1"],
      ["empty parens", "()"],
      ["trailing content", "a = 1)"],
      ["unterminated string", 'a = "hello'],
    ])("%s: %s", (_label, input) => {
      const result = tolerant(input);
      expect(result.ok).toBe(false);
      expect(toCleanTree(result)).toBeNull();
    });
  });

  describe("full pipeline: tolerant -> toCleanTree -> transform -> evaluate", () => {
    it("valid tolerant input evaluates correctly", () => {
      const result = tolerant('power >= 5 AND name = "Madoka"');
      expect(result.ok).toBe(true);
      const clean = toCleanTree(result);
      expect(clean).not.toBeNull();
      const ast = transform(clean!);
      expect(evaluate(ast, { power: 9, name: "Madoka" })).toBe(true);
      expect(evaluate(ast, { power: 2, name: "Madoka" })).toBe(false);
    });

    it("dirty tolerant input is blocked by toCleanTree", () => {
      const result = tolerant("a = AND b = 1");
      expect(result.ok).toBe(false);
      expect(toCleanTree(result)).toBeNull();
    });
  });
});

function findErrorNode(node: unknown): ErrorNode | null {
  if (node === null || node === undefined || typeof node !== "object") return null;
  const n = node as Record<string, unknown>;
  if (n["type"] === "Error") return node as ErrorNode;
  for (const value of Object.values(n)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = findErrorNode(item);
        if (found) return found;
      }
    } else if (typeof value === "object" && value !== null) {
      const found = findErrorNode(value);
      if (found) return found;
    }
  }
  return null;
}
