import test from 'node:test';
import assert from 'node:assert/strict';
import { validateStudentMessagePayload } from '../socket/index.js';

const uploadedFile = '/uploads/chat/chat-550e8400-e29b-41d4-a716-446655440000.png';

test('student socket message accepts only uploaded chat attachment paths', () => {
  assert.deepEqual(
    validateStudentMessagePayload({
      classroomCode: ' ABC123 ',
      studentId: 'student-1',
      content: '请帮我看看这张图',
      fileUrls: [uploadedFile],
      fileNames: ['worksheet.png'],
    }),
    {
      classroomCode: 'ABC123',
      studentId: 'student-1',
      content: '请帮我看看这张图',
      fileUrls: [uploadedFile],
      fileNames: ['worksheet.png'],
    },
  );
});

test('student socket message rejects path traversal, external URLs, and oversized content', () => {
  const base = { classroomCode: 'ABC123', studentId: 'student-1', content: 'hello' };
  assert.equal(validateStudentMessagePayload({ ...base, fileUrls: ['/uploads/chat/../../settings.db'] }), null);
  assert.equal(validateStudentMessagePayload({ ...base, fileUrls: ['https://example.com/file.png'] }), null);
  assert.equal(validateStudentMessagePayload({ ...base, content: 'x'.repeat(10_001) }), null);
});
