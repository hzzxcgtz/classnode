import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classroomBoardAvailability } from './classroom-board-availability.ts';
import type { ClassroomDetail } from './types';

const snapshot = () => ({ students: [
  { id: 'a', studentId: 'sa', student: { disabled: true }, messages: [{ content: '历史记录' }] },
  { id: 'b', studentId: 'sb', student: {} },
  { id: 'g', studentId: null, participantType: 'group', student: {} },
], groupMembersMap: { group: { groupName: '一组', members: [{ id: 'sa' }, { id: 'sb' }] } } }) as unknown as ClassroomDetail;

test('board hides disabled students and group member names without mutating history or group accounts', () => {
  const original = snapshot();
  const board = classroomBoardAvailability(original);
  assert.deepEqual(board.students.map(row => row.id), ['b', 'g']);
  assert.deepEqual(board.groupMembersMap.group.members.map(row => row.id), ['sb']);
  assert.equal(original.students.length, 3);
  assert.equal(original.students[0].messages[0].content, '历史记录');
  assert.equal(original.groupMembersMap.group.members.length, 2);
});
test('fresh snapshot restores the student and old-client missing flags remain available', () => {
  const original = snapshot();
  original.students[0].student.disabled = false;
  const board = classroomBoardAvailability(original);
  assert.equal(board.students.length, 3);
  assert.equal(board.groupMembersMap.group.members.length, 2);
});
