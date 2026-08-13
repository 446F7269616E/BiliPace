import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { installWebExtensionMock } from "./fixtures/webextension-mock";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const buildRoot = path.join(repositoryRoot, "dist/chromium");

test.skip(!fs.existsSync(path.join(buildRoot, "popup.html")), "Build dist/chromium before UI E2E");

test.beforeEach(async ({ context }) => {
  await installWebExtensionMock(context);
});

test("popup has a focused current-site time summary without quick toggles", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(pathToFileURL(path.join(buildRoot, "popup.html")).href);

  await expect(page.getByRole("checkbox")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "进入 Hourleaf 主界面" })).toBeVisible();
  await expect(page.getByTestId("popup-today-time")).toHaveText("00:10");
  await expect(page.getByTestId("popup-remaining-time")).toHaveText("00:35");

  await page.keyboard.press("Tab");
  await expect(page.locator(":focus")).toBeVisible();
  expect(errors).toEqual([]);
});

test("configuration exposes per-website time rules without content filters", async ({ page }) => {
  await page.goto(pathToFileURL(path.join(buildRoot, "options.html")).href);

  await expect(page.getByRole("heading", { name: "网站" })).toBeVisible();
  await expect(page.getByTestId("site-add-button")).toBeVisible();
  await expect(page.getByTestId("period-add")).toBeVisible();
  await expect(page.getByTestId("settings-save")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "限制模式" })).toBeVisible();
  const restrictionMode = page.getByRole("combobox", { name: "限制模式" });
  await expect(restrictionMode.getByRole("option")).toHaveText(["宽容", "心流", "严格"]);
  await restrictionMode.selectOption("flow");
  await expect(page.getByText("额度结束后选择短暂延长，然后进入结束页面。")).toBeVisible();
  await expect(page.getByTestId("period-toggle-period:home:all-day")).toBeChecked();
  await page.getByTestId("period-toggle-period:home:all-day").uncheck();
  await expect(page.getByTestId("auto-save-status")).toHaveText("已保存");
  await expect(page.getByRole("heading", { name: "内容降噪" })).toHaveCount(0);
});

test("settings separates module controls from other plugin settings", async ({ page }) => {
  await page.goto(pathToFileURL(path.join(buildRoot, "home.html")).href);

  await expect(page.getByRole("heading", { name: "模块设置" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "插件其他设置" })).toBeVisible();
  await expect(page.getByTestId("site-add-input")).toHaveCount(0);
  await expect(page.getByTestId("module-import-open")).toBeVisible();
  await expect(page.getByTestId("settings-plan-auto-complete")).not.toBeChecked();
  await expect(page.getByTestId("settings-show-remaining-minutes")).toBeChecked();
  await expect(page.getByRole("heading", { name: "常规" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "结束页面" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "数据管理" })).toBeVisible();
  await expect(page.getByText("还没有本地模块")).toBeVisible();
  await expect(page.getByText("不会从 GitHub 或其他地址自动下载代码")).toBeVisible();
});

test("settings imports a user-selected local module without a remote installer", async ({
  page
}) => {
  await page.goto(pathToFileURL(path.join(buildRoot, "home.html")).href);
  await page.getByTestId("module-import-open").click();
  await expect(
    page.getByText("兼容内容必须声明作者，并使用 Hourleaf 规范化内容格式。")
  ).toHaveCount(0);
  await page.getByTestId("module-import-files").setInputFiles([
    {
      name: "hourleaf-module.json",
      mimeType: "application/json",
      buffer: Buffer.from(
        JSON.stringify({
          schemaVersion: 1,
          format: "hourleaf.local-module",
          id: "example.local.e2e",
          name: "E2E 本地模块",
          author: "Hourleaf E2E",
          version: "1.0.0",
          matches: ["https://example.com/*"],
          domainPolicy: "timed",
          hideSelectors: [".recommendations"],
          cssFiles: ["focus.css"],
          dnrRules: [],
          userScriptFiles: []
        })
      )
    },
    {
      name: "focus.css",
      mimeType: "text/css",
      buffer: Buffer.from(".recommendations { display: none; }")
    }
  ]);
  await expect(page.getByText("E2E 本地模块 1.0.0")).toBeVisible();
  await page.getByRole("checkbox", { name: /安全检测只能过滤/u }).check();
  await page.getByTestId("module-import-confirm").click();
  await expect(page.getByRole("heading", { name: "E2E 本地模块" })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "启用 E2E 本地模块" })).toBeChecked();
});

test("plan expiry mode uses short options with a persistent explanation", async ({ page }) => {
  await page.goto(pathToFileURL(path.join(buildRoot, "plan.html")).href);
  await page.getByTestId("plan-add-open").click();

  const completionMode = page.getByTestId("plan-add-completion-mode");
  await expect(completionMode.getByRole("option")).toHaveText(["宽容", "心流", "严格"]);
  await expect(page.getByText("额度结束后选择短暂延长，然后进入结束页面。")).toBeVisible();
  await completionMode.selectOption("strict");
  await expect(page.getByText("额度结束后立即进入结束页面。")).toBeVisible();
});

test("dashboard exposes day, week and month without color-only data", async ({ page }) => {
  await page.goto(pathToFileURL(path.join(buildRoot, "dashboard.html")).href);

  for (const range of ["day", "week", "month"]) {
    const control = page.getByTestId(`dashboard-range-${range}`);
    await expect(control).toBeVisible();
    await control.click();
    await expect(page.getByTestId("dashboard-total-time")).not.toBeEmpty();
  }

  await expect(page.getByTestId("dashboard-section-list")).not.toBeEmpty();
  const chart = page.getByTestId("dashboard-trend-chart");
  const accessibleName =
    (await chart.getAttribute("aria-label")) ?? (await chart.getAttribute("aria-labelledby"));
  expect(accessibleName).toBeTruthy();
});
