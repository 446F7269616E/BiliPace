import { chromium, test as base, type BrowserContext, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

export const extensionPath = path.join(repositoryRoot, "dist/chromium");

interface ExtensionFixtures {
  openExtensionPage: (relativePath: string) => Promise<Page>;
}

interface ExtensionWorkerFixtures {
  extensionContext: BrowserContext;
  extensionId: string;
}

export const test = base.extend<ExtensionFixtures, ExtensionWorkerFixtures>({
  extensionContext: [
    async ({ browserName }, use) => {
      if (browserName !== "chromium") {
        throw new Error("The installed extension fixture requires Chromium");
      }
      if (!fs.existsSync(path.join(extensionPath, "manifest.json"))) {
        throw new Error(
          `Missing Chromium build at ${extensionPath}; run npm run build:chromium first`
        );
      }

      const context = await chromium.launchPersistentContext("", {
        // Branded Chrome no longer supports the side-load flags Playwright needs.
        // The bundled Chromium channel is the supported real-extension runner.
        channel: "chromium",
        headless: Boolean(process.env.CI),
        args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
      });

      await use(context);
      await context.close();
    },
    { scope: "worker" }
  ],

  extensionId: [
    async ({ extensionContext }, use) => {
      let [worker] = extensionContext.serviceWorkers();
      worker ??= await extensionContext.waitForEvent("serviceworker", { timeout: 15_000 });
      await use(new URL(worker.url()).host);
    },
    { scope: "worker" }
  ],

  openExtensionPage: async ({ extensionContext, extensionId }, use) => {
    const open = async (relativePath: string): Promise<Page> => {
      const page = await extensionContext.newPage();
      page.on("pageerror", (error) =>
        console.error(`[${relativePath}] page error:`, error.message)
      );
      page.on("console", (message) => {
        if (message.type() === "error")
          console.error(`[${relativePath}] console error:`, message.text());
      });
      await page.goto(`chrome-extension://${extensionId}/${relativePath}`);
      await page.waitForLoadState("domcontentloaded");
      return page;
    };
    await use(open);
  }
});

export { expect } from "@playwright/test";
