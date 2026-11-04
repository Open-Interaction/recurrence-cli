import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { createMcpServer } from "../src/mcp.mjs";
import { saveKey } from "../src/credentials.mjs";

const decision = { model: "cloudflare/clef-flash", state: "hello",
  questions: { greeting: { type: "noul", instructions: "Is this a greeting?" } }, idempotencyKey: "mcp-retry-001" };

async function connected(t, options) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer({ version: "0.3.0", ...options });
  const client = new Client({ name: "recurrence-test", version: "1.0.0" });
  t.after(async () => { await client.close(); await server.close(); });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return client;
}

test("MCP exposes five scoped tools, validates input, and reports errors without leaking credentials", async (t) => {
  const secret = "private-test-credential";
  const calls = [];
  const client = await connected(t, { env: { RECURRENCE_API_KEY: secret }, fetcher: async (url, options) => {
    calls.push({ url, options });
    return Response.json({ error: { code: "CREDIT_EXHAUSTED", message: `no credit ${secret}` } },
      { status: 402, headers: { "x-decision-request-id": "dec_test" } });
  } });
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((tool) => tool.name).sort(), ["create_decision", "get_balance", "get_decision", "list_activity", "list_models"]);
  assert.equal(tools.find((tool) => tool.name === "create_decision").annotations.readOnlyHint, false);
  assert.equal(tools.find((tool) => tool.name === "get_balance").annotations.readOnlyHint, true);
  assert.ok(tools.find((tool) => tool.name === "create_decision").inputSchema.required.includes("idempotencyKey"));
  const invalid = await client.callTool({ name: "list_activity", arguments: { limit: 101 } });
  assert.equal(invalid.isError, true);
  assert.equal((await client.callTool({ name: "create_decision", arguments: { ...decision, questions: {} } })).isError, true);
  const { idempotencyKey: _ignored, ...missingKey } = decision;
  assert.equal((await client.callTool({ name: "create_decision", arguments: missingKey })).isError, true);
  assert.equal(calls.length, 0);
  const failed = await client.callTool({ name: "create_decision", arguments: decision });
  assert.equal(failed.isError, true);
  assert.equal(failed.structuredContent.error.code, "CREDIT_EXHAUSTED");
  assert.equal(failed.structuredContent.error.requestId, "dec_test");
  assert.equal(failed.structuredContent.idempotencyKey, decision.idempotencyKey);
  assert.doesNotMatch(JSON.stringify(failed), /private-test-credential/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.headers["Idempotency-Key"], decision.idempotencyKey);
});

test("MCP keeps public models usable without credentials and returns missing-key tool errors", async (t) => {
  let calls = 0;
  const client = await connected(t, { env: {}, fetcher: async (_url, options) => {
    calls++;
    assert.equal(options.headers.Authorization, undefined);
    return Response.json({ data: [] });
  } });
  assert.deepEqual((await client.callTool({ name: "list_models", arguments: {} })).structuredContent, { data: [] });
  const result = await client.callTool({ name: "get_balance", arguments: {} });
  assert.equal(result.isError, true);
  assert.match(result.structuredContent.error.message, /auth login/);
  assert.equal(calls, 1);
});

test("bundled stdio server interoperates with the SDK client and uses saved credentials", { timeout: 20_000 }, async (t) => {
  const config = await mkdtemp(join(tmpdir(), "recurrence-mcp-"));
  const secret = `oi_sk_${"a".repeat(24)}_${"B".repeat(43)}`;
  await saveKey({ XDG_CONFIG_HOME: config }, secret);
  const calls = [];
  const api = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    calls.push({ url: request.url, headers: request.headers, body });
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify(request.method === "POST" ? { request_id: "dec_same", answers: {}, billing: { charge_nano_usd: 1 } }
      : request.url === "/v1/models" ? { data: [{ id: "mdl_test" }] } : { status: "succeeded" }));
  });
  await new Promise((resolve) => api.listen(0, "127.0.0.1", resolve));
  const transport = new StdioClientTransport({ command: process.execPath,
    args: [process.env.RECURRENCE_TEST_BIN || fileURLToPath(new URL("../bin/recurrence.mjs", import.meta.url)), "mcp"], stderr: "pipe",
    env: { XDG_CONFIG_HOME: config, RECURRENCE_API_KEY: "", RECURRENCE_API_ORIGIN: `http://127.0.0.1:${api.address().port}` } });
  let stderr = "";
  transport.stderr.on("data", (chunk) => { stderr += chunk; });
  const client = new Client({ name: "stdio-test", version: "1.0.0" });
  t.after(async () => { await client.close(); await new Promise((resolve) => api.close(resolve)); await rm(config, { recursive: true, force: true }); });
  await client.connect(transport);
  assert.equal((await client.listTools()).tools.length, 5);
  assert.equal((await client.callTool({ name: "list_models", arguments: {} })).structuredContent.data[0].id, "mdl_test");
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await client.callTool({ name: "create_decision", arguments: decision });
    assert.equal(result.structuredContent.request_id, "dec_same");
    assert.equal(result.structuredContent.idempotencyKey, decision.idempotencyKey);
  }
  await client.callTool({ name: "get_decision", arguments: { requestId: "dec_same" } });
  await client.callTool({ name: "list_activity", arguments: { limit: 3 } });
  await client.callTool({ name: "get_balance", arguments: {} });
  assert.equal(calls.length, 6);
  assert.equal(calls[0].headers.authorization, undefined);
  assert.ok(calls.slice(1).every((call) => call.headers.authorization === `Bearer ${secret}`));
  assert.equal(calls[1].headers["idempotency-key"], calls[2].headers["idempotency-key"]);
  assert.deepEqual(JSON.parse(calls[1].body), { model: decision.model, state: decision.state, questions: decision.questions });
  assert.equal(calls[3].url, "/v1/decisions/dec_same");
  assert.equal(calls[4].url, "/v1/decisions?limit=3");
  assert.equal(calls[5].url, "/v1/billing/preview");
  assert.equal(stderr, "");
});

test("bundled server accepts the 2025 MCP initialize handshake and exits on stdin EOF", { timeout: 10_000 }, async (t) => {
  const entry = process.env.RECURRENCE_TEST_BIN || fileURLToPath(new URL("../bin/recurrence.mjs", import.meta.url));
  const child = spawn(process.execPath, [entry, "mcp"], { stdio: ["pipe", "pipe", "pipe"], env: {} });
  t.after(() => { if (child.exitCode === null) child.kill(); });
  const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {
    protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "legacy-test", version: "1.0.0" } } })}\n`);
  const initialized = JSON.parse((await lines.next()).value);
  assert.equal(initialized.id, 1);
  assert.equal(initialized.result.protocolVersion, "2025-06-18");
  assert.equal(initialized.result.serverInfo.name, "recurrence");
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })}\n`);
  const listed = JSON.parse((await lines.next()).value);
  assert.equal(listed.id, 2);
  assert.equal(listed.result.tools.length, 5);
  const exited = once(child, "exit");
  child.stdin.end();
  assert.deepEqual(await exited, [0, null]);
  assert.equal(stderr, "");
});
