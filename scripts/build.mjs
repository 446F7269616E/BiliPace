import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
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

const extensionEntries = {
  background: path.join(root, "src/background/index.ts"),
  popup: path.join(root, "src/popup/index.ts"),
  home: path.join(root, "src/home/index.ts"),
  options: path.join(root, "src/options/index.ts"),
  dashboard: path.join(root, "src/dashboard/index.ts"),
  plan: path.join(root, "src/plan/index.ts"),
  end: path.join(root, "src/end/index.ts"),
  content: path.join(root, "src/content/index.ts")
};

// Remove directories produced by the former multi-extension release layout.
await rm(path.join(root, "dist", "bundles"), { recursive: true, force: true });
await rm(path.join(root, "dist", "modules"), { recursive: true, force: true });

for (const target of targets) await buildExtension(target);

/** @param {BrowserTarget} target */
async function buildExtension(target) {
  const outdir = path.join(root, "dist", target);
  await rm(outdir, { recursive: true, force: true });
  await build({
    entryPoints: extensionEntries,
    outdir,
    bundle: true,
    format: "iife",
    target: browserTarget(target),
    entryNames: "[name]",
    sourcemap: false,
    minify: false,
    define: {
      __HOURLEAF_BROWSER_TARGET__: JSON.stringify(target)
    },
    legalComments: "none",
    logLevel: "info"
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
  await cp(path.join(root, "_locales"), path.join(outdir, "_locales"), { recursive: true });
  const manifest = await readFile(path.join(root, "manifests", `${target}.json`), "utf8");
  await writeFile(path.join(outdir, "manifest.json"), `${manifest.trim()}\n`, "utf8");
}

/** @param {BrowserTarget} target */
function browserTarget(target) {
  if (target === "firefox") return "firefox121";
  if (target === "safari") return "safari17";
  return "chrome121";
}
