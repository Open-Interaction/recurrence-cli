import assert from "node:assert/strict";
import test from "node:test";
import { assertAssets, compareVersions, validVersion } from "../scripts/release.mjs";

test("release versions are stable and ordered numerically", () => {
  for (const invalid of ["v1.0.0", "1.0.0-beta", "01.0.0", "1.0", "1.0.0\n", "$(secret)"]) assert.throws(() => validVersion(invalid));
  assert.equal(compareVersions("0.10.0", "0.9.9"), 1);
  assert.equal(compareVersions("1.0.0", "1.0.0"), 0);
  assert.equal(compareVersions("0.3.1", "0.4.0"), -1);
});

test("publication requires exact uploaded assets, digests, sizes, and tag", () => {
  const manifest = { tag: "v0.3.1", assets: [{ name: "package.tgz", sha256: "abc", size: 10 }, { name: "SHA256SUMS", sha256: "def", size: 20 }] };
  const release = { tag_name: manifest.tag, assets: manifest.assets.map((asset) => ({ name: asset.name, digest: `sha256:${asset.sha256}`, size: asset.size, state: "uploaded" })) };
  assert.doesNotThrow(() => assertAssets(release, manifest));
  assert.throws(() => assertAssets({ ...release, tag_name: "v0.3.0" }, manifest));
  assert.throws(() => assertAssets({ ...release, assets: release.assets.slice(0, 1) }, manifest));
  assert.throws(() => assertAssets({ ...release, assets: [{ ...release.assets[0], digest: "sha256:wrong" }, release.assets[1]] }, manifest));
  assert.throws(() => assertAssets({ ...release, assets: [...release.assets, { name: "unexpected.txt" }] }, manifest));
});
