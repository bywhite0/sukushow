import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { decodeChart } from '../src/chart';
import { createSlope, holdSegment } from '../src/geometry';
const directory=process.argv[2];
if(!directory)throw new Error('请指定包含 rhythmgame_chart_*.bytes 的本地目录');
const files=(await readdir(directory)).filter(x=>/^rhythmgame_chart_.*\.(bytes|json)$/.test(x));
if(!files.length)throw new Error('没有找到谱面');
let notes=0,holds=0;const errors:string[]=[];
for(const name of files){
 try{
  const c=decodeChart(await readFile(join(directory,name)));notes+=c.notes.length;
  for(const n of c.notes){
   if(n.type!==1)continue;holds++;
   for(const speed of [1,6,15])for(const mirror of [false,true]){
    const vertices=holdSegment(n,(n.time+n.end)/2,createSlope(speed),mirror);
    if(!vertices.every(Number.isFinite))throw new Error(`UID ${n.uid} 出现非有限几何`);
   }
  }
 }catch(error){errors.push(`${name}: ${String(error)}`);}
}
console.log(JSON.stringify({charts:files.length,notes,holds,errors},null,2));
if(errors.length)process.exitCode=1;
