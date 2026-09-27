import { test, expect } from '@playwright/test';
test('从头播放先放开场过场，约 3.7 s 后开播；再按可跳过',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/');await expect(page.locator('#message')).toContainText('就绪');
 await expect(page.locator('#opt-start-anim')).toBeChecked();
 await expect(page.locator('.start-anim')).toBeHidden();
 await page.getByRole('button',{name:'播放',exact:true}).click();
 await expect(page.locator('.start-anim')).toBeVisible();
 await expect(page.locator('.sa-title')).toHaveText('演示谱面');
 await expect(page.getByRole('button',{name:'跳过开场',exact:true})).toBeVisible();
 expect(Number(await page.locator('canvas').getAttribute('data-time'))).toBeLessThan(.05);
 await expect(page.locator('.start-anim')).toBeHidden({timeout:8_000});
 await expect.poll(async()=>Number(await page.locator('canvas').getAttribute('data-time'))).toBeGreaterThan(.1);
 await page.getByRole('button',{name:'暂停',exact:true}).click();
 await page.locator('#restart').click();
 await page.getByRole('button',{name:'播放',exact:true}).click();
 await expect(page.locator('.start-anim')).toBeVisible();
 await page.getByRole('button',{name:'跳过开场',exact:true}).click();
 await expect(page.locator('.start-anim')).toBeHidden();
 await expect(page.getByRole('button',{name:'播放',exact:true})).toBeVisible();
 expect(errors).toEqual([]);
});
test('关闭开场过场后直接开播',async({page})=>{
 await page.goto('/');await expect(page.locator('#message')).toContainText('就绪');
 await page.locator('#opt-start-anim').evaluate((e:HTMLInputElement)=>{e.checked=false;e.dispatchEvent(new Event('change'));});
 await page.getByRole('button',{name:'播放',exact:true}).click();
 await expect(page.getByRole('button',{name:'暂停',exact:true})).toBeVisible();
 await expect(page.locator('.start-anim')).toBeHidden();
});
