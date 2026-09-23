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

// ---------------------------------------------------------------------------
// 学习单（`kind: 'worksheet'`）—— 与 agent / webapp **逐字同一套**判据。
//
// ⚠️ 这一组不是「把上面五条照抄一遍」的形式主义：`kind` 是自由字符串，而
//    `resolveMaterialTargetId` 的匹配是 `m.kind === input.kind` 的**相等**比较。
//    学习单这一档真正会出错的形态是**回落**（高级模式下拿到别的组的学习单），
//    所以下面「自己组没有」那一条**必须带反证**：把课堂级那一份设成**别的组的**，
//    断言学生拿到的仍然是 null。
// ---------------------------------------------------------------------------

test('高级模式（学习单）：自己组有 ⇒ 用它', () => {
  const got = resolveMaterialTargetId({ ...base, mode: 'advanced', studentGroupId: 'g1',
    groupMaterials: [{ groupId: 'g1', kind: 'worksheet', targetId: 'ws-mine' }], kind: 'worksheet',
    classroomLevelId: 'ws-class' });
  assert.equal(got, 'ws-mine');
});

// 🔴 本改动第二条红线（第一条是 agent 那一条，形态相同）。
//    反证：课堂级容器里放的是**别的组的**学习单（g2 的），而学生属于 g1。
//    ⇒ 断言 null。改动前的实现里 `return input.classroomLevelId` 会把
//    `'ws-other-group'` 交出去 —— 那次改动会让本条变红（证据见 task-B2 报告）。
test('🔴 高级模式（学习单）：自己组没有 ⇒ null，**不得**用课堂级的顶上', () => {
  const got = resolveMaterialTargetId({ ...base, mode: 'advanced', studentGroupId: 'g1',
    // 别的组配的那一份 —— 它同时也是「课堂级」那一格的内容。
    groupMaterials: [{ groupId: 'g2', kind: 'worksheet', targetId: 'ws-other-group' }],
    kind: 'worksheet', classroomLevelId: 'ws-other-group' });
  assert.equal(got, null, '不得回落到课堂级 —— 那是「静默做错学习单」，教师完全看不出');
});

test('高级模式（学习单）：找不到自己的组 ⇒ null（不回落）', () => {
  const got = resolveMaterialTargetId({ ...base, mode: 'advanced', studentGroupId: 'g-missing',
    groupMaterials: [{ groupId: 'g1', kind: 'worksheet', targetId: 'ws-mine' }], kind: 'worksheet',
    classroomLevelId: 'ws-class' });
  assert.equal(got, null);
});

test('高级模式（学习单）：材料行存在但 kind 对不上 ⇒ null（kind 是判据的一部分）', () => {
  // 这一组只配了网页。问它要学习单 ⇒ 没有就是没有，不能拿同一行的 targetId 顶上
  // （`targetId` 是**多态**的：同一列既可能是 agent/webapp，也可能是 worksheet）。
  const got = resolveMaterialTargetId({ ...base, mode: 'advanced', studentGroupId: 'g1',
    groupMaterials: [{ groupId: 'g1', kind: 'webapp', targetId: 'w1' }], kind: 'worksheet',
    classroomLevelId: 'ws-class' });
  assert.equal(got, null);
});

test('高级模式：三种 kind 各自独立解析（不是「有材料就用」）', () => {
  const groupMaterials = [
    { groupId: 'g1', kind: 'agent', targetId: 'a-mine' },
    { groupId: 'g1', kind: 'worksheet', targetId: 'ws-mine' },
  ];
  const ask = (kind: 'agent' | 'webapp' | 'worksheet') => resolveMaterialTargetId({
    ...base, mode: 'advanced', studentGroupId: 'g1', groupMaterials, kind, classroomLevelId: 'class-level',
  });
  assert.equal(ask('agent'), 'a-mine');
  assert.equal(ask('worksheet'), 'ws-mine');
  assert.equal(ask('webapp'), null, '这一组没配网页 ⇒ null，不能拿同一组的智能体或学习单顶上');
});

test('标准/分组模式（学习单）：用课堂级那一个', () => {
  for (const mode of ['standard', 'group']) {
    const got = resolveMaterialTargetId({ ...base, mode, studentGroupId: 'g1',
      groupMaterials: [{ groupId: 'g1', kind: 'worksheet', targetId: 'ws-group' }], kind: 'worksheet',
      classroomLevelId: 'ws-class' });
    assert.equal(got, 'ws-class', `${mode} 必须用课堂级 —— 那个模式全班共用一份学习单`);
  }
});

test('标准模式（学习单）：课堂级也没有 ⇒ null', () => {
  assert.equal(
    resolveMaterialTargetId({ ...base, mode: 'standard', studentGroupId: null, kind: 'worksheet' }),
    null,
  );
});
