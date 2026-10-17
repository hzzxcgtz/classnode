import test from 'node:test';
import assert from 'node:assert/strict';
import { classReportContent, reportStudentLabel } from './worksheet-class-report.ts';
const entries = [{studentId:'a',anonLabel:'张伟#1'},{studentId:'b',anonLabel:'张伟#2'}];
test('名单链接标题含完整学生标签时不生成嵌套链接或露出地址', () => {
  const report = classReportContent('优秀作答：[张伟#2](#classnode-group-g2)，方法清晰。', entries, {a:'张伟',b:'张伟'});
  assert.equal(report.text, '优秀作答：[张伟#2](#classnode-group-g2)，方法清晰。');
  assert.deepEqual(report.groups, []);
});
test('名单链接后重复展开的姓名或名单链接被移除，实质作答依据保留', () => {
  for (const list of ['张伟#1、张伟#2等', '[作者](#classnode-group-g2)、[同学](#classnode-group-g3)等']) {
    const report = classReportContent(`典型问题：[相关同学](#classnode-group-g1)（${list}）把钝角分错。`, entries, {a:'张伟',b:'张伟'});
    assert.equal(report.text, '典型问题：[相关同学](#classnode-group-g1)把钝角分错。');
  }
  const report = classReportContent('[相关同学](#classnode-group-g1)（把最大角120°误判为锐角）', entries, {});
  assert.equal(report.text, '[相关同学](#classnode-group-g1)（把最大角120°误判为锐角）');
});
test('班级正文隐藏历史完整标签，悬停名单仍唯一对应学生', () => {
  const report = classReportContent('张伟#2 漏写单位，张伟#1 计算正确。', entries, {a:'张伟',b:'张伟'});
  assert.ok(!report.text.includes('张伟') && !report.text.includes('#1') && !report.text.includes('#2'));
  const first = report.text.match(/#classnode-group-(legacy\d+)/)![1];
  assert.deepEqual(report.groups.find(group=>group.id===first)?.studentIds, ['b']);
});
test('历史报告只出现同名姓名时不猜人，原有机器组链接保持完整', () => {
  const report = classReportContent('张伟需要帮助，[相关同学](#classnode-group-g1)。', entries, {a:'张伟',b:'张伟'});
  assert.match(report.text,/身份待核实/);
  assert.match(report.text,/#classnode-group-g1/);
  assert.deepEqual(report.groups, []);
});

test('旧报告末尾裸名单 JSON 隐藏并准确保留名单链接', () => {
  const report = classReportContent('优秀作答 [作者](#classnode-group-g2)\n\n典型表现对应名单\n{"groups":[{"id":"g2","students":["张伟#2"]}]}', entries, {a:'张伟',b:'张伟'});
  assert.equal(report.text, '优秀作答 [作者](#classnode-group-g2)');
  assert.deepEqual(report.groups, [{id:'g2',studentIds:['b']}]);
});
test('无效或身份不清的裸名单不会显示 JSON 或猜名单', () => {
  for (const data of ['{"groups":[{"id":"g1","students":["张伟"]}]}', '{"groups":']) {
    const report = classReportContent('核心结论\n正文\n\n### 二、典型表现对应名单\n'+data, entries, {a:'张伟',b:'张伟'});
    assert.equal(report.text, '核心结论\n正文');
    assert.deepEqual(report.groups, []);
  }
});

test('截图中评分协议与大段逐生 JSON 在姓名替换前隔离，旧报告正文保持可读', () => {
  for (const tail of [
    '<classnode-scores>{"scores":[{"student":"张伟#1","score":5,"reason":"理由"}]}',
    '&lt;classnode-scores&gt;{"scores":[{"student":"张伟#1","score":5}]}&lt;/classnode-scores&gt;',
    '{"scores":[{"student":"张伟#1","score":5}]}',
  ]) {
    const report=classReportContent(`讲评后检查\n改变条件：计算8×2和5×5。\n${tail}`,entries,{a:'张伟',b:'张伟'});
    assert.equal(report.text,'讲评后检查\n改变条件：计算8×2和5×5。');
    assert.deepEqual(report.groups,[]);
  }
});

test('名单按钮单人显示实际姓氏，多人加等，复姓与外文名称不截错', () => {
  assert.equal(reportStudentLabel(['张伟']),'张同学');
  assert.equal(reportStudentLabel(['张伟','李芳']),'张同学等');
  assert.equal(reportStudentLabel(['司马懿']),'司马同学');
  assert.equal(reportStudentLabel(['比尔·希恩斯']),'比尔·希恩斯同学');
});
