import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";

import { run } from "../src/cli.mjs";

function capture() {
  let value = "";
  return { stream: { write(chunk) { value += chunk; } }, text: () => value };
}

test("submits a decision with the platform key and a reusable request ID", async () => {
  const stdout = capture(), stderr = capture();
  const payload = { model: "cloudflare/clef-flash", state: "hello", questions: { greeting: { type: "noul", instructions: "Is this a greeting?" } } };
  let observed;
  const code = await run(["decide", "--file", "-", "--idempotency-key", "reusable-123"], {
    env: { RECURRENCE_API_KEY: "test-platform-secret", RECURRENCE_API_ORIGIN: "http://127.0.0.1:4000" },
    stdin: Readable.from([JSON.stringify(payload)]), stdout: stdout.stream, stderr: stderr.stream,
    fetcher: async (url, options) => {
      observed = { url, options };
      return Response.json({ request_id: "dec_test", answers: { greeting: { noul: 0.9 } } });
    },
  });
  assert.equal(code, 0);
  assert.equal(observed.url, "http://127.0.0.1:4000/v1/decisions");
  assert.equal(observed.options.headers.Authorization, "Bearer test-platform-secret");
  assert.equal(observed.options.headers["Idempotency-Key"], "reusable-123");
  assert.equal(observed.options.redirect, "error");
  assert.deepEqual(JSON.parse(observed.options.body), payload);
  assert.equal(JSON.parse(stdout.text()).request_id, "dec_test");
  assert.match(stderr.text(), /Idempotency-Key: reusable-123/);
  assert.doesNotMatch(stdout.text() + stderr.text(), /test-platform-secret/);
});

test("reads public models and scoped account endpoints", async () => {
  const paths = [];
  const fetcher = async (url, options) => {
    paths.push({ url, authorization: options.headers.Authorization });
    return Response.json({ data: [] });
  };
  for (const [args, env] of [
    [["models"], {}],
    [["balance"], { RECURRENCE_API_KEY: "test-secret" }],
    [["activity", "--limit", "3"], { RECURRENCE_API_KEY: "test-secret" }],
    [["status", "dec_123"], { RECURRENCE_API_KEY: "test-secret" }],
  ]) {
    assert.equal(await run(args, { env, fetcher, stdout: capture().stream, stderr: capture().stream }), 0);
  }
  assert.deepEqual(paths.map(({ url }) => new URL(url).pathname + new URL(url).search), [
    "/v1/models", "/v1/billing/preview", "/v1/decisions?limit=3", "/v1/decisions/dec_123",
  ]);
  assert.equal(paths[0].authorization, undefined);
  assert.equal(paths[3].authorization, "Bearer test-secret");
});

test("rejects unsafe origins and missing credentials without sending a request", async () => {
  let calls = 0;
  const fetcher = async () => { calls++; return Response.json({}); };
  for (const [args, env] of [
    [["balance"], {}],
    [["balance"], { RECURRENCE_API_KEY: "test-secret", RECURRENCE_API_ORIGIN: "http://example.com" }],
    [["balance"], { RECURRENCE_API_KEY: "test-secret", RECURRENCE_API_ORIGIN: "https://example.com/redirect" }],
    [["activity", "--limit", "101"], { RECURRENCE_API_KEY: "test-secret" }],
  ]) {
    assert.equal(await run(args, { env, fetcher, stdout: capture().stream, stderr: capture().stream }), 2);
  }
  assert.equal(calls, 0);
});

test("reports API errors without printing the credential", async () => {
  const stdout = capture(), stderr = capture();
  const code = await run(["status", "dec_missing"], {
    env: { RECURRENCE_API_KEY: "test-secret" }, stdout: stdout.stream, stderr: stderr.stream,
    fetcher: async () => Response.json({ error: { code: "DECISION_NOT_FOUND", message: "Decision request was not found." } }, { status: 404 }),
  });
  assert.equal(code, 1);
  assert.equal(stdout.text(), "");
  assert.match(stderr.text(), /DECISION_NOT_FOUND/);
  assert.doesNotMatch(stderr.text(), /test-secret/);
});
