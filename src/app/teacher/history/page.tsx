'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '@/lib/api';
import { useSocket } from '@/lib/socket';
import { Toast, Pagination } from '@/lib/components';
import type { BackupFile, ClassroomHistoryItem, ConversationExportReport, ExportConversationStudent } from '@/lib/types';

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export default function HistoryPage() {
  const [history, setHistory] = useState<ClassroomHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);

  // 导出预览弹窗
  const [preview, setPreview] = useState<{
    type: 'conversations';
    classroomId: string;
    classroom: ClassroomHistoryItem | undefined;
    data: ConversationExportReport;
  } | null>(null);
  const [exporting, setExporting] = useState(false);
  const [previewingClassroomId, setPreviewingClassroomId] = useState<string | null>(null);
  const [exportProgress, setExportProgress] = useState<number | null>(null);
  const [exportStage, setExportStage] = useState('');
  const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>([]);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  // 恢复课堂弹窗
  const [restoreTarget, setRestoreTarget] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  const previewingRef = useRef(false);
  const exportingRef = useRef(false);
  const restoringRef = useRef(false);

  const { socket, on } = useSocket();

  // 监听导出进度
  useEffect(() => {
    return on('export-progress', (p: { progress: number; stage: string }) => {
      setExportProgress(p.progress);
      setExportStage(p.stage);
    });
  }, [on]);

  useEffect(() => {
    api.getHistory().then(data => { setHistory(data); setPage(1); }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const pagedHistory = history.slice((page - 1) * pageSize, page * pageSize);

  // 点击导出：先获取数据并展示预览
  const handlePreview = async (classroomId: string) => {
    if (previewingRef.current || exportingRef.current) return;
    previewingRef.current = true;
    setPreviewingClassroomId(classroomId);
    const cr = history.find(h => h.id === classroomId);
    try {
      const data = await api.exportConversations(classroomId);
      setPreview({ type: 'conversations', classroomId, classroom: cr, data });
      // 默认全选所有学生
      if (data.students) {
        setSelectedStudentIds(data.students.map((s) => s.studentId || s.name).filter(Boolean));
      }
      setExportProgress(null);
      setExportStage('');
    } catch (error: unknown) {
      setToast({ msg: '获取数据失败: ' + (error instanceof Error ? error.message : '请求异常'), type: 'error' });
    } finally {
      previewingRef.current = false;
      setPreviewingClassroomId(null);
    }
  };

  // 切换学生选择
  const toggleStudent = (id: string) => {
    setSelectedStudentIds(prev =>
      prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]
    );
  };

  const toggleAllStudents = (allIds: string[]) => {
    setSelectedStudentIds(prev =>
      prev.length === allIds.length ? [] : [...allIds]
    );
  };

  // 确认导出：服务端生成并下载
  const handleConfirmExport = async () => {
    if (!preview || exportingRef.current) return;
    exportingRef.current = true;
    setExporting(true);
    setExportProgress(0);
    setExportStage('正在准备导出...');

    try {
      const { type, classroom, data } = preview;
      const classroomId = preview.classroomId;
      const socketId = socket?.current?.id;

      // 确定要导出的学生 ID（从原 data 中提取实际 studentId）
      const students = data.students || [];
      const studentIds = students
        .filter((s) => selectedStudentIds.includes(s.studentId || s.name))
        .map((s) => s.studentId)
        .filter((studentId): studentId is string => Boolean(studentId));

      if (type === 'conversations') {
        // DOCX 对话记录
        const resp = await api.exportConversationsDocx(classroomId, { studentIds, socketId });
        if (!resp.ok) throw new Error('导出失败');
        const blob = await resp.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const now = new Date();
        const ts = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}-${String(now.getSeconds()).padStart(2, '0')}`;
        const titleSafe = (data.title || `课堂-${data.code || classroomId.slice(0, 8)}`).replace(/[\\/:*?"<>|]/g, '_');
        a.download = `${titleSafe}-对话记录-${ts}.docx`;
        a.click();
        URL.revokeObjectURL(url);
      }

      setPreview(null);
      setToast({ msg: '导出成功！', type: 'success' });
    } catch (error: unknown) {
      setToast({ msg: '导出失败: ' + (error instanceof Error ? error.message : '请求异常'), type: 'error' });
    }
    exportingRef.current = false;
    setExporting(false);
    setExportProgress(null);
    setExportStage('');
  };

  // 恢复已结束的课堂
  const handleRestoreClassroom = async (id: string) => {
    if (restoringRef.current) return;
    restoringRef.current = true;
    setRestoring(true);
    try {
      await api.restoreClassroom(id);
      setRestoreTarget(null);
      setHistory(prev => prev.filter(h => h.id !== id)); // 从列表移除
      setToast({ msg: '✅ 课堂已恢复！可在「活跃课堂」中查看', type: 'success' });
    } catch (error: unknown) {
      setToast({ msg: '恢复失败: ' + (error instanceof Error ? error.message : '未知错误'), type: 'error' });
    }
    restoringRef.current = false;
    setRestoring(false);
  };

  const totalStudents = history.reduce((sum, cr) => sum + cr._count.students, 0);
  const totalInteractions = history.reduce((sum, cr) => sum + cr._count.interactions, 0);
  const totalChars = history.reduce((sum, cr) => sum + cr.totalChars, 0);
  const totalDuration = history.reduce((sum, cr) => {
    if (!cr.endedAt) return sum;
    return sum + (new Date(cr.endedAt).getTime() - new Date(cr.createdAt).getTime());
  }, 0);
  const avgDuration = history.length > 0 ? Math.round(totalDuration / history.length / 60000) : 0;

  return (
    <div>
      {/* 页面标题 */}
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: "1.375rem", fontWeight: 700, margin: 0, color: '#0f172a' }}>数据管理</h1>
        <p style={{ color: '#64748b', fontSize: "0.813rem", marginTop: 4 }}>
          课堂历史存档与数据导出
        </p>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: '#94a3b8', fontSize: "0.875rem" }}>加载中...</div>
      ) : (
        <>
          {history.length === 0 ? (
            <div className="card" style={{ textAlign: 'center', padding: '60px 20px', marginBottom: 24 }}>
              <div style={{
                width: 56, height: 56, borderRadius: 14,
                background: '#f1f5f9', margin: '0 auto 14px',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round">
                  <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
                </svg>
              </div>
              <h2 style={{ fontSize: "1rem", fontWeight: 600, margin: '0 0 6px', color: '#0f172a' }}>暂无历史记录</h2>
              <p style={{ color: '#94a3b8', fontSize: "0.813rem", margin: 0 }}>
                结束的课堂将在这里显示，方便回顾和导出。备份数据可在下方恢复。
              </p>
            </div>
          ) : (
            <>
              {/* 统计摘要 */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(4, 1fr)',
                gap: 16,
                marginBottom: 24,
              }}>
            {[
              { label: '历史课堂', value: history.length, color: '#0891b2', bg: '#ecfeff', icon: 'history' },
              { label: '参与学生', value: totalStudents, color: '#8b5cf6', bg: '#f5f3ff', icon: 'users' },
              { label: '交互总轮数', value: totalInteractions, color: '#db2777', bg: '#fdf2f8', icon: 'message' },
              { label: '总文字量', value: totalChars > 10000 ? `${(totalChars / 10000).toFixed(1)}万` : `${totalChars}`, color: '#f59e0b', bg: '#fffbeb', icon: 'file' },
            ].map(stat => (
              <div key={stat.label} style={{
                background: 'white', borderRadius: 14,
                border: '1px solid #e2e8f0', padding: '20px 22px',
                display: 'flex', alignItems: 'center', gap: 14,
                transition: 'box-shadow 0.2s, transform 0.15s',
              }}
                onMouseEnter={e => {
                  e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,0.06)';
                  e.currentTarget.style.transform = 'translateY(-1px)';
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.boxShadow = 'none';
                  e.currentTarget.style.transform = 'none';
                }}
              >
                <div style={{
                  width: 40, height: 40, borderRadius: 11,
                  background: stat.bg, color: stat.color,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                }}>
                  {stat.icon === 'history' && (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
                  )}
                  {stat.icon === 'users' && (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /></svg>
                  )}
                  {stat.icon === 'message' && (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
                  )}
                  {stat.icon === 'file' && (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></svg>
                  )}
                </div>
                <div>
                  <div style={{ fontSize: "1.375rem", fontWeight: 700, color: stat.color, lineHeight: 1.1 }}>{stat.value}</div>
                  <div style={{ fontSize: "0.75rem", color: '#64748b', marginTop: 2 }}>{stat.label}</div>
                </div>
              </div>
            ))}
          </div>

          {/* 历史课堂表格 */}
          <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e2e8f0', overflow: 'hidden' }}>
            <div style={{
              padding: '16px 20px', borderBottom: '1px solid #eef2f6',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <h2 style={{ fontSize: "0.938rem", fontWeight: 600, margin: 0, color: '#0f172a' }}>课堂记录</h2>
              <span style={{ fontSize: "0.75rem", color: '#94a3b8' }}>共 {history.length} 条记录</span>
            </div>
            <table>
              <thead>
                <tr>
                  <th style={{ textAlign: 'center' }}>课堂名称</th>
                  <th style={{ textAlign: 'center' }}>模式</th>
                  <th style={{ textAlign: 'center' }}>创建时间</th>
                  <th style={{ textAlign: 'center' }}>结束时间</th>
                  <th style={{ textAlign: 'center' }}>时长</th>
                  <th style={{ textAlign: 'center' }}>参与人数</th>
                  <th style={{ textAlign: 'center' }}>交互量</th>
                  <th style={{ textAlign: 'center' }}>文字量</th>
                  <th style={{ textAlign: 'center' }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {pagedHistory.map((cr) => {
                  const startTime = new Date(cr.createdAt);
                  const endTime = cr.endedAt ? new Date(cr.endedAt) : null;
                  const duration = endTime
                    ? Math.round((endTime.getTime() - startTime.getTime()) / 60000)
                    : null;

                  return (
                    <tr key={cr.id}>
                      <td>
                        <div style={{ fontWeight: 500, color: '#0f172a' }}>
                          {cr.title || '未命名课堂'}
                        </div>
                        <div style={{ fontSize: "0.688rem", color: '#94a3b8', marginTop: 2 }}>
                          {cr.classes.map((cc) => cc.class.name).join(', ')}
                        </div>
                      </td>
                      <td style={{ textAlign: 'center', fontSize: "0.75rem", color: '#475569', whiteSpace: 'nowrap' }}>
                        <span style={{
                          display: 'inline-block', padding: '2px 8px', borderRadius: 4,
                          fontSize: "0.688rem", fontWeight: 600,
                          background: cr.mode === 'advanced' ? '#f5f3ff' : cr.mode === 'group' ? '#fffbeb' : '#f0fdf4',
                          color: cr.mode === 'advanced' ? '#7c3aed' : cr.mode === 'group' ? '#d97706' : '#059669',
                        }}>
                          {cr.mode === 'advanced' ? '高级模式' : cr.mode === 'group' ? '分组模式' : '标准模式'}
                        </span>
                      </td>
                      <td style={{ textAlign: 'center', fontSize: "0.813rem", color: '#475569', whiteSpace: 'nowrap' }}>{startTime.toLocaleString()}</td>
                      <td style={{ textAlign: 'center', fontSize: "0.813rem", color: '#475569', whiteSpace: 'nowrap' }}>{endTime ? endTime.toLocaleString() : <span style={{ color: '#cbd5e1' }}>-</span>}</td>
                      <td style={{ textAlign: 'center' }}>
                        {duration !== null ? (
                          <span style={{
                            fontSize: "0.813rem", color: '#475569',
                            display: 'flex', alignItems: 'center', gap: 4,
                          }}>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
                            {duration}分钟
                          </span>
                        ) : <span style={{ color: '#cbd5e1' }}>-</span>}
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <span style={{ fontSize: "0.813rem", fontWeight: 500, color: '#475569' }}>
                          {cr.participantCount || 0}/{cr._count?.students || 0}
                        </span>
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <span style={{
                          fontSize: "0.813rem", fontWeight: 600,
                          color: (cr._count?.interactions || 0) > 50 ? '#2563eb' : (cr._count?.interactions || 0) > 10 ? '#f59e0b' : '#94a3b8',
                        }}>
                          {cr._count?.interactions || 0} 轮
                        </span>
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <span style={{ fontSize: "0.813rem", fontWeight: 500, color: '#475569' }}>
                          {cr.totalChars > 0 ? (
                            cr.totalChars >= 10000
                              ? `${(cr.totalChars / 10000).toFixed(1)}万字`
                              : `${cr.totalChars} 字`
                          ) : <span style={{ color: '#cbd5e1' }}>-</span>}
                        </span>
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                          <button className="btn btn-secondary"
                            disabled={previewingClassroomId !== null || exporting}
                            style={{ fontSize: "0.688rem", padding: '5px 10px', display: 'flex', alignItems: 'center', gap: 4 }}
                            onClick={() => handlePreview(cr.id)}>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></svg>
                            {previewingClassroomId === cr.id ? '准备中...' : '导出对话'}
                          </button>
                          <button onClick={() => setRestoreTarget(cr.id)} disabled={restoring}
                            title="恢复课堂"
                            style={{
                              fontSize: "0.688rem", padding: '5px 10px', display: 'flex', alignItems: 'center', gap: 4,
                              borderRadius: 6, cursor: 'pointer', fontWeight: 500,
                              border: '1px solid #bbf7d0', background: '#f0fdf4', color: '#16a34a',
                            }}>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" /></svg>
                            恢复
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <Pagination current={page} total={history.length} pageSize={pageSize} pageSizeOptions={[10, 15, 20, 50, 100]} onChange={setPage} onPageSizeChange={setPageSize} />
          </div>
            </>
          )}

          {/* 数据备份 */}
          <div className="card" style={{ marginTop: 24, padding: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
              <div style={{
                width: 40, height: 40, borderRadius: 10,
                background: '#f0fdf4', color: '#16a34a',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" /></svg>
              </div>
              <div>
                <h2 style={{ fontSize: "1rem", fontWeight: 600, margin: 0, color: '#0f172a' }}>数据备份与恢复</h2>
                <p style={{ color: '#64748b', fontSize: "0.75rem", margin: '2px 0 0' }}>
                  备份包含全部课堂数据和上传附件，跨设备迁移无忧
                </p>
              </div>
            </div>
            <BackupManager />
          </div>
        </>
      )}

      {/* 导出预览弹窗 */}
      {preview && (
        <ExportPreviewDialog
          preview={preview}
          exporting={exporting}
          exportProgress={exportProgress}
          exportStage={exportStage}
          selectedStudentIds={selectedStudentIds}
          onToggleStudent={toggleStudent}
          onToggleAll={toggleAllStudents}
          onConfirm={handleConfirmExport}
          onCancel={() => setPreview(null)}
        />
      )}

      {/* 恢复课堂确认弹窗 */}
      {restoreTarget && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 1000,
          background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(2px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }} onClick={() => !restoring && setRestoreTarget(null)}>
          <div style={{
            background: 'white', borderRadius: 14, padding: '28px 32px',
            maxWidth: 440, width: '90%', boxShadow: '0 20px 60px rgba(0,0,0,0.15)',
          }} onClick={e => e.stopPropagation()}>
            <div style={{ width: 52, height: 52, borderRadius: '50%', background: '#f0fdf4', color: '#16a34a', margin: '0 auto 16px',
              display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" /></svg>
            </div>
            <h3 style={{ margin: '0 0 4px', fontSize: '1rem', fontWeight: 700, color: '#0f172a', textAlign: 'center' }}>确认恢复课堂</h3>
            <div style={{
              margin: '16px 0 20px', padding: '12px 16px', borderRadius: 8,
              background: '#fefce8', border: '1px solid #fde68a',
              fontSize: '0.813rem', color: '#92400e', lineHeight: 1.6,
            }}>
              <strong>⚠ 恢复后该课堂将变为活跃状态</strong>，学生可通过新的互动码重新加入。<br />
              原有的消息记录将被保留，新的互动码将在恢复后自动生成。
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={() => setRestoreTarget(null)} disabled={restoring}
                style={{ fontSize: '0.813rem', padding: '7px 16px' }}>取消</button>
              <button onClick={() => handleRestoreClassroom(restoreTarget)} disabled={restoring}
                style={{ fontSize: '0.813rem', padding: '7px 16px', borderRadius: 8, border: 'none', cursor: 'pointer', fontWeight: 500,
                  background: restoring ? '#94a3b8' : '#16a34a', color: 'white' }}>
                {restoring ? '恢复中...' : '确认恢复'}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && <Toast msg={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}

/** 导出预览弹窗组件 */
function ExportPreviewDialog({
  preview,
  exporting,
  exportProgress,
  exportStage,
  selectedStudentIds,
  onToggleStudent,
  onToggleAll,
  onConfirm,
  onCancel,
}: {
  preview: { classroom: ClassroomHistoryItem | undefined; data: ConversationExportReport };
  exporting: boolean;
  exportProgress: number | null;
  exportStage: string;
  selectedStudentIds: string[];
  onToggleStudent: (id: string) => void;
  onToggleAll: (allIds: string[]) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { classroom, data } = preview;

  const startTime = classroom ? new Date(classroom.createdAt).toLocaleString() : '-';
  const endTime = classroom?.endedAt ? new Date(classroom.endedAt).toLocaleString() : '-';

  // 学生列表
  const students = data.students || [];
  const studentSelectorId = (student: ExportConversationStudent) => student.studentId || student.name;
  const allSelected = students.length > 0 && selectedStudentIds.length === students.length;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(2px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={exporting ? undefined : onCancel}>
      <div style={{
        background: 'white', borderRadius: 14, padding: 0,
        maxWidth: 640, width: '90%', maxHeight: '85vh',
        display: 'flex', flexDirection: 'column',
        boxShadow: '0 20px 60px rgba(0,0,0,0.15)',
      }} onClick={e => e.stopPropagation()}>
        {/* 弹窗头部 */}
        <div style={{
          padding: '20px 24px 14px',
          borderBottom: '1px solid #eef2f6',
        }}>
          <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 600, color: '#0f172a' }}>
            导出对话记录
          </h3>
          <p style={{ margin: '4px 0 0', fontSize: "0.75rem", color: '#64748b' }}>
            选择学生和格式后点击确认导出
          </p>
        </div>

        {/* 弹窗内容 */}
        <div style={{
          padding: '16px 24px',
          overflowY: 'auto', flex: 1,
        }}>
          {/* 课堂基本信息 */}
          <div style={{
            background: '#f8fafc', borderRadius: 8, padding: '12px 16px', marginBottom: 14,
            fontSize: "0.75rem",
          }}>
            <div style={{ fontWeight: 600, color: '#0f172a', marginBottom: 6 }}>
              {classroom?.title || '未命名课堂'}
            </div>
            <div style={{ color: '#64748b', lineHeight: 1.7 }}>
              <span>班级：{data.classes?.join('、') || '-'}</span>
              <br />
              <span style={{ marginRight: 18 }}>创建：{startTime}</span>
              <span>结束：{endTime}</span>
              <br />
              <span>模式：{data.mode === 'advanced' ? '高级模式' : '标准模式'}</span>
            </div>
          </div>

          {/* 学生选择 */}
          {students.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                marginBottom: 8,
              }}>
                <span style={{ fontSize: "0.75rem", fontWeight: 600, color: '#64748b' }}>
                  选择学生（{selectedStudentIds.length}/{students.length}）
                </span>
                <label style={{
                  fontSize: "0.688rem", color: '#2563eb', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 4,
                }}>
                  <input type="checkbox" checked={allSelected}
                    onChange={() => onToggleAll(students.map(studentSelectorId))}
                    style={{ accentColor: '#2563eb' }} />
                  全选
                </label>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 180, overflowY: 'auto' }}>
                {students.map((s, i: number) => {
                  const sid = studentSelectorId(s);
                  const msgCount = s.messages?.length || 0;
                  const rounds = s.totalRounds || Math.ceil(msgCount / 2);
                  return (
                    <label key={i} style={{
                      display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px',
                      borderRadius: 6, cursor: 'pointer', fontSize: "0.75rem",
                      background: selectedStudentIds.includes(sid) ? '#eff6ff' : '#f8fafc',
                      border: selectedStudentIds.includes(sid) ? '1px solid #bfdbfe' : '1px solid transparent',
                      transition: 'all 0.15s',
                    }}>
                      <input type="checkbox" checked={selectedStudentIds.includes(sid)}
                        onChange={() => onToggleStudent(sid)}
                        style={{ accentColor: '#2563eb' }} />
                      <span style={{ fontWeight: 500, color: '#0f172a', flex: 1 }}>{s.name}</span>
                      <span style={{ color: '#94a3b8', fontSize: "0.688rem" }}>
                        {rounds} 轮 · {msgCount} 条
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}



        </div>

        {/* 弹窗底部 */}
        <div style={{
          padding: '14px 24px',
          borderTop: '1px solid #eef2f6',
        }}>
          {/* 进度条 */}
          {exporting && exportProgress !== null && (
            <div style={{ marginBottom: 12 }}>
              <div style={{
                display: 'flex', justifyContent: 'space-between',
                fontSize: "0.688rem", color: '#64748b', marginBottom: 4,
              }}>
                <span>{exportStage || '导出中...'}</span>
                <span>{exportProgress}%</span>
              </div>
              <div style={{
                width: '100%', height: 6, borderRadius: 3,
                background: '#e2e8f0', overflow: 'hidden',
              }}>
                <div style={{
                  width: `${exportProgress}%`, height: '100%',
                  background: 'linear-gradient(90deg, #2563eb, #7c3aed)',
                  borderRadius: 3,
                  transition: 'width 0.3s ease',
                }} />
              </div>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button className="btn btn-secondary"
              onClick={onCancel} disabled={exporting}
              style={{ fontSize: "0.75rem", padding: '7px 16px' }}>
              取消
            </button>
            <button onClick={onConfirm} disabled={exporting || selectedStudentIds.length === 0}
              style={{
                fontSize: "0.75rem", padding: '7px 18px', borderRadius: 8, border: 'none',
                cursor: (exporting || selectedStudentIds.length === 0) ? 'not-allowed' : 'pointer', fontWeight: 500,
                background: (exporting || selectedStudentIds.length === 0) ? '#94a3b8' : '#2563eb',
                color: 'white',
                display: 'flex', alignItems: 'center', gap: 6,
              }}>
              {exporting ? (
                <>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ animation: 'spin 1s linear infinite' }}>
                    <line x1="12" y1="2" x2="12" y2="6" /><line x1="12" y1="18" x2="12" y2="22" />
                  </svg>
                  {exportProgress !== null && exportProgress >= 100 ? '已就绪' : '导出中...'}
                </>
              ) : (
                <>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
                  确认导出
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function BackupManager() {
  const [backups, setBackups] = useState<BackupFile[]>([]);
  const [creating, setCreating] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [restoreTarget, setRestoreTarget] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [showResetDialog, setShowResetDialog] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetConfirmText, setResetConfirmText] = useState('');
  const [importing, setImporting] = useState(false);
  const [backupAction, setBackupAction] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const backupActionRef = useRef(false);

  useEffect(() => { api.getBackups().then(setBackups).catch(() => {}); }, []);

  const handleBackup = async () => {
    if (backupActionRef.current) return;
    backupActionRef.current = true;
    setBackupAction('create');
    setCreating(true);
    try {
      const result = await api.createBackup();
      setToast({ msg: '备份成功！', type: 'success' });
      setBackups(await api.getBackups());
    } catch (error: unknown) {
      setToast({ msg: '备份失败: ' + getErrorMessage(error, '请求异常'), type: 'error' });
    }
    backupActionRef.current = false;
    setBackupAction(null);
    setCreating(false);
  };

  const handleImportBackup = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || backupActionRef.current) return;
    backupActionRef.current = true;
    setBackupAction('import');
    setImporting(true);
    try {
      await api.uploadBackup(file);
      setToast({ msg: '导入备份成功！', type: 'success' });
      setBackups(await api.getBackups());
    } catch (error: unknown) {
      setToast({ msg: '导入失败: ' + getErrorMessage(error, '请求异常'), type: 'error' });
    }
    backupActionRef.current = false;
    setBackupAction(null);
    setImporting(false);
    if (e.target) e.target.value = '';
  };

  const handleRestore = async (name: string) => {
    if (backupActionRef.current) return;
    backupActionRef.current = true;
    setBackupAction('restore');
    setRestoring(true);
    try {
      await api.restoreBackup(name);
      setRestoreTarget(null);
      setToast({ msg: '数据恢复成功！页面将重新加载。', type: 'success' });
      window.location.reload();
    } catch (error: unknown) {
      setToast({ msg: '恢复失败: ' + getErrorMessage(error, '请求异常'), type: 'error' });
    }
    backupActionRef.current = false;
    setBackupAction(null);
    setRestoring(false);
  };

  const handleDelete = async (name: string) => {
    if (backupActionRef.current) return;
    backupActionRef.current = true;
    setBackupAction('delete');
    setDeleting(true);
    try {
      await api.deleteBackup(name);
      setDeleteTarget(null);
      setBackups(await api.getBackups());
    } catch (error: unknown) {
      setToast({ msg: '删除失败: ' + getErrorMessage(error, '请求异常'), type: 'error' });
    }
    backupActionRef.current = false;
    setBackupAction(null);
    setDeleting(false);
  };

  const handleReset = async () => {
    if (resetConfirmText !== '确认初始化' || backupActionRef.current) return;
    backupActionRef.current = true;
    setBackupAction('reset');
    setResetting(true);
    try {
      await api.resetAllData();
      setShowResetDialog(false);
      setResetConfirmText('');
      setToast({ msg: '系统已初始化！页面将重新加载。', type: 'success' });
      window.location.reload();
    } catch (error: unknown) {
      setToast({ msg: '初始化失败: ' + getErrorMessage(error, '请求异常'), type: 'error' });
    }
    backupActionRef.current = false;
    setBackupAction(null);
    setResetting(false);
  };

  const overlay: React.CSSProperties = {
    position: 'fixed', inset: 0, zIndex: 1000,
    background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(2px)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  };
  const dialog: React.CSSProperties = {
    background: 'white', borderRadius: 14, padding: '28px 32px',
    maxWidth: 440, width: '90%', boxShadow: '0 20px 60px rgba(0,0,0,0.15)',
  };

  return (
    <div>
      {/* 操作栏：备份 + 初始化 */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
        <button className="btn btn-primary" onClick={() => void handleBackup()} disabled={backupAction !== null}
          style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {creating ? (
            <>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ animation: 'spin 1s linear infinite' }}>
                <line x1="12" y1="2" x2="12" y2="6" /><line x1="12" y1="18" x2="12" y2="22" />
              </svg>
              备份中...
            </>
          ) : (
            <>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" /></svg>
              立即备份
            </>
          )}
        </button>
        <button onClick={() => fileInputRef.current?.click()} disabled={backupAction !== null}
          style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px',
            borderRadius: 8, fontSize: "0.813rem", fontWeight: 500, cursor: 'pointer',
            border: '1px solid #e2e8f0', background: 'white', color: '#475569',
            opacity: importing ? 0.6 : 1,
          }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
          {importing ? '导入中...' : '上传备份'}
        </button>
        <input ref={fileInputRef} type="file" accept=".classbak,.classdb,.zip,.db" style={{ display: 'none' }}
          onChange={handleImportBackup} />
        <div style={{ flex: 1 }} />
        <button onClick={() => setShowResetDialog(true)} disabled={backupAction !== null}
          style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px',
            borderRadius: 8, fontSize: "0.813rem", fontWeight: 500, cursor: 'pointer',
            border: '1px solid #fecaca', background: '#fef2f2', color: '#dc2626',
          }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 6h18" /><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6" /><path d="M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2" /></svg>
          系统初始化
        </button>
      </div>

      {/* 跨设备迁移提示 */}
      <div style={{
        padding: '16px 20px', marginBottom: 16,
        background: '#fffbeb', borderRadius: 12,
        border: '1px solid #fde68a',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
            <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <strong style={{ fontSize: "0.875rem", color: '#92400e' }}>跨设备迁移</strong>
        </div>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: '#fefce8', borderRadius: 8, border: '1px solid #fde68a' }}>
            <div style={{ width: 26, height: 26, borderRadius: '50%', background: '#2563eb', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: "0.813rem", fontWeight: 700, flexShrink: 0 }}>1</div>
            <span style={{ fontSize: "0.813rem", color: '#92400e', lineHeight: 1.5 }}>点击<strong>「立即备份」</strong>，在历史列表中点击<strong>「下载」</strong>保存备份文件</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', color: '#d97706' }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="9 18 15 12 9 6"/></svg>
          </div>
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: '#fefce8', borderRadius: 8, border: '1px solid #fde68a' }}>
            <div style={{ width: 26, height: 26, borderRadius: '50%', background: '#2563eb', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: "0.813rem", fontWeight: 700, flexShrink: 0 }}>2</div>
            <span style={{ fontSize: "0.813rem", color: '#92400e', lineHeight: 1.5 }}>在新电脑上点击<strong>「上传备份」</strong>，文件即出现在列表中，再点<strong>「恢复」</strong></span>
          </div>
        </div>
      </div>
      {backups.length > 0 && (
        <div>
          <div style={{ fontSize: "0.75rem", fontWeight: 600, color: '#64748b', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            历史备份 ({backups.length})
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {backups.map((b, i) => (
              <div key={i} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '10px 14px', borderRadius: 8,
                background: '#f8fafc', fontSize: "0.813rem",
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
                  <span style={{ fontWeight: 500, color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.name}</span>
                  {b.source === 'imported' ? (
                    <span style={{
                      fontSize: "0.625rem", fontWeight: 600, padding: '1px 6px', borderRadius: 4,
                      background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a', flexShrink: 0,
                    }}>导入</span>
                  ) : (
                    <span style={{
                      fontSize: "0.625rem", fontWeight: 600, padding: '1px 6px', borderRadius: 4,
                      background: '#e0f2fe', color: '#0369a1', border: '1px solid #bae6fd', flexShrink: 0,
                    }}>本机</span>
                  )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                  <span style={{ color: '#94a3b8', fontSize: "0.75rem", whiteSpace: 'nowrap' }}>
                    {new Date(b.createdAt).toLocaleString()} · {b.size > 1048576 ? (b.size / 1048576).toFixed(1) + ' MB' : (b.size / 1024).toFixed(1) + ' KB'}
                  </span>
                  <a href={api.getBackupDownloadUrl(b.name)} download
                    style={{ fontSize: "0.688rem", padding: '3px 8px', borderRadius: 4, cursor: 'pointer', textDecoration: 'none',
                      border: '1px solid #e2e8f0', background: '#f8fafc', color: '#475569' }}>
                    下载
                  </a>
                  <button onClick={() => setRestoreTarget(b.name)} disabled={backupAction !== null}
                    style={{ fontSize: "0.688rem", padding: '3px 8px', borderRadius: 4, cursor: 'pointer', whiteSpace: 'nowrap',
                      border: '1px solid #dbeafe', background: '#eff6ff', color: '#2563eb' }}>
                    恢复
                  </button>
                  <button onClick={() => setDeleteTarget(b.name)} disabled={backupAction !== null}
                    style={{ fontSize: "0.688rem", padding: '3px 8px', borderRadius: 4, cursor: 'pointer', whiteSpace: 'nowrap',
                      border: '1px solid #fecaca', background: '#fef2f2', color: '#dc2626' }}>
                    删除
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 删除确认弹窗 */}
      {deleteTarget && (
        <div style={overlay} onClick={() => !deleting && setDeleteTarget(null)}>
          <div style={dialog} onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 8px', fontSize: "1rem", fontWeight: 600, color: '#0f172a' }}>确认删除</h3>
            <p style={{ fontSize: "0.813rem", color: '#475569', lineHeight: 1.6, margin: '0 0 20px' }}>
              确定要删除备份文件 <strong style={{ color: '#0f172a' }}>{deleteTarget}</strong> 吗？<br />
              此操作不可恢复。
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={() => setDeleteTarget(null)} disabled={deleting}
                style={{ fontSize: "0.813rem", padding: '7px 16px' }}>取消</button>
              <button onClick={() => handleDelete(deleteTarget)} disabled={deleting}
                style={{ fontSize: "0.813rem", padding: '7px 16px', borderRadius: 8, border: 'none', cursor: 'pointer', fontWeight: 500,
                  background: '#dc2626', color: 'white', opacity: deleting ? 0.6 : 1 }}>
                {deleting ? '删除中...' : '确认删除'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 恢复确认弹窗 */}
      {restoreTarget && (
        <div style={overlay} onClick={() => !restoring && setRestoreTarget(null)}>
          <div style={dialog} onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 8px', fontSize: "1rem", fontWeight: 600, color: '#0f172a' }}>确认恢复</h3>
            <p style={{ fontSize: "0.813rem", color: '#475569', lineHeight: 1.6, margin: '0 0 12px' }}>
              将从备份文件 <strong style={{ color: '#0f172a' }}>{restoreTarget}</strong> 恢复数据。
            </p>
            <div style={{
              padding: 12, borderRadius: 8, background: '#fef2f2', border: '1px solid #fecaca',
              fontSize: "0.813rem", color: '#dc2626', lineHeight: 1.6, marginBottom: 20,
            }}>
              <strong>⚠ 警告：</strong>恢复操作将<strong>覆盖</strong>当前数据库中的所有数据。建议在恢复前先备份当前数据。
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={() => setRestoreTarget(null)} disabled={restoring}
                style={{ fontSize: "0.813rem", padding: '7px 16px' }}>取消</button>
              <button onClick={() => handleRestore(restoreTarget)} disabled={restoring}
                style={{ fontSize: "0.813rem", padding: '7px 16px', borderRadius: 8, border: 'none', cursor: 'pointer', fontWeight: 500,
                  background: '#2563eb', color: 'white', opacity: restoring ? 0.6 : 1 }}>
                {restoring ? '恢复中...' : '确认恢复'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 初始化确认 */}
      {showResetDialog && (
        <div style={overlay} onClick={() => !resetting && setShowResetDialog(false)}>
          <div style={dialog} onClick={e => e.stopPropagation()}>
            <div style={{ width: 52, height: 52, borderRadius: '50%', background: '#fef2f2', color: '#dc2626', margin: '0 auto 16px',
              display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M3 6h18" /><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6" /><path d="M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2" /></svg>
            </div>
            <h3 style={{ margin: '0 0 4px', fontSize: '1rem', fontWeight: 700, color: '#0f172a', textAlign: 'center' }}>系统初始化</h3>
            <p style={{ fontSize: '0.813rem', color: '#64748b', textAlign: 'center', margin: '0 0 16px' }}>
              将清空所有数据，恢复到初始状态。<br />管理员密码将保留。
            </p>

            <div style={{ background: '#f8fafc', borderRadius: 10, padding: 14, marginBottom: 16, fontSize: '0.75rem', lineHeight: 1.8, color: '#475569' }}>
              <div style={{ fontWeight: 600, color: '#0f172a', marginBottom: 6 }}>将被清除的数据：</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
                <span>• 所有班级和学生</span>
                <span>• 所有智能体配置</span>
                <span>• 所有课堂和对话</span>
                <span>• 所有屏蔽词配置</span>
                <span>• 用户上传的头像</span>
                <span>• 聊天附件文件</span>
                <span>• 智能体 Logo</span>
                <span>• 系统设置项</span>
              </div>
            </div>

            <div style={{
              padding: '10px 14px', borderRadius: 8, background: '#fef2f2', border: '1px solid #fecaca',
              fontSize: '0.75rem', color: '#dc2626', lineHeight: 1.6, marginBottom: 16,
            }}>
              <strong>⚠ 此操作不可撤销。</strong>建议先备份数据。
            </div>

            <div style={{ marginBottom: 20 }}>
              <label style={{ fontSize: '0.75rem', color: '#475569', display: 'block', marginBottom: 6 }}>
                请输入 <strong style={{ color: '#dc2626' }}>确认初始化</strong> 以继续：
              </label>
              <input type="text" value={resetConfirmText}
                onChange={e => setResetConfirmText(e.target.value)}
                placeholder="输入「确认初始化」"
                style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #e2e8f0', fontSize: '0.813rem', outline: 'none', boxSizing: 'border-box' }} />
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={() => { setShowResetDialog(false); setResetConfirmText(''); }}
                disabled={resetting} style={{ fontSize: '0.813rem', padding: '7px 16px' }}>取消</button>
              <button onClick={handleReset}
                disabled={resetting || resetConfirmText !== '确认初始化'}
                style={{ fontSize: '0.813rem', padding: '7px 16px', borderRadius: 8, border: 'none', cursor: 'pointer', fontWeight: 500,
                  background: resetConfirmText === '确认初始化' ? '#dc2626' : '#e2e8f0',
                  color: resetConfirmText === '确认初始化' ? 'white' : '#94a3b8',
                  opacity: resetting ? 0.6 : 1 }}>
                {resetting ? '初始化中...' : '确认初始化'}
              </button>
            </div>
          </div>
        </div>
      )}


      {toast && <Toast msg={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
