'use client';

import { useEffect, useState } from 'react';
import { WEBAPP_IFRAME_SANDBOX } from '@/lib/webapp-sandbox';
import { RelatedClassroomList } from '@/lib/components';
import type { WebappSummary, RelatedClassroom } from '@/lib/types';

/**
 * 「无法删除」弹窗。
 *
 * ⚠️ 它必须**列出是哪些课堂**：从前只说「正被课堂使用中」，教师唯一的出路是自己
 * 一间接一间去翻。usage 接口本来就返回了清单（`classrooms`），调用方在删除守卫
 * 那一次请求里已经拿到了 —— 直接传进来，不要为了展示再请求一次。
 */
export function WebappDeleteBlockedDialog({ webappName, classrooms, onClose }: {
  webappName: string;
  classrooms: RelatedClassroom[];
  onClose: () => void;
}) {
  return <><div className="modal-overlay" onClick={onClose} /><div className="modal-content" role="alertdialog" aria-modal="true" aria-labelledby="webapp-delete-blocked-title" style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', zIndex: 201, background: 'white', borderRadius: 16, padding: 32, width: 440, maxWidth: '90vw', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
    <div style={{ textAlign: 'center', marginBottom: 20 }}><div style={{ width: 52, height: 52, borderRadius: '50%', background: '#fef2f2', margin: '0 auto 12px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg></div><h3 id="webapp-delete-blocked-title" style={{ fontSize: '1.063rem', fontWeight: 700, margin: '0 0 4px' }}>无法删除探究网页</h3><p style={{ fontSize: '0.813rem', color: '#64748b', margin: 0 }}>这个网页正被课堂使用中，删掉会让那些课堂里的学生打不开它。</p></div>
    <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: '14px 16px', marginBottom: 20 }}><div style={{ fontSize: '0.813rem', fontWeight: 600, color: '#991b1b', marginBottom: 8, wordBreak: 'break-all' }}>「{webappName}」关联的课堂</div><RelatedClassroomList classrooms={classrooms} emptyText="没读到关联的课堂（这不该发生，请刷新重试）" /><div style={{ fontSize: '0.75rem', color: '#b91c1c', marginTop: 8 }}>课堂关联目前只能在创建课堂时勾选。</div></div>
    <button type="button" className="btn btn-primary btn-lg" style={{ width: '100%' }} onClick={onClose}>知道了</button>
  </div></>;
}

/**
 * 卡片上「关联课堂」入口打开的清单。
 *
 * 与「无法删除」弹窗共用同一个 `RelatedClassroomList` —— 两处的清单必须长得一样，
 * 否则教师会以为它们说的不是同一件事。
 */
export function WebappRelatedClassroomsDialog({ webappName, classrooms, loading, onClose }: {
  webappName: string;
  classrooms: RelatedClassroom[];
  loading: boolean;
  onClose: () => void;
}) {
  return <><div className="modal-overlay" onClick={onClose} /><div className="modal-content" role="dialog" aria-modal="true" aria-labelledby="webapp-related-classrooms-title" style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', zIndex: 201, background: 'white', borderRadius: 16, padding: 32, width: 440, maxWidth: '90vw', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
    <h3 id="webapp-related-classrooms-title" style={{ fontSize: '1.063rem', fontWeight: 700, margin: '0 0 4px', wordBreak: 'break-all' }}>「{webappName}」关联的课堂</h3>
    <p style={{ fontSize: '0.813rem', color: '#64748b', margin: '0 0 16px' }}>教师可以在「新建课堂」里为课堂勾选探究网页。</p>
    <div style={{ border: '1px solid #e2e8f0', borderRadius: 10, padding: '4px 14px', marginBottom: 20 }}>
      <RelatedClassroomList classrooms={classrooms} loading={loading} emptyText="还没有课堂关联这个网页" />
    </div>
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
      {/* ★ 2026-09-25：由 `modal-content webapp-preview-modal` + 内联 `inset: 40px` 改为
          专属类 `.webapp-preview-dialog`（居中 + 3:4 竖屏）。
          🔴 **必须去掉 `modal-content`**：它带来 `max-width: 520px`、`width: 90%`、
          `padding: 32px` 三条 —— 前两条会跟新算出来的宽高打架（显式 width/height 与
          `width: 90%` 同时存在时，浮窗会被压成 90% 而不是那个比例），
          第三条会给预览面板套一圈 32px 的白边（面板自己每一段都有内边距）。 */}
      <div className="webapp-preview-dialog" role="dialog" aria-modal="true" aria-labelledby="webapp-preview-title">
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
