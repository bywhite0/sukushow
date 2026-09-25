import { Inflate } from 'fflate';
export interface Note { uid:number; time:number; end:number; holds:number[]; type:number; l:number; r:number; l2:number; r2:number; next?:Note; prev?:Note }
export interface Line { time:number; points:{note:Note; tail:boolean}[] }
export interface Chart { notes:Note[]; roots:Note[]; lines:Line[]; bpms:{time:number;bpm:number}[]; duration:number }
const MAX_BYTES=16*1024*1024;
function object(value:unknown):Record<string,unknown> {
  if (!value || typeof value!=='object' || Array.isArray(value)) throw new Error('谱面字段必须是对象');
  return value as Record<string,unknown>;
}
export function number(value:unknown,label:string):number {
  if ((typeof value!=='number' && typeof value!=='string') || (typeof value==='string' && !value.trim())) throw new Error(`${label} 必须是数字`);
  const n=Number(value);
  if (!Number.isFinite(n)) throw new Error(`${label} 必须是有限数`);
  return n;
}
function parseNote(value:unknown):Note {
  const v=object(value), uid=number(v.Uid,'Uid'), time=number(v.just,'just'), f=number(v.Flags,'Flags');
  if (!Number.isInteger(uid)||uid<0||uid>65535||!Number.isInteger(f)||f<0||f>0xfffffff||time<0||time>86400) throw new Error('音符编号、时间或 Flags 越界');
  const type=f&15,r=(f>>>4)&63,r2=(f>>>10)&63,l=(f>>>16)&63,l2=(f>>>22)&63;
  if (type>3 || [l,r,l2,r2].some(x=>x>59) || l>r || (type===1 && l2>r2)) throw new Error('音符类型或轨道范围无效');
  if (v.holds!==undefined && !Array.isArray(v.holds)) throw new Error('holds 必须是数组');
  const holds=((v.holds??[]) as unknown[]).map(x=>number(x,'holds'));
  if (holds.some((x,i)=>x< (i?holds[i-1]:time)||x>86400)|| (type===1&&!holds.length)) throw new Error('Hold 端点不得倒序或早于起点');
  return {uid,time,end:holds.at(-1)??time,holds,type,l,r,l2,r2};
}

/** BpmMath.Get: last segment with Time <= t; before first → first (preview-safe). */
export function bpmAt(bpms: Chart['bpms'], time: number): number {
  if (!bpms.length) return 120;
  let cur = bpms[0].bpm;
  for (let i = 0; i < bpms.length; i++) {
    if (time >= bpms[i].time) cur = bpms[i].bpm;
    else break;
  }
  return cur;
}

/**
 * BpmMath.GetHolds @0x49A6164 — half-beat samples in (start, end], always ends with `end`.
 * Does not include `start` (head Just is the separate +1 in AllNoteSize).
 */
export function getHolds(start: number, end: number, bpms: Chart['bpms']): number[] {
  const out: number[] = [];
  let t = start;
  for (let guard = 0; guard < 100_000; guard++) {
    t += (60 / bpmAt(bpms, t)) * 0.5;
    if (t > end) break;
    if (Math.abs(t - end) < 1e-4) break;
    out.push(t);
    if (t >= end) break;
  }
  // (long)(|end−last| * 10000) <= 1  ⇒  |Δ| < 2e-4
  if (out.length && Math.abs(end - out[out.length - 1]) * 10_000 <= 1) out.pop();
  out.push(end);
  return out;
}

/**
 * Judgement / combo ticks for one note (Prepare Pass2 semantics, non-mutating).
 * Mid-chain units (Prev != null) contribute nothing; multi-segment heads use GetHolds(Just, tailEnd).
 * Single-segment holds keep JSON Holds. Rendering still uses original note.holds / end.
 */
export function noteJudgementTimes(note: Note, bpms: Chart['bpms']): number[] {
  if (note.prev) return [];
  if (note.type !== 1) return [note.time];
  let tail = note;
  while (tail.next) tail = tail.next;
  if (tail === note) return [note.time, ...note.holds];
  const end = tail.holds.length ? tail.holds[tail.holds.length - 1] : tail.end;
  return [note.time, ...getHolds(note.time, end, bpms)];
}

