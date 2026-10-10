import * as THREE from 'three';

/* drawRange 只控制绘制；上传需按活跃顶点数标记每个动态属性的分量范围。 */
export function flushDynamicGeometry(geometry: THREE.BufferGeometry, vertices: number): void {
  geometry.setDrawRange(0, vertices);
  for (const attribute of Object.values(geometry.attributes) as THREE.BufferAttribute[]) {
    if (attribute.usage !== THREE.DynamicDrawUsage) continue;
    attribute.clearUpdateRanges();
    if (vertices === 0) continue;
    attribute.addUpdateRange(0, vertices * attribute.itemSize);
    attribute.needsUpdate = true;
  }
}
