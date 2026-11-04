import { randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";

const KEY_FORMAT = /^oi_sk_[a-f0-9]{24}_[A-Za-z0-9_-]{43}$/;

export function validKey(value) {
  return KEY_FORMAT.test(value);
}

function credentialPath(env) {
  const base = env.XDG_CONFIG_HOME || (env.HOME ? join(env.HOME, ".config") : null);
  if (!base) return null;
  if (!isAbsolute(base)) throw new Error("XDG_CONFIG_HOME and HOME must be absolute paths.");
  return join(base, "recurrence", "credentials");
}

async function privateDirectory(path) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("The Recurrence config directory must not be a symlink.");
  await chmod(path, 0o700);
}

export async function loadKey(env) {
  const path = credentialPath(env);
  if (!path) return null;
  let stat;
  try { stat = await lstat(path); }
  catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077)) {
    throw new Error("Stored API key must be a regular file readable only by your user (chmod 600).");
  }
  const value = (await readFile(path, "utf8")).replace(/\r?\n$/, "");
  if (!validKey(value)) throw new Error("Stored API key has an invalid format. Run recurrence auth login again.");
  return value;
}

export async function saveKey(env, value) {
  const path = credentialPath(env);
  if (!path) throw new Error("Set HOME or XDG_CONFIG_HOME before saving an API key.");
  await privateDirectory(dirname(path));
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${value}\n`, { flag: "wx", mode: 0o600 });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function removeKey(env) {
  const path = credentialPath(env);
  if (!path) return false;
  let stat;
  try { stat = await lstat(path); }
  catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Stored API key path is not a regular file.");
  await rm(path);
  return true;
}

export async function promptKey(stdin, stderr) {
  if (!stdin.isTTY) throw new Error("Run auth login in a terminal. For automation, set RECURRENCE_API_KEY instead.");
  const quietOutput = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
  const prompt = createInterface({ input: stdin, output: quietOutput, terminal: true });
  stderr.write("Paste platform API key: ");
  try { return await prompt.question(""); }
  finally { prompt.close(); stderr.write("\n"); }
}
