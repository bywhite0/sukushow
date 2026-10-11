import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const dir = mkdtempSync(path.join(tmpdir(), 'fever-animation-'))
const emcc = process.env.EMCC ?? (process.env.EMSDK
  ? path.join(process.env.EMSDK, 'upstream/emscripten/emcc')
  : 'C:/emsdk/upstream/emscripten/emcc.exe')
try {
  const output = path.join(dir, 'test.cjs')
  execFileSync(emcc, [path.join(root, 'tests/feverAnimation.cpp'),
    `-I${path.join(root, 'native/include')}`, '-std=c++20', '-sDEFAULT_TO_CXX=1', '-o', output], { stdio: 'inherit' })
  execFileSync(process.execPath, [output], { stdio: 'inherit' })
} finally {
  rmSync(dir, { recursive: true, force: true })
}
