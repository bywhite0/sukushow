/** Values are injected by Vite; the fallbacks keep plain module imports working. */
export const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.2.0'
export const BUILD_COMMIT = typeof __BUILD_COMMIT__ === 'string' ? __BUILD_COMMIT__ : ''
export const BUILD_TIME = typeof __BUILD_TIME__ === 'string' ? __BUILD_TIME__ : ''

/** Keep the version readable when a source tarball has no commit to show. */
export function formatVersion(version: string, commit: string) {
  return commit ? `v${version} · ${commit}` : `v${version}`
}

/** Build timestamps are stored as ISO strings and shown in the viewer's local time. */
export function formatBuildTime(value: string) {
  if (!value) return '开发模式'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}
