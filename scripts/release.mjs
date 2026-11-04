import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPOSITORY = "Open-Interaction/recurrence-cli";
const directory = resolve("release");
const sha256 = (content) => createHash("sha256").update(content).digest("hex");

export function validVersion(version) {
  if (typeof version !== "string" || version.trim() !== version || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) throw new Error("Release versions must be stable major.minor.patch numbers.");
  return version;
}

export function compareVersions(left, right) {
  const a = validVersion(left).split(".").map(BigInt), b = validVersion(right).split(".").map(BigInt);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
  return 0;
}

export function assertAssets(release, manifest) {
  if (release.tag_name !== manifest.tag) throw new Error("Release tag does not match the prepared package.");
  const assets = release.assets ?? [];
  if (assets.length !== manifest.assets.length) throw new Error("Release must contain exactly the prepared package and checksum file.");
  for (const expected of manifest.assets) {
    const asset = assets.find((item) => item.name === expected.name);
    if (!asset || asset.state !== "uploaded" || asset.size !== expected.size || asset.digest !== `sha256:${expected.sha256}`) {
      throw new Error(`Release asset verification failed: ${expected.name}`);
    }
  }
}

function run(command, args, { input, quiet = false, allow404 = false, env = process.env } = {}) {
  const result = spawnSync(command, args, { input, env, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  if (result.status !== 0) {
    if (allow404 && /HTTP 404/.test(result.stderr ?? "")) return null;
    throw new Error(`${command} failed: ${result.error?.message ?? result.stderr?.trim() ?? "unknown error"}`);
  }
  if (!quiet && result.stdout.trim()) console.log(result.stdout.trim());
  return result.stdout.trim();
}

function api(path, { method = "GET", data, optional = false } = {}) {
  const args = ["api", `repos/${REPOSITORY}/${path}`, "--method", method];
  if (data !== undefined) args.push("--input", "-");
  const output = run("gh", args, { quiet: true, allow404: optional, input: data === undefined ? undefined : JSON.stringify(data) });
  return output === null ? null : JSON.parse(output);
}

async function plan() {
  const { version } = JSON.parse(await readFile("package.json", "utf8"));
  validVersion(version);
  let publish = process.env.EVENT_NAME === "workflow_dispatch" && process.env.REQUEST_PUBLISH === "true";
  if (process.env.EVENT_NAME === "push" && /^[a-f0-9]{40}$/.test(process.env.BEFORE_SHA ?? "") && !/^0+$/.test(process.env.BEFORE_SHA)) {
    const previous = JSON.parse(run("git", ["show", `${process.env.BEFORE_SHA}:package.json`], { quiet: true })).version;
    publish = compareVersions(version, previous) !== 0;
    if (publish && compareVersions(version, previous) < 0) throw new Error("A version bump must increase the version.");
  }
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `publish=${publish}\nversion=${version}\n`);
  console.log(JSON.stringify({ version, publish }));
}

async function prepare() {
  const { smoke } = await import("./smoke.mjs");
  const { version } = JSON.parse(await readFile("package.json", "utf8"));
  validVersion(version);
  run("npm", ["test"]);
  run("npm", ["run", "typecheck"]);
  run("sh", ["-n", "install.sh"]);
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true });
  const packed = JSON.parse(run("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", directory], { quiet: true }))[0];
  const name = `recurrence-cli-${version}.tgz`;
  if (packed.filename !== name || !packed.files.some((file) => file.path === "dist/cli.mjs")
    || !packed.files.some((file) => file.path === "dist/THIRD_PARTY_NOTICES.txt")) throw new Error("Package is missing its bundled runtime or notices.");
  const archive = await readFile(join(directory, name));
  const sums = `${sha256(archive)}  ${name}\n`;
  await writeFile(join(directory, "SHA256SUMS"), sums);
  const changes = await readFile("CHANGELOG.md", "utf8");
  const notes = changes.split(`## ${version}\n`)[1]?.split(/\n## /)[0]?.trim();
  if (!notes) throw new Error(`Add release notes under "## ${version}" in CHANGELOG.md.`);
  await writeFile(join(directory, "notes.md"), notes);
  const manifest = { version, tag: `v${version}`, commit: run("git", ["rev-parse", "HEAD"], { quiet: true }),
    assets: [{ name, size: archive.length, sha256: sha256(archive) }, { name: "SHA256SUMS", size: Buffer.byteLength(sums), sha256: sha256(sums) }] };
  await writeFile(join(directory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  const extracted = await mkdtemp(join(tmpdir(), "recurrence-packed-"));
  try {
    run("tar", ["-xzf", join(directory, name), "-C", extracted]);
    const entry = join(extracted, "package", "bin", "recurrence.mjs");
    if (run(process.execPath, [entry, "--version"], { quiet: true }) !== version) throw new Error("Packed version does not match.");
    await smoke(entry);
  } finally { await rm(extracted, { recursive: true, force: true }); }
  console.log(JSON.stringify({ prepared: manifest.tag, assets: manifest.assets }));
}

function requireHead(commit) {
  if (api("git/ref/heads/main").object.sha !== commit) throw new Error("Public main changed during this run. Start a new release run.");
}

function tagCommit(tag) {
  const ref = api(`git/ref/tags/${tag}`, { optional: true });
  if (!ref) return null;
  let object = ref.object;
  for (let depth = 0; object.type === "tag" && depth < 5; depth++) object = api(`git/tags/${object.sha}`).object;
  if (object.type !== "commit") throw new Error("Release tag must resolve to a commit.");
  return object.sha;
}

async function installerSmoke(manifest, { latest = false } = {}) {
  const { smoke } = await import("./smoke.mjs");
  const prefix = await mkdtemp(join(tmpdir(), "recurrence-install-"));
  try {
    const env = { ...process.env, RECURRENCE_INSTALL_PREFIX: prefix, RECURRENCE_VERSION: latest ? "latest" : manifest.tag };
    // Credentials are used only by gh; keep them out of the installer and MCP subprocesses.
    delete env.GH_TOKEN; delete env.GITHUB_TOKEN;
    run("sh", ["install.sh"], { env });
    const entry = join(prefix, "bin", "recurrence");
    if (run(process.execPath, [entry, "--version"], { quiet: true }) !== manifest.version) throw new Error("Installed version does not match the release.");
    await smoke(entry, { live: true });
  } finally { await rm(prefix, { recursive: true, force: true }); }
}

async function publish() {
  if (process.env.GITHUB_ACTIONS !== "true" || process.env.GITHUB_REPOSITORY !== REPOSITORY || process.env.GITHUB_REF !== "refs/heads/main") {
    throw new Error("Publish from the public repository's main-branch GitHub Actions workflow.");
  }
  const manifest = JSON.parse(await readFile(join(directory, "manifest.json"), "utf8"));
  const { version } = JSON.parse(await readFile("package.json", "utf8"));
  validVersion(version);
  if (manifest.version !== version || manifest.tag !== `v${version}` || manifest.commit !== run("git", ["rev-parse", "HEAD"], { quiet: true })) {
    throw new Error("Prepared release does not match this source checkout.");
  }
  for (const asset of manifest.assets) {
    if (!/^[A-Za-z0-9._-]+$/.test(asset.name) || sha256(await readFile(join(directory, asset.name))) !== asset.sha256) throw new Error("Prepared asset changed.");
  }
  let tagged = tagCommit(manifest.tag);
  if (tagged && tagged !== manifest.commit) throw new Error("Existing tag points to another commit; use a new version.");
  let release = api(`releases/tags/${manifest.tag}`, { optional: true });
  if (release && !release.draft) {
    assertAssets(release, manifest);
    await installerSmoke(manifest);
    console.log(`Verified existing release: ${release.html_url}`);
    return;
  }
  requireHead(manifest.commit);
  const latest = api("releases/latest", { optional: true });
  if (latest && compareVersions(version, latest.tag_name.replace(/^v/, "")) <= 0) throw new Error("New releases must be newer than the current Latest release.");
  if (!tagged) {
    api("git/refs", { method: "POST", data: { ref: `refs/tags/${manifest.tag}`, sha: manifest.commit } });
    tagged = tagCommit(manifest.tag);
    if (tagged !== manifest.commit) throw new Error("Created tag does not match prepared source.");
  }
  if (!release) release = api("releases", { method: "POST", data: { tag_name: manifest.tag, target_commitish: manifest.commit,
    name: `Recurrence CLI ${manifest.tag}`, body: await readFile(join(directory, "notes.md"), "utf8"), draft: true, prerelease: false } });
  for (const expected of manifest.assets) {
    const existing = release.assets.find((asset) => asset.name === expected.name);
    if (existing) {
      if (existing.digest !== `sha256:${expected.sha256}` || existing.size !== expected.size) throw new Error("Existing draft asset differs; use a new version or inspect the draft.");
    } else run("gh", ["release", "upload", manifest.tag, join(directory, expected.name), "--repo", REPOSITORY]);
  }
  for (let attempt = 0; attempt < 5; attempt++) {
    release = api(`releases/${release.id}`);
    try { assertAssets(release, manifest); break; }
    catch (error) { if (attempt === 4) throw error; await new Promise((resolve) => setTimeout(resolve, 2_000)); }
  }
  requireHead(manifest.commit);
  release = api(`releases/${release.id}`, { method: "PATCH", data: { draft: false, make_latest: "true" } });
  assertAssets(release, manifest);
  await installerSmoke(manifest, { latest: true });
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `Published [${manifest.tag}](${release.html_url}); package, checksum, installer, and MCP verified.\n`);
  console.log(`Published and verified: ${release.html_url}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2];
  if (mode === "plan") await plan();
  else if (mode === "prepare") await prepare();
  else if (mode === "publish") await publish();
  else throw new Error("Usage: node scripts/release.mjs plan|prepare|publish");
}
