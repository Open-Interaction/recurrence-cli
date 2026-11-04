import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { loadKey, promptKey, removeKey, saveKey, validKey } from "./credentials.mjs";

import { createApiClient, DEFAULT_ORIGIN, UsageError, validateIdempotencyKey } from "./api.mjs";
const USAGE = `Usage: recurrence <command> [options]

Commands:
  auth login                     Save a platform API key with a hidden prompt
  auth status                    Show the active credential source
  auth logout                    Remove the locally saved key
  mcp                            Start the MCP server over stdio
  models                         List available decision models
  decide --file PATH             Submit a JSON decision request (PATH can be - for stdin)
         [--idempotency-key ID]  Reuse the same ID when retrying a request
  status REQUEST_ID              Get one decision request status
  activity [--limit N]           List recent requests (1–100, default 20)
  balance                        Show account credit and usage
  --version                      Show CLI version

Environment:
  RECURRENCE_API_KEY             Platform API key (overrides the locally saved key)
  RECURRENCE_API_ORIGIN          API origin (default: ${DEFAULT_ORIGIN})
`;

function options(args, allowed) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 2) {
    const option = args[index];
    if (!allowed.includes(option) || parsed[option] !== undefined || args[index + 1] === undefined || args[index + 1].startsWith("--")) {
      throw new UsageError(`Invalid or missing option: ${option ?? "(none)"}`);
    }
    parsed[option] = args[index + 1];
  }
  return parsed;
}

async function readDecision(file, stdin) {
  let source;
  try {
    if (file === "-") {
      source = "";
      for await (const chunk of stdin) source += chunk;
    } else source = await readFile(file, "utf8");
  } catch (error) {
    throw new UsageError(`Cannot read decision file: ${error.message}`);
  }
  if (Buffer.byteLength(source, "utf8") > 128 * 1024) throw new UsageError("Decision JSON must be at most 128 KiB.");
  try {
    const value = JSON.parse(source);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected a JSON object");
    return value;
  } catch (error) {
    throw new UsageError(`Invalid decision JSON: ${error.message}`);
  }
}

export async function run(argv, { env = process.env, fetcher = globalThis.fetch, stdout = process.stdout,
  stderr = process.stderr, stdin = process.stdin, promptSecret = promptKey } = {}) {
  try {
    const [command, ...args] = argv;
    if (command === "help" || command === "--help" || command === "-h") {
      if (args.length) throw new UsageError("Help takes no arguments.");
      stdout.write(USAGE);
      return 0;
    }
    if (!command) throw new UsageError("Choose a command.");
    if (command === "--version" || command === "version") {
      if (args.length) throw new UsageError("Version takes no arguments.");
      const metadata = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
      stdout.write(`${metadata.version}\n`);
      return 0;
    }
    const environmentKey = env.RECURRENCE_API_KEY?.trim();
    if (command === "auth") {
      if (args.length !== 1 || !["login", "status", "logout"].includes(args[0])) {
        throw new UsageError("Use auth login, auth status, or auth logout.");
      }
      let result;
      if (args[0] === "login") {
        const enteredKey = (await promptSecret(stdin, stderr)).trim();
        if (!validKey(enteredKey)) throw new UsageError("Expected a platform API key beginning with oi_sk_.");
        await saveKey(env, enteredKey);
        result = { saved: true, source: "file", environmentOverrideActive: Boolean(environmentKey) };
      } else if (args[0] === "logout") {
        result = { removed: await removeKey(env), environmentOverrideActive: Boolean(environmentKey) };
      } else {
        const activeKey = environmentKey || await loadKey(env);
        result = { configured: Boolean(activeKey), source: activeKey ? environmentKey ? "environment" : "file" : null,
          prefix: activeKey?.slice(0, 18) ?? null };
      }
      stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return 0;
    }
    if (command === "mcp") {
      if (args.length) throw new UsageError("mcp takes no arguments.");
      const metadata = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
      const { startMcp } = await import("./mcp.mjs");
      startMcp({ env, fetcher, version: metadata.version, stderr });
      return 0;
    }
    if (!["models", "decide", "status", "activity", "balance"].includes(command)) {
      throw new UsageError(`Unknown command: ${command}`);
    }
    const api = createApiClient({ env, fetcher });
    let result;
    if (command === "models") {
      if (args.length) throw new UsageError("models takes no arguments.");
      result = await api.models();
    } else if (command === "balance") {
      if (args.length) throw new UsageError("balance takes no arguments.");
      result = await api.balance();
    } else if (command === "activity") {
      const parsed = options(args, ["--limit"]);
      const limit = parsed["--limit"] ?? "20";
      if (!/^(?:[1-9]|[1-9][0-9]|100)$/.test(limit)) throw new UsageError("--limit must be an integer from 1 to 100.");
      result = await api.activity(Number(limit));
    } else if (command === "status") {
      if (args.length !== 1 || !args[0] || args[0].startsWith("--")) throw new UsageError("status requires one request ID.");
      result = await api.status(args[0]);
    } else if (command === "decide") {
      const parsed = options(args, ["--file", "--idempotency-key"]);
      if (!parsed["--file"]) throw new UsageError("decide requires --file PATH.");
      const idempotencyKey = parsed["--idempotency-key"] ?? randomUUID();
      validateIdempotencyKey(idempotencyKey);
      const payload = await readDecision(parsed["--file"], stdin);
      stderr.write(`Idempotency-Key: ${idempotencyKey}\n`);
      result = await api.decide(payload, idempotencyKey);
    } else throw new UsageError(`Unknown command: ${command}`);
    stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return 0;
  } catch (error) {
    if (error instanceof UsageError) {
      stderr.write(`${error.message}\n\n${USAGE}`);
      return 2;
    }
    stderr.write(`${error.message}\n`);
    return 1;
  }
}
