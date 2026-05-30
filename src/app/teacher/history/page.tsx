'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { exportConversationsDoc, exportStatsDoc } from '@/lib/export-doc';

export default function HistoryPage() {
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState<string | null>(null);

  useEffect(() => {
    api.getHistory().then(setHistory).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const handleExport = async (classroomId: string, type: 'conversations' | 'stats') => {
    const key = `${classroomId}-${type}`;
    setExporting(key);
    try {
      if (type === 'conversations') {
        const data = await api.exportConversations(classroomId);
        const blob = await exportConversationsDoc(data);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `对话记录-${data.code || classroomId}.docx`;
        a.click();
        URL.revokeObjectURL(url);
      } else {
        const data = await api.exportStats(classroomId);
        const blob = await exportStatsDoc(data);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `学情报表-${classroomId}.docx`;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch (e: any) {
      alert('导出失败: ' + e.message);
    }
    setExporting(null);
  };

  const totalStudents = history.reduce((sum: number, cr: any) => sum + (cr._count?.students || 0), 0);
  const totalInteractions = history.reduce((sum: number, cr: any) => sum + (cr._count?.interactions || 0), 0);
  const totalChars = history.reduce((sum: number, cr: any) => sum + (Number(cr.totalChars) || 0), 0);
  const totalDuration = history.reduce((sum: number, cr: any) => {
    if (!cr.endedAt) return sum;
    return sum + (new Date(cr.endedAt).getTime() - new Date(cr.createdAt).getTime());
  }, 0);
  const avgDuration = history.length > 0 ? Math.round(totalDuration / history.length / 60000) : 0;

  return (
    <div>
      {/* 页面标题 */}
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, color: '#0f172a' }}>历史数据</h1>
        <p style={{ color: '#64748b', fontSize: 13, marginTop: 4 }}>
          课堂历史存档与数据导出
        </p>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: '#94a3b8', fontSize: 14 }}>加载中...</div>
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
              <h2 style={{ fontSize: 16, fontWeight: 600, margin: '0 0 6px', color: '#0f172a' }}>暂无历史记录</h2>
              <p style={{ color: '#94a3b8', fontSize: 13, margin: 0 }}>
                结束的课堂将在这里显示，方便回顾和导出。备份数据可在下方恢复。
              </p>
            </div>
          ) : (
            <>
              {/* 统计摘要 — 使用 grid 布局，与其他页面风格一致 */}
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
                  <div style={{ fontSize: 22, fontWeight: 700, color: stat.color, lineHeight: 1.1 }}>{stat.value}</div>
                  <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{stat.label}</div>
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
              <h2 style={{ fontSize: 15, fontWeight: 600, margin: 0, color: '#0f172a' }}>课堂记录</h2>
              <span style={{ fontSize: 12, color: '#94a3b8' }}>共 {history.length} 条记录</span>
            </div>
            <table>
              <thead>
                <tr>
                  <th>课堂名称</th>
                  <th>创建时间</th>
                  <th>结束时间</th>
                  <th>时长</th>
                  <th>总人数</th>
                  <th>参与</th>
                  <th>交互量</th>
                  <th>文字量</th>
                  <th style={{ textAlign: 'center' }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {history.map((cr: any) => {
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
                        <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
                          {cr.classes?.map((cc: any) => cc.class.name).join(', ')}
                        </div>
                      </td>
                      <td style={{ fontSize: 13, color: '#475569', whiteSpace: 'nowrap' }}>{startTime.toLocaleString()}</td>
                      <td style={{ fontSize: 13, color: '#475569', whiteSpace: 'nowrap' }}>{endTime ? endTime.toLocaleString() : <span style={{ color: '#cbd5e1' }}>-</span>}</td>
                      <td>
                        {duration !== null ? (
                          <span style={{
                            fontSize: 13, color: '#475569',
                            display: 'flex', alignItems: 'center', gap: 4,
                          }}>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
                            {duration}分钟
                          </span>
                        ) : <span style={{ color: '#cbd5e1' }}>-</span>}
                      </td>
                      <td>
                        <span style={{ fontSize: 13, fontWeight: 500, color: '#475569' }}>
                          {cr._count?.students || 0}
                        </span>
                      </td>
                      <td>
                        <span style={{ fontSize: 13, fontWeight: 500, color: cr.participantCount > 0 ? '#2563eb' : '#94a3b8' }}>
                          {cr.participantCount || 0}
                        </span>
                      </td>
                      <td>
                        <span style={{
                          fontSize: 13, fontWeight: 600,
                          color: (cr._count?.interactions || 0) > 50 ? '#2563eb' : (cr._count?.interactions || 0) > 10 ? '#f59e0b' : '#94a3b8',
                        }}>
                          {cr._count?.interactions || 0} 轮
                        </span>
                      </td>
                      <td>
                        <span style={{ fontSize: 13, fontWeight: 500, color: '#475569' }}>
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
                            style={{ fontSize: 11, padding: '5px 10px', display: 'flex', alignItems: 'center', gap: 4 }}
                            disabled={exporting === `${cr.id}-conversations`}
                            onClick={() => handleExport(cr.id, 'conversations')}>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></svg>
                            {exporting === `${cr.id}-conversations` ? '导出中...' : '对话'}
                          </button>
                          <button className="btn btn-secondary"
                            style={{ fontSize: 11, padding: '5px 10px', display: 'flex', alignItems: 'center', gap: 4 }}
                            disabled={exporting === `${cr.id}-stats`}
                            onClick={() => handleExport(cr.id, 'stats')}>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" /></svg>
                            {exporting === `${cr.id}-stats` ? '导出中...' : '报表'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
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
                <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0, color: '#0f172a' }}>数据备份</h2>
                <p style={{ color: '#64748b', fontSize: 12, margin: '2px 0 0' }}>
                  备份本地数据库文件，用于跨设备迁移或数据保全
                </p>
              </div>
            </div>
            <BackupManager />
          </div>
        </>
      )}
    </div>
  );
}

function BackupManager() {
  const [backups, setBackups] = useState<any[]>([]);
  const [creating, setCreating] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [restoreTarget, setRestoreTarget] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [showResetDialog, setShowResetDialog] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetConfirmText, setResetConfirmText] = useState('');

  useEffect(() => { api.getBackups().then(setBackups).catch(() => {}); }, []);

  const handleBackup = async () => {
    setCreating(true);
    try {
      const result = await api.createBackup();
      alert('备份成功！');
      api.getBackups().then(setBackups);
    } catch (e: any) {
      alert('备份失败: ' + e.message);
    }
    setCreating(false);
  };

  const handleDelete = async (name: string) => {
    setDeleting(true);
    try {
      await api.deleteBackup(name);
      setDeleteTarget(null);
      api.getBackups().then(setBackups);
    } catch (e: any) {
      alert('删除失败: ' + e.message);
    }
    setDeleting(false);
  };

  const handleRestore = async (name: string) => {
    setRestoring(true);
    try {
      await api.restoreBackup(name);
      setRestoreTarget(null);
      alert('数据恢复成功！页面将重新加载。');
      window.location.reload();
    } catch (e: any) {
      alert('恢复失败: ' + e.message);
    }
    setRestoring(false);
  };

  const handleReset = async () => {
    if (resetConfirmText !== '确认清零') return;
    setResetting(true);
    try {
      await api.resetAllData();
      setShowResetDialog(false);
      setResetConfirmText('');
      alert('所有数据已清零！页面将重新加载。');
      window.location.reload();
    } catch (e: any) {
      alert('清零失败: ' + e.message);
    }
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
      {/* 操作栏：备份 + 清零 */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
        <button className="btn btn-primary" onClick={handleBackup} disabled={creating}
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
              立即备份数据库
            </>
          )}
        </button>
        <button onClick={() => setShowResetDialog(true)}
          style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px',
            borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: 'pointer',
            border: '1px solid #fecaca', background: '#fef2f2', color: '#dc2626',
          }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 6h18" /><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6" /><path d="M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2" /></svg>
          初始化清零
        </button>
      </div>

      {backups.length > 0 && (
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#64748b', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            历史备份 ({backups.length})
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {backups.map((b, i) => (
              <div key={i} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '10px 14px', borderRadius: 8,
                background: '#f8fafc', fontSize: 13,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
                  <span style={{ fontWeight: 500, color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.name}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                  <span style={{ color: '#94a3b8', fontSize: 12, whiteSpace: 'nowrap' }}>
                    {new Date(b.createdAt).toLocaleString()} · {(b.size / 1024).toFixed(1)} KB
                  </span>
                  <button onClick={() => setRestoreTarget(b.name)}
                    style={{ fontSize: 11, padding: '3px 8px', borderRadius: 4, cursor: 'pointer', whiteSpace: 'nowrap',
                      border: '1px solid #dbeafe', background: '#eff6ff', color: '#2563eb' }}>
                    恢复
                  </button>
                  <button onClick={() => setDeleteTarget(b.name)}
                    style={{ fontSize: 11, padding: '3px 8px', borderRadius: 4, cursor: 'pointer', whiteSpace: 'nowrap',
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
            <h3 style={{ margin: '0 0 8px', fontSize: 16, fontWeight: 600, color: '#0f172a' }}>确认删除</h3>
            <p style={{ fontSize: 13, color: '#475569', lineHeight: 1.6, margin: '0 0 20px' }}>
              确定要删除备份文件 <strong style={{ color: '#0f172a' }}>{deleteTarget}</strong> 吗？<br />
              此操作不可恢复。
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={() => setDeleteTarget(null)} disabled={deleting}
                style={{ fontSize: 13, padding: '7px 16px' }}>取消</button>
              <button onClick={() => handleDelete(deleteTarget)} disabled={deleting}
                style={{ fontSize: 13, padding: '7px 16px', borderRadius: 8, border: 'none', cursor: 'pointer', fontWeight: 500,
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
            <h3 style={{ margin: '0 0 8px', fontSize: 16, fontWeight: 600, color: '#0f172a' }}>确认恢复</h3>
            <p style={{ fontSize: 13, color: '#475569', lineHeight: 1.6, margin: '0 0 12px' }}>
              将从备份文件 <strong style={{ color: '#0f172a' }}>{restoreTarget}</strong> 恢复数据。
            </p>
            <div style={{
              padding: 12, borderRadius: 8, background: '#fef2f2', border: '1px solid #fecaca',
              fontSize: 13, color: '#dc2626', lineHeight: 1.6, marginBottom: 20,
            }}>
              <strong>⚠ 警告：</strong>恢复操作将<strong>覆盖</strong>当前数据库中的所有数据。建议在恢复前先备份当前数据。
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={() => setRestoreTarget(null)} disabled={restoring}
                style={{ fontSize: 13, padding: '7px 16px' }}>取消</button>
              <button onClick={() => handleRestore(restoreTarget)} disabled={restoring}
                style={{ fontSize: 13, padding: '7px 16px', borderRadius: 8, border: 'none', cursor: 'pointer', fontWeight: 500,
                  background: '#2563eb', color: 'white', opacity: restoring ? 0.6 : 1 }}>
                {restoring ? '恢复中...' : '确认恢复'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 清零确认弹窗 */}
      {showResetDialog && (
        <div style={overlay} onClick={() => !resetting && setShowResetDialog(false)}>
          <div style={dialog} onClick={e => e.stopPropagation()}>
            <div style={{ width: 48, height: 48, borderRadius: 12, background: '#fef2f2', color: '#dc2626', margin: '0 auto 16px',
              display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M3 6h18" /><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6" /><path d="M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2" /></svg>
            </div>
            <h3 style={{ margin: '0 0 8px', fontSize: 16, fontWeight: 600, color: '#0f172a', textAlign: 'center' }}>初始化清零</h3>
            <p style={{ fontSize: 13, color: '#475569', lineHeight: 1.6, margin: '0 0 12px', textAlign: 'center' }}>
              此操作将<strong>永久删除</strong>数据库中的所有数据，包括：
            </p>
            <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.8, marginBottom: 16, padding: '0 8px' }}>
              • 所有班级和学生信息<br />
              • 所有智能体配置<br />
              • 所有课堂记录和对话数据<br />
              • 所有系统设置
            </div>
            <div style={{
              padding: 12, borderRadius: 8, background: '#fef2f2', border: '1px solid #fecaca',
              fontSize: 13, color: '#dc2626', lineHeight: 1.6, marginBottom: 16,
            }}>
              <strong>⚠ 此操作不可撤销！</strong>建议先备份数据库。
            </div>
            <div style={{ marginBottom: 20 }}>
              <label style={{ fontSize: 12, color: '#475569', display: 'block', marginBottom: 6 }}>
                请输入 <strong style={{ color: '#dc2626' }}>确认清零</strong> 以继续：
              </label>
              <input type="text" value={resetConfirmText}
                onChange={e => setResetConfirmText(e.target.value)}
                placeholder="输入「确认清零」"
                style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={() => { setShowResetDialog(false); setResetConfirmText(''); }}
                disabled={resetting} style={{ fontSize: 13, padding: '7px 16px' }}>取消</button>
              <button onClick={handleReset}
                disabled={resetting || resetConfirmText !== '确认清零'}
                style={{ fontSize: 13, padding: '7px 16px', borderRadius: 8, border: 'none', cursor: 'pointer', fontWeight: 500,
                  background: resetConfirmText === '确认清零' ? '#dc2626' : '#e2e8f0',
                  color: resetConfirmText === '确认清零' ? 'white' : '#94a3b8',
                  opacity: resetting ? 0.6 : 1 }}>
                {resetting ? '清零中...' : '确认清零'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
