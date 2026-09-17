import * as THREE from 'three';
import type { Chart, Note } from './chart';
import { BORDER, SPAWN, Y, createSlope, edges, holdSegment, worldX, clamp } from './geometry';
const ANGLE=33.2*Math.PI/180;
const COLORS=[[1,.37,.67],[.18,.78,1],[1,.37,.67],[.33,.84,.94]];
const vertexShader=`attribute vec4 tint; varying vec4 vTint; void main(){vTint=tint;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;
const fragmentShader=`varying vec4 vTint; void main(){gl_FragColor=vTint;}`;
class Batch {
  geometry=new THREE.BufferGeometry();
  material=new THREE.ShaderMaterial({vertexShader,fragmentShader,transparent:true,depthTest:false,depthWrite:false,side:THREE.DoubleSide});
  mesh=new THREE.Mesh(this.geometry,this.material);
  private positions:Float32Array;
  private colors:Float32Array;
  private count=0;
  constructor(capacity:number,order:number){
    this.positions=new Float32Array(capacity*3);this.colors=new Float32Array(capacity*4);
    this.geometry.setAttribute('position',new THREE.BufferAttribute(this.positions,3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('tint',new THREE.BufferAttribute(this.colors,4).setUsage(THREE.DynamicDrawUsage));
    this.mesh.frustumCulled=false;this.mesh.renderOrder=order;
  }
  reset(){this.count=0;}
  triangle(points:number[],color:number[],alpha:number){
    if(this.count+3>this.positions.length/3)return;
    this.positions.set(points,this.count*3);
    for(let i=0;i<3;i++)this.colors.set([...color,alpha],(this.count+i)*4);
    this.count+=3;
  }
  ribbon(vertices:number[],active:boolean){
    const order=[0,1,2,3,2,1,2,3,4,5,4,3];
    if(this.count+12>this.positions.length/3)return;
    for(const index of order){
      this.positions.set([vertices[index*3],vertices[index*3+1],-vertices[index*3+2]],this.count*3);
      const center=index===2||index===3;
      this.colors.set(center?[46/255,198/255,1,active?.75:.2]:[45/255,248/255,1,active?.82:.6],this.count*4);this.count++;
    }
  }
  quad(x:number,y:number,z:number,w:number,h:number,color:number[],alpha=1,billboard=true){
    const dy=billboard?Math.cos(ANGLE)*h/2:0,dz=billboard?-Math.sin(ANGLE)*h/2:h/2;
    const a=[x-w/2,y-dy,-z-dz],b=[x+w/2,y-dy,-z-dz],c=[x+w/2,y+dy,-z+dz],d=[x-w/2,y+dy,-z+dz];
    this.triangle([...a,...b,...c],color,alpha);this.triangle([...a,...c,...d],color,alpha);
  }
  flush(){this.geometry.setDrawRange(0,this.count);this.geometry.attributes.position.needsUpdate=true;this.geometry.attributes.tint.needsUpdate=true;}
  dispose(){this.geometry.dispose();this.material.dispose();}
}
export class PreviewRenderer {
  readonly gl:THREE.WebGLRenderer;
  private scene=new THREE.Scene();
  private camera=new THREE.PerspectiveCamera(60,16/9,.3,1000);
  private track=new Batch(1000,0);
  private holds=new Batch(600000,1);
  private lines=new Batch(300000,2);
  private notes=new Batch(900000,3);
  private observer:ResizeObserver;
  constructor(private canvas:HTMLCanvasElement){
    this.gl=new THREE.WebGLRenderer({canvas,antialias:true,alpha:true});
    this.gl.setPixelRatio(Math.min(devicePixelRatio,2));
    this.gl.setClearColor(0x000000,0);
    // Unity +Z 朝前转换为 Three.js -Z；相机位置和俯角来自原包。
    this.camera.position.set(0,9,8.65);this.camera.rotation.x=-ANGLE;
    for(const batch of [this.track,this.holds,this.lines,this.notes])this.scene.add(batch.mesh);
    this.observer=new ResizeObserver(()=>this.resize());this.observer.observe(canvas);this.resize();
  }
  private resize(){
    const w=this.canvas.clientWidth,h=this.canvas.clientHeight;if(!w||!h)return;
    this.gl.setSize(w,h,false);this.camera.aspect=w/h;
    // 窄屏扩大垂直视角，避免两侧音符被截掉。
    this.camera.fov=this.camera.aspect<16/9?2*Math.atan(Math.tan(Math.PI/6)*(16/9)/this.camera.aspect)*180/Math.PI:60;
    this.camera.updateProjectionMatrix();
  }
  render(chart:Chart,time:number,speed:number,mirror:boolean,simultaneous:boolean){
    const slope=createSlope(speed);
    for(const batch of [this.track,this.holds,this.lines,this.notes])batch.reset();
    this.track.quad(0,Y, (SPAWN+BORDER)/2,9,SPAWN-BORDER,[.06,.11,.20],.86,false);
    for(let i=0;i<=10;i++)this.track.quad(-4.5+i*.9,Y,(SPAWN+BORDER)/2,i===0||i===10?.025:.009,SPAWN-BORDER,[.93,.37,.67],i===0||i===10?.8:.12,false);
    this.track.quad(0,Y,BORDER,11.3,.075,[1,.52,.76],1,false);
    let visible=0;
    for(const root of chart.roots){
      if(root.type!==1){visible+=this.drawNote(root,time,slope,mirror);continue;}
      let tail=root;while(tail.next)tail=tail.next;
      if(time<root.time-slope.duration||time>=tail.end)continue;
      const segments:number[][]=[];
      let segment:Note|undefined=root;
      while(segment){const v=holdSegment(segment,time,slope,mirror);if(v.length)segments.push(v);segment=segment.next;}
      if(segments.length>1)for(const i of [0,6,12])segments[0].splice(i+3,3,...segments[1].slice(i,i+3));
      for(const v of segments)this.holds.ribbon(v,time>=root.time);
      let head=root;while(head.next&&time>=head.end)head=head.next;
      const progress=clamp((time-head.time)/(head.end-head.time),0,1),[l,r]=edges(head,progress,mirror);
      this.symbol((l+r)/2,Math.max(slope.zAt(head.time-time),BORDER),r-l+1,1);visible++;
      if(tail.end-time<=slope.duration){const [tl,tr]=edges(tail,1,mirror);this.symbol((tl+tr)/2,slope.zAt(tail.end-time),tr-tl+1,1);}
    }
    if(simultaneous)for(const line of chart.lines){
      const z=slope.zAt(line.time-time);if(line.time<time||line.time-time>slope.duration)continue;
      const xs=line.points.map(p=>{const [l,r]=edges(p.note,p.tail?1:0,mirror);return worldX((l+r)/2);});
      const min=Math.min(...xs),max=Math.max(...xs);this.lines.quad((min+max)/2,Y,z,max-min,.035,[.85,.94,1],.6);
    }
    for(const batch of [this.track,this.holds,this.lines,this.notes])batch.flush();
    this.gl.render(this.scene,this.camera);
    this.canvas.dataset.visibleNotes=String(visible);this.canvas.dataset.drawCalls=String(this.gl.info.render.calls);this.canvas.dataset.time=time.toFixed(4);
  }
  private drawNote(n:Note,time:number,slope:ReturnType<typeof createSlope>,mirror:boolean){
    const remaining=n.time-time;
    if(remaining<-.18||remaining>slope.duration)return 0;
    const [l,r]=edges(n,0,mirror);
    if(remaining>=0)this.symbol((l+r)/2,slope.zAt(remaining),r-l+1,n.type);
    else this.notes.quad(worldX((l+r)/2),Y,BORDER,((r-l+1)*.15)*(1-remaining*4),.12-remaining,COLORS[n.type],1+remaining/.18);
    return 1;
  }
  private symbol(lane:number,z:number,width:number,type:number){
    const x=worldX(lane),w=((width-6)*.2+1.15)*.75,h=type===3?.22:.34,color=COLORS[type];
    this.notes.quad(x,Y,z,w,h,color,.98);
    this.notes.quad(x,Y+.035,z,w*.94,h*.18,[1,1,1],.9);
    if(type===2){this.notes.quad(x-.12,Y+.40,z,.06,.24,[1,.8,.92]);this.notes.quad(x+.12,Y+.40,z,.06,.24,[1,.8,.92]);}
    if(type===3)this.notes.quad(x,Y,z,Math.min(w,.12),h*1.6,[1,1,1],1);
  }
  dispose(){this.observer.disconnect();for(const b of [this.track,this.holds,this.lines,this.notes])b.dispose();this.gl.dispose();}
}
