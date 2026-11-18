import test from 'node:test';
import assert from 'node:assert/strict';
import { recentTextColors, pushRecentTextColor } from './worksheet-recent-colors.ts';
test('最近颜色按最后使用排序，去重且保留八项', () => {
  const previous = Array.from({length:8}, (_,i)=>`#00000${i}`);
  assert.deepEqual(pushRecentTextColor(previous,'#000004'),['#000004',...previous.filter(c=>c!=='#000004')]);
  const result=pushRecentTextColor(previous,'#ABCDEF');
  assert.equal(result[0],'#abcdef');assert.equal(result.length,8);assert.ok(!result.includes('#000007'));
});
test('浏览器偏好中的无效颜色被忽略，大小写一致，空偏好可恢复', () => {
  assert.deepEqual(recentTextColors(['#AABBCC','#aabbcc','red','url(x)',null,'#123456']),['#aabbcc','#123456']);
  assert.deepEqual(recentTextColors({}),[]);
});
