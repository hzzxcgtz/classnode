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
  const [usageFilter, setUsageFilter] = useState<'all' | 'used' | 'unused'>('all');
  const toastTimerRef = useRef<number | null>(null);

  const notify = (message: string, type: 'success' | 'error') => {
    setToast({ show: true, msg: message, type });
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(prev => ({ ...prev, show: false })), 3000);
  };

  const {
    webapps, loading, busyOperation,
    relatedClassrooms, relatedLoading, openRelatedClassrooms, closeRelatedClassrooms,
    loadWebapps, deleteWebapp,
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

  /**
   * 搜索与「关联状态」筛选。与智能体页同一套信息架构，但**判据只有一个维度**：
   * 网页没有启用/健康/异常这三件事，只有「被课堂用着吗」。
   * 硬套智能体那四格会得到无意义的数字（例如「连接健康」对网页根本没有定义）。
   */
  const normalizedSearch = search.trim().toLocaleLowerCase('zh-CN');
  const filteredWebapps = webapps.filter(webapp => {
    const matchesSearch = !normalizedSearch || webapp.name.toLocaleLowerCase('zh-CN').includes(normalizedSearch);
    const matchesUsage = usageFilter === 'all'
      || (usageFilter === 'used' && webapp.classroomCount > 0)
      || (usageFilter === 'unused' && webapp.classroomCount === 0);
    return matchesSearch && matchesUsage;
  });
  const pagedWebapps = filteredWebapps.slice((page - 1) * pageSize, page * pageSize);
  const usageSummary = {
    used: webapps.filter(webapp => webapp.classroomCount > 0).length,
    unused: webapps.filter(webapp => webapp.classroomCount === 0).length,
  };

  return (
    <div>
      {/* 2026-09-25：标题由「探究网页」改为「探究空间」（教师裁定）。
          🔴 **副标题必须跟着改**：原来是「上传课堂用的静态网页，学生会在探究空间里打开它。」
          —— 标题改完之后那句就成了**自己说自己**（「探究空间 / …学生会在探究空间里打开它」），
          读起来像是「这一页就是学生打开它的那个地方」，而这一页是**教师端的网页库**。
          改后的句子把两件事分开：**这里**上传 → 在**新建课堂**里关联 → 学生在**探究空间**里打开。
          ⚠️ 页内其余文案（`还没有探究网页` / `无法删除探究网页` / 表单标题…）**本轮没动**，
          所以这一页现在是**两个词并存**的状态 —— 那是教师圈定的范围（只改两处），不是漏改。 */}
      <TeacherPageHeader title="探究空间" description="上传课堂用的静态网页。在新建课堂里关联之后，学生会在「探究空间」里打开它。" actions={
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
        <>
          {/*
            概览三格。⚠️ **刻意不是智能体页那四格**：网页没有「启用 / 健康 / 异常」这三件事，
            硬套会得到无意义的数字（「连接健康」对网页根本没有定义）。这一页唯一有意义的
            维度是「被课堂用着吗」，所以三格都长在它上面。
          */}
          <div className="webapp-management-overview" aria-label="探究网页概览">
            {[
              { label: '全部网页', value: webapps.length, tone: 'blue' },
              { label: '已关联课堂', value: usageSummary.used, tone: 'green' },
              { label: '未被使用', value: usageSummary.unused, tone: 'grey' },
            ].map(item => (
              <div key={item.label} className={`tone-${item.tone}`}>
                <strong>{item.value}</strong>
                <span>{item.label}</span>
              </div>
            ))}
          </div>
          <div className="webapp-management-filters">
            <label className="webapp-management-search">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              <input value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} placeholder="搜索网页名称" aria-label="搜索网页" />
              {search && <button type="button" onClick={() => { setSearch(''); setPage(1); }} aria-label="清空网页搜索">×</button>}
            </label>
            <select value={usageFilter} onChange={event => { setUsageFilter(event.target.value as typeof usageFilter); setPage(1); }} aria-label="按关联状态筛选网页">
              <option value="all">全部关联状态</option>
              <option value="used">已关联课堂</option>
              <option value="unused">未被使用</option>
            </select>
          </div>
        </>
      )}

      {loading ? (
        <TeacherLoadingState label="正在加载探究网页…" />
      ) : webapps.length === 0 ? (
        <TeacherEmptyState
          icon={<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><line x1="3" y1="12" x2="21" y2="12" /><path d="M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18z" /></svg>}
          title="还没有探究网页"
          description="上传一个静态网页（推荐整个文件夹压成 ZIP），课堂上学生就能在探究空间里打开它。"
          action={<button className="btn btn-primary" onClick={() => setShowForm(true)}>添加第一个网页</button>}
        />
      ) : filteredWebapps.length === 0 ? (
        // 「有网页，但筛没了」与「一个网页都没有」是两件事，文案必须分开 ——
        // 前者是教师自己筛出来的，得给他一条回去的路。
        <TeacherEmptyState
          icon={<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>}
          title="没有符合条件的网页"
          description="可以换个关键词，或把关联状态改回「全部关联状态」。"
          action={<button className="btn btn-secondary" onClick={() => { setSearch(''); setUsageFilter('all'); setPage(1); }}>查看全部网页</button>}
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
              onShowRelatedClassrooms={() => void openRelatedClassrooms(webapp)}
            />
          ))}
        </div>
      )}
      {filteredWebapps.length > pageSize && (
        <Pagination current={page} total={filteredWebapps.length} pageSize={pageSize} pageSizeOptions={[8, 12, 20, 40, 60]} onChange={setPage} onPageSizeChange={setPageSize} />
      )}

      {previewing && <WebappPreviewDialog webapp={previewing} origin={webappOrigin} onClose={() => setPreviewing(null)} />}
      {deleteBlocked && <WebappDeleteBlockedDialog webappName={deleteBlocked.webappName} classrooms={deleteBlocked.classrooms} onClose={() => setDeleteBlocked(null)} />}
      {relatedClassrooms && (
        <WebappRelatedClassroomsDialog
          webappName={relatedClassrooms.webapp.name}
          classrooms={relatedClassrooms.classrooms}
          loading={relatedLoading}
          onClose={closeRelatedClassrooms}
        />
      )}
      {toast.show && <Toast msg={toast.msg} type={toast.type} />}
    </div>
  );
}
