import { Router } from 'express';
import type { LanHttps } from '../services/lan-https.js';

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
export function lanHttpsAdminRoutes(): Router {
  const router = Router();
  router.get('/', (req, res) => {
    const manager = req.app.get('lanHttps') as LanHttps | undefined;
    if (!manager) return res.status(503).json({ error: '网络服务正在初始化，请稍后刷新' });
    res.json(manager.status());
  });
  router.post('/', async (req, res) => {
    if (typeof req.body?.enabled !== 'boolean') return res.status(400).json({ error: 'enabled 必须是布尔值' });
    const manager = req.app.get('lanHttps') as LanHttps | undefined;
    if (!manager) return res.status(503).json({ error: '网络服务正在初始化' });
    try { await manager.setEnabled(req.body.enabled); res.json(manager.status()); }
    catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : 'HTTPS 设置失败' }); }
  });
  return router;
}
export function lanHttpsSetupRoutes(): Router {
  const router = Router();
  router.get(['/root.mobileconfig', '/root.crt'], (req, res) => {
    const manager = req.app.get('lanHttps') as LanHttps | undefined;
    if (!manager?.status().running) return res.status(503).send('请先由教师启用局域网 HTTPS');
    res.setHeader('Cache-Control', 'no-store');
    if (req.path.endsWith('.mobileconfig')) {
      res.setHeader('Content-Type', 'application/x-apple-aspen-config');
      res.setHeader('Content-Disposition', 'attachment; filename="ClassNode.mobileconfig"');
      res.send(manager.profile());
    } else {
      res.setHeader('Content-Type', 'application/x-x509-ca-cert');
      res.setHeader('Content-Disposition', 'attachment; filename="ClassNode-root.crt"');
      res.send(manager.certificate());
    }
  });
  router.get('/', (req, res) => {
    const manager = req.app.get('lanHttps') as LanHttps | undefined;
    const status = manager?.status();
    if (!status?.running) return res.status(503).send('教师尚未启用局域网 HTTPS，请返回课堂并联系教师。');
    const hostname = req.hostname;
    const code = typeof req.query.code === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(req.query.code) ? req.query.code : '';
    const url = `https://${hostname.includes(':') ? `[${hostname}]` : hostname}:${status.port}/classroom/${code ? `?code=${encodeURIComponent(code)}` : ''}`;
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
    res.type('html').send(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ClassNode iPad 录音设置</title>
<style>body{font:17px/1.8 system-ui;color:#263247;background:#f5f7fb;margin:0}main{max-width:680px;margin:36px auto;padding:24px}a{color:#425ab2}a.action{display:block;padding:14px 18px;margin:16px 0;background:#e8edf9;border-radius:12px;text-align:center;text-decoration:none}code{overflow-wrap:anywhere;font-size:13px}li{margin:14px 0}</style>
<main><h1>iPhone / iPad 录音设置</h1><p>由老师协助完成。只需为这台教师电脑安装一次证书；完成后通过 HTTPS 进入课堂。</p>
<a class="action" href="root.mobileconfig">下载 ClassNode 证书描述文件</a><ol><li>在 Safari 中打开本页，点击上方“下载 ClassNode 证书描述文件”，在系统提示中选择“允许”。</li><li>出现“已下载描述文件”后，离开 Safari，手动打开系统“设置”App。在首页账户信息下方点击“已下载描述文件”，再点右上角“安装”，按提示输入设备锁屏密码。描述文件可能显示“未签名”；只有在来源及下方指纹与教师展示的一致时才安装。</li><li>进入“设置 → 通用 → 关于本机 → 证书信任设置”，开启此 ClassNode 根证书的完全信任。</li><li>返回 Safari，点击下方入口，再允许麦克风。</li></ol>
<p>找不到“已下载描述文件”？请先确认下载时选择了“允许”。下载后超过 8 分钟未安装，描述文件会自动删除，需要返回本页重新下载。若系统提示限制安装，请将提示内容交给老师确认。</p><p>此描述文件仅包含本地根证书，不注册设备管理、不配置 VPN。根证书会扩展此设备的证书信任，请先核对来源。</p><p>根证书 SHA-256 指纹：<br><code>${escapeHtml(status.root?.fingerprint || '')}</code></p>
<a class="action" href="${escapeHtml(url)}">进入 HTTPS 课堂</a><h2>减少录音时的重复询问</h2><ol><li>先点击上方入口，在 Safari 中打开 HTTPS 课堂。</li><li>点击地址栏旁的“页面菜单”（旧版为“大小 / aA”），进入“网站设置”；部分版本需先点“更多”。</li><li>将“麦克风”从“询问”改为“允许”，返回课堂再试录。</li></ol><p>请在 HTTPS 课堂页面设置，本安装引导页是另一个地址。更换访问地址后，可能需要重新授权。</p><p>学校管理的 iPad 可由管理员通过 MDM 或 Apple Configurator 批量安装。</p><p><a href="https://support.apple.com/zh-cn/102400">Apple 官方安装说明</a> · <a href="https://support.apple.com/zh-cn/102390">Apple 官方信任说明</a></p></main></html>`);
  });
  return router;
}
