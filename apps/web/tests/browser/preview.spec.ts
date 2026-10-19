import { openChartFixture } from './chartFixture';
import { test, expect } from '@playwright/test';
import { hudInfo } from './lpwHook';
test('谱面绘制、播放暂停、跳转与倍率',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await openChartFixture(page);
 await expect(page.getByRole('button',{name:'播放',exact:true})).toBeEnabled();
 await expect(page.locator('#stage-canvas')).toBeAttached();
 await expect.poll(async()=>Number(await page.locator('#chart-canvas').getAttribute('data-draw-calls'))).toBeGreaterThan(0);
 await page.getByRole('button',{name:'播放',exact:true}).click();
 // 默认先放约 3.7 s 开场过场（按钮期间为「跳过开场」），留足余量。
 await expect(page.getByRole('button',{name:'暂停',exact:true})).toBeVisible({timeout:12_000});
 await expect.poll(async()=>Number(await page.locator('#chart-canvas').getAttribute('data-time'))).toBeGreaterThan(.1);
 await page.getByRole('button',{name:'暂停',exact:true}).click();
 await page.locator('#timeline').evaluate((e:HTMLInputElement)=>{e.value='2.2';e.dispatchEvent(new Event('input'));});
 await expect.poll(async()=>Number(await page.locator('#chart-canvas').getAttribute('data-visible-notes'))).toBeGreaterThan(0);
 await page.locator('#rate').selectOption('2');
 await page.locator('[data-inspector-toggle]').click();
 await page.locator('#mirror').check();
 await expect(page.locator('#chart-canvas')).toHaveAttribute('data-time','2.2000');expect(errors).toEqual([]);
});
test('过线后 combo 递增并显示 PERFECT',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await openChartFixture(page);
 await expect.poll(async()=>Number(await page.locator('#chart-canvas').getAttribute('data-draw-calls'))).toBeGreaterThan(0);
 // 夹具首个音符在 t=2；等 HUD 同步后再播放，避免跳转跳过判定。
 await page.locator('#timeline').evaluate((e:HTMLInputElement)=>{e.value='1.95';e.dispatchEvent(new Event('input'));});
 await expect.poll(async()=>Number(await page.locator('#chart-canvas').getAttribute('data-time'))).toBeCloseTo(1.95,1);
 await page.getByRole('button',{name:'播放',exact:true}).click();
 await expect.poll(async()=>(await hudInfo(page)).combo.value,{timeout:15_000}).toBeGreaterThan(0);
 await expect.poll(async()=>{
  const j=(await hudInfo(page)).judge;
  return j.visible&&String(j.sprite).startsWith('ui_sc2_ingame_hantei_perfect')?1:0;
 },{timeout:15_000}).toBe(1);
 await page.getByRole('button',{name:'暂停',exact:true}).click();
 expect(errors).toEqual([]);
});
test('导入谱面，坏文件不清空已有内容',async({page})=>{
 await openChartFixture(page);
 await page.locator('#chart-file').setInputFiles({name:'测试.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({Notes:[{Uid:1,just:'1',Flags:80,holds:[]}],Bpms:[{Bpm:120,Time:0}]}))});
 await expect(page.locator('#chart-name')).toHaveText('测试.json');
 await page.locator('#timeline').evaluate((e:HTMLInputElement)=>{e.value='1';e.dispatchEvent(new Event('input'));});
 await expect(page.locator('#chart-canvas')).toHaveAttribute('data-time','1.0000');
 const visibleNotes=await page.locator('#chart-canvas').getAttribute('data-visible-notes');
 expect(Number(visibleNotes)).toBeGreaterThan(0);
 await page.locator('#chart-file').setInputFiles({name:'损坏.json',mimeType:'application/json',buffer:Buffer.from('{bad')});
 await expect(page.locator('#source-status')).toContainText('文件读取失败');
 await expect(page.locator('#chart-canvas')).toHaveAttribute('data-time','1.0000');
 await expect(page.locator('#chart-canvas')).toHaveAttribute('data-visible-notes',visibleNotes!);
});
test('窄屏不横溢，音频错误可恢复',async({page})=>{
 await page.setViewportSize({width:400,height:850});await openChartFixture(page);
 const overflow = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('body *')]
  .filter(node => node.getBoundingClientRect().right > innerWidth + 1)
  .map(node => ({ tag: node.tagName, id: node.id, cls: node.className, right: node.getBoundingClientRect().right, width: node.getBoundingClientRect().width })));
 expect(overflow).toEqual([]);
 await page.locator('#audio-file').setInputFiles({name:'bad.wav',mimeType:'audio/wav',buffer:Buffer.from('bad')});
 await expect(page.locator('#source-status')).toContainText('文件读取失败');
 await expect(page.locator('#source-status')).toBeVisible();
 await page.getByRole('button',{name:'播放',exact:true}).click();await expect(page.getByRole('button',{name:'暂停',exact:true})).toBeVisible();
});
