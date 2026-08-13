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
  expect(manifest.permissions).toEqual(
    expect.arrayContaining(["storage", "idle", "scripting", "userScripts", "activeTab"])
  );
  expect(manifest.permissions).not.toContain("declarativeNetRequestWithHostAccess");
  expect(manifest.host_permissions ?? []).toEqual([]);
  expect([...(manifest.optional_host_permissions ?? [])].sort()).toEqual([
    "http://*/*",
    "https://*/*"
  ]);
  expect(manifest.content_scripts).toBeUndefined();
  expect(manifest.web_accessible_resources).toEqual([
    { resources: ["plan.html", "end.html"], matches: ["http://*/*", "https://*/*"] }
  ]);
  expect(manifest.content_security_policy?.extension_pages).toContain("script-src 'self'");
  expect(manifest.content_security_policy?.extension_pages).not.toMatch(/https?:|unsafe-eval/);
  expect(fs.existsSync(path.join(extensionPath, "modules"))).toBe(false);
  expect(fs.existsSync(path.join(extensionPath, "optional-modules"))).toBe(false);
});

for (const [fileName, title] of [
  ["popup.html", "Hourleaf"],
  ["dashboard.html", "仪表盘 · Hourleaf"],
  ["plan.html", "计划 · Hourleaf"],
  ["options.html", "配置 · Hourleaf"],
  ["home.html", "设置 · Hourleaf"],
  ["end.html", "本次访问已结束 · Hourleaf"]
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

test("popup exposes the current-site time summary and receives a background response", async ({
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

  await expect(page.getByTestId("popup-today-time")).toBeVisible();
  await expect(page.getByTestId("popup-remaining-time")).toBeVisible();
  await expect(page.getByTestId("popup-open-dashboard")).toBeVisible();
  await expect(page.getByRole("checkbox")).toHaveCount(0);
});

test("plan requests access only for the explicitly selected website", async ({
  openExtensionPage
}) => {
  const plannedUrl = "https://example.test/focus";
  const planPage = await openExtensionPage("plan.html");
  await expect(planPage.getByTestId("plan-mode-toggle")).toHaveCount(0);
  await planPage.getByTestId("plan-add-open").click();
  await planPage.getByTestId("plan-add-url").fill(plannedUrl);
  await planPage.getByTestId("plan-add-title").fill("端到端计划页面");
  await planPage.getByTestId("plan-add-submit").click();

  const start = planPage.locator('[data-testid^="plan-start-"]').first();
  await expect(start).toBeVisible();
  await expect(start).toHaveText("开始");
  await start.click();
  await expect(start).toHaveText("请求网站权限…");
  await expect(start).toBeDisabled();
  await expect(planPage).toHaveURL(/plan\.html$/u);
});

test("configuration handles a new profile with no websites", async ({ openExtensionPage }) => {
  const page = await openExtensionPage("options.html");
  await expect(page.getByRole("heading", { name: "还没有可配置的网站" })).toBeVisible();
  await expect(page.getByTestId("site-add-button")).toBeVisible();
});

test("full pages share a centered top navigation", async ({ openExtensionPage }) => {
  for (const [fileName, currentLabel] of [
    ["dashboard.html", "仪表盘"],
    ["plan.html", "计划"],
    ["options.html", "配置"],
    ["home.html", "设置"]
  ] as const) {
    const page = await openExtensionPage(fileName);
    const navigation = page.getByRole("navigation", { name: "Hourleaf 主导航" });
    await expect(navigation).toBeVisible();
    await expect(navigation.getByRole("link")).toHaveCount(4);
    await expect(navigation.getByRole("link", { name: currentLabel })).toHaveAttribute(
      "aria-current",
      "page"
    );
  }
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
