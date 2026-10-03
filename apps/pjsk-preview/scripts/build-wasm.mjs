/**
 * 编译 PJSK 渲染 wasm（PJSK 实现）。
 *
 * 与上游 sekai-mmw-preview-web 的差异：
 *   - 砍掉 Sekai-SUS-Parser 的 sus2json wasm 编译（本项目谱面用自家 llll 解析，
 *     不经过 SUS；且本仓不含该源码树）。
 *   - 其余编译参数与上游一致，保证渲染行为可比对。
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import crypto from 'node:crypto'

const projectRoot = path.resolve(import.meta.dirname, '..')
const generatedDir = path.join(projectRoot, 'src/generated')
const publicWasmDir = path.resolve(projectRoot, '../web/public/wasm')
const wasmManifestFile = path.join(generatedDir, 'mmwWasmAsset.ts')

// emcc 解析：优先环境变量，其次 emsdk 默认位置。
// 不依赖 PATH——Hermes 的 terminal 每次调用是独立 shell，`source emsdk_env.sh` 不跨调用持久。
function resolveEmcc() {
  const candidates = [
    process.env.EMCC,
    process.env.EMSDK && path.join(process.env.EMSDK, 'upstream/emscripten/emcc'),
    'C:/emsdk/upstream/emscripten/emcc',
  ].filter(Boolean)
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) || fs.existsSync(`${candidate}.exe`)) {
      return candidate
    }
  }
  return null
}

const emcc = resolveEmcc()
if (!emcc) {
  throw new Error(
    '未找到 `emcc`。请设置 EMCC 环境变量，或把 emsdk 装在 C:/emsdk。',
  )
}

fs.mkdirSync(generatedDir, { recursive: true })
fs.mkdirSync(publicWasmDir, { recursive: true })

const outputFile = path.join(generatedDir, 'mmw-preview.js')
const sourceFiles = [
  path.join(projectRoot, 'native/src/mmw_preview.cpp'),
  path.join(projectRoot, 'native/src/mmw_overlay_player.cpp'),
  path.join(projectRoot, 'native/mmw_port/Math.cpp'),
  path.join(projectRoot, 'native/mmw_port/MinMax.cpp'),
  path.join(projectRoot, 'native/mmw_port/Utilities.cpp'),
  path.join(projectRoot, 'native/mmw_port/Tempo.cpp'),
  path.join(projectRoot, 'native/mmw_port/Score.cpp'),
  path.join(projectRoot, 'native/mmw_port/Note.cpp'),
  path.join(projectRoot, 'native/mmw_port/Particle.cpp'),
  path.join(projectRoot, 'native/mmw_port/EffectView.cpp'),
  path.join(projectRoot, 'native/mmw_port/ResourceManager.cpp'),
  path.join(projectRoot, 'native/mmw_port/Rendering/Camera.cpp'),
  path.join(projectRoot, 'native/vendor/imgui/imgui.cpp'),
  path.join(projectRoot, 'native/vendor/imgui/imgui_draw.cpp'),
  path.join(projectRoot, 'native/vendor/imgui/imgui_tables.cpp'),
  path.join(projectRoot, 'native/vendor/imgui/imgui_widgets.cpp'),
  path.join(projectRoot, 'native/vendor/imgui/imgui_impl_opengl3.cpp'),
]

execFileSync(
  emcc,
  [
    ...sourceFiles,
    '-std=c++20',
    '-O3',
    '-fexceptions',
    '-D_XM_NO_INTRINSICS_=1',
    '-I',
    path.join(projectRoot, 'native/include'),
    '-I',
    path.join(projectRoot, 'native/generated'),
    '-I',
    path.join(projectRoot, 'native/vendor'),
    '-I',
    path.join(projectRoot, 'native/vendor/imgui'),
    '-I',
    path.join(projectRoot, 'native/vendor/DirectXMath/Inc'),
    '-DIMGUI_IMPL_OPENGL_ES3',
    '-s',
    'WASM=1',
    '-s',
    'ASYNCIFY=1',
    '-s',
    'MODULARIZE=1',
    '-s',
    'EXPORT_ES6=1',
    '-s',
    'ENVIRONMENT=web',
    '-s',
    'FILESYSTEM=1',
    '-s',
    'USE_WEBGL2=1',
    '-s',
    'MIN_WEBGL_VERSION=2',
    '-s',
    'MAX_WEBGL_VERSION=2',
    '-s',
    'FULL_ES3=1',
    '-s',
    'ALLOW_MEMORY_GROWTH=1',
    '-s',
    'INITIAL_MEMORY=268435456',
    '-s',
    'MAXIMUM_MEMORY=1073741824',
    '-s',
    'STACK_SIZE=1048576',
    '-s',
    'NO_EXIT_RUNTIME=1',
    '-s',
    'DISABLE_EXCEPTION_CATCHING=0',
    '-s',
    'ASSERTIONS=2',
    '-s',
    'STACK_OVERFLOW_CHECK=2',
    '-s',
    "EXPORTED_RUNTIME_METHODS=['ccall','cwrap','UTF8ToString','HEAPF32','HEAP32','HEAPU8']",
    '-s',
    "EXPORTED_FUNCTIONS=['_malloc','_free']",
    // 链接 libc++：emcc 默认按 C 链接，C++ 的 new/delete 等符号会未定义。
    // 上游用 em++ 隐式处理；这里显式加开关，保持继续用 emcc。
    '-s',
    'DEFAULT_TO_CXX=1',
    '-o',
    outputFile,
  ],
  {
    cwd: projectRoot,
    stdio: 'inherit',
  },
)

// 上游对 emscripten 生成代码的三处补丁（MainLoop 未定义时的保护）。
const generatedJs = fs.readFileSync(outputFile, 'utf8')
const patchedJs = generatedJs
  .replaceAll(
    'var registerPreMainLoop=f=>{typeof MainLoop!="undefined"&&MainLoop.preMainLoop.push(f)};',
    'var registerPreMainLoop=f=>{typeof MainLoop!="undefined"&&MainLoop&&MainLoop.preMainLoop&&MainLoop.preMainLoop.push(f)};',
  )
  .replace(/typeof MainLoop!="undefined"&&MainLoop\.func/g, 'typeof MainLoop!="undefined"&&MainLoop&&MainLoop.func')
  .replace(/typeof MainLoop<"u"&&MainLoop\.func/g, 'typeof MainLoop<"u"&&MainLoop&&MainLoop.func')

if (patchedJs !== generatedJs) {
  fs.writeFileSync(outputFile, patchedJs)
}

const wasmBuffer = fs.readFileSync(path.join(generatedDir, 'mmw-preview.wasm'))
const wasmHash = crypto.createHash('sha256').update(wasmBuffer).digest('hex').slice(0, 12)
const hashedWasmName = `mmw-preview.${wasmHash}.wasm`

for (const file of fs.readdirSync(publicWasmDir)) {
  if (/^mmw-preview\.[0-9a-f]{12}\.wasm$/.test(file)) {
    fs.rmSync(path.join(publicWasmDir, file), { force: true })
  }
}

fs.copyFileSync(path.join(generatedDir, 'mmw-preview.wasm'), path.join(publicWasmDir, hashedWasmName))

fs.writeFileSync(
  wasmManifestFile,
  `export const mmwWasmFilename = '${hashedWasmName}'\nexport const mmwWasmHash = '${wasmHash}'\n`,
)

console.log(`\n✓ wasm 编译完成: ${hashedWasmName}`)
