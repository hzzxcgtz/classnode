'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { Pagination, TeacherEmptyState, TeacherLoadingState, TeacherPageHeader, Toast } from '@/lib/components';
import type { WebappSummary } from '@/lib/types';
import { WebappCard } from './webapp-card';
import { WebappDeleteBlockedDialog, WebappPreviewDialog } from './webapp-overlays';
import { WebappForm } from './webapp-form';
import { useWebappController } from './use-webapp-controller';

/**
 * 探究网页管理页（`/teacher/webapps/`）。
 *
 * 三件事：上传 / 预览 / 改入口（+ 删除）。**没有「启用」开关** —— 网页没有启用这回事，
 * 它被课堂引用才有意义，那是创建课堂那一步的属性（见 `webapp-card.tsx` 的注释）。
 */
export default function WebappsPage() {
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<WebappSummary | null>(null);
  const [previewing, setPreviewing] = useState<WebappSummary | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(12);
  const [toast, setToast] = useState<{ show: boolean; msg: string; type: 'success' | 'error' }>({ show: false, msg: '', type: 'success' });
  const [deleteBlocked, setDeleteBlocked] = useState<{ webappName: string } | null>(null);
  /**
   * 探究网页托管服务的源。管理页不在课堂上下文里，拿不到课堂详情下发的 `webappPort`，
   * 所以走 `/api/server-info`（服务端实算的完整地址）。
   * 拿不到时预览窗给出说明而不是空白 iframe。
   */
  const [webappOrigin, setWebappOrigin] = useState<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  const notify = (message: string, type: 'success' | 'error') => {
    setToast({ show: true, msg: message, type });
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(prev => ({ ...prev, show: false })), 3000);
  };

  const { webapps, loading, busyOperation, loadWebapps, deleteWebapp } = useWebappController({
    onNotice: notice => notify(notice.message, notice.type),
    onDeleteBlocked: webapp => setDeleteBlocked({ webappName: webapp.name }),
  });

  useEffect(() => {
    let cancelled = false;
    api.getServerInfo()
      .then(info => { if (!cancelled) setWebappOrigin(info.webappOrigin ?? null); })
      .catch(() => { if (!cancelled) setWebappOrigin(null); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => () => {
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
  }, []);

  const pagedWebapps = webapps.slice((page - 1) * pageSize, page * pageSize);

  return (
    <div>
      <TeacherPageHeader title="探究网页" description="上传课堂用的静态网页，学生会在探究助手里打开它。" actions={
        <button className="btn btn-primary" onClick={() => { setEditing(null); setShowForm(true); }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
          添加网页
        </button>
      } />

      {showForm && (
        <WebappForm
          webapp={editing}
          onClose={() => { setShowForm(false); setEditing(null); }}
          onSaved={() => { void loadWebapps(); }}
        />
      )}

      {loading ? (
        <TeacherLoadingState label="正在加载探究网页…" />
      ) : webapps.length === 0 ? (
        <TeacherEmptyState
          icon={<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><line x1="3" y1="12" x2="21" y2="12" /><path d="M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18z" /></svg>}
          title="还没有探究网页"
          description="上传一个静态网页（推荐整个文件夹压成 ZIP），课堂上学生就能在探究助手里打开它。"
          action={<button className="btn btn-primary" onClick={() => setShowForm(true)}>添加第一个网页</button>}
        />
      ) : (
        <div className="webapp-management-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 16 }}>
          {pagedWebapps.map(webapp => (
            <WebappCard
              key={webapp.id}
              webapp={webapp}
              deleting={busyOperation === `${webapp.id}:delete`}
              onPreview={() => setPreviewing(webapp)}
              onEdit={() => { setEditing(webapp); setShowForm(true); }}
              onDelete={() => void deleteWebapp(webapp)}
            />
          ))}
        </div>
      )}
      {webapps.length > pageSize && (
        <Pagination current={page} total={webapps.length} pageSize={pageSize} pageSizeOptions={[8, 12, 20, 40, 60]} onChange={setPage} onPageSizeChange={setPageSize} />
      )}

      {previewing && <WebappPreviewDialog webapp={previewing} origin={webappOrigin} onClose={() => setPreviewing(null)} />}
      {deleteBlocked && <WebappDeleteBlockedDialog webappName={deleteBlocked.webappName} onClose={() => setDeleteBlocked(null)} />}
      {toast.show && <Toast msg={toast.msg} type={toast.type} />}
    </div>
  );
}
