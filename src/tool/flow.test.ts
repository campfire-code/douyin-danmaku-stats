import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { exportStats, loadFile, runAnalysis, toDanmaku } from './flow';
import { DEFAULT_GROUPS } from './core';

function fakeIo() {
  const written = new Map<string, Uint8Array>();
  return {
    written,
    io: {
      readFile: async (p: string) => new Uint8Array(readFileSync(p)),
      writeFile: async (p: string, d: Uint8Array) => { written.set(p, d); },
      join: async (...a: string[]) => a.join('/'),
    },
  };
}

describe('整体流程', () => {
  it('CSV：列名猜不全时需要手动映射，映射后统计并导出 Excel', async () => {
    const { io, written } = fakeIo();
    const l = await loadFile(io, 'samples/示例弹幕记录.csv');
    if (l.source !== 'table') throw new Error('应为表格');
    expect(l.map.text).toBe(-1); // 「发言」猜不出来，不编造
    expect(() => toDanmaku(l)).toThrow('弹幕内容');
    const { rows, kind } = toDanmaku(l, { time: 0, nick: 1, text: 2 });
    expect(rows).toHaveLength(58);
    const a = runAnalysis(rows, kind, DEFAULT_GROUPS, 20);
    expect(a.peak).toMatchObject({ label: '20:05', count: 12 });
    const out = await exportStats(io, a, { dir: '/out', baseName: '示例弹幕记录', mask: true });
    expect(out).toBe('/out/示例弹幕记录-弹幕统计.xlsx');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(written.get(out)!.buffer as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['概览', '关键词组', '热度曲线', '高频词', '提问弹幕']);
    expect(wb.getWorksheet('热度曲线')!.rowCount).toBe(9);
    const q = wb.getWorksheet('提问弹幕')!;
    expect(q.getRow(2).getCell(2).value).toBe('用**'); // 已脱敏
    expect(JSON.stringify(q.getSheetValues())).not.toContain('用户A');
  });
  it('关闭脱敏时导出原昵称', async () => {
    const { io, written } = fakeIo();
    const l = await loadFile(io, 'samples/示例弹幕记录.csv');
    const { rows, kind } = toDanmaku(l, { time: 0, nick: 1, text: 2 });
    const out = await exportStats(io, runAnalysis(rows, kind, DEFAULT_GROUPS, 20), { dir: '/o', baseName: 'x', mask: false });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(written.get(out)!.buffer as ArrayBuffer);
    expect(JSON.stringify(wb.getWorksheet('提问弹幕')!.getSheetValues())).toContain('用户');
  });
  it('TXT：每行「[时间] 昵称：内容」', async () => {
    const { io } = fakeIo();
    const l = await loadFile(io, 'samples/示例弹幕文本.txt');
    expect(l.source).toBe('text');
    const { rows, kind } = toDanmaku(l);
    expect(rows).toHaveLength(58);
    expect(kind).toBe('clock');
  });
  it('不支持的格式、空内容明确报错', async () => {
    const { io } = fakeIo();
    await expect(loadFile(io, 'README.md')).rejects.toThrow('不是支持的格式');
    expect(() => runAnalysis([], 'none', DEFAULT_GROUPS, 20)).toThrow('没有可统计');
  });
  it('没有时间列：仍可统计，但无热度曲线', () => {
    const a = runAnalysis([{ nick: '用户A', text: '多少钱', sec: null }], 'none', DEFAULT_GROUPS, 10);
    expect(a.curve).toEqual([]);
    expect(a.groups[0].messages).toBe(1);
  });
  it('没有大模型设置', async () => {
    const t = (await import('./index')).default;
    expect(t.needsLLM).toBeFalsy();
  });
});
