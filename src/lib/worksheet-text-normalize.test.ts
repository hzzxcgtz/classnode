/**
 * 「粘贴进来的文本去格式」（教师 2026-10-06）。用例全部用**会真的遇到**的样子：
 * Word 的缩进 + 全角空格 + 标点前后多一个空格。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { normalizePastedText } from './worksheet-text-normalize.ts';

test('阳性对照：这是个幂等的纯函数（否则下面几条可能是「改一次就变样」）', () => {
  const raw = '  满分 4 分： 答出（1 分） ； 答出色散\n\n\n\n  第二段  ';
  const once = normalizePastedText(raw);
  assert.equal(normalizePastedText(once), once, '不是幂等的');
  assert.ok(once.length > 0);
});

test('去排版：缩进、全角空格、标点前后的空格、多余空行', () => {
  const raw = [
    '　　满分 4 分： 答出雨后空气中有许多小水滴（1 分） ；',
    '\t答出太阳光射入小水滴后发生折射或色散（1 分） ；',
    '',
    '',
    '',
    '　　只写“阳光折射形成的”而没有提到小水滴和色散，最多得 2 分；',
  ].join('\r\n');
  assert.equal(normalizePastedText(raw), [
    '满分 4 分：答出雨后空气中有许多小水滴（1 分）；',
    '答出太阳光射入小水滴后发生折射或色散（1 分）；',
    '',
    '只写“阳光折射形成的”而没有提到小水滴和色散，最多得 2 分；',
  ].join('\n'));
});

test('只去排版，不动内容：数字与单位、拉丁词之间的空格要留着', () => {
  assert.equal(normalizePastedText('满分 4 分，AI 评分 10 分'), '满分 4 分，AI 评分 10 分');
  // 反面：中文标点后面紧跟拉丁词时**不删**那个空格（「，AI」是混排，删了会粘在一起）
  assert.equal(normalizePastedText('见下，AI 会判'), '见下，AI 会判');
  // 而紧跟中文时删掉（这才是 Word 带进来的那种）
  assert.equal(normalizePastedText('答出： 小水滴'), '答出：小水滴');
});

test('不换行空格 / 制表符 / 连续空格都归一', () => {
  assert.equal(normalizePastedText('甲\u00a0\u00a0乙\t\t丙   丁'), '甲 乙 丙 丁');
  assert.equal(normalizePastedText('  首尾空白  '), '首尾空白');
});
