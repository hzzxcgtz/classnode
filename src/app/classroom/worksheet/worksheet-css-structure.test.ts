/**
 * 手写 CSS 的**结构**判据：用 **postcss 真解析一遍**。
 *
 * 🔴 这条网是 2026-10-08 一次**真实事故**的直接产物，而且那次是 **webpack 抓住的、
 *   我自己的判据全绿**：
 *
 *   改 `.resultReward` 时，我的替换从「外层 `.resultReward {` **之后**」开始，
 *   于是那个开括号留在了原处，而我又在它**里面**插了一个新的 `.resultReward {` ——
 *   两个开括号只配了一个闭括号 ⇒ **外层永远不闭合**，Next 构建报
 *   `Syntax error: … Unclosed block`。
 *
 *   而当时同目录下那些"看 CSS"的判据（`ruleBodies` + `effective`）**一个都没红**：
 *   它们用 `indexOf('\n选择器 {')` 找块、按第一个 `}` 截断 —— 多出来的那层嵌套
 *   恰好让"第一个 `}`"落在新规则自己的闭括号上，于是它们读到的语法**看着完全正常**。
 *   ⇒ 教训：**测内容的判据不等于测结构的判据**，配平/可解析要单独钉一条。
 *
 * ✅ 这里用的就是**报出那次错误的那一个解析器**（Next 的 CSS 链上是 postcss；
 *   它在本仓是**直接依赖**，所以测试里可以放心 import，不是蹭传递依赖）。
 *   ⚠️ 曾经的第一版是手搓花括号计数 —— 它确实能抓住"结束时深度不为 0"，
 *   但那只是解析器的**近似**：真语法错（比如合法的 `url(a{b)` 之类）它看不见。
 *   有真解析器就别用近似。
 *
 * ⚠️ 加新文件时记得加进 `FILES`：这条网只覆盖列出来的那些。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../../..');

const FILES = [
  'src/app/classroom/worksheet/worksheet.module.css',
  'src/app/globals.css',
];

for (const relative of FILES) {
  test(`★ 结构：${path.basename(relative)} 能被 CSS 解析器读通（配平且语法合法）`, () => {
    const source = fs.readFileSync(path.join(REPO, relative), 'utf8');
    try {
      postcss.parse(source, { from: relative });
    } catch (error) {
      const detail = error as { name?: string; reason?: string; line?: number };
      assert.fail(
        `${relative} 解析失败：${detail.name ?? '错误'} — ${detail.reason ?? String(error)}`
        + `（第 ${detail.line ?? '?'} 行）。`
        + '这就是 2026-10-08 那次 `Unclosed block` 的形态：多一个开括号 / 少一个闭括号，'
        + '构建会红，而"读内容"的判据（`ruleBodies` 那种）照样全绿。',
      );
    }
  });
}
