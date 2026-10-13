import { describe, expect, it, vi } from 'vitest'
import { createSourceBinding, waitForSource } from '../src/sourceBinding'

describe('来源绑定队列', () => {
  it('来源失效立即结束永久网络等待', async () => {
    const controller = new AbortController()
    const pending = waitForSource(new Promise<void>(() => {}), controller.signal)
    controller.abort()
    await expect(pending).rejects.toThrow('来源已失效')
  })

  it('解析永久等待时卸载仍能释放候选资源', async () => {
    const released: number[] = []
    const binding = createSourceBinding({
      resolve: () => new Promise<null>(() => {}),
      apply: async () => {}, empty: () => {}, error: () => {},
      retain: state => () => { released.push(state.revision) },
    })
    binding.update({ revision: 1 })
    await Promise.resolve()
    await binding.dispose()
    expect(released).toEqual([1])
  })

  it('旧解析永久等待也不阻塞新来源和卸载', async () => {
    const applied: number[] = []
    const binding = createSourceBinding({
      resolve: state => state.revision === 1 ? new Promise<{ revision: number }>(() => {}) : Promise.resolve(state),
      apply: async source => { applied.push(source.revision) },
      empty: () => {}, error: () => {},
    })
    binding.update({ revision: 1 })
    await Promise.resolve()
    binding.update({ revision: 2 })
    await vi.waitFor(() => expect(applied).toEqual([2]))
    await binding.dispose()
  })

  it('解析结果 chart=null 时进入空状态而不应用谱面', async () => {
    const empty = vi.fn()
    const apply = vi.fn()
    const binding = createSourceBinding({
      resolve: async () => ({ chart: null }),
      apply, empty, error: vi.fn(),
    })
    binding.update({ revision: 1 })
    await vi.waitFor(() => expect(empty).toHaveBeenCalledTimes(1))
    expect(apply).not.toHaveBeenCalled()
    await binding.dispose()
  })

  it('新来源立即暂停，活动资源直到替换完成或卸载后才释放', async () => {
    const events: string[] = []
    const pending: (() => void)[] = []
    const binding = createSourceBinding({
      pause: () => { events.push('pause') },
      retain: state => {
        events.push(`retain:${state.revision}`)
        return () => { events.push(`release:${state.revision}`) }
      },
      resolve: async state => state,
      apply: async source => {
        events.push(`apply:${source.revision}`)
        await new Promise<void>(done => pending.push(done))
      },
      empty: () => {}, error: () => {},
    })
    binding.update({ revision: 1 })
    expect(events).toEqual(['retain:1', 'pause'])
    await vi.waitFor(() => expect(pending).toHaveLength(1))
    pending.shift()!()
    await vi.waitFor(() => expect(events).toContain('apply:1'))
    binding.update({ revision: 2 })
    expect(events.at(-1)).toBe('pause')
    await vi.waitFor(() => expect(pending).toHaveLength(1))
    expect(events).not.toContain('release:1')
    pending.shift()!()
    await vi.waitFor(() => expect(events).toContain('release:1'))
    expect(events).not.toContain('release:2')
    await binding.dispose()
    expect(events.filter(event => event.startsWith('release:'))).toEqual(['release:1', 'release:2'])
  })

  it('等待队列被覆盖会释放其租约，卸载等待在途应用结束', async () => {
    const released: number[] = []
    let finish!: () => void
    const binding = createSourceBinding({
      retain: state => () => { released.push(state.revision) },
      resolve: async state => state,
      apply: async () => { await new Promise<void>(done => { finish = done }) },
      empty: () => {}, error: () => {},
    })
    binding.update({ revision: 1 })
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    binding.update({ revision: 2 })
    binding.update({ revision: 3 })
    expect(released).toEqual([2])
    let disposed = false
    const closing = binding.dispose().then(() => { disposed = true })
    await Promise.resolve()
    expect(disposed).toBe(false)
    expect(released).toEqual([2, 3])
    finish()
    await closing
    await binding.dispose()
    expect(released).toEqual([2, 3, 1])
  })

  it('过期解析失败不显示错误，当前解析失败释放候选资源', async () => {
    const released: number[] = []
    const errors: unknown[] = []
    let fail!: (error: Error) => void
    const binding = createSourceBinding({
      retain: state => () => { released.push(state.revision) },
      resolve: async state => {
        if (state.revision === 1) return await new Promise<{ revision: number }>((_, reject) => { fail = reject })
        throw new Error('current failure')
      },
      apply: async () => {}, empty: () => {}, error: error => { errors.push(error) },
    })
    binding.update({ revision: 1 })
    await vi.waitFor(() => expect(fail).toBeTypeOf('function'))
    binding.update({ revision: 2 })
    fail(new Error('stale failure'))
    await vi.waitFor(() => expect(errors).toHaveLength(1))
    expect(String(errors[0])).toContain('current failure')
    expect(released).toEqual([1, 2])
    await binding.dispose()
  })

  it('应用部分失败时仍保留可能被播放器使用的资源，直到下一次成功替换', async () => {
    const released: number[] = []
    const completed: number[] = []
    const errors: unknown[] = []
    const binding = createSourceBinding({
      retain: state => () => { released.push(state.revision) },
      resolve: async state => state,
      apply: async source => {
        completed.push(source.revision)
        if (source.revision === 2) throw new Error('session partially applied')
      },
      empty: () => {}, error: error => { errors.push(error) },
    })
    binding.update({ revision: 1 })
    await vi.waitFor(() => expect(completed).toEqual([1]))
    binding.update({ revision: 2 })
    await vi.waitFor(() => expect(errors).toHaveLength(1))
    expect(released).toEqual([])
    binding.update({ revision: 3 })
    await vi.waitFor(() => expect(released).toEqual([1, 2]))
    await binding.dispose()
    expect(released).toEqual([1, 2, 3])
  })

  it('较旧和重复修订不会挤掉已排队的新来源', async () => {
    const applied: number[] = []
    const binding = createSourceBinding({
      resolve: async state => state,
      apply: async source => { applied.push(source.revision) },
      empty: () => {}, error: () => {},
    })
    binding.update({ revision: 2 })
    binding.update({ revision: 1 })
    binding.update({ revision: 2 })
    await vi.waitFor(() => expect(applied).toEqual([2]))
    await binding.dispose()
    binding.update({ revision: 3 })
    expect(applied).toEqual([2])
  })

  it('旧来源完成后不覆盖最新来源，应用过程不并发', async () => {
    const pending: (() => void)[] = []
    const applied: number[] = []
    const binding = createSourceBinding({
      resolve: async state => ({ revision: state.revision }),
      apply: async (source, current) => {
        await new Promise<void>(resolve => pending.push(resolve))
        if (current()) applied.push(source.revision)
      },
      empty: vi.fn(), error: vi.fn(),
    })
    binding.update({ revision: 1 })
    await vi.waitFor(() => expect(pending).toHaveLength(1))
    binding.update({ revision: 2 })
    pending.shift()!()
    await vi.waitFor(() => expect(pending).toHaveLength(1))
    pending.shift()!()
    await vi.waitFor(() => expect(applied).toEqual([2]))
    await binding.dispose()
  })
  it('后续来源更新会替换队列中的旧来源', async () => {
    const applied: number[] = []
    const binding = createSourceBinding({
      resolve: async state => ({ revision: state.revision }),
      apply: async source => { applied.push(source.revision) },
      empty: vi.fn(), error: vi.fn(),
    })
    binding.update({ revision: 1 })
    binding.update({ revision: 2 })
    await vi.waitFor(() => expect(applied).toEqual([2]))
    await binding.dispose()
  })
})
