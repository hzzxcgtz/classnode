/**
 * ★ 2026-10-07（教师裁定 ②(a)）—— 思维导图**没有快照时**那条回退，必须**自己说清是近似的**。
 *
 * 🔴 为什么要有这条网：那条回退把树退化成层级文字（没有布局、没有配色、没有分支形状），
 *   而真正的图是 mind-elixir 渲出来再抓的那张位图 —— **AI 联系表与 Word 报告用的也是它**。
 *   2026-10-06 教师报过「导图被画成了三行大纲文字」，那次只修到「有快照就先画快照」，
 *   而这一支在**快照缺席时**仍然长得和信息完整的预览一模一样 ⇒ 教师会拿着这张图去讲题。
 * ⚠️ 而思维导图**比流程图更容易走到这一支**：它只在学生动手时才抓图（流程图挂载后先抓一张），
 *   学生改完就离开题目 ⇒ 那张图永远不来。
 *
 * ⚠️ 源码级判据：它证「那行字在、且不是在注释里」，**不证**渲染出来好不好看（本机看不见界面）。
 * 去掉注释再找，是因为「近似」两个字在注释里出现得比在界面上多。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** 去掉注释再找 —— 否则一条提到「近似预览」的注释就能让判据变绿。 */
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const SOURCE = stripComments(
  fs.readFileSync(path.join(HERE, 'drawing-document-preview.tsx'), 'utf8'),
);

/** `MindPreview` 那个函数的正文（到下一个顶层 `}` 为止）。 */
function mindPreviewBody(): string {
  const at = SOURCE.indexOf('function MindPreview(');
  assert.notEqual(at, -1, '`MindPreview` 没找到 —— 先修这条判据');
  const end = SOURCE.indexOf('\n}', at);
  return SOURCE.slice(at, end);
}

test('★ 思维导图的近似预览**自己说清**它是近似的（否则教师会当成学生画的那张）', () => {
  const body = mindPreviewBody();
  // 🔴 钉的是**那句看得见的话**，不是「近似预览」四个字 —— `aria-label` 里也有这四个字，
  //    只匹配四个字的话，把界面上那行删掉判据**照样绿**（第一次写这条时就踩了，变异验证抓到的）。
  assert.match(body, /近似预览（快照还没到）/,
    '这一支画出来的图和快照/AI 报告用的那张不是一回事 —— 不说清的话，屏幕上与信息完整的预览长得一样');
});

test('★ 连结构都没拿到时（值超过实时通道预算、矢量数据被丢掉）照实说，不留一个白框', () => {
  const body = mindPreviewBody();
  assert.match(body, /还没拿到|稍后/,
    '`root` 为空时留一个白框 = 与「他什么都没画」长得一模一样');
});
