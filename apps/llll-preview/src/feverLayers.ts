import * as THREE from 'three';
import { feverLineParticle } from './feverLines';
import { FEVER_EDGE_ROTATION, feverMaskGeometry, mirrorRotationToThree } from './feverMask';

/**
 * 边线各层共用 LineMask 的帧。所有位置/旋转以 **Unity 世界坐标**给出，本类统一做
 * Z 镜像（位置取 -z、旋转取 (-x,-y,z,w)）交给 Three，避免同一组数值出现两种约定。
 */
export class FeverLayers {
  readonly group = new THREE.Group();
  private masks: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>[] = [];
  private lines: { mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>; kind: 'base' | 'move'; side: 'left' | 'right' }[] = [];
  private quaternions: Record<'left' | 'right', THREE.Quaternion>;
  constructor(base: THREE.Texture, move: THREE.Texture, mask: THREE.Texture) {
    // 原始 `LineParticle` 链（WorldRoot > Fever > FeverEffectSet_001 > LineParticle）逐级均为
    // 单位变换 ⇒ 边线层位于世界原点。旧值 -5.99 来自同级的 sc2_ingeame_feverEffect_L/R_001。
    this.group.position.set(0, 0, 0);
    this.quaternions = {
      left: new THREE.Quaternion().fromArray(mirrorRotationToThree(FEVER_EDGE_ROTATION.left)),
      right: new THREE.Quaternion().fromArray(mirrorRotationToThree(FEVER_EDGE_ROTATION.right)),
    };
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
      mesh.position.set(source.position[0], source.position[1], -source.position[2]);
      mesh.quaternion.copy(this.quaternions[side]);
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
      mesh.quaternion.copy(this.quaternions[side]);
      mesh.renderOrder = kind === 'base' ? 1040 : 1041;
      mesh.frustumCulled = false;
      this.lines.push({ mesh, kind, side });
      this.group.add(mesh);
    }
  }
  update(on: boolean, elapsed: number) {
    this.group.visible = on;
    if (!on) return;
    this.masks.forEach((mesh, i) => {
      const source = feverMaskGeometry(i === 0 ? 'left' : 'right', elapsed);
      mesh.scale.fromArray(source.scale);
      mesh.position.set(source.position[0], source.position[1], -source.position[2]);
    });
    for (const { mesh, kind, side } of this.lines) {
      const state = feverLineParticle(kind, side, elapsed);
      mesh.position.set(state.position[0], state.position[1], -state.position[2]);
      mesh.scale.set(state.size[0], state.size[1], 1);
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
