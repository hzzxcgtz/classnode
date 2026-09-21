'use client';

import { useEffect, useState } from 'react';
import { WEBAPP_IFRAME_SANDBOX } from '@/lib/webapp-sandbox';
import type { WebappSummary } from '@/lib/types';

/** 「无法删除」弹窗。骨架照 `agents/agent-overlays.tsx` 的 DeleteBlockedDialog，只改文案。 */
export function WebappDeleteBlockedDialog({ webappName, onClose }: { webappName: string; onClose: () => void }) {
  return <><div className="modal-overlay" onClick={onClose} /><div className="modal-content" role="alertdialog" aria-modal="true" aria-labelledby="webapp-delete-blocked-title" style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', zIndex: 201, background: 'white', borderRadius: 16, padding: 32, width: 420, maxWidth: '90vw', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
    <div style={{ textAlign: 'center', marginBottom: 20 }}><div style={{ width: 52, height: 52, borderRadius: '50%', background: '#fef2f2', margin: '0 auto 12px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg></div><h3 id="webapp-delete-blocked-title" style={{ fontSize: '1.063rem', fontWeight: 700, margin: '0 0 4px' }}>无法删除探究网页</h3><p style={{ fontSize: '0.813rem', color: '#64748b', margin: 0 }}>这个网页正被课堂使用中，删掉会让那些课堂里的学生打不开它。</p></div>
    <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: '14px 16px', marginBottom: 20 }}><div style={{ fontSize: '0.813rem', fontWeight: 600, color: '#991b1b', marginBottom: 4, wordBreak: 'break-all' }}>「{webappName}」</div><div style={{ fontSize: '0.813rem', color: '#b91c1c' }}>想删的话，先在这些课堂里取消关联（目前课堂关联只能在创建课堂时勾选）。</div></div>
    <button type="button" className="btn btn-primary btn-lg" style={{ width: '100%' }} onClick={onClose}>知道了</button>
  </div></>;
}

/**
 * 上传后的「外部依赖」提醒。
 *
 * ⚠️ **只展示数量与文件名，永远不展示 URL。** 服务端的响应里**根本没有 urls 字段**
 * （见 `webapps.ts` 的 `scanExternalDepsSafe`）：扫描器的 `url` 只保证「识别出这是一条
 * 外部依赖」，不保证完整（CSS 里含 `;` 的地址会被截断）。把截断的地址给教师看，
 * 他会照着去改一个不存在的链接 —— 那比不给更糟。
 */
export function WebappExternalDepsNotice({ deps }: { deps: { count: number; files: string[] } }) {
  if (deps.count === 0) return null;
  return (
    <div role="status" style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, padding: '12px 14px', marginBottom: 16 }}>
      <div style={{ fontSize: '0.813rem', fontWeight: 600, color: '#92400e', marginBottom: 4 }}>
        本网页依赖 {deps.count} 个外部资源
      </div>
      <div style={{ fontSize: '0.75rem', color: '#b45309', lineHeight: 1.6 }}>
        涉及这些文件：{deps.files.slice(0, 6).join('、')}{deps.files.length > 6 ? ` 等 ${deps.files.length} 个` : ''}
        。课堂用的网络如果连不上外网，这些资源会加载失败。
      </div>
    </div>
  );
}

/**
 * 在线预览。
 *
 * ⚠️ **iframe 必须带与学生端同一套 sandbox**（`WEBAPP_IFRAME_SANDBOX`）。
 * 「是教师自己传的网页」不是裸挂的理由：托管源上一个任意页面在教师的浏览器里执行，
 * 而这个浏览器握着教师会话 —— 那正是 sandbox 要挡的东西。也别在这里另写一份常量。
 */
export function WebappPreviewDialog({ webapp, origin, onClose }: { webapp: WebappSummary; origin: string | null; onClose: () => void }) {
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // 入口路径按段编码：教师上传时的文件名可能带空格、`#`、中文。
  // `#` 尤其致命 —— 不编码的话浏览器会把它当成片段，请求的是另一个文件。
  const segments = webapp.entryPath.split('/').map(segment => encodeURIComponent(segment));
  const src = origin ? `${origin}/webapps/${encodeURIComponent(webapp.id)}/${segments.join('/')}` : null;

  return (
    <>
      <div className="modal-overlay" onClick={onClose} />
      <div className="modal-content webapp-preview-modal" role="dialog" aria-modal="true" aria-labelledby="webapp-preview-title" style={{ position: 'fixed', inset: '40px', zIndex: 201, background: 'white', borderRadius: 14, display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }}>
        <div style={{ padding: '12px 18px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10, background: 'linear-gradient(135deg, #f8faff, #f0f4ff)' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h3 id="webapp-preview-title" style={{ margin: 0, fontSize: '0.938rem', fontWeight: 700, wordBreak: 'break-all' }}>{webapp.name}</h3>
            <div style={{ fontSize: '0.688rem', color: '#64748b', marginTop: 2 }}>学生在课堂里看到的是同一个网页</div>
          </div>
          <button type="button" className="btn btn-secondary" onClick={() => setReloadKey(k => k + 1)} style={{ fontSize: '0.75rem', padding: '5px 12px' }}>重新加载</button>
          <button type="button" className="btn btn-secondary" onClick={onClose} style={{ fontSize: '0.75rem', padding: '5px 12px' }}>关闭</button>
        </div>
        <div style={{ flex: 1, minHeight: 0, background: '#f1f5f9' }}>
          {src ? (
            <iframe
              key={reloadKey}
              src={src}
              title={webapp.name}
              sandbox={WEBAPP_IFRAME_SANDBOX}
              referrerPolicy="no-referrer"
              style={{ width: '100%', height: '100%', border: 0, display: 'block', background: 'white' }}
            />
          ) : (
            <div style={{ padding: 40, textAlign: 'center', color: '#64748b', fontSize: '0.875rem' }}>
              网页托管服务没有就绪，暂时无法预览。课堂里的学生此刻也打不开这个网页。
            </div>
          )}
        </div>
      </div>
    </>
  );
}
