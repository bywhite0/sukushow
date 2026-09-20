import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PREVIEW_SETTINGS,
  SETTINGS_STORAGE_KEY,
  loadPreviewSettings,
  sanitizePreviewSettings,
  savePreviewSettings,
} from '../src/settingsPersist';

describe('sanitizePreviewSettings', () => {
  it('fills defaults for junk', () => {
    expect(sanitizePreviewSettings(null)).toEqual(DEFAULT_PREVIEW_SETTINGS);
    expect(sanitizePreviewSettings({ speed: 99, musicMasteryLevel: -3, rankPreview: 'Z' }).speed).toBe(20);
    expect(sanitizePreviewSettings({ musicMasteryLevel: 99 }).musicMasteryLevel).toBe(50);
    expect(sanitizePreviewSettings({ rankPreview: 'Z' }).rankPreview).toBe('none');
  });

  it('keeps valid overrides', () => {
    const s = sanitizePreviewSettings({
      speed: 8.5,
      mirror: true,
      rankPreview: 'S',
      techScore: 2,
      musicMasteryLevel: 50,
      rate: 1.5,
    });
    expect(s.speed).toBe(8.5);
    expect(s.mirror).toBe(true);
    expect(s.rankPreview).toBe('S');
    expect(s.techScore).toBe(2);
    expect(s.rate).toBe(1.5);
  });

  it('sanitizes new option fields', () => {
    const s = sanitizePreviewSettings({
      noteStartZ: 40,
      laneWidth: 110,
      laneDarkness: 100,
      backgroundDarkness: 20,
      gridCount: 3,
      targetFPS: 1,
      judgementY: 7,
      enableFeverDisplay: false,
      volumeNoteTap: 0.5,
      hitEffect: 'off',
    });
    expect(s.noteStartZ).toBe(40);
    expect(s.laneWidth).toBe(110);
    expect(s.gridCount).toBe(3);
    expect(s.targetFPS).toBe(1);
    expect(s.enableFeverDisplay).toBe(false);
    expect(s.volumeNoteTap).toBe(0.5);
    expect(s.hitEffect).toBe('off');
    expect(DEFAULT_PREVIEW_SETTINGS.speed).toBe(5);
    expect(DEFAULT_PREVIEW_SETTINGS.hitEffect).toBe('current');
    expect(sanitizePreviewSettings({ hitEffect: 'nope' }).hitEffect).toBe('current');
    expect(sanitizePreviewSettings({ hitEffect: 'limited' }).hitEffect).toBe('limited');
    expect(sanitizePreviewSettings({ hitEffect: 'full' }).hitEffect).toBe('full');
    expect(sanitizePreviewSettings({ feverSectionNo: 5 })).not.toHaveProperty('feverSectionNo');
  });
});

describe('load/savePreviewSettings', () => {
  it('round-trips through a fake Storage', () => {
    const bag = new Map<string, string>();
    const storage = {
      getItem: (k: string) => bag.get(k) ?? null,
      setItem: (k: string, v: string) => { bag.set(k, v); },
    };
    savePreviewSettings({ ...DEFAULT_PREVIEW_SETTINGS, speed: 7, enablePerfectPlus: true }, storage);
    expect(bag.has(SETTINGS_STORAGE_KEY)).toBe(true);
    const loaded = loadPreviewSettings(storage);
    expect(loaded.speed).toBe(7);
    expect(loaded.enablePerfectPlus).toBe(true);
  });
});
