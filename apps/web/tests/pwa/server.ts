import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { preview } from 'vite'

/** Real production assets, with a new worker revision controlled only by the test. */
export async function startProductionServer() {
  const root = fileURLToPath(new URL('../../', import.meta.url))
  const worker = await readFile(new URL('../../dist/sw.js', import.meta.url), 'utf8')
  let release = 0
  const server = await preview({
    configFile: false,
    root,
    preview: { host: '127.0.0.1', port: 5189, strictPort: true },
    plugins: [{
      name: 'pwa-production-test-releases',
      configurePreviewServer(server) {
        server.middlewares.use((request, response, next) => {
          if (request.url === '/sw.js') {
            response.setHeader('Content-Type', 'text/javascript')
            response.setHeader('Cache-Control', 'no-store')
            // Change worker bytes without mocking browser registration or cache behavior.
            response.end(`${worker}\n// Test deployment ${release}\n`)
          } else {
            next()
          }
        })
      },
    }],
  })
  return {
    newRelease() { release++ },
    close: () => new Promise<void>((resolve, reject) => {
      server.httpServer.closeAllConnections()
      server.httpServer.close(error => error ? reject(error) : resolve())
    }),
  }
}
