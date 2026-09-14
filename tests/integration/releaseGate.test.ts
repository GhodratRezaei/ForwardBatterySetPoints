import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execute = promisify(execFile);

async function runGate(result: string, sourceVersion = "expected-commit") {
  const server = createServer((_request, response) => {
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({
      status: "completed", result, sourceBranch: "refs/heads/main", sourceVersion, definition: { id: 42 },
    }));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing test server address");
  try {
    return await execute(process.execPath, [resolve("appendix/deployment/scripts/verify-ci-run.mjs")], {
      env: {
        ...process.env,
        AZDO_TOKEN: "dummy-test-token", AZDO_COLLECTION: `http://127.0.0.1:${address.port}`,
        AZDO_PROJECT: "test-project", CI_RUN_ID: "100", CI_PIPELINE_ID: "42", CI_COMMIT: "expected-commit",
      },
      timeout: 5000,
    });
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
      server.closeAllConnections();
    });
  }
}

describe("release artifact provenance gate against a local CI API fixture", () => {
  it("accepts a successful CI run of the selected commit", async () => {
    expect((await runGate("succeeded")).stdout).toContain("Verified successful CI run 100");
  });

  it("rejects an artifact from a run where another CI job failed", async () => {
    await expect(runGate("failed")).rejects.toThrow();
  });

  it("rejects a CI response for a different commit", async () => {
    await expect(runGate("succeeded", "different-commit")).rejects.toThrow();
  });
});
