import { execFileSync } from 'node:child_process';
import { cpSync, createReadStream, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream';
import type { Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig } from 'vitest/config';

const require = createRequire(import.meta.url);
const appVersion = (JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }).version;

/** Checkouts carry the commit they were built from; source tarballs simply omit it. */
function readCommit() {
  try {
    const hash = execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], { encoding: 'utf8' }).trim();
    if (!hash) return '';
    const dirty = execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8' }).trim();
    return dirty ? `${hash}-dirty` : hash;
  } catch {
    return '';
  }
}
const appCommit = readCommit();

/** 随包分发的运行时资源，许可跟随所属包。 */
const packagePublicDirs = ['@sukushow/pjsk-preview'].map((name) =>
  join(dirname(require.resolve(`${name}/package.json`)), 'public'),
);
// Only renderer assets belong to the app; package demo branding must not replace its icons.
const packagePublicRoots = ['assets', 'wasm'];

const MIME: Record<string, string> = {
  '.json': 'application/json',
  '.m4a': 'audio/mp4',
  '.mp3': 'audio/mpeg',
  '.otf': 'font/otf',
  '.png': 'image/png',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.webp': 'image/webp',
};

/** 开发时按原 URL 提供各包的 public 目录，构建时复制进产物根目录。 */
function packagePublic(dirs: string[]): Plugin {
  let outDir = '';
  let isBuild = false;
  return {
    name: 'sukushow-package-public',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
      isBuild = config.command === 'build';
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') return next();
        let path: string;
        try {
          path = decodeURIComponent((req.url ?? '').split('?')[0]);
        } catch {
          return next();
        }
        if (!packagePublicRoots.some((root) => path.startsWith(`/${root}/`))) return next();
        for (const dir of dirs) {
          const file = resolve(dir, `.${path}`);
          if (!file.startsWith(dir + sep)) continue;
          const stat = statSync(file, { throwIfNoEntry: false });
          if (!stat?.isFile()) continue;
          res.setHeader('Content-Type', MIME[extname(file).toLowerCase()] ?? 'application/octet-stream');
          // 加载进度用 HEAD 读取总大小
          res.setHeader('Content-Length', stat.size);
          if (req.method === 'HEAD') return res.end();
          pipeline(createReadStream(file), res, () => {});
          return;
        }
        next();
      });
    },
    writeBundle() {
      // Make runtime files available before the PWA plugin creates its precache manifest.
      if (!isBuild) return;
      for (const dir of dirs) {
        for (const root of packagePublicRoots) {
          cpSync(join(dir, root), join(outDir, root), { recursive: true });
        }
      }
    },
  };
}

export default defineConfig(({ command }) => ({
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
    __BUILD_COMMIT__: JSON.stringify(appCommit),
    __BUILD_TIME__: JSON.stringify(command === 'build' ? new Date().toISOString() : ''),
  },
  plugins: [
    packagePublic(packagePublicDirs),
    VitePWA({
      // 缓存策略写在 src/sw.ts：歌曲资源要按设置页的开关决定是否缓存。
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['favicon-16.png', 'favicon-32.png', 'apple-touch-icon.png', 'pwa/*.png'],
      manifest: {
        id: '/',
        name: 'sukushow · 谱面放映室',
        short_name: 'sukushow',
        description: '在浏览器中预览 LLLL 原格式谱面，提供 LLLL 舞台（3D/2D）与 PJSK 渲染两种模式，并导出视频。',
        lang: 'zh-CN',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#141416',
        theme_color: '#141416',
        icons: [
          { src: '/pwa/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/pwa/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/pwa/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      injectManifest: {
        // Precache the shell and both renderers' code, never the multi-GB song library.
        globPatterns: ['index.html', 'assets/*.{js,css,wasm}', 'wasm/*.wasm', 'song-*.json'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
      devOptions: { enabled: false },
    }),
  ],
  server: { port: 5170 },
  test: { include: ['tests/*.test.ts'] },
}));
