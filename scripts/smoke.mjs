import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

export async function smoke(entry, { live = false } = {}) {
  const config = await mkdtemp(join(tmpdir(), "recurrence-smoke-"));
  let api, client;
  try {
    let origin = "https://open-interaction.fly.dev";
    if (!live) {
      api = createServer(async (request, response) => {
        for await (const _chunk of request) { /* consume request before responding */ }
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify(request.method === "POST" ? { request_id: "dec_smoke", answers: {} }
          : request.url === "/v1/models" ? { data: [{ id: "mdl_smoke" }] } : { remainingCreditCents: 1 }));
      });
      await new Promise((resolve, reject) => { api.once("error", reject); api.listen(0, "127.0.0.1", resolve); });
      origin = `http://127.0.0.1:${api.address().port}`;
    }
    const transport = new StdioClientTransport({ command: process.execPath, args: [resolve(entry), "mcp"], stderr: "pipe",
      env: { HOME: config, XDG_CONFIG_HOME: config, RECURRENCE_API_KEY: live ? "" : "test-release-credential", RECURRENCE_API_ORIGIN: origin } });
    let stderr = "";
    transport.stderr.on("data", (chunk) => { stderr += chunk; });
    client = new Client({ name: "recurrence-release-check", version: "1.0.0" });
    await client.connect(transport);
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((tool) => tool.name).sort(), ["create_decision", "get_balance", "get_decision", "list_activity", "list_models"]);
    const models = await client.callTool({ name: "list_models", arguments: {} });
    assert.ok(!models.isError, JSON.stringify(models.structuredContent));
    assert.ok(models.structuredContent.data.length > 0);
    if (!live) {
      const balance = await client.callTool({ name: "get_balance", arguments: {} });
      assert.ok(!balance.isError);
      const decided = await client.callTool({ name: "create_decision", arguments: { model: "mdl_smoke", state: "hello",
        questions: { greeting: { type: "noul", instructions: "Is this a greeting?" } }, idempotencyKey: "release-smoke-001" } });
      assert.equal(decided.structuredContent.request_id, "dec_smoke");
    }
    assert.equal(stderr, "");
    console.log(JSON.stringify({ smoke: "passed", live, tools: tools.length, models: models.structuredContent.data.length }));
  } finally {
    if (client) await client.close();
    if (api?.listening) await new Promise((resolve) => api.close(resolve));
    await rm(config, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error("Usage: node scripts/smoke.mjs BIN [--live]");
  await smoke(process.argv[2], { live: process.argv.includes("--live") });
}
