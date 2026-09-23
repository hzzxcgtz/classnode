'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Pagination, TeacherEmptyState, TeacherLoadingState, TeacherPageHeader, Toast } from '@/lib/components';
import type { WorksheetSummary, WorksheetUsage } from '@/lib/types';
import { WorksheetCard } from './worksheet-card';
import { WorksheetDeleteBlockedDialog, WorksheetUsageDialog } from './worksheet-overlays';
import { useWorksheetList } from './use-worksheet-list';

/**
 * 编辑器地址。`id` 缺省 ⇒ 空白编辑器（「新建」与「编辑」是**同一个页面**）。
 *
 * 🔴 `id` 走**查询参数**，不是路径段。本项目是 `output: 'export'` 静态导出、
 * `trailingSlash: true`，`find src/app -name '[*]'` 为空 —— **没有任何动态路由**，
 * `/teacher/worksheets/edit/<id>` 这种地址在导出的静态站里根本不存在。全仓同类跳转
 * 都是这个写法（`classroom/new/page.tsx:354` 的 `/teacher/classroom?id=`）。
 *
 * ⚠️ 编辑页属于 **C2**，本任务不实现它。今天点过去是 404，这是**已知且可接受**的：
 * 两个跳转目标（`?id=…` 与不带参数）与 C2 的 brief 逐字一致，C2 落地后自动接上，
 * 届时不需要改这一页的任何一行。
 */
function editorHref(id?: string): string {
  return id ? `/teacher/worksheets/edit/?id=${encodeURIComponent(id)}` : '/teacher/worksheets/edit/';
}

/**
 * 学习单管理页（`/teacher/worksheets/`）。第一批教师端的第一块界面。
 *
 * 与「探究网页」页（`webapps/page.tsx`）的**形状**一致：薄 page + 控制器 hook +
 * 卡片 + overlays + `Toast` + `Pagination`。刻意不同的地方只有三处：
 *   1. 卡片的主点击动作是**跳转到编辑页**，不是打开表单弹窗；
 *   2. 「新建」也跳编辑页（`?id=` 缺省）；
 *   3. 删除守卫的文案按**三样引用**分开讲，并给出出路（编辑 / 复制一份）——
 *      见 `worksheet-overlays.tsx`，那里也写明了为什么不照抄服务端那段整话
 *      （它把三样引用压成一个逗号串，而弹窗要列清单、要点名哪几间课堂）。
 *
 * ⚠️ 还有一处**刻意的减法**：这一页没有智能体页 / 网页页那两条概览数字，也没有
 * 「按关联状态筛选」下拉。原因是硬性的 —— `GET /api/worksheets` 是**服务端分页**的
 * （本仓唯一一个），手上只有当前这一页的 12 条，在这一页上数「几份被用过」得到的是
 * 当前页的数字，而教师会把它读成全部。宁可不做，也不给一个假数字。
 */
