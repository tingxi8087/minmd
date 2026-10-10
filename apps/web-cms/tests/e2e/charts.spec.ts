import { expect, test } from "@playwright/test";

test("首页导览、导航分组、旧地址与本地文档", async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/#/index');
  await expect(page.getByText('关于 mas-cms', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '图表使用说明', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('src/components/EChart');
  await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.screenshot({ path: test.info().outputPath('home.png') });
  for (const [path, title, group] of [['/curd/users', '用户管理', '组件示例'], ['/charts', '图表展示', '组件示例'], ['/eBoxUse', '状态管理', '开发示例'], ['/accessPage', '权限控制', '开发示例']]) {
    await page.goto(`/#${path}`);
    await expect(page.getByRole('menuitem', { name: title, exact: true })).toHaveClass(/ant-menu-item-selected/);
    await expect(page.getByRole('menuitem', { name: group, exact: true })).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('.ant-breadcrumb')).toContainText(`${group}`);
  }
  await page.goto('/#/noLayout');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await page.getByRole('button', { name: '返回首页' }).click();
  await expect(page).toHaveURL(/#\/index$/);
  expect(errors).toEqual([]);
});

test("图表绘制、范围切换、空状态、刷新与尺寸适配", async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/#/charts');
  const chart = page.getByRole('img', { name: '访问趋势', exact: true });
  await expect(page.locator('canvas')).toHaveCount(4);
  await expect(chart.locator('canvas')).toBeVisible();
  await page.getByText('近 30 天', { exact: true }).click();
  await expect(page.locator('.ant-spin-spinning')).toHaveCount(0);
  const before = (await chart.boundingBox())!.width;
  await page.locator('button').filter({ has: page.locator('.anticon-menu-fold') }).click();
  await expect.poll(async () => (await chart.boundingBox())!.width).toBeGreaterThan(before);
  await expect.poll(async () => Math.abs((await chart.locator('canvas').boundingBox())!.width - (await chart.boundingBox())!.width)).toBeLessThan(1);
  await page.getByRole('switch', { name: '空数据演示' }).click();
  await expect(page.locator('.ant-empty-description').filter({ hasText: '暂无数据' })).toHaveCount(4);
  await expect(page.locator('canvas')).toHaveCount(0);
  await page.getByRole('switch', { name: '空数据演示' }).click();
  await page.getByRole('button', { name: '刷新数据', exact: true }).click();
  await expect(page.locator('canvas')).toHaveCount(4);
  await expect(page.locator('.ant-spin-spinning')).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath('charts.png'), fullPage: true });
  await page.setViewportSize({ width: 800, height: 900 });
  await expect.poll(async () => Math.abs((await chart.locator('canvas').boundingBox())!.width - (await chart.boundingBox())!.width)).toBeLessThan(1);
  await page.goto('/#/index');
  await page.goto('/#/charts');
  await expect(page.locator('canvas')).toHaveCount(4);
  expect(errors).toEqual([]);
});

test("文档 Markdown 渲染和相对文档链接", async ({ page }) => {
  await page.goto('/#/index');
  await page.getByRole('button', { name: '开发约定', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: '项目开发约定', exact: true })).toBeVisible();
  await dialog.getByRole('link', { name: '复用指南', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: '现有能力复用指南', exact: true })).toBeVisible();
  await expect(dialog.getByRole('table').first()).toBeVisible();
  await expect(dialog.locator('pre code').first()).toContainText('UserManage');
  await page.screenshot({ animations: 'disabled', path: test.info().outputPath('markdown.png') });
  await dialog.getByRole('link', { name: '图表说明', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: '图表展示', exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole('button', { name: '开发约定', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: '项目开发约定', exact: true })).toBeVisible();
  await expect(page).toHaveURL(/#\/index$/);
});
