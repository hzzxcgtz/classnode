import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import type { Request, Response } from 'express';
import {
  createTeacherSession,
  destroyTeacherSession,
  hasTeacherSession,
  isLocalMachineRequest,
  isLoopbackRequest,
  revokeAllTeacherSessions,
} from '../middleware/auth.js';
import { createStudentToken, verifyStudentToken } from '../middleware/student-auth.js';
import { hashPassword, isAcceptablePassword, verifyPassword } from '../services/password-security.js';

test('scrypt password hashes verify without containing the password', () => {
  const password = 'teacher-password-123';
  const hash = hashPassword(password);
  assert.match(hash, /^scrypt\$/);
  assert.equal(hash.includes(password), false);
  assert.equal(verifyPassword(password, hash), true);
  assert.equal(verifyPassword('wrong-password', hash), false);
  assert.equal(verifyPassword(password, 'scrypt$broken'), false);
});

test('★ 密码策略：不限长度（教师 2026-09-25 的要求），但**空密码必须被拒**', () => {
  // 🔴 这条网守的是**空**那一格，不是长度。放开长度这条要求时，最容易顺手写成
  //    「干脆不校验了」—— 而那样做的后果不是「方便」，是**拆门**：
  //    空密码会被哈希后写进 `admin_password` 那一行 ⇒ 那一行存在
  //    ⇒ `POST /verify` 的 `if (!stored) return { firstTime: true }`（"还没设密码"）
  //    不再成立 ⇒ **任何人提交一个空密码就登录了教师端**。
  assert.equal(isAcceptablePassword(''), false, '空字符串必须被拒');
  assert.equal(isAcceptablePassword(null), false, 'null 必须被拒（漏字段 / 手改的请求体）');
  assert.equal(isAcceptablePassword(undefined), false, '缺字段必须被拒');
  assert.equal(isAcceptablePassword(12345678), false, '非字符串必须被拒（别让数字从类型缝里进来）');
  assert.equal(isAcceptablePassword({}), false);
  // 阳性对照：**真的**不限长度 —— 1 位过、超长也过。
  // 少了这两条，「把整个校验删掉」和「按策略放行」在用例上就分不出来。
  assert.equal(isAcceptablePassword('1'), true, '1 位是合法的（这正是这次改动的目的）');
  assert.equal(isAcceptablePassword('a'.repeat(200)), true, '没有上界');
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

test('the host computer may use its own LAN address for device-local actions', () => {
  const hostViaLan = {
    socket: { remoteAddress: '::ffff:172.20.10.2', localAddress: '172.20.10.2' },
  } as unknown as Request;
  const remoteLanClient = {
    socket: { remoteAddress: '172.20.10.8', localAddress: '172.20.10.2' },
  } as unknown as Request;
  const loopback = {
    socket: { remoteAddress: '::1', localAddress: '::1' },
  } as unknown as Request;

  assert.equal(isLocalMachineRequest(hostViaLan), true);
  assert.equal(isLocalMachineRequest(loopback), true);
  assert.equal(isLocalMachineRequest(remoteLanClient), false);
});

test('student token binds classroom and student and rejects tampering', () => {
  const token = createStudentToken('classroom-1', 'student-1');
  const session = verifyStudentToken(token);
  assert.equal(session?.classroomId, 'classroom-1');
  assert.equal(session?.studentId, 'student-1');
  assert.equal(verifyStudentToken(token.slice(0, -1) + (token.endsWith('a') ? 'b' : 'a')), null);
  assert.equal(verifyStudentToken('not-a-token'), null);
});
