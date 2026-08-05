import { expect, test } from "@playwright/test";

test.describe("M3 application artifact library", () => {
  test("opens the Apps page, refreshes its catalog, and exposes both registration workflows", async ({
    page,
  }) => {
    await page.goto("/#apps");
    await expect(page.getByRole("heading", { name: "应用", exact: true })).toBeVisible();
    await expect(page.getByTestId("artifact-table")).toBeVisible();
    await expect(page.getByRole("button", { name: "刷新" })).toBeEnabled();

    await page.getByRole("button", { name: "导入包体" }).click();
    await expect(page.getByRole("dialog", { name: "导入 Android 包体" })).toBeVisible();
    await page.getByRole("button", { name: "关闭导入窗口" }).click();

    await page.getByRole("button", { name: "登记已安装" }).click();
    await expect(page.getByRole("dialog", { name: "登记已安装版本" })).toBeVisible();
    await page.getByRole("button", { name: "关闭已安装登记窗口" }).click();

    await page.getByRole("combobox", { name: "制品类型筛选" }).selectOption("INSTALLED");
    await expect(page.getByTestId("artifact-table")).toContainText("暂无符合筛选条件的制品");
    await page.reload();
    await expect(page.getByRole("heading", { name: "应用", exact: true })).toBeVisible();
  });
});
