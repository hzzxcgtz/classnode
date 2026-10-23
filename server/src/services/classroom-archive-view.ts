import { createHash } from 'node:crypto';
import { ARCHIVE_STYLE } from './classroom-archive-style.js';
import { ARCHIVE_SCRIPT } from './classroom-archive-interaction.js';
import type { ClassroomArchiveData } from './classroom-archive-data.js';
import { ArchiveAssets, archiveLink } from './classroom-archive-assets.js';
import { readInkValue, strokePath, strokeWidthPx, textBoxOf } from './ink-path.js';
import { paperQuestion, inlineText } from './worksheet-paper.js';
import { gradeLabel } from './worksheet-report.js';
import { flattenAnswerable } from './worksheet-heading.js';
import { questionTypeNickname } from './question-type-labels.js';
import type { QuestionNode } from './worksheet-questions.js';

export const escapeArchiveHtml = (v: unknown): string => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const esc = escapeArchiveHtml;
const rec = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const list = (v: unknown): unknown[] => Array.isArray(v) ? v : [];
const date = (v: unknown) => v instanceof Date ? v.toLocaleString('zh-CN', { hour12: false }) : v ? String(v) : '未记录';
const status: Record<string, string> = { submitted: '已提交', draft: '草稿', unanswered: '未作答', 'not-started': '未开始', 'in-progress': '进行中', correct: '完全正确', partial: '部分答对', incorrect: '答错', pending: '评价中', success: '评价成功', succeeded: '评价成功', superseded: '历史评价（不计入当前成绩）', failed: '评价失败', student: '学生', teacher: '教师', active: '进行中', paused: '已暂停', ended: '已结束', online: '在线', offline: '离线', group: '小组', hidden: '隐藏', preview: '预览', open: '开放', standard: '个人课堂', advanced: '分组分别配置', 'learning-sheet': '学习单', explorer: '探究空间', companion: '智能学伴' };
const labels: Record<string, string> = {
  allowStudentStop: '允许学生停止回复', allowStudentAsk: '允许学生提问', allowStudentExport: '允许学生导出', allowFollowUps: '显示追问建议', answersLocked: '已锁定作答', webappCaptureEnabled: '采集探究画面', modules: '学习模块', materials: '学习材料', usages: '使用记录', interactions: '互动统计', node: '任务', heading: '任务位置', context: '主题说明', scores: '逐人评分', criteria: '评价要求', entries: '作答统计', keyboard: '文字输入',
  role: '发言角色', displayName: '当时显示名称', roundIndex: '对话轮次', fileUrls: '附件原地址', fileNames: '附件原名称', id: '记录编号', classroomId: '课堂编号', studentId: '学生／参与者编号', groupId: '小组编号', participantId: '参与者编号', worksheetId: '学习单编号', questionId: '任务编号', responseId: '作答记录编号', answerId: '作答编号', name: '名称', title: '标题', description: '说明', prompt: '任务要求／主题标题', content: '内容', text: '文字', value: '内容', format: '内容格式', type: '类型', inputMode: '作答方式', data: '任务设置', children: '下级内容', nodes: '主题与任务', settings: '学习单设置', schemaVersion: '内容版本', autoGrade: '自动评分', points: '分值', full: '完全正确', half: '部分答对', score: '得分', maxScore: '满分', unit: '奖励单位', status: '状态', createdAt: '创建时间', updatedAt: '更新时间', submittedAt: '提交时间', startedAt: '开始时间', savedAt: '最近保存', saveCount: '保存次数', reviewedAt: '教师查看时间', evaluatedAt: '评价时间', evaluationDurationMs: '评价耗时（毫秒）', computedAt: '统计时间', analyzedAt: '分析时间', aggregate: '分析时的作答统计快照', totalCount: '应作答人数／组数', narrative: '班级分析原文', perStudent: '逐人评价与分析依据', reason: '评分理由', advice: '建议', error: '失败原因', source: '评价来源', agentId: '智能体编号', model: '模型标识', requestId: '评价请求编号', generation: '评价版本标识', question: '本次评价对应的任务快照', options: '选项', key: '选项标识', correctKeys: '正确选项', answers: '参考答案', explanation: '答案说明', correctOrder: '正确顺序', pairs: '连线配对', placement: '正确分类', assignment: '学生分类', items: '条目', zones: '分类框', left: '左侧条目', right: '右侧条目', leftId: '左项', rightId: '右项', order: '排序结果', selected: '已选选项', texts: '各空填写内容', referenceAnswer: '参考作答', rubric: '评价标准', analysisFocus: '分析重点', imageUrl: '配图', promptImageUrl: '任务配图', referenceImageUrl: '参考图片', rubricImageUrl: '评价标准图片', drawing: '绘图文档', tool: '绘图工具', image: '作品快照', canvas: '画布', strokes: '笔画', color: '颜色', width: '线宽', shape: '图形', at: '位置', size: '字号', w: '宽', h: '高', followUps: '追问建议', totalRounds: '对话轮数', warningCount: '提醒次数', blacklisted: '已限制使用', joinTime: '加入时间', gender: '性别', studentNo: '学号', classId: '班级编号', moduleKey: '学习模块', state: '模块状态', kind: '材料类型', targetId: '材料编号', members: '成员', durationMs: '记录时长（毫秒）', webappId: '探究网页编号', clicks: '旧版点击统计字段', inputs: '旧版输入统计字段', maxDepth: '旧版访问深度字段', reports: '旧版上报计数字段', frameCount: '已采集帧数', firstMsgLen: '首次提问字数', avgTime: '平均回复耗时（秒）', word: '触发词', groupNames: '对应小组', isCorrect: '是否完全正确', gradeState: '判分结果', allowResubmit: '提交后可以修改', answerMode: '任务开放方式', rewardStyle: '奖励形式', backgroundTheme: '背景', aiScoringEnabled: 'AI 评分', studentAiReviewEnabled: '学生自主评价', aiReviewLimit: '每人每项任务评价次数', partialCredit: '漏选给分规则', partialTolerance: '部分给分条件', classNames: '班级', platform: '平台', purpose: '用途', greeting: '开场白', entryPath: '网页入口', code: '互动码', mode: '课堂模式', endedAt: '结束时间', materialsRevision: '课堂材料版本', sourceClassGroupId: '原班级分组编号', apiKey: 'API 密钥',
};

