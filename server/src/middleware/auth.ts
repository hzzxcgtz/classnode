import crypto from 'crypto';
import type { NextFunction, Request, Response } from 'express';

const SESSION_COOKIE = 'classnode_teacher_session';
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const sessions = new Map<string, number>();

function parseCookies(header?: string): Record<string, string> {
  if (!header) return {};
  return Object.fromEntries(header.split(';').map(part => {
    const index = part.indexOf('=');
    if (index < 0) return [part.trim(), ''];
    return [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())];
  }));
}

function cookieOptions(maxAgeSeconds?: number): string {
  const parts = [
    `${SESSION_COOKIE}=`,
    'HttpOnly',
    'SameSite=Strict',
    'Path=/',
  ];
  if (maxAgeSeconds !== undefined) parts.push(`Max-Age=${maxAgeSeconds}`);
  if (process.env.NODE_ENV === 'production' && process.env.CLASSNODE_HTTPS === 'true') {
    parts.push('Secure');
  }
  return parts.join('; ');
}

export function createTeacherSession(res: Response): void {
  const token = crypto.randomBytes(32).toString('base64url');
  sessions.set(token, Date.now() + SESSION_TTL_MS);
  res.setHeader('Set-Cookie', cookieOptions(Math.floor(SESSION_TTL_MS / 1000)).replace(`${SESSION_COOKIE}=`, `${SESSION_COOKIE}=${token}`));
}

export function destroyTeacherSession(req: Request, res: Response): void {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (token) sessions.delete(token);
  res.setHeader('Set-Cookie', cookieOptions(0));
}

export function revokeAllTeacherSessions(): void {
  sessions.clear();
}

export function hasTeacherSession(req: Request): boolean {
  return hasTeacherSessionCookie(req.headers.cookie);
}

export function hasTeacherSessionCookie(cookieHeader?: string): boolean {
  const token = parseCookies(cookieHeader)[SESSION_COOKIE];
  if (!token) return false;
  const expiresAt = sessions.get(token);
  if (!expiresAt || expiresAt <= Date.now()) {
    sessions.delete(token);
    return false;
  }
  return true;
}

export function requireTeacher(req: Request, res: Response, next: NextFunction): void {
  if (!hasTeacherSession(req)) {
    res.status(401).json({ error: '教师会话已失效，请重新登录' });
    return;
  }
  next();
}

export function isLoopbackRequest(req: Request): boolean {
  const address = req.socket.remoteAddress || '';
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

function normalizeSocketAddress(address?: string): string {
  const value = (address || '').split('%')[0].toLowerCase();
  return value.startsWith('::ffff:') ? value.slice(7) : value;
}

/**
 * Accept loopback requests and requests made by this computer through one of
 * its own LAN addresses. For a direct local connection the socket's remote
 * and local addresses are identical; another device has a different remote
 * address, so it cannot claim device-local setup privileges.
 */
export function isLocalMachineRequest(req: Request): boolean {
  if (isLoopbackRequest(req)) return true;
  const remoteAddress = normalizeSocketAddress(req.socket.remoteAddress);
  const localAddress = normalizeSocketAddress(req.socket.localAddress);
  return remoteAddress !== '' && localAddress !== '' && remoteAddress === localAddress;
}
