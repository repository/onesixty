import { describe, expect, it } from "vitest";
import {
  CompiledFilter,
  FilterError,
  compile,
  evaluate,
  filter,
  parse,
  toCleanTree,
  transform,
  type ASTNode,
} from "../src";

describe("README examples", () => {
  it("hero: filter('role = \"magical_girl\" AND power >= 3', ...)", () => {
    expect(filter('role = "magical_girl" AND power >= 3', { role: "magical_girl", power: 5 })).toBe(
      true,
    );
  });

  it("one-shot filtering", () => {
    const users = [
      { name: "Mami", rank: 5, role: "magical_girl" },
      { name: "Sayaka", rank: 2, role: "civilian" },
      { name: "Kyoko", rank: 4, role: "magical_girl" },
    ];

    const result = users.filter((u) => filter('role = "magical_girl" AND rank >= 4', u));
    expect(result).toEqual([
      { name: "Mami", rank: 5, role: "magical_girl" },
      { name: "Kyoko", rank: 4, role: "magical_girl" },
    ]);
  });

  it("compile once, evaluate many", () => {
    const f = compile('status = "contracted" AND power >= 3');

    const items = [
      { status: "contracted", power: 5 },
      { status: "contracted", power: 1 },
      { status: "fallen", power: 5 },
    ];

    const matched = items.filter((item) => f.evaluate(item));
    expect(matched).toEqual([{ status: "contracted", power: 5 }]);
  });

  it("serialization round-trip", () => {
    const json = JSON.stringify(compile('status = "contracted"').toSerialized());
    const f = CompiledFilter.fromSerialized(JSON.parse(json));
    expect(f.evaluate({ status: "contracted" })).toBe(true);
  });

  it("custom evaluation: parse + transform + evaluate", () => {
    const ast = transform(parse('status = "contracted" AND grief <= 50'));
    expect(evaluate(ast, { status: "contracted", grief: 30 })).toBe(true);
  });

  it("custom evaluation: toSQL", () => {
    const params: string[] = [];
    function toSQL(node: ASTNode | null): string {
      if (!node) return "1=1";
      if (node.type === "and") return node.children.map(toSQL).join(" AND ");
      if (node.type === "not") return `NOT (${toSQL(node.child)})`;
      if (node.type === "restriction" && node.comparable.type === "member") {
        params.push(node.arg?.type === "value" ? node.arg.value : "");
        return `${node.comparable.path.join(".")} ${node.comparator} $${params.length}`;
      }
      return "1=1";
    }

    const ast = transform(parse('status = "contracted" AND grief <= 50'));
    expect(toSQL(ast)).toBe("status = $1 AND grief <= $2");
    expect(params).toEqual(["contracted", "50"]);
  });

  it("tolerant parsing: collects errors, returns best-effort CST", () => {
    const result = parse("status = AND power >= 3", { tolerant: true });
    expect(result.ok).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.cst.expression).not.toBeNull();
    expect(toCleanTree(result)).toBeNull();
  });

  it("tolerant parsing: clean tree round-trips to AST", () => {
    const result = parse('status = "contracted" AND power >= 3', { tolerant: true });
    expect(result.ok).toBe(true);
    const clean = toCleanTree(result);
    expect(clean).not.toBeNull();
    const ast = transform(clean!);
    expect(evaluate(ast, { status: "contracted", power: 5 })).toBe(true);
  });

  it("error handling: structured FilterError", () => {
    try {
      filter("a AND AND b", {});
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(FilterError);
      if (e instanceof FilterError) {
        expect(e.description).toBe("Expected an expression after 'AND', found keyword 'AND'");
        expect(e.span).toEqual({ start: 6, end: 9 });
        expect(e.hints).toContain("Remove the duplicate 'AND', or add an expression between them");
      }
    }
  });
});
