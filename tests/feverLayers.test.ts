import * as THREE from 'three';
import { expect, it } from 'vitest';
import { FeverLayers } from '../src/feverLayers';

it('世界空间边线受动画遮罩控制，关闭后所有层隐藏', () => {
  const texture = new THREE.Texture();
  const layers = new FeverLayers(texture, texture, texture);
  try {
    layers.update(true, 0);
    expect(layers.group.visible).toBe(true);
    const masks = layers.group.children.filter(c => c.name.startsWith('mask')) as THREE.Mesh[];
    expect(masks).toHaveLength(2);
    expect(masks.every(m => m.scale.y === 0)).toBe(true);
    layers.update(true, 0.4);
    const move = layers.group.getObjectByName('move-left') as THREE.Mesh;
    expect(move.position.x).toBeCloseTo(-0.11599999740719795);
    expect(move.position.z).toBeCloseTo(0.5199999809265137);
    const material = move.material as THREE.Material;
    expect(material.stencilWrite).toBe(true);
    expect(material.stencilFunc).toBe(THREE.NotEqualStencilFunc);
    expect(material.stencilWriteMask).toBe(0);
    layers.update(false, 0.4);
    expect(layers.group.visible).toBe(false);
    layers.update(true, 0);
    expect(masks.every(m => m.scale.y === 0)).toBe(true);
  } finally { layers.dispose(); texture.dispose(); }
});
