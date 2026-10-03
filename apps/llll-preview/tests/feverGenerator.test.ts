import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';

it.each(['正常', '缺少CSV', '非法CSV', '读取错误'] as const)('元数据生成器：%s', scenario => {
  const dir = mkdtempSync(join(tmpdir(), 'fever-'));
  const master = join(dir, 'Musics.json'), output = join(dir, 'output.json');
  try {
    writeFileSync(master, JSON.stringify([{ Id: 123, FeverSectionNo: 5, PlayTime: 60000 }]));
    writeFileSync(output, '原索引');
    if (scenario !== '缺少CSV') writeFileSync(join(dir, 'musicscore_123.csv'), scenario === '非法CSV' ? 'bad' : 'song_time,key_type\n10000,20\n20000,20\n30000,20\n40000,20\n59000,99\n');
    const result = spawnSync(process.execPath, ['--import', 'tsx', resolve('scripts/build-fever-metadata.ts'), master, scenario === '读取错误' ? master : dir, output], { encoding: 'utf8' });
    if (scenario === '非法CSV' || scenario === '读取错误') {
      expect(result.status).not.toBe(0);
      expect(readFileSync(output, 'utf8')).toBe('原索引');
      return;
    }
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(readFileSync(output, 'utf8'))).toEqual(scenario === '正常' ? { '123': { start: 40, end: 59 } } : {});
    if (scenario === '缺少CSV') expect(JSON.parse(result.stdout).missingCsv).toEqual(['123']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
