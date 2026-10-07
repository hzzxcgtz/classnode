/**
 * ★ 2026-10-07（教师：「他正在编辑哪一题，监控面板就监看哪一题」）—— **接线**判据。
 *
 * 🔴 为什么不能只靠 `worksheet-board-data.test.ts`：那几条证的是
 *   「`shouldDropLiveDraft` 这条规则对」。而**看板愿不愿意用它**是另一件事 ——
 *   把那句改回无条件删（`if (current === undefined) return prev;`），那几条**照样全绿**，
 *   而教师看到的面板仍然会「闪一下他编辑的那题、又切回上一题」（本机看不见界面）。
 *
 * ⚠️ 这个 hook 装不起来（要 React/DOM，本仓没有 jsdom）⇒ 只能源码级。
 * 它证「接线在、形态对」，不证运行时行为。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const SOURCE = stripComments(fs.readFileSync(path.join(HERE, 'use-worksheet-board.ts'), 'utf8'));

test('★ 落库广播那一处**走那条规则**，而不是无条件删', () => {
  assert.match(
    SOURCE, /if \(!shouldDropLiveDraft\(current, questionId\)\) return prev;/,
    '实时预览的清理没有走那条规则 ⇒ **别的题**的一次保存会抹掉他正在编辑那一题的预览（卡片闪回上一题）',
  );
});
