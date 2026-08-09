import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import process from "node:process";
import { build } from "esbuild";

const root = process.cwd();
/** @typedef {"chromium" | "firefox" | "safari"} BrowserTarget */
/** @type {BrowserTarget[]} */
const supportedTargets = ["chromium", "firefox", "safari"];
const requestedTarget = process.argv[2] ?? "all";
if (
  requestedTarget !== "all" &&
  !supportedTargets.includes(/** @type {BrowserTarget} */ (requestedTarget))
) {
  throw new Error(`Unsupported target: ${requestedTarget}`);
}
/** @type {BrowserTarget[]} */
const targets =
  requestedTarget === "all" ? supportedTargets : [/** @type {BrowserTarget} */ (requestedTarget)];

const sharedEntries = {
  background: path.join(root, "src/background/index.ts"),
  popup: path.join(root, "src/popup/index.ts"),
  home: path.join(root, "src/home/index.ts"),
  options: path.join(root, "src/options/index.ts"),
  dashboard: path.join(root, "src/dashboard/index.ts"),
  plan: path.join(root, "src/plan/index.ts")
};

for (const target of targets) {
  await buildExtension({
    target,
    outdir: path.join(root, "dist", target),
    contentEntry: path.join(root, "src/content/index.ts"),
    bilibiliBundled: false
  });
  await buildExtension({
    target,
    outdir: path.join(root, "dist", "bundles", "bilibili", target),
    contentEntry: path.join(root, "src/modules/bilibili/content-entry.ts"),
    bilibiliBundled: true
  });
}

if (requestedTarget === "all" || requestedTarget === "chromium") {
  await buildBilibiliDeveloperPackage();
}

/**
 * @param {{ target: BrowserTarget; outdir: string; contentEntry: string; bilibiliBundled: boolean }} options
 */
async function buildExtension({ target, outdir, contentEntry, bilibiliBundled }) {
  await rm(outdir, { recursive: true, force: true });
  await mkdir(outdir, { recursive: true });
  await build({
    entryPoints: { ...sharedEntries, content: contentEntry },
    outdir,
    bundle: true,
    format: "iife",
    target: browserTarget(target),
    entryNames: "[name]",
    sourcemap: false,
    minify: false,
    legalComments: "none",
    logLevel: "info",
    define: {
      __HOURLEAF_BILIBILI_BUNDLED__: String(bilibiliBundled)
    }
  });

  await cp(path.join(root, "static"), outdir, { recursive: true });
  const stylesOutdir = path.join(outdir, "styles");
  await mkdir(stylesOutdir, { recursive: true });
  for (const file of await readdir(path.join(root, "src/styles"))) {
    if (file.endsWith(".css")) {
      await cp(path.join(root, "src/styles", file), path.join(stylesOutdir, file));
    }
  }
  await cp(path.join(root, "public/icons"), path.join(outdir, "icons"), { recursive: true });
  const manifest = await readFile(path.join(root, "manifests", `${target}.json`), "utf8");
  await writeFile(path.join(outdir, "manifest.json"), `${manifest.trim()}\n`, "utf8");
}

async function buildBilibiliDeveloperPackage() {
  const outdir = path.join(root, "dist", "modules", "bilibili");
  await rm(outdir, { recursive: true, force: true });
  await mkdir(outdir, { recursive: true });

  const descriptorModule = path.join(outdir, ".descriptor.mjs");
  await build({
    entryPoints: [path.join(root, "src/modules/bilibili/descriptor.ts")],
    outfile: descriptorModule,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node22",
    sourcemap: false,
    minify: false,
    legalComments: "none",
    logLevel: "silent"
  });
  /** @type {unknown} */
  const descriptorExports = await import(`${pathToFileURL(descriptorModule).href}?v=${Date.now()}`);
  if (!isRecord(descriptorExports)) {
    throw new Error("Bilibili site module descriptor did not export release metadata");
  }
  const descriptor = descriptorExports.BILIBILI_SITE_MODULE_DESCRIPTOR;
  const hashInput = descriptorExports.BILIBILI_SITE_MODULE_HASH_INPUT;
  if (!isRecord(descriptor) || typeof hashInput !== "string") {
    throw new Error("Bilibili site module descriptor did not export release metadata");
  }
  const descriptorText = `${JSON.stringify(descriptor, null, 2)}\n`;
  await writeFile(path.join(outdir, "descriptor.json"), descriptorText, "utf8");
  await writeFile(
    path.join(outdir, "MODULE_HASH"),
    `${createHash("sha256").update(hashInput).digest("hex")}\n`,
    "utf8"
  );
  await writeFile(
    path.join(outdir, "SHA256SUMS"),
    `${createHash("sha256").update(descriptorText).digest("hex")}  descriptor.json\n`,
    "utf8"
  );
  await writeFile(
    path.join(outdir, "README.txt"),
    "Hourleaf Bilibili/Ave reviewed site-module developer package.\nThis is not a standalone browser extension. Use the matching Hourleaf bundle for normal installation.\n",
    "utf8"
  );
  await cp(path.join(root, "src/modules/bilibili"), path.join(outdir, "source"), {
    recursive: true
  });
  await rm(descriptorModule, { force: true });
}

/** @param {BrowserTarget} target */
function browserTarget(target) {
  if (target === "firefox") return "firefox121";
  if (target === "safari") return "safari17";
  return "chrome121";
}

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
