/**
 * 由 `apps/web/scripts/generate-ui-icons.mjs` 生成；图形清单与生成逻辑都在该脚本里。
 *
 * 图标来自 Lucide 1.2.146（https://lucide.dev），ISC License，共 25 个。
 * 网格 24×24，纯描边；颜色与线宽由 `icons.ts` 的包装层控制。
 */

export const iconNames = [
  'play',
  'pause',
  'skip-forward',
  'skip-back',
  'panel-left-open',
  'panel-left-close',
  'panel-right-open',
  'panel-right-close',
  'focus',
  'maximize',
  'minimize',
  'search',
  'library-big',
  'list-music',
  'settings',
  'download',
  'plus',
  'x',
  'check',
  'chevron-right',
  'chevron-down',
  'arrow-up-right',
  'palette',
  'music',
  'github',
] as const

export type IconName = (typeof iconNames)[number]

export const iconBodies: Record<IconName, string> = {
  'play': '<path d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z"/>',
  'pause': '<g><rect width="5" height="18" x="14" y="3" rx="1"/><rect width="5" height="18" x="5" y="3" rx="1"/></g>',
  'skip-forward': '<path d="M21 4v16M6.029 4.285A2 2 0 0 0 3 6v12a2 2 0 0 0 3.029 1.715l9.997-5.998a2 2 0 0 0 .003-3.432z"/>',
  'skip-back': '<path d="M17.971 4.285A2 2 0 0 1 21 6v12a2 2 0 0 1-3.029 1.715l-9.997-5.998a2 2 0 0 1-.003-3.432zM3 20V4"/>',
  'panel-left-open': '<g><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18m5-12l3 3l-3 3"/></g>',
  'panel-left-close': '<g><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18m7-6l-3-3l3-3"/></g>',
  'panel-right-open': '<g><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M15 3v18m-5-6l-3-3l3-3"/></g>',
  'panel-right-close': '<g><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M15 3v18M8 9l3 3l-3 3"/></g>',
  'focus': '<g><circle cx="12" cy="12" r="3"/><path d="M3 7V5a2 2 0 0 1 2-2h2m10 0h2a2 2 0 0 1 2 2v2m0 10v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/></g>',
  'maximize': '<path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3m8 0h3a2 2 0 0 0 2-2v-3"/>',
  'minimize': '<path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3m8 0v-3a2 2 0 0 1 2-2h3"/>',
  'search': '<g><path d="m21 21l-4.34-4.34"/><circle cx="11" cy="11" r="8"/></g>',
  'library-big': '<g><rect width="8" height="18" x="3" y="3" rx="1"/><path d="M7 3v18m13.4-2.1c.2.5-.1 1.1-.6 1.3l-1.9.7c-.5.2-1.1-.1-1.3-.6L11.1 5.1c-.2-.5.1-1.1.6-1.3l1.9-.7c.5-.2 1.1.1 1.3.6Z"/></g>',
  'list-music': '<g><path d="M16 5H3m8 7H3m8 7H3m18-3V5"/><circle cx="18" cy="16" r="3"/></g>',
  'settings': '<g><path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0a2.34 2.34 0 0 0 3.319 1.915a2.34 2.34 0 0 1 2.33 4.033a2.34 2.34 0 0 0 0 3.831a2.34 2.34 0 0 1-2.33 4.033a2.34 2.34 0 0 0-3.319 1.915a2.34 2.34 0 0 1-4.659 0a2.34 2.34 0 0 0-3.32-1.915a2.34 2.34 0 0 1-2.33-4.033a2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915"/><circle cx="12" cy="12" r="3"/></g>',
  'download': '<g><path d="M12 15V3m9 12v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10l5 5l5-5"/></g>',
  'plus': '<path d="M5 12h14m-7-7v14"/>',
  'x': '<path d="M18 6L6 18M6 6l12 12"/>',
  'check': '<path d="M20 6L9 17l-5-5"/>',
  'chevron-right': '<path d="m9 18l6-6l-6-6"/>',
  'chevron-down': '<path d="m6 9l6 6l6-6"/>',
  'arrow-up-right': '<path d="M7 7h10v10M7 17L17 7"/>',
  'palette': '<g><path d="M12 22a1 1 0 0 1 0-20a10 9 0 0 1 10 9a5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z"/><circle cx="13.5" cy="6.5" r=".5"/><circle cx="17.5" cy="10.5" r=".5"/><circle cx="6.5" cy="12.5" r=".5"/><circle cx="8.5" cy="7.5" r=".5"/></g>',
  'music': '<g><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></g>',
  'github': '<g><path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5c.08-1.25-.27-2.48-1-3.5c.28-1.15.28-2.35 0-3.5c0 0-1 0-3 1.5c-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.4 5.4 0 0 0 4 9c0 3.5 3 5.5 6 5.5c-.39.49-.68 1.05-.85 1.65S8.93 17.38 9 18v4"/><path d="M9 18c-4.51 2-5-2-7-2"/></g>',
}
