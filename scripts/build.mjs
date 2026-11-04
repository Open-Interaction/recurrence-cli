import { build } from "esbuild";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { builtinModules } from "node:module";

const built = await build({
  entryPoints: ["src/cli.mjs"], outfile: "dist/cli.mjs", bundle: true,
  platform: "node", format: "esm", target: "node22", metafile: true, legalComments: "eof",
  banner: { js: 'import { createRequire as bundleCreateRequire } from "node:module"; const require = bundleCreateRequire(import.meta.url);' },
});
for (const output of Object.values(built.metafile.outputs)) {
  for (const imported of output.imports) {
    if (imported.external && !builtinModules.includes(imported.path.replace(/^node:/, ""))) {
      throw new Error(`The release bundle has an external dependency: ${imported.path}`);
    }
  }
}

const packages = new Map();
for (const input of Object.keys(built.metafile.inputs)) {
  if (!input.includes("node_modules")) continue;
  let directory = dirname(resolve(input));
  while (dirname(directory) !== directory) {
    try {
      const metadata = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
      if (metadata.name && !packages.has(metadata.name)) {
        const licenses = (await readdir(directory)).filter((file) => /^(licen[cs]e|notice)(\.|$)/i.test(file));
        packages.set(metadata.name, `${metadata.name}@${metadata.version} (${metadata.license ?? "see source"})\n`
          + (await Promise.all(licenses.map((file) => readFile(join(directory, file), "utf8")))).join("\n"));
      }
      break;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      directory = dirname(directory);
    }
  }
}
await writeFile("dist/THIRD_PARTY_NOTICES.txt", [...packages.values()].join("\n\n--------------------\n\n"));
