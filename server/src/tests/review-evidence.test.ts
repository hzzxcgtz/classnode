import test from 'node:test';
import assert from 'node:assert/strict';
import { extractReviewEvidence } from '../services/review-evidence.js';
const entries = [{ studentId: 's1', anonLabel: '张同学#1' }];
const record = { student: '张同学#1', summary: '写了跳绳经历', criteria: [{ requirement: '具体动作', status: 'met', evidence: '“连跳了十二下”' }], limitations: [] };
const wrap = (students: unknown[]) => '学生反馈<classnode-evidence>'+JSON.stringify({ students })+'</classnode-evidence>';
test('evidence maps exact student labels, stays separate from student-visible content', () => {
  const result = extractReviewEvidence(wrap([record, { ...record, student: '名单外#9' }]), entries);
  assert.equal(result.content, '学生反馈');
  assert.deepEqual([...result.byStudent.keys()], ['s1']);
  assert.equal(result.byStudent.get('s1')?.criteria[0].evidence, '“连跳了十二下”');
  assert.equal(result.byStudent.get('s1')?.version, 1);
});
test('old agents without evidence remain compatible; malformed optional evidence is removed', () => {
  assert.equal(extractReviewEvidence('旧评价', entries).content, '旧评价');
  const result = extractReviewEvidence('旧评价<classnode-evidence>bad json</classnode-evidence>', entries);
  assert.equal(result.content, '旧评价'); assert.equal(result.byStudent.size, 0);
});
test('duplicate students, invalid criterion states and excessive records do not become evidence', () => {
  for (const students of [[record, record], [{ ...record, criteria: [{ ...record.criteria[0], status: 'guess' }] }], [{ ...record, criteria: Array(21).fill(record.criteria[0]) }]]) {
    assert.equal(extractReviewEvidence(wrap(students), entries).byStudent.size, 0);
  }
});
test('evidence text is bounded and uncertainty retained', () => {
  const result = extractReviewEvidence(wrap([{ ...record, summary: '字'.repeat(2000), criteria: [{ ...record.criteria[0], status: 'uncertain' }], limitations: ['图片局部模糊'] }]), entries).byStudent.get('s1')!;
  assert.equal(result.summary.length, 1000); assert.equal(result.criteria[0].status, 'uncertain'); assert.deepEqual(result.limitations, ['图片局部模糊']);
});
