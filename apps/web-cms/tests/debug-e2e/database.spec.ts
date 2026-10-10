import { test, expect } from '@playwright/test';
test('database catalog, structure, query results and SQL errors', async ({page}, info) => {
 const errors: string[] = []; page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/web-cms/');
 await page.getByPlaceholder('用户名').fill(process.env.E2E_ADMIN_ACCOUNT ?? 'admin');
 await page.getByPlaceholder('密码',{exact:true}).fill(process.env.E2E_ADMIN_PASSWORD ?? '123456');
 await page.getByRole('button',{name:'登 录'}).click();
 if (!await page.getByText('开发工具',{exact:true}).first().isVisible()) await page.getByText('系统管理',{exact:true}).first().click();
 await page.getByText('开发工具',{exact:true}).first().click();
 await page.getByText('数据库',{exact:true}).first().click();
 await page.getByRole('navigation',{name:'数据表目录'}).getByRole('button',{name:/sys_admins/}).click();
 await expect(page.getByText('public.sys_admins',{exact:true})).toBeVisible();
 await expect(page.getByText('[已隐藏]',{exact:true}).first()).toBeVisible();
 await page.getByText('结构',{exact:true}).click();
 await expect(page.getByRole('columnheader',{name:'可空',exact:true})).toBeVisible();
 await page.screenshot({path:info.outputPath('database-structure.png'),fullPage:true});
 await page.getByText('SQL',{exact:true}).click();
 await page.getByLabel('SQL 编辑器').fill("SELECT '你好' AS greeting, 42 AS answer, NULL AS empty;");
 await page.getByRole('button',{name:'执行 SQL',exact:true}).click();
 await expect(page.getByRole('cell',{name:'你好',exact:true})).toBeVisible();
 await expect(page.getByText('影响 1 行',{exact:true})).toBeVisible();
 await page.screenshot({path:info.outputPath('database-sql.png'),fullPage:true});
 for (const size of [{width:1440,height:900},{width:1280,height:768}]) {
   await page.setViewportSize(size);
   expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(size.width);
   expect(await page.evaluate(()=>document.documentElement.scrollHeight)).toBe(size.height);
 }
 await page.getByLabel('SQL 编辑器').fill('SELECT missing_column;');
 await page.getByRole('button',{name:'执行 SQL',exact:true}).click();
 await expect(page.getByRole('alert').filter({hasText:'字段不存在'})).toBeVisible();
 expect(errors).toEqual([]);
});
