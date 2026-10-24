// 生成 samples/ 里的示例文件（只在设置了 MAKE_SAMPLES=1 时运行）
import { it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { sampleTable, sampleText } from './samples';

it.runIf(process.env.MAKE_SAMPLES === '1')('生成示例文件', () => {
  mkdirSync('samples', { recursive: true });
  const t = sampleTable();
  const csv = [t.header, ...t.rows].map((r) => r.join(',')).join('\n') + '\n';
  writeFileSync('samples/示例弹幕记录.csv', '﻿' + csv);
  writeFileSync('samples/示例弹幕文本.txt', sampleText() + '\n');
});
