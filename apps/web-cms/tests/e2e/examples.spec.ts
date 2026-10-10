import { expect, test } from "@playwright/test";

test("用户 CRUD 复用表格 hook 后仍支持翻页、查询、编辑和刷新", async ({ page }) => {
  await page.goto("/#/curd/users");
  const rows = page.locator(".ant-table-tbody tr[data-row-key]");
  await expect(rows).toHaveCount(5);
  await page.locator('.ant-pagination-item-2').click();
  await expect(rows.first()).toContainText("小王");
  await page.locator(".ant-card").getByPlaceholder("请输入姓名").fill("小红");
  await page.getByRole("button", { name: /^查\s*询$/ }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("小红");
  await rows.first().getByRole("button", { name: /编\s*辑/ }).click();
  const dialog = page.getByRole("dialog");
  await dialog.locator('.ant-form-item').filter({ hasText: "描述" }).getByRole("textbox").fill("编辑后的描述");
  await dialog.getByRole("button", { name: /保\s*存/ }).click();
  await expect(dialog).not.toBeVisible();
  await expect(rows.first()).toContainText("编辑后的描述");
  await page.getByRole("button", { name: /^重\s*置$/ }).click();
  await expect(rows).toHaveCount(5);
});


test("e-boxes 多组件同步、批量更新、重置和刷新", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/#/eBoxUse");
  await page.getByRole("button", { name: /增\s*加/, exact: true }).click();
  await expect(page.getByTestId("preview-count")).toHaveText("1");
  await page.getByLabel("每次增减").fill("5");
  await page.getByRole("button", { name: /增\s*加/, exact: true }).click();
  await expect(page.getByTestId("preview-count")).toHaveText("6");
  await page.getByLabel("减少计数").click();
  await expect(page.getByTestId("preview-count")).toHaveText("1");
  await page.getByLabel("工作空间名称").fill("测试空间");
  await expect(page.getByRole("heading", { name: "测试空间", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "批量应用设置" }).click();
  await expect(page.getByText("通知已关闭", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "重置示例" }).click();
  await expect(page.getByTestId("preview-count")).toHaveText("0");
  await expect(page.getByLabel("每次增减")).toHaveValue("1");
  await page.screenshot({ path: test.info().outputPath("ebox-main.png") });
  await page.getByRole("button", { name: /增\s*加/, exact: true }).click();
  await page.reload();
  await expect(page.getByTestId("preview-count")).toHaveText("0");
  expect(errors).toEqual([]);
});

test("新增资料校验、头像预览、详情、批量状态和删除", async ({ page }) => {
  await page.goto('/#/curd/users');
  await page.getByRole('button', { name: '添加用户', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: /^添\s*加$/ }).click();
  await expect(dialog.getByText('请输入姓名', { exact: true })).toBeVisible();
  await dialog.getByLabel('姓名', { exact: true }).fill('组件演示用户');
  await dialog.getByLabel('账号', { exact: true }).fill('demo_user');
  await dialog.getByLabel('手机号', { exact: true }).fill('13900000000');
  await dialog.getByLabel('邮箱', { exact: true }).fill('invalid');
  await dialog.getByRole('button', { name: /^添\s*加$/ }).click();
  await expect(dialog.getByText('请输入有效邮箱', { exact: true })).toBeVisible();
  await dialog.getByLabel('邮箱', { exact: true }).fill('demo@example.com');
  await dialog.getByLabel('部门', { exact: true }).click();
  await page.locator('.ant-select-tree-title').getByText('研发部', { exact: true }).click();
  await dialog.locator('.ant-checkbox-wrapper').filter({ hasText: '音乐' }).click();
  await expect(dialog.getByRole('checkbox', { name: '音乐', exact: true })).toBeChecked();
  await dialog.getByRole('switch').click();
  await dialog.locator('input[type=file]').setInputFiles({ name: 'avatar.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1eQAAAAASUVORK5CYII=', 'base64') });
  await expect(dialog.locator('.ant-avatar img')).toHaveAttribute('src', /^data:image\/png/);
  await page.screenshot({ path: test.info().outputPath('user-form.png') });
  await dialog.getByRole('button', { name: /^添\s*加$/ }).click();
  await expect(dialog).not.toBeVisible();
  const row = page.locator('tr[data-row-key]').filter({ hasText: '组件演示用户' });
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: '组件演示用户', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: '用户详情' });
  await expect(drawer).toContainText('demo@example.com');
  await expect(drawer).toContainText('音乐');
  await expect(drawer).toContainText('关闭');
  await drawer.getByRole('button', { name: '关闭', exact: true }).click();
  await row.getByRole('checkbox').check();
  await page.getByRole('button', { name: '批量停用', exact: true }).click();
  await page.getByRole('button', { name: /^确\s*定$/ }).click();
  await expect(row.locator('.ant-badge-status-text')).toHaveText('停用');
  await row.getByRole('checkbox').check();
  await page.getByRole('button', { name: '批量启用', exact: true }).click();
  await expect(row.locator('.ant-badge-status-text')).toHaveText('启用');
  await row.getByRole('button', { name: /^删\s*除$/ }).click();
  await page.locator('.ant-popconfirm').getByRole('button', { name: /^删\s*除$/ }).click();
  await expect(row).toHaveCount(0);
});

test("复杂查询、字段设置与展开后的屏幕适配", async ({ page }) => {
  await page.goto('/#/curd/users');
  const search = page.locator('.ant-card').filter({ has: page.getByPlaceholder('请输入姓名') });
  await search.locator('[class*="foldButton"]').click();
  await search.getByPlaceholder('最小年龄').fill('21');
  await search.getByPlaceholder('最大年龄').fill('21');
  await search.getByRole('button', { name: /^查\s*询$/ }).click();
  const rows = page.locator('tr[data-row-key]');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('小红');
  await search.getByRole('button', { name: /^重\s*置$/ }).click();
  await expect(rows).toHaveCount(5);
  await search.locator('.anticon-setting').click();
  const settings = page.getByRole('dialog', { name: '字段选择' });
  await settings.locator('[class*="optionRow"]').filter({ hasText: /^用户 ID$/ }).locator('.ant-checkbox-wrapper').click();
  await settings.getByRole('button', { name: /^确\s*定$/ }).click();
  await expect(search.getByPlaceholder('请输入用户 ID')).not.toBeVisible();
  await page.reload();
  await search.locator('[class*="foldButton"]').click();
  await expect(search.getByPlaceholder('请输入用户 ID')).not.toBeVisible();
  for (const viewport of [{ width: 1440, height: 900 }, { width: 1280, height: 720 }]) {
    await page.setViewportSize(viewport);
    await expect.poll(async () => { const box = await page.locator('.ant-pagination').boundingBox(); return box ? box.y + box.height : Infinity; }).toBeLessThanOrEqual(viewport.height);
    await page.screenshot({ path: test.info().outputPath(`users-${viewport.width}.png`) });
  }
});
