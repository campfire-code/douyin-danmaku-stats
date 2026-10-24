import { describe, expect, it } from 'vitest';
import { analyze, DEFAULT_GROUPS, fromTable, groupStats, guessColumns, isQuestion, maskNick, minuteCurve, parseGroups, parseText, parseTime, topWords } from './core';
import { sampleRows, sampleTable, sampleText } from './samples';

describe('时间', () => {
  it('三种写法', () => {
    expect(parseTime('20:05:31')).toEqual({ sec: 72331, kind: 'clock' });
    expect(parseTime('05:31')).toEqual({ sec: 331, kind: 'elapsed' });
    expect(parseTime('2026-10-23 20:05:31')!.kind).toBe('clock');
    expect(parseTime(new Date(Date.UTC(2026, 9, 23, 20, 0, 0)))!.kind).toBe('clock');
  });
  it('读不出返回 null', () => {
    expect(parseTime('刚刚')).toBeNull();
    expect(parseTime('')).toBeNull();
    expect(parseTime(null)).toBeNull();
  });
});

describe('粘贴文本', () => {
  it('昵称：内容，支持中英文冒号', () => {
    const { rows, kind } = parseText('用户A：多少钱\n用户B:链接在哪\n\n纯内容没有昵称');
    expect(rows).toEqual([
      { nick: '用户A', text: '多少钱', sec: null },
      { nick: '用户B', text: '链接在哪', sec: null },
      { nick: '', text: '纯内容没有昵称', sec: null },
    ]);
    expect(kind).toBe('none');
  });
  it('行首时间；内容里的冒号不拆', () => {
    const { rows, kind } = parseText('[20:05:31] 用户A：几点发货：今天吗');
    expect(rows[0]).toEqual({ nick: '用户A', text: '几点发货：今天吗', sec: 72331 });
    expect(kind).toBe('clock');
  });
  it('示例文本读出 58 条', () => {
    expect(parseText(sampleText()).rows).toHaveLength(58);
  });
});

describe('列映射', () => {
  it('认得常见列名', () => {
    expect(guessColumns(['时间', '用户昵称', '弹幕内容'])).toEqual({ time: 0, nick: 1, text: 2 });
  });
  it('猜不到时返回 -1，让用户自己选', () => {
    expect(guessColumns(['发送时间', '观众', '发言'])).toEqual({ time: 0, nick: -1, text: -1 });
  });
  it('没选内容列时明确报错', () => {
    expect(() => fromTable([['a']], { nick: -1, text: -1, time: -1 })).toThrow('弹幕内容');
  });
  it('统计读不出的时间格数', () => {
    const r = fromTable([['20:00:01', '用户A', '价格'], ['昨晚', '用户B', '链接'], ['20:00:30', '用户C', '']], { time: 0, nick: 1, text: 2 });
    expect(r.rows).toHaveLength(2);
    expect(r.badTime).toBe(1);
    expect(r.rows[1].sec).toBeNull();
  });
});

describe('脱敏', () => {
  it('保留首字', () => {
    expect(maskNick('用户A')).toBe('用**');
    expect(maskNick('A')).toBe('*');
    expect(maskNick('')).toBe('（无昵称）');
    expect(maskNick('一个很长的昵称啊')).toBe('一***');
  });
});

describe('关键词组', () => {
  it('解析与格式错误', () => {
    expect(parseGroups('问价=价格，多少钱 、链接\n')).toEqual([{ name: '问价', words: ['价格', '多少钱', '链接'] }]);
    expect(() => parseGroups('问价')).toThrow('第 1 行格式不对');
    expect(() => parseGroups('a=b\n问价=')).toThrow('第 2 行');
  });
  it('命中条数与出现次数分开算', () => {
    const rows = [
      { nick: '用户A', text: '价格多少钱，价格呢', sec: null },
      { nick: '用户A', text: '多少钱', sec: null },
      { nick: '用户B', text: '你好', sec: null },
    ];
    const [g] = groupStats(rows, [{ name: '问价', words: ['价格', '多少钱'] }]);
    expect(g).toMatchObject({ messages: 2, occurrences: 4, people: 1 });
    expect(g.words).toEqual([{ word: '价格', count: 2 }, { word: '多少钱', count: 2 }]);
  });
  it('大小写不敏感', () => {
    const [g] = groupStats([{ nick: '', text: 'VIP 来了', sec: null }], [{ name: 'v', words: ['vip'] }]);
    expect(g.messages).toBe(1);
  });
});

