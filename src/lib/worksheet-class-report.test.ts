import test from 'node:test';
import assert from 'node:assert/strict';
import { classReportContent } from './worksheet-class-report.ts';
const entries = [{studentId:'a',anonLabel:'张伟#1'},{studentId:'b',anonLabel:'张伟#2'}];
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
