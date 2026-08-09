import fs from "node:fs";
import path from "node:path";
import { test, expect, extensionPath } from "./fixtures/extension";

test.skip(
  !fs.existsSync(path.join(extensionPath, "manifest.json")),
  "Build dist/chromium before running extension E2E"
);

test("packaged manifest stays inside the reviewed permission budget", () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(extensionPath, "manifest.json"), "utf8")
  ) as {
    manifest_version?: number;
    permissions?: string[];
    host_permissions?: string[];
    optional_host_permissions?: string[];
    content_scripts?: Array<{ matches?: string[] }>;
    web_accessible_resources?: Array<{ resources?: string[]; matches?: string[] }>;
    content_security_policy?: { extension_pages?: string };
  };

  expect(manifest.manifest_version).toBe(3);
  expect(manifest.permissions ?? []).not.toEqual(
    expect.arrayContaining([
      "cookies",
      "debugger",
      "history",
      "management",
      "nativeMessaging",
      "tabs",
      "unlimitedStorage",
      "webRequest",
      "webRequestBlocking"
    ])
  );
  expect(manifest.host_permissions ?? []).toEqual([]);
  expect([...(manifest.optional_host_permissions ?? [])].sort()).toEqual([
    "http://*/*",
    "https://*/*"
  ]);
  expect(manifest.content_scripts).toBeUndefined();
  expect(manifest.web_accessible_resources).toEqual([
    { resources: ["plan.html"], matches: ["http://*/*", "https://*/*"] }
  ]);
  expect(manifest.content_security_policy?.extension_pages).toContain("script-src 'self'");
  expect(manifest.content_security_policy?.extension_pages).not.toMatch(/https?:|unsafe-eval/);
});

for (const [fileName, title] of [
  ["popup.html", "Hourleaf"],
  ["dashboard.html", "仪表盘 · Hourleaf"],
  ["plan.html", "计划 · Hourleaf"],
  ["options.html", "配置 · Hourleaf"],
  ["home.html", "设置 · Hourleaf"]
] as const) {
  test(`${fileName} loads as a real MV3 extension page`, async ({ openExtensionPage }) => {
    const page = await openExtensionPage(fileName);
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await expect(page).toHaveTitle(title);
    await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
    await expect(page.locator("main")).toBeVisible();
    await page.waitForTimeout(250);
    expect(pageErrors).toEqual([]);
  });
}

test("popup exposes the primary focus actions and receives a background response", async ({
  openExtensionPage
}) => {
  const page = await openExtensionPage("popup.html");
  const backgroundResponse = await page.evaluate(
    () =>
      new Promise<unknown>((resolve) => {
        chrome.runtime.sendMessage(
          { version: 1, requestId: "e2e-settings", type: "GET_SETTINGS", payload: {} },
          resolve
        );
      })
  );
  expect(backgroundResponse).toMatchObject({
    version: 1,
    requestId: "e2e-settings",
    result: { ok: true }
  });

  await expect(page.getByTestId("popup-focus-toggle")).toBeVisible();
  await expect(page.getByTestId("popup-today-time")).toBeVisible();
  await expect(page.getByTestId("popup-open-settings")).toBeVisible();
  await expect(page.getByTestId("popup-open-config")).toBeVisible();
  await expect(page.getByTestId("popup-open-dashboard")).toBeVisible();
  await expect(page.getByTestId("popup-open-plan")).toBeVisible();
  await expect(page.getByTestId("popup-plan-mode-toggle")).toBeVisible();
  await expect(page.getByTestId("popup-manage-plan")).toBeVisible();
});

test("plan starts the explicitly selected website", async ({
  extensionContext,
  openExtensionPage
}) => {
  const plannedUrl = "https://example.test/focus";
  await extensionContext.route("https://example.test/**", async (route) => {
    await route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><html><body><h1 data-testid="planned-page">Planned page</h1></body></html>'
    });
  });

  const planPage = await openExtensionPage("plan.html");
  await expect(planPage.getByTestId("plan-mode-toggle")).toBeVisible();
  if (!(await planPage.getByTestId("plan-mode-toggle").isChecked())) {
    await planPage.getByTestId("plan-mode-toggle").click();
  }
  await planPage.getByTestId("plan-add-url").fill(plannedUrl);
  await planPage.getByTestId("plan-add-title").fill("端到端计划页面");
  await planPage.getByTestId("plan-add-submit").click();

  const start = planPage.locator('[data-testid^="plan-start-"]').first();
  await expect(start).toBeVisible();
  await start.click();
  await expect(planPage).toHaveURL(plannedUrl);
  await expect(planPage.getByTestId("planned-page")).toBeVisible();
});

test("configuration handles a new profile with no websites", async ({ openExtensionPage }) => {
  const page = await openExtensionPage("options.html");
  await expect(page.getByRole("heading", { name: "还没有可配置的网站" })).toBeVisible();
  await expect(page.getByRole("link", { name: "打开设置" })).toHaveAttribute("href", "home.html");
});

test("dashboard exposes every supported range and chart fallback", async ({
  openExtensionPage
}) => {
  const page = await openExtensionPage("dashboard.html");

  await expect(page.getByTestId("dashboard-range-day")).toBeVisible();
  await expect(page.getByTestId("dashboard-range-week")).toBeVisible();
  await expect(page.getByTestId("dashboard-range-month")).toBeVisible();
  await expect(page.getByTestId("dashboard-total-time")).toBeVisible();
  await expect(page.getByTestId("dashboard-section-list")).toBeVisible();
  await expect(page.getByTestId("dashboard-trend-chart")).toBeVisible();
});
