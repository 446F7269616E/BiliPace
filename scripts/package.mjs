import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
/** @type {unknown} */
const packageMetadata = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
if (
  !packageMetadata ||
  typeof packageMetadata !== "object" ||
  !("version" in packageMetadata) ||
  !("name" in packageMetadata)
) {
  throw new Error("Invalid package metadata");
}
const version = String(packageMetadata.version);
const packageName = String(packageMetadata.name);
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  throw new Error(`Invalid package version: ${version}`);
}
if (!/^[a-z0-9][a-z0-9-]*$/.test(packageName)) {
  throw new Error(`Invalid package name: ${packageName}`);
}

const releaseDir = path.join(root, "dist", "packages");
await rm(releaseDir, { recursive: true, force: true });
await mkdir(releaseDir, { recursive: true });
const checksums = [];

for (const target of ["chromium", "firefox", "safari"]) {
  await archiveDirectory(
    path.join(root, "dist", target),
    `${packageName}-${version}-${target}.zip`
  );
  await archiveDirectory(
    path.join(root, "dist", "bundles", "bilibili", target),
    `${packageName}-bilibili-${version}-${target}.zip`
  );
}

await archiveDirectory(
  path.join(root, "dist", "modules", "bilibili"),
  `${packageName}-site-module-bilibili-1.0.0.zip`
);
await writeFile(path.join(releaseDir, "SHA256SUMS"), `${checksums.join("\n")}\n`, "utf8");

/** @param {string} sourceDir @param {string} filename */
async function archiveDirectory(sourceDir, filename) {
  const archive = path.join(releaseDir, filename);
  await rm(archive, { force: true });
  const result = spawnSync("zip", ["-q", "-r", archive, "."], {
    cwd: sourceDir,
    stdio: "inherit"
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
  const digest = createHash("sha256")
    .update(await readFile(archive))
    .digest("hex");
  checksums.push(`${digest}  ${filename}`);
}
