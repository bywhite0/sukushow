/**
 * 游玩键位编辑器（预览设置面板）：分区数、每个分区的键、Air 键、同按合并窗口。
 *
 * 点一个键位按钮进入录入，下一次按键即绑定（Esc 取消，焦点离开也取消）；被占用的键与当前键互换。
 * 录入期间在 window 捕获阶段截下按键并停止传播，游玩输入与页面快捷键都收不到这一下。
 * 布局规则（等分、补位、互换、可绑定的键）都在 `playKeys.ts`，这里只管 DOM。样式在 `llll.css` 的 `.play-keys`。
 */
import {
  DEFAULT_PLAY_KEY_LAYOUT, PLAY_CHORD_MS_MAX, PLAY_ZONES_MAX, PLAY_ZONES_MIN, assignKey, keyLabel, resizeLayout, zoneSpan,
  type PlayKeyLayout, type PlayKeySlot,
} from './playKeys';

export interface PlayKeysEditor {
  readonly element: HTMLElement;
  /** 当前布局；赋值只刷新界面，不触发 `onChange`。 */
  value: PlayKeyLayout;
}

export interface PlayKeysEditorOptions {
  onChange: (layout: PlayKeyLayout) => void;
  /** 状态提示（录入失败等）。 */
  onMessage?: (text: string, error: boolean) => void;
}

const lanes = (index: number, count: number) => {
  const [l, r] = zoneSpan(index, count);
  return `${Math.ceil(l)}–${Math.floor(r)}`;
};

