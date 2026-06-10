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
  const [openDropdownGroupId, setOpenDropdownGroupId] = useState<string | null>(null);

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

  const selectClass = (id: string) => {
    setSelectedClassId(id);
    clearError('class');
    setLoadingGroups(true);
    setClassGroups([]);
    setGroupAgentIds({});
    api.getGroups(id).then(groups => {
      setClassGroups(groups || []);
    }).catch(() => {
      setClassGroups([]);
    }).finally(() => setLoadingGroups(false));
  };

  const handleModeChange = (newMode: CreateMode) => {
    setMode(newMode);
    clearError('mode');
    // 切换到分组/高级模式时，若当前选中的班级无分组则取消选中
    if ((newMode === 'group' || newMode === 'advanced') && selectedClassId) {
      const cls = classes.find(c => c.id === selectedClassId);
      if (!cls || (cls._count?.groups || 0) === 0) {
        setSelectedClassId('');
        setClassGroups([]);
        setGroupAgentIds({});
      }
    }
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
        <h1 style={{ fontSize: "1.375rem", fontWeight: 700, margin: 0, color: '#0f172a' }}>创建新课堂</h1>
        <p style={{ color: '#64748b', fontSize: "0.813rem", marginTop: 4 }}>
          配置课堂参数并发起互动课堂
        </p>
      </div>

      <div style={{ background: 'white', borderRadius: 14, border: '1px solid #e2e8f0', padding: 24 }}>
        {/* 课堂标题 */}
        <div style={{
          background: '#fafbfc', borderRadius: 10, border: '1px solid #eef2f6',
          padding: '16px 20px', marginBottom: 20,
        }}>
          <div style={{ fontSize: "0.813rem", fontWeight: 600, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6, color: '#0f172a' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
            课堂标题
          </div>
          <input className="input" value={title} onChange={e => { setTitle(e.target.value); clearError('title'); }}
            placeholder="如：第三单元英语对话练习"
            style={{ borderColor: fieldErrors.title ? '#ef4444' : undefined }} />
          {fieldErrors.title && <div style={{ fontSize: "0.75rem", color: '#ef4444', marginTop: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
            {fieldErrors.title}
          </div>}
        </div>

        {/* 选择参与模式 */}
        <div style={{
          background: '#fafbfc', borderRadius: 10, border: '1px solid #eef2f6',
          padding: '16px 20px', marginBottom: 20,
        }}>
          <div style={{ fontSize: "0.813rem", fontWeight: 600, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6, color: '#0f172a' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
            选择参与模式
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            {[
              {
                id: 'standard' as CreateMode,
                label: '标准模式',
                sub: 'Standard Mode',
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
              <div key={m.id} onClick={() => handleModeChange(m.id)}
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
                  <span style={{ fontSize: "0.875rem", fontWeight: 600, color: '#0f172a' }}>{m.label}</span>
                  <span style={{ fontSize: "0.688rem", color: '#94a3b8', fontWeight: 400 }}>{m.sub}</span>
                </div>
                <div style={{ fontSize: "0.75rem", color: '#64748b', lineHeight: 1.4, marginLeft: 24, display: 'flex', alignItems: 'flex-start', gap: 5, flex: 1 }}>
                  <span style={{ flexShrink: 0, marginTop: 2, color: mode === m.id ? '#2563eb' : '#94a3b8' }}>{m.icon}</span>
                  <span>{m.desc}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 选择班级 */}
        <div style={{
          background: '#fafbfc', borderRadius: 10, border: '1px solid #eef2f6',
          padding: '16px 20px', marginBottom: 20,
        }}>
          <div style={{ fontSize: "0.813rem", fontWeight: 600, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6, color: '#0f172a' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /></svg>
            选择班级
            {mode !== 'standard' && (
              <span style={{ fontSize: "0.75rem", color: '#94a3b8', fontWeight: 400, marginLeft: 4 }}>（仅显示已分组的班级）</span>
            )}
          </div>
          {classes.length === 0 ? (
            <div style={{ padding: '14px 16px', background: '#f1f5f9', borderRadius: 8, fontSize: "0.813rem", color: '#94a3b8', textAlign: 'center' }}>
              暂无可选班级，请先在「班级管理」中创建班级
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {classes.map(c => {
                const hasGroups = (c._count?.groups || 0) > 0;
                const isSelected = selectedClassId === c.id;
                const isDisabled = (mode === 'group' || mode === 'advanced') && !hasGroups;
                return (
                  <div key={c.id} onClick={() => { if (!isDisabled) selectClass(c.id); }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '12px 14px', borderRadius: 10, userSelect: 'none',
                      border: `1.5px solid ${fieldErrors.class ? '#ef4444' : isSelected ? '#2563eb' : '#e2e8f0'}`,
                      background: isSelected ? '#eef2ff' : 'white',
                      cursor: isDisabled ? 'not-allowed' : 'pointer',
                      opacity: isDisabled ? 0.5 : 1,
                      fontSize: "0.875rem",
                      transition: 'all 0.12s',
                    }}>
                    <div style={{ width: 36, height: 36, borderRadius: 9, background: isSelected ? '#2563eb' : '#f1f5f9', color: isSelected ? 'white' : '#64748b', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /></svg>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: "0.875rem", fontWeight: 600, color: '#0f172a' }}>{c.name}</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: "0.75rem", color: '#94a3b8', marginTop: 1 }}>
                        <span>{c._count?.students || 0} 名学生</span>
                        {hasGroups && (
                          <>
                            <span>·</span>
                            <span style={{ color: '#7c3aed' }}>{c._count.groups} 个小组</span>
                          </>
                        )}
                      </div>
                    </div>
                    {isDisabled ? (
                      <span style={{ fontSize: "0.625rem", padding: '1px 8px', borderRadius: 8, background: '#fef3c7', color: '#b45309', fontWeight: 500, flexShrink: 0 }}>仅限标准模式</span>
                    ) : hasGroups ? (
                      <span style={{ fontSize: "0.625rem", padding: '1px 8px', borderRadius: 8, background: '#f5f3ff', color: '#7c3aed', fontWeight: 500, flexShrink: 0 }}>已分组</span>
                    ) : (
                      <span style={{ fontSize: "0.625rem", padding: '1px 8px', borderRadius: 8, background: '#f1f5f9', color: '#94a3b8', fontWeight: 500, flexShrink: 0 }}>无分组</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {fieldErrors.class && <div style={{ fontSize: "0.75rem", color: '#ef4444', marginTop: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
            {fieldErrors.class}
          </div>}
        </div>

        {/* 高级模式：每个组分配智能体 */}
        {selectedClassId && mode === 'advanced' && classGroups.length > 0 && (
          <div style={{
            background: '#fafbfc', borderRadius: 10,
            border: `1px solid ${fieldErrors.groupAgents ? '#ef4444' : '#eef2f6'}`,
            padding: '16px 20px', marginBottom: 20,
          }}>
            <div style={{ fontSize: "0.813rem", fontWeight: 600, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6, color: '#0f172a' }}>
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
                  fontSize: "0.75rem", fontWeight: 700, flexShrink: 0,
                }}>
                  {i + 1}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: "0.875rem", fontWeight: 500, color: '#0f172a' }}>{g.name}</div>
                  <div style={{ fontSize: "0.688rem", color: '#94a3b8' }}>{(g.studentIds?.length || 0)} 名学生</div>
                </div>
                <div style={{ position: 'relative', width: 200, flexShrink: 0 }}>
                  <div
                    onClick={() => setOpenDropdownGroupId(openDropdownGroupId === g.id ? null : g.id)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 6,
                      padding: '6px 10px', borderRadius: 6, fontSize: "0.813rem",
                      border: '1px solid #e2e8f0', cursor: 'pointer',
                      background: 'white', minHeight: 32,
                    }}>
                    {groupAgentIds[g.id] ? (() => {
                      const agent = agents.find(a => a.id === groupAgentIds[g.id]);
                      const logoUrl = agent?.logo ? (agent.logo.startsWith('/') ? `${getApiBaseUrl()}${agent.logo}` : agent.logo) : null;
                      return <>
                        {logoUrl ? (
                          <img src={logoUrl} alt="" style={{ width: 20, height: 20, borderRadius: 4, objectFit: 'cover' }} />
                        ) : (
                          <div style={{ width: 20, height: 20, borderRadius: 4, background: 'linear-gradient(135deg, #667eea, #764ba2)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: "0.625rem", fontWeight: 700 }}>{agent?.name?.[0] || '?'}</div>
                        )}
                        <span style={{ color: '#0f172a' }}>{agent?.name || ''}</span>
                      </>;
                    })() : (
                      <span style={{ color: '#94a3b8' }}>选择AI智能体</span>
                    )}
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" style={{ marginLeft: 'auto' }}><polyline points="6 9 12 15 18 9" /></svg>
                  </div>
                  {openDropdownGroupId === g.id && (
                    <div style={{
                      position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50,
                      marginTop: 4, background: 'white', borderRadius: 8,
                      border: '1px solid #e2e8f0', boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                      maxHeight: 200, overflowY: 'auto',
                    }}>
                      {agents.map(a => {
                        const logoUrl = a.logo ? (a.logo.startsWith('/') ? `${getApiBaseUrl()}${a.logo}` : a.logo) : null;
                        return (
                          <div key={a.id} onClick={() => {
                            setGroupAgentIds(prev => ({ ...prev, [g.id]: a.id }));
                            clearError('groupAgents');
                            setOpenDropdownGroupId(null);
                          }}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 8,
                            padding: '8px 12px', cursor: 'pointer', fontSize: "0.813rem",
                            background: groupAgentIds[g.id] === a.id ? '#eef2ff' : 'white',
                            transition: 'background 0.1s',
                          }}>
                            {logoUrl ? (
                              <img src={logoUrl} alt="" style={{ width: 20, height: 20, borderRadius: 4, objectFit: 'cover' }} />
                            ) : (
                              <div style={{ width: 20, height: 20, borderRadius: 4, background: 'linear-gradient(135deg, #667eea, #764ba2)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: "0.625rem", fontWeight: 700 }}>{a.name[0]}</div>
                            )}
                            <span>{a.name}</span>
                            {groupAgentIds[g.id] === a.id && (
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
            {classGroups.length > 0 && fieldErrors.groupAgents && <div style={{ fontSize: "0.75rem", color: '#ef4444', marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
              {fieldErrors.groupAgents}
            </div>}
          </div>
        )}

        {openDropdownGroupId && (
          <div onClick={() => setOpenDropdownGroupId(null)} style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 40 }} />
        )}

        {/* 标准/分组模式：选择AI智能体 */}
        {mode !== 'advanced' && (
          <div style={{
            background: '#fafbfc', borderRadius: 10, border: '1px solid #eef2f6',
            padding: '16px 20px', marginBottom: 20,
          }}>
            <div style={{ fontSize: "0.813rem", fontWeight: 600, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6, color: '#0f172a' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><rect x="4" y="4" width="16" height="16" rx="3" /><path d="M9 12h6" /><path d="M12 9v6" /></svg>
              选择AI智能体
            </div>
            {agents.length === 0 ? (
              <div style={{ padding: '14px 16px', background: '#f1f5f9', borderRadius: 8, fontSize: "0.813rem", color: '#94a3b8', textAlign: 'center' }}>
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
                        cursor: 'pointer', fontSize: "0.875rem", fontWeight: selectedAgentId === a.id ? 500 : 400,
                        transition: 'all 0.12s',
                      }}>
                      {logoUrl ? (
                        <img src={logoUrl} alt="" style={{ width: 22, height: 22, borderRadius: 5, objectFit: 'cover', flexShrink: 0 }} />
                      ) : (
                        <div style={{
                          width: 22, height: 22, borderRadius: 5,
                          background: 'linear-gradient(135deg, #667eea, #764ba2)',
                          color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: "0.688rem", fontWeight: 700, flexShrink: 0,
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
            {fieldErrors.agent && <div style={{ fontSize: "0.75rem", color: '#ef4444', marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
              {fieldErrors.agent}
            </div>}
          </div>
        )}

        {fieldErrors.submit && <div style={{ fontSize: "0.75rem", color: '#ef4444', marginBottom: 16, marginTop: -4, display: 'flex', alignItems: 'center', gap: 4 }}>
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
