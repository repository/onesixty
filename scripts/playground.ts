import * as readline from "node:readline";
import { FilterError, TokenKind, tokenize, parse, transform } from "../src";
import type {
  ASTNode,
  FilterNode,
  ExpressionNode,
  SequenceNode,
  FactorNode,
  TermNode,
  RestrictionNode,
  CompositeNode,
  MemberNode,
  FunctionCallNode,
  ValueNode,
  ComparableNode,
  ArgNode,
} from "../src";

function formatToken(kind: TokenKind, value: string): string {
  const name = TokenKind[kind];
  if (kind === TokenKind.Text) return `[${value}]`;
  if (kind === TokenKind.String) return `[${JSON.stringify(value)}]`;
  if (kind === TokenKind.EOF) return "[EOF]";
  return `[${name}]`;
}

const COMP_DISPLAY: Partial<Record<TokenKind, string>> = {
  [TokenKind.Equals]: "=",
  [TokenKind.NotEquals]: "!=",
  [TokenKind.LessThan]: "<",
  [TokenKind.LessEquals]: "<=",
  [TokenKind.GreaterThan]: ">",
  [TokenKind.GreaterEquals]: ">=",
  [TokenKind.Has]: ":",
};

function formatCST(filter: FilterNode): string {
  if (!filter.expression) return "(empty)";
  return fmtExpression(filter.expression);
}

function fmtExpression(node: ExpressionNode): string {
  if (node.sequences.length === 1) return fmtSequence(node.sequences[0]);
  return node.sequences.map(fmtSequence).join(" AND ");
}

function fmtSequence(node: SequenceNode): string {
  if (node.factors.length === 1) return fmtFactor(node.factors[0]);
  return `Seq(${node.factors.map(fmtFactor).join(", ")})`;
}

function fmtFactor(node: FactorNode): string {
  if (node.terms.length === 1) return fmtTerm(node.terms[0]);
  return node.terms.map(fmtTerm).join(" OR ");
}

function fmtTerm(node: TermNode): string {
  const inner = fmtSimple(node.simple);
  if (!node.negated) return inner;
  return `NOT ${inner}`;
}

function fmtSimple(node: RestrictionNode | CompositeNode): string {
  if (node.type === "Composite") return `(${fmtExpression(node.expression)})`;
  return fmtRestriction(node);
}

function fmtRestriction(node: RestrictionNode): string {
  const lhs = fmtComparable(node.comparable);
  if (node.comparator == null) return lhs;
  const op = COMP_DISPLAY[node.comparator] ?? "?";
  const rhs = fmtArg(node.arg!);
  return op === ":" ? `${lhs}:${rhs}` : `${lhs} ${op} ${rhs}`;
}

function fmtComparable(node: ComparableNode): string {
  if (node.type === "FunctionCall") return fmtFunctionCall(node);
  return fmtMember(node);
}

function fmtMember(node: MemberNode): string {
  const parts = [fmtValue(node.value), ...node.fields.map(fmtValue)];
  return parts.join(".");
}

function fmtFunctionCall(node: FunctionCallNode): string {
  const name = node.name.map(fmtValue).join(".");
  const args = node.args.map(fmtArg).join(", ");
  return `${name}(${args})`;
}

function fmtArg(node: ArgNode): string {
  if (node.type === "Composite") return `(${fmtExpression(node.expression)})`;
  return fmtComparable(node);
}

function fmtValue(node: ValueNode): string {
  if (node.token.kind === TokenKind.String) return `"${node.token.value}"`;
  return node.token.value;
}

function formatAST(node: ASTNode | null, indent = 0): string {
  if (node === null) return "null";
  const pad = "  ".repeat(indent);
  switch (node.type) {
    case "and":
      return `${pad}And\n${node.children.map((c) => formatAST(c, indent + 1)).join("\n")}`;
    case "or":
      return `${pad}Or\n${node.children.map((c) => formatAST(c, indent + 1)).join("\n")}`;
    case "not":
      return `${pad}Not\n${formatAST(node.child, indent + 1)}`;
    case "restriction": {
      const lhs = formatAST(node.comparable, 0).trim();
      const rhs = formatAST(node.arg, 0).trim();
      return `${pad}${lhs} ${node.comparator} ${rhs}`;
    }
    case "global":
      return `${pad}Global(${formatAST(node.value, 0).trim()})`;
    case "value":
      return node.quoted ? `${pad}"${node.value}"` : `${pad}${node.value}`;
    case "member":
      return `${pad}${node.path.join(".")}`;
    case "function":
      return `${pad}${node.name.join(".")}(${node.args.map((a) => formatAST(a, 0).trim()).join(", ")})`;
  }
}

function processInput(input: string): void {
  try {
    const tokens = tokenize(input);
    console.log("Tokens:", tokens.map((t) => formatToken(t.kind, t.value)).join(" "));

    const cst = parse(input);
    console.log("CST:   ", formatCST(cst));

    const ast = transform(cst);
    console.log("AST:   ", ast ? formatAST(ast).trim() : "(empty)");
    console.log();
  } catch (e) {
    if (e instanceof FilterError) {
      console.error(`${e.constructor.name}: ${e.description}`);
      if (e.span && e.source) {
        console.error(`       ${e.source}`);
        console.error(`       ${" ".repeat(e.span.start)}${"^".repeat(e.span.end - e.span.start)}`);
      }
      if (e.hints.length > 0) {
        for (const hint of e.hints) console.error(`  Hint: ${hint}`);
      }
      console.error();
    } else {
      throw e;
    }
  }
}

const args = process.argv.slice(2);

if (args.length > 0) {
  processInput(args.join(" "));
} else {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "> ",
  });

  console.log("AIP-160 Playground (Ctrl+C to exit)\n");
  rl.prompt();

  rl.on("line", (line: string) => {
    const trimmed = line.trim();
    if (trimmed.length > 0) {
      processInput(trimmed);
    }
    rl.prompt();
  });

  rl.on("close", () => {
    console.log();
  });
}
