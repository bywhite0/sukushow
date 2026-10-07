import { cpSync, createReadStream, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

const require = createRequire(import.meta.url);

/** 随包分发的运行时资源，许可跟随所属包。 */
const packagePublicDirs = ['@sukushow/pjsk-preview'].map((name) =>
  join(dirname(require.resolve(`${name}/package.json`)), 'public'),
);

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
    closeBundle() {
      // 开发服务器关闭时也会触发此钩子，只在构建时复制
      if (!isBuild) return;
      for (const dir of dirs) cpSync(dir, outDir, { recursive: true });
    },
  };
}

export default defineConfig({
  plugins: [packagePublic(packagePublicDirs)],
  server: { port: 5170 },
  test: { include: ['tests/*.test.ts'] },
});
