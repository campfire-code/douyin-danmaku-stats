// 流程：读文件 → 列映射 → 统计 → 导出。只经过传入的读写函数访问文件，便于测试。
import type { RunContext } from '../kit/types';
import { analyze, fromTable, guessColumns, parseGroups, parseText, type Analysis, type Cell, type ColumnMap, type Danmaku, type TimeKind } from './core';
import { decodeText, readTable, writeStatsXlsx } from './xlsx';

export type Io = Pick<RunContext, 'readFile' | 'writeFile' | 'join'>;

export type Loaded =
  | { source: 'table'; name: string; path: string; header: string[]; rows: Cell[][]; map: ColumnMap }
  | { source: 'text'; name: string; path: string; rows: Danmaku[]; kind: TimeKind };

export async function loadFile(io: Pick<RunContext, 'readFile'>, path: string): Promise<Loaded> {
  const name = path.split(/[\\/]/).pop() || path;
  const bytes = await io.readFile(path);
  if (/\.txt$/i.test(name)) {
    const { rows, kind } = parseText(decodeText(bytes));
    if (!rows.length) throw new Error(`「${name}」里没有读到弹幕，每行应写成「昵称：内容」`);
    return { source: 'text', name, path, rows, kind };
  }
  if (!/\.(csv|xlsx)$/i.test(name)) throw new Error(`「${name}」不是支持的格式，请用 .csv、.xlsx 或 .txt`);
  const { header, rows } = await readTable(bytes, name);
  if (!rows.length) throw new Error('表格里只有表头，没有数据行');
  return { source: 'table', name, path, header, rows, map: guessColumns(header) };
}

/** 把已读入的内容（表格需带列映射）变成弹幕记录 */
export function toDanmaku(l: Loaded, map?: ColumnMap): { rows: Danmaku[]; kind: TimeKind; badTime: number } {
  if (l.source === 'text') return { rows: l.rows, kind: l.kind, badTime: 0 };
  return fromTable(l.rows, map ?? l.map);
}

export function runAnalysis(rows: Danmaku[], kind: TimeKind, groupsSrc: string, topN: number): Analysis {
  if (!rows.length) throw new Error('没有可统计的弹幕');
  return analyze(rows, kind, parseGroups(groupsSrc), topN);
}

/** 导出到原文件所在文件夹（粘贴文本无原文件时由调用方给出文件夹） */
export async function exportStats(io: Io, a: Analysis, opt: { dir: string; baseName: string; mask: boolean }): Promise<string> {
  const out = await io.join(opt.dir, `${opt.baseName}-弹幕统计.xlsx`);
  await io.writeFile(out, await writeStatsXlsx(a, { mask: opt.mask }));
  return out;
}
