/**
 * ★ 2026-10-07（教师）：「学生用鼠标点击思维导图的**空白区域**，应该能够取消所有节点的选择状态」
 *   —— **接线**判据。
 *
 * 🔴 为什么不能只靠 `worksheet-mindmap-pan.test.ts`：那几条证的是
 *   「`mindmapDragStarted` 这条规则对」。而**画板愿不愿意在抬起时调它、并真的取消选中**是另一件事 ——
 *   把那两句删掉，那几条**照样全绿**，而学生点空白仍然什么都不发生（本机看不见界面）。
 *
 * ⚠️ 源码级判据：证「接线在、形态对」，不证点一下真的取消了选中（那要真机）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const SOURCE = stripComments(fs.readFileSync(path.join(HERE, 'mindmap-drawing.tsx'), 'utf8'));

/** `onPointerUp` 的正文（到下一个顶层 `};` 为止）。 */
function pointerUpBody(): string {
  const at = SOURCE.indexOf('const onPointerUp =');
  assert.notEqual(at, -1, '`onPointerUp` 没找到 —— 先修这条判据');
  const end = SOURCE.indexOf('\n    };', at);
  return SOURCE.slice(at, end);
}

test('★ 抬起时：没拖动 ⇒ 调库的 `clearSelection()`（点空白 = 取消所有选中）', () => {
  const body = pointerUpBody();
  assert.match(body, /instance\.clearSelection\(\)/,
    '空白处抬起时没有取消选中 —— 而那块空白正是我们接管掉的（库自己那套跑不到）');
  assert.match(body, /mindmapDragStarted\(/,
    '取消选中没有经过「这一下是点击还是拖动」那条判据');
});

test('🔴 拖动平移时**不许**取消选中（两件事不该顺手一起做）', () => {
  const body = pointerUpBody();
  // 判据是「**不是**拖动才算点击」，写成恒真（直接 clearSelection）会把平移也变成取消选中。
  assert.match(body, /!mindmapDragStarted\(/,
    '取消选中没有被「没拖动」这个条件守着 —— 学生拖画布看一眼就会把选中弄丢');
});

test('★ 拿的是**库的公开方法**，不是自己遍历 DOM 去点掉选中（那种写法会漏掉摘要与连接线）', () => {
  // `clearSelection()` = `unselectNodes + unselectSummary + unselectArrow`（库的 `an` 逐字如此）。
  assert.doesNotMatch(SOURCE, /unselectNodes|\.selection\?\.unselect|classList\.remove\('selected'\)/,
    '自己在清选中 —— 库的三个 unselect 才是完整的（节点 / 摘要 / 连接线）');
});
