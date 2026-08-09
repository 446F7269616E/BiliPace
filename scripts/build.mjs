import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { build } from "esbuild";

const root = process.cwd();
const supportedTargets = ["chromium", "firefox", "safari"];
const requestedTarget = process.argv[2] ?? "all";
const targets = requestedTarget === "all" ? supportedTargets : [requestedTarget];

if (!targets.every((target) => supportedTargets.includes(target))) {
  throw new Error(`Unsupported target: ${requestedTarget}`);
}

const entryPoints = {
  background: path.join(root, "src/background/index.ts"),
  content: path.join(root, "src/content/index.ts"),
  popup: path.join(root, "src/popup/index.ts"),
  home: path.join(root, "src/home/index.ts"),
  options: path.join(root, "src/options/index.ts"),
  dashboard: path.join(root, "src/dashboard/index.ts"),
  plan: path.join(root, "src/plan/index.ts")
};

for (const target of targets) {
  const outdir = path.join(root, "dist", target);
  await rm(outdir, { recursive: true, force: true });
  await mkdir(outdir, { recursive: true });

  await build({
    entryPoints,
    outdir,
    bundle: true,
    format: "iife",
    target: target === "firefox" ? "firefox121" : target === "safari" ? "safari17" : "chrome121",
    entryNames: "[name]",
    sourcemap: false,
    minify: false,
    legalComments: "none",
    logLevel: "info"
  });

  await cp(path.join(root, "static"), outdir, { recursive: true });
  const stylesOutdir = path.join(outdir, "styles");
  await mkdir(stylesOutdir, { recursive: true });
  for (const file of await readdir(path.join(root, "src/styles"))) {
    if (!file.endsWith(".css")) continue;
    await cp(path.join(root, "src/styles", file), path.join(stylesOutdir, file));
  }
  await cp(path.join(root, "public/icons"), path.join(outdir, "icons"), { recursive: true });

  const manifest = await readFile(path.join(root, "manifests", `${target}.json`), "utf8");
  await writeFile(path.join(outdir, "manifest.json"), `${manifest.trim()}\n`, "utf8");
}
