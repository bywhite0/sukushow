import * as THREE from 'three';
import { feverLineParticle } from './feverLines';
import { feverMaskGeometry } from './feverMask';

export class FeverLayers {
  readonly group = new THREE.Group();
  private masks: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>[] = [];
  private lines: { mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>; kind: 'base' | 'move'; side: 'left' | 'right' }[] = [];
  constructor(base: THREE.Texture, move: THREE.Texture, mask: THREE.Texture) {
    this.group.position.set(0, 0, -5.99);
    for (const side of ['left', 'right'] as const) {
      const source = feverMaskGeometry(side, 0);
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(source.positions, 3));
      geometry.setAttribute('uv', new THREE.Float32BufferAttribute(source.positions.flatMap((_, i, a) =>
        i % 3 === 0 ? [(a[i] + 0.53) / 1.06, (a[i + 1] + 0.395) / 0.79] : []), 2));
      geometry.setIndex(source.indices);
      const material = new THREE.MeshBasicMaterial({
        map: mask, alphaTest: 1 / 255, side: THREE.DoubleSide, colorWrite: false,
        depthWrite: false, depthTest: false, stencilWrite: true,
        stencilRef: 1, stencilFunc: THREE.AlwaysStencilFunc, stencilZPass: THREE.ReplaceStencilOp,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = `mask-${side}`;
      mesh.quaternion.fromArray(source.rotation);
      mesh.renderOrder = 1039;
      mesh.frustumCulled = false;
      this.masks.push(mesh);
      this.group.add(mesh);
      for (const kind of ['base', 'move'] as const) this.addLine(kind, side, kind === 'base' ? base : move);
    }
    this.group.visible = false;
  }
  private addLine(kind: 'base' | 'move', side: 'left' | 'right', map: THREE.Texture) {
    const count = kind === 'base' ? 2 : 1;
    for (let i = 0; i < count; i++) {
      const material = new THREE.MeshBasicMaterial({
        map, transparent: true, blending: THREE.AdditiveBlending,
        depthWrite: false, depthTest: false, side: THREE.DoubleSide, toneMapped: false,
        stencilWrite: true, stencilWriteMask: 0, stencilRef: 0,
        stencilFunc: THREE.NotEqualStencilFunc,
      });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
      mesh.name = `${kind}-${side}${i ? `-${i}` : ''}`;
      mesh.renderOrder = kind === 'base' ? 1040 : 1041;
      mesh.frustumCulled = false;
      this.lines.push({ mesh, kind, side });
      this.group.add(mesh);
    }
  }
  update(on: boolean, elapsed: number) {
    this.group.visible = on;
    if (!on) return;
    this.masks.forEach((mesh, i) => mesh.scale.fromArray(feverMaskGeometry(i === 0 ? 'left' : 'right', elapsed).scale));
    for (const { mesh, kind, side } of this.lines) {
      const state = feverLineParticle(kind, side, elapsed);
      mesh.position.set(state.position[0], state.position[1], state.position[2]);
      mesh.scale.set(state.size[0], state.size[1], 1);
      const [x, y, z] = state.rotation;
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z, 'ZXY'));
      mesh.quaternion.set(-q.x, -q.y, q.z, q.w);
      mesh.material.color.setRGB(state.color[0], state.color[1], state.color[2], THREE.LinearSRGBColorSpace);
      mesh.material.opacity = state.color[3];
    }
  }
  dispose() {
    for (const mesh of [...this.masks, ...this.lines.map(l => l.mesh)]) {
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    this.group.clear();
  }
}
