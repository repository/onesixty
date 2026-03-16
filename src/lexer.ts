import type { Token } from "./types";
import { TokenKind } from "./types";
import { UnexpectedCharacterError, UnterminatedStringError } from "./errors";

// Pre-computed: 1 = valid text character, 0 = delimiter/whitespace
const IS_TEXT_CHAR = /* @__PURE__ */ (() => {
  const table = new Uint8Array(128);
  for (let i = 0; i < 128; i++) table[i] = 1;
  for (const ch of " \t\n\r.<>=!:(),\"'-") table[ch.charCodeAt(0)] = 0;
  return table;
})();

const KEYWORDS = new Map<string, TokenKind>([
  ["AND", TokenKind.And],
  ["OR", TokenKind.Or],
  ["NOT", TokenKind.Not],
]);

const CH_SPACE = 0x20;
const CH_TAB = 0x09;
const CH_LF = 0x0a;
const CH_CR = 0x0d;
const CH_LPAREN = 0x28; // (
const CH_RPAREN = 0x29; // )
const CH_COMMA = 0x2c; // ,
const CH_MINUS = 0x2d; // -
const CH_DOT = 0x2e; // .
const CH_COLON = 0x3a; // :
const CH_LT = 0x3c; // <
const CH_EQ = 0x3d; // =
const CH_GT = 0x3e; // >
const CH_BANG = 0x21; // !
const CH_DQUOTE = 0x22; // "
const CH_SQUOTE = 0x27; // '
const CH_BACKSLASH = 0x5c; // \

class Lexer {
  private pos = 0;

  public constructor(private readonly input: string) {}

  public tokenize(): Token[] {
    const tokens: Token[] = [];
    const len = this.input.length;

    while (this.pos < len) {
      while (this.pos < len) {
        const c = this.input.charCodeAt(this.pos);
        if (c !== CH_SPACE && c !== CH_TAB && c !== CH_LF && c !== CH_CR) break;
        this.pos++;
      }
      if (this.pos >= len) break;

      const code = this.input.charCodeAt(this.pos);

      switch (code) {
        case CH_LT: {
          if (this.input.charCodeAt(this.pos + 1) === CH_EQ) {
            tokens.push(this.emit(TokenKind.LessEquals, "<="));
          } else {
            tokens.push(this.emit(TokenKind.LessThan, "<"));
          }
          continue;
        }
        case CH_GT: {
          if (this.input.charCodeAt(this.pos + 1) === CH_EQ) {
            tokens.push(this.emit(TokenKind.GreaterEquals, ">="));
          } else {
            tokens.push(this.emit(TokenKind.GreaterThan, ">"));
          }
          continue;
        }
        case CH_BANG: {
          if (this.input.charCodeAt(this.pos + 1) === CH_EQ) {
            tokens.push(this.emit(TokenKind.NotEquals, "!="));
            continue;
          }
          throw new UnexpectedCharacterError(
            "!",
            { start: this.pos, end: this.pos + 1 },
            this.input,
          );
        }
        case CH_EQ:
          tokens.push(this.emit(TokenKind.Equals, "="));
          continue;
        case CH_LPAREN:
          tokens.push(this.emit(TokenKind.LParen, "("));
          continue;
        case CH_RPAREN:
          tokens.push(this.emit(TokenKind.RParen, ")"));
          continue;
        case CH_DOT:
          tokens.push(this.emit(TokenKind.Dot, "."));
          continue;
        case CH_COMMA:
          tokens.push(this.emit(TokenKind.Comma, ","));
          continue;
        case CH_MINUS:
          tokens.push(this.emit(TokenKind.Minus, "-"));
          continue;
        case CH_COLON:
          tokens.push(this.emit(TokenKind.Has, ":"));
          continue;
        case CH_DQUOTE:
        case CH_SQUOTE:
          tokens.push(this.readString(code));
          continue;
      }

      tokens.push(this.readText());
    }

    tokens.push({ kind: TokenKind.EOF, value: "", start: this.pos, end: this.pos });
    return tokens;
  }

  private emit(kind: TokenKind, value: string): Token {
    const start = this.pos;
    this.pos += value.length;
    return { kind, value, start, end: this.pos };
  }

  private readString(quoteCode: number): Token {
    const quote = quoteCode === CH_DQUOTE ? '"' : "'";
    const start = this.pos;
    this.pos++;
    const len = this.input.length;

    // Fast path: scan for closing quote without escape sequences
    let scanPos = this.pos;
    while (scanPos < len && this.input.charCodeAt(scanPos) !== quoteCode) {
      if (this.input.charCodeAt(scanPos) === CH_BACKSLASH) {
        return this.readStringWithEscapes(quote, start);
      }
      scanPos++;
    }

    if (scanPos >= len) {
      throw new UnterminatedStringError(quote, { start, end: len }, this.input);
    }
    const value = this.input.slice(this.pos, scanPos);
    this.pos = scanPos + 1;
    return { kind: TokenKind.String, value, start, end: this.pos };
  }

  private readStringWithEscapes(quote: string, start: number): Token {
    const quoteCode = quote.charCodeAt(0);
    const len = this.input.length;
    let value = "";
    while (this.pos < len && this.input.charCodeAt(this.pos) !== quoteCode) {
      if (this.input.charCodeAt(this.pos) === CH_BACKSLASH) {
        this.pos++;
        if (this.pos >= len) break;
        const escaped = this.input.charCodeAt(this.pos);
        switch (escaped) {
          case 0x6e: // n
            value += "\n";
            break;
          case 0x74: // t
            value += "\t";
            break;
          case 0x72: // r
            value += "\r";
            break;
          default:
            value += this.input[this.pos];
            break;
        }
        this.pos++;
        continue;
      }
      value += this.input[this.pos];
      this.pos++;
    }
    if (this.pos >= len) {
      throw new UnterminatedStringError(quote, { start, end: len }, this.input);
    }
    this.pos++;
    return { kind: TokenKind.String, value, start, end: this.pos };
  }

  private readText(): Token {
    const start = this.pos;
    const len = this.input.length;
    while (this.pos < len) {
      const code = this.input.charCodeAt(this.pos);
      if (code < 128 && IS_TEXT_CHAR[code] === 0) break;
      this.pos++;
    }
    const value = this.input.slice(start, this.pos);
    // Keywords are only operators when NOT immediately followed by ( or .
    const nextCode = this.input.charCodeAt(this.pos);
    const kind =
      nextCode !== CH_LPAREN && nextCode !== CH_DOT
        ? (KEYWORDS.get(value) ?? TokenKind.Text)
        : TokenKind.Text;
    return { kind, value, start, end: this.pos };
  }
}

/**
 * Tokenize an AIP-160 filter expression into a stream of tokens.
 *
 * @param input - The raw filter expression string.
 * @returns An array of tokens, always terminated by an `EOF` token.
 *
 * @example
 * ```ts
 * tokenize('age >= 21 AND name = "Alice"');
 * // [Text("age"), GreaterEquals(">="), Text("21"), And("AND"),
 * //  Text("name"), Equals("="), String("Alice"), EOF]
 * ```
 */
export function tokenize(input: string): Token[] {
  return new Lexer(input).tokenize();
}
