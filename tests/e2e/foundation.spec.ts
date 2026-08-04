import { expect, test } from "@playwright/test";

test.describe("M1 console foundation", () => {
  test("reaches all operator pages and keeps active navigation announced", async ({
    page,
  }, testInfo) => {
    await page.goto("/#overview");
    await expect(page).toHaveTitle(/Test Center/);
    const labels = ["总览", "设备", "应用", "构建", "会话", "报告", "设置"];
    for (const label of labels) {
      if (
        testInfo.project.name === "mobile" &&
        (await page.locator(".sidebar.is-open").count()) === 0
      )
        await page.getByRole("button", { name: "打开导航" }).click();
      await page.getByRole("link", { name: label, exact: true }).click();
      await expect(page.getByRole("heading", { name: label, exact: true })).toBeVisible();
      await expect(page.getByRole("link", { name: label, exact: true })).toHaveAttribute(
        "aria-current",
        "page",
      );
    }
  });

  test("hydrates after refresh and shows real-time channel status", async ({ page }) => {
    await page.goto("/#overview");
    await expect(page.getByRole("heading", { name: "总览" })).toBeVisible();
    await expect(page.getByTestId("health-banner")).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { name: "总览" })).toBeVisible();
    await expect(page.getByTestId("health-banner")).toContainText(/实时状态|连接/);
  });

  test("keeps diagnostic layout usable on a narrow device viewport", async ({ page }, testInfo) => {
    await page.goto("/#devices");
    await expect(page.getByRole("heading", { name: "设备" })).toBeVisible();
    await page.screenshot({
      path: `output/playwright/${testInfo.project.name}-devices.png`,
      fullPage: true,
    });
    const scrollWidth = await page.locator("body").evaluate((node) => node.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(testInfo.project.name === "mobile" ? 700 : 1600);
  });
});