export default function WorksheetsPage() {
  const router = useRouter();
  const [toast, setToast] = useState<{ show: boolean; msg: string; type: 'success' | 'error' }>({ show: false, msg: '', type: 'success' });
  const [deleteBlocked, setDeleteBlocked] = useState<{ worksheet: WorksheetSummary; usage: WorksheetUsage } | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  const notify = (message: string, type: 'success' | 'error') => {
    setToast({ show: true, msg: message, type });
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(prev => ({ ...prev, show: false })), 3000);
  };

  const {
    worksheets, total, loading, loadError,
    page, pageSize, search, setSearch, setPage, setPageSize,
    busyOperation, retry,
    deleteWorksheet, duplicateWorksheet,
    usageDialog, openUsageDialog, closeUsageDialog,
  } = useWorksheetList({
    onNotice: notice => notify(notice.message, notice.type),
    onDeleteBlocked: (worksheet, usage) => setDeleteBlocked({ worksheet, usage }),
  });

  useEffect(() => () => {
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
  }, []);

  /**
   * 「没有学习单」与「筛没了」是两件事，文案必须分开 —— 后者是教师自己搜出来的，
   * 得给他一条回去的路。这与网页页的判据同源。
   */
  const hasSearch = search.trim().length > 0;

  return (
    <div>
      <TeacherPageHeader title="学习单" description="学生课上作答、当堂提交，作答进度会实时汇总到课堂看板。" actions={
        <button className="btn btn-primary" onClick={() => router.push(editorHref())}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
          新建学习单
        </button>
      } />

      {/* 搜索框在「有学习单」或「正在搜」时都要在：搜出 0 条时若把输入框一起收走，
          教师就只能靠空态里那个按钮才能改关键词 —— 而它就在光标刚离开的地方。 */}
      {!loading && !loadError && (total > 0 || hasSearch) && (
        <div className="worksheet-management-filters">
          <label className="worksheet-management-search">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
            <input value={search} onChange={event => setSearch(event.target.value)} placeholder="搜索学习单标题" aria-label="搜索学习单" />
            {search && <button type="button" onClick={() => setSearch('')} aria-label="清空学习单搜索">×</button>}
          </label>
        </div>
      )}

      {loading ? (
        <TeacherLoadingState label="正在加载学习单…" />
      ) : loadError ? (
        // ⚠️ 加载失败**不能**退化成「还没有学习单」：那会让教师以为自己的学习单没了，
        // 转而去新建一份重复的。这里明说是「没读到」，并给一个重试。
        <TeacherEmptyState
          icon={<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>}
          title="学习单列表没有加载出来"
          description={`${loadError}。学习单本身没有丢，稍后重试即可。`}
          action={<button className="btn btn-secondary" onClick={retry}>重试</button>}
        />
      ) : worksheets.length === 0 ? (
        hasSearch ? (
          <TeacherEmptyState
            icon={<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>}
            title="没有匹配的学习单"
            description={`没有标题包含「${search.trim()}」的学习单，可以换个关键词。`}
            action={<button className="btn btn-secondary" onClick={() => setSearch('')}>清空搜索</button>}
          />
        ) : (
          <TeacherEmptyState
            icon={<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2h-4" /><rect x="9" y="2" width="6" height="4" rx="1" /><path d="M8 11l1.5 1.5L12 10" /><path d="M8 17l1.5 1.5L12 16" /><line x1="15" y1="12" x2="17" y2="12" /><line x1="15" y1="18" x2="17" y2="18" /></svg>}
            title="还没有学习单"
            description="做一份学习单，学生就能在课堂上直接作答，作答进度会汇总到课堂看板。"
            action={<button className="btn btn-primary" onClick={() => router.push(editorHref())}>新建第一份学习单</button>}
          />
        )
      ) : (
        // ⚠️ 网格布局由 `globals.css` 的 `.worksheet-management-grid` 给（含 720px 断点）。
        // 不要改成内联 style —— 内联样式赢过类选择器，网页页从前就是这么丢掉小屏适配的。
        <div className="worksheet-management-grid">
          {worksheets.map(worksheet => (
            <WorksheetCard
              key={worksheet.id}
              worksheet={worksheet}
              deleting={busyOperation === `${worksheet.id}:delete`}
              duplicating={busyOperation === `${worksheet.id}:duplicate`}
              onOpen={() => router.push(editorHref(worksheet.id))}
              onDuplicate={() => void duplicateWorksheet(worksheet)}
              onDelete={() => void deleteWorksheet(worksheet)}
              onShowUsage={() => void openUsageDialog(worksheet)}
            />
          ))}
        </div>
      )}

      {/* `Pagination` 自己在只有一页时返回 null，所以这里不必再判一次。 */}
      {!loading && !loadError && (
        <Pagination current={page} total={total} pageSize={pageSize} pageSizeOptions={[8, 12, 20, 40]} onChange={setPage} onPageSizeChange={setPageSize} />
      )}

      {usageDialog && (
        <WorksheetUsageDialog
          worksheet={usageDialog.worksheet}
          usage={usageDialog.usage}
          onClose={closeUsageDialog}
        />
      )}
      {deleteBlocked && (
        <WorksheetDeleteBlockedDialog
          worksheet={deleteBlocked.worksheet}
          usage={deleteBlocked.usage}
          duplicating={busyOperation === `${deleteBlocked.worksheet.id}:duplicate`}
          onEdit={() => router.push(editorHref(deleteBlocked.worksheet.id))}
          // 复制完就关弹窗：出路已经走掉了，留着这个「无法删除」的框只会让人以为还卡着。
          // 副本会出现在列表第一页第一张（列表按 updatedAt 倒序，hook 也已经跳回第 1 页）。
          onDuplicate={() => { const worksheet = deleteBlocked.worksheet; setDeleteBlocked(null); void duplicateWorksheet(worksheet); }}
          onClose={() => setDeleteBlocked(null)}
        />
      )}
      {toast.show && <Toast msg={toast.msg} type={toast.type} />}
    </div>
  );
}
