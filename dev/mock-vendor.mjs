import { createServer } from "node:http";
import { pathToFileURL } from "node:url";

/** Test-only endpoint. Always binds to loopback, never forwards to a real vendor.
 * @param {{port?: number, statuses?: number[], apiKey?: string}} options
 */
export async function startMockVendor({ port = 0, statuses = [204], apiKey = "local-test-key" } = {}) {
  /** @type {{path: string, body: unknown}[]} */
  const requests = [];
  const server = createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/health") {
      response.writeHead(200).end("ok"); return;
    }
    if (request.method !== "POST" || !/^\/BB\d+\/setpoint$/.test(request.url ?? "")) {
      response.writeHead(404).end(); return;
    }
    if (request.headers["ocp-apim-subscription-key"] !== apiKey) {
      response.writeHead(401).end(); return;
    }
    let raw = "";
    for await (const chunk of request) {
      raw += chunk;
      if (raw.length > 16384) { response.writeHead(413).end(); return; }
    }
    try {
      const body = JSON.parse(raw);
      requests.push({ path: request.url ?? "", body });
      const status = statuses[Math.min(requests.length - 1, statuses.length - 1)] ?? 204;
      if (status === 429) response.setHeader("Retry-After", "0");
      response.writeHead(status).end();
    } catch { response.writeHead(400).end(); }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(undefined));
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No listening address");
  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    close: () => new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve(undefined));
      server.closeAllConnections();
    }),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const vendor = await startMockVendor({ port: 7072 });
  console.log(`Local mock vendor listening on ${vendor.url}`);
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, async () => {
    await vendor.close(); process.exit(0);
  });
}
