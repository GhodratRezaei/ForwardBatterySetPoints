// Read-only release gate: do not promote an artifact from a partially failed CI run.
// Require all provenance inputs before calling Azure DevOps.
const required = [
  "AZDO_TOKEN",
  "AZDO_COLLECTION",
  "AZDO_PROJECT",
  "CI_RUN_ID",
  "CI_PIPELINE_ID",
  "CI_COMMIT",
];
for (const name of required) if (!process.env[name]) throw new Error(`Missing ${name}`);
const collection = process.env.AZDO_COLLECTION.replace(/\/$/, "");
const url = `${collection}/${encodeURIComponent(process.env.AZDO_PROJECT)}/_apis/build/builds/${encodeURIComponent(process.env.CI_RUN_ID)}?api-version=7.1`;
// The release may continue only for the expected successful build.
const response = await fetch(url, {
  headers: { Authorization: `Bearer ${process.env.AZDO_TOKEN}` },
  signal: AbortSignal.timeout(30_000),
});
if (!response.ok) throw new Error(`Unable to verify CI run: HTTP ${response.status}`);
const build = await response.json();
if (
  build.status !== "completed" ||
  build.result !== "succeeded" ||
  build.sourceBranch !== "refs/heads/main" ||
  build.sourceVersion !== process.env.CI_COMMIT ||
  String(build.definition?.id) !== process.env.CI_PIPELINE_ID
) {
  throw new Error("Selected CI run is not a successful main-branch build of the expected pipeline and commit");
}
console.log(`Verified successful CI run ${process.env.CI_RUN_ID}.`);
