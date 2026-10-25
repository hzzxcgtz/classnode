import { Router, static as serveStatic } from 'express';
import { ipadGuideDirectory, ipadGuideSteps } from '../services/ipad-recording-guide.js';
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
  router.use('/images', serveStatic(ipadGuideDirectory(), { index: false, dotfiles: 'deny' }));
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
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
    res.type('html').send(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ClassNode iPad 录音设置</title>
<style>
body{font:16px/1.8 system-ui;color:#31465b;background:#edf2f7;margin:0}*{box-sizing:border-box}main{max-width:860px;margin:28px auto;padding:30px;background:white;border:1px solid #dae3ed;border-radius:18px}h1{font-size:26px;color:#263b50;margin:0 0 10px}h2{font-size:19px;color:#263b50}a{color:#365f8d;text-underline-offset:4px}a.action{display:block;padding:14px 18px;margin:20px 0;background:#365f8d;color:white;border-radius:10px;text-align:center;text-decoration:none;font-weight:600}a:focus-visible,summary:focus-visible{outline:3px solid #7998ba;outline-offset:3px}code{overflow-wrap:anywhere;font-size:13px}.intro,.muted{color:#60758a}.steps{list-style:none;padding:0;counter-reset:step}.steps>li{counter-increment:step;position:relative;padding:20px 0 20px 44px;border-top:1px solid #e7edf3}.steps>li:before{content:counter(step);position:absolute;left:0;top:23px;display:grid;place-items:center;width:30px;height:30px;border-radius:50%;background:#eaf0f7;color:#365f8d;font-weight:650}.steps h2{font-size:18px;margin:0 0 10px}.steps p{margin:8px 0}.note{padding:10px 14px;background:#f5f8fb;border-left:3px solid #b6c9de;border-radius:0 6px 6px 0;font-size:14px;color:#5c6f83}summary{cursor:pointer;color:#365f8d;min-height:44px;padding:10px 0;font-weight:600}.photos{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,240px),1fr));gap:16px;margin-top:10px;align-items:start}figure{margin:0;min-width:0}figure a{display:block;border:1px solid #dce4ee;border-radius:10px;overflow:hidden}img{display:block;width:auto;max-width:100%;height:auto;margin:0 auto}figcaption{font-size:13px;color:#60758a;margin-top:6px}.certificate{border-top:1px solid #e7edf3;margin-top:24px;padding-top:12px;font-size:14px}.sources{font-size:13px;color:#60758a}@media(max-width:600px){body{background:#fff}main{margin:0;padding:24px 18px;border:0;border-radius:0}.steps>li{padding-left:38px}h1{font-size:24px}.steps h2{font-size:17px}}
</style>
<main><h1>iPhone / iPad 录音设置</h1><p class="intro">每台学生设备分别操作一次。先安装证书，再开启完全信任，最后进入课堂试录。</p>
<a class="action" href="root.mobileconfig">下载 ClassNode 证书描述文件</a>
<p class="muted">请用 Safari 打开本页。下方实拍图仅作操作示例，IP 和证书名称末尾字符以当前教师电脑为准。</p>
<ol class="steps">${ipadGuideSteps().map(step => `<li><h2>${escapeHtml(step.title)}</h2><p>${escapeHtml(step.text)}</p><p class="note">${escapeHtml(step.note)}</p>${step.images.length ? `<details><summary>查看这一步的 iPad 实拍</summary><div class="photos">${step.images.map(photo => `<figure><a href="images/${escapeHtml(photo.file)}" target="_blank" rel="noreferrer"><img src="images/${escapeHtml(photo.file)}" alt="${escapeHtml(photo.alt)}" loading="lazy"></a><figcaption>${escapeHtml(photo.caption)}</figcaption></figure>`).join('')}</div></details>` : ''}</li>`).join('')}</ol>
<a class="action" href="${escapeHtml(url)}">进入 HTTPS 课堂，试录一句</a>
<details class="certificate"><summary>证书核对与常见问题</summary><p>根证书 SHA-256 指纹（请与教师设置页核对）：<br><code>${escapeHtml(status.root?.fingerprint || '')}</code></p><p>找不到“已下载描述文件”？请确认下载时选择了“允许”；超过 8 分钟未安装，请重新下载。若系统提示限制安装，请联系学校管理员。</p><p>此描述文件仅包含当前教师电脑的本地根证书，不注册设备管理、不配置 VPN。根证书会扩展设备的证书信任，请先核对来源。</p><p>保留同一根证书时，教师 IP 改变无需重装证书，但新地址可能需要重新允许麦克风。学校管理的 iPad 可由管理员通过 MDM 或 Apple Configurator 批量安装。</p></details>
<p class="sources">实拍图已裁去账户等无关信息。菜单名称可能随系统版本略有不同。<br><a href="https://support.apple.com/zh-cn/102400">Apple 官方安装说明</a> · <a href="https://support.apple.com/zh-cn/102390">Apple 官方信任说明</a></p></main></html>`);
  });
  return router;
}
