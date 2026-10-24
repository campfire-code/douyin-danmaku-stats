// 主界面：左边导入与设置，右边统计结果。全部在本机完成，不联网。
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, FileSpreadsheet, FolderOpen, Sparkles, Eraser, ClipboardPaste } from 'lucide-react';
import type { CustomTool } from '../kit/types';
import { onFileDrop, pickFiles, pickFolder, reveal } from '../kit/platform';
import { DEFAULT_GROUPS, guessColumns, maskNick, parseText, type Analysis, type ColumnMap, type Danmaku, type TimeKind } from './core';
import { exportStats, loadFile, runAnalysis, toDanmaku, type Loaded } from './flow';
import { sampleTable, sampleText } from './samples';
import { clockLabel } from './xlsx';
import './tool.css';

type Ctx = Parameters<CustomTool['Main']>[0]['ctx'];
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const isPreview = typeof location !== 'undefined' && location.pathname.endsWith('preview.html');

function demoLoaded(): Loaded {
  const t = sampleTable();
  return { source: 'table', name: '示例弹幕记录.csv', path: '示例弹幕记录.csv', header: t.header, rows: t.rows, map: { time: 0, nick: 1, text: 2 } };
}

export function Main({ ctx }: { ctx?: Ctx }) {
  const [loaded, setLoaded] = useState<Loaded | null>(isPreview ? demoLoaded() : null);
  const [map, setMap] = useState<ColumnMap>({ time: 0, nick: 1, text: 2 });
  const [pasted, setPasted] = useState('');
  const [groupsSrc, setGroupsSrc] = useState(DEFAULT_GROUPS);
  const [mask, setMask] = useState(true);
  const [topN, setTopN] = useState(20);
  const [hover, setHover] = useState(false);
  const [busy, setBusy] = useState(false);
  const [curveGroup, setCurveGroup] = useState('');
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string; path?: string } | null>(null);

  const open = useCallback(async (path: string) => {
    if (!ctx) return setNotice({ kind: 'err', text: '预览模式下不能读文件' });
    setBusy(true);
    setNotice(null);
    try {
      const l = await loadFile(ctx, path);
      setLoaded(l);
      setPasted('');
      if (l.source === 'table') setMap(l.map);
    } catch (e) {
      setNotice({ kind: 'err', text: errText(e) });
    }
    setBusy(false);
  }, [ctx]);

  useEffect(() => {
    let off: (() => void) | undefined;
    let dead = false;
    onFileDrop((paths) => paths[0] && open(paths[0]), setHover).then((u) => (dead ? u() : (off = u))).catch(() => {});
    return () => { dead = true; off?.(); };
  }, [open]);

  // 当前输入：粘贴的文本优先于文件
  const input = useMemo<{ rows: Danmaku[]; kind: TimeKind; badTime: number; error?: string }>(() => {
    try {
      if (pasted.trim()) return { ...parseText(pasted), badTime: 0 };
      if (loaded) return toDanmaku(loaded, map);
    } catch (e) {
      return { rows: [], kind: 'none', badTime: 0, error: errText(e) };
    }
    return { rows: [], kind: 'none', badTime: 0 };
  }, [pasted, loaded, map]);

  const result = useMemo<{ a?: Analysis; error?: string }>(() => {
    if (input.error) return { error: input.error };
    if (!input.rows.length) return {};
    try {
      return { a: runAnalysis(input.rows, input.kind, groupsSrc, topN) };
    } catch (e) {
      return { error: errText(e) };
    }
  }, [input, groupsSrc, topN]);
  const a = result.a;

  const doExport = async () => {
    if (!ctx || !a) return;
    setBusy(true);
    try {
      let dir: string | null;
      let base: string;
      if (!pasted.trim() && loaded) {
        dir = loaded.path.slice(0, Math.max(loaded.path.lastIndexOf('/'), loaded.path.lastIndexOf('\\')));
        base = loaded.name.replace(/\.[^.]+$/, '');
      } else {
        dir = await pickFolder();
        base = '粘贴的弹幕';
      }
      if (dir) {
        const path = await exportStats(ctx, a, { dir, baseName: base, mask });
        setNotice({ kind: 'ok', text: `已导出：${path}`, path });
      }
    } catch (e) {
      setNotice({ kind: 'err', text: `导出失败：${errText(e)}` });
    }
    setBusy(false);
  };

  const pick = async () => { const [p] = await pickFiles(['csv', 'xlsx', 'txt'], '弹幕记录').catch(() => [] as string[]); if (p) open(p); };
  const nick = (s: string) => (mask ? maskNick(s) : s || '（无昵称）');
  const tableHeader = loaded?.source === 'table' ? loaded.header : [];
  const max = a ? Math.max(1, ...a.curve.map((b) => b.count)) : 1;
  const curveName = a?.groups.some((g) => g.name === curveGroup) ? curveGroup : '';

  return (
    <div className="dm-root">
      <aside className="k-panel dm-side k-scroll">
        <section className="dm-sec">
          <b>1. 导入弹幕记录</b>
          <button className={`k-drop${hover ? ' hover' : ''}`} disabled={busy} onClick={pick}>
            <FileSpreadsheet size={22} />
            <span><b>把 CSV / Excel / TXT 拖到这里</b>，或点击选择<br /><small>用你自己从直播后台或直播伴侣导出的记录；工具不抓取直播</small></span>
          </button>
          {loaded && !pasted.trim() && <div className="dm-file k-ellipsis" title={loaded.path}><FileSpreadsheet size={14} />{loaded.name}<span className="k-muted k-num">　{input.rows.length} 条</span></div>}
          {loaded?.source === 'table' && !pasted.trim() && (
            <div className="dm-map">
              <p className="k-muted">列名因导出方式而异，请确认每一项对应哪一列：</p>
              {([['text', '弹幕内容（必选）'], ['nick', '昵称'], ['time', '时间']] as const).map(([k, label]) => (
                <label key={k} className="dm-row">
                  <span>{label}</span>
                  <select className="k-input" value={map[k]} onChange={(e) => setMap({ ...map, [k]: Number(e.target.value) })} aria-label={label}>
                    <option value={-1}>{k === 'text' ? '请选择…' : '没有 / 不用'}</option>
                    {tableHeader.map((h, i) => <option key={i} value={i}>{h}</option>)}
                  </select>
                </label>
              ))}
              <button className="k-link" onClick={() => setMap(guessColumns(tableHeader))}>按列名重新猜测</button>
              {input.badTime > 0 && <p className="dm-warn">有 {input.badTime} 行的时间读不出来，这些行不计入热度曲线。时间支持「2026-10-23 20:05:31」「20:05:31」「05:31（分:秒）」。</p>}
            </div>
          )}
          <label className="dm-paste">
            <span><ClipboardPaste size={14} /> 或粘贴文本（每行「昵称：内容」，行首可加 [20:05:31]）</span>
            <textarea className="k-input" rows={4} value={pasted} onChange={(e) => setPasted(e.target.value)} spellCheck={false} placeholder={'用户A：多少钱\n用户B：链接在哪'} />
          </label>
          <div className="dm-btns">
            <button className="k-btn ghost" onClick={() => { setPasted(sampleText()); }}><Sparkles size={14} />示例</button>
            <button className="k-btn ghost" disabled={!loaded && !pasted} onClick={() => { setLoaded(null); setPasted(''); setNotice(null); }}><Eraser size={14} />清空</button>
          </div>
        </section>
        <section className="dm-sec">
          <b>2. 关键词组</b>
          <textarea className="k-input" rows={6} value={groupsSrc} onChange={(e) => setGroupsSrc(e.target.value)} spellCheck={false} aria-label="关键词组" />
          <small className="k-muted">每行一组：「组名=词1,词2」。一条弹幕里出现组内任一词就算命中该组。</small>
        </section>
        <section className="dm-sec">
          <b>3. 显示</b>
          <label className="k-toggle"><input type="checkbox" checked={mask} onChange={(e) => setMask(e.target.checked)} /><span>昵称脱敏（只显示第一个字，导出也一样）</span></label>
          <label className="dm-row"><span>高频词显示前</span><input className="k-input dm-num" type="number" min={5} max={200} value={topN} onChange={(e) => setTopN(Math.min(200, Math.max(5, Number(e.target.value) || 20)))} /><span>个</span></label>
        </section>
      </aside>

      <main className="dm-main k-scroll">
        {notice && (
          <div className={`k-notice ${notice.kind}`} role="status">
            <span className="k-ellipsis">{notice.text}</span>
            {notice.path && ctx && <button className="k-link" onClick={() => reveal(notice.path!)}><FolderOpen size={13} />在文件夹中显示</button>}
          </div>
        )}
        {result.error && <div className="k-notice err" role="alert">{result.error}</div>}
        {!a && !result.error && <div className="dm-empty k-muted">导入弹幕记录或粘贴文本后，这里显示统计结果。<br />点左侧「示例」可以先看看效果。</div>}
        {a && (
          <>
            <div className="dm-top">
              <div className="dm-stats">
                <div><b className="k-num">{a.total}</b><span>条弹幕</span></div>
                <div><b className="k-num">{a.people || '–'}</b><span>不同昵称</span></div>
                <div><b className="k-num">{a.peak ? a.peak.count : '–'}</b><span>{a.peak ? `最热 ${a.peak.label}` : '无时间信息'}</span></div>
                <div><b className="k-num">{a.questions.length}</b><span>提问类</span></div>
              </div>
              <button className="k-btn primary" disabled={busy} onClick={doExport}><Download size={15} />导出 Excel</button>
            </div>

            <section className="k-panel dm-card">
              <h3>关键词命中</h3>
              <table className="k-table">
                <thead><tr><th>关键词组</th><th>命中弹幕</th><th>出现次数</th><th>涉及人数</th><th>各词次数</th></tr></thead>
                <tbody>
                  {[...a.groups].sort((x, y) => y.messages - x.messages).map((g) => (
                    <tr key={g.name}>
                      <td><b>{g.name}</b></td><td className="k-num">{g.messages}</td><td className="k-num">{g.occurrences}</td><td className="k-num">{g.people}</td>
                      <td className="dm-words">{g.words.map((w) => `${w.word} ${w.count}`).join(' · ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            <section className="k-panel dm-card">
              <div className="dm-card-hd">
                <h3>每分钟热度</h3>
                <span className="b-sp" />
                {a.curve.length > 0 && (
                  <label className="dm-row"><span>高亮</span>
                    <select className="k-input dm-sel" value={curveName} onChange={(e) => setCurveGroup(e.target.value)} aria-label="高亮关键词组">
                      <option value="">不高亮</option>
                      {a.groups.map((g) => <option key={g.name} value={g.name}>{g.name}</option>)}
                    </select>
                  </label>
                )}
              </div>
              {a.curve.length === 0 ? <p className="k-muted">没有可用的时间信息，无法画热度曲线（导入时在「时间」里选对列，或在文本行首加 [20:05:31]）。</p> : (
                <div className="dm-chart" role="img" aria-label={`每分钟弹幕数，${a.range}`}>
                  {a.curve.map((b) => (
                    <div key={b.label} className={`dm-bar${a.peak === b ? ' peak' : ''}`} title={`${b.label}：${b.count} 条${curveName ? `，${curveName} ${b.groups[curveName]} 条` : ''}`}>
                      <span className="dm-bar-n k-num">{b.count}</span>
                      <div className="dm-bar-col" style={{ height: `${(b.count / max) * 100}%` }}>
                        {curveName && b.groups[curveName] > 0 && <i style={{ height: `${(b.groups[curveName] / b.count) * 100}%` }} />}
                      </div>
                      <span className="dm-bar-l">{b.label.replace(/^第(\d+)分钟$/, '$1')}</span>
                    </div>
                  ))}
                </div>
              )}
              {a.curve.length > 0 && <small className="k-muted">{a.range}{a.kind === 'elapsed' ? '；横轴为开播后第几分钟' : ''}</small>}
            </section>

            <div className="dm-two">
              <section className="k-panel dm-card">
                <h3>高频词 Top {a.words.length}</h3>
                <ol className="dm-rank">
                  {a.words.map((w) => <li key={w.word}><span>{w.word}</span><b className="k-num">{w.count}</b></li>)}
                </ol>
                <small className="k-muted">分词来自系统自带的中文分词，品牌词、网络用语可能被拆开。</small>
              </section>
              <section className="k-panel dm-card">
                <h3>提问类弹幕（{a.questions.length}）</h3>
                <ul className="dm-q">
                  {a.questions.slice(0, 200).map((q, i) => (
                    <li key={i}><span className="k-muted k-num">{clockLabel(q.sec, a.kind)}</span><span className="k-muted">{nick(q.nick)}</span><span>{q.text}</span></li>
                  ))}
                </ul>
                <small className="k-muted">按「？」「吗」「多少」「怎么」「有没有」等字样判断，可能有漏判和误判。{a.questions.length > 200 ? '界面只显示前 200 条，导出的 Excel 里是全部。' : ''}</small>
              </section>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
