import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

test("saves a key privately, uses it for requests, and removes it on logout", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "recurrence-cli-auth-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const env = { XDG_CONFIG_HOME: root };
  const secret = `oi_sk_${"a".repeat(24)}_${"B".repeat(43)}`;
  const output = capture(), errors = capture();
  assert.equal(await run(["auth", "login"], { env, stdout: output.stream, stderr: errors.stream,
    promptSecret: async () => secret }), 0);
  assert.deepEqual(JSON.parse(output.text()), { saved: true, source: "file", environmentOverrideActive: false });
  assert.doesNotMatch(output.text() + errors.text(), new RegExp(secret));
  const file = join(root, "recurrence", "credentials");
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  assert.equal((await readFile(file, "utf8")).trim(), secret);

  const statusOutput = capture();
  assert.equal(await run(["auth", "status"], { env, stdout: statusOutput.stream, stderr: capture().stream }), 0);
  assert.deepEqual(JSON.parse(statusOutput.text()), { configured: true, source: "file", prefix: secret.slice(0, 18) });
  let observed;
  assert.equal(await run(["balance"], { env, stdout: capture().stream, stderr: capture().stream,
    fetcher: async (_url, options) => { observed = options.headers.Authorization; return Response.json({ balance: 1 }); } }), 0);
  assert.equal(observed, `Bearer ${secret}`);

  const override = { ...env, RECURRENCE_API_KEY: "another-key" };
  const overrideStatus = capture();
  assert.equal(await run(["auth", "status"], { env: override, stdout: overrideStatus.stream, stderr: capture().stream }), 0);
  assert.equal(JSON.parse(overrideStatus.text()).source, "environment");
  const logoutOutput = capture();
  assert.equal(await run(["auth", "logout"], { env: override, stdout: logoutOutput.stream, stderr: capture().stream }), 0);
  assert.deepEqual(JSON.parse(logoutOutput.text()), { removed: true, environmentOverrideActive: true });
  const loggedOutStatus = capture();
  assert.equal(await run(["auth", "status"], { env, stdout: loggedOutStatus.stream, stderr: capture().stream }), 0);
  assert.deepEqual(JSON.parse(loggedOutStatus.text()), { configured: false, source: null, prefix: null });
});

test("rejects invalid and overly readable stored keys without sending requests", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "recurrence-cli-auth-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const env = { XDG_CONFIG_HOME: root };
  const errors = capture();
  assert.equal(await run(["auth", "login"], { env, stdout: capture().stream, stderr: errors.stream,
    promptSecret: async () => "invalid-key" }), 2);
  assert.match(errors.text(), /Expected a platform API key/);
  const secret = `oi_sk_${"a".repeat(24)}_${"B".repeat(43)}`;
  assert.equal(await run(["auth", "login"], { env, stdout: capture().stream, stderr: capture().stream,
    promptSecret: async () => secret }), 0);
  await chmod(join(root, "recurrence", "credentials"), 0o644);
  let calls = 0;
  const errorOutput = capture();
  assert.equal(await run(["balance"], { env, stdout: capture().stream, stderr: errorOutput.stream,
    fetcher: async () => { calls++; return Response.json({}); } }), 1);
  assert.equal(calls, 0);
  assert.match(errorOutput.text(), /chmod 600/);
  assert.doesNotMatch(errorOutput.text(), new RegExp(secret));
});

test("prints package version without credentials or a network request", async () => {
  const stdout = capture();
  assert.equal(await run(["--version"], { env: {}, stdout: stdout.stream, stderr: capture().stream,
    fetcher: async () => { throw new Error("unexpected fetch"); } }), 0);
  assert.equal(stdout.text(), "0.3.0\n");
});

test("reports unknown commands and oversized input before making a request", async () => {
  let calls = 0;
  const fetcher = async () => { calls++; return Response.json({}); };
  const unknown = capture();
  assert.equal(await run(["typo"], { env: {}, fetcher, stdout: capture().stream, stderr: unknown.stream }), 2);
  assert.match(unknown.text(), /Unknown command: typo/);
  const oversized = capture();
  assert.equal(await run(["decide", "--file", "-"], { env: { RECURRENCE_API_KEY: "test-key" }, fetcher,
    stdin: Readable.from([JSON.stringify({ state: "x".repeat(131_072) })]), stdout: capture().stream,
    stderr: oversized.stream }), 2);
  assert.match(oversized.text(), /128 KiB/);
  assert.equal(calls, 0);
});
