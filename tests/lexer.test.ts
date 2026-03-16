import { describe, expect, it } from "vitest";
import { TokenKind, UnexpectedCharacterError, UnterminatedStringError, tokenize } from "../src";
import { catchError } from "./helpers";

function kinds(input: string): TokenKind[] {
  return tokenize(input).map((t) => t.kind);
}

describe("tokenize", () => {
  describe("empty and trivial inputs", () => {
    it("empty string", () => {
      expect(kinds("")).toEqual([TokenKind.EOF]);
    });

    it("whitespace only", () => {
      expect(kinds("   ")).toEqual([TokenKind.EOF]);
      expect(kinds("\t\n\r ")).toEqual([TokenKind.EOF]);
    });
  });

  describe("individual token kinds", () => {
    it("keywords", () => {
      expect(kinds("AND")).toEqual([TokenKind.And, TokenKind.EOF]);
      expect(kinds("OR")).toEqual([TokenKind.Or, TokenKind.EOF]);
      expect(kinds("NOT")).toEqual([TokenKind.Not, TokenKind.EOF]);
    });

    it("comparators", () => {
      expect(kinds("=")).toEqual([TokenKind.Equals, TokenKind.EOF]);
      expect(kinds("!=")).toEqual([TokenKind.NotEquals, TokenKind.EOF]);
      expect(kinds("<")).toEqual([TokenKind.LessThan, TokenKind.EOF]);
      expect(kinds("<=")).toEqual([TokenKind.LessEquals, TokenKind.EOF]);
      expect(kinds(">")).toEqual([TokenKind.GreaterThan, TokenKind.EOF]);
      expect(kinds(">=")).toEqual([TokenKind.GreaterEquals, TokenKind.EOF]);
      expect(kinds(":")).toEqual([TokenKind.Has, TokenKind.EOF]);
    });

    it("punctuation", () => {
      expect(kinds("(")).toEqual([TokenKind.LParen, TokenKind.EOF]);
      expect(kinds(")")).toEqual([TokenKind.RParen, TokenKind.EOF]);
      expect(kinds(".")).toEqual([TokenKind.Dot, TokenKind.EOF]);
      expect(kinds(",")).toEqual([TokenKind.Comma, TokenKind.EOF]);
      expect(kinds("-")).toEqual([TokenKind.Minus, TokenKind.EOF]);
    });

    it("text", () => {
      const tokens = tokenize("foo");
      expect(tokens[0]).toMatchObject({ kind: TokenKind.Text, value: "foo" });
    });

    it("double-quoted string", () => {
      const tokens = tokenize('"hello"');
      expect(tokens[0]).toMatchObject({ kind: TokenKind.String, value: "hello" });
    });

    it("single-quoted string", () => {
      const tokens = tokenize("'hello'");
      expect(tokens[0]).toMatchObject({ kind: TokenKind.String, value: "hello" });
    });
  });

  describe("keyword case sensitivity", () => {
    it("AND is case-sensitive", () => {
      expect(kinds("AND")).toEqual([TokenKind.And, TokenKind.EOF]);
      expect(kinds("and")).toEqual([TokenKind.Text, TokenKind.EOF]);
      expect(kinds("And")).toEqual([TokenKind.Text, TokenKind.EOF]);
    });

    it("OR is case-sensitive", () => {
      expect(kinds("OR")).toEqual([TokenKind.Or, TokenKind.EOF]);
      expect(kinds("or")).toEqual([TokenKind.Text, TokenKind.EOF]);
      expect(kinds("Or")).toEqual([TokenKind.Text, TokenKind.EOF]);
    });

    it("NOT is case-sensitive", () => {
      expect(kinds("NOT")).toEqual([TokenKind.Not, TokenKind.EOF]);
      expect(kinds("not")).toEqual([TokenKind.Text, TokenKind.EOF]);
      expect(kinds("Not")).toEqual([TokenKind.Text, TokenKind.EOF]);
    });
  });

  describe("keywords in longer words", () => {
    it("ANDroid is text, not AND + roid", () => {
      expect(tokenize("ANDroid")[0]).toMatchObject({ kind: TokenKind.Text, value: "ANDroid" });
    });

    it("ORDER is text, not OR + DER", () => {
      expect(tokenize("ORDER")[0]).toMatchObject({ kind: TokenKind.Text, value: "ORDER" });
    });

    it("NOTICE is text, not NOT + ICE", () => {
      expect(tokenize("NOTICE")[0]).toMatchObject({ kind: TokenKind.Text, value: "NOTICE" });
    });

    it("ANDROID is text", () => {
      expect(tokenize("ANDROID")[0]).toMatchObject({ kind: TokenKind.Text, value: "ANDROID" });
    });
  });

  describe("string variations", () => {
    it("double-quoted with escape", () => {
      const tokens = tokenize('"say \\"hi\\""');
      expect(tokens[0]).toMatchObject({ kind: TokenKind.String, value: 'say "hi"' });
    });

    it("single-quoted with escape", () => {
      const tokens = tokenize("'say \\'hi\\''");
      expect(tokens[0]).toMatchObject({ kind: TokenKind.String, value: "say 'hi'" });
    });

    it("backslash escape", () => {
      const tokens = tokenize('"back\\\\slash"');
      expect(tokens[0]).toMatchObject({ kind: TokenKind.String, value: "back\\slash" });
    });

    it("string with wildcard", () => {
      const tokens = tokenize('"*.foo"');
      expect(tokens[0]).toMatchObject({ kind: TokenKind.String, value: "*.foo" });
    });

    it("empty string", () => {
      const tokens = tokenize('""');
      expect(tokens[0]).toMatchObject({ kind: TokenKind.String, value: "" });
    });

    it("string with spaces", () => {
      const tokens = tokenize('"hello world"');
      expect(tokens[0]).toMatchObject({ kind: TokenKind.String, value: "hello world" });
    });

    it("newline escape", () => {
      const tokens = tokenize('"line1\\nline2"');
      expect(tokens[0]).toMatchObject({ kind: TokenKind.String, value: "line1\nline2" });
    });

    it("tab escape", () => {
      const tokens = tokenize('"col1\\tcol2"');
      expect(tokens[0]).toMatchObject({ kind: TokenKind.String, value: "col1\tcol2" });
    });

    it("carriage return escape", () => {
      const tokens = tokenize('"a\\rb"');
      expect(tokens[0]).toMatchObject({ kind: TokenKind.String, value: "a\rb" });
    });

    it("unknown escape passes through", () => {
      const tokens = tokenize('"\\x"');
      expect(tokens[0]).toMatchObject({ kind: TokenKind.String, value: "x" });
    });
  });

  describe("complete expressions from the spec", () => {
    it('a.b.c = "foo"', () => {
      expect(kinds('a.b.c = "foo"')).toEqual([
        TokenKind.Text,
        TokenKind.Dot,
        TokenKind.Text,
        TokenKind.Dot,
        TokenKind.Text,
        TokenKind.Equals,
        TokenKind.String,
        TokenKind.EOF,
      ]);
    });

    it("NOT (a OR b)", () => {
      expect(kinds("NOT (a OR b)")).toEqual([
        TokenKind.Not,
        TokenKind.LParen,
        TokenKind.Text,
        TokenKind.Or,
        TokenKind.Text,
        TokenKind.RParen,
        TokenKind.EOF,
      ]);
    });

    it('-file:".java"', () => {
      expect(kinds('-file:".java"')).toEqual([
        TokenKind.Minus,
        TokenKind.Text,
        TokenKind.Has,
        TokenKind.String,
        TokenKind.EOF,
      ]);
    });

    it("r:42", () => {
      expect(kinds("r:42")).toEqual([TokenKind.Text, TokenKind.Has, TokenKind.Text, TokenKind.EOF]);
    });

    it("m.foo:*", () => {
      expect(kinds("m.foo:*")).toEqual([
        TokenKind.Text,
        TokenKind.Dot,
        TokenKind.Text,
        TokenKind.Has,
        TokenKind.Text,
        TokenKind.EOF,
      ]);
      expect(tokenize("m.foo:*")[4]).toMatchObject({ kind: TokenKind.Text, value: "*" });
    });

    it("Mitakihara Magical Girls OR Holy Quintet", () => {
      expect(kinds("Mitakihara Magical Girls OR Holy Quintet")).toEqual([
        TokenKind.Text,
        TokenKind.Text,
        TokenKind.Text,
        TokenKind.Or,
        TokenKind.Text,
        TokenKind.Text,
        TokenKind.EOF,
      ]);
    });

    it("a < 10 OR a >= 100", () => {
      expect(kinds("a < 10 OR a >= 100")).toEqual([
        TokenKind.Text,
        TokenKind.LessThan,
        TokenKind.Text,
        TokenKind.Or,
        TokenKind.Text,
        TokenKind.GreaterEquals,
        TokenKind.Text,
        TokenKind.EOF,
      ]);
    });

    it('power >= 5 AND name = "Madoka"', () => {
      const tokens = tokenize('power >= 5 AND name = "Madoka"');
      expect(tokens.map((t) => t.kind)).toEqual([
        TokenKind.Text,
        TokenKind.GreaterEquals,
        TokenKind.Text,
        TokenKind.And,
        TokenKind.Text,
        TokenKind.Equals,
        TokenKind.String,
        TokenKind.EOF,
      ]);
      expect(tokens[0]).toMatchObject({ value: "power" });
      expect(tokens[2]).toMatchObject({ value: "5" });
      expect(tokens[4]).toMatchObject({ value: "name" });
      expect(tokens[6]).toMatchObject({ value: "Madoka" });
    });

    it("experiment.rollout <= cohort(request.user)", () => {
      expect(kinds("experiment.rollout <= cohort(request.user)")).toEqual([
        TokenKind.Text,
        TokenKind.Dot,
        TokenKind.Text,
        TokenKind.LessEquals,
        TokenKind.Text,
        TokenKind.LParen,
        TokenKind.Text,
        TokenKind.Dot,
        TokenKind.Text,
        TokenKind.RParen,
        TokenKind.EOF,
      ]);
    });

    it("regex(m.key, '^.*prod.*$')", () => {
      expect(kinds("regex(m.key, '^.*prod.*$')")).toEqual([
        TokenKind.Text,
        TokenKind.LParen,
        TokenKind.Text,
        TokenKind.Dot,
        TokenKind.Text,
        TokenKind.Comma,
        TokenKind.String,
        TokenKind.RParen,
        TokenKind.EOF,
      ]);
    });
  });

  describe("operator adjacency (no spaces)", () => {
    it("a=b", () => {
      expect(kinds("a=b")).toEqual([
        TokenKind.Text,
        TokenKind.Equals,
        TokenKind.Text,
        TokenKind.EOF,
      ]);
    });

    it("a!=b", () => {
      expect(kinds("a!=b")).toEqual([
        TokenKind.Text,
        TokenKind.NotEquals,
        TokenKind.Text,
        TokenKind.EOF,
      ]);
    });

    it("a<=b", () => {
      expect(kinds("a<=b")).toEqual([
        TokenKind.Text,
        TokenKind.LessEquals,
        TokenKind.Text,
        TokenKind.EOF,
      ]);
    });

    it("a>=b", () => {
      expect(kinds("a>=b")).toEqual([
        TokenKind.Text,
        TokenKind.GreaterEquals,
        TokenKind.Text,
        TokenKind.EOF,
      ]);
    });

    it("a:b", () => {
      expect(kinds("a:b")).toEqual([TokenKind.Text, TokenKind.Has, TokenKind.Text, TokenKind.EOF]);
    });
  });

  describe("token positions", () => {
    it("tracks start and end offsets", () => {
      const tokens = tokenize("a = b");
      expect(tokens[0]).toMatchObject({ start: 0, end: 1 }); // a
      expect(tokens[1]).toMatchObject({ start: 2, end: 3 }); // =
      expect(tokens[2]).toMatchObject({ start: 4, end: 5 }); // b
      expect(tokens[3]).toMatchObject({ start: 5, end: 5 }); // EOF
    });

    it("tracks positions for multi-char operators", () => {
      const tokens = tokenize("a >= b");
      expect(tokens[1]).toMatchObject({ start: 2, end: 4, value: ">=" });
    });

    it("tracks positions for quoted strings", () => {
      const tokens = tokenize('"hello"');
      expect(tokens[0]).toMatchObject({ start: 0, end: 7, value: "hello" });
    });
  });

  describe("error cases", () => {
    it("bare ! throws UnexpectedCharacterError with hint", () => {
      const err = catchError(() => tokenize("a ! b"), UnexpectedCharacterError);
      expect(err.character).toBe("!");
      expect(err.span).toEqual({ start: 2, end: 3 });
      expect(err.source).toBe("a ! b");
      expect(err.hints).toEqual(["Did you mean '!=' (not equals)?"]);
      expect(err.message).toBe("Unexpected character '!'");
    });

    it("unterminated double-quoted string", () => {
      const err = catchError(() => tokenize('"hello'), UnterminatedStringError);
      expect(err.quote).toBe('"');
      expect(err.description).toBe("Unterminated string");
      expect(err.span).toEqual({ start: 0, end: 6 });
      expect(err.hints).toEqual(['Missing closing " quote']);
    });

    it("unterminated single-quoted string", () => {
      const err = catchError(() => tokenize("'hello"), UnterminatedStringError);
      expect(err.quote).toBe("'");
      expect(err.description).toBe("Unterminated string");
      expect(err.span).toEqual({ start: 0, end: 6 });
      expect(err.hints).toEqual(["Missing closing ' quote"]);
    });

    it("unterminated string span covers quote to end", () => {
      const err = catchError(() => tokenize('name = "hello'), UnterminatedStringError);
      expect(err.span).toEqual({ start: 7, end: 13 });
    });
  });

  describe("context-aware keyword tokenization", () => {
    it("NOT( emits Text, not keyword", () => {
      expect(tokenize("NOT()")[0]).toMatchObject({ kind: TokenKind.Text, value: "NOT" });
    });

    it("NOT ( with space emits keyword", () => {
      expect(tokenize("NOT (a)")[0]).toMatchObject({ kind: TokenKind.Not, value: "NOT" });
    });

    it("AND. emits Text (qualified function name)", () => {
      expect(tokenize("AND.foo")[0]).toMatchObject({ kind: TokenKind.Text, value: "AND" });
    });

    it("a AND b emits keyword (whitespace around)", () => {
      expect(tokenize("a AND b")[1]).toMatchObject({ kind: TokenKind.And, value: "AND" });
    });

    it("OR( emits Text", () => {
      expect(tokenize("OR()")[0]).toMatchObject({ kind: TokenKind.Text, value: "OR" });
    });

    it("OR.test( emits Text", () => {
      expect(tokenize("OR.test()")[0]).toMatchObject({ kind: TokenKind.Text, value: "OR" });
    });

    it("NOT. emits Text", () => {
      expect(tokenize("NOT.check")[0]).toMatchObject({ kind: TokenKind.Text, value: "NOT" });
    });

    it("standalone NOT at end of input emits keyword", () => {
      expect(tokenize("NOT")[0]).toMatchObject({ kind: TokenKind.Not, value: "NOT" });
    });

    it("AND. at end of input emits Text", () => {
      const tokens = tokenize("AND.");
      expect(tokens[0]).toMatchObject({ kind: TokenKind.Text, value: "AND" });
      expect(tokens[1]).toMatchObject({ kind: TokenKind.Dot });
    });
  });

  describe("edge cases", () => {
    it("bare ! at start of input", () => {
      const err = catchError(() => tokenize("!a"), UnexpectedCharacterError);
      expect(err.span).toEqual({ start: 0, end: 1 });
    });

    it("backslash at end of unterminated string", () => {
      const err = catchError(() => tokenize('"hello\\'), UnterminatedStringError);
      expect(err.description).toBe("Unterminated string");
    });

    it("empty quoted string", () => {
      const tokens = tokenize('""');
      expect(tokens[0]).toMatchObject({ kind: TokenKind.String, value: "" });
    });

    it("string with only escaped quote", () => {
      const tokens = tokenize('"\\""');
      expect(tokens[0]).toMatchObject({ kind: TokenKind.String, value: '"' });
    });
  });

  describe("single-quoted string escape sequences", () => {
    it("newline escape in single-quoted string", () => {
      expect(tokenize("'line1\\nline2'")[0]).toMatchObject({
        kind: TokenKind.String,
        value: "line1\nline2",
      });
    });

    it("tab escape in single-quoted string", () => {
      expect(tokenize("'col1\\tcol2'")[0]).toMatchObject({
        kind: TokenKind.String,
        value: "col1\tcol2",
      });
    });

    it("carriage return escape in single-quoted string", () => {
      expect(tokenize("'a\\rb'")[0]).toMatchObject({ kind: TokenKind.String, value: "a\rb" });
    });

    it("backslash escape in single-quoted string", () => {
      expect(tokenize("'back\\\\slash'")[0]).toMatchObject({
        kind: TokenKind.String,
        value: "back\\slash",
      });
    });

    it("unknown escape in single-quoted string passes through", () => {
      expect(tokenize("'\\x'")[0]).toMatchObject({ kind: TokenKind.String, value: "x" });
    });
  });

  describe("unterminated strings with escapes", () => {
    it("double-quoted with escapes then unterminated", () => {
      const err = catchError(() => tokenize('"hello\\nworld\\'), UnterminatedStringError);
      expect(err.description).toBe("Unterminated string");
    });

    it("single-quoted with escapes then unterminated", () => {
      const err = catchError(() => tokenize("'hello\\nworld\\"), UnterminatedStringError);
      expect(err.description).toBe("Unterminated string");
    });
  });

  describe("unicode and non-ASCII", () => {
    it("accented characters in text", () => {
      expect(tokenize("café")[0]).toMatchObject({ kind: TokenKind.Text, value: "café" });
    });

    it("CJK characters in quoted string", () => {
      expect(tokenize('"日本語"')[0]).toMatchObject({ kind: TokenKind.String, value: "日本語" });
    });

    it("emoji in quoted string", () => {
      expect(tokenize('"🎉"')[0]).toMatchObject({ kind: TokenKind.String, value: "🎉" });
    });
  });
});
