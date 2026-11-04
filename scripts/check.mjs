import { readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
for (const directory of ["bin", "src", "scripts", "test"]) {
  for (const file of await readdir(directory)) {
    if (!file.endsWith(".mjs")) continue;
    const checked = spawnSync(process.execPath, ["--check", `${directory}/${file}`], { stdio: "inherit" });
    if (checked.status !== 0) process.exit(checked.status ?? 1);
  }
}
