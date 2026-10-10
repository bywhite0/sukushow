import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { flushDynamicGeometry } from '../src/dynamicBuffer';

function batch() {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(60), 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(40), 2).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('tint', new THREE.BufferAttribute(new Float32Array(80), 4).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('sliceW', new THREE.BufferAttribute(new Float32Array(20), 1).setUsage(THREE.DynamicDrawUsage));
  return geometry;
}

describe('dynamic batch upload', () => {
  it('uploads only active vertex components for every attribute', () => {
    const geometry = batch();
    flushDynamicGeometry(geometry, 6);
    expect(geometry.drawRange).toEqual({ start: 0, count: 6 });
    for (const [name, components] of [['position', 18], ['uv', 12], ['tint', 24], ['sliceW', 6]] as const) {
      const attr = geometry.getAttribute(name) as THREE.BufferAttribute;
      expect(attr.updateRanges).toEqual([{ start: 0, count: components }]);
      expect(attr.version).toBe(1);
    }
    geometry.dispose();
  });

  it('leaves static attributes untouched while updating dynamic vertices', () => {
    const geometry = batch();
    const staticAttribute = new THREE.BufferAttribute(new Float32Array(40), 2);
    geometry.setAttribute('staticUV', staticAttribute);
    flushDynamicGeometry(geometry, 6);
    expect(staticAttribute.updateRanges).toEqual([]);
    expect(staticAttribute.version).toBe(0);
    geometry.dispose();
  });

  it('clears pending ranges without an upload when a batch becomes empty', () => {
    const geometry = batch();
    flushDynamicGeometry(geometry, 6);
    flushDynamicGeometry(geometry, 0);
    expect(geometry.drawRange).toEqual({ start: 0, count: 0 });
    for (const attr of Object.values(geometry.attributes) as THREE.BufferAttribute[]) {
      expect(attr.updateRanges).toEqual([]);
      expect(attr.version).toBe(1);
    }
    geometry.dispose();
  });

  it('replaces rather than accumulates ranges when a batch shrinks and reappears', () => {
    const geometry = batch();
    flushDynamicGeometry(geometry, 12);
    flushDynamicGeometry(geometry, 3);
    expect((geometry.getAttribute('position') as THREE.BufferAttribute).updateRanges).toEqual([{ start: 0, count: 9 }]);
    flushDynamicGeometry(geometry, 0);
    flushDynamicGeometry(geometry, 6);
    expect((geometry.getAttribute('position') as THREE.BufferAttribute).updateRanges).toEqual([{ start: 0, count: 18 }]);
    expect((geometry.getAttribute('position') as THREE.BufferAttribute).version).toBe(3);
    geometry.dispose();
  });
});
