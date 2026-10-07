import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';

const CSV = 'song_time,key_type\n10000,20\n20000,20\n30000,20\n40000,20\n59000,99\n';

function run(scenario: '正常' | '第一段' | '缺少CSV' | '非法CSV' | '读取错误') {
  const dir = mkdtempSync(join(tmpdir(), 'song-timing-'));
  const output = join(dir, 'output.json');
  const section = scenario === '第一段' ? 1 : 5;
  writeFileSync(join(dir, 'Musics.yaml'), `- Id: 123\n  Title: 测试\n  PlayTime: 60000\n  FeverSectionNo: ${section}\n`);
  writeFileSync(output, '原索引');
  if (scenario !== '缺少CSV') writeFileSync(join(dir, 'musicscore_123.csv'), scenario === '非法CSV' ? 'bad' : CSV);
  const plain = scenario === '读取错误' ? join(dir, 'Musics.yaml') : dir;
  const result = spawnSync(process.execPath, ['--import', 'tsx', resolve('scripts/build-song-timing.ts'), dir, plain, output], { encoding: 'utf8' });
  const written = readFileSync(output, 'utf8');
  rmSync(dir, { recursive: true, force: true });
  return { result, written };
}

it('Fever 终点取 CSV 的 MusicEnd，曲终取 PlayTime，二者互不替代', () => {
  const { result, written } = run('正常');
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(written)).toEqual({ '123': { start: 40, end: 59, chanceStart: 30, chanceEnd: 40, finishTime: 60 } });
});

it('Fever 在第一段时没有前一段，chance 为 null', () => {
  const { result, written } = run('第一段');
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(written)).toEqual({ '123': { start: 0, end: 10, chanceStart: null, chanceEnd: null, finishTime: 60 } });
});

it('缺 CSV 的曲目跳过并列出', () => {
  const { result, written } = run('缺少CSV');
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(written)).toEqual({});
  expect(JSON.parse(result.stdout).missingCsv).toEqual(['123']);
});

it.each(['非法CSV', '读取错误'] as const)('%s时失败且不改动原索引', scenario => {
  const { result, written } = run(scenario);
  expect(result.status).not.toBe(0);
  expect(written).toBe('原索引');
});
