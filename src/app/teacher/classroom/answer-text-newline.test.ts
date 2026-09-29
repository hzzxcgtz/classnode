/**
 * 学生**原样作答**（问答/手写那类）在两处渲染器里必须都保留换行。
 *
 * 🔴 这个文件是一次真 bug 的产物（2026-09-29，教师：「学生在输入问答题的答案时，
 * 已经**手工换行了**，但是在监控面板里没有看到换行」）。
 * 根因：格子那一份（`tile-answer.tsx` 的 `case 'text'`）忘了写 `whiteSpace: 'pre-wrap'`
 * —— 默认的 `white-space: normal` 会把 `\n` **折叠成一个空格**，
 * 学生分成三段的答案连成一段，而屏幕上一点异常都没有。
 * 教师端抽屉那一份（`answer-view.tsx`）一直是写着的 ⇒ 同一份作答在两处长得不一样。
 *
 * ⇒ 立的规矩：**这两处的「原文」都必须保留换行**。各写一份、谁掉了都不报错，
 *   所以由这条网看着。⚠️ 它只查这两个文件里**那一段样式**，不查别的（列表项那种
 *   一行一枚的胶囊本来就该 `nowrap`）。
 *
 * ⚠️ 只读文本、不渲染任何东西 ⇒ 本机（无 jsdom、无浏览器）跑得起来。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TILE = fs.readFileSync(path.join(HERE, 'tile-answer.tsx'), 'utf8');
const DRAWER = fs.readFileSync(path.join(HERE, 'answer-view.tsx'), 'utf8');

/** 从 `case 'text':` 那一支里取到下一个 `case` 之前的源码（判据只认这一段）。 */
function textCase(source: string): string | null {
  const start = source.indexOf("case 'text':");
  if (start < 0) return null;
  const rest = source.slice(start + 1);
  const next = rest.indexOf('case ');
  return next < 0 ? rest : rest.slice(0, next);
}

test('🔴 格子那一份的「原文」保留了学生敲的换行（`whiteSpace: pre-wrap`）', () => {
  const block = textCase(TILE);
  assert.ok(block, '`tile-answer.tsx` 里必须能读到 `case \'text\':` 那一支（读不到说明它换了写法，这条网要跟着改）');
  assert.ok(
    /whiteSpace:\s*'pre-wrap'/.test(block),
    '少了 `whiteSpace: \'pre-wrap\'` ⇒ 学生手工换的行会被折叠成一个空格，'
    + '两段并成一段而屏幕上没有异常（2026-09-29 教师报的就是这一条）',
  );
});

test('🔴 教师端抽屉那一份同样保留（两处必须一致）', () => {
  // ⚠️ 抽屉那一份把样式抽成了常量（`ANSWER_TEXT_STYLE`），所以整份文件里查。
  assert.ok(
    /whiteSpace:\s*'pre-wrap'/.test(DRAWER),
    '抽屉那一份的原文样式也必须保留换行 —— 同一份作答在两处长得不一样，谁都不会报错',
  );
});

test('阳性对照：两段源码真的被读到了（不是靠空串变绿的）', () => {
  const block = textCase(TILE);
  assert.ok(block && block.includes('view.text'), '读到的应当是渲染 `view.text` 的那一支');
  assert.ok(TILE.length > 1000 && DRAWER.length > 1000, '两个文件都真的被读到了');
});
