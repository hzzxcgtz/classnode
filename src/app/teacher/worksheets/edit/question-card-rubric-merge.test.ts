import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * ★ 2026-10-05（教师）：「评分标准与下面的评分要求重复了，你把『评分标准』替换下面的
 * 『评分要求』，带图片上传。」+ 对底部那张卡的批注：「这部分是不是多余了？」
 *
 * ── 为什么这张网是源码级的 ──────────────────────────────────────────────
 * 本仓没有前端测试框架（`node --test` 加载不了 JSX），运行时也验不了
 * 「页面上有几个输入框」。但这次改动的三条防线**都是源码上的事实**，
 * 而它们坏掉的方式全是静默的：
 *   ① 「评分标准」只许有**一个**输入框 —— 合并不是"再加一个"；
 *   ② 那个输入框必须把旧字段 `aiScoringCriteria` **一并清掉**：只写 `rubricText` 的话，
 *      教师把内容删空之后回退值会重新出现（看起来像「删不掉」，而两边都不报错）；
 *   ③ 底部那张复述用的「评分说明 / 查看方式」卡不许回来。
 * 与 `student-socket-single-source.test.ts` / `worksheet-adornment-color.test.ts` 同一路数。
 *
 * ⚠️ 服务端那一半（同一份标准在提示词里只说一遍、旧字段回退读得出来）在
 * `server/src/tests/analysis-agent.test.ts` 与 `analysis-question.test.ts` 里。
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CARD = path.join(HERE, 'question-card.tsx');

test('🔴 评分标准与评分要求已合并：只剩一个输入框，编辑时旧字段被清掉', () => {
  const source = fs.readFileSync(CARD, 'utf8');
  // 阳性对照：读到的确实是那张题卡。少了它，路径写错会让下面每条断言**永远绿**。
  assert.match(source, /worksheet-editor-ai-scoring/, '这不是题卡文件（路径读错了？）');

  const labels = source.match(/<span>评分标准<\/span>/g) ?? [];
  assert.equal(labels.length, 1, '「评分标准」只许有**一个**输入框 —— 两个就是要命的那次重复');
  assert.ok(!/<span>评分要求<\/span>/.test(source), '「评分要求」那个输入框已随合并删除，不许回来');

  // 显示侧：老学习单只填过「评分要求」的，教师得看得见原文（回退不许丢）。
  assert.match(source, /value=\{rubricText \|\| aiScoringCriteria\}/, '显示侧要保留旧字段回退');
  // 写回侧：必须同时清掉旧字段，否则「删不掉」。
  assert.match(
    source,
    /onDataChange\(\{\s*rubricText:[^}]*aiScoringCriteria:\s*undefined/s,
    '🔴 写回评分标准时必须把旧字段 `aiScoringCriteria` 一并清掉 —— 只写 `rubricText` 的话，'
    + '教师把输入框删空后回退值会重新出现（看起来像「删不掉」），而两边都不会报错。',
  );

  // 底部那张卡：判据用**那句 JSX 字面量**，不是「评分说明」这个词 ——
  // 删掉它的地方留了一段注释讲为什么，用词判据会被自己的注释打红。
  assert.ok(
    !/aiScoringEnabled \? '评分说明' : '查看方式'/.test(source),
    '底部那张「评分说明 / 查看方式」卡已整块删除（教师 2026-10-05）：'
    + '它整段是复述上面两块，唯一别处没有的「不会覆盖教师评价」并进了 AI 评分块的脚注。',
  );
});

test('阳性对照：评分标准的图片上传跟着搬进了 AI 评分块（合并不等于把图丢了）', () => {
  const source = fs.readFileSync(CARD, 'utf8');
  const at = source.indexOf('worksheet-editor-ai-scoring');
  assert.ok(at > 0, '找不到 AI 评分块');
  const block = source.slice(at);
  assert.match(block, /worksheet-editor-rubric-image|worksheet-editor-rubric-upload/, '图片上传入口要跟着搬进来');
  assert.match(block, /uploadRubricImage/, '上传仍是那一个函数（不许另写第二份）');
});
