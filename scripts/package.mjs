import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const packageMetadata = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const version = String(packageMetadata.version);
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  throw new Error(`Invalid package version: ${version}`);
}
const releaseDir = path.join(root, "dist", "packages");
await mkdir(releaseDir, { recursive: true });
const checksums = [];

for (const target of ["chromium", "firefox", "safari"]) {
  const archive = path.join(releaseDir, `bilifocus-${version}-${target}.zip`);
  await rm(archive, { force: true });
  const result = spawnSync("zip", ["-q", "-r", archive, "."], {
    cwd: path.join(root, "dist", target),
    stdio: "inherit"
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
  const digest = createHash("sha256")
    .update(await readFile(archive))
    .digest("hex");
  checksums.push(`${digest}  ${path.basename(archive)}`);
}

await writeFile(path.join(releaseDir, "SHA256SUMS"), `${checksums.join("\n")}\n`, "utf8");
