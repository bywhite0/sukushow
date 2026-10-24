import { describe, it, expect } from 'vitest';
import { parseChart } from '@sukushow/chart/chart';
import { createSlope, worldX, holdSegment } from '../src/geometry';
import { Transport } from '../src/transport';
const flags = (t: number,l: number,r: number,l2=0,r2=0) => t+r*16+r2*1024+l*65536+l2*4194304;
const note = (Uid=1, just='2', Flags=flags(0,0,5), holds:string[]=[]) => ({Uid,just,Flags,holds});
const source = (Notes=[note()]) => ({Notes,Bpms:[{Time:0,Bpm:120}]});
describe('原版空间数学',()=>{
 it('中心与左右边界',()=>{expect(worldX(29.5)).toBe(0);expect(worldX(0)).toBeCloseTo(-4.425);expect(worldX(59)).toBeCloseTo(4.425);});
 it.each([1,5,10])('速度 %s 判定时刻落在判定线',(speed)=>{const s=createSlope(speed);expect(s.zAt(0)).toBeCloseTo(-4.632);expect(s.zAt(s.duration)).toBeCloseTo(52,0);});
 it('Hold 网格裁剪与镜像',()=>{const n=parseChart(source([note(1,'2',flags(1,0,5,10,15),['3'])])).notes[0];const s=createSlope(5);const a=holdSegment(n,2.5,s,false),b=holdSegment(n,2.5,s,true);expect(a).toHaveLength(18);expect(a.every(Number.isFinite)).toBe(true);expect(b[0]).toBeCloseTo(-a[12]);expect(a[2]).toBeCloseTo(-4.632);expect(holdSegment(n,4,s,false)).toEqual([]);});
 it('未出生与已结束的 Hold 不生成顶点',()=>{const n=parseChart(source([note(3,'3',flags(1,0,10,0,10),['4'])])).notes[0];const s=createSlope(6);expect(holdSegment(n,-10,s,false)).toEqual([]);expect(holdSegment(n,100,s,false)).toEqual([]);});
 it('拒绝零速',()=>expect(()=>createSlope(0)).toThrow());
});
describe('播放状态与连续性',()=>{
 it('暂停、恢复、倍速切换均不跳时间',()=>{let now=0;const t=new Transport(()=>now);t.setDuration(10);t.play();now=2;expect(t.time).toBe(2);t.setRate(2);expect(t.time).toBe(2);now=3;expect(t.time).toBe(4);t.pause();now=5;expect(t.time).toBe(4);t.play();now=6;expect(t.time).toBe(6);});
 it('边界 seek、结束和重播',()=>{let now=0;const t=new Transport(()=>now);t.setDuration(3);t.seek(-3);expect(t.time).toBe(0);t.play();now=4;expect(t.time).toBe(3);expect(t.playing).toBe(false);t.play();expect(t.time).toBe(0);});
 it('走带起点可为负（开场过场计入进度条），重播回到起点',()=>{let now=0;const t=new Transport(()=>now);t.setDuration(3);t.setStart(-2);t.seek(-5);expect(t.time).toBe(-2);t.play();now=1;expect(t.time).toBe(-1);now=6;expect(t.time).toBe(3);t.play();expect(t.time).toBe(-2);expect(()=>t.setStart(1)).toThrow();});
 it('拒绝非有限输入',()=>{const t=new Transport(()=>0);expect(()=>t.seek(NaN)).toThrow();expect(()=>t.setRate(0)).toThrow();});
});
