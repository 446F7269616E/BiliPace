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

test("popup has semantic, keyboard reachable primary actions", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(pathToFileURL(path.join(buildRoot, "popup.html")).href);

  await expect(page.getByRole("checkbox", { name: /^(开启|暂停)专注保护$/ })).toBeVisible();
  await expect(page.getByRole("link", { name: "打开设置" })).toBeVisible();
  await expect(page.getByRole("link", { name: "查看仪表盘" })).toBeVisible();
  await expect(page.getByTestId("popup-temp-access")).toBeVisible();
  await expect(page.getByTestId("popup-today-time")).not.toBeEmpty();

  await page.keyboard.press("Tab");
  await expect(page.locator(":focus")).toBeVisible();
  expect(errors).toEqual([]);
});

test("options exposes labelled section rules and scheduling", async ({ page }) => {
  await page.goto(pathToFileURL(path.join(buildRoot, "options.html")).href);

  await expect(page.getByRole("checkbox", { name: /屏蔽首页/ })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /屏蔽动态/ })).toBeVisible();
  await expect(page.getByTestId("schedule-add")).toBeVisible();
  await expect(page.getByTestId("settings-save")).toBeVisible();
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
