import type { Note } from './chart';
export const BORDER=-4.632, SPAWN=52, Y=4.5;
export interface Slope { duration:number; speed:number; zAt:(remaining:number)=>number }
export const worldX=(lane:number)=>0.15*(lane-29.5);
export const clamp=(v:number,a:number,b:number)=>Math.max(a,Math.min(b,v));
export function createSlope(speed:number):Slope {
  if(!Number.isFinite(speed)||speed<=0||speed>30)throw new Error('下落速度需在 0–30 之间');
  const zAt=(remaining:number)=>{const d=remaining*speed;return BORDER+3.9*d+0.072*d*d*d;};
  let duration=1;
  for(let i=0;i<100;i++){
    const d=duration*speed,next=duration-(zAt(duration)-SPAWN)/(3.9*speed+0.216*speed*d*d);
    if(Math.abs(next-duration)<0.01)return {duration:next,speed,zAt};
    duration=next;
  }
  throw new Error('下落曲线未收敛');
}
export function edges(n:Note,p:number,mirror:boolean):[number,number] {
  const l=n.l+(n.l2-n.l)*p,r=n.r+(n.r2-n.r)*p;
  return mirror?[59-r,59-l]:[l,r];
}
export function holdSegment(n:Note,now:number,s:Slope,mirror:boolean):number[] {
  const length=n.end-n.time,e=now-n.time+s.duration;
  const zh=Math.max(s.zAt(n.time-now),BORDER),zt=s.zAt(n.end-now);
  if(length<=0||zh>=SPAWN||zt<=BORDER)return [];
  const head=edges(n,clamp((now-n.time)/length,0,1),mirror);
  const tail=edges(n,Math.min(e/length,1),mirror),far=Math.min(zt,SPAWN);
  const x=(lr:[number,number])=>[-4.5+0.15*(lr[0]+1),worldX((lr[0]+lr[1])/2),-4.5+0.15*lr[1]];
  const h=x(head),t=x(tail);
  return [h[0],Y,zh,t[0],Y,far,h[1],Y,zh,t[1],Y,far,h[2],Y,zh,t[2],Y,far];
}
