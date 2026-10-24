// 工具声明：直播弹幕关键词统计（导入已有记录，不抓取直播；全部在本机完成）。
import { MessagesSquare as MessagesSquareAsIcon } from 'lucide-react';
import { createElement } from 'react';
import type { CustomTool } from '../kit/types';
import { Main } from './Main';

const tool: CustomTool = {
  id: 'e27',
  name: '直播弹幕关键词统计',
  tagline: '导入你自己从直播后台或直播伴侣导出的弹幕 / 评论记录（CSV、Excel），或粘贴「昵称：内容」文本：统计问价、要链接等关键词命中、每分钟热度、高频词和提问弹幕，导出 Excel。工具不抓取直播。',
  icon: MessagesSquareAsIcon,
  category: '电商运营',
  type: 'data',
  mode: 'custom',
  mainLabel: '弹幕统计',
  params: [],
  Main: ({ ctx }) => createElement(Main, { ctx }),
};

export default tool;
