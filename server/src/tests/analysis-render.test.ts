/**
 * ★ M7a：联系表的光栅化。**本文件是这一批唯一碰 sharp 的**（同 `ink-render.ts` 的分界纪律：
 * 分界线就是「有没有碰 sharp」）。
 *
 * ⚠️ 本机**看不见图**（没有能看图的渲染环境，也没有视觉模型）⇒
 * 「联系表长什么样、格子里的字清不清楚」**一条都验不了**。
 * 能验的只有：出来的是不是**真 PNG**、尺寸对不对、**渲染不出来时回 `null` 而不是抛**、
 * 以及**标签探针说得准不准**。
 *
 * 🔴 探针那一条是整个 Task 5 里最要紧的：打包后的应用可能带着**没有 fontconfig 的
 * sharp 构建**，那时 SVG `<text>` **无声地画不出来** —— 图是真的、格子都在、构建不报错，
 * 只是没有标签，而 AI 因此**认不出哪幅是谁的** ⇒ 分析结果整体错位，比没有分析更坏。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSheetSvg, labelsRenderOk, renderSheets } from '../services/analysis-render.js';
import { DEFAULT_ANALYSIS_KNOBS, layoutSheets, type AnalyzeEntry } from '../services/analysis-payload.js';

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

const inkEntry = (id: string, strokes: number): AnalyzeEntry => ({
  studentId: id,
  kind: 'ink',
  ink: {
    format: 'ink/v1',
    canvas: { w: 320, h: 240 },
    strokes: Array.from({ length: strokes }, () => ({
      points: [[0.1, 0.1], [0.9, 0.9]] as Array<[number, number]>,
      width: 0.01,
      color: '#111111',
    })),
  },
});
const labels = (ids: string[]): Map<string, string> =>
  new Map(ids.map((id, i) => [id, `User_${String(i + 1).padStart(3, '0')}`]));

test('★ 渲染出的是真 PNG（magic number 对得上）', async () => {
  const entries = [inkEntry('p1', 2), inkEntry('p2', 3)];
  const layouts = layoutSheets(entries, labels(['p1', 'p2']), DEFAULT_ANALYSIS_KNOBS);
  const result = await renderSheets(entries, layouts, DEFAULT_ANALYSIS_KNOBS);
  assert.notEqual(result, null, 'sharp 够用时不该回 null');
  assert.equal(result!.sheets.length, 1);
  const png = result!.sheets[0];
  assert.ok(png.length > 0, '不该是空 buffer');
  assert.ok(png.subarray(0, 4).equals(PNG_MAGIC), '必须是真 PNG');
  assert.equal(typeof result!.labeled, 'boolean');
});

test('多张：40 份 ⇒ 4 张图，每张都是真 PNG', async () => {
  const ids = Array.from({ length: 40 }, (_, i) => `p${String(i + 1).padStart(3, '0')}`);
  const entries = ids.map((id) => inkEntry(id, 1));
  const layouts = layoutSheets(entries, labels(ids), DEFAULT_ANALYSIS_KNOBS);
  assert.equal(layouts.length, 4);
  const result = await renderSheets(entries, layouts, DEFAULT_ANALYSIS_KNOBS);
  assert.notEqual(result, null);
  assert.equal(result!.sheets.length, 4);
  for (const png of result!.sheets) assert.ok(png.subarray(0, 4).equals(PNG_MAGIC));
});

test('🔴 空笔迹与 unknown 的格子不阻断渲染（那一格画成灰底，整张图照出）', async () => {
  const entries: AnalyzeEntry[] = [
    { studentId: 'p1', kind: 'ink',
      ink: { format: 'ink/v1', canvas: { w: 320, h: 240 }, strokes: [] } },
    { studentId: 'p2', kind: 'unknown' },
    { studentId: 'p3', kind: 'text', text: '写了文字' },
    inkEntry('p4', 5),
  ];
  const layouts = layoutSheets(entries, labels(['p1', 'p2', 'p3', 'p4']), DEFAULT_ANALYSIS_KNOBS);
  const result = await renderSheets(entries, layouts, DEFAULT_ANALYSIS_KNOBS);
  assert.notEqual(result, null, '有空格子不等于渲染失败');
  assert.equal(result!.sheets.length, 1);
  assert.ok(result!.sheets[0].subarray(0, 4).equals(PNG_MAGIC));
});

test('🔴 零张布局 ⇒ 回一个「零张」而不是 null，也不抛（教师刚点开而全班还没交）', async () => {
  const result = await renderSheets([], [], DEFAULT_ANALYSIS_KNOBS);
  assert.notEqual(result, null, 'sharp 够用时，零张布局也该回一个空集，而不是「渲染失败」');
  assert.deepEqual(result!.sheets, []);
});

test('🔴 探针返回布尔（本机实测 sharp 的文字能渲染 ⇒ true；打包环境缺 fontconfig 会是 false）', async () => {
  const ok = await labelsRenderOk();
  assert.equal(typeof ok, 'boolean');
  // ⚠️ **不硬断言 true** —— 那会让打包环境上的用例红，而它红的是一件真事而不是缺陷。
  // 这里只要求「它给得出一个答案」，以及**探针与渲染的一致性**由下一条钉。
});

test('🔴 探针与渲染必须自洽：探针说不能画标签时，renderSheets 的 labeled 也必须是假', async () => {
  const entries = [inkEntry('p1', 2)];
  const layouts = layoutSheets(entries, labels(['p1']), DEFAULT_ANALYSIS_KNOBS);
  const probe = await labelsRenderOk();
  const result = await renderSheets(entries, layouts, DEFAULT_ANALYSIS_KNOBS);
  assert.notEqual(result, null);
  assert.equal(result!.labeled, probe,
    'renderSheets 的 labeled 必须与探针同一个答案 —— 两处各算一次就会分叉，而分叉的表现是「界面说有标签、图上没有」');
});

test('🔴 一格的画布框量不出来（canvas = 0×0）不阻断渲染（落回默认比例）', async () => {
  const entries: AnalyzeEntry[] = [{
    studentId: 'p1', kind: 'ink',
    ink: {
      format: 'ink/v1', canvas: { w: 0, h: 0 },
      strokes: [{ points: [[0, 0], [1, 1]] as Array<[number, number]>, width: 0.01, color: '#111111' }],
    },
  }];
  const layouts = layoutSheets(entries, labels(['p1']), DEFAULT_ANALYSIS_KNOBS);
  assert.equal(layouts[0].cells[0].hasInk, true, '有笔画就算有画，与 canvas 量不量得出无关');
  const result = await renderSheets(entries, layouts, DEFAULT_ANALYSIS_KNOBS);
  assert.notEqual(result, null, 'canvas 是 0×0 时 sharp 仍应画出东西（box 只决定比例）');
  assert.ok(result!.sheets[0].subarray(0, 4).equals(PNG_MAGIC));
});

test('🔴 笔画颜色坏掉（不是 #rgb / #rrggbb）不阻断渲染（回落常量色）', async () => {
  const entries: AnalyzeEntry[] = [{
    studentId: 'p1', kind: 'ink',
    ink: {
      format: 'ink/v1', canvas: { w: 320, h: 240 },
      strokes: [{ points: [[0, 0], [1, 1]] as Array<[number, number]>, width: 0.01, color: 'red; }</svg><script>' }],
    },
  }];
  const layouts = layoutSheets(entries, labels(['p1']), DEFAULT_ANALYSIS_KNOBS);
  const result = await renderSheets(entries, layouts, DEFAULT_ANALYSIS_KNOBS);
  assert.notEqual(result, null, '颜色是学生数据，坏值要回落而不是让整张图渲不出来');
  assert.ok(result!.sheets[0].subarray(0, 4).equals(PNG_MAGIC));
});

test('🔴 退化路径（labeled=false）：SVG 里**一个 `<text>` 都没有**（缺 fontconfig 时全靠它）', () => {
  const entries: AnalyzeEntry[] = [
    inkEntry('p001', 2),
    { studentId: 'p002', kind: 'unknown' },
    { studentId: 'p003', kind: 'ink',
      ink: { format: 'ink/v1', canvas: { w: 320, h: 240 }, strokes: [] } },
  ];
  const layouts = layoutSheets(entries, labels(['p001', 'p002', 'p003']), DEFAULT_ANALYSIS_KNOBS);
  const without = buildSheetSvg(entries, layouts[0], false);
  assert.ok(!without.includes('<text'), 'labeled=false 时不许画任何文字 —— 画了也是白画，还会让人以为标签在');
  assert.ok(without.includes('<path'), '笔迹必须照画（只有标签没了）');
  assert.ok(without.includes('<rect'), '底板必须照画（格子边界还在）');
});

test('正常路径（labeled=true）：标签与占位文案都在，且文字都转义过', () => {
  const entries: AnalyzeEntry[] = [
    inkEntry('p001', 2),
    { studentId: 'p002', kind: 'unknown' },
    { studentId: 'p003', kind: 'ink',
      ink: { format: 'ink/v1', canvas: { w: 320, h: 240 }, strokes: [] } },
  ];
  const layouts = layoutSheets(entries, labels(['p001', 'p002', 'p003']), DEFAULT_ANALYSIS_KNOBS);
  const withText = buildSheetSvg(entries, layouts[0], true);
  assert.ok(withText.includes('User_001'), '标签要在');
  assert.ok(withText.includes('形状认不出'), 'unknown 那格要说原因');
  assert.ok(withText.includes('空白'), '空笔迹那格要说「空白」');
  assert.ok(withText.includes('<text'), 'labeled=true 时必须画文字');
});

test('🔴 伪名里的 XML 元字符被转义（标签若来自可控输入，不转义就能闭合标签注脚本）', () => {
  const entries: AnalyzeEntry[] = [inkEntry('p001', 1)];
  const layouts = layoutSheets(entries, new Map([['p001', '<script>alert(1)</script>']]), DEFAULT_ANALYSIS_KNOBS);
  const svg = buildSheetSvg(entries, layouts[0], true);
  assert.ok(!svg.includes('<script>'), '标签必须转义');
  assert.ok(svg.includes('&lt;script&gt;'), '转义后的形式要在');
});

test('🔴 mixed 里**文字作答**那一格不能写「（空白）」—— 他答了字，答案就在同一屏的文档里', () => {
  // 教师中途把作答方式从键盘改成手写时，同一道题的载荷是 `mixed`：联系表把**两种**条目都排进格子。
  // 文字那几格的笔迹是空的 ⇒ 原先落进「（空白）」那一支，而这张图将来是**发给模型**的那份东西
  // ⇒ 模型会读到「这几位没答」。
  const entries: AnalyzeEntry[] = [
    { studentId: 'p001', kind: 'text', text: '我写的是文字答案' },
    inkEntry('p002', 2),
  ];
  const layouts = layoutSheets(entries, labels(['p001', 'p002']), DEFAULT_ANALYSIS_KNOBS);
  const svg = buildSheetSvg(entries, layouts[0], true);
  assert.ok(!svg.includes('（空白）'), '文字作答不是空白');
  assert.ok(svg.includes('文字作答'), '要说清「他是用文字答的，见文档」');
});

test('三种占位文案分得开：空白 / 形状认不出 / 文字作答', () => {
  const entries: AnalyzeEntry[] = [
    { studentId: 'p001', kind: 'ink', ink: { format: 'ink/v1', canvas: { w: 320, h: 240 }, strokes: [] } },
    { studentId: 'p002', kind: 'unknown' },
    { studentId: 'p003', kind: 'text', text: 'x' },
  ];
  const layouts = layoutSheets(entries, labels(['p001', 'p002', 'p003']), DEFAULT_ANALYSIS_KNOBS);
  const svg = buildSheetSvg(entries, layouts[0], true);
  assert.ok(svg.includes('（空白）'), '空笔迹 ⇒ 空白');
  assert.ok(svg.includes('形状认不出'), 'unknown ⇒ 形状认不出');
  assert.ok(svg.includes('文字作答'), 'text ⇒ 文字作答（见文档）');
});
