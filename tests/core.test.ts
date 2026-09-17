import { describe, it, expect } from 'vitest';
import { deflateSync, strToU8 } from 'fflate';
import { parseChart, decodeChart } from '../src/chart';
import { createSlope, worldX, holdSegment } from '../src/geometry';
import { Transport } from '../src/transport';
const flags = (t: number,l: number,r: number,l2=0,r2=0) => t+r*16+r2*1024+l*65536+l2*4194304;
const note = (Uid=1, just='2', Flags=flags(0,0,5), holds:string[]=[]) => ({Uid,just,Flags,holds});
const source = (Notes=[note()]) => ({Notes,Bpms:[{Time:0,Bpm:120}]});
describe('原格式解析',()=>{
 it('保留四种类型和 60 格边界',()=>{expect(parseChart(source([0,1,2,3].map((t)=>note(t+1,'2',flags(t,54,59,54,59),t===1?['3']:[])))).notes.map(n=>n.type)).toEqual([0,1,2,3]);});
 it('读取 raw deflate 与 JSON',()=>{const bytes=strToU8(JSON.stringify(source()));expect(decodeChart(deflateSync(bytes)).notes).toEqual(decodeChart(bytes).notes);});
 it('空谱可读',()=>expect(parseChart(source([])).notes).toEqual([]));
 it('允许真实谱面的零时长 Hold',()=>expect(parseChart(source([note(1,'2',flags(1,0,5,0,5),['2'])])).notes[0].end).toBe(2));
 it('允许 BPM 段从负时间开始',()=>expect(parseChart({...source(),Bpms:[{Time:-0.01,Bpm:118}]}).bpms[0].time).toBe(-0.01));
 it('保留多个前段汇入同一后段的原始链接',()=>{const c=parseChart(source([note(1,'1',flags(1,0,5,10,15),['3']),note(2,'2',flags(1,20,25,10,15),['3']),note(3,'3',flags(1,10,15,20,25),['4'])]));expect(c.roots).toHaveLength(2);expect(c.notes[0].next).toBe(c.notes[2]);expect(c.notes[1].next).toBe(c.notes[2]);});
 it.each([NaN,Infinity,-1,'',null])('拒绝非法时刻 %s',(just)=>expect(()=>parseChart(source([{...note(),just} as any]))).toThrow());
 it('拒绝重复 UID',()=>expect(()=>parseChart(source([note(),note()]))).toThrow());
 it('拒绝越界格和未知类型',()=>{expect(()=>parseChart(source([note(1,'2',flags(0,0,63))]))).toThrow();expect(()=>parseChart(source([note(1,'2',4)]))).toThrow();});
 it('拒绝倒序 Hold',()=>expect(()=>parseChart(source([note(1,'2',flags(1,0,5,0,5),['1'])]))).toThrow());
 it('按时间、UID 和边缘串链，保留本段终点',()=>{const c=parseChart(source([note(1,'2',flags(1,0,5,10,15),['3']),note(2,'3',flags(1,10,15,20,25),['4'])]));expect(c.roots).toHaveLength(1);expect(c.notes[0].next).toBe(c.notes[1]);expect(c.notes[0].end).toBe(3);});
 it('同时押采用首组 4ms 容差而非传递合并',()=>{const c=parseChart(source([note(1,'2'),note(2,'2.003'),note(3,'2.006')]));expect(c.lines).toHaveLength(1);expect(c.lines[0].points).toHaveLength(2);});
});
describe('原版空间数学',()=>{
 it('中心与左右边界',()=>{expect(worldX(29.5)).toBe(0);expect(worldX(0)).toBeCloseTo(-4.425);expect(worldX(59)).toBeCloseTo(4.425);});
 it.each([1,5,10])('速度 %s 判定时刻落在判定线',(speed)=>{const s=createSlope(speed);expect(s.zAt(0)).toBeCloseTo(-4.632);expect(s.zAt(s.duration)).toBeCloseTo(52,0);});
 it('Hold 网格裁剪与镜像',()=>{const n=parseChart(source([note(1,'2',flags(1,0,5,10,15),['3'])])).notes[0];const s=createSlope(5);const a=holdSegment(n,2.5,s,false),b=holdSegment(n,2.5,s,true);expect(a).toHaveLength(18);expect(a.every(Number.isFinite)).toBe(true);expect(b[0]).toBeCloseTo(-a[12]);expect(a[2]).toBeCloseTo(-4.632);expect(holdSegment(n,4,s,false)).toEqual([]);});
 it('拒绝零速',()=>expect(()=>createSlope(0)).toThrow());
});
describe('播放状态与连续性',()=>{
 it('暂停、恢复、倍速切换均不跳时间',()=>{let now=0;const t=new Transport(()=>now);t.setDuration(10);t.play();now=2;expect(t.time).toBe(2);t.setRate(2);expect(t.time).toBe(2);now=3;expect(t.time).toBe(4);t.pause();now=5;expect(t.time).toBe(4);t.play();now=6;expect(t.time).toBe(6);});
 it('边界 seek、结束和重播',()=>{let now=0;const t=new Transport(()=>now);t.setDuration(3);t.seek(-3);expect(t.time).toBe(0);t.play();now=4;expect(t.time).toBe(3);expect(t.playing).toBe(false);t.play();expect(t.time).toBe(0);});
 it('拒绝非有限输入',()=>{const t=new Transport(()=>0);expect(()=>t.seek(NaN)).toThrow();expect(()=>t.setRate(0)).toThrow();});
});