export function createPlayKeysEditor(opts: PlayKeysEditorOptions): PlayKeysEditor {
  let layout = DEFAULT_PLAY_KEY_LAYOUT;
  let capturing: { slot: PlayKeySlot; button: HTMLButtonElement } | null = null;

  const root = document.createElement('div');
  root.className = 'play-keys';
  root.innerHTML = `
<label class="setting" for="play-zones"><span>游玩键位分区 <small>60 轨等分</small></span><input id="play-zones" type="number" min="${PLAY_ZONES_MIN}" max="${PLAY_ZONES_MAX}" step="1"><small>每个分区绑一个键，按下即触碰整个分区。</small></label>
<div class="play-keys-zones" role="group" aria-label="分区按键，从左到右" data-play-zone-keys></div>
<div class="play-keys-air"><span>Air 键 <small>抬手上滑</small></span><button type="button" class="play-key" data-play-air></button><button type="button" class="quiet" data-play-air-clear>不用 Air</button></div>
<label class="setting" for="play-chord"><span>同按合并 <small>毫秒</small></span><input id="play-chord" type="number" min="0" max="${PLAY_CHORD_MS_MAX}" step="1"><small>窗口内一起按下的相邻分区键算同一只手，只按一个音符（同时押除外）；0 为不合并。</small></label>
<p class="play-settings-hint">点键位后按下新键，Esc 取消，已占用的键会互换。Flick 起手后 0.075 秒内按 Air 键完成上滑，否则判 Good；不用 Air 时键盘 Flick 起手即完成。鼠标与触摸直接在画面上点按、划动。</p>
<button type="button" class="quiet play-keys-reset" data-play-keys-reset>恢复默认键位</button>`;
  const zonesInput = root.querySelector<HTMLInputElement>('#play-zones')!;
  const zoneKeys = root.querySelector<HTMLElement>('[data-play-zone-keys]')!;
  const airButton = root.querySelector<HTMLButtonElement>('[data-play-air]')!;
  const airClear = root.querySelector<HTMLButtonElement>('[data-play-air-clear]')!;
  const chordInput = root.querySelector<HTMLInputElement>('#play-chord')!;

  const keyButton = (button: HTMLButtonElement, code: string | null, name: string) => {
    button.textContent = code === null ? '未设' : keyLabel(code);
    button.setAttribute('aria-label', `${name}：${code === null ? '未设置' : keyLabel(code)}。点击后按下新键`);
    button.setAttribute('aria-pressed', 'false');
  };

  const render = () => {
    const count = layout.zones.length;
    zonesInput.value = String(count);
    chordInput.value = String(layout.chordMs);
    // 分区数不变时原地更新：录入中点别的键位会先失焦（结束录入并重绘），换掉按钮实例会吞掉这次点击。
    if (zoneKeys.children.length !== count) {
      zoneKeys.replaceChildren(...layout.zones.map((_, index) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'play-key';
        button.dataset.playZone = String(index);
        return button;
      }));
    }
    layout.zones.forEach((code, index) => {
      keyButton(zoneKeys.children[index] as HTMLButtonElement, code, `分区 ${index + 1}（轨 ${lanes(index, count)}）`);
    });
    keyButton(airButton, layout.air, 'Air 键');
    airClear.disabled = layout.air === null;
  };

  const commit = (next: PlayKeyLayout) => {
    if (next === layout) return;
    layout = next;
    render();
    opts.onChange(layout);
  };

  const stopCapture = () => {
    if (!capturing) return;
    window.removeEventListener('keydown', onCaptureKey, true);
    capturing.button.removeEventListener('blur', stopCapture);
    capturing = null;
    render();
  };

  const slotButton = (slot: PlayKeySlot) =>
    slot === 'air' ? airButton : zoneKeys.querySelector<HTMLButtonElement>(`[data-play-zone="${slot}"]`);

  const onCaptureKey = (event: KeyboardEvent) => {
    if (!capturing) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.repeat) return;
    if (event.code === 'Escape') { stopCapture(); return; }
    const result = assignKey(layout, capturing.slot, event.code);
    if ('error' in result) {
      opts.onMessage?.(result.error, true);
      return;
    }
    stopCapture();
    commit(result.layout);
  };

  const startCapture = (slot: PlayKeySlot) => {
    stopCapture();
    const target = slotButton(slot);
    if (!target) return;
    capturing = { slot, button: target };
    // 键位格很窄：格内只放省略号，完整提示给读屏。
    target.textContent = '…';
    target.setAttribute('aria-label', `${slot === 'air' ? 'Air 键' : `分区 ${slot + 1}`}：等待按键，Esc 取消`);
    target.setAttribute('aria-pressed', 'true');
    window.addEventListener('keydown', onCaptureKey, true);
    target.addEventListener('blur', stopCapture);
    if (document.activeElement !== target) target.focus();
  };

  zoneKeys.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-play-zone]');
    if (button) startCapture(Number(button.dataset.playZone));
  });
  airButton.addEventListener('click', () => startCapture('air'));
  airClear.addEventListener('click', () => commit({ ...layout, air: null }));
  zonesInput.addEventListener('change', () => {
    const count = Number(zonesInput.value);
    if (!zonesInput.checkValidity() || !Number.isInteger(count)) {
      opts.onMessage?.(`分区数需是 ${PLAY_ZONES_MIN} 至 ${PLAY_ZONES_MAX} 的整数。`, true);
      zonesInput.value = String(layout.zones.length);
      return;
    }
    commit(resizeLayout(layout, count));
  });
  chordInput.addEventListener('change', () => {
    const ms = Number(chordInput.value);
    if (!chordInput.value || !chordInput.checkValidity() || !Number.isInteger(ms)) {
      opts.onMessage?.(`同按合并需是 0 至 ${PLAY_CHORD_MS_MAX} 的整数毫秒。`, true);
      chordInput.value = String(layout.chordMs);
      return;
    }
    commit({ ...layout, chordMs: ms });
  });
  root.querySelector<HTMLButtonElement>('[data-play-keys-reset]')!.addEventListener('click', () => {
    stopCapture();
    commit(DEFAULT_PLAY_KEY_LAYOUT);
  });

  render();
  return {
    element: root,
    get value() { return layout; },
    set value(next: PlayKeyLayout) {
      stopCapture();
      layout = next;
      render();
    },
  };
}
