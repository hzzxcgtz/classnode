import test from 'node:test';
import assert from 'node:assert/strict';
import { combinationSlices, selectionRate } from './question-option-distribution-data.ts';

test('多选项选择率各自使用已交人数，不能用总选择次数作分母', () => {
  assert.equal(selectionRate(40, 40), 100);
  assert.equal(selectionRate(32, 40), 80);
  assert.equal(selectionRate(22, 40), 55);
  assert.equal(selectionRate(0, 0), 0);
});
test('组合环形图补齐其他类别，前三种计数不能当作全部作答', () => {
  const source = [{label:'ABD',count:21},{label:'AB',count:11},{label:'AC',count:7}];
  assert.deepEqual(combinationSlices(source,40), [...source,{label:'其他组合',count:1}]);
  assert.equal(source.length,3);
  assert.equal(combinationSlices(source,39).length,3);
});
test('空选项有明确标签，单选题无组合时不生成伪造饼图', () => {
  assert.deepEqual(combinationSlices([{label:'',count:1}],1),[{label:'未选选项',count:1}]);
  assert.deepEqual(combinationSlices([],10),[]);
});

test('填空高频答案补齐其他写法并为留空使用独立标签', () => {
  assert.deepEqual(combinationSlices([{label:'',count:1},{label:'24',count:7}],10,'其他答案','留空'),[{label:'留空',count:1},{label:'24',count:7},{label:'其他答案',count:2}]);
});
