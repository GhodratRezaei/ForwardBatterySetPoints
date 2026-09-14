import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "../../..");
const stage = resolve(root, "artifacts", "function");

// Stage only files required by the Azure Functions runtime.
// Fixed, verified workspace-owned staging directory. Never clean an input path.
if (stage !== resolve(root, "artifacts/function")) throw new Error("Invalid staging path");
if (!existsSync(resolve(root, "dist/index.js"))) throw new Error("Run npm run check before packaging");
rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
for (const name of ["host.json", "package.json", "package-lock.json", "dist"]) {
  cpSync(resolve(root, name), resolve(stage, name), { recursive: true });
}
// Install production dependencies inside the staging directory.
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("Run through npm run package");
const install = spawnSync(process.execPath, [npmCli, "ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"], {
  cwd: stage, stdio: "inherit",
});
if (install.status !== 0) process.exit(install.status ?? 1);
const pkg = JSON.parse(readFileSync(resolve(stage, "package.json"), "utf8"));
if (!existsSync(resolve(stage, pkg.main))) throw new Error("Missing Function entry point");
// Keep release provenance with the artifact for later verification.
writeFileSync(
  resolve(stage, "release.json"),
  JSON.stringify(
    {
      commit: process.env.BUILD_SOURCEVERSION ?? "local",
      node: process.version,
    },
    null,
    2,
  ),
);
console.log("Ready to zip artifacts/function with host.json at archive root.");
