# @sukushow/export

预览器共用的视频导出核心：按虚拟时钟逐帧取画面交给 WebCodecs 编码，音效事件与 BGM 用 OfflineAudioContext 离线混音，再由 Mediabunny 封装成 MP4（H.264 / AAC）或 WebM（VP9 / Opus）。许可：MIT。

各预览实现 `ExportFrameSource`：

- `begin(width, height, startSec, fps)`：固定画布尺寸并进入导出模式。需要从起点前预滚的帧源用 `startSec` / `fps` 推进到起点；能从任意时刻直接进入的帧源可以忽略这两个参数。
- `renderAt(t)`：按严格递增、步长 `1 / fps` 的时刻渲染一帧。
- `collectAudio(endSec)`：返回音效事件与混音素材。`endSec` 为视频终点，事件自带终点的帧源可以忽略。
- `end()`：退出导出模式并恢复预览；`begin` 失败或导出取消时也会调用。

导出区间由 `resolveExportRange` 规范化：各渲染器在自己的包里写死开场区间（`OpeningSpan`），包含开场时最早从开场起点导出，不包含时从开场终点起。

MP4 以 `fastStart: false`（moov 在文件末尾）边封装边写入 OPFS 临时文件，导出结束后直接以磁盘文件提供下载；音频按 `MIX_SEGMENT_SEC`（10 秒）逐段离线混音、编码。两者使内存占用不随片长增长。WebM 的封装器会等待音视频交错，仍在内存中封装；浏览器不支持 OPFS 写入时，MP4 也退回内存。`discardExportFile()` 用于清理临时文件。

```powershell
pnpm --filter @sukushow/export test
```
