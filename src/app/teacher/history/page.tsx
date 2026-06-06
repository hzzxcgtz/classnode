'use client';

import { useState, useEffect, useRef } from 'react';
import { api } from '@/lib/api';
import { exportConversationsDoc, exportStatsDoc } from '@/lib/export-doc';
import { Toast } from '@/lib/components';

export default function HistoryPage() {
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // 导出预览弹窗
  const [preview, setPreview] = useState<{
    type: 'conversations' | 'stats';
    classroomId: string;
    classroom: any;
    data: any;
  } | null>(null);
  const [exporting, setExporting] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  useEffect(() => {
    api.getHistory().then(setHistory).catch(() => {}).finally(() => setLoading(false));
  }, []);

  // 点击导出：先获取数据并展示预览
  const handlePreview = async (classroomId: string, type: 'conversations' | 'stats') => {
    const cr = history.find(h => h.id === classroomId);
    try {
      const data = type === 'conversations'
        ? await api.exportConversations(classroomId)
        : await api.exportStats(classroomId);
      setPreview({ type, classroomId, classroom: cr, data });
    } catch (e: any) {
      setToast({ msg: '获取数据失败: ' + e.message, type: 'error' });
    }
  };

  // 确认导出：生成 Word 并下载
  const handleConfirmExport = async () => {
    if (!preview) return;
    setExporting(true);
    try {
      const { type, classroom, data } = preview;
      const blob = type === 'conversations'
        ? await exportConversationsDoc(data)
        : await exportStatsDoc(data);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = type === 'conversations'
        ? `对话记录-${data.code || classroom?.id}.docx`
        : `学情报表-${classroom?.id.slice(0, 8)}.docx`;
      a.click();
      URL.revokeObjectURL(url);
      setPreview(null);
    } catch (e: any) {
      setToast({ msg: '导出失败: ' + e.message, type: 'error' });
    }
    setExporting(false);
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
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, color: '#0f172a' }}>数据管理</h1>
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
                            onClick={() => handlePreview(cr.id, 'conversations')}>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></svg>
                            对话
                          </button>
                          <button className="btn btn-secondary"
                            style={{ fontSize: 11, padding: '5px 10px', display: 'flex', alignItems: 'center', gap: 4 }}
                            onClick={() => handlePreview(cr.id, 'stats')}>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" /></svg>
                            报表
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

      {/* 导出预览弹窗 */}
      {preview && (
        <ExportPreviewDialog
          preview={preview}
          exporting={exporting}
          onConfirm={handleConfirmExport}
          onCancel={() => setPreview(null)}
        />
      )}

      {toast && <Toast msg={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}

/** 导出预览弹窗组件 */
function ExportPreviewDialog({
  preview,
  exporting,
  onConfirm,
  onCancel,
}: {
  preview: { type: 'conversations' | 'stats'; classroom: any; data: any };
  exporting: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { type, classroom, data } = preview;
  const isConversation = type === 'conversations';

  const startTime = classroom ? new Date(classroom.createdAt).toLocaleString() : '-';
  const endTime = classroom?.endedAt ? new Date(classroom.endedAt).toLocaleString() : '-';

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
          padding: '24px 28px 16px',
          borderBottom: '1px solid #eef2f6',
        }}>
          <h3 style={{ margin: 0, fontSize: 17, fontWeight: 600, color: '#0f172a' }}>
            {isConversation ? '导出对话记录' : '导出学情报表'}
          </h3>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: '#64748b' }}>
            请确认导出内容，无误后点击"确认导出"
          </p>
        </div>

        {/* 弹窗内容 */}
        <div style={{
          padding: '20px 28px',
          overflowY: 'auto', flex: 1,
        }}>
          {/* 课堂基本信息 */}
          <div style={{
            background: '#f8fafc', borderRadius: 10, padding: '14px 18px', marginBottom: 16,
            fontSize: 13,
          }}>
            <div style={{ fontWeight: 600, color: '#0f172a', marginBottom: 8 }}>
              {classroom?.title || '未命名课堂'}
            </div>
            <div style={{ color: '#64748b', lineHeight: 1.8 }}>
              <span style={{ marginRight: 24 }}>互动码：{data.code || '-'}</span>
              <span>创建时间：{startTime}</span>
              <br />
              <span style={{ marginRight: 24 }}>结束时间：{endTime}</span>
              <span>参与班级：{data.classes?.join('、') || '-'}</span>
            </div>
          </div>

          {isConversation ? (
            <ConversationPreview data={data} />
          ) : (
            <StatsPreview data={data} />
          )}
        </div>

        {/* 弹窗底部 */}
        <div style={{
          padding: '16px 28px',
          borderTop: '1px solid #eef2f6',
          display: 'flex', justifyContent: 'flex-end', gap: 10,
        }}>
          <button className="btn btn-secondary"
            onClick={onCancel} disabled={exporting}
            style={{ fontSize: 13, padding: '8px 18px' }}>
            取消
          </button>
          <button onClick={onConfirm} disabled={exporting}
            style={{
              fontSize: 13, padding: '8px 20px', borderRadius: 8, border: 'none',
              cursor: exporting ? 'not-allowed' : 'pointer', fontWeight: 500,
              background: exporting ? '#94a3b8' : '#2563eb', color: 'white',
              display: 'flex', alignItems: 'center', gap: 6,
            }}>
            {exporting ? (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ animation: 'spin 1s linear infinite' }}>
                  <line x1="12" y1="2" x2="12" y2="6" /><line x1="12" y1="18" x2="12" y2="22" />
                </svg>
                生成中...
              </>
            ) : (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
                确认导出
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

/** 对话预览 */
function ConversationPreview({ data }: { data: any }) {
  const students = data.students || [];
  const totalMsgs = students.reduce((sum: number, s: any) => sum + (s.messages?.length || 0), 0);

  return (
    <div>
      {/* 汇总统计 */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 16,
      }}>
        {[
          { label: '学生人数', value: students.length, color: '#0891b2', bg: '#ecfeff' },
          { label: '消息总数', value: totalMsgs, color: '#8b5cf6', bg: '#f5f3ff' },
          { label: 'AI 智能体', value: data.agents?.length || 0, color: '#db2777', bg: '#fdf2f8' },
        ].map(stat => (
          <div key={stat.label} style={{
            background: stat.bg, borderRadius: 8, padding: '10px 14px', textAlign: 'center',
          }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: stat.color }}>{stat.value}</div>
            <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>{stat.label}</div>
          </div>
        ))}
      </div>

      {/* 学生列表 */}
      <div style={{ fontSize: 12, fontWeight: 600, color: '#64748b', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>
        学生对话概况
      </div>
      {students.length === 0 ? (
        <div style={{ fontSize: 13, color: '#94a3b8', textAlign: 'center', padding: 20 }}>暂无学生记录</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {students.map((s: any, i: number) => {
            const msgCount = s.messages?.length || 0;
            const rounds = s.totalRounds || Math.ceil(msgCount / 2);
            return (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '8px 12px', borderRadius: 8, background: '#f8fafc', fontSize: 13,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontWeight: 500, color: '#0f172a' }}>{s.name}</span>
                  {s.studentNo && <span style={{ color: '#94a3b8', fontSize: 11 }}>{s.studentNo}</span>}
                </div>
                <span style={{ color: '#64748b', fontSize: 12 }}>
                  {rounds} 轮 · {msgCount} 条消息
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** 报表预览 */
function StatsPreview({ data }: { data: any }) {
  const headers = data.headers || ['学号', '姓名', '互动次数', '首问字数', '平均响应时间(秒)'];
  const rows = data.rows || [];
  const totalStudents = rows.length;
  const totalInteractions = rows.reduce((sum: number, r: any[]) => sum + (Number(r[2]) || 0), 0);

  return (
    <div>
      {/* 汇总 */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 16,
      }}>
        {[
          { label: '学生人数', value: totalStudents, color: '#0891b2', bg: '#ecfeff' },
          { label: '总交互轮数', value: totalInteractions, color: '#8b5cf6', bg: '#f5f3ff' },
          { label: '数据列数', value: headers.length, color: '#059669', bg: '#d1fae5' },
        ].map(stat => (
          <div key={stat.label} style={{
            background: stat.bg, borderRadius: 8, padding: '10px 14px', textAlign: 'center',
          }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: stat.color }}>{stat.value}</div>
            <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>{stat.label}</div>
          </div>
        ))}
      </div>

      {/* 数据表格 */}
      <div style={{ fontSize: 12, fontWeight: 600, color: '#64748b', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>
        数据预览
      </div>
      {rows.length === 0 ? (
        <div style={{ fontSize: 13, color: '#94a3b8', textAlign: 'center', padding: 20 }}>暂无数据</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {headers.map((h: string, i: number) => (
                  <th key={i} style={{
                    padding: '6px 8px', textAlign: 'center', background: '#eff6ff',
                    color: '#1e40af', fontWeight: 600, borderBottom: '2px solid #dbeafe',
                    whiteSpace: 'nowrap',
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 20).map((row: any[], ri: number) => (
                <tr key={ri}>
                  {row.map((val: any, ci: number) => (
                    <td key={ci} style={{
                      padding: '5px 8px', textAlign: 'center', color: '#1f2937',
                      borderBottom: '1px solid #f1f5f9',
                      background: ri % 2 === 0 ? 'white' : '#f8fafc',
                      maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>{val != null ? String(val) : '-'}</td>
                  ))}
                </tr>
              ))}
              {rows.length > 20 && (
                <tr>
                  <td colSpan={headers.length} style={{
                    padding: '8px', textAlign: 'center', color: '#94a3b8', fontSize: 11,
                    borderBottom: '1px solid #f1f5f9',
                  }}>
                    ... 还有 {rows.length - 20} 条记录，完整数据将在导出的 Word 中展示
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
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
  const [importing, setImporting] = useState(false);
  const [showUploadsPath, setShowUploadsPath] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { api.getBackups().then(setBackups).catch(() => {}); }, []);

  const handleBackup = async () => {
    setCreating(true);
    try {
      const result = await api.createBackup();
      setToast({ msg: '备份成功！', type: 'success' });
      api.getBackups().then(setBackups);
    } catch (e: any) {
      setToast({ msg: '备份失败: ' + e.message, type: 'error' });
    }
    setCreating(false);
  };

  const handleImportBackup = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    try {
      const result = await api.uploadBackup(file);
      if (result.error) {
        setToast({ msg: result.error, type: 'error' });
      } else {
        setToast({ msg: '导入备份成功！', type: 'success' });
        api.getBackups().then(setBackups);
      }
    } catch (e: any) {
      setToast({ msg: e.message, type: 'error' });
    }
    setImporting(false);
    // 清空 input 以便再次选择同一文件
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleRestore = async (name: string) => {
    setRestoring(true);
    try {
      await api.restoreBackup(name);
      setRestoreTarget(null);
      setToast({ msg: '数据恢复成功！页面将重新加载。', type: 'success' });
      window.location.reload();
    } catch (e: any) {
      setToast({ msg: '恢复失败: ' + e.message, type: 'error' });
    }
    setRestoring(false);
  };

  const handleDelete = async (name: string) => {
    setDeleting(true);
    try {
      await api.deleteBackup(name);
      setDeleteTarget(null);
      api.getBackups().then(setBackups);
    } catch (e: any) {
      setToast({ msg: '删除失败: ' + e.message, type: 'error' });
    }
    setDeleting(false);
  };

  const handleReset = async () => {
    if (resetConfirmText !== '确认清零') return;
    setResetting(true);
    try {
      await api.resetAllData();
      setShowResetDialog(false);
      setResetConfirmText('');
      setToast({ msg: '所有数据已清零！页面将重新加载。', type: 'success' });
      window.location.reload();
    } catch (e: any) {
      setToast({ msg: '清零失败: ' + e.message, type: 'error' });
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
        <button onClick={() => fileInputRef.current?.click()} disabled={importing}
          style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px',
            borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: 'pointer',
            border: '1px solid #e2e8f0', background: 'white', color: '#475569',
            opacity: importing ? 0.6 : 1,
          }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
          {importing ? '导入中...' : '导入备份'}
        </button>
        <input ref={fileInputRef} type="file" accept=".db" onChange={handleImportBackup}
          style={{ display: 'none' }} />
      </div>

      {/* 跨设备迁移提示 */}
      <div style={{
        display: 'flex', alignItems: 'flex-start', gap: 10,
        padding: '12px 16px', marginBottom: 16,
        background: '#fffbeb', borderRadius: 10,
        border: '1px solid #fde68a', fontSize: 13, color: '#92400e', lineHeight: 1.6,
      }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1 }}>
          <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
        <div>
          <strong>跨设备迁移须知：</strong>数据库备份仅包含文字数据，不包含上传的附件文件（图片等）。
          如需完整迁移，请手动将原电脑上{' '}
          <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', cursor: 'help' }}
            onMouseEnter={() => setShowUploadsPath(true)}
            onMouseLeave={() => setShowUploadsPath(false)}>
            <code style={{ background: '#fef3c7', padding: '1px 5px', borderRadius: 3, fontSize: 12, textDecoration: 'underline dotted #d97706', textUnderlineOffset: 3 }}>uploads</code>
            {showUploadsPath && (
              <div style={{
                position: 'absolute', left: '50%', bottom: 'calc(100% + 6px)',
                transform: 'translateX(-50%)', zIndex: 100,
                background: '#1e293b', color: '#f1f5f9',
                padding: '12px 16px', borderRadius: 10, fontSize: 12,
                lineHeight: 2, whiteSpace: 'nowrap',
                boxShadow: '0 6px 20px rgba(0,0,0,0.3)',
              }}>
                <div style={{ fontSize: 11, color: '#94a3b8', lineHeight: 1.5, marginBottom: 4 }}>跨设备迁移时需一并复制：</div>
                <div style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 11, color: '#e2e8f0' }}>Mac: ~/Library/Application Support/com.classnode.desktop/uploads/</div>
                <div style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 11, color: '#e2e8f0' }}>Windows: C:\Users\&lt;用户名&gt;\AppData\Roaming\com.classnode.desktop\uploads\</div>
              </div>
            )}
          </span>{' '}
          文件夹复制到新电脑的相同位置。
        </div>
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
                  {b.source === 'imported' ? (
                    <span style={{
                      fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 4,
                      background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a', flexShrink: 0,
                    }}>已导入</span>
                  ) : (
                    <span style={{
                      fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 4,
                      background: '#e0f2fe', color: '#0369a1', border: '1px solid #bae6fd', flexShrink: 0,
                    }}>本机</span>
                  )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                  <span style={{ color: '#94a3b8', fontSize: 12, whiteSpace: 'nowrap' }}>
                    {new Date(b.createdAt).toLocaleString()} · {(b.size / 1024).toFixed(1)} KB
                  </span>
                  <a href={api.getBackupDownloadUrl(b.name)} download
                    style={{ fontSize: 11, padding: '3px 8px', borderRadius: 4, cursor: 'pointer', textDecoration: 'none',
                      border: '1px solid #e2e8f0', background: '#f8fafc', color: '#475569' }}>
                    下载
                  </a>
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
