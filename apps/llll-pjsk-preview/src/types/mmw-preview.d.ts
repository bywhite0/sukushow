// 生成的 emscripten 胶水（src/generated/mmw-preview.js）没有类型声明。
// 这里只声明我们实际用到的工厂签名，其余交给 mmwWasm.ts 内部断言。
declare module '*/mmw-preview.js' {
  interface EmscriptenModuleFactoryOptions {
    locateFile: (file: string) => string
    print?: (...args: unknown[]) => void
    printErr?: (...args: unknown[]) => void
    onAbort?: (reason: unknown) => void
  }

  const factory: (options: EmscriptenModuleFactoryOptions) => Promise<unknown>
  export default factory
}
