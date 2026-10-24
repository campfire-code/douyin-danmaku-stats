// 示例数据：全部手编，昵称用「用户A」之类，不含真实主播和品牌。samples/ 里的文件和界面示例共用。
import type { Cell } from './core';

/** 每分钟的弹幕模板（8 分钟）。共 100 条左右，够看出热度曲线的起伏 */
const MINUTES: string[][] = [
  ['来了', '主播好', '这个杯子多大的？', '先看看', '哈哈哈来晚了'],
  ['多少钱', '价格是多少', '有链接吗', '黑色好看', '保温效果怎么样？', '怎么买', '主播好'],
  ['链接在哪', '怎么拍', '多少钱啊', '链接', '什么价', '下单了', '拍哪个链接', '能便宜点吗', '包邮吗', '价格', '几号发货？'],
  ['发货快吗', '顺丰发货吗', '多久到', '快递是哪家', '包邮不', '已经下单了', '保温多久？', '有粉色吗'],
  ['质量怎么样', '会不会漏水？', '能退货吗', '退货运费谁出', '保修多久', '质量靠谱吗'],
  ['多少钱', '怎么卖', '链接发一下', '怎么买啊', '价格太高了', '想要大号的', '有没有优惠', '拍了拍了', '下单成功', '链接呢', '几块钱', '现在拍有赠品吗'],
  ['谢谢主播', '收到了再来评价', '发货了吗', '包邮到新疆吗？', '多久能到'],
  ['下播了吗', '明天几点播', '还有没有链接', '再看看'],
];

const NAMES = ['用户A', '用户B', '用户C', '用户D', '用户E', '用户F', '用户G', '用户H', '用户I', '用户J', '用户K', '用户L'];

export interface SampleRow {
  /** 开播后经过的秒数 */
  at: number;
  nick: string;
  text: string;
}

export function sampleRows(): SampleRow[] {
  const rows: SampleRow[] = [];
  let k = 0;
  MINUTES.forEach((list, m) => {
    list.forEach((text, i) => {
      rows.push({ at: m * 60 + Math.floor((i * 57) / list.length) + 1, nick: NAMES[(k * 5) % NAMES.length], text });
      k++;
    });
  });
  return rows;
}

const clock = (at: number) => {
  const s = 20 * 3600 + at; // 示例开播时间 20:00:00
  const p = (n: number) => String(n).padStart(2, '0');
  return `2026-10-23 ${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
};

/** 示例 CSV：列名是随意取的（故意不叫「弹幕」），用来演示「选列映射」 */
export function sampleTable(): { header: string[]; rows: Cell[][] } {
  return { header: ['发送时间', '观众', '发言'], rows: sampleRows().map((r) => [clock(r.at), r.nick, r.text]) };
}

/** 示例粘贴文本：「[时:分:秒] 昵称：内容」 */
export function sampleText(): string {
  return sampleRows().map((r) => `[${clock(r.at).slice(11)}] ${r.nick}：${r.text}`).join('\n');
}
