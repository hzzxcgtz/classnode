import cors, { type CorsOptions } from 'cors';
import type { Application, Request, RequestHandler } from 'express';
import type { IncomingMessage } from 'node:http';
import { isLoopbackAddress } from './auth.js';

export interface OriginPolicy {
  webappPort: number;
  /** Only set when a separate development frontend is running. */
  frontendPort?: number;
  https?: boolean;
}

type OriginRequest = Pick<IncomingMessage, 'headers' | 'socket'>;
const NATIVE_ORIGINS = new Set(['tauri://localhost', 'http://tauri.localhost', 'https://tauri.localhost']);

function targetOrigin(req: OriginRequest, policy: OriginPolicy): URL | null {
  try {
    if (!req.headers.host || /[\s/@\\]/.test(req.headers.host)) return null;
    return new URL(`${policy.https ? 'https' : 'http'}://${req.headers.host}`);
  } catch { return null; }
}

function trustedOrigin(origin: string, req: OriginRequest, policy: OriginPolicy): boolean {
  // The native control panel has its own origin and can only call the local host.
  if (NATIVE_ORIGINS.has(origin)) return isLoopbackAddress(req.socket.remoteAddress);
  const target = targetOrigin(req, policy);
  if (!target) return false;
  try {
    const source = new URL(origin);
    if (source.origin !== origin || !['http:', 'https:'].includes(source.protocol)) return false;
    const sourcePort = Number(source.port || (source.protocol === 'https:' ? 443 : 80));
    if (sourcePort === policy.webappPort) return false;
    if (source.origin === target.origin) return true;
    return policy.frontendPort !== undefined
      && source.hostname === target.hostname
      && source.protocol === target.protocol
      && sourcePort === policy.frontendPort;
  } catch { return false; }
}

/** Apply to HTTP and WebSocket handshakes: CORS alone does not block writes/WS. */
export function isTrustedRequestOrigin(req: OriginRequest, policy: OriginPolicy): boolean {
  const origin = req.headers.origin;
  if (origin !== undefined) return trustedOrigin(origin, req, policy);
  const referer = req.headers.referer;
  if (referer) {
    try { return trustedOrigin(new URL(referer).origin, req, policy); }
    catch { return false; }
  }
  const site = req.headers['sec-fetch-site'];
  // Normal same-origin GETs may omit Origin/Referer. Browser requests from a
  // different site/port must have a verifiable source. Native CLI has no metadata.
  return site === undefined || site === 'same-origin' || site === 'none';
}

export function requestCorsOptions(req: OriginRequest, policy: OriginPolicy): CorsOptions {
  return {
    origin: isTrustedRequestOrigin(req, policy) ? req.headers.origin ?? false : false,
    credentials: true,
  };
}

export function isLanRequestAllowed(address: string | undefined, enabled: boolean): boolean {
  return enabled || isLoopbackAddress(address);
}

export function lanAccessGate(enabled: () => boolean): RequestHandler {
  return (req, res, next) => {
    if (isLanRequestAllowed(req.socket.remoteAddress, enabled())) return next();
    res.status(403).json({ error: '教师已关闭局域网访问' });
  };
}

/** Must be installed before static uploads or API routes. */
export function installRequestSecurity(app: Application, policy: OriginPolicy): void {
  app.use(lanAccessGate(() => app.get('lanAccessEnabled') !== false));
  app.use('/api', (req: Request, res, next) => {
    if (isTrustedRequestOrigin(req, policy)) return next();
    res.status(403).json({ error: '请求来源不受信任' });
  });
  app.use(cors<Request>((req, callback) => callback(null, requestCorsOptions(req, policy))));
}
