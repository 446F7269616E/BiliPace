import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
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
  await assertStoreCandidate(target, path.join(root, "dist", target));
  await archiveDirectory(
    path.join(root, "dist", target),
    `${packageName}-${version}-${target}.zip`
  );
}

/** @param {string} target @param {string} sourceDir */
async function assertStoreCandidate(target, sourceDir) {
  const entries = new Set(await readdir(sourceDir));
  for (const forbidden of ["modules", "optional-modules"]) {
    if (entries.has(forbidden)) {
      throw new Error(`${target} store candidate contains forbidden directory: ${forbidden}`);
    }
  }
  /** @type {unknown} */
  const rawManifest = JSON.parse(await readFile(path.join(sourceDir, "manifest.json"), "utf8"));
  if (!rawManifest || typeof rawManifest !== "object") {
    throw new Error(`${target} store candidate has an invalid manifest`);
  }
  const manifest = /** @type {Record<string, unknown>} */ (rawManifest);
  if (manifest.version !== version) {
    throw new Error(`${target} manifest version does not match package.json`);
  }
  const permissions = toStringSet(manifest.permissions);
  const optionalPermissions = toStringSet(manifest.optional_permissions);
  if (!permissions.has("declarativeNetRequestWithHostAccess")) {
    throw new Error(`${target} store candidate is missing the safe DNR adapter permission`);
  }
  if (target === "chromium" && !permissions.has("userScripts")) {
    throw new Error("Chromium user-provided code must use the User Scripts API");
  }
  if (target === "firefox" && !optionalPermissions.has("userScripts")) {
    throw new Error("Firefox userScripts must remain optional");
  }
  if (
    target === "safari" &&
    (permissions.has("userScripts") || optionalPermissions.has("userScripts"))
  ) {
    throw new Error("Safari App Store candidates must not request userScripts");
  }
}

/** @param {unknown} value */
function toStringSet(value) {
  return new Set(Array.isArray(value) ? value.filter((item) => typeof item === "string") : []);
}

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
