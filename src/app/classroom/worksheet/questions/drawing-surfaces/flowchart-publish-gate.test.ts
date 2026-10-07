/**
 * ★ 2026-10-07（教师：「查一下第 11 题为什么会重复保存」）—— **发布闸的接线判据**。
 *
 * 🔴 为什么不能只靠 `worksheet-flowchart-publish.test.ts`：那几条证的是
 *   「闸门的规则对」。而**画板愿不愿意用它**是另一件事 —— 把那两行从 effect 里删掉，
 *   那几条**照样全绿**，而第 11 题仍然每秒保存一次（本机看不见界面）。
 *
 * ⚠️ 源码级判据：证「接线在、形态对」，不证运行时不再重复保存
 *   （那一条要真机上看着「已保存 N 次」不动才算数 —— 已在报告里交给教师）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const SOURCE = stripComments(fs.readFileSync(path.join(HERE, 'flowchart-drawing.tsx'), 'utf8'));

test('★ 发布 effect 里有那道闸：内容没变就**提前返回**（不保存、也不抓图）', () => {
  const at = SOURCE.indexOf('const signature = flowPayloadSignature(payload);');
  assert.notEqual(at, -1, 'effect 里没有算签名 —— 那道闸没接上');
  const after = SOURCE.slice(at, at + 400);
  assert.match(after, /if \(!shouldPublishFlow\(lastPublishedSignature\.current, signature\)\) return;/,
    '没有提前返回 ⇒ 内容没变也照样保存 + 抓图 ⇒ 与「抓图回来 ⇒ onChange 换身份」构成自激环');
  // 🔴 提前返回必须排在**两件事之前** —— 排在 `onChange` 之后等于只挡了抓图，保存照旧每秒一次。
  const onChangeAt = after.indexOf('onChange(subtractFlowchart');
  const rasterAt = after.indexOf('scheduleRaster();');
  const guardAt = after.indexOf('shouldPublishFlow');
  assert.ok(guardAt < onChangeAt && guardAt < rasterAt,
    '闸门排在保存 / 抓图之后了 —— 那样只挡住一半，保存仍然每秒一次');
});

test('★ 快照那一份（`lastFlow.current`）**不**受闸门影响（它永远取最新）', () => {
  const at = SOURCE.indexOf('const signature = flowPayloadSignature(payload);');
  const before = SOURCE.slice(Math.max(0, at - 400), at);
  assert.match(before, /lastFlow\.current = payload;/,
    '`lastFlow.current` 被那道闸挡在后面了 —— 抓图读的就是它，挡住会抓到上一份');
});
