/**
 * ★ 2026-10-07（教师：「初始图开关不仅流程图要，其他绘图题也要」）—— **教师端那个面板**的接线判据。
 *
 * 🔴 它挡的是两类具体动作：
 *   ① 开关打开时**又写回恒定的 `tool: 'flowchart'`** —— 那正是审计抓到的那条：
 *      思维导图题上挂着一份流程图底稿，学生端不显示它，而服务端据此给模型加一句
 *      「图里有教师的初始图」（假话，会把学生自己搭的整张导图算成教师给的）；
 *   ② 思维导图**没有可编辑的底稿画板** —— 教师打开了开关却什么都画不了。
 *
 * ⚠️ 源码级判据：证「接线在、形态对」，不证界面上画出来什么样（本机看不见界面）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const SOURCE = stripComments(fs.readFileSync(path.join(HERE, 'drawing-settings.tsx'), 'utf8'));

test('★ 开关打开时走那个**纯函数**（形状的决定不在这一屏，也不许再恒写流程图）', () => {
  assert.match(SOURCE, /const blank = blankStarterFor\(tool\);\s*\n\s*if \(blank\) onDataChange\(\{ drawingStarter: blank \}\);/,
    '开关没有走 `blankStarterFor` —— 它决定了「这一档该写什么形状的底稿」');
  // 🔴 那条字面量**只许**住在 lib 里：留在这一屏就是「恒写流程图」那件事又回来了。
  //    （它正是审计抓到的那条：思维导图题上挂着流程图的底稿 ⇒ 服务端对模型说假话。）
  assert.doesNotMatch(SOURCE, /tool: 'flowchart', data: \{ nodes: \[\], edges: \[\] \}/,
    '这一屏又自己拼流程图底稿的字面量了 —— 形状的决定必须只有一处');
});

test('★ 思维导图有**可编辑**的底稿画板（不只是那句「只支持流程图」的说明）', () => {
  assert.match(SOURCE, /\) : tool === 'mind-map' \? \(/,
    '没有「当前是思维导图」这一支 ⇒ 教师打开开关也画不了东西');
  assert.match(SOURCE, /<MindmapDrawing[\s\S]{0,320}drawingStarter: \{ tool: 'mind-map', data: next \}/,
    '思维导图那一支没有底稿画板 / 没有把画的东西写回底稿');
  assert.match(SOURCE, /import MindmapDrawing from/,
    '没复用学生端那块画板（复用是刻意的：教师画的与学生看到的是同一套渲染）');
});

test('★ 底稿属于**另一个画板**时照实说清（它是惰性的，别让教师以为还在生效）', () => {
  // 教师中途换过作图工具时，旧底稿还在数据里 —— 学生端不显示它、服务端也不会说「有初始图」
  //（判据是「底稿的画板必须与题目当前的一致」，见 `hasDrawingStarter`）。
  assert.match(SOURCE, /starter\.tool !== tool \? \(/,
    '换过画板之后，那张属于别的画板的底稿没有任何说明 —— 教师会以为它还在生效');
  assert.match(SOURCE, /不会丢/,
    '那句话要说明「改回原来那一档就能继续编辑它」，否则教师会以为底稿丢了');
});

test('★ 这一档不支持时开关**禁用**（但**有旧底稿时必须仍可点** —— 那是唯一的清除入口）', () => {
  assert.match(SOURCE, /const starterSupported = blankStarterFor\(tool\) !== null;/,
    '开关的可用性没有走 `blankStarterFor` 那条判据');
  assert.match(SOURCE, /disabled=\{!starterSupported && !starter\}/,
    '开关的禁用条件不对：不支持这一档却仍可点（会写出一份别的画板的底稿），'
    + '或者有旧底稿也被禁掉（教师再也删不掉它）');
});
