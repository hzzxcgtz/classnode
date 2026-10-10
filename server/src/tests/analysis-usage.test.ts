import test from 'node:test';
import assert from 'node:assert/strict';
import { readAnalysisUsage, recordAnalysisUsage } from '../services/analysis-usage.js';

test('旧分析仅补计仍保存的一次，空载荷和未调用不计数', () => {
  assert.deepEqual(readAnalysisUsage(null, 'a', '已有结果').agents, [{ agentId: 'a', calls: 1, chars: 4 }]);
  assert.deepEqual(readAnalysisUsage(null, 'a', null).agents, []);
  assert.deepEqual(readAnalysisUsage(null, null, '已有结果').agents, []);
});
test('重分析和更换智能体分别累加，不重复补计历史结果', () => {
  const first = recordAnalysisUsage(null, 'a', '旧结果', 'a', 10);
  const second = recordAnalysisUsage({ analysisUsage: first }, 'a', '新结果', 'b', 20);
  const third = recordAnalysisUsage({ analysisUsage: second }, 'b', '再生成', 'a', 30);
  assert.deepEqual(third.agents, [{ agentId: 'a', calls: 3, chars: 43 }, { agentId: 'b', calls: 1, chars: 20 }]);
});
test('无效历史计数和重复智能体记录不会造成统计膨胀', () => {
  assert.deepEqual(readAnalysisUsage({ analysisUsage: {version:1, agents:[{agentId:'a',calls:2,chars:5},{agentId:'a',calls:9,chars:99},{agentId:'b',calls:-1,chars:0}] } }, null, null).agents, [{agentId:'a',calls:2,chars:5}]);
});
