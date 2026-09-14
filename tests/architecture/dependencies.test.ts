import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { expect, it } from "vitest";

it("keeps source dependencies pointing toward the domain", () => {
  const root = resolve("src");
  const allowed: Record<string, string[]> = {
    domain: ["domain"],
    application: ["application", "domain"],
    infrastructure: ["infrastructure", "application", "domain"],
    interfaces: ["interfaces", "bootstrap", "infrastructure", "application", "domain"],
    bootstrap: ["bootstrap", "infrastructure", "application", "domain"],
  };
  const violations: string[] = [];
  function visit(directory: string) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) { visit(path); continue; }
      if (!entry.name.endsWith(".ts")) continue;
      const layer = relative(root, path).split(sep)[0];
      if (!allowed[layer]) continue;
      const source = readFileSync(path, "utf8");
      for (const match of source.matchAll(/(?:from\s+|import\s*\(|require\s*\(|import\s*)["']([^"']+)["']/g)) {
        const dependency = match[1];
        if (!dependency.startsWith(".")) {
          if (["domain", "application"].includes(layer)) violations.push(`${path}: external dependency ${dependency}`);
          continue;
        }
        const target = relative(root, resolve(directory, dependency)).split(sep)[0];
        if (!allowed[layer].includes(target)) violations.push(`${path}: ${layer} -> ${target}`);
      }
      if (["domain", "application"].includes(layer) && /\b(?:process|Buffer)\b/.test(source)) {
        violations.push(`${path}: runtime-specific global in the core`);
      }
    }
  }
  visit(root);
  expect(violations).toEqual([]);
});
