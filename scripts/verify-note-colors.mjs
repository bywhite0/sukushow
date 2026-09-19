import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';

// 在真实 GPU 输出边界检查颜色、顶点染色和预乘透明度，而非检查 shader 文本。
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.goto(process.env.PREVIEW_URL || 'http://127.0.0.1:5173');
  const results = await page.evaluate(async () => {
    const THREE = await import('/node_modules/.vite/deps/three.js');
    const { loadRgLibrary, whiteTexture } = await import('/src/rgAssets.ts');
    const { spriteMaterial } = await import('/src/shaders.ts');
    const lib = await loadRgLibrary();
    if (!lib) throw new Error('音符贴图加载失败');
    const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true });
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 2);
    const results = [];
    const cases = Object.entries(lib.sprites).map(([name, map]) => ({ name, map, tint: [1, 1, 1, 1] }));
    cases.push({ name: '白色贴图与半透明顶点染色', map: whiteTexture(), tint: [0.25, 0.5, 0.75, 0.5] });
    for (const { name, map, tint } of cases) {
      const { width: w, height: h } = map.image;
      map.minFilter = map.magFilter = THREE.NearestFilter;
      map.needsUpdate = true;
      let original = map.image.data;
      if (!original) {
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(map.image, 0, 0);
        original = ctx.getImageData(0, 0, w, h).data;
      }
      renderer.setSize(w, h);
      renderer.setClearColor(0, 0);
      const geometry = new THREE.PlaneGeometry(2, 2);
      geometry.setAttribute('tint', new THREE.Float32BufferAttribute(Array(4).fill(tint).flat(), 4));
      const material = spriteMaterial(map);
      const scene = new THREE.Scene();
      scene.add(new THREE.Mesh(geometry, material));
      renderer.render(scene, camera);
      const gl = renderer.getContext();
      const pixels = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      let maxError = 0;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const a = (y * w + x) * 4;
          const b = ((h - 1 - y) * w + x) * 4;
          const alpha = original[a + 3] / 255 * tint[3];
          for (let c = 0; c < 4; c++) {
            const expected = c === 3 ? alpha * 255 : original[a + c] * tint[c] * alpha;
            maxError = Math.max(maxError, Math.abs(expected - pixels[b + c]));
          }
        }
      }
      results.push({ name, maxError });
      geometry.dispose();
      material.dispose();
      map.dispose();
    }
    renderer.dispose();
    return results;
  });
  console.table(results);
  for (const result of results) assert.ok(result.maxError <= 2, `${result.name}: 色差 ${result.maxError} 超过量化容差 2`);
} finally {
  await browser.close();
}
