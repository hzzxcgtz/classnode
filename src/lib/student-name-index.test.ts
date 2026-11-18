import test from 'node:test';
import assert from 'node:assert/strict';
import { studentNameIndex, matchesStudentName } from './student-name-index.ts';
test('姓名使用姓氏读音，复姓及拉丁姓名均可按首字母筛选', () => {
  for (const [name, letter] of [['陈佳娴','C'],['蔡可','C'],['曹鸿良','C'],['单小明','S'],['曾小明','Z'],['欧阳明','O'],['Alice Smith','A'],['123','没有字母']]) {
    assert.equal(studentNameIndex(name).initial, letter === '没有字母' ? '#' : letter, name);
  }
});
test('搜索支持姓名、完整姓名首字母、大小写、空白与全角字母', () => {
  const index = studentNameIndex('曹鸿良');
  for (const query of ['曹','鸿良','CHL','chl',' C H L ','ＣＨＬ','']) assert(matchesStudentName(index,query),query);
  assert.equal(matchesStudentName(index,'CJX'),false);
  assert(matchesStudentName(studentNameIndex('Alice Smith'),'AS'));
});
