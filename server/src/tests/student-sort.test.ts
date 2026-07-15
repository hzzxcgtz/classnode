import test from 'node:test';
import assert from 'node:assert/strict';
import { compareStudentNumbers } from '../services/student-sort.js';

test('student numbers use natural order and place missing numbers last', () => {
  const students = [
    { no: '10', name: '十号' },
    { no: null, name: '无学号乙' },
    { no: '2', name: '二号' },
    { no: '001', name: '一号' },
    { no: '', name: '无学号甲' },
  ];
  students.sort((left, right) => compareStudentNumbers(left.no, right.no, left.name, right.name));
  assert.deepEqual(students.map(student => student.name), ['一号', '二号', '十号', '无学号甲', '无学号乙']);
});
