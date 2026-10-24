// 纯函数：弹幕 / 评论记录 → 关键词命中、按分钟热度、高频词、提问弹幕。
// 不抓取直播，不联网；输入是用户自己导出或粘贴的记录。
export type Cell = string | number | boolean | Date | null;

export interface Danmaku {
  /** 昵称，可能为空 */
  nick: string;
  text: string;
  /** 秒：带日期时为 UTC 秒数；只有 时:分:秒 时为当天第几秒；「分:秒」时为开播后第几秒；读不出为 null */
  sec: number | null;
}

/** 时间的含义：clock＝时钟时间，elapsed＝开播后经过的时间，none＝没有时间 */
export type TimeKind = 'clock' | 'elapsed' | 'none';

// ---------- 时间 ----------

/** 解析一个时间单元格：「2026-10-23 20:05:31」「20:05:31」「05:31」（两段按 分:秒 算）或 Date */
export function parseTime(v: Cell): { sec: number; kind: Exclude<TimeKind, 'none'> } | null {
  if (v == null || v === '') return null;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    return { sec: Math.floor(v.getTime() / 1000), kind: 'clock' };
  }
  const s = String(v).trim();
  const full = /^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?[T\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(s);
  if (full) {
    const t = Date.UTC(+full[1], +full[2] - 1, +full[3], +full[4], +full[5], +(full[6] ?? 0));
    return { sec: t / 1000, kind: 'clock' };
  }
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(s);
  if (!m) return null;
  if (m[3] != null) return { sec: +m[1] * 3600 + +m[2] * 60 + +m[3], kind: 'clock' };
  return { sec: +m[1] * 60 + +m[2], kind: 'elapsed' };
}

// ---------- 粘贴文本 ----------

const TIME_PREFIX = /^[[(【]?\s*((?:\d{4}[-/.]\d{1,2}[-/.]\d{1,2}[T\s]+)?\d{1,2}:\d{2}(?::\d{2})?)\s*[\])】]?[\s,，]*/;
const NICK_SEP = /[：:]/;

/** 解析粘贴的文本。每行「昵称：内容」，行首可带 [20:05:31] 之类的时间。没有冒号的行当作没有昵称的内容。 */
export function parseText(raw: string): { rows: Danmaku[]; kind: TimeKind } {
  const rows: Danmaku[] = [];
  let kind: TimeKind = 'none';
  for (const line0 of raw.split(/\r?\n/)) {
    let line = line0.trim();
    if (!line) continue;
    let sec: number | null = null;
    const tm = TIME_PREFIX.exec(line);
    if (tm) {
      const t = parseTime(tm[1]);
      if (t) {
        sec = t.sec;
        if (kind === 'none') kind = t.kind;
        line = line.slice(tm[0].length);
      }
    }
    // 只在前 24 个字符内找昵称分隔符，避免把内容里的冒号当分隔
    const idx = line.search(NICK_SEP);
    if (idx > 0 && idx <= 24) rows.push({ nick: line.slice(0, idx).trim(), text: line.slice(idx + 1).trim(), sec });
    else rows.push({ nick: '', text: line, sec });
  }
  return { rows: rows.filter((r) => r.text), kind };
}

// ---------- 表格列映射 ----------

export interface ColumnMap {
  nick: number;
  text: number;
  time: number;
}

const NICK_RE = /昵称|用户名|用户|发送者|发言人|nick|user|name/i;
const TEXT_RE = /弹幕|评论|内容|消息|留言|文本|text|content|comment|message/i;
const TIME_RE = /时间|time|date/i;

/** 按表头猜列：猜不到的返回 -1，由界面让用户自己选，不编造任何官方导出格式 */
export function guessColumns(header: string[]): ColumnMap {
  const find = (re: RegExp, not: number[] = []) => header.findIndex((h, i) => !not.includes(i) && re.test(h));
  const text = find(TEXT_RE);
  const nick = find(NICK_RE, [text]);
  const time = find(TIME_RE, [text, nick]);
  return { nick, text, time };
}