describe('热度曲线', () => {
  it('含 0 条的分钟、带各组命中', () => {
    const rows = [
      { nick: '', text: '价格', sec: 20 * 3600 + 5 },
      { nick: '', text: '你好', sec: 20 * 3600 + 30 },
      { nick: '', text: '多少钱', sec: 20 * 3600 + 185 },
    ];
    const c = minuteCurve(rows, 'clock', [{ name: '问价', words: ['价格', '多少钱'] }]);
    expect(c.map((b) => [b.label, b.count, b.groups['问价']])).toEqual([['20:00', 2, 1], ['20:01', 0, 0], ['20:02', 0, 0], ['20:03', 1, 1]]);
  });
  it('开播后时间标成第 N 分钟；没有时间返回空', () => {
    const c = minuteCurve([{ nick: '', text: 'a', sec: 61 }, { nick: '', text: 'b', sec: 130 }], 'elapsed');
    expect(c.map((b) => b.label)).toEqual(['第1分钟', '第2分钟']);
    expect(minuteCurve([{ nick: '', text: 'a', sec: null }], 'none')).toEqual([]);
  });
  it('跨度超过 24 小时报错', () => {
    expect(() => minuteCurve([{ nick: '', text: 'a', sec: 0 }, { nick: '', text: 'b', sec: 3 * 86400 }], 'clock')).toThrow('24 小时');
  });
});

describe('高频词与提问', () => {
  it('去掉停用词和单字', () => {
    const w = topWords([{ nick: '', text: '保温杯多少钱，保温杯的价格', sec: null }, { nick: '', text: '保温杯好看', sec: null }], 5);
    expect(w[0]).toEqual({ word: '保温', count: 3 });
    expect(w.some((x) => x.word === '的' || x.word.length < 2)).toBe(false);
  });
  it('提问判断', () => {
    expect(isQuestion('多少钱')).toBe(true);
    expect(isQuestion('会不会漏水？')).toBe(true);
    expect(isQuestion('发货了吗')).toBe(true);
    expect(isQuestion('下单了')).toBe(false);
    expect(isQuestion('主播好')).toBe(false);
  });
});

describe('示例数据整体统计', () => {
  const groups = parseGroups(DEFAULT_GROUPS);
  const a = analyze(sampleRows().map((r) => ({ nick: r.nick, text: r.text, sec: 72000 + r.at })), 'clock', groups);
  it('总量与时间范围', () => {
    expect(a.total).toBe(58);
    expect(a.people).toBe(12);
    expect(a.curve).toHaveLength(8);
    expect(a.range).toContain('20:00');
  });
  it('最热的一分钟是第 6 分钟（20:05）', () => {
    expect(a.peak).toMatchObject({ label: '20:05', count: 12 });
  });
  it('问价类命中多于其他组，提问列表非空', () => {
    const by = Object.fromEntries(a.groups.map((g) => [g.name, g.messages]));
    expect(by['问价']).toBeGreaterThan(by['问售后']);
    expect(a.questions.length).toBeGreaterThan(10);
  });
  it('表格示例与文本示例统计一致', () => {
    const t = sampleTable();
    const r = fromTable(t.rows, { time: 0, nick: 1, text: 2 });
    expect(r.rows).toHaveLength(58);
    expect(r.kind).toBe('clock');
    const b = analyze(r.rows, r.kind, groups);
    expect(b.groups).toEqual(a.groups);
    expect(b.curve.map((x) => x.count)).toEqual(a.curve.map((x) => x.count));
  });
});
