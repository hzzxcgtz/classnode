'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { Pagination, TeacherEmptyState, TeacherLoadingState, TeacherPageHeader, Toast } from '@/lib/components';
import type { WebappSummary, RelatedClassroom } from '@/lib/types';
import { WebappCard } from './webapp-card';
import { WebappDeleteBlockedDialog, WebappPreviewDialog, WebappRelatedClassroomsDialog } from './webapp-overlays';
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
  const [deleteBlocked, setDeleteBlocked] = useState<{ webappName: string; classrooms: RelatedClassroom[] } | null>(null);
  /**
   * 探究网页托管服务的源。管理页不在课堂上下文里，拿不到课堂详情下发的 `webappPort`，
   * 所以走 `/api/server-info`（服务端实算的完整地址）。
   * 拿不到时预览窗给出说明而不是空白 iframe。
   */
  const [webappOrigin, setWebappOrigin] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [retryingMediaId, setRetryingMediaId] = useState<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  const notify = (message: string, type: 'success' | 'error') => {
    setToast({ show: true, msg: message, type });
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(prev => ({ ...prev, show: false })), 3000);
  };

  const {
    webapps, loading, busyOperation,
    relatedClassrooms, relatedLoading, openRelatedClassrooms, closeRelatedClassrooms,
    loadWebapps, deleteWebapp, confirmationDialog,
  } = useWebappController({
    onNotice: notice => notify(notice.message, notice.type),
    onDeleteBlocked: (webapp, classrooms) => setDeleteBlocked({ webappName: webapp.name, classrooms }),
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

  const normalizedSearch = search.trim().toLocaleLowerCase('zh-CN');
  const filteredWebapps = webapps.filter(webapp =>
    !normalizedSearch || webapp.name.toLocaleLowerCase('zh-CN').includes(normalizedSearch)
  );
  const pagedWebapps = filteredWebapps.slice((page - 1) * pageSize, page * pageSize);

  async function retryMedia(id: string) {
    setRetryingMediaId(id);
    try {
      const result = await api.retryWebappMedia(id);
      await loadWebapps();
      if (result.mediaStatus === 'ready') notify('设备权限已生效，请刷新学生课堂', 'success');
      else if (result.mediaStatus === 'https-required') notify('请先启用学生课堂 HTTPS', 'error');
      else notify('专用 HTTPS 端口仍不可用', 'error');
    } catch {
      notify('暂时无法重试，请稍后再试', 'error');
    } finally {
      setRetryingMediaId(null);
    }
  }

  return (
    <div>
      <TeacherPageHeader title="探究空间" description="上传静态网页或添加已发布的应用链接。关联到课堂后，学生可以从探究空间打开。" actions={
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

      {!loading && webapps.length > 0 && (
        <div className="webapp-management-filters">
          <label className="webapp-management-search">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} placeholder="搜索网页名称" aria-label="搜索网页" />
            {search && <button type="button" onClick={() => { setSearch(''); setPage(1); }} aria-label="清空网页搜索">×</button>}
          </label>
        </div>
      )}

      {loading ? (
        <TeacherLoadingState label="正在加载探究网页…" />
      ) : webapps.length === 0 ? (
        <TeacherEmptyState
          icon={<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><line x1="3" y1="12" x2="21" y2="12" /><path d="M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18z" /></svg>}
          title="还没有探究网页"
          description="上传静态网页或添加外部链接，学生就能在课堂的探究空间里打开。"
          action={<button className="btn btn-primary" onClick={() => setShowForm(true)}>添加第一个网页</button>}
        />
      ) : filteredWebapps.length === 0 ? (
        // 「有网页，但筛没了」与「一个网页都没有」是两件事，文案必须分开 ——
        // 前者是教师自己筛出来的，得给他一条回去的路。
        <TeacherEmptyState
          icon={<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>}
          title="没有符合条件的网页"
          description="可以换个关键词，或清空搜索查看全部网页。"
          action={<button className="btn btn-secondary" onClick={() => { setSearch(''); setPage(1); }}>查看全部网页</button>}
        />
      ) : (
        // ⚠️ 网格布局由 `globals.css` 的 `.webapp-management-grid` 给（含 900/720 两档断点）。
        // 从前这里是内联 style，而内联样式赢过类选择器 —— 于是这一页完全没有小屏适配。
        <div className="webapp-management-grid">
          {pagedWebapps.map(webapp => (
            <WebappCard
              key={webapp.id}
              webapp={webapp}
              deleting={busyOperation === `${webapp.id}:delete`}
              onPreview={() => setPreviewing(webapp)}
              onEdit={() => { setEditing(webapp); setShowForm(true); }}
              onDelete={() => void deleteWebapp(webapp)}
              retryingMedia={retryingMediaId === webapp.id}
              onRetryMedia={() => void retryMedia(webapp.id)}
              onShowRelatedClassrooms={() => void openRelatedClassrooms(webapp)}
            />
          ))}
        </div>
      )}
      {filteredWebapps.length > pageSize && (
        <Pagination current={page} total={filteredWebapps.length} pageSize={pageSize} pageSizeOptions={[8, 12, 20, 40, 60]} onChange={setPage} onPageSizeChange={setPageSize} />
      )}

      {previewing && !previewing.externalUrl && <WebappPreviewDialog webapp={previewing} origin={webappOrigin} onClose={() => setPreviewing(null)} />}
      {deleteBlocked && <WebappDeleteBlockedDialog webappName={deleteBlocked.webappName} classrooms={deleteBlocked.classrooms} onClose={() => setDeleteBlocked(null)} />}
      {relatedClassrooms && (
        <WebappRelatedClassroomsDialog
          webappName={relatedClassrooms.webapp.name}
          classrooms={relatedClassrooms.classrooms}
          loading={relatedLoading}
          onClose={closeRelatedClassrooms}
        />
      )}
      {confirmationDialog}
      {toast.show && <Toast msg={toast.msg} type={toast.type} />}
    </div>
  );
}
