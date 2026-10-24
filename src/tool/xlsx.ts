// Excel / CSV 读写：基于 exceljs（MIT）。
import ExcelJS from 'exceljs';
import type { Cell } from './core';
import { maskNick, type Analysis, type TimeKind } from './core';

/** 文本解码：优先 UTF-8（去掉 BOM），不是合法 UTF-8 时按 GBK 解（Excel 中文版导出的 CSV 常见） */
export function decodeText(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, '');
  } catch {
    return new TextDecoder('gbk').decode(bytes);
  }
}
/** 解析 CSV：支持引号、引号内换行与逗号、两个引号转义，自动识别逗号 / 制表符 / 分号分隔 */
export function parseCsv(text: string): string[][] {
  const firstLine = text.slice(0, text.indexOf('\n') === -1 ? text.length : text.indexOf('\n'));
  const sep = [',', '\t', ';'].map((s) => [s, firstLine.split(s).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += c;
    } else if (c === '"' && cell === '') quoted = true;
    else if (c === sep) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

function cellValue(v: ExcelJS.CellValue): Cell {
  if (v == null) return null;
  if (v instanceof Date || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
  if (typeof v === 'object') {
    if ('result' in v) return cellValue((v as ExcelJS.CellFormulaValue).result as ExcelJS.CellValue);
    if ('richText' in v) return (v as ExcelJS.CellRichTextValue).richText.map((t) => t.text).join('');
    if ('text' in v) return String((v as ExcelJS.CellHyperlinkValue).text);
    if ('error' in v) return null;
  }
  return String(v);
}

/** 读第一个可见工作表（CSV 直接解析），返回表头与数据行 */
export async function readTable(bytes: Uint8Array, fileName: string): Promise<{ header: string[]; rows: Cell[][] }> {
  let grid: Cell[][];
  if (/\.(csv|txt)$/i.test(fileName)) grid = parseCsv(decodeText(bytes));
  else {
    if (/\.xls$/i.test(fileName)) throw new Error('旧版 .xls 格式不支持，请用 Excel 或 WPS 另存为 .xlsx 后再拖进来');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
    const ws = wb.worksheets.find((s) => s.state === 'visible');
    if (!ws) throw new Error('表格里没有可见的工作表');
    grid = [];
    ws.eachRow({ includeEmpty: true }, (row, n) => {
      grid[n - 1] = (row.values as ExcelJS.CellValue[]).slice(1).map(cellValue);
    });
    for (let i = 0; i < grid.length; i++) grid[i] ??= [];
  }
  if (!grid.length) throw new Error('表格是空的');
  const width = Math.max(...grid.map((r) => r.length));
  const header = Array.from({ length: width }, (_, i) => String(grid[0][i] ?? '').trim() || `第 ${i + 1} 列`);
  return { header, rows: grid.slice(1).filter((r) => r.some((c) => c != null && String(c).trim() !== '')) };
}


const width = (v: Cell) => (v == null ? 0 : [...String(v)].reduce((a, ch) => a + (ch.charCodeAt(0) > 255 ? 2 : 1), 0));

function sheet(wb: ExcelJS.Workbook, name: string, header: string[], rows: Cell[][]) {
  const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.addRow(header).font = { bold: true };
  rows.forEach((r) => ws.addRow(r));
  ws.columns.forEach((col, ci) => {
    const w = Math.max(width(header[ci]), ...rows.slice(0, 500).map((r) => width(r[ci] ?? null)));
    col.width = Math.min(60, Math.max(8, w + 2));
  });
}

export const clockLabel = (sec: number | null, kind: TimeKind) => {
  if (sec == null || kind === 'none') return '';
  const p = (n: number) => String(n).padStart(2, '0');
  if (kind === 'elapsed') return `${p(Math.floor(sec / 60))}:${p(sec % 60)}`;
  const s = sec % 86400;
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
};

export async function writeStatsXlsx(a: Analysis, opt: { mask: boolean }): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  wb.creator = '篝火 · 直播弹幕关键词统计';
  sheet(wb, '概览', ['项目', '数值'], [
    ['弹幕总条数', a.total],
    ['不同昵称数', a.people],
    ['带时间的条数', a.timed],
    ['时间范围', a.range || '（没有时间信息）'],
    ['最热的一分钟', a.peak ? `${a.peak.label}（${a.peak.count} 条）` : ''],
    ['提问类弹幕条数', a.questions.length],
    ['昵称显示', opt.mask ? '已脱敏' : '原样'],
  ]);
  sheet(wb, '关键词组', ['关键词组', '命中弹幕数', '出现总次数', '涉及人数', '各词次数'], a.groups.map((g) => [g.name, g.messages, g.occurrences, g.people, g.words.map((w) => `${w.word}×${w.count}`).join('、')]));
  sheet(wb, '热度曲线', ['时间', '弹幕数', ...a.groups.map((g) => g.name)], a.curve.map((b) => [b.label, b.count, ...a.groups.map((g) => b.groups[g.name] ?? 0)]));
  sheet(wb, '高频词', ['排名', '词', '次数'], a.words.map((w, i) => [i + 1, w.word, w.count]));
  sheet(wb, '提问弹幕', ['时间', '昵称', '内容'], a.questions.map((q) => [clockLabel(q.sec, a.kind), opt.mask ? maskNick(q.nick) : q.nick, q.text]));
  return new Uint8Array(await wb.xlsx.writeBuffer());
}
