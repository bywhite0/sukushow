import { describe, expect, it } from 'vitest'
import { parseUrlPreviewParams } from '@sukushow/pjsk-preview/lib/url'

describe('无来源启动不进入 URL 谱面分支', () => {
  it('空 URL 解析应拒绝，而不是隐式生成演示来源', () => {
    expect(() => parseUrlPreviewParams(new URL('http://localhost/'))).toThrow()
  })
})
