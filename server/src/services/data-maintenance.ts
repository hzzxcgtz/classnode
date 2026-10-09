import type { RequestHandler } from 'express';

let busy = false;
let active = 0;
export function maintenanceBusy(): boolean { return busy; }

/** Count the whole asynchronous task, including upstream waits and late writes. */
export async function trackDataTask<T>(task: () => Promise<T> | T): Promise<T | undefined> {
  if (busy) return undefined;
  active++;
  try { return await task(); } finally { active--; }
}

export const maintenanceGate: RequestHandler = (req, res, next) => {
  if (busy) { res.status(503).json({ error: '系统正在备份或维护，请稍后重试' }); return; }
  // These handlers acquire the exclusive lock themselves, before any file work.
  if (req.method === 'POST' && /^\/api\/export\/(?:backup\/?|reset\/?|restore\/[^/]+\/?)$/.test(req.path)) { next(); return; }
  active++;
  // A closed response can still have an asynchronous handler writing data.
  // Only finish releases it; an interrupted request conservatively blocks maintenance.
  res.once('finish', () => { active--; });
  next();
};

export async function withDataMaintenance<T>(task: () => Promise<T>): Promise<T> {
  if (busy || active) throw new Error('仍有请求或课堂操作进行中，请待操作完成后重试；中断的请求需重启服务后再维护');
  busy = true;
  try { return await task(); } finally { busy = false; }
}
