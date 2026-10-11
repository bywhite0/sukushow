# @sukushow/pjsk-preview

用 PJSK 渲染管线预览 LLLL 谱面：C++ 预览引擎编译为 WASM（含逐帧导出入口与音效事件记录），LLLL 原格式谱面转换为 MusicScore 后交给引擎渲染。视频编码与封装由 `packages/export` 完成。

许可：AGPL-3.0-only，见 [LICENSE](LICENSE)。本包基于 [sekai-mmw-preview-web](https://github.com/watagashi-uni/sekai-mmw-preview-web) 改造，上游来源的代码与素材见 [THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md)。

| 目录 | 内容 |
| --- | --- |
| `native/` | C++ 预览引擎与第三方库 |
| `src/lib/` | WASM 播放器封装、音频与 overlay 辅助模块、URL 参数解析 |
| `src/llll/` | LLLL 谱面解析、MusicScore 转换、Fever 与曲目资源 |
| `src/opening.ts` | 导出时间轴上写死的开场卡片区间 |
| `public/` | PJSK 素材、图标与 wasm，由 `apps/web` 按原 URL 提供 |

```powershell
pnpm --filter @sukushow/pjsk-preview build:wasm   # 需要 Emscripten：设置 EMCC 或 EMSDK 环境变量
pnpm --filter @sukushow/pjsk-preview test
pnpm --filter @sukushow/pjsk-preview test:fever-native # 编译并执行实际 C++ 曲线采样测试
```

Fever 入场文字读取 `native/generated/fever_animation_*.h` 中的原包 StreamedClip 三次多项式，
同时使用 Prefab 的父级变换、Sprite PPU 和 atlas rect。现有特效配置 `effectProfile` 同时选择
Fever Bundle：0 包含 `over_L/R` 光束，1 不包含。充能动画起点取谱面跨过 70% 的时刻，
不依赖首次绘制，支持直接 seek。边框覆盖当前视口而不是使用 Prefab 的编辑器默认尺寸。

生成数据：使用 AssetStudio 导出的 Clip（含 `coefficients`）与对象 JSON，运行
`python scripts/generate-fever-animation.py <clips.json> <objects.json> [0]`；省略最后参数生成 1，
传入 0 生成 0。对象 path ID 必须保持 64 位整数，不能经过 JavaScript Number。
浏览器回归：`pnpm --filter @sukushow/web exec playwright test pjskFever.spec.ts`。

边框移植客户端 `Sekai/RhythmGame/Fever-Frame` 的屏幕 UV 旋转渐变公式，使用谱面时钟驱动。
阈值指针直接提取自客户端 APK 的 `text_lineFever` / `text_lineSuperFever`，采用 `FeverView`
的根节点位置及 Sprite PPU，不再用缺少来源的旧 PNG。
充能条使用原包网格、108 PPU 投影和两段填充（普通阈值占 0.882，满值为 1）。
色条按 Fever-Lane 的横截面 UV 与 `_Value` 裁剪，不添加占位底色、软边遮罩或呼吸光。
闪光起点独立取严格超过 70% 的音符时间；SuperFever 色条读取原包 1.5 秒 MaterialST 曲线。
预览仍以谱面音符计数映射 70%/100% 阈值，未模拟多人判定与客户端逐帧进度平滑。
尚未完整还原：Profile 0 粒子系统；闪光的排序范围及进度裁剪仍需逐项核验。
当前入场曲线验证不代表以上部分已完成原包对齐。

2D MV 复用 LLLL 的资源索引与静音视频走带，视频帧直接上传 WebGL 纹理，实时预览和逐帧导出共用渲染路径。
MV 成功加载后，片段外及等待 seek 时保持黑底，不恢复原背景；完整等比显示，不叠加背景亮度层。
关闭 MV 或初次加载失败时恢复曲绘背景。曲终 AP 取主数据 FinishTime 与实际 BGM 终点的较晚者，
未知曲目不估算 AP；总时长包含谱面、MV 尾段及已知曲目的 AP 动画，并计入 PJSK 开场偏移。
回归：`pnpm --filter @sukushow/web exec playwright test pjskMv.spec.ts pjskTiming.spec.ts`。

本包依赖 `@sukushow/export` 与 `@sukushow/llll-preview`（均为 MIT）；MIT 包不依赖本包。