export function fromTable(rows: Cell[][], map: ColumnMap): { rows: Danmaku[]; kind: TimeKind; badTime: number } {
  if (map.text < 0) throw new Error('请先选择「弹幕内容」所在的列');
  const out: Danmaku[] = [];
  let kind: TimeKind = 'none';
  let badTime = 0;
  for (const r of rows) {
    const text = String(r[map.text] ?? '').trim();
    if (!text) continue;
    let sec: number | null = null;
    if (map.time >= 0) {
      const cell = r[map.time];
      const t = parseTime(cell);
      if (t) {
        sec = t.sec;
        if (kind === 'none') kind = t.kind;
      } else if (cell != null && String(cell).trim() !== '') badTime++;
    }
    out.push({ nick: map.nick >= 0 ? String(r[map.nick] ?? '').trim() : '', text, sec });
  }
  return { rows: out, kind, badTime };
}

// ---------- 脱敏 ----------

/** 昵称脱敏：保留第一个字，其余用 * 代替；一个字的昵称显示 * */
export function maskNick(nick: string): string {
  const chars = [...nick.trim()];
  if (!chars.length) return '（无昵称）';
  if (chars.length === 1) return '*';
  return chars[0] + '*'.repeat(Math.min(chars.length - 1, 3));
}

// ---------- 关键词组 ----------

export interface KeywordGroup {
  name: string;
  words: string[];
}

export const DEFAULT_GROUPS = `问价=价格,多少钱,几块,怎么卖,什么价
要链接=链接,怎么拍,怎么买,下单,拍哪
问物流=发货,快递,包邮,多久到,顺丰
问售后=退货,退款,质量,保修,假的`;

/** 每行「组名=词1,词2」，逗号、顿号、空格均可分隔；格式不对的行报错并带行号 */
export function parseGroups(src: string): KeywordGroup[] {
  const groups: KeywordGroup[] = [];
  src.split(/\r?\n/).forEach((line, i) => {
    if (!line.trim()) return;
    const m = /^([^=＝]+)[=＝](.*)$/.exec(line);
    if (!m) throw new Error(`第 ${i + 1} 行格式不对，应写成「组名=词1,词2」`);
    const words = m[2].split(/[,，、;；\s]+/).map((w) => w.trim()).filter(Boolean);
    if (!words.length) throw new Error(`第 ${i + 1} 行「${m[1].trim()}」没有关键词`);
    groups.push({ name: m[1].trim(), words });
  });
  return groups;
}

export interface GroupStat {
  name: string;
  /** 命中的弹幕条数（一条弹幕里出现多个词只算一条） */
  messages: number;
  /** 关键词出现的总次数 */
  occurrences: number;
  /** 涉及的不同昵称数（无昵称的不计） */
  people: number;
  /** 各词出现次数 */
  words: { word: string; count: number }[];
}

const countOf = (text: string, word: string) => {
  let n = 0;
  for (let i = text.indexOf(word); i !== -1; i = text.indexOf(word, i + word.length)) n++;
  return n;
};

export function groupStats(rows: Danmaku[], groups: KeywordGroup[]): GroupStat[] {
  return groups.map((g) => {
    const words = g.words.map((w) => w.toLowerCase());
    const per = new Map<string, number>();
    const people = new Set<string>();
    let messages = 0;
    let occurrences = 0;
    for (const r of rows) {
      const t = r.text.toLowerCase();
      let hit = false;
      for (const w of words) {
        const c = countOf(t, w);
        if (c) {
          hit = true;
          occurrences += c;
          per.set(w, (per.get(w) ?? 0) + c);
        }
      }
      if (hit) {
        messages++;
        if (r.nick) people.add(r.nick);
      }
    }
    return { name: g.name, messages, occurrences, people: people.size, words: g.words.map((w, i) => ({ word: w, count: per.get(words[i]) ?? 0 })).sort((a, b) => b.count - a.count) };
  });
}

// ---------- 热度曲线 ----------

