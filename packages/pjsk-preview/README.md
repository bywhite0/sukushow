# @sukushow/pjsk-preview

用 PJSK 渲染管线预览 LLLL 谱面：C++ 预览引擎编译为 WASM，LLLL 原格式谱面转换为 MusicScore 后交给引擎渲染，并提供视频导出。

许可：AGPL-3.0-only，见 [LICENSE](LICENSE)。本包基于 [sekai-mmw-preview-web](https://github.com/watagashi-uni/sekai-mmw-preview-web) 改造，上游来源的代码与素材见 [THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md)。

| 目录 | 内容 |
| --- | --- |
| `native/` | C++ 预览引擎与第三方库 |
| `src/lib/` | WASM 播放器封装、音频与 overlay 辅助模块、URL 参数解析 |
| `src/llll/` | LLLL 谱面解析、MusicScore 转换、Fever 与曲目资源 |
| `src/export/` | 视频导出 |
| `public/` | PJSK 素材、图标与 wasm，由 `apps/web` 按原 URL 提供 |

```powershell
pnpm --filter @sukushow/pjsk-preview build:wasm   # 需要 Emscripten：设置 EMCC 或 EMSDK 环境变量
pnpm --filter @sukushow/pjsk-preview test
```

本包依赖 `@sukushow/llll-preview`（MIT）；MIT 包不依赖本包。
