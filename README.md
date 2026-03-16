# onesixty

Filter objects with expressive, user-facing query strings.

```ts
import { filter } from "onesixty";

filter('role = "magical_girl" AND power >= 3', { role: "magical_girl", power: 5 }); // true
```

onesixty is a zero-dependency TypeScript implementation of [AIP-160](https://google.aip.dev/160), the filtering language used across Google APIs. Parse filter expressions into a type-safe AST, evaluate them against plain objects, or compile them into your own backend (SQL, Elasticsearch, etc.).

- **Zero dependencies,** just TypeScript, nothing else
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

### Custom evaluation (SQL, Elasticsearch, etc.)

You don't need to use the built-in evaluator. Parse the filter into an AST and walk it yourself:

```ts
import { parse, transform, type ASTNode } from "onesixty";

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

toSQL(transform(parse('status = "contracted" AND grief <= 50')));
// "status = ? AND grief <= ?"
```

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
| Wildcards        | `name = "prod-*"`                   | Only in quoted strings with `=`                  |

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

### Pipeline API

For advanced use cases, the full parse-transform-evaluate pipeline is exposed as separate functions. See the JSDoc on `parse`, `transform`, and `evaluate` for details.

```ts
import { parse, transform, evaluate } from "onesixty";

const cst = parse("grief <= 50"); // string -> CST
const ast = transform(cst); // CST -> AST
evaluate(ast, { grief: 30 }); // AST + object -> boolean
```

## License

[Apache-2.0](./LICENSE)

Portions of this project are modifications based on work created and shared by [Google](https://google.aip.dev/licensing) and used according to terms described in the [Creative Commons 4.0 Attribution License](https://creativecommons.org/licenses/by/4.0/).
