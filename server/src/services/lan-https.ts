import fs from 'node:fs';
import path from 'node:path';
import { createServer, type Server as HttpsServer } from 'node:https';
import type { Server as HttpServer } from 'node:http';
import type { Duplex } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { ensureRoot, ensureServerCertificate, rootInfo, rootProfile, type CertificatePair } from './lan-certificates.js';

/** Forward actual HTTP objects, not a loopback proxy: peer IP, TLS and shared Socket.IO stay intact. */
export function httpsBridge(target: HttpServer, pair: CertificatePair): HttpsServer {
  const server = createServer({ ...pair, minVersion: 'TLSv1.2' }, (req, res) => target.emit('request', req, res));
  server.on('upgrade', (req, socket, head) => target.emit('upgrade', req, socket, head));
  return server;
}
function listen(server: HttpsServer, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const failed = (error: Error) => { server.removeListener('listening', ready); reject(error); };
    const ready = () => { server.removeListener('error', failed); resolve(); };
    server.once('error', failed); server.once('listening', ready);
    server.listen(port, '0.0.0.0');
  });
}
export interface LanHttpsOptions {
  directory: string;
  main: HttpServer;
  webapp: HttpServer | null;
  httpPort: number;
  webappHttpPort: number;
  httpsPort: number;
  webappHttpsPort: number;
  addresses: () => string[];
  onChange?: () => void;
}
export class LanHttps {
  private options: LanHttpsOptions;
  private root: CertificatePair | null = null;
  private servers: HttpsServer[] = [];
  private sockets = new Set<Duplex>();
  private enabled = false;
  private busy = false;
  private error = '';
  private appliedCertificate = '';
  private timer: ReturnType<typeof setInterval> | null = null;
  constructor(options: LanHttpsOptions) { this.options = options; }
  status() {
    return { enabled: this.enabled, running: this.servers.length === 2, busy: this.busy, error: this.error,
      port: this.options.httpsPort, webappPort: this.options.webappHttpsPort,
      root: this.root ? rootInfo(this.root) : null };
  }
  profile() { if (!this.root) throw new Error('请先由教师启用局域网 HTTPS'); return rootProfile(this.root); }
  certificate() { if (!this.root) throw new Error('请先由教师启用局域网 HTTPS'); return this.root.cert; }
  async initialize() {
    const file = path.join(this.options.directory, 'settings.json');
    if (!fs.existsSync(file)) return;
    try {
      const settings = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (settings.enabled === true) await this.setEnabled(true);
    } catch (error) { this.error = error instanceof Error ? error.message : 'HTTPS 启动失败'; console.warn('[https]', this.error); }
  }
  private persist(enabled: boolean) {
    fs.mkdirSync(this.options.directory, { recursive: true, mode: 0o700 });
    const file = path.join(this.options.directory, 'settings.json');
    const temporary = `${file}.${randomUUID()}.tmp`;
    try { fs.writeFileSync(temporary, JSON.stringify({ enabled }), { mode: 0o600, flag: 'wx' }); fs.renameSync(temporary, file); }
    finally { fs.rmSync(temporary, { force: true }); }
  }
  async setEnabled(enabled: boolean) {
    if (this.busy) throw new Error('证书操作进行中，请稍候');
    this.busy = true;
    try {
      if (!enabled) {
        this.persist(false); this.enabled = false; this.stop(); this.error = '';
        this.options.onChange?.(); return this.status();
      }
      if (this.servers.length === 2) return this.status();
      const ports = [this.options.httpPort, this.options.webappHttpPort, this.options.httpsPort, this.options.webappHttpsPort];
      if (new Set(ports).size !== 4 || ports.some(port => !Number.isInteger(port) || port < 1 || port > 65535)) throw new Error('HTTP、HTTPS 与探究空间端口必须有效且各不相同');
      if (!this.options.webapp) throw new Error('探究空间服务未启动，请先检查端口占用');
      this.root = await ensureRoot(this.options.directory);
      const pair = await ensureServerCertificate(this.options.directory, this.root, this.options.addresses());
      const pending = [httpsBridge(this.options.main, pair), httpsBridge(this.options.webapp, pair)];
      for (const server of pending) server.on('connection', socket => { this.sockets.add(socket); socket.on('close', () => this.sockets.delete(socket)); });
      try {
        await listen(pending[0], this.options.httpsPort);
        await listen(pending[1], this.options.webappHttpsPort);
        this.persist(true);
      } catch (error) { pending.forEach(server => server.close()); this.sockets.forEach(socket => socket.destroy()); throw error; }
      this.servers = pending;
      this.appliedCertificate = pair.cert;
      this.enabled = true; this.error = '';
      this.timer = setInterval(() => { void this.refresh().catch(error => {
        this.error = error instanceof Error ? error.message : '更新服务证书失败'; console.warn('[https]', this.error);
      }); }, 30_000);
      this.timer.unref();
      this.options.onChange?.();
      return this.status();
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'HTTPS 配置失败';
      throw error;
    } finally { this.busy = false; }
  }
  async refresh() {
    if (!this.root || this.servers.length !== 2 || this.busy) return;
    this.busy = true;
    try {
      // Re-read and validate the persistent root, never create a replacement during renewal.
      const root = await ensureRoot(this.options.directory);
      if (rootInfo(root).fingerprint !== rootInfo(this.root).fingerprint) throw new Error('根证书在运行中被更换，已拒绝自动使用，请重启并由管理员核对');
      const pair = await ensureServerCertificate(this.options.directory, root, this.options.addresses());
      if (pair.cert !== this.appliedCertificate) {
        this.servers.forEach(server => server.setSecureContext(pair));
        this.appliedCertificate = pair.cert;
        this.options.onChange?.();
      }
      this.error = '';
    } finally { this.busy = false; }
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.servers.forEach(server => server.close());
    this.servers = [];
    this.sockets.forEach(socket => socket.destroy()); this.sockets.clear();
  }
}
