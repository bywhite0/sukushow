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
