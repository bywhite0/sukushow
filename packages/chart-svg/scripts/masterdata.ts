/** 读主数据目录下的 `MusicScores.yaml` 与 `Musics.yaml`；缺文件时返回空 Map（侧栏降级而不是报错）。 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseMusicScores, parseMusics, type Difficulty, type MusicInfo, type ScoreInfo } from '@sukushow/chart/masterdata';

export function loadMasterData(dir: string | undefined): {
  scores: Map<number, Record<Difficulty, ScoreInfo>>;
  musics: Map<number, MusicInfo>;
} {
  const empty = { scores: new Map<number, Record<Difficulty, ScoreInfo>>(), musics: new Map<number, MusicInfo>() };
  if (!dir || !existsSync(dir)) return empty;
  const scoresPath = join(dir, 'MusicScores.yaml');
  const musicsPath = join(dir, 'Musics.yaml');
  return {
    scores: existsSync(scoresPath) ? parseMusicScores(readFileSync(scoresPath, 'utf8')) : empty.scores,
    musics: existsSync(musicsPath) ? parseMusics(readFileSync(musicsPath, 'utf8')) : empty.musics,
  };
}
