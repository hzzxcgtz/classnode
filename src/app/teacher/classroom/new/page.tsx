'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { getApiBaseUrl } from '@/lib/api-base';

type CreateMode = 'standard' | 'group' | 'advanced';

export default function NewClassroomPage() {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [agents, setAgents] = useState<any[]>([]);
  const [classes, setClasses] = useState<any[]>([]);
  const [selectedClassId, setSelectedClassId] = useState('');
  const [classGroups, setClassGroups] = useState<any[]>([]);
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [mode, setMode] = useState<CreateMode>('standard');
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const [groupAgentIds, setGroupAgentIds] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    Promise.all([api.getAgents(), api.getClasses()]).then(([a, c]) => {
      setAgents(a.filter((agent: any) => agent.enabled !== false));
      setClasses(c);
    });
  }, []);

  const clearError = (field: string) => {
    setFieldErrors(prev => {
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

  // 选择班级时检测是否有分组
  const selectClass = (id: string) => {
    setSelectedClassId(id);
    clearError('class');
    setLoadingGroups(true);
    setClassGroups([]);
    setGroupAgentIds({});
    api.getGroups(id).then(groups => {
      setClassGroups(groups || []);
      setMode(groups?.length > 0 ? 'standard' : 'standard');
    }).catch(() => {
      setClassGroups([]);
      setMode('standard');
    }).finally(() => setLoadingGroups(false));
  };

  const handleCreate = async () => {
    const errors: Record<string, string> = {};
    if (!title.trim()) errors.title = '请输入课堂标题';
    if (!selectedClassId) errors.class = '请选择班级';
    if (mode !== 'advanced' && !selectedAgentId) errors.agent = '请选择AI智能体';
    if (mode === 'advanced') {
      const allAssigned = classGroups.every(g => groupAgentIds[g.id]);
      if (!allAssigned) errors.groupAgents = '请为每个小组分配智能体';
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    setSaving(true);
    try {
      if (mode === 'advanced') {
        const groups = classGroups.map(g => ({
          name: g.name,
          agentId: groupAgentIds[g.id],
          studentIds: g.studentIds || [],
        }));
        const result: any = await api.createAdvancedClassroom({
          title: title || undefined,
          classId: selectedClassId,
          groups,
        });
        router.push(`/teacher/classroom?id=${result.id}`);
      } else {
        const result: any = await api.createClassroom({
          title: title || undefined,
          classIds: [selectedClassId],
          agentIds: [selectedAgentId],
          mode: mode === 'group' ? 'group' : 'standard',
        });
        router.push(`/teacher/classroom?id=${result.id}`);
      }
    } catch (e: any) {
      setFieldErrors({ submit: e.message });
    }
    setSaving(false);
  };

  return (
    <div style={{ maxWidth: 760, margin: '0 auto' }}>
      {/* 页面标题 */}
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, color: '#0f172a' }}>创建新课堂</h1>
        <p style={{ color: '#64748b', fontSize: 13, marginTop: 4 }}>
          配置课堂参数并发起互动课堂
        </p>
      </div>

      <div style={{ background: 'white', borderRadius: 14, border: '1px solid #e2e8f0', padding: 24 }}>
        {/* 课堂标题 */}
        <div style={{
          background: '#fafbfc', borderRadius: 10, border: '1px solid #eef2f6',
          padding: '16px 20px', marginBottom: 20,
        }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6, color: '#0f172a' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
            课堂标题
          </div>
          <input className="input" value={title} onChange={e => { setTitle(e.target.value); clearError('title'); }}
            placeholder="如：第三单元英语对话练习"
            style={{ borderColor: fieldErrors.title ? '#ef4444' : undefined }} />
          {fieldErrors.title && <div style={{ fontSize: 12, color: '#ef4444', marginTop: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
            {fieldErrors.title}
          </div>}
        </div>

        {/* 选择班级 */}
        <div style={{
          background: '#fafbfc', borderRadius: 10, border: '1px solid #eef2f6',
          padding: '16px 20px', marginBottom: 20,
        }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6, color: '#0f172a' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /></svg>
            选择班级
          </div>
          {classes.length === 0 ? (
            <div style={{ padding: '14px 16px', background: '#f1f5f9', borderRadius: 8, fontSize: 13, color: '#94a3b8', textAlign: 'center' }}>
              暂无可选班级，请先在「班级管理」中创建班级
            </div>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {classes.map(c => (
                <div key={c.id} onClick={() => selectClass(c.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '9px 14px',
                    borderRadius: 8, userSelect: 'none',
                    border: `1.5px solid ${fieldErrors.class ? '#ef4444' : selectedClassId === c.id ? '#2563eb' : '#e2e8f0'}`,
                    background: selectedClassId === c.id ? '#eef2ff' : 'white',
                    cursor: 'pointer', fontSize: 14, fontWeight: selectedClassId === c.id ? 500 : 400,
                    transition: 'all 0.12s',
                  }}>
                  <div style={{
                    width: 16, height: 16, borderRadius: '50%',
                    border: `2px solid ${selectedClassId === c.id ? '#2563eb' : '#cbd5e1'}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    transition: 'all 0.12s',
                  }}>
                    {selectedClassId === c.id && (
                      <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#2563eb' }} />
                    )}
                  </div>
                  <span style={{ color: '#0f172a' }}>{c.name}</span>
                  <span style={{
                    fontSize: 11, padding: '1px 6px', borderRadius: 4,
                    background: '#f1f5f9', color: '#64748b',
                  }}>
                    {c._count?.students || 0} 人
                  </span>
                </div>
              ))}
            </div>
          )}
          {fieldErrors.class && <div style={{ fontSize: 12, color: '#ef4444', marginTop: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
            {fieldErrors.class}
          </div>}
        </div>

        {/* 模式选择 — 仅当所选班级有分组时显示 */}
        {selectedClassId && !loadingGroups && classGroups.length > 0 && (
          <div style={{
            background: '#fafbfc', borderRadius: 10, border: '1px solid #eef2f6',
            padding: '16px 20px', marginBottom: 20,
          }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6, color: '#0f172a' }}>
              参与模式
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              {[
                {
                  id: 'standard' as CreateMode,
                  label: '学生模式',
                  sub: 'Student Mode',
                  desc: '学生选择姓名加入，以个人身份与AI互动',
                  icon: (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
                    </svg>
                  ),
                },
                {
                  id: 'group' as CreateMode,
                  label: '分组模式',
                  sub: 'Group Mode',
                  desc: '学生选择小组加入，同组共享一个对话窗口',
                  icon: (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                      <rect x="2" y="3" width="6" height="6" rx="1" /><rect x="16" y="3" width="6" height="6" rx="1" /><rect x="9" y="15" width="6" height="6" rx="1" />
                    </svg>
                  ),
                },
                {
                  id: 'advanced' as CreateMode,
                  label: '高级模式',
                  sub: 'Advanced Mode',
                  desc: '每个小组绑定不同的AI智能体，分组独立对话',
                  icon: (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                      <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                    </svg>
                  ),
                },
              ].map(m => (
                <div key={m.id} onClick={() => setMode(m.id)}
                  style={{
                    flex: 1, padding: '14px 16px', borderRadius: 10, cursor: 'pointer',
                    border: `2px solid ${mode === m.id ? '#2563eb' : '#e2e8f0'}`,
                    background: mode === m.id ? '#eef2ff' : 'white',
                    transition: 'all 0.12s',
                    display: 'flex', flexDirection: 'column',
                  }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <div style={{
                      width: 16, height: 16, borderRadius: '50%',
                      border: `2px solid ${mode === m.id ? '#2563eb' : '#cbd5e1'}`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      {mode === m.id && (
                        <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#2563eb' }} />
                      )}
                    </div>
                    <span style={{ fontSize: 14, fontWeight: 600, color: '#0f172a' }}>{m.label}</span>
                    <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 400 }}>{m.sub}</span>
                  </div>
                  <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.4, marginLeft: 24, display: 'flex', alignItems: 'flex-start', gap: 5, flex: 1 }}>
                    <span style={{ flexShrink: 0, marginTop: 2, color: mode === m.id ? '#2563eb' : '#94a3b8' }}>{m.icon}</span>
                    <span>{m.desc}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 无分组提示 */}
        {selectedClassId && !loadingGroups && classGroups.length === 0 && (
          <div style={{
            background: '#fafbfc', borderRadius: 10, border: '1px solid #eef2f6',
            padding: '12px 16px', marginBottom: 20, fontSize: 13, color: '#64748b',
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" /></svg>
            该班级暂无分组，将以学生模式创建课堂
          </div>
        )}

        {/* 分组信息展示（分组模式） */}
        {selectedClassId && (mode === 'group') && classGroups.length > 0 && (
          <div style={{
            background: '#fafbfc', borderRadius: 10, border: '1px solid #eef2f6',
            padding: '16px 20px', marginBottom: 20,
          }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6, color: '#0f172a' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><rect x="2" y="3" width="6" height="6" rx="1" /><rect x="16" y="3" width="6" height="6" rx="1" /><rect x="9" y="15" width="6" height="6" rx="1" /></svg>
              小组信息
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {classGroups.map((g, i) => (
                <div key={g.id} style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '10px 14px', border: '1px solid #e2e8f0', borderRadius: 8,
                  background: 'white',
                }}>
                  <div style={{
                    width: 26, height: 26, borderRadius: 6,
                    background: '#2563eb', color: 'white',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 12, fontWeight: 700, flexShrink: 0,
                  }}>
                    {i + 1}
                  </div>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 500, color: '#0f172a' }}>{g.name}</div>
                    <div style={{ fontSize: 11, color: '#94a3b8' }}>
                      {(g.studentIds?.length || 0)} 名学生
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 高级模式：每个组分配智能体 */}
        {selectedClassId && mode === 'advanced' && classGroups.length > 0 && (
          <div style={{
            background: '#fafbfc', borderRadius: 10,
            border: `1px solid ${fieldErrors.groupAgents ? '#ef4444' : '#eef2f6'}`,
            padding: '16px 20px', marginBottom: 20,
          }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6, color: '#0f172a' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><rect x="2" y="3" width="6" height="6" rx="1" /><rect x="16" y="3" width="6" height="6" rx="1" /><rect x="9" y="15" width="6" height="6" rx="1" /></svg>
              为每个小组分配AI智能体
            </div>
            {classGroups.map((g, i) => (
              <div key={g.id} style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '10px 14px', border: '1px solid #e2e8f0', borderRadius: 8,
                marginBottom: 8, background: 'white',
              }}>
                <div style={{
                  width: 26, height: 26, borderRadius: 6,
                  background: '#2563eb', color: 'white',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 12, fontWeight: 700, flexShrink: 0,
                }}>
                  {i + 1}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 500, color: '#0f172a' }}>{g.name}</div>
                  <div style={{ fontSize: 11, color: '#94a3b8' }}>{(g.studentIds?.length || 0)} 名学生</div>
                </div>
                <select className="input" value={groupAgentIds[g.id] || ''}
                  onChange={e => { setGroupAgentIds(prev => ({ ...prev, [g.id]: e.target.value })); clearError('groupAgents'); }}
                  style={{ width: 180, fontSize: 13 }}>
                  <option value="">选择AI智能体</option>
                  {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
            ))}
            {classGroups.length > 0 && fieldErrors.groupAgents && <div style={{ fontSize: 12, color: '#ef4444', marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
              {fieldErrors.groupAgents}
            </div>}
          </div>
        )}

        {/* 学生模式/分组模式：选择AI智能体 */}
        {mode !== 'advanced' && (
          <div style={{
            background: '#fafbfc', borderRadius: 10, border: '1px solid #eef2f6',
            padding: '16px 20px', marginBottom: 20,
          }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6, color: '#0f172a' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><rect x="4" y="4" width="16" height="16" rx="3" /><path d="M9 12h6" /><path d="M12 9v6" /></svg>
              选择AI智能体
            </div>
            {agents.length === 0 ? (
              <div style={{ padding: '14px 16px', background: '#f1f5f9', borderRadius: 8, fontSize: 13, color: '#94a3b8', textAlign: 'center' }}>
                暂无可选智能体，请先在「AI智能体」中接入
              </div>
            ) : (
              <div style={{
                display: 'flex', flexWrap: 'wrap', gap: 8,
                padding: 8, borderRadius: 8,
                border: `1.5px solid ${fieldErrors.agent ? '#ef4444' : 'transparent'}`,
                transition: 'border-color 0.15s',
              }}>
                {agents.map(a => {
                  const logoUrl = a.logo ? (a.logo.startsWith('/') ? `${getApiBaseUrl()}${a.logo}` : a.logo) : null;
                  return (
                    <div key={a.id} onClick={() => { setSelectedAgentId(a.id); clearError('agent'); }}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px',
                        borderRadius: 8, userSelect: 'none',
                        border: `1.5px solid ${selectedAgentId === a.id ? '#2563eb' : '#e2e8f0'}`,
                        background: selectedAgentId === a.id ? '#eef2ff' : 'white',
                        cursor: 'pointer', fontSize: 14, fontWeight: selectedAgentId === a.id ? 500 : 400,
                        transition: 'all 0.12s',
                      }}>
                      {logoUrl ? (
                        <img src={logoUrl} alt="" style={{ width: 22, height: 22, borderRadius: 5, objectFit: 'cover', flexShrink: 0 }} />
                      ) : (
                        <div style={{
                          width: 22, height: 22, borderRadius: 5,
                          background: 'linear-gradient(135deg, #667eea, #764ba2)',
                          color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 11, fontWeight: 700, flexShrink: 0,
                        }}>
                          {a.name[0]}
                        </div>
                      )}
                      <span style={{ color: '#0f172a' }}>{a.name}</span>
                    </div>
                  );
                })}
              </div>
            )}
            {fieldErrors.agent && <div style={{ fontSize: 12, color: '#ef4444', marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
              {fieldErrors.agent}
            </div>}
          </div>
        )}

        {fieldErrors.submit && <div style={{ fontSize: 12, color: '#ef4444', marginBottom: 16, marginTop: -4, display: 'flex', alignItems: 'center', gap: 4 }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
          {fieldErrors.submit}
        </div>}

        {/* 操作按钮 */}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', paddingTop: 16, borderTop: '1px solid #eef2f6' }}>
          <button className="btn btn-secondary" onClick={() => router.push('/teacher')}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" /></svg>
            取消
          </button>
          <button className="btn btn-primary btn-lg" onClick={handleCreate} disabled={saving}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {saving ? (
              <>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ animation: 'spin 1s linear infinite' }}>
                  <line x1="12" y1="2" x2="12" y2="6" /><line x1="12" y1="18" x2="12" y2="22" /><line x1="4.93" y1="4.93" x2="7.76" y2="7.76" /><line x1="16.24" y1="16.24" x2="19.07" y2="19.07" /><line x1="2" y1="12" x2="6" y2="12" /><line x1="18" y1="12" x2="22" y2="12" /><line x1="4.93" y1="19.07" x2="7.76" y2="16.24" /><line x1="16.24" y1="7.76" x2="19.07" y2="4.93" />
                </svg>
                创建中...
              </>
            ) : (
              <>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polygon points="5 3 19 12 5 21 5 3" /></svg>
                {mode === 'group' ? '发起课堂（分组模式）' : mode === 'advanced' ? '发起课堂（高级模式）' : '发起课堂'}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
