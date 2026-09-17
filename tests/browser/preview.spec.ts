import { test, expect } from '@playwright/test';
test('演示绘制、播放暂停、跳转与倍率',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/');await expect(page.locator('#message')).toContainText('就绪');
 await expect.poll(async()=>Number(await page.locator('canvas').getAttribute('data-draw-calls'))).toBeGreaterThan(0);
 await page.getByRole('button',{name:'播放',exact:true}).click();
 await expect(page.getByRole('button',{name:'暂停',exact:true})).toBeVisible();
 await expect.poll(async()=>Number(await page.locator('canvas').getAttribute('data-time'))).toBeGreaterThan(.1);
 await page.getByRole('button',{name:'暂停',exact:true}).click();
 await page.locator('#timeline').evaluate((e:HTMLInputElement)=>{e.value='2.2';e.dispatchEvent(new Event('input'));});
 await expect.poll(async()=>Number(await page.locator('canvas').getAttribute('data-visible-notes'))).toBeGreaterThan(0);
 await page.locator('#rate').selectOption('2');await page.locator('#mirror').check();
 await expect(page.locator('canvas')).toHaveAttribute('data-time','2.2000');expect(errors).toEqual([]);
});
test('导入谱面，坏文件不清空已有内容',async({page})=>{
 await page.goto('/');
 await page.locator('#chart-file').setInputFiles({name:'测试.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({Notes:[{Uid:1,just:'1',Flags:80,holds:[]}],Bpms:[{Bpm:120,Time:0}]}))});
 await expect(page.locator('#song-title')).toHaveText('测试.json');
 await page.locator('#chart-file').setInputFiles({name:'损坏.json',mimeType:'application/json',buffer:Buffer.from('{bad')});
 await expect(page.locator('#message')).toContainText('原谱面已保留');await expect(page.locator('#song-title')).toHaveText('测试.json');
});
test('窄屏不横溢，音频错误可恢复',async({page})=>{
 await page.setViewportSize({width:400,height:850});await page.goto('/');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.locator('#audio-file').setInputFiles({name:'bad.wav',mimeType:'audio/wav',buffer:Buffer.from('bad')});
 await expect(page.locator('#message')).toContainText('音频解码失败');await page.getByRole('button',{name:'播放',exact:true}).click();await expect(page.getByRole('button',{name:'暂停',exact:true})).toBeVisible();
});