export interface Bucket {
  label: string;
  count: number;
  /** 各关键词组在这一分钟的命中条数，键为组名 */
  groups: Record<string, number>;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** 按分钟统计条数（含 0 条的分钟），没有时间的记录不计入；groups 给出时同时统计各组命中条数 */
export function minuteCurve(rows: Danmaku[], kind: TimeKind, groups: KeywordGroup[] = []): Bucket[] {
  const timed = rows.filter((r) => r.sec != null);
  if (kind === 'none' || !timed.length) return [];
  const mins = timed.map((r) => Math.floor(r.sec! / 60));
  const lo = Math.min(...mins);
  const hi = Math.max(...mins);
  if (hi - lo > 24 * 60) throw new Error('时间跨度超过 24 小时，请检查时间列是否选对');
  const lower = groups.map((g) => g.words.map((w) => w.toLowerCase()));
  const buckets: Bucket[] = [];
  for (let m = lo; m <= hi; m++) {
    const label = kind === 'elapsed' ? `第${m - lo + 1}分钟` : `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`;
    buckets.push({ label, count: 0, groups: Object.fromEntries(groups.map((g) => [g.name, 0])) });
  }
  for (const r of timed) {
    const b = buckets[Math.floor(r.sec! / 60) - lo];
    b.count++;
    const t = r.text.toLowerCase();
    groups.forEach((g, gi) => {
      if (lower[gi].some((w) => t.includes(w))) b.groups[g.name]++;
    });
  }
  return buckets;
}

// ---------- 高频词 ----------

const STOP = new Set(
  '的 了 是 在 我 你 他 她 它 们 吗 呢 啊 呀 吧 哦 哈 嗯 呵 啦 嘛 都 也 就 还 又 很 和 与 有 没 不 这 那 个 一 么 什么 怎么 一个 这个 那个 就是 可以 现在 已经 是不是 有没有 主播 家人 家人们 大家 来了 哈哈 哈哈哈 感谢 谢谢'.split(' '),
);

type SegmenterCtor = new (l: string, o: { granularity: 'word' }) => { segment(s: string): Iterable<{ segment: string; isWordLike?: boolean }> };

function tokens(text: string): string[] {
  const Seg = (Intl as unknown as { Segmenter?: SegmenterCtor }).Segmenter;
  if (Seg) {
    return [...new Seg('zh', { granularity: 'word' }).segment(text)].filter((s) => s.isWordLike).map((s) => s.segment);
  }
  // 没有分词器时退化为连续汉字的二字组合
  const out: string[] = [];
  for (const run of text.match(/[一-龥]+/g) ?? []) for (let i = 0; i + 1 < run.length; i++) out.push(run.slice(i, i + 2));
  return out;
}

export function topWords(rows: Danmaku[], n: number, extraStop: string[] = []): { word: string; count: number }[] {
  const stop = new Set([...STOP, ...extraStop]);
  const map = new Map<string, number>();
  for (const r of rows) {
    for (const w of tokens(r.text)) {
      const word = w.toLowerCase();
      if (word.length < 2 || stop.has(word) || /^[\d.]+$/.test(word)) continue;
      map.set(word, (map.get(word) ?? 0) + 1);
    }
  }
  return [...map].map(([word, count]) => ({ word, count })).sort((a, b) => b.count - a.count || a.word.localeCompare(b.word, 'zh')).slice(0, n);
}

// ---------- 提问类弹幕 ----------

const QUESTION_RE = /[?？]|吗|么|呢$|多少|几[个号码块件天]|怎样|如何|哪|能不能|有没有|是不是|可不可以|会不会|能否/;

export const isQuestion = (text: string) => QUESTION_RE.test(text);

// ---------- 总分析 ----------

export interface Analysis {
  total: number;
  people: number;
  timed: number;
  kind: TimeKind;
  /** 时间范围的文字描述，没有时间时为空 */
  range: string;
  groups: GroupStat[];
  curve: Bucket[];
  peak: Bucket | null;
  words: { word: string; count: number }[];
  questions: Danmaku[];
}

export function analyze(rows: Danmaku[], kind: TimeKind, groups: KeywordGroup[], topN = 30): Analysis {
  const curve = minuteCurve(rows, kind, groups);
  const peak = curve.reduce<Bucket | null>((a, b) => (!a || b.count > a.count ? b : a), null);
  return {
    total: rows.length,
    people: new Set(rows.filter((r) => r.nick).map((r) => r.nick)).size,
    timed: rows.filter((r) => r.sec != null).length,
    kind,
    range: curve.length ? `${curve[0].label} – ${curve[curve.length - 1].label}（共 ${curve.length} 分钟）` : '',
    groups: groupStats(rows, groups),
    curve,
    peak,
    words: topWords(rows, topN),
    questions: rows.filter((r) => isQuestion(r.text)),
  };
}
