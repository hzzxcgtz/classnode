/**
 * ★ 2026-10-07（教师：联系表标签改用「姓名 + 学号」）—— **接线**判据。
 *
 * 🔴 为什么不能只靠 `worksheet-analysis-cells.test.ts`：那几条证的是
 *   「`localizeLegacyLabels` 只认老格式」。而**面板愿不愿意用它**是另一件事 ——
 *   把面板改回朴素子串替换（`acc.split(entry.anonLabel).join(real)`），
 *   那几条**照样全绿**，而教师屏幕上的真名会被改错（姓名是别人姓名/正文的子串）。
 *   本机看不见界面，这个缺陷只能靠读源码发现。
 *
 * ⚠️ 它证的是「接线在、形态对」，**不证**渲染出来的那段文字到底对不对
 *   （那一条在 `worksheet-analysis-cells.test.ts` 里，含正反两向）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PANEL = fs.readFileSync(path.join(HERE, 'analysis-panel.tsx'), 'utf8');

test('★ 解读里的老式伪名走 `localizeLegacyLabels`，不用朴素子串替换', () => {
  assert.match(
    PANEL, /localizeLegacyLabels\(/,
    '面板没有用那个只认老格式的替换函数 —— 改回朴素替换会把正文里恰好出现的真名改错',
  );
  assert.doesNotMatch(
    PANEL, /split\(entry\.anonLabel\)\.join\(/,
    '朴素子串替换回来了：标签现在是真名，而真名可能是别人姓名或正文的子串（静默改错文字）',
  );
});

test('★ 老式伪名那一条正则不许带 lookbehind（学生端那条纪律的同一条尺子）', () => {
  const lib = fs.readFileSync(path.join(HERE, '../../../lib/worksheet-analysis-cells.ts'), 'utf8');
  assert.doesNotMatch(lib, /\(\?<[=!]/, '本仓明令：不用 regex lookbehind（老 Safari 不支持）');
});
