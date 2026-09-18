import { parseChart } from './chart';
export function demoChart(){
  const Notes:{Uid:number;just:string;Flags:number;holds:string[]}[]=[];
  const add=(t:number,type:number,l:number,r:number,end=0,l2=0,r2=0)=>Notes.push({Uid:Notes.length+1,just:String(t),Flags:type+r*16+r2*1024+l*65536+l2*4194304,holds:end?[String(end)]:[]});
  for(let bar=0;bar<8;bar++){
    const t=2+bar*4;
    add(t,0,4,12);add(t,0,47,55);add(t+0.5,3,18,26);add(t+1,2,34,44);
    add(t+1.5,1,4,14,t+2,20,30);add(t+2,1,20,30,t+3,42,52);
    add(t+2.5,0,4,12);add(t+3,3,22,30);add(t+3.5,2,10,20);
  }
  return parseChart({Notes,Bpms:[{Time:0,Bpm:120}],Sections:[{Time:8},{Time:16},{Time:24},{Time:32}]});
}
