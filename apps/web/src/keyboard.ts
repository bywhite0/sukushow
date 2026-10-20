/**
 * 页面快捷键的焦点判定。
 *
 * 快捷键挂在 document 上，但焦点可能停在某个控件上：文本框、下拉框要自己消费按键，
 * 对话框与曲库 / 版本浮层打开时按键属于浮层。
 *
 * 剩下的按钮还要再分一次：鼠标点过的按钮会一直留着焦点，此时 Space 仍应回到页面快捷键
 * （播放 / 暂停），否则「点一下按钮再按空格」会再点一次那个按钮；只有键盘（Tab、方向键）
 * 聚焦的控件才保留原生 Space 激活，键盘用户不会因此失去按钮操作。
 *
 * 不能用 `:focus-visible` 判断：Chrome 在 Space 的 keydown 派发前就把焦点控件标成
 * `:focus-visible`，那时已经看不出焦点是点来的还是按 Tab 来的。所以按事件顺序自己记。
 */

/** 焦点是否来自鼠标：指针按下后的焦点（包括点击回调里主动 focus 的控件）都算鼠标焦点。 */
let pointerFocus = false
let pointerDown = false

/** 页面启动时调用一次，记录焦点来源。 */
export function initKeyboardFocus(): void {
  document.addEventListener('pointerdown', event => {
    pointerDown = true
    // 点中的正是当前焦点控件时不会再触发 focusin，这里直接记为鼠标焦点。
    const active = document.activeElement
    if (active instanceof HTMLElement && active !== document.body && active.contains(event.target as Node)) {
      pointerFocus = true
    }
  }, true)
  // click 与点击回调里的 focus() 都在 pointerup 之后同步发生：等这一轮点击处理完再清标记。
  document.addEventListener('click', () => { pointerDown = false })
  // 没有 click 收尾的拖拽用计时器兜底。
  document.addEventListener('pointerup', () => { setTimeout(() => { pointerDown = false }, 0) }, true)
  document.addEventListener('focusin', () => { pointerFocus = pointerDown }, true)
}

/** Space 是否由当前焦点控件自己消费。 */
export function controlOwnsSpace(target: EventTarget | null): boolean {
  const element = target instanceof HTMLElement ? target : null
  if (!element) return false
  // 对话框与浮层面板打开时，按键属于它们自己。
  if (element.closest('dialog, [popover]')) return true
  // 文本框、下拉框与可编辑内容：Space 是输入或展开。
  if (element.closest('textarea, select, [contenteditable]:not([contenteditable="false"])')) return true
  const input = element.closest<HTMLInputElement>('input')
  // 滑块没有原生 Space 行为：焦点留在进度条上时把 Space 还给播放快捷键。
  if (input) return input.type !== 'range'
  const control = element.closest<HTMLElement>(
    'button, a[href], summary, [role="button"], [role="radio"], [role="menuitemradio"], [tabindex]:not([tabindex="-1"])',
  )
  return control !== null && !pointerFocus
}

/** 鼠标点过的控件把 Space 让给页面后，焦点也还给页面：不再冒焦点框，下一次 Space 仍归页面。 */
export function releaseSpaceFocus(): void {
  const active = document.activeElement
  if (active instanceof HTMLElement && active !== document.body) active.blur()
}
