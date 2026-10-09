import crypto from 'crypto';
import type { Request } from 'express';

export interface StudentSession {
  classroomId: string;
  studentId: string;
  expiresAt: number;
  sessionId: string;
}

const TOKEN_TTL_MS = 2 * 60 * 60 * 1000;
const currentSessions = new Map<string, { id: string; expiresAt: number }>();
let signingKey = crypto.randomBytes(32);

function sign(payload: string): string {
  return crypto.createHmac('sha256', signingKey).update(payload).digest('base64url');
}

export function createStudentToken(classroomId: string, studentId: string): string {
  const session: StudentSession = { classroomId, studentId, expiresAt: Date.now() + TOKEN_TTL_MS, sessionId: crypto.randomBytes(16).toString('hex') };
  for (const [key, item] of currentSessions) if (item.expiresAt <= Date.now()) currentSessions.delete(key);
  currentSessions.set(`${classroomId}:${studentId}`, { id: session.sessionId, expiresAt: session.expiresAt });
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
    if (currentSessions.get(`${session.classroomId}:${session.studentId}`)?.id !== session.sessionId) return null;
    return session;
  } catch {
    return null;
  }
}

export function getStudentSession(req: Request): StudentSession | null {
  const header = req.headers.authorization;
  return verifyStudentToken(header?.startsWith('Bearer ') ? header.slice(7) : undefined);
}

export function revokeAllStudentSessions(): void { signingKey = crypto.randomBytes(32); currentSessions.clear(); }
