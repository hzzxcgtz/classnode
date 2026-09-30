/**
 * ★ M6a：笔迹渲染的**跨工程对拍** —— 三份实现必须逐字一致。
 *
 * 🔴 为什么需要它：服务端读不到 `src/`，所以「笔画 → path」在仓里有**两份**实现
 * （`src/lib/worksheet-ink.ts` 与 `server/src/services/ink-path.ts`），
 * 而 `INK_FORMATS` / `isInkFormat` 有**三份**（再加 `server/src/services/worksheet-ink.ts`）。
 * 同一件事多份实现正是本项目反复被咬的那类分叉。这条用例把它钉住：
 * **同一批笔画喂给两边，`d` 串必须逐字相同。**
 *
 * ⚠️ 它**住在前端测试目录**，因为只有这一个 runner 能同时看见两边
 * （根目录的 `node --test` 扫的是 `src/` 下的全部 `*.test.ts`；服务端那一个只吃编译产物）。
 * ⚠️ 注释里**不要写 glob**：`src/` + `**` + `/` + `*.test.ts` 那串里的 `*` 加斜杠会**提前终止
 * 块注释**，余下的文字被当成代码 ⇒ `ERR_INVALID_TYPESCRIPT_SYNTAX`（本文件第一次就是这么挂的）。
 * 跨工程 import 已实测可行（`tsc --noEmit` 也过）；而被加载的两个服务端文件
 * **都没有任何 import**，所以 Node 的类型擦除加载得起来。
 *
 * ⚠️ 它**只保证路径字符串一致**，不保证**光栅化之后一致**（线宽 / 圆角 / 抗锯齿在 sharp 那一侧）。
 * 真机开 Word 看仍然必要 —— 那是验收清单里的一条。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as front from './worksheet-ink.ts';
import * as serverValidate from '../../server/src/services/worksheet-ink.ts';
import * as mirror from '../../server/src/services/ink-path.ts';
import { QUESTION_TYPE_LABELS, QUESTION_TYPE_NICKNAMES } from '../../server/src/services/question-type-labels.ts';
import { QUESTION_TYPE_OPTIONS } from './worksheet-questions.ts';

/** 一批刻意刁钻的笔画：单点 / 空 / 边界 0 与 1 / 会触发两位小数取整的坐标 / 多笔。 */
const BOXES = [
  { w: 320, h: 240 },
  { w: 0, h: 0 },      // 框还没量出来
  { w: 1, h: 1 },      // 极端窄
  { w: 1280, h: 720 },
];
const STROKES = [
  { color: '#111827', width: 0.5, points: [[0, 0], [1, 1]] as Array<[number, number]> },
  { color: '#111827', width: 0.004, points: [[0.5, 0.5]] as Array<[number, number]> },   // 单点
  { color: '#111827', width: 0.3, points: [] as Array<[number, number]> },               // 空
  { color: '#111827', width: 0.12, points: [[1 / 3, 2 / 7], [0.987654, 0.123456]] as Array<[number, number]> },
  { color: '#111827', width: 0.9, points: [[0, 0], [0, 1], [1, 1], [1, 0]] as Array<[number, number]> },
];

test('★ 对拍：同一批笔画 ⇒ 两边的 d 串与线宽逐字相同', () => {
  for (const box of BOXES) {
    for (const stroke of STROKES) {
      const label = `box=${box.w}x${box.h} width=${stroke.width} pts=${stroke.points.length}`;
      assert.equal(mirror.strokePath(stroke.points, box), front.strokePath(stroke.points, box), `strokePath 不一致：${label}`);
      assert.equal(mirror.strokeWidthPx(stroke, box), front.strokeWidthPx(stroke, box), `strokeWidthPx 不一致：${label}`);
    }
  }
});

test('对拍不是空转：至少有一条笔画产出非空 d', () => {
  // 阳性对照 —— 少了它，两个实现**都坏成回空串**也能让上面那条全绿。
  assert.notEqual(front.strokePath(STROKES[0].points, BOXES[0]), '');
  assert.notEqual(mirror.strokePath(STROKES[0].points, BOXES[0]), '');
});

test('★ 三份 INK_FORMATS 必须逐字相同（这是三处重复定义，只有这条用例盯着）', () => {
  assert.deepEqual([...mirror.INK_FORMATS], [...front.INK_FORMATS]);
  assert.deepEqual([...serverValidate.INK_FORMATS], [...front.INK_FORMATS]);
});

test('★ 三份 isInkFormat 对同一批输入必须同判（含认不出的形状）', () => {
  const samples: unknown[] = ['ink/v1', 'drawing/v1', 'text/v1', '', null, undefined, 7, {}, ['ink/v1']];
  for (const sample of samples) {
    const label = JSON.stringify(sample) ?? String(sample);
    assert.equal(mirror.isInkFormat(sample), front.isInkFormat(sample), `镜像与前端不一致：${label}`);
    assert.equal(serverValidate.isInkFormat(sample), front.isInkFormat(sample), `服务端校验与前端不一致：${label}`);
  }
});

test('★ readInkValue 的容错同判：坏形状两边都回 null，好形状两边都读得出来', () => {
  const good = { format: 'ink/v1', canvas: { w: 300, h: 200 }, strokes: [{ color: '#000', width: 0.1, points: [[0.5, 0.5]] }] };
  assert.deepEqual(mirror.readInkValue(good), front.readInkValue(good));
  for (const bad of [null, undefined, 7, 'x', {}, { format: 'nobody' }, { format: 'ink/v1' }, { format: 'ink/v1', strokes: 'x' }]) {
    assert.equal(mirror.readInkValue(bad), front.readInkValue(bad), `不一致：${JSON.stringify(bad)}`);
  }
});

test('★ 服务端的题型名与前端那张表逐条相同（报告上印的是中文，而服务端没有那张表）', () => {
  const frontLabels: Record<string, string> = {};
  for (const option of QUESTION_TYPE_OPTIONS) frontLabels[option.value] = option.label;
  assert.deepEqual({ ...QUESTION_TYPE_LABELS }, frontLabels, '两处的题型名漂了');
});

test('★ 服务端的题型**别名**与前端那张表逐条相同（教师用卷上印的是别名）', () => {
  const frontNicknames: Record<string, string> = {};
  for (const option of QUESTION_TYPE_OPTIONS) frontNicknames[option.value] = option.nickname;
  assert.deepEqual({ ...QUESTION_TYPE_NICKNAMES }, frontNicknames, '两处的题型别名漂了');
  // 阳性对照：别名与正式名**不是**同一批字（少一处 alias 会静默回落成正式名）。
  assert.notEqual(frontNicknames['fill-blank'], QUESTION_TYPE_LABELS['fill-blank']);
});
