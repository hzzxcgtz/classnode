'use client';

import { useState, useEffect, useRef, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { platformColors } from '@/lib/constants';
import { getApiBaseUrl } from '@/lib/api-base';

const SOCKET_URL = getApiBaseUrl();

function apiBaseUrl() {
  if (typeof window !== 'undefined' && window.location.port === '3000') {
    return 'http://localhost:3001';
  }
  return '';
}

export default function TeacherDashboard() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [activeClassrooms, setActiveClassrooms] = useState<any[]>([]);
  const [onlineMap, setOnlineMap] = useState<Record<string, number>>({});
  const [settingsModalClassroom, setSettingsModalClassroom] = useState<any>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editGroups, setEditGroups] = useState<any[]>([]);
  const [allAgents, setAllAgents] = useState<any[]>([]);
  const [settingsDropdownGroupId, setSettingsDropdownGroupId] = useState<string | null>(null);
  const socketRef = useRef<any>(null);
  // 用 ref 跟踪最新的 classroom 列表，避免 socket connect 闭包中的 stale 值
  const activeClassroomsRef = useRef(activeClassrooms);
  activeClassroomsRef.current = activeClassrooms;

  useEffect(() => {
    loadData();
  }, []);

  // 定期刷新课堂数据，确保统计数据实时更新（socket 事件不一定覆盖所有字段）
  useEffect(() => {
    if (loading) return;
    const interval = setInterval(async () => {
      try {
        const data = await api.getActiveClassrooms();
        setActiveClassrooms(data);
      } catch {}
    }, 15000);
    return () => clearInterval(interval);
  }, [loading]);

  // 连接 socket 订阅在线状态（仅创建一次，不随数据刷新重建）
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const { io } = await import('socket.io-client');

      const sk = io(SOCKET_URL, { transports: ['websocket', 'polling'] });

      sk.on('connect', () => {
        if (!cancelled) {
          // 用 ref 拿到最新的 classroom 列表，而非闭包中的 stale 值
          const crs = activeClassroomsRef.current;
          crs.forEach((cr: any) => {
            sk.emit('listen-classroom-status', cr.id);
          });
        }
      });

      sk.on('online-students', (data: any) => {
        if (!cancelled) {
          setOnlineMap((prev: Record<string, number>) => ({
            ...prev,
            [data.classroomId]: data.studentIds?.length || 0,
          }));
        }
      });

      socketRef.current = sk;
    })();

    return () => { cancelled = true; };
  }, []);

  // 当活跃课堂列表变化时，通知 socket 开始监听新课堂的状态
  useEffect(() => {
    const sk = socketRef.current;
    if (!sk?.connected || activeClassrooms.length === 0) return;
    activeClassrooms.forEach((cr: any) => {
      sk.emit('listen-classroom-status', cr.id);
    });
  }, [activeClassrooms]);

  const loadData = async () => {
    setLoading(true);
    try {
      const data = await api.getActiveClassrooms();
      setActiveClassrooms(data);
    } catch {}
    setLoading(false);
  };

  const openSettings = async (cr: any) => {
    setSettingsModalClassroom(cr);
    setEditTitle(cr.title || '');
    const groups = (cr.groups || []).map((g: any) => ({ id: g.id, name: g.name, agentId: g.agent?.id || '' }));
    setEditGroups(groups);
    try {
      const agents = await api.getAgents();
      setAllAgents(agents);
    } catch {}
  };

  const handleSaveSettings = async () => {
    if (!settingsModalClassroom) return;
    try {
      const data: any = { title: editTitle };
      if (editGroups.length > 0) {
        data.groups = editGroups.map((g: any) => ({ id: g.id, agentId: g.agentId }));
      }
      await api.updateClassroomSettings(settingsModalClassroom.id, data);
      setSettingsModalClassroom(null);
      loadData();
    } catch (e: any) {
      alert(e.message);
    }
  };

  if (loading) {
    return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh' }}>加载中...</div>;
  }

  return (
    <div>
      {/* 页面标题 */}
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, color: '#0f172a' }}>课堂管理</h1>
        <p style={{ color: '#64748b', fontSize: 13, marginTop: 4 }}>
          管理课堂、监控互动进度
        </p>
      </div>

      {/* 工具栏 */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 16,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <h2 style={{ fontSize: 15, fontWeight: 600, margin: 0, color: '#0f172a' }}>活跃课堂</h2>
          {activeClassrooms.length > 0 && (
            <span style={{
              fontSize: 12, padding: '1px 8px', borderRadius: 10,
              background: '#dcfce7', color: '#16a34a', fontWeight: 500,
            }}>
              {activeClassrooms.length} 个
            </span>
          )}
        </div>
        <button className="btn btn-primary" onClick={() => router.push('/teacher/classroom/new')} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
          创建新课堂
        </button>
      </div>

      {/* 课堂列表 */}
      {activeClassrooms.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {activeClassrooms.map((cr: any) => (
            <div key={cr.id} style={{
              background: 'white', borderRadius: 12,
              border: '1px solid #e2e8f0', overflow: 'hidden',
              transition: 'box-shadow 0.15s',
            }}>
              {/* 上半部分：基本信息 */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 14,
                padding: '16px 20px',
              }}>
                <div style={{
                  width: 42, height: 42, borderRadius: 10,
                  background: '#eef2ff', color: '#2563eb',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 16, fontWeight: 700, flexShrink: 0,
                }}>
                  {(cr.title || '课')[0]}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 14, color: '#0f172a', marginBottom: 3 }}>
                    {cr.title || '未命名课堂'}
                    <span style={{
                      display: 'inline-block', marginLeft: 8,
                      padding: '1px 7px', borderRadius: 4,
                      background: '#f0fdf4', color: '#16a34a',
                      fontSize: 11, fontWeight: 600, fontFamily: 'monospace',
                    }}>
                      {cr.code}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: '#94a3b8' }}>
                    {cr._count?.students || 0} 名学生
                    <span style={{ margin: '0 6px', color: '#e2e8f0' }}>|</span>
                    {cr.classes?.[0]?.class?.name && (
                      <>
                        {cr.classes[0].class.name}
                        <span style={{ margin: '0 6px', color: '#e2e8f0' }}>|</span>
                      </>
                    )}
                    {(() => {
                      const modeCfg: Record<string, { label: string; bg: string; color: string; icon: ReactNode }> = {
                        standard: {
                          label: '标准模式',
                          bg: '#eef2ff', color: '#2563eb',
                          icon: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /></svg>,
                        },
                        group: {
                          label: '分组模式',
                          bg: '#f5f3ff', color: '#7c3aed',
                          icon: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="2" y="3" width="6" height="6" rx="1" /><rect x="16" y="3" width="6" height="6" rx="1" /><rect x="9" y="15" width="6" height="6" rx="1" /></svg>,
                        },
                        advanced: {
                          label: '高级模式',
                          bg: '#fef3c7', color: '#d97706',
                          icon: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>,
                        },
                      };
                      const cfg = modeCfg[cr.mode] || modeCfg.standard;
                      return (
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', gap: 3,
                          padding: '1px 7px', borderRadius: 4, fontSize: 11, fontWeight: 600,
                          verticalAlign: 'middle', lineHeight: '14px',
                          background: cfg.bg, color: cfg.color,
                        }}>
                          {cfg.icon}
                          {cfg.label}
                        </span>
                      );
                    })()}
                  </div>
                </div>
                {/* 右上角统计数据 */}
                <div style={{ display: 'flex', gap: 16, flexShrink: 0, marginLeft: 'auto' }}>
                  {[
                    { label: '在线', value: onlineMap[cr.id] || 0, color: '#22c55e' },
                    { label: '离线', value: Math.max(0, (cr._count?.students || 0) - (onlineMap[cr.id] || 0)), color: '#94a3b8' },
                    { label: '互动', value: (cr.students || []).reduce((sum: number, s: any) => sum + (s.totalRounds || 0), 0), color: '#2563eb' },
                  ].map((stat, i) => (
                    <div key={i} style={{ textAlign: 'center', minWidth: 40 }}>
                      <div style={{ fontSize: 18, fontWeight: 700, color: stat.color, lineHeight: 1.2 }}>{stat.value}</div>
                      <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 1 }}>{stat.label}</div>
                    </div>
                  ))}
                </div>
              </div>
              {/* 中间部分：智能体信息 */}
              {(() => {
                // 收集智能体（从 classroomAgents 和 groups 去重）
                const agentMap = new Map<string, any>();
                (cr.classroomAgents || []).forEach((ca: any) => {
                  if (ca.agent) agentMap.set(ca.agent.id, ca.agent);
                });
                (cr.groups || []).forEach((g: any) => {
                  if (g.agent) agentMap.set(g.agent.id, g.agent);
                });
                const agents = [...agentMap.values()];
                if (agents.length === 0) return null;
                return (
                <div style={{
                  padding: '8px 20px',
                  borderTop: '1px solid #f1f5f9',
                  display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
                }}>
                  <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 500, marginRight: 2 }}>
                    智能体
                  </span>
                  {agents.map((agt: any) => {
                    const pc = platformColors[agt.platform] || '#64748b';
                    return (
                      <span key={agt.id} style={{
                        display: 'inline-flex', alignItems: 'center', gap: 5,
                        padding: '3px 10px 3px 4px', borderRadius: 6,
                        background: '#f8fafc', border: '1px solid #eef2f6',
                        fontSize: 12, color: '#475569',
                      }}>
                        <span style={{
                          width: 18, height: 18, borderRadius: 4, flexShrink: 0,
                          background: pc,
                          color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 9, fontWeight: 700, overflow: 'hidden',
                        }}>
                          {agt.logo
                            ? <img src={agt.logo.startsWith('/') ? `${apiBaseUrl()}${agt.logo}` : agt.logo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                            : agt.name[0]}
                        </span>
                        {agt.name}
                      </span>
                    );
                  })}
                </div>
                );
              })()}
              {/* 下半部分：操作栏 */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '10px 20px',
                background: '#fafbfc', borderTop: '1px solid #f1f5f9',
              }}>
                <span style={{
                  width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
                  background: cr.status === 'paused' ? '#f59e0b' : '#22c55e',
                  boxShadow: cr.status === 'paused'
                    ? '0 0 6px rgba(245,158,11,0.4)'
                    : '0 0 6px rgba(34,197,94,0.4)',
                }} />
                <span style={{
                  fontSize: 12, fontWeight: 500, marginRight: 'auto',
                  color: cr.status === 'paused' ? '#d97706' : '#16a34a',
                }}>
                  {cr.status === 'paused' ? '已暂停' : '进行中'}
                </span>
                <button onClick={() => openSettings(cr)} title="课堂设置" style={{
                  padding: '6px 10px', borderRadius: 6, fontSize: 12,
                  background: 'transparent', color: '#64748b', border: '1px solid #e2e8f0',
                  cursor: 'pointer', lineHeight: 1, display: 'flex', alignItems: 'center',
                  transition: 'all 0.15s',
                }}
                  onMouseEnter={e => { e.currentTarget.style.background = '#f8fafc'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
                </button>
                <button onClick={() => router.push(`/teacher/classroom?id=${cr.id}`)} style={{
                  padding: '6px 14px', borderRadius: 6, fontSize: 12, fontWeight: 500,
                  background: '#2563eb', color: 'white', border: 'none', cursor: 'pointer',
                  transition: 'background 0.15s',
                }}
                  onMouseEnter={e => { e.currentTarget.style.background = '#1d4ed8'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = '#2563eb'; }}>
                  进入课堂
                </button>
                {cr.status === 'paused' ? (
                  <button onClick={async () => {
                    await api.resumeClassroom(cr.id);
                    loadData();
                  }} style={{
                    padding: '6px 14px', borderRadius: 6, fontSize: 12, fontWeight: 500,
                    background: 'transparent', color: '#2563eb', border: '1px solid #93c5fd',
                    cursor: 'pointer', transition: 'all 0.15s',
                  }}
                    onMouseEnter={e => { e.currentTarget.style.background = '#eef2ff'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}>
                    继续上课
                  </button>
                ) : (
                  <button onClick={async () => {
                    await api.pauseClassroom(cr.id);
                    loadData();
                  }} style={{
                    padding: '6px 14px', borderRadius: 6, fontSize: 12, fontWeight: 500,
                    background: 'transparent', color: '#d97706', border: '1px solid #fcd34d',
                    cursor: 'pointer', transition: 'all 0.15s',
                  }}
                    onMouseEnter={e => { e.currentTarget.style.background = '#fffbeb'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}>
                    暂停
                  </button>
                )}
                <button onClick={async () => {
                  if (confirm(`确定结束课堂 "${cr.title || '未命名课堂'}" 吗？\n结束后的课堂可在历史数据中查看。`)) {
                    await api.endClassroom(cr.id);
                    loadData();
                  }
                }} style={{
                  padding: '6px 14px', borderRadius: 6, fontSize: 12, fontWeight: 500,
                  background: 'transparent', color: '#ef4444', border: '1px solid #fca5a5',
                  cursor: 'pointer', transition: 'all 0.15s',
                }}
                  onMouseEnter={e => { e.currentTarget.style.background = '#fef2f2'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}>
                  结束课堂
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        /* 空状态 */
        <div style={{
          background: 'white', borderRadius: 14, padding: '48px 20px',
          border: '1px solid #e2e8f0', textAlign: 'center',
        }}>
          <div style={{
            width: 52, height: 52, borderRadius: 14,
            background: '#f1f5f9', margin: '0 auto 14px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round">
              <rect x="2" y="3" width="20" height="14" rx="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" />
            </svg>
          </div>
          <div style={{ fontSize: 15, fontWeight: 600, color: '#0f172a', marginBottom: 6 }}>暂无活跃课堂</div>
          <p style={{ fontSize: 13, color: '#94a3b8', margin: '0 0 20px' }}>
            创建新课堂后，学生通过互动码加入，即可开始互动教学
          </p>
          <button onClick={() => router.push('/teacher/classroom/new')} style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '10px 24px', borderRadius: 8, fontSize: 14, fontWeight: 600,
            background: '#2563eb', color: 'white', border: 'none', cursor: 'pointer',
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
            创建第一个课堂
          </button>
        </div>
      )}
      {/* 课堂设置弹窗 */}
      {settingsModalClassroom && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, backdropFilter: 'blur(4px)' }}
          onClick={() => { setSettingsModalClassroom(null); setSettingsDropdownGroupId(null); }}>
          <div style={{ background: 'white', borderRadius: 16, maxWidth: 480, width: '90%', boxShadow: '0 25px 80px rgba(0,0,0,0.2)' }}
            onClick={e => e.stopPropagation()}>
            {/* 弹窗头部 */}
            <div style={{ padding: '24px 28px 16px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 40, height: 40, borderRadius: 10, background: '#eef2ff', color: '#2563eb', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
              </div>
              <div>
                <h3 style={{ fontSize: 16, fontWeight: 600, color: '#0f172a', margin: 0 }}>课堂设置</h3>
                <p style={{ fontSize: 12, color: '#94a3b8', margin: '2px 0 0' }}>修改课堂名称或调整小组绑定智能体</p>
              </div>
            </div>
            {/* 弹窗内容 */}
            <div style={{ padding: '20px 28px' }}>
              {/* 课堂名称 */}
              <div style={{ marginBottom: 20 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 20h16" /><path d="M4 20V4m0 0h16v16" /></svg>
                  课堂名称
                </label>
                <input type="text" value={editTitle} onChange={e => setEditTitle(e.target.value)}
                  placeholder="未命名课堂"
                  style={{ width: '100%', padding: '10px 14px', borderRadius: 10, border: '1px solid #e2e8f0', fontSize: 14, outline: 'none', boxSizing: 'border-box', transition: 'border-color 0.15s', background: '#fafbfc' }}
                  onFocus={e => { e.currentTarget.style.borderColor = '#2563eb'; e.currentTarget.style.background = 'white'; }}
                  onBlur={e => { e.currentTarget.style.borderColor = '#e2e8f0'; e.currentTarget.style.background = '#fafbfc'; }} />
              </div>
              {/* 小组智能体 */}
              {editGroups.length > 0 && (
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="2" y="3" width="6" height="6" rx="1" /><rect x="16" y="3" width="6" height="6" rx="1" /><rect x="9" y="15" width="6" height="6" rx="1" /></svg>
                    小组智能体
                  </div>
                  <div style={{ background: '#fafbfc', borderRadius: 10, border: '1px solid #eef2f6', padding: '12px 14px' }}>
                    {editGroups.map((g: any, idx: number) => (
                      <div key={g.id} style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        padding: '8px 0',
                        borderBottom: idx < editGroups.length - 1 ? '1px solid #eef2f6' : 'none',
                      }}>
                        <div style={{ width: 24, height: 24, borderRadius: 6, background: '#2563eb', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>
                          {idx + 1}
                        </div>
                        <span style={{ fontSize: 13, fontWeight: 500, color: '#0f172a', minWidth: 70, flexShrink: 0 }}>{g.name}</span>
                        <div style={{ flex: 1, position: 'relative' }}>
                          <div
                            onClick={() => setSettingsDropdownGroupId(settingsDropdownGroupId === g.id ? null : g.id)}
                            style={{
                              display: 'flex', alignItems: 'center', gap: 6,
                              padding: '6px 28px 6px 10px', borderRadius: 8, fontSize: 13,
                              border: '1px solid #e2e8f0', cursor: 'pointer',
                              background: 'white', minHeight: 32,
                            }}>
                            {g.agentId ? (() => {
                              const agent = allAgents.find((a: any) => a.id === g.agentId);
                              const logoUrl = agent?.logo ? (agent.logo.startsWith('/') ? `${getApiBaseUrl()}${agent.logo}` : agent.logo) : null;
                              return <>
                                {logoUrl ? (
                                  <img src={logoUrl} alt="" style={{ width: 20, height: 20, borderRadius: 4, objectFit: 'cover' }} />
                                ) : (
                                  <div style={{ width: 20, height: 20, borderRadius: 4, background: 'linear-gradient(135deg, #667eea, #764ba2)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700 }}>{agent?.name?.[0] || '?'}</div>
                                )}
                                <span style={{ color: '#0f172a' }}>{agent?.name || ''}</span>
                              </>;
                            })() : (
                              <span style={{ color: '#94a3b8' }}>选择智能体</span>
                            )}
                          </div>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2.5" strokeLinecap="round" style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}>
                            <polyline points="6 9 12 15 18 9" />
                          </svg>
                          {settingsDropdownGroupId === g.id && (
                            <div style={{
                              position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 60,
                              marginTop: 4, background: 'white', borderRadius: 8,
                              border: '1px solid #e2e8f0', boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                              maxHeight: 200, overflowY: 'auto',
                            }}>
                              {allAgents.map((a: any) => {
                                const logoUrl = a.logo ? (a.logo.startsWith('/') ? `${getApiBaseUrl()}${a.logo}` : a.logo) : null;
                                return (
                                  <div key={a.id} onClick={() => {
                                    const next = [...editGroups];
                                    next[idx] = { ...next[idx], agentId: a.id };
                                    setEditGroups(next);
                                    setSettingsDropdownGroupId(null);
                                  }}
                                  style={{
                                    display: 'flex', alignItems: 'center', gap: 8,
                                    padding: '8px 12px', cursor: 'pointer', fontSize: 13,
                                    background: g.agentId === a.id ? '#eef2ff' : 'white',
                                  }}>
                                    {logoUrl ? (
                                      <img src={logoUrl} alt="" style={{ width: 20, height: 20, borderRadius: 4, objectFit: 'cover' }} />
                                    ) : (
                                      <div style={{ width: 20, height: 20, borderRadius: 4, background: 'linear-gradient(135deg, #667eea, #764ba2)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700 }}>{a.name[0]}</div>
                                    )}
                                    <span>{a.name}</span>
                                    {g.agentId === a.id && (
                                      <svg width="14" height="14" viewBox="0 0 24 24" fill="#2563eb" stroke="white" strokeWidth="3" style={{ marginLeft: 'auto' }}>
                                        <polyline points="20 6 9 17 4 12" />
                                      </svg>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            {/* 弹窗底部按钮 */}
            <div style={{ padding: '16px 28px', borderTop: '1px solid #f1f5f9', display: 'flex', gap: 8, justifyContent: 'flex-end', background: '#fafbfc', borderRadius: '0 0 16px 16px' }}>
              <button onClick={() => setSettingsModalClassroom(null)} className="btn"
                style={{ fontSize: 13 }}>
                取消
              </button>
              <button onClick={handleSaveSettings} className="btn btn-primary"
                style={{ fontSize: 13 }}>
                保存设置
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