// Internal links remain in the archive renderer, but are not part of the reading copy.
const technicalFields = new Set(['id', 'key', 'format', 'schemaVersion', 'requestId', 'generation', 'model', 'materialsRevision', 'sourceClassGroupId', 'apiKey', 'entryPath', 'code', 'agentContextStarts', 'openedQuestionIds', 'openedTaskIds', 'worksheetOpen', 'webappThumbnailWidth', 'webappFrameIntervalMs', 'webappDetailIntervalMs', 'clicks', 'inputs', 'maxDepth', 'reports', 'canvas', 'strokes', 'tool', 'color', 'width', 'shape', 'at', 'size', 'w', 'h']);
const internalField = (key: string) => technicalFields.has(key) || /(?:Id|Ids)$/.test(key);

/** Reading copies retain classroom content without exposing implementation metadata. */
export class ArchiveView {
  readonly participantNames = new Map<string, string>();
  constructor(readonly assets: ArchiveAssets) {}
  image(url: string, caption: string): string {
    const target = this.assets.attachment(url);
    return target ? `<figure><a href="${esc(archiveLink(target))}" target="_blank" rel="noopener"><img loading="lazy" src="${esc(archiveLink(target))}" alt="${esc(caption)}"></a><figcaption>${esc(caption)} · <a href="${esc(archiveLink(target))}" download>原始文件</a></figcaption></figure>` : `<p class="notice">${esc(caption)}：原文件缺失，原地址 ${esc(url)}</p>`;
  }
  text(value: unknown): string {
    const raw = String(value ?? '');
    // Preserve source text literally; never execute Markdown/HTML from students, agents or prompts.
    let start = 0; let html = '';
    const pattern = /\/uploads\/(?:chat|classrooms|avatars|logos)\/[^\s<>"'`\]\[)]+/g;
    for (const match of raw.matchAll(pattern)) {
      html += esc(raw.slice(start, match.index));
      const target = this.assets.attachment(match[0]);
      html += target ? `<a href="${esc(archiveLink(target))}" download>${esc(match[0])}</a>` : esc(match[0]);
      start = (match.index ?? 0) + match[0].length;
    }
    return `<div class="prose">${html + esc(raw.slice(start))}</div>`;
  }
  fields(value: unknown, context: Record<string, unknown> = {}): string {
    if (value instanceof Date) return esc(date(value));
    if (value === null || value === undefined) return '<span class="muted">未记录</span>';
    if (typeof value === 'boolean') return value ? '是' : '否';
    if (typeof value === 'string') {
      if (/^\/uploads\/.*\.(?:png|jpe?g|webp)$/i.test(value)) return this.image(value, '图片');
      return this.text(value);
    }
    if (Array.isArray(value)) {
      const rows = value.map(v => this.fields(v, context)).filter(Boolean);
      return rows.length ? `<ol>${rows.map(v => `<li>${v}</li>`).join('')}</ol>` : '';
    }
    if (typeof value === 'object') {
      const row = rec(value);
      if (row.moduleKey === 'explorer') return '';
      const ink = this.ink(value);
      if (ink) return ink;
      const taskData = row.data ? rec(row.data) : context;
      const itemName = (id: unknown, collection: unknown) => list(collection).map(rec).find(item => String(item.id ?? item.key) === String(id))?.text || '原条目已无法关联';
      const fields = Object.entries(row).filter(([key, v]) => (!internalField(key) || (['studentId', 'participantId'].includes(key) && this.participantNames.has(String(v)))) && v !== null && v !== undefined).map(([key, v]) => {
        let display = ['studentId', 'participantId'].includes(key) ? this.participantNames.get(String(v)) : v;
        if (['status', 'state', 'source', 'role', 'mode', 'moduleKey'].includes(key) && typeof v === 'string') display = status[v] || v;
        if (key === 'correctOrder') display = list(v).map(id => itemName(id, taskData.items));
        if (key === 'placement' || key === 'assignment') display = Object.entries(rec(v)).map(([id, zone]) => `${itemName(id, taskData.items)} → ${itemName(zone, taskData.zones)}`);
        if (key === 'pairs') display = list(v).map(pair => `${itemName(rec(pair).leftId, taskData.left)} → ${itemName(rec(pair).rightId, taskData.right)}`);
        const content = this.fields(display, taskData);
        const label = (['studentId', 'participantId'].includes(key) ? '参与者' : undefined) || this.participantNames.get(key) || labels[key] || (/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(key) ? '原参与者' : key);
        return content ? `<dt>${esc(label)}</dt><dd>${content}</dd>` : '';
      }).join('');
      return fields ? `<dl class="fields">${fields}</dl>` : '';
    }
    return esc(value);
  }
  ink(value: unknown): string {
    const ink = readInkValue(value);
    if (!ink) return '';
    const box = ink.canvas.w > 0 && ink.canvas.h > 0 ? ink.canvas : { w: 640, h: 480 };
    const color = (c: string) => /^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(c) ? c : '#334155';
    const paths = ink.strokes.map(s => `<path d="${esc(strokePath(s.points, box, s.shape))}" fill="none" stroke="${color(s.color)}" stroke-width="${strokeWidthPx(s, box)}" stroke-linecap="round" stroke-linejoin="round"/>`).join('');
    const texts = (ink.texts ?? []).map(t => { const [x, y, , h] = textBoxOf(t, box); return `<text x="${x}" y="${y}" font-size="${h / 1.3}" fill="${color(t.color)}" dominant-baseline="hanging">${esc(t.text)}</text>`; }).join('');
    return `<figure><svg class="ink" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${box.w} ${box.h}" role="img" aria-label="原始笔迹与图形">${paths}${texts}</svg><figcaption>原始笔迹与图形（可放大或打印）</figcaption></figure>`;
  }
  answer(value: unknown, question?: QuestionNode, includeSource = true): string {
    if (value === null || value === undefined) return '<p class="muted">未保存内容或内容已清空</p>';
    const row = rec(value); const data = rec(question?.data);
    const entries = (raw: unknown) => new Map(list(raw).map(v => [String(rec(v).id ?? rec(v).key ?? ''), String(rec(v).text ?? '')]));
    const names = (values: unknown, options: unknown, showKey = false) => {
      const map = entries(options);
      return list(values).map(v => map.has(String(v)) ? `${showKey ? `${String(v)} · ` : ''}${map.get(String(v))}` : showKey ? String(v) : '原条目已无法关联');
    };
    let readable = '';
    if (['text/v1', 'fill/v1'].includes(String(row.format)) && typeof row.text === 'string') readable = this.text(row.text);
    if (row.format === 'fill-multi/v1') readable = this.fields(row.texts);
    if (row.format === 'choice/v1') readable = this.fields(names(row.selected, question?.type === 'true-false' ? [{ key: 'T', text: '对' }, { key: 'F', text: '错' }] : data.options, true));
    if (row.format === 'order/v1') readable = this.fields(names(row.order, data.items));
    if (row.format === 'match/v1') {
      const left = entries(data.left); const right = entries(data.right);
      readable = this.fields(list(row.pairs).map(p => `${left.get(String(rec(p).leftId)) ?? '原左项已无法关联'} → ${right.get(String(rec(p).rightId)) ?? '原右项已无法关联'}`));
    }
    if (row.format === 'categorize/v1') {
      const items = entries(data.items); const zones = entries(data.zones);
      readable = this.fields(Object.entries(rec(row.assignment)).map(([id, zone]) => `${items.get(id) ?? '原条目已无法关联'} → ${zones.get(String(zone)) ?? '原分类框已无法关联'}`));
    }
    const image = rec(row.drawing).image || (row.format === 'photo/v1' ? row.url : null);
    if (typeof image === 'string') readable += this.image(image, '学生原始作品');
    else readable += this.ink(value);
    // Unknown answer formats retain their content, with internal metadata filtered out.
    return readable + (includeSource || !readable ? `<details${readable ? '' : ' open'}><summary>完整作答内容</summary>${this.fields(value, data)}</details>` : '');
  }
}

// Navigation icons reuse the application's simple outline language.
function archiveIcon(kind: string): string {
  const paths: Record<string, string> = {
    overview: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    worksheets: '<path d="M8 4H5v17h14V4h-3"/><rect x="8" y="2" width="8" height="4" rx="1"/><path d="m8 11 1 1 2-2m2 1h3m-8 5h8"/>',
    explorer: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M7 6.5h.01M10 6.5h.01m-2 6-2 2 2 2m8-4 2 2-2 2m-3-5-2 7"/>',
    companion: '<path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-1-1 1.5-4A8.5 8.5 0 1 1 21 11.5Z"/><path d="M8 11h.01M12 11h.01M16 11h.01"/>',
    participants: '<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3m1-16a3 3 0 0 1 0 6m2 10v-3a6 6 0 0 0-2-4"/>',
    notes: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M8 13h8m-8 4h6"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
    print: '<path d="M6 9V3h12v6M6 17H3v-8h18v8h-3"/><path d="M6 14h12v7H6zM17 11h.01"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  };
  return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${paths[kind] || paths.notes}</svg>`;
}
function archiveEmpty(title: string, description: string): string {
  return `<div class="empty-state">${archiveIcon('notes')}<strong>${esc(title)}</strong><p>${esc(description)}</p></div>`;
}
interface ArchiveRecord { id: string; title: string; subtitle: string; body: string; number?: string; group?: string; count?: number }
function archiveBrowser(records: ArchiveRecord[], name: string, placeholder: string, count = records.length): string {
  let group = '';
  const directory = records.map((record, i) => {
    const groupHeading = record.group && record.group !== group ? `<div class="directory-group" data-group-label="${esc(record.group)}">${esc(record.group)}</div>` : '';
    group = record.group || group;
    return `${groupHeading}<button type="button" class="record-button${i ? '' : ' is-active'}" data-record-button="${record.id}" data-title="${esc(record.title)}" data-group="${esc(record.group || '')}" aria-pressed="${i === 0}" title="${esc(record.title)}">${record.number ? `<span class="item-number">${esc(record.number)}</span>` : ''}<span><strong>${esc(record.title)}</strong><small>${esc(record.subtitle)}</small></span>${record.count === undefined ? '' : `<span class="record-count">${record.count}</span>`}</button>`;
  }).join('');
  return `<div class="browse"><aside class="directory" aria-label="${esc(name)}"><div class="directory-head"><h2>${esc(name)} <span class="meta">${count}</span></h2><label class="search-box">${archiveIcon('search')}<input type="search" data-directory-filter placeholder="${esc(placeholder)}" aria-label="${esc(placeholder)}"></label></div><div class="directory-list">${directory}<p class="directory-empty" hidden>没有匹配的记录</p></div></aside><div class="reader">${records.map((record, i) => `<article class="record-panel${i ? '' : ' is-active'}" id="${record.id}" data-record-panel data-record-title="${esc(record.title)}">${record.body}</article>`).join('') || archiveEmpty('这里还没有记录', '本资料包只展示课堂中已经保存的内容。')}</div></div>`;
}
function archiveTabs(id: string, tabs: { name: string; content: string }[]): string {
  return `<div class="tabbed"><div class="tabs" role="tablist" aria-label="查看内容" data-tabs>${tabs.map((tab, i) => `<button type="button" role="tab" id="${id}-tab-${i}" aria-controls="${id}-pane-${i}" aria-selected="${i === 0}" tabindex="${i ? '-1' : '0'}">${esc(tab.name)}</button>`).join('')}</div>${tabs.map((tab, i) => `<div role="tabpanel" class="tab-panel${i ? '' : ' is-active'}" id="${id}-pane-${i}" aria-labelledby="${id}-tab-${i}">${tab.content}</div>`).join('')}</div>`;
}

export function buildArchiveBody(data: ClassroomArchiveData, view: ArchiveView, _webappLinks: Map<string, string | null>, exportedAt: Date): string {
  const { classroom: c, participants, worksheets } = data;
  type Participant = typeof participants[number];
  type Answer = typeof data.responses[number]['answers'][number];
  const participantOf = (id: string) => participants.find(p => p.id === id || p.studentId === id);
  const nameOf = (id: string) => { const p = participantOf(id); return p?.student?.name || c.groups.find(g => g.id === p?.groupId)?.name || '原参与者'; };
  for (const p of participants) { view.participantNames.set(p.id, nameOf(p.id)); if (p.studentId) view.participantNames.set(p.studentId, nameOf(p.id)); }
  const membersOf = (p: Participant) => c.groups.find(g => g.id === p.groupId)?.members ?? [];
  const personIndex = (id: string) => participants.findIndex(p => p.id === id || p.studentId === id);
  const agentName = (id: string | null) => data.agents.find(a => a.id === id)?.name || (id ? '原学伴' : '未记录学伴');
  const personLink = (id: string) => `<button type="button" class="inline-link" data-go-view="participants" data-go-record="person-${personIndex(id)}">${esc(nameOf(id))}</button>`;
  const detail = (summary: string, value: unknown) => { const content = view.fields(value); return content ? `<details class="details-row"><summary>${esc(summary)}</summary>${content}</details>` : ''; };
  const heading = (eyebrow: string, title: string, description = '') => `<div class="record-heading"><p class="eyebrow">${esc(eyebrow)}</p><h2>${esc(title)}</h2>${description ? `<p>${esc(description)}</p>` : ''}</div>`;
  const subheading = (title: string) => `<div class="record-subheading"><h3>${esc(title)}</h3><span class="line"></span></div>`;
  const members = (p: Participant) => `<div class="roster-members">${p.type === 'group' ? membersOf(p).map(m => `<span class="member-chip">${esc(m.name)}${m.studentNo ? ` · ${esc(m.studentNo)}` : ''}</span>`).join('') : `<span class="member-chip">学号 ${esc(p.student?.studentNo || '未记录')}</span>`}</div>`;
  const recordHeading = (viewName: string, title: string, description: string) => `<div class="page-heading"><div><p class="eyebrow">课堂资料 / ${esc(viewName)}</p><h1>${esc(title)}</h1><p>${esc(description)}</p></div><span class="tag heading-meta"><span class="pill-dot"></span>离线记录</span></div>`;
  const rosterOptions = `<option value="">全部学生与小组</option>${participants.map((p, i) => `<option value="${i}">${esc(nameOf(p.id))}</option>`).join('')}`;
  const nodes = new Map<string, QuestionNode>();
  const taskTitles = new Map<string, string>();
  const topics = new Map<string, string>();
  const sheetNodes = (w: typeof worksheets[number]) => list(rec(w.content).nodes).length ? list(rec(w.content).nodes) : list(w.content);
  for (const w of worksheets) {
    const walk = (raws: unknown[], topic: string) => raws.forEach(raw => {
      const row = rec(raw); const node = { ...row, data: rec(row.data), children: list(row.children), prompt: String(row.prompt ?? ''), inputMode: row.inputMode || 'keyboard' } as unknown as QuestionNode;
      if (node.type === 'task') walk(node.children, node.prompt || '未命名主题');
      else { nodes.set(`${w.id}:${node.id}`, node); topics.set(`${w.id}:${node.id}`, topic); walk(node.children, topic); }
    });
    walk(sheetNodes(w), '');
    try { for (const q of flattenAnswerable(sheetNodes(w) as QuestionNode[])) taskTitles.set(`${w.id}:${q.node.id}`, `任务 ${q.label}`); } catch { /* Full source stays available for legacy trees. */ }
  }
  const renderQuestion = (node: QuestionNode | undefined, title: string) => {
    if (!node) return archiveEmpty('原任务材料已无法关联', '已保存作答和评价中的任务快照仍完整保留。');
    let paper;
    try { paper = paperQuestion(node, title, { full: 1, half: 0 }); }
    catch { view.assets.addWarning(`${title} 的旧格式无法生成排版，完整内容仍保留在任务设置中。`); }
    return `<div class="reading-block"><p class="reading-label">任务要求</p><div class="question-prompt">${view.text(node.prompt)}</div>${typeof node.data.promptImageUrl === 'string' ? view.image(node.data.promptImageUrl, '任务配图') : ''}${paper?.body.map(line => `<div class="option-line">${view.text(inlineText(line))}</div>`).join('') || ''}${node.autoGrade === false ? '<div class="answer-reference"><strong>作答用途</strong>信息收集，不判对错、不计分。</div>' : `<div class="answer-reference"><strong>参考答案 / 评价依据</strong>${esc(node.type === 'drawing' ? '参考要求及已有作品见下方完整任务记录' : paper?.answerNote || (paper ? inlineText(paper.answer) : '') || '未设置')}</div>`}</div>${detail('查看完整任务要求、答案与设置', Object.fromEntries(Object.entries(node).filter(([k]) => k !== 'children')))}`;
  };
  const renderAnswer = (a: Answer, sheetId: string, participantId: string, showTask = false) => {
    const node = nodes.get(`${sheetId}:${a.questionId}`);
    const p = participantOf(participantId);
    const display = nameOf(participantId);
    const gradeCaption = node?.autoGrade === false ? '信息收集 · 不计分' : gradeLabel(a);
    const reviews = a.reviews.map((r, i) => `<article class="review-entry"><h4>第 ${i + 1} 次作品 · ${esc(date(r.createdAt))}</h4><p class="meta">${esc(status[r.status] || r.status)} · ${r.source === 'student' ? '学生提交' : '教师评价'}${r.score === null ? '' : ` · <span class="review-score">${r.score} / ${r.maxScore} ${esc(r.unit)}</span>`}</p>${view.answer(r.value, (rec(r.question).node || r.question) as QuestionNode, false)}${r.reason ? `<p class="reading-label">评分理由</p>${view.text(r.reason)}` : ''}${r.advice ? `<p class="reading-label">评价建议</p>${view.text(r.advice)}` : ''}${r.error ? `<p class="notice">${esc(r.error)}</p>` : ''}${detail('本次评价的任务与时间记录', Object.fromEntries(Object.entries(r).filter(([k]) => !['value', 'reason', 'advice', 'error'].includes(k))))}</article>`).join('');
    return `<article class="answer-card" data-participant="${personIndex(participantId)}"><div class="answer-card-head"><span class="avatar">${esc(display.slice(0, 1))}</span><div><strong>${personLink(participantId)}</strong><div class="meta">${p?.type === 'group' ? '小组共同作答' : p?.student?.studentNo ? `学号 ${esc(p.student.studentNo)}` : '个人作答'}</div></div><div class="answer-status">${esc(status[a.status] || a.status)}${a.score === null || node?.autoGrade === false ? '' : ` · 得分 ${a.score}`}<div class="meta">${esc(gradeCaption)}</div></div></div><div class="answer-card-body">${showTask ? `<h4>${esc(taskTitles.get(`${sheetId}:${a.questionId}`) || '原任务')} · ${esc(node?.prompt || '原任务材料已无法关联')}</h4>` : ''}${view.answer(a.value, node, false)}<p class="meta">提交 ${esc(date(a.submittedAt))}${a.savedAt ? ` · 最近保存 ${esc(date(a.savedAt))}` : ''}</p>${detail('作答详情与时间记录', Object.fromEntries(Object.entries(a).filter(([k]) => !['reviews', 'value'].includes(k))))}${reviews ? `<details><summary>作品与评价历史 · ${a.reviews.length} 次</summary><div class="review-list">${reviews}</div></details>` : ''}</div></article>`;
  };
  const analysesFor = (sheetId: string, questionId: string) => data.analyses.filter(a => a.worksheetId === sheetId && a.questionId === questionId).map(a => `<article class="reading-block"><p class="meta">${esc(date(a.analyzedAt))} · ${esc(agentName(a.agentId))}</p>${view.text(a.narrative || '尚无班级分析原文')}${detail('完整分析依据与逐人评价', a)}</article>`).join('');
  const taskRecords: ArchiveRecord[] = [];
  for (const [wi, w] of worksheets.entries()) {
    const questionIds = new Set([...nodes.keys()].filter(k => k.startsWith(`${w.id}:`)).map(k => k.slice(w.id.length + 1)));
    for (const r of data.responses.filter(r => r.worksheetId === w.id)) for (const a of r.answers) questionIds.add(a.questionId);
    for (const a of data.analyses.filter(a => a.worksheetId === w.id)) questionIds.add(a.questionId);
    let qi = 0;
    for (const id of questionIds) {
      const node = nodes.get(`${w.id}:${id}`); const key = `task-${wi}-${qi++}`;
      const label = taskTitles.get(`${w.id}:${id}`) || '原任务';
      const title = node?.prompt || '原任务材料已无法关联';
      const answers = data.responses.filter(r => r.worksheetId === w.id).flatMap(r => r.answers.filter(a => a.questionId === id).map(a => renderAnswer(a, w.id, r.participantId)));
      const analyses = analysesFor(w.id, id);
      const analysisCount = data.analyses.filter(a => a.worksheetId === w.id && a.questionId === id).length;
      taskRecords.push({ id: key, title, subtitle: `${label} · ${node ? questionTypeNickname(node.type) : '已有作答'}`, group: `${w.title}${topics.get(`${w.id}:${id}`) ? ` / ${topics.get(`${w.id}:${id}`)}` : ''}`, number: label.replace('任务 ', ''), count: answers.length,
        body: heading(`${w.title}${topics.get(`${w.id}:${id}`) ? ` / ${topics.get(`${w.id}:${id}`)}` : ''}`, `${label} · ${node ? questionTypeNickname(node.type) : '原任务'}`,  `${node ? questionTypeNickname(node.type) : '原任务'} · ${answers.length} 份已保存作答`) + (node ? `<div class="task-context">${view.text(node.prompt)}<button type="button" class="inline-link" data-open-tab="${key}-pane-1">查看任务与参考</button></div>` : '') + archiveTabs(key, [
          { name: `学生作答 ${answers.length}`, content: `<div class="response-toolbar"><p>按原始记录查看，保留草稿与已提交内容</p><select data-response-filter aria-label="筛选作答学生或小组">${rosterOptions}</select></div>${answers.join('') || archiveEmpty('暂无已保存作答', '没有作答记录的学生不会被补造为已作答。')}` },
          { name: '任务与参考', content: renderQuestion(node, label) },
          { name: `已有分析 ${analysisCount}`, content: analyses || archiveEmpty('暂无已保存分析', '本资料包不生成新的分析，已有结果会原样保留。') },
        ]),
      });
    }
    taskRecords.push({ id: `sheet-info-${wi}`, title: '学习单说明与完整设置', subtitle: w.title, group: w.title,
      body: heading('学习单 / 材料记录', w.title, `最后修改 ${date(w.updatedAt)}`) + view.text(w.description) + detail('学习单设置', w.settings) + detail('完整主题与任务原文', w.content) + detail('材料信息', { id: w.id, title: w.title, description: w.description, schemaVersion: w.schemaVersion, createdAt: w.createdAt, updatedAt: w.updatedAt }),
    });
  }
  const responsesFor = (p: Participant) => data.responses.filter(r => r.participantId === p.id).map(r => `${subheading(worksheets.find(w => w.id === r.worksheetId)?.title || '原学习单')}<p class="meta">${esc(status[r.status] || r.status)} · 开始 ${esc(date(r.startedAt))} · 提交 ${esc(date(r.submittedAt))}</p>${r.answers.map(a => renderAnswer(a, r.worksheetId, p.id, true)).join('') || archiveEmpty('暂无已保存作答', '该学习单已有参与记录，但没有保存具体作答。')}`).join('');
  const parseList = (value: string | null): unknown[] => { if (!value) return []; try { const parsed: unknown = JSON.parse(value); return Array.isArray(parsed) ? parsed : [value]; } catch { return [value]; } };
  const messagesFor = (p: Participant) => p.messages.map(m => {
    const files = parseList(m.fileUrls), fileNames = parseList(m.fileNames);
    const sender = m.role === 'user' ? nameOf(p.id) : m.role === 'assistant' ? agentName(m.agentId) : m.role;
    return `<article class="message${m.role === 'user' ? ' is-user' : ''}"><div class="message-head"><span class="avatar">${m.role === 'assistant' ? archiveIcon('companion') : esc(sender.slice(0, 1))}</span><strong>${esc(sender)}</strong><time>${esc(date(m.createdAt))}${m.roundIndex === null ? '' : ` · ${m.roundIndex} 轮`}</time></div><div class="message-body">${view.text(m.content)}${files.map((u, i) => {
      if (typeof u !== 'string') return view.fields(u);
      const local = view.assets.attachment(u);
      return /\.(png|jpe?g|webp)$/i.test(u) ? view.image(u, String(fileNames[i] || '对话附件')) : local ? `<p><a class="button" href="${esc(archiveLink(local))}" download>${archiveIcon('notes')}${esc(fileNames[i] || u)}</a></p>` : `<p class="notice">附件未打包：${esc(fileNames[i] || u)} · ${esc(u)}</p>`;
    }).join('')}${m.followUps ? detail('追问建议', parseList(m.followUps)) : ''}${m.displayName && m.displayName !== sender ? detail('当时显示名称', m.displayName) : ''}</div></article>`;
  }).join('');
  const participantRecords = participants.map((p, i): ArchiveRecord => {
    const answerCount = data.responses.filter(r => r.participantId === p.id).reduce((n, r) => n + r.answers.length, 0);
    return { id: `person-${i}`, title: nameOf(p.id), subtitle: p.type === 'group' ? `${membersOf(p).length} 名组员 · ${answerCount} 份作答` : `学号 ${p.student?.studentNo || '未记录'} · ${answerCount} 份作答`, number: String(i + 1),
      body: heading(p.type === 'group' ? '小组档案 / 共同活动记录' : '学生档案 / 课堂活动记录', nameOf(p.id), p.type === 'group' ? '以下为小组共同记录，不代表每位组员的独立作答。' : '集中查看本堂课中已保存的作答与活动。') + members(p) + archiveTabs(`person-${i}`, [
        { name: `学习单作答 ${answerCount}`, content: responsesFor(p) || archiveEmpty('暂无已保存作答', '该参与者没有保存学习单作答。') },
        { name: `学伴对话 ${p.messages.length}`, content: `<div class="conversation">${messagesFor(p) || archiveEmpty('暂无已保存对话', '该参与者没有保存与智能学伴的对话。')}</div>` },
        { name: '档案信息', content: view.fields(p.type === 'group' ? membersOf(p).map(m => ({ name: m.name, studentNo: m.studentNo })) : p.student) + detail('加入时间与活动统计', { ...Object.fromEntries(Object.entries(p).filter(([k]) => !['messages', 'student'].includes(k))), interactions: data.interactions.filter(r => r.studentId === p.id) }) },
      ]),
    };
  });
  const companionRecords = participants.map((p, i): ArchiveRecord => ({
    id: `chat-${i}`, title: nameOf(p.id), subtitle: p.type === 'group' ? `小组共同对话 · ${p.messages.length} 条消息` : `学号 ${p.student?.studentNo || '未记录'} · ${p.messages.length} 条消息`, number: String(i + 1), count: p.messages.length,
    body: `<div class="conversation-top"><div>${heading('智能学伴 / 原始对话', nameOf(p.id), `${p.messages.length} 条消息 · 完整保存原文、时间与附件`)}</div><button class="button quiet" type="button" data-go-view="participants" data-go-record="person-${i}">查看档案 ${archiveIcon('arrow')}</button></div><div class="conversation">${messagesFor(p) || archiveEmpty('暂无已保存对话', '该参与者没有保存与智能学伴的对话。')}</div>`,
  }));
  const groupMaterials = c.groups.map(g => ({ name: g.name, members: g.members.map(m => ({ name: m.name, studentNo: m.studentNo })), materials: g.materials.filter(m => m.kind !== 'webapp').map(m => ({ kind: { agent: '智能学伴', worksheet: '学习单', webapp: '探究空间' }[m.kind] || m.kind, title: data.worksheets.find(w => w.id === m.targetId)?.title || data.webapps.find(w => w.id === m.targetId)?.name || agentName(m.targetId), targetId: m.targetId })) }));
  const notificationTarget = (n: typeof data.notifications[number]) => n.groupId ? c.groups.find(g => g.id === n.groupId)?.name || '原小组' : n.studentId ? nameOf(n.studentId) : '全班';
  const submitted = data.responses.reduce((count, r) => count + r.answers.filter(a => a.status === 'submitted').length, 0);
  const taskCount = taskRecords.length - worksheets.length;
  const totalMessages = participants.reduce((sum, p) => sum + p.messages.length, 0);
  const classes = c.classes.map(cc => cc.class.name).join('、') || '未关联班级';
  const moduleEntry = (kind: string, name: string, description: string, count: number, unit: string) => `<button type="button" class="module-entry" data-go-view="${kind}"><span class="module-symbol">${archiveIcon(kind)}</span><span><strong>${name}</strong><p>${esc(description)}</p></span><span class="module-number"><b>${count}</b>${unit}</span><span class="module-arrow">${archiveIcon('arrow')}</span></button>`;
  const sidebarLinks = [ ['overview', '课堂概览', ''], ['worksheets', '学习单', String(taskCount)], ['companion', '智能学伴', String(totalMessages)], ['participants', '学生与小组', String(participants.length)], ['notes', '附件与说明', String(view.assets.inventory.length)] ].map(([key, label, count], i) => `${i === 1 ? '<div class="sidebar-caption">学习模块</div>' : i === 4 ? '<div class="sidebar-caption">课堂资料</div>' : ''}<a href="#${key}" data-nav="${key}" class="${i ? '' : 'is-active'}">${archiveIcon(key)}<span>${label}</span>${count ? `<span class="nav-count">${count}</span>` : ''}</a>`).join('');
  return `<aside class="sidebar" aria-label="课堂记录导航"><button id="sidebar-close" class="sidebar-close" type="button" aria-label="关闭导航">${archiveIcon('close')}</button><div class="brand"><span class="brand-mark">${archiveIcon('worksheets')}</span><div><strong>支点课堂</strong><small>CLASSROOM ARCHIVE</small></div></div><div class="sidebar-context"><strong title="${esc(c.title || '未命名课堂')}">${esc(c.title || '未命名课堂')}</strong><small>${esc(classes)}</small></div><nav>${sidebarLinks}</nav><div class="sidebar-bottom"><strong><span class="pill-dot"></span>离线资料包</strong><p>完整记录，随时回看</p><p>${esc(exportedAt.toLocaleDateString('zh-CN'))} 导出</p></div></aside><div class="backdrop" aria-hidden="true"></div>
<div class="workspace"><header class="topbar"><button id="menu-toggle" class="icon-button mobile-menu" type="button" aria-label="打开导航" aria-expanded="false">${archiveIcon('menu')}</button><div class="breadcrumb"><span>课堂档案</span><span>/</span><strong id="breadcrumb-current">课堂概览</strong></div><div class="topbar-tools"><div class="global-search"><label class="search-box">${archiveIcon('search')}<input id="global-search" type="search" placeholder="搜索任务、学生或对话" aria-label="搜索任务、学生或对话" autocomplete="off"><kbd>/</kbd></label><div class="search-results" id="search-results" aria-label="搜索结果" hidden></div></div><a class="button quiet text-export" href="${esc(archiveLink('课堂完整记录.txt'))}" download>文字记录</a><button type="button" id="expand-current" class="button quiet toolbar-expand">展开当前记录</button><button type="button" id="print-current" class="button toolbar-print" title="打印当前记录或保存 PDF" aria-label="打印当前记录">${archiveIcon('print')}<span>打印当前记录</span></button></div></header>
<main><section class="view is-active" data-view="overview" id="overview">${recordHeading('课堂概览', c.title || '未命名课堂', `${classes} · ${status[c.mode] || c.mode} · ${date(c.endedAt)} 结束`)}<div class="overview-grid"><div class="overview-main"><div class="metrics"><div class="metric"><span>${participants.some(p => p.type === 'group') ? '参与小组 / 个人记录' : '参与者记录'}</span><strong>${participants.length}</strong><small>${participants.some(p => p.type === 'group') ? '条' : '人'}</small></div><div class="metric"><span>学习任务</span><strong>${taskCount}</strong><small>项任务</small></div><div class="metric"><span>已提交作答</span><strong>${submitted}</strong><small>份作答</small></div><div class="metric"><span>学伴对话</span><strong>${totalMessages}</strong><small>条消息</small></div></div><div class="section-title"><h2>从学习模块开始回看</h2><span>原始材料与课堂记录</span></div><div class="surface module-list">${moduleEntry('worksheets', '学习单', '任务要求、学生作答、作品与评价历史', worksheets.length, '份学习单')}${moduleEntry('companion', '智能学伴', '按学生与小组查看完整对话和附件', totalMessages, '条消息')}</div><div class="notification-list"><div class="section-title"><h2>教师通知</h2><span>${data.notifications.length} 条已保存通知</span></div>${data.notifications.map(n => `<article class="notification"><div><p class="meta">${esc(notificationTarget(n))} · ${esc(date(n.createdAt))}</p>${view.text(n.content)}</div></article>`).join('') || '<p class="info-line">本堂课没有已保存的教师通知。</p>'}</div></div><aside class="overview-aside"><div class="surface class-facts"><h2>课堂信息</h2><dl><div class="fact"><dt>所属班级</dt><dd>${esc(classes)}</dd></div><div class="fact"><dt>课堂模式</dt><dd>${esc(status[c.mode] || c.mode)}</dd></div><div class="fact"><dt>创建时间</dt><dd>${esc(date(c.createdAt))}</dd></div><div class="fact"><dt>结束时间</dt><dd>${esc(date(c.endedAt))}</dd></div><div class="fact"><dt>资料导出时间</dt><dd>${esc(date(exportedAt))}</dd></div></dl></div><div class="archive-note"><strong>把课堂完整留下来</strong>本资料包可直接离线查看。点击图片可放大，查看记录时可随时切换任务或学生。<br>供阅读、分享与分析；迁移恢复请使用系统备份。</div></aside></div><div class="context-details">${detail('课堂完整设置与学习模块配置', Object.fromEntries(Object.entries(c).filter(([k]) => !['classes', 'groups', 'classroomAgents', 'worksheets', 'webapps', 'webappCaptureEnabled'].includes(k))))}${groupMaterials.length ? detail('课堂分组、成员与材料对应', groupMaterials) : ''}</div></section>
<section class="view" data-view="worksheets" id="worksheets">${recordHeading('学习单', '按任务，回看每一份作答', `${worksheets.length} 份学习单 · ${taskCount} 项任务 · 任务材料与作答分别查看`)}${archiveBrowser(taskRecords, '任务目录', '查找任务', taskCount)}</section>
<section class="view" data-view="companion" id="companion">${recordHeading('智能学伴', '回到课堂中的每一次对话', `${totalMessages} 条消息 · 保留原文、发言者、时间与附件`)}${archiveBrowser(companionRecords, '对话参与者', '查找学生或小组')}${detail('课堂及历史消息中使用的智能体信息', data.agents)}</section>
<section class="view" data-view="participants" id="participants">${recordHeading('学生与小组', '把一个参与者的记录放在一起', '从学习单到学伴对话，按学生或小组集中查看')}${archiveBrowser(participantRecords, '学生与小组', '查找姓名或学号')}${detail('课堂安全提醒记录', data.warnings.map(w => ({ name: nameOf(w.studentId), ...w })))}</section>
<section class="view" data-view="notes" id="notes">${recordHeading('附件与说明', '资料完整，查看有据', '下载原始附件，了解这份资料包的保存范围')}<div class="surface files-surface"><div class="section-title"><h2>文件检查结果</h2><a class="button quiet" href="${esc(archiveLink('文件检查说明.txt'))}" download>下载检查说明</a></div>__ARCHIVE_WARNINGS__</div><div class="note-grid"><article><h3>已保存的记录，原样保留</h3><p>资料包独立保存导出时已有的数据与附件。普通任务保留当前作答；AI 评价任务额外保留已有作品和评价历史。小组共同作答不会归为每名成员的独立作答。</p></article><article><h3>未记录的过程，不作补全</h3><p>旧课堂没有完整的材料、班级和个人姓名历史快照，按系统当前保存内容导出；已有评价中的任务快照单独保留。探究空间不纳入资料导出。</p></article></div><div class="surface files-surface"><div class="section-title"><h2>原始附件清单</h2><label class="search-box">${archiveIcon('search')}<input id="file-filter" type="search" placeholder="查找文件" aria-label="查找文件"></label></div><div class="table-wrap" id="file-inventory">__ARCHIVE_INVENTORY__</div></div><div class="info-line">资料包不包含管理密码、API 密钥或账号凭据。用于阅读与分析，不能用于恢复系统数据。</div><button type="button" class="button" id="print-all">${archiveIcon('print')}打印整堂课 / 保存 PDF</button></section>
<footer><span>支点课堂 · 课堂资料包</span><span>解压后直接打开 · 请保留附件目录结构 · 完整内容另见“课堂完整记录.txt”</span></footer></main></div>
<div class="picture-overlay" id="picture-overlay" role="dialog" aria-modal="true" aria-label="图片查看器" hidden><div class="picture-toolbar"><strong id="picture-title">查看图片</strong><button type="button" id="zoom-out" aria-label="缩小图片">−</button><button type="button" id="zoom-reset" title="适应窗口"><span id="zoom-value">100%</span></button><button type="button" id="zoom-in" aria-label="放大图片">＋</button><a id="picture-download" href="#" download>下载原图</a><button type="button" id="picture-close" aria-label="关闭图片查看器">关闭 ${archiveIcon('close')}</button></div><div class="picture-stage" id="picture-stage"></div><div class="picture-caption">点击空白处或按 Esc 关闭 · 原始文件保留在附件目录中</div></div>
<noscript><style>.view,.record-panel,.tab-panel{display:block!important}.sidebar,.topbar,.directory,.tabs,footer{display:none!important}.workspace{margin-left:0!important}</style><p>浏览器未启用脚本，以下按顺序展示全部课堂记录。</p></noscript>`;
}

export function archiveHtml(title: string, body: string): string {
  const hash = createHash('sha256').update(ARCHIVE_SCRIPT).digest('base64');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'sha256-${hash}'; base-uri 'none'; object-src 'none'; form-action 'none'"><title>${esc(title)} · 课堂完整记录</title><style>${ARCHIVE_STYLE}</style></head><body>${body}<script>${ARCHIVE_SCRIPT}</script></body></html>`;
}

/** Text is a second, readable full record, not JSON or a truncated AI summary. */
export function archiveText(htmlBody: string): string {
  return htmlBody.replace(/<(style|script|noscript)\b[^>]*>[\s\S]*?<\/\1>/g, '').replace(/<svg\b(?=[^>]*class="ink")[\s\S]*?<\/svg>/g, '\n[笔迹图请在离线网页查看；可放大查看或打印]\n').replace(/<svg\b[\s\S]*?<\/svg>/g, '').replace(/<\/(?:p|div|h\d|article|section|details|summary|dt|dd|li|tr|header|footer)>/g, '\n').replace(/<\/t[dh]>/g, '\t').replace(/<[^>]*>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/\n{3,}/g, '\n\n');
}
