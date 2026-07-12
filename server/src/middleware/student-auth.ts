import crypto from 'crypto';
import type { Request } from 'express';

export interface StudentSession {
  classroomId: string;
  studentId: string;
  expiresAt: number;
}

const TOKEN_TTL_MS = 2 * 60 * 60 * 1000;
const signingKey = crypto.randomBytes(32);

function sign(payload: string): string {
  return crypto.createHmac('sha256', signingKey).update(payload).digest('base64url');
}

export function createStudentToken(classroomId: string, studentId: string): string {
  const session: StudentSession = { classroomId, studentId, expiresAt: Date.now() + TOKEN_TTL_MS };
  const payload = Buffer.from(JSON.stringify(session)).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

export function verifyStudentToken(token?: string): StudentSession | null {
  if (!token) return null;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;
  const expected = Buffer.from(sign(payload));
  const actual = Buffer.from(signature);
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;
  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as StudentSession;
    if (!session.classroomId || !session.studentId || session.expiresAt <= Date.now()) return null;
    return session;
  } catch {
    return null;
  }
}

export function getStudentSession(req: Request): StudentSession | null {
  const header = req.headers.authorization;
  return verifyStudentToken(header?.startsWith('Bearer ') ? header.slice(7) : undefined);
}
