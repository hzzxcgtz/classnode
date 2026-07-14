import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import type { Request, Response } from 'express';
import {
  createTeacherSession,
  destroyTeacherSession,
  hasTeacherSession,
  isLoopbackRequest,
  revokeAllTeacherSessions,
} from '../middleware/auth.js';
import { createStudentToken, verifyStudentToken } from '../middleware/student-auth.js';
import { hashPassword, verifyPassword } from '../services/password-security.js';

test('scrypt password hashes verify without containing the password', () => {
  const password = 'teacher-password-123';
  const hash = hashPassword(password);
  assert.match(hash, /^scrypt\$/);
  assert.equal(hash.includes(password), false);
  assert.equal(verifyPassword(password, hash), true);
  assert.equal(verifyPassword('wrong-password', hash), false);
  assert.equal(verifyPassword(password, 'scrypt$broken'), false);
});

test('legacy SHA-256 password remains verifiable for automatic migration', () => {
  const password = 'legacy-password';
  const legacy = crypto.createHash('sha256').update(password).digest('hex');
  assert.equal(verifyPassword(password, legacy), true);
  assert.equal(verifyPassword('wrong-password', legacy), false);
});

test('teacher session cookie is accepted, revoked, and destroyed', () => {
  revokeAllTeacherSessions();
  let setCookie = '';
  const response = { setHeader: (_name: string, value: string) => { setCookie = value; } } as unknown as Response;
  createTeacherSession(response);
  const cookie = setCookie.split(';')[0];
  const request = { headers: { cookie }, socket: { remoteAddress: '127.0.0.1' } } as unknown as Request;
  assert.equal(hasTeacherSession(request), true);
  destroyTeacherSession(request, response);
  assert.equal(hasTeacherSession(request), false);
});

test('only loopback requests may perform device-local setup and recovery actions', () => {
  const loopback = { socket: { remoteAddress: '127.0.0.1' } } as unknown as Request;
  const ipv6Loopback = { socket: { remoteAddress: '::1' } } as unknown as Request;
  const lanClient = { socket: { remoteAddress: '192.168.1.20' } } as unknown as Request;
  assert.equal(isLoopbackRequest(loopback), true);
  assert.equal(isLoopbackRequest(ipv6Loopback), true);
  assert.equal(isLoopbackRequest(lanClient), false);
});

test('student token binds classroom and student and rejects tampering', () => {
  const token = createStudentToken('classroom-1', 'student-1');
  const session = verifyStudentToken(token);
  assert.equal(session?.classroomId, 'classroom-1');
  assert.equal(session?.studentId, 'student-1');
  assert.equal(verifyStudentToken(token.slice(0, -1) + (token.endsWith('a') ? 'b' : 'a')), null);
  assert.equal(verifyStudentToken('not-a-token'), null);
});
