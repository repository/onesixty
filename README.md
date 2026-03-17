# onesixty

Filter objects with expressive, user-facing query strings.

```ts
import { filter } from "onesixty";

filter('role = "magical_girl" AND power >= 3', { role: "magical_girl", power: 5 }); // true
```

onesixty is a zero-dependency TypeScript implementation of [AIP-160](https://google.aip.dev/160), the filtering language used across Google APIs. Parse filter expressions into a type-safe AST, evaluate them against plain objects, or compile them into your own backend (SQL, Elasticsearch, etc.).

- **Zero dependencies,** 12kB gzipped. Just TypeScript, nothing else
- **Fast.** 1M+ filter evaluations per second, 10-15x faster than alternatives
- **Full AIP-160 grammar:** comparisons, `AND`/`OR`/`NOT`, field traversal, `:` (has), functions, wildcards, parentheses
- **Compile once, run many:** parse a filter once, evaluate it against thousands of objects
- **Async functions:** custom functions can return promises
- **Serializable:** compiled filters survive `JSON.stringify` for storage and transfer
- **Structured errors:** every error is a typed class with machine-readable data, not just a message string
- **Bring your own backend:** use the AST directly to generate SQL, Elasticsearch queries, or anything else

## Install

```bash
npm install onesixty
pnpm add onesixty
yarn add onesixty
bun add onesixty
```

Try it interactively: `pnpm playground`

## Usage

### One-shot filtering

```ts
import { filter } from "onesixty";

const girls = [
  { name: "Mami", rank: 5, role: "magical_girl" },
  { name: "Sayaka", rank: 2, role: "civilian" },
  { name: "Kyoko", rank: 4, role: "magical_girl" },
];

girls.filter((g) => filter('role = "magical_girl" AND rank >= 4', g));
// [Mami, Kyoko]
```

### Compile once, evaluate many

```ts
import { compile } from "onesixty";

const f = compile('status = "contracted" AND power >= 3');

for (const item of items) {
  if (f.evaluate(item)) {
    // matched
  }
}
```

### Custom functions

```ts
filter("distance(lat, lng) < 100", coords, {
  functions: {
    distance: (lat, lng) => haversine(lat, lng, userLat, userLng),
  },
});
```

Async functions work too. Use `filterAsync` or `compile().evaluateAsync()`:

```ts
// Check if the current request is authorized for a resource
const f = compile("authorized(resource)");

await f.evaluateAsync(request, {
  authorized: async (resource) => {
    const perms = await db.getPermissions(request.user);
    return perms.includes(resource);
  },
});
```

### Serialization

Compiled filters can be persisted (e.g. to a database) and restored without re-parsing:

```ts
import { compile, CompiledFilter } from "onesixty";

// Save
const json = JSON.stringify(compile('status = "contracted"').toSerialized());

// Restore
const f = CompiledFilter.fromSerialized(JSON.parse(json));
f.evaluate({ status: "contracted" }); // true
```

### Pipeline API

For advanced use cases, the full parse-transform-evaluate pipeline is exposed as separate functions:

```ts
import { parse, transform, evaluate, type ASTNode } from "onesixty";

// Parse and transform in two steps: string -> CST -> AST
const ast = transform(parse('status = "contracted" AND grief <= 50'));

// Evaluate directly against an object
evaluate(ast, { status: "contracted", grief: 30 }); // true
```

You can also skip the built-in evaluator entirely and handle evaluation through your own means with the AST.

<details>
<summary>Example: AST to SQL</summary>

```ts
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

toSQL(ast); // "status = ? AND grief <= ?"
```

</details>

### Error handling

All errors are typed classes with structured data. Catch them broadly or narrowly:

```ts
import { filter, FilterError } from "onesixty";

try {
  filter("a AND AND b", {});
} catch (e) {
  if (e instanceof FilterError) {
    e.description; // "Expected an expression after 'AND', found keyword 'AND'"
    e.span; // { start: 6, end: 9 }
    e.hints; // ["Remove the duplicate 'AND', ..."]
  }
}
```

Every error subclass exposes the relevant tokens, positions, and context as typed readonly fields. See the JSDoc on each error class for details.

---

## Benchmarks

Measured on a MacBook M4 Pro with Node.js 24, using `vitest bench`. All numbers are operations per second (higher is better). The comparison target is [`@tcn/aip-160`](https://www.npmjs.com/package/@tcn/aip-160), the other AIP-160 implementation on npm.

### End-to-end: parse + evaluate

| Expression                              |  onesixty | @tcn/aip-160 | Ratio |
| --------------------------------------- | --------: | -----------: | ----: |
| `a = 1`                                 | 2,285,479 |      149,225 |   15x |
| 4 restrictions with AND, has, traversal |   572,782 |       43,775 |   13x |
| OR + nested path + NOT + wildcard       |   352,348 |       35,659 |   10x |
| Global text search on nested object     | 1,650,356 |      335,975 |    5x |

### Compile once, evaluate many (x100 loop)

| Approach                   | onesixty | @tcn/aip-160 | Ratio |
| -------------------------- | -------: | -----------: | ----: |
| `compile()` + `evaluate()` |  144,462 |          n/a |   n/a |
| `filter()` (re-parse each) |   10,464 |          670 |   16x |

### Stress tests

| Scenario                               |  onesixty | @tcn/aip-160 | Ratio |
| -------------------------------------- | --------: | -----------: | ----: |
| 50 chained AND restrictions            |    42,447 |        2,461 |   17x |
| 32 levels of parentheses               |   131,251 |       10,538 |   12x |
| Last key in 1,000-key object           | 1,962,401 |      113,214 |   17x |
| Global search miss on 1,000-key object |    93,253 |      118,047 |  0.8x |
| Array fanout: 1,000 elements           |    20,984 |          n/a |   n/a |

### Pipeline stages (onesixty internals)

| Stage                       |    ops/sec |
| --------------------------- | ---------: |
| tokenize                    |  4,794,457 |
| parse                       |  1,212,612 |
| parse + transform           |  1,172,134 |
| evaluate (pre-compiled AST) | 12,154,248 |
| filter (end-to-end)         |  1,034,112 |

Run the benchmarks yourself with `pnpm bench`.

---

## Reference

### Filter syntax

onesixty implements the full [AIP-160](https://google.aip.dev/160) grammar. See the spec for the complete language reference.

<details>
<summary>Syntax cheat sheet</summary>

| Feature          | Example                             | Notes                                            |
| ---------------- | ----------------------------------- | ------------------------------------------------ |
| Comparisons      | `power >= 3`, `name = "Madoka"`     | `=`, `!=`, `<`, `<=`, `>`, `>=`                  |
| Has (membership) | `abilities:magic`                   | Array contains value, map has key                |
| Presence         | `field:*`                           | Field is present and non-empty                   |
| AND              | `a = 1 AND b = 2`                   | Both must match                                  |
| OR               | `a = 1 OR a = 2`                    | Either must match                                |
| NOT              | `NOT status = "witched"`            | Negation (`-` shorthand: `-file:".java"`)        |
| Implicit AND     | `Homura Madoka`                     | Whitespace-separated = AND-joined                |
| Traversal        | `user.soul_gem.city = "Mitakihara"` | Dot-separated field paths                        |
| Functions        | `cohort(request.user)`              | Custom functions, qualified names (`math.abs()`) |
| Parentheses      | `(a OR b) AND c`                    | Grouping and precedence override                 |
| Wildcards        | `name = "Mami-*"`                   | Only in quoted strings with `=`                  |

**Precedence:** OR binds tighter than AND. `a AND b OR c` means `a AND (b OR c)`.

</details>

### AST node types

The AST is a discriminated union on the `type` field. Every node is a plain, JSON-serializable object.

<details>
<summary>Node type reference</summary>

| Type                 | `type`          | Key fields                                                   | Description                                    |
| -------------------- | --------------- | ------------------------------------------------------------ | ---------------------------------------------- |
| `AndNode`            | `"and"`         | `children: ASTNode[]`                                        | Logical AND (2+ children, flattened)           |
| `OrNode`             | `"or"`          | `children: ASTNode[]`                                        | Logical OR (2+ children, flattened)            |
| `NotNode`            | `"not"`         | `child: ASTNode`                                             | Logical negation                               |
| `ASTRestrictionNode` | `"restriction"` | `comparable`, `comparator`, `arg`                            | A comparison (`power >= 3`, `abilities:magic`) |
| `GlobalNode`         | `"global"`      | `value`                                                      | A bare value for text search (`Madoka`)        |
| `ASTValueNode`       | `"value"`       | `value: string`, `quoted: boolean`                           | A literal string or text value                 |
| `ASTMemberNode`      | `"member"`      | `path: string[]`                                             | A dotted field path                            |
| `ASTFunctionNode`    | `"function"`    | `name: string[]`, `qualifiedName: string`, `args: ASTNode[]` | A function call                                |

The `comparable` field on restrictions is always `ASTMemberNode | ASTFunctionNode`. The `comparator` is one of `"=" | "!=" | "<" | "<=" | ">" | ">=" | ":"`. Every node carries a `span: { start, end }` pointing back to the original source string.

</details>

### Options

<details>
<summary>Parse options</summary>

| Option      | Type     | Default | Description                       |
| ----------- | -------- | ------- | --------------------------------- |
| `maxDepth`  | `number` | `64`    | Maximum parenthesis nesting depth |
| `maxLength` | `number` | `8192`  | Maximum input string length       |

</details>

<details>
<summary>Evaluate options</summary>

| Option               | Type                       | Default   | Description                                            |
| -------------------- | -------------------------- | --------- | ------------------------------------------------------ |
| `functions`          | `Record<string, Function>` |           | Custom function implementations                        |
| `unknownFunction`    | `"throw" \| "false"`       | `"throw"` | How to handle unregistered functions                   |
| `globalSearchFields` | `string[]`                 |           | Limit bare-value search to these fields                |
| `resolveRhsMembers`  | `boolean`                  | `false`   | Resolve dotted RHS paths against the target            |
| `wildcardNotEquals`  | `boolean`                  | `false`   | Enable wildcards for `!=`                              |
| `maxTraversalDepth`  | `number`                   | `32`      | Max recursion depth for global search and array fanout |

See the JSDoc on `EvaluateOptions` for full details on each option.

</details>

## License

[Apache-2.0](./LICENSE)

Portions of this project are modifications based on work created and shared by [Google](https://google.aip.dev/licensing) and used according to terms described in the [Creative Commons 4.0 Attribution License](https://creativecommons.org/licenses/by/4.0/).
