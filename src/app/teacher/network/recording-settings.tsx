'use client';

import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { IconArrowUpRight, IconChevronDown, IconDownload, IconNetwork, IconShieldCheck } from '@tabler/icons-react';
import { getApiBaseUrl } from '@/lib/api-base';
import styles from './network.module.css';
import { IpadCertificateGuide } from './ipad-certificate-guide';

type HttpsStatus = { enabled: boolean; running: boolean; busy: boolean; error: string; port: number; webappPort: number; root: { fingerprint: string; expiresAt: string } | null };
type ServerInfo = { selectedIp: string; studentUrl: string; httpsSetupUrl: string };

async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${getApiBaseUrl()}${url}`, { credentials: 'include', ...options });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '请求失败');
  return data;
}
export function ClassroomConnectionSettings() {
  const [status, setStatus] = useState<HttpsStatus | null>(null);
  const [info, setInfo] = useState<ServerInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const load = async () => {
    const [nextStatus, nextInfo] = await Promise.all([request<HttpsStatus>('/api/lan-https'), request<ServerInfo>('/api/server-info')]);
    setStatus(nextStatus); setInfo(nextInfo);
  };
  useEffect(() => { let alive = true;
    Promise.all([request<HttpsStatus>('/api/lan-https'), request<ServerInfo>('/api/server-info')])
      .then(([nextStatus, nextInfo]) => { if (alive) { setStatus(nextStatus); setInfo(nextInfo); } })
      .catch(problem => { if (alive) setError(problem instanceof Error ? problem.message : '读取网络设置失败'); });
    return () => { alive = false; };
  }, []);
  const change = async (enabled: boolean) => {
    if (busy) return;
    setBusy(true); setError('');
    try {
      await request<HttpsStatus>('/api/lan-https', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled }) });
      await load();
    } catch (problem) { setError(problem instanceof Error ? problem.message : '设置失败'); }
    finally { setBusy(false); }
  };
  return <div className={styles.page}>
    <section className={styles.connection} aria-labelledby="https-title">
      <div className={styles.connectionInfo}>
        <span className={styles.serviceIcon}><IconNetwork size={26} stroke={1.7} aria-hidden="true" /></span>
        <div><div className={styles.titleRow}><h2 id="https-title">学生课堂 HTTPS</h2><span className={`${styles.status} ${status?.running ? styles.online : ''}`} role="status">{status ? status.running ? '已启用' : '未启用' : '读取中…'}</span></div>
          <p>{status?.running ? '课堂发码时使用 HTTPS 地址' : '为学生课堂提供加密连接，支持录音及探究网页申请设备权限。'}</p>
          {status?.running && <p>关闭 HTTPS 会断开正在使用 HTTPS 的学生连接。</p>}
        </div>
      </div>
      <button type="button" className={`btn ${status?.running ? 'btn-secondary' : 'btn-primary'}`} disabled={!status || busy} onClick={() => void change(!status?.running)}>
        {busy ? '正在配置…' : status?.running ? '关闭 HTTPS' : '启用 HTTPS'}
      </button>
    </section>
    {(error || status?.error) && <p className={styles.error} role="alert">{error || status?.error}</p>}
    {info && (
      <section className={styles.entryPanel} aria-labelledby="student-entry-title">
        <div className={styles.setupHeading}>
          <h2 id="student-entry-title">进入课堂</h2>
          <p>学生与教师电脑连接同一局域网后，可打开学生入口输入互动码，或扫描课堂发码二维码。</p>
        </div>
        <div className={styles.classroomEntry}>
          <span>学生入口</span>
          <a href={info.studentUrl} target="_blank" rel="noreferrer">{info.studentUrl}<IconArrowUpRight size={18} aria-hidden="true" /></a>
        </div>
      </section>
    )}
    {status?.running && info && <>
      <section className={styles.panel} aria-labelledby="setup-title">
        <div className={styles.setupHeading}><h2 id="setup-title">首次配置设备</h2><p>首次通过局域网 HTTPS 进入课堂时，请在学生设备上安装并信任证书。</p></div>
        <div className={styles.setup}>
          <div className={styles.qr}><QRCodeSVG value={info.httpsSetupUrl} size={184} level="M" /><p>证书安装二维码</p></div>
          <div className={styles.steps}>
            <div className={styles.stepTitle}><IconShieldCheck size={22} stroke={1.7} aria-hidden="true" /><h3>首次使用，先安装并信任证书</h3></div>
            <p className={styles.intro}>用学生 iPad 的相机扫描左侧二维码，在 Safari 打开安装引导。已经安装并完全信任同一证书的设备无需重装。</p>
            <a className={styles.guideLink} href={info.httpsSetupUrl} target="_blank" rel="noreferrer">打开安装引导<IconArrowUpRight size={17} aria-hidden="true" /></a>
          </div>
        </div>
        <details className={styles.guideDetails}>
          <summary>iPad 安装指南</summary>
          <IpadCertificateGuide />
        </details>
      </section>
      <details className={styles.details}>
        <summary><span><IconShieldCheck size={18} aria-hidden="true" />证书与高级说明</span><IconChevronDown className={styles.chevron} size={18} aria-hidden="true" /></summary>
        <div className={styles.detailBody}>
          <div className={styles.downloads}><a href={`${getApiBaseUrl()}/network-setup/root.mobileconfig`}><IconDownload size={17} aria-hidden="true" />下载证书描述文件</a><a href={`${getApiBaseUrl()}/network-setup/root.crt`}>下载根证书</a></div>
          <dl><div><dt>安装引导</dt><dd><a href={info.httpsSetupUrl}>{info.httpsSetupUrl}</a></dd></div><div><dt>有效期至</dt><dd>{status.root ? new Date(status.root.expiresAt).toLocaleDateString('zh-CN') : '暂无证书'}</dd></div><div><dt>SHA-256 指纹</dt><dd><code>{status.root?.fingerprint}</code><p>安装前，请与 iPad 安装页核对。</p></dd></div></dl>
          <ul><li>IP 改变会自动更新服务证书。保留同一根证书，学生设备无需重装。</li><li>重装或迁移教师电脑时，请单独安全保留数据目录中的 lan-https 文件夹，课堂数据备份不包含它。不要向学生提供其中的私钥。更换根证书后需重新安装信任。</li><li>学校批量部署可使用 MDM 或 Apple Configurator。</li></ul>
        </div>
      </details>
    </>}
  </div>;
}
