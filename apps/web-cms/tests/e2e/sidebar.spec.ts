import { expect, test } from '@playwright/test';

test('收起菜单的背景和图标居中', async ({ page }) => {
  await page.goto('/#/index');
  await page.locator('button').filter({ has: page.locator('.anticon-menu-fold') }).click();
  const menu = page.locator('.ant-menu-inline-collapsed');
  await expect(menu).toBeVisible();
  const selected = menu.locator('.ant-menu-item-selected');
  const icon = selected.locator('.anticon');
  await expect.poll(async () => {
    const item = (await selected.boundingBox())!;
    const glyph = (await icon.boundingBox())!;
    return Math.abs(item.x + item.width / 2 - glyph.x - glyph.width / 2);
  }).toBeLessThan(1);
  const side = await menu.locator('..').boundingBox();
  const item = (await selected.boundingBox())!;
  expect(Math.abs(side!.x + side!.width / 2 - item.x - item.width / 2)).toBeLessThan(1);
  await page.screenshot({ path: test.info().outputPath('sidebar.png'), animations: 'disabled' });
});
