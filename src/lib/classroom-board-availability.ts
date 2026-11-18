import type { ClassroomDetail } from './types';

/** Current board roster only; the server's historical participant records stay intact. */
export function classroomBoardAvailability(classroom: ClassroomDetail): ClassroomDetail {
  const disabledIds = new Set(classroom.students.filter(row => row.student.disabled === true).map(row => row.studentId).filter(Boolean));
  return {
    ...classroom,
    students: classroom.students.filter(row => row.student.disabled !== true),
    groupMembersMap: Object.fromEntries(Object.entries(classroom.groupMembersMap ?? {}).map(([id, group]) => [id, {
      ...group, members: group.members.filter(member => !disabledIds.has(member.id)),
    }])),
  };
}
