import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeMaterialSnapshot } from './classroom-material-snapshot.ts';
import type { StudentClassroom } from './types';

const current = {
  id: 'room', title: '课堂', materialsRevision: 3, agents: [{ id: 'a' }],
  webapps: [{ id: 'w1' }], worksheets: [{ id: 'fixed' }], groups: [],
  status: 'paused', allowStudentAsk: false, answersLocked: true,
  modules: [{ moduleKey: 'explorer', state: 'hidden' }],
} as unknown as StudentClassroom;

test('新材料快照只更新材料和名称，保留锁定、权限、三态和学习单', () => {
  const fresh = { ...current, materialsRevision: 4, title: '新名', agents: [{ id: 'b' }], webapps: [{ id: 'w2' }], worksheets: [], status: 'active', answersLocked: false, allowStudentAsk: true, modules: [] } as unknown as StudentClassroom;
  const merged = mergeMaterialSnapshot(current, fresh)!;
  assert.equal(merged.title, '新名');
  assert.deepEqual(merged.agents, fresh.agents);
  assert.deepEqual(merged.webapps, fresh.webapps);
  assert.equal(merged.worksheets, current.worksheets);
  assert.equal(merged.status, 'paused');
  assert.equal(merged.allowStudentAsk, false);
  assert.equal(merged.answersLocked, true);
  assert.equal(merged.modules, current.modules);
});

test('迟到的旧版本、其他课堂和空会话均不能覆盖当前材料', () => {
  assert.equal(mergeMaterialSnapshot(current, { ...current, materialsRevision: 2 }), current);
  assert.equal(mergeMaterialSnapshot(current, { ...current, id: 'other', materialsRevision: 5 }), current);
  assert.equal(mergeMaterialSnapshot(null, current), null);
});

test('轮询相同材料不产生新对象，高级模式更新组级材料', () => {
  assert.equal(mergeMaterialSnapshot(current, { ...current }), current);
  const fresh = { ...current, materialsRevision: 4, groups: [{ id: 'group', name: '第一组', agent: { id: 'b' }, webapp: { id: 'w2' } }] } as unknown as StudentClassroom;
  assert.equal(mergeMaterialSnapshot(current, fresh)?.groups, fresh.groups);
});
