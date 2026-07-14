import assert from 'node:assert/strict';
import test from 'node:test';
import type { Request, Response } from 'express';
import { createStudentToken } from '../middleware/student-auth.js';
import { requireActiveStudentUpload } from '../routes/upload.js';

function createRequest(hasActiveMembership: boolean): Request {
  return {
    headers: { authorization: `Bearer ${createStudentToken('classroom-1', 'student-1')}` },
    app: {
      get: () => ({
        classroomStudent: { findFirst: async () => hasActiveMembership ? { id: 'membership-1' } : null },
      }),
    },
  } as unknown as Request;
}

function createResponse() {
  let statusCode = 200;
  let body: unknown;
  const response = {
    status: (code: number) => { statusCode = code; return response; },
    json: (value: unknown) => { body = value; return response; },
  } as unknown as Response;
  return { response, get statusCode() { return statusCode; }, get body() { return body; } };
}

test('student uploads require an active classroom membership', async () => {
  const allowedResponse = createResponse();
  let allowedNext = false;
  await requireActiveStudentUpload(createRequest(true), allowedResponse.response, () => { allowedNext = true; });
  assert.equal(allowedNext, true);

  const deniedResponse = createResponse();
  let deniedNext = false;
  await requireActiveStudentUpload(createRequest(false), deniedResponse.response, () => { deniedNext = true; });
  assert.equal(deniedNext, false);
  assert.equal(deniedResponse.statusCode, 403);
  assert.deepEqual(deniedResponse.body, { error: '课堂已结束或学生会话无效，不能上传文件' });
});
