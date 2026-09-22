import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveMaterialTargetId } from '../services/group-material-resolve.js';

const base = { groupMaterials: [], classroomLevelId: null as string | null };

test('高级模式：自己组有 ⇒ 用它', () => {
  const got = resolveMaterialTargetId({ ...base, mode: 'advanced', studentGroupId: 'g1',
    groupMaterials: [{ groupId: 'g1', kind: 'agent', targetId: 'a1' }], kind: 'agent',
    classroomLevelId: 'a-class' });
  assert.equal(got, 'a1');
});

// 🔴 本改动最严重的一处。反证：课堂级**故意**放一个别的组的材料，
//    断言学生没有拿到它 —— 这条如果红，说明回落还在。
test('🔴 高级模式：自己组没有 ⇒ null，**不得**用课堂级的顶上', () => {
  const got = resolveMaterialTargetId({ ...base, mode: 'advanced', studentGroupId: 'g1',
    groupMaterials: [{ groupId: 'g2', kind: 'agent', targetId: 'a2' }], kind: 'agent',
    classroomLevelId: 'a-class' });
  assert.equal(got, null, '不得回落到课堂级 —— 那是「静默用错别人的材料」');
});

test('高级模式：找不到自己的组 ⇒ null（不回落）', () => {
  const got = resolveMaterialTargetId({ ...base, mode: 'advanced', studentGroupId: 'g-missing',
    groupMaterials: [{ groupId: 'g1', kind: 'agent', targetId: 'a1' }], kind: 'agent', classroomLevelId: 'a-class' });
  assert.equal(got, null);
});

test('高级模式：材料行存在但 kind 对不上 ⇒ null（kind 是判据的一部分）', () => {
  const got = resolveMaterialTargetId({ ...base, mode: 'advanced', studentGroupId: 'g1',
    groupMaterials: [{ groupId: 'g1', kind: 'webapp', targetId: 'w1' }], kind: 'agent', classroomLevelId: 'a-class' });
  assert.equal(got, null);
});

test('标准/分组模式：用课堂级那一个', () => {
  for (const mode of ['standard', 'group']) {
    const got = resolveMaterialTargetId({ ...base, mode, studentGroupId: 'g1',
      groupMaterials: [{ groupId: 'g1', kind: 'agent', targetId: 'a-group' }], kind: 'agent',
      classroomLevelId: 'a-class' });
    assert.equal(got, 'a-class', `${mode} 必须用课堂级 —— 那个模式全班共用一套材料`);
  }
});

test('标准模式：课堂级也没有 ⇒ null', () => {
  assert.equal(resolveMaterialTargetId({ ...base, mode: 'standard', studentGroupId: null, kind: 'agent' }), null);
});
