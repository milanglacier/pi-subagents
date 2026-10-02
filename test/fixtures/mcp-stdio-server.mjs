// Minimal MCP server over stdio (newline-delimited JSON-RPC) for e2e tests.
// Offers two tools: `fetch` and `search`. Each call returns `<name>-EXECUTED`.
import { createInterface } from "node:readline";

const TOOLS = ["fetch", "search"].map((name) => ({
  name,
  description: `${name} probe`,
  inputSchema: { type: "object", properties: {} },
}));

const send = (message) => process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);

createInterface({ input: process.stdin }).on("line", (line) => {
  if (!line.trim()) return;
  const { id, method, params } = JSON.parse(line);
  if (id === undefined) return; // notifications
  switch (method) {
    case "initialize":
      return send({
        id,
        result: {
          protocolVersion: params.protocolVersion,
          capabilities: { tools: {} },
          serverInfo: { name: "probe", version: "1.0.0" },
        },
      });
    case "tools/list":
      return send({ id, result: { tools: TOOLS } });
    case "tools/call":
      return send({ id, result: { content: [{ type: "text", text: `${params.name}-EXECUTED` }] } });
    case "ping":
      return send({ id, result: {} });
    default:
      return send({ id, error: { code: -32601, message: `Method not found: ${method}` } });
  }
});
