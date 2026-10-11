import test from 'node:test';
import assert from 'node:assert/strict';
import { extractAnalysisProtocol, analysisProtocolJson } from '../services/analysis-protocol.js';
import { parseAiAnalysisResult } from '../services/analysis-scoring.js';
import { parseAnalysisFeedback } from '../services/analysis-feedback.js';
const score = JSON.stringify({scores:[{student:'张伟#1',score:5,reason:'你完整说明了理由。',advice:'再用图说明。'}]});
const feedback = JSON.stringify({groups:[{id:'g1',students:['张伟#1']}],students:[{student:'张伟#1',advice:'再用图说明。'}]});
const entries = [{studentId:'s1',anonLabel:'张伟#1'}];
const config = {enabled:true,maxScore:5,unit:'颗星星',criteria:''};

test('标准、转义、引用和代码围栏协议都分离，正文数学内容不改变', () => {
  for (const raw of [
    `<classnode-scores>${score}</classnode-scores>`,
    `&lt;classnode-scores&gt;${score}&lt;/classnode-scores&gt;`,
    `\\<classnode-scores\\>${score}\\</classnode-scores\\>`,
    `\n\`\`\`json\n<classnode-scores>\n${score}\n</classnode-scores>\n\`\`\``,
    `<classnode-scores>\n> ${score}\n</classnode-scores>`,
  ]) {
    const parsed = parseAiAnalysisResult(`### 核心结论\n周长20米，面积16平方米。\n${raw}`,config,entries);
    assert.ok(!('error' in parsed));
    assert.equal(parsed.narrative,'### 核心结论\n周长20米，面积16平方米。');
    assert.equal(parsed.perStudent?.scores[0].score,5);
  }
});
test('缺闭合标记仍隔离，合法 JSON 可解析；截断 JSON 只清理，不猜评分', () => {
  for (const data of [score, '{"scores":[{"student":"张伟#1","score":5']) {
    const result = parseAiAnalysisResult(`正文\n<classnode-scores>${data}`,config,entries);
    assert.ok(!('error' in result));
    assert.equal(result.narrative,'正文');
    assert.equal(result.perStudent?.scores[0].score??null, data===score?5:null);
  }
});
test('反馈缺结束标签时仍保留后续评分，串行解析互不吞数据', () => {
  const raw = `正文\n<classnode-feedback>${feedback}\n<classnode-scores>${score}</classnode-scores>`;
  const first=parseAnalysisFeedback(raw,entries);
  assert.equal(first.feedback.groups[0].studentIds[0],'s1');
  const last=parseAiAnalysisResult(first.narrative,config,entries);
  assert.ok(!('error' in last));
  assert.equal(last.narrative,'正文');
  assert.equal(last.perStudent?.scores[0].studentId,'s1');
});
test('重复机器块全部隐藏但不随意选择其中一次评分', () => {
  const result=parseAiAnalysisResult(`正文<classnode-scores>${score}</classnode-scores><classnode-scores>${score}</classnode-scores>`,config,entries);
  assert.ok(!('error' in result));
  assert.equal(result.narrative,'正文');
  assert.equal(result.perStudent,null);
});
test('关闭评分也不能把机器数据作为报告正文显示', () => {
  assert.deepEqual(parseAiAnalysisResult(`正文<classnode-scores>${score}</classnode-scores>`,{...config,enabled:false},entries),{narrative:'正文',perStudent:null,missing:[]});
});
test('裸协议对象按括号与字符串边界隔离，正常教学文字和普通 JSON 保留', () => {
  const raw='正文\n{"scores":[{"reason":"字符串包含 } 和 \\\"引号\\\"","student":"张伟#1"}]}\n### 讲评后检查\n用 {"长":8,"宽":2} 表示尺寸。';
  const result=extractAnalysisProtocol(raw);
  assert.equal(result.narrative,'正文\n\n### 讲评后检查\n用 {"长":8,"宽":2} 表示尺寸。');
  assert.equal(result.blocks.length,1);
  assert.ok(analysisProtocolJson(result.blocks[0].body));
});