/** AllNoteSize after Prepare: Σ roots judgement ticks (== max combo). */
export function chartAllNoteSize(chart: Chart): number {
  let n = 0;
  for (const note of chart.roots) n += noteJudgementTimes(note, chart.bpms).length;
  return Math.max(1, n);
}

export function parseChart(input:unknown):Chart {
  const data=object(input);
  if (!Array.isArray(data.Notes)||!Array.isArray(data.Bpms)) throw new Error('需要 Notes 和 Bpms 数组');
  if (data.Notes.length>50000) throw new Error('谱面超过 50000 个音符');
  const notes=data.Notes.map(parseNote), ids=new Set<number>();
  for (const n of notes) { if(ids.has(n.uid)) throw new Error(`重复 Uid：${n.uid}`); ids.add(n.uid); }
  const bpms=data.Bpms.map(v=>{const b=object(v),time=number(b.Time,'BPM 时间'),bpm=number(b.Bpm,'BPM');if(Math.abs(time)>86400||bpm<=0||bpm>10000)throw new Error('BPM 无效');return {time,bpm};}).sort((a,b)=>a.time-b.time);
  // 原版谓词（ChartResolver.Prepare Pass1）在 C# float 域比较：just/holds 是 float，
  // 容差 LooseEquals 也是 0.0001f。JS 全是 double，故两边都压回 float32 再比。
  // 实测：用 double 容差会漏连 129 处（如 holds[^1]=101.8751 vs just=101.875，
  // double 域 |Δ|=1.0000000033e-4 判不中，float32 域 |Δ|=9.9182e-5 < 9.9999997e-5 判中）。
  const HOLD_LINK_EPSILON = Math.fround(0.0001);
  const starts=new Map<string,Note[]>();
  for(const n of notes) {if(n.type!==1)continue; const key=`${n.l}/${n.r}`;const bucket=starts.get(key)??[];bucket.push(n);starts.set(key,bucket);}
  for(const n of notes) {
    if(n.type!==1)continue;
    const end=Math.fround(n.end);
    const next=starts.get(`${n.l2}/${n.r2}`)?.find(x=>x.uid>n.uid&&Math.abs(Math.fround(x.time)-end)<HOLD_LINK_EPSILON);
    // 原始谱面允许汇合，Prev 仅作为非根标记，不拒绝共享后继。
    if(next){n.next=next;next.prev=n;}
  }
  const roots=notes.filter(n=>!n.prev), groups:Line[]=[];
  const add=(note:Note,tail:boolean,time:number)=>{let g=groups.find(g=>Math.abs(g.time-time)<0.004);if(!g){g={time,points:[]};groups.push(g);}g.points.push({note,tail});};
  for(const root of roots){add(root,false,root.time);if(root.type!==1)continue;let tail=root;while(tail.next)tail=tail.next;add(tail,true,tail.end);}
  const lines=groups.filter(g=>g.points.length>1&&g.points.every(p=>p.note.uid!==0));
  return {notes,roots,lines,bpms,duration:Math.max(1,...notes.map(n=>n.end+2))};
}
export function decodeChart(bytes:Uint8Array):Chart {
  if(bytes.byteLength>MAX_BYTES)throw new Error('谱面文件超过 16 MiB');
  let text=new TextDecoder().decode(bytes);
  if(!text.trimStart().startsWith('{')){
    const chunks:Uint8Array[]=[];let size=0;
    const stream=new Inflate(chunk=>{size+=chunk.length;if(size>MAX_BYTES)throw new Error('解压后的谱面超过 16 MiB');chunks.push(chunk);});
    for(let i=0;i<bytes.length;i+=1024)stream.push(bytes.subarray(i,i+1024),i+1024>=bytes.length);
    const out=new Uint8Array(size);let offset=0;for(const chunk of chunks){out.set(chunk,offset);offset+=chunk.length;}text=new TextDecoder('utf-8',{fatal:true}).decode(out);
  }
  return parseChart(JSON.parse(text.replace(/^\ufeff/,'')));
}
