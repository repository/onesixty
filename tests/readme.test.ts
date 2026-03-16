import { describe, expect, it } from "vitest";
import {
  CompiledFilter,
  FilterError,
  compile,
  evaluate,
  filter,
  parse,
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

  it("custom evaluation: toSQL", () => {
    function toSQL(node: ASTNode | null): string {
      if (node === null) return "1=1";
      switch (node.type) {
        case "and":
          return node.children.map(toSQL).join(" AND ");
        case "or":
          return `(${node.children.map(toSQL).join(" OR ")})`;
        case "not":
          return `NOT (${toSQL(node.child)})`;
        case "restriction":
          return node.comparable.type === "member"
            ? `${node.comparable.path.join(".")} ${node.comparator} ?`
            : `${node.comparable.qualifiedName}() ${node.comparator} ?`;
        default:
          return "1=1";
      }
    }

    const result = toSQL(transform(parse('status = "contracted" AND grief <= 50')));
    expect(result).toBe("status = ? AND grief <= ?");
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

  it("pipeline API", () => {
    const cst = parse("grief <= 50");
    const ast = transform(cst);
    expect(evaluate(ast, { grief: 30 })).toBe(true);
  });
});
