'use client';

import { useState, useEffect, useRef } from 'react';
import { api } from '@/lib/api';
import { Toast } from '@/lib/components';

export default function ClassesPage() {
  const [classes, setClasses] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedClass, setSelectedClass] = useState<string | null>(null);
  const [students, setStudents] = useState<any[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [newClassName, setNewClassName] = useState('');
  const [editingClassName, setEditingClassName] = useState<string | null>(null);
  const [addStudentMode, setAddStudentMode] = useState<'form' | 'paste' | null>(null);
  const [tabMode, setTabMode] = useState<'students' | 'groups'>('students');
  const [classGroups, setClassGroups] = useState<any[]>([]);
  const [sortField, setSortField] = useState<'studentNo' | 'name' | 'group'>('studentNo');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [editingStudent, setEditingStudent] = useState<any | null>(null);
  const [selectedStudentIds, setSelectedStudentIds] = useState<Set<string>>(new Set());
  const [batchEditModal, setBatchEditModal] = useState<{ type: 'tag' } | null>(null);
  const [deleteBlocked, setDeleteBlocked] = useState<{
    classId: string;
    className: string;
    classrooms: { id: string; title: string; status: string }[];
  } | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  const loadClasses = async () => {
    try {
      const data = await api.getClasses();
      setClasses(data);
      // 自动选中第一个班级，避免右侧空白
      if (data.length > 0) {
        setSelectedClass(data[0].id);
      }
    } catch {}
    setLoading(false);
  };

  useEffect(() => { loadClasses(); }, []);

  useEffect(() => {
    loadStudents();
    loadGroups();
  }, [selectedClass]);

  const loadGroups = async () => {
    if (!selectedClass) { setClassGroups([]); return; }
    try {
      setClassGroups(await api.getGroups(selectedClass));
    } catch { setClassGroups([]); }
  };

  // 构建 studentId → groupName 映射
  const studentGroupMap = new Map<string, string>();
  for (const g of classGroups) {
    for (const sid of (g.studentIds || [])) {
      studentGroupMap.set(sid, g.name);
    }
  }
  const groupColorMap = new Map<string, number>();
  classGroups.forEach((g, i) => groupColorMap.set(g.name, i));

  const handleCreateClass = async () => {
    if (!newClassName) return;
    await api.createClass(newClassName);
    setNewClassName('');
    setShowCreate(false);
    loadClasses();
  };

  const handleRenameClass = async (id: string, name: string) => {
    if (!name.trim()) return;
    await api.updateClass(id, name.trim());
    setEditingClassName(null);
    loadClasses();
  };

  const handleDeleteClass = async (id: string) => {
    const cls = classes.find(c => c.id === id);
    if (!cls) return;
    // 先检查是否被课堂使用
    try {
      const usage = await api.checkClassUsage(id);
      if (usage.used) {
        setDeleteBlocked({ classId: id, className: cls.name, classrooms: usage.classrooms });
        return;
      }
    } catch {
      // 接口查不到时，直接降级为 confirm
    }
    if (!confirm('确定删除此班级及所有学生数据？')) return;
    try {
      await api.deleteClass(id);
      if (selectedClass === id) { setSelectedClass(null); setStudents([]); }
      loadClasses();
    } catch (e: any) {
      setDeleteBlocked({ classId: id, className: cls.name, classrooms: [{ id: '', title: e.message, status: '' }] });
    }
  };

  const selectedClassData = classes.find(c => c.id === selectedClass);

  const loadStudents = async () => {
    if (!selectedClass) return;
    const data = await api.getStudents(selectedClass);
    setStudents(data);
  };

  const handleSort = (field: 'studentNo' | 'name' | 'group') => {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const sortedStudents = [...students].sort((a, b) => {
    let cmp = 0;
    if (sortField === 'studentNo') {
      cmp = (parseInt(a.studentNo) || 0) - (parseInt(b.studentNo) || 0);
    } else if (sortField === 'name') {
      cmp = a.name.localeCompare(b.name, 'zh-CN');
    } else if (sortField === 'group') {
      const ga = studentGroupMap.get(a.id);
      const gb = studentGroupMap.get(b.id);
      if (!ga && !gb) cmp = 0;
      else if (!ga) cmp = 1; // 未分组始终排最后
      else if (!gb) cmp = -1;
      else cmp = ga.localeCompare(gb, 'zh-CN');
    }
    return sortDir === 'asc' ? cmp : -cmp;
  });

  const SortIcon = ({ field }: { field: 'studentNo' | 'name' | 'group' }) => (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
      stroke={sortField === field ? '#2563eb' : '#cbd5e1'}
      strokeWidth="2" strokeLinecap="round" style={{ flexShrink: 0 }}>
      {sortField === field && sortDir === 'asc' ? (
        <polyline points="18 15 12 9 6 15" />
      ) : (
        <polyline points="6 9 12 15 18 9" />
      )}
    </svg>
  );

  return (
    <div>
      {/* 页面标题 */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, color: '#0f172a' }}>班级管理</h1>
            <p style={{ color: '#64748b', fontSize: 13, marginTop: 4 }}>
              管理班级和学生名单，支持批量导入
            </p>
          </div>
          <button className="btn btn-primary" onClick={() => setShowCreate(true)}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
            创建班级
          </button>
        </div>
      </div>

      {/* 创建班级弹窗 */}
      {showCreate && (
        <div className="modal-overlay" onClick={() => setShowCreate(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 400, padding: 28 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
              <div style={{
                width: 40, height: 40, borderRadius: 10,
                background: '#eef2ff', color: '#2563eb',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /></svg>
              </div>
              <div>
                <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>创建班级</h2>
                <p style={{ fontSize: 12, color: '#64748b', margin: '2px 0 0' }}>输入新班级名称</p>
              </div>
            </div>
            <input className="input" value={newClassName} onChange={e => setNewClassName(e.target.value)}
              placeholder="如：三年级一班" onKeyDown={e => e.key === 'Enter' && handleCreateClass()} autoFocus />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
              <button className="btn btn-secondary" onClick={() => setShowCreate(false)}>取消</button>
              <button className="btn btn-primary" onClick={handleCreateClass}>创建</button>
            </div>
          </div>
        </div>
      )}

      {/* 主体内容 */}
      <div style={{ display: 'flex', gap: 24 }}>
        {/* 班级列表 */}
        <div style={{ width: 260, flexShrink: 0 }}>
          {loading ? (
            <div style={{ padding: 20, color: '#94a3b8', textAlign: 'center', fontSize: 13 }}>加载中...</div>
          ) : classes.length === 0 ? (
            <div style={{
              background: 'white', borderRadius: 14, border: '1px solid #e2e8f0',
              textAlign: 'center', padding: '48px 20px',
            }}>
              <div style={{
                width: 52, height: 52, borderRadius: 14,
                background: '#f1f5f9', margin: '0 auto 12px',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
                </svg>
              </div>
              <p style={{ fontSize: 15, fontWeight: 600, color: '#0f172a', margin: '0 0 4px' }}>暂无班级</p>
              <p style={{ fontSize: 13, color: '#94a3b8', margin: '0 0 16px' }}>创建班级后即可添加学生</p>
              <button className="btn btn-primary" style={{ fontSize: 13 }} onClick={() => setShowCreate(true)}>
                创建第一个班级
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {classes.map(c => (
                <div key={c.id}
                  onClick={() => setSelectedClass(c.id)}
                  style={{
                    padding: '13px 16px', borderRadius: 12, cursor: 'pointer',
                    border: `1.5px solid ${selectedClass === c.id ? '#2563eb' : '#e2e8f0'}`,
                    background: selectedClass === c.id ? '#f8faff' : 'white',
                    boxShadow: selectedClass === c.id
                      ? '0 1px 4px rgba(37,99,235,0.08)'
                      : '0 1px 3px rgba(0,0,0,0.03)',
                    transition: 'all 0.15s ease',
                    position: 'relative',
                    overflow: 'hidden',
                  }}
                  onMouseEnter={e => {
                    if (selectedClass !== c.id) {
                      e.currentTarget.style.borderColor = '#cbd5e1';
                      e.currentTarget.style.background = '#fafbfc';
                      e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.05)';
                    }
                  }}
                  onMouseLeave={e => {
                    if (selectedClass !== c.id) {
                      e.currentTarget.style.borderColor = '#e2e8f0';
                      e.currentTarget.style.background = 'white';
                      e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.03)';
                    }
                  }}>
                  {/* 选中指示条 */}
                  {selectedClass === c.id && (
                    <div style={{
                      position: 'absolute', left: 0, top: 0, bottom: 0,
                      width: 3, background: '#2563eb',
                      borderRadius: '0 2px 2px 0',
                    }} />
                  )}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{
                      width: 28, height: 28, borderRadius: '50%',
                      background: selectedClass === c.id ? '#eef2ff' : '#f1f5f9',
                      color: selectedClass === c.id ? '#2563eb' : '#64748b',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 13, fontWeight: 600, flexShrink: 0,
                    }}>
                      {c.name[0]}
                    </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ marginBottom: 4 }}>
                      {editingClassName === c.id ? (
                        <input className="input" defaultValue={c.name} autoFocus
                          onBlur={e => { handleRenameClass(c.id, e.target.value); }}
                          onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setEditingClassName(null); }}
                          style={{ width: '100%', fontSize: 13, fontWeight: 600 }}
                          onClick={e => e.stopPropagation()}
                        />
                      ) : (
                        <div style={{
                          display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer',
                        }}
                          onClick={e => { e.stopPropagation(); setEditingClassName(c.id); }}>
                          <span style={{
                            fontWeight: 600,
                            fontSize: selectedClass === c.id ? 16 : 15,
                            color: '#0f172a',
                          }}>{c.name}</span>
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
                            strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
                            style={{ flexShrink: 0, stroke: '#cbd5e1', transition: 'stroke 0.12s' }}
                            onMouseEnter={e => e.currentTarget.style.stroke = '#2563eb'}
                            onMouseLeave={e => e.currentTarget.style.stroke = '#cbd5e1'}>
                            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
                            <path d="M14 6l4 4" />
                          </svg>
                        </div>
                      )}
                    </div>
                      <div style={{
                        fontSize: 12, color: '#94a3b8',
                        display: 'flex', alignItems: 'center', gap: 12,
                      }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /></svg>
                          {c._count?.students || 0} 人
                        </span>
                        {(c._count?.groups ?? 0) > 0 && (
                          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><rect x="8" y="2" width="8" height="4" rx="1" /><path d="M2 12h20" /><path d="M4 7v10" /><path d="M20 7v10" /><rect x="4" y="17" width="16" height="4" rx="1" /></svg>
                            {c._count?.groups || 0} 个分组
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div style={{
                    marginTop: 8, paddingTop: 8, borderTop: '1px solid #eef2f6',
                    display: 'flex', justifyContent: 'flex-end',
                    minHeight: 32,
                    visibility: selectedClass === c.id ? 'visible' : 'hidden',
                  }}>
                    <button
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 4,
                        padding: '4px 10px', borderRadius: 6,
                        fontSize: 12, fontWeight: 500,
                        color: '#94a3b8', border: '1px solid transparent',
                        background: 'transparent', cursor: 'pointer',
                        transition: 'all 0.12s',
                      }}
                      onMouseEnter={e => {
                        e.currentTarget.style.color = '#ef4444';
                        e.currentTarget.style.borderColor = '#fca5a5';
                        e.currentTarget.style.background = '#fef2f2';
                      }}
                      onMouseLeave={e => {
                        e.currentTarget.style.color = '#94a3b8';
                        e.currentTarget.style.borderColor = 'transparent';
                        e.currentTarget.style.background = 'transparent';
                      }}
                      onClick={(e) => { e.stopPropagation(); handleDeleteClass(c.id); }}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                      </svg>
                      删除此班级
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 删除被阻止的浮动弹窗 */}
        {deleteBlocked && (
          <>
            <div className="modal-overlay" onClick={() => setDeleteBlocked(null)} />
            <div className="modal-content" onClick={e => e.stopPropagation()} style={{
              position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
              zIndex: 201, background: 'white', borderRadius: 16, padding: 32,
              width: 420, maxWidth: '90vw', boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
            }}>
              <div style={{ textAlign: 'center', marginBottom: 20 }}>
                <div style={{
                  width: 52, height: 52, borderRadius: '50%',
                  background: '#fef2f2', margin: '0 auto 12px',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round">
                    <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                  </svg>
                </div>
                <h3 style={{ fontSize: 17, fontWeight: 700, margin: '0 0 4px' }}>无法删除班级</h3>
                <p style={{ fontSize: 13, color: '#64748b', margin: 0 }}>
                  该班级正在被以下课堂使用中，请先删除关联的课堂后再试。
                </p>
              </div>
              <div style={{
                background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10,
                padding: '12px 16px', marginBottom: 16,
              }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#991b1b', marginBottom: 8 }}>
                  「{deleteBlocked.className}」关联的课堂：
                </div>
                {deleteBlocked.classrooms.map((cr, i) => (
                  <div key={i} style={{
                    fontSize: 13, color: '#b91c1c', padding: '4px 0',
                    display: 'flex', alignItems: 'center', gap: 6,
                  }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <rect x="3" y="3" width="18" height="18" rx="2" /><line x1="3" y1="9" x2="21" y2="9" /><line x1="9" y1="21" x2="9" y2="9" />
                    </svg>
                    {cr.title}
                    <span style={{
                      fontSize: 11, padding: '1px 6px', borderRadius: 4,
                      background: cr.status === 'active' ? '#dcfce7' : cr.status === 'paused' ? '#fef3c7' : '#f1f5f9',
                      color: cr.status === 'active' ? '#16a34a' : cr.status === 'paused' ? '#d97706' : '#94a3b8',
                      marginLeft: 'auto',
                    }}>
                      {cr.status === 'active' ? '进行中' : cr.status === 'paused' ? '已暂停' : '已结束'}
                    </span>
                  </div>
                ))}
              </div>
              <button className="btn btn-primary btn-lg" style={{ width: '100%' }}
                onClick={() => setDeleteBlocked(null)}>
                知道了
              </button>
            </div>
          </>
        )}

        {/* 学生列表 / 分组管理 */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {selectedClass ? (
            <div style={{ background: 'white', borderRadius: 14, border: '1px solid #e2e8f0', overflow: 'hidden' }}>
              {/* 头部：班级概览区块 */}
              <div style={{
                padding: '20px 20px 0',
                background: 'linear-gradient(135deg, #f8faff 0%, #ffffff 100%)',
                borderBottom: '1px solid #eef2f6',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{
                      width: 42, height: 42, borderRadius: 12,
                      background: 'linear-gradient(135deg, #2563eb, #7c3aed)',
                      color: 'white',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontWeight: 700, fontSize: 18, flexShrink: 0,
                    }}>
                      {selectedClassData?.name?.[0] || '班'}
                    </div>
                    <div>
                      <h2 style={{ fontSize: 17, fontWeight: 700, margin: 0, color: '#0f172a' }}>
                        {selectedClassData?.name || '班级'}
                      </h2>
                      <p style={{ fontSize: 12, color: '#64748b', margin: '1px 0 0' }}>
                        创建于 {selectedClassData?.createdAt ? new Date(selectedClassData.createdAt).toLocaleDateString('zh-CN') : '-'}
                      </p>
                    </div>
                  </div>
                </div>

                {/* 快捷统计 */}
                <div style={{
                  display: 'flex', gap: 0, marginBottom: 16,
                  padding: '16px 0', background: '#f8fafc', borderRadius: 10,
                  border: '1px solid #eef2f6',
                }}>
                  {[
                    { label: '学生人数', value: students.length, icon: 'users', color: '#2563eb' },
                    { label: '分组数量', value: classGroups.length, icon: 'grid', color: '#8b5cf6' },
                    { label: '已分组', value: students.filter(s => studentGroupMap.has(s.id)).length, icon: 'check', color: '#10b981' },
                    { label: '未分组', value: students.filter(s => !studentGroupMap.has(s.id)).length, icon: 'minus', color: selectedClassData?._count?.groups > 0 ? '#f59e0b' : '#94a3b8' },
                  ].map((stat, i) => (
                    <div key={i} style={{
                      flex: 1, display: 'flex', flexDirection: 'column',
                      alignItems: 'center', gap: 6,
                      borderRight: i < 3 ? '1px solid #e2e8f0' : 'none',
                    }}>
                      <div style={{
                        width: 32, height: 32, borderRadius: 10,
                        background: `${stat.color}12`,
                        color: stat.color,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        {stat.icon === 'users' ? (
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /></svg>
                        ) : stat.icon === 'grid' ? (
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /></svg>
                        ) : stat.icon === 'check' ? (
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12" /></svg>
                        ) : (
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="5" y1="12" x2="19" y2="12" /></svg>
                        )}
                      </div>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: 18, fontWeight: 700, color: '#0f172a', lineHeight: 1.2 }}>
                          {stat.value}
                        </div>
                        <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>{stat.label}</div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* 标签页切换 */}
                <div style={{ display: 'flex', gap: 0, marginBottom: 0 }}>
                  {[
                    { key: 'students' as const, label: '学生列表', icon: 'users' },
                    { key: 'groups' as const, label: '分组管理', icon: 'grid' },
                  ].map(t => (
                    <button key={t.key} onClick={() => setTabMode(t.key)}
                      style={{
                        padding: '8px 16px', fontSize: 13, fontWeight: tabMode === t.key ? 600 : 400,
                        color: tabMode === t.key ? '#2563eb' : '#64748b',
                        background: 'transparent', border: 'none', cursor: 'pointer',
                        borderBottom: `2px solid ${tabMode === t.key ? '#2563eb' : 'transparent'}`,
                        marginBottom: -1, transition: 'all 0.12s',
                        display: 'flex', alignItems: 'center', gap: 6,
                      }}>
                      {t.key === 'students' ? (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /></svg>
                      ) : (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /></svg>
                      )}
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* 学生列表模式下的操作按钮 / 批量操作栏 */}
              {tabMode === 'students' && (
                <div style={{ display: 'flex', gap: 8, padding: '10px 20px 14px', alignItems: 'center' }}>
                  {selectedStudentIds.size > 0 ? (
                    <>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2" strokeLinecap="round"><polyline points="20 6 9 17 4 12" /></svg>
                      <span style={{ fontWeight: 600, color: '#1e40af', fontSize: 13 }}>
                        已选 {selectedStudentIds.size} 名学生
                      </span>
                      <div style={{ flex: 1 }} />
                      <button onClick={() => setBatchEditModal({ type: 'tag' })} style={{ padding: '8px 20px', borderRadius: 6, fontSize: 12, fontWeight: 500, background: 'white', color: '#2563eb', border: '1px solid #bfdbfe', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                        批量修改标签
                      </button>
                      <button onClick={async () => { const count = selectedStudentIds.size; if (!confirm(`确定删除选中的 ${count} 名学生？此操作不可撤销。`)) return; for (const sid of selectedStudentIds) { await api.deleteStudent(selectedClass, sid); } setSelectedStudentIds(new Set()); loadStudents(); }} style={{ padding: '8px 20px', borderRadius: 6, fontSize: 12, fontWeight: 500, background: 'white', color: '#ef4444', border: '1px solid #fca5a5', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                        批量删除
                      </button>
                      <button onClick={() => setSelectedStudentIds(new Set())} style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 12, color: '#64748b', textDecoration: 'underline', textUnderlineOffset: 2 }}>
                        取消选择
                      </button>
                    </>
                  ) : (
                    <>
                      <button className="btn btn-secondary" style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}
                        onClick={() => setAddStudentMode(addStudentMode === 'form' ? null : 'form')}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                        逐个添加
                      </button>
                      <button className="btn btn-primary" style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}
                        onClick={() => setAddStudentMode(addStudentMode === 'paste' ? null : 'paste')}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><rect x="3" y="3" width="18" height="18" rx="2" /><line x1="3" y1="9" x2="21" y2="9" /><line x1="9" y1="21" x2="9" y2="9" /></svg>
                        粘贴名单
                      </button>
                    </>
                  )}
                </div>
              )}

              {/* 添加学生区域 */}
              {addStudentMode === 'form' && (
                <div style={{
                  padding: '14px 20px', background: '#f8fafc',
                  borderBottom: '1px solid #eef2f6',
                }}>
                  <AddStudentForm classId={selectedClass} onClose={() => setAddStudentMode(null)}
                    onAdded={() => { setAddStudentMode(null); loadStudents(); }} />
                </div>
              )}
              {addStudentMode === 'paste' && (
                <div style={{
                  padding: '14px 20px', background: '#f8fafc',
                  borderBottom: '1px solid #eef2f6',
                }}>
                  <PasteStudentNames classId={selectedClass} onClose={() => setAddStudentMode(null)}
                    onAdded={() => { setAddStudentMode(null); loadStudents(); }} setToast={setToast} />
                </div>
              )}

              {/* 内容区域 */}
              {tabMode === 'students' ? (
                <div style={{ padding: 0 }}>
                  {students.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '48px 20px' }}>
                      <div style={{
                        width: 44, height: 44, borderRadius: 11,
                        background: '#f1f5f9', margin: '0 auto 10px',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
                      </div>
                      <p style={{ fontSize: 14, fontWeight: 600, color: '#0f172a', margin: '0 0 4px' }}>暂无学生</p>
                      <p style={{ fontSize: 13, color: '#94a3b8', margin: '0 0 16px' }}>点击上方按钮添加学生名单</p>
                    </div>
                  ) : (
                    <table>
                      <thead>
                        <tr style={{ background: '#f8fafc' }}>
                          <th style={{ width: 40, textAlign: 'center', padding: '10px 8px', fontSize: 12, borderBottom: '2px solid #e2e8f0' }}>
                            <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', width: '100%' }}>
                              <input type="checkbox"
                                checked={selectedStudentIds.size === sortedStudents.length && sortedStudents.length > 0}
                                onChange={(e) => { if (e.target.checked) { setSelectedStudentIds(new Set(sortedStudents.map(s => s.id))); } else { setSelectedStudentIds(new Set()); } }}
                                style={{ width: 15, height: 15, cursor: 'pointer' }} />
                            </label>
                          </th>
                          <th onClick={() => handleSort('studentNo')}
                            style={{
                              width: 70, textAlign: 'center', cursor: 'pointer', userSelect: 'none',
                              padding: '10px 12px', fontSize: 12, fontWeight: 600, color: '#475569',
                              borderBottom: '2px solid #e2e8f0', letterSpacing: '0.02em',
                            }}
                            onMouseEnter={e => e.currentTarget.style.color = '#2563eb'}
                            onMouseLeave={e => e.currentTarget.style.color = '#475569'}>
                            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                              学号 <SortIcon field="studentNo" />
                            </div>
                          </th>
                          <th onClick={() => handleSort('name')}
                            style={{
                              cursor: 'pointer', userSelect: 'none',
                              padding: '10px 12px', fontSize: 12, fontWeight: 600, color: '#475569',
                              borderBottom: '2px solid #e2e8f0', letterSpacing: '0.02em',
                            }}
                            onMouseEnter={e => e.currentTarget.style.color = '#2563eb'}
                            onMouseLeave={e => e.currentTarget.style.color = '#475569'}>
                            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                              姓名 <SortIcon field="name" />
                            </div>
                          </th>
                          <th onClick={() => handleSort('group')}
                            style={{
                              cursor: 'pointer', userSelect: 'none',
                              padding: '10px 12px', fontSize: 12, fontWeight: 600, color: '#475569',
                              borderBottom: '2px solid #e2e8f0', letterSpacing: '0.02em',
                            }}
                            onMouseEnter={e => e.currentTarget.style.color = '#2563eb'}
                            onMouseLeave={e => e.currentTarget.style.color = '#475569'}>
                            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                              分组 <SortIcon field="group" />
                            </div>
                          </th>
                          <th style={{
                            width: 100, textAlign: 'center',
                            padding: '10px 12px', fontSize: 12, fontWeight: 600, color: '#475569',
                            borderBottom: '2px solid #e2e8f0', letterSpacing: '0.02em',
                          }}>标签</th>
                          <th style={{
                            width: 140, textAlign: 'center',
                            padding: '10px 12px', fontSize: 12, fontWeight: 600, color: '#475569',
                            borderBottom: '2px solid #e2e8f0', letterSpacing: '0.02em',
                          }}>操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sortedStudents.map((s) => (
                          <tr key={s.id}>
                            <td style={{ textAlign: 'center', padding: '10px 8px' }}>
                              <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', width: '100%' }}>
                                <input type="checkbox"
                                  checked={selectedStudentIds.has(s.id)}
                                  onChange={() => { setSelectedStudentIds(prev => { const next = new Set(prev); if (next.has(s.id)) next.delete(s.id); else next.add(s.id); return next; }); }}
                                  style={{ width: 15, height: 15, cursor: 'pointer' }} />
                              </label>
                            </td>
                            <td style={{ textAlign: 'center', color: s.studentNo ? '#2563eb' : '#cbd5e1', fontSize: 13, fontWeight: 600, fontFamily: 'monospace' }}>
                              {s.studentNo || '-'}
                            </td>
                            <td style={{ fontWeight: 500, display: 'flex', alignItems: 'center', gap: 8 }}>
                              <div style={{
                                width: 28, height: 28, borderRadius: '50%',
                                background: '#eef2ff', color: '#2563eb',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                fontSize: 12, fontWeight: 600,
                              }}>
                                {s.name[0]}
                              </div>
                              {s.name}
                            </td>
                            <td>
                              {(() => {
                                const groupName = studentGroupMap.get(s.id);
                                if (!groupName) return <span style={{ color: '#e2e8f0', fontSize: 12 }}>-</span>;
                                const ci = groupColorMap.get(groupName) ?? 0;
                                const color = GROUP_COLORS[ci % GROUP_COLORS.length];
                                return (
                                  <span style={{
                                    padding: '1px 8px', borderRadius: 4,
                                    background: color.bg, color: color.text,
                                    fontSize: 12, fontWeight: 500,
                                    border: `1px solid ${color.border}`,
                                  }}>
                                    {groupName}
                                  </span>
                                );
                              })()}
                            </td>
                            <td style={{ textAlign: 'center' }}>
                              {s.tag ? (
                                <span style={{
                                  padding: '1px 7px', borderRadius: 4,
                                  background: '#fef3c7', color: '#92400e',
                                  fontSize: 12,
                                }}>
                                  {s.tag}
                                </span>
                              ) : (
                                <span style={{ color: '#e2e8f0', fontSize: 12 }}>-</span>
                              )}
                            </td>
                            <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                              <button onClick={() => setEditingStudent(s)}
                                style={{
                                  background: 'transparent', border: 'none', cursor: 'pointer',
                                  fontSize: 12, color: '#2563eb', padding: '4px 8px', borderRadius: 6,
                                }}
                                onMouseEnter={e => { e.currentTarget.style.background = '#eef2ff'; }}
                                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}>
                                编辑
                              </button>
                              <button style={{
                                background: 'transparent', border: 'none', cursor: 'pointer',
                                fontSize: 12, color: '#ef4444', padding: '4px 8px', borderRadius: 6,
                              }}
                                onMouseEnter={e => e.currentTarget.style.background = '#fef2f2'}
                                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                                onClick={async () => {
                                  if (confirm(`确定删除 ${s.name}？`)) {
                                    await api.deleteStudent(selectedClass, s.id);
                                    loadStudents();
                                  }
                                }}>
                                删除
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              ) : (
                <GroupManagement classId={selectedClass} students={students} onChanged={() => { loadStudents(); loadGroups(); }} />
              )}

              {/* 批量编辑标签弹窗 */}
              {batchEditModal && (
                <BatchEditTagModal
                  classId={selectedClass}
                  studentIds={[...selectedStudentIds]}
                  studentNames={sortedStudents.filter(s => selectedStudentIds.has(s.id)).map(s => s.name)}
                  onClose={() => setBatchEditModal(null)}
                  onSaved={() => { setBatchEditModal(null); setSelectedStudentIds(new Set()); loadStudents(); }}
                  setToast={setToast}
                />
              )}

              {/* 编辑学生弹窗 */}
              {editingStudent && (
                <EditStudentModal
                  student={editingStudent}
                  classId={selectedClass}
                  onClose={() => setEditingStudent(null)}
                  onSaved={() => { setEditingStudent(null); loadStudents(); }}
                  setToast={setToast}
                />
              )}
            </div>
          ) : (
            <div style={{
              background: 'white', borderRadius: 14, border: '1px solid #e2e8f0',
              textAlign: 'center', padding: '60px 20px',
            }}>
              <div style={{
                width: 52, height: 52, borderRadius: 14,
                background: '#f1f5f9', margin: '0 auto 12px',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round">
                  <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </div>
              <p style={{ fontSize: 15, fontWeight: 600, color: '#0f172a', margin: '0 0 4px' }}>选择一个班级</p>
              <p style={{ fontSize: 13, color: '#94a3b8', margin: 0 }}>从左侧选择班级后即可管理学生名单</p>
            </div>
          )}
        </div>
      </div>
      {toast && <Toast msg={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}

function AddStudentForm({ classId, onClose, onAdded }: { classId: string; onClose: () => void; onAdded: () => void }) {
  const [name, setName] = useState('');

  const handleAdd = async () => {
    if (!name) return;
    await api.addStudent(classId, { name });
    onAdded();
  };

  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
      <div style={{ flex: 1 }}>
        <label style={{ fontSize: 11, color: '#64748b', marginBottom: 3, display: 'block' }}>姓名 *</label>
        <input className="input" value={name} onChange={e => setName(e.target.value)}
          placeholder="学生姓名" style={{ fontSize: 13 }} />
      </div>
      <button className="btn btn-primary" onClick={handleAdd}
        style={{ height: 38, display: 'flex', alignItems: 'center', gap: 4 }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
        添加
      </button>
      <button className="btn btn-ghost" onClick={onClose} style={{ height: 38 }}>取消</button>
    </div>
  );
}

function PasteStudentNames({ classId, onClose, onAdded, setToast }: { classId: string; onClose: () => void; onAdded: () => void; setToast: (t: { msg: string; type: 'success' | 'error' } | null) => void }) {
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);

  const names = text.split('\n').map(s => s.trim()).filter(Boolean);

  const handleSubmit = async () => {
    if (names.length === 0) return;
    setSaving(true);
    try {
      await api.batchCreateStudentsFromNames(classId, names);
      onAdded();
    } catch (e: any) {
      setToast({ msg: '创建失败: ' + e.message, type: 'error' });
    }
    setSaving(false);
  };

  return (
    <div>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        marginBottom: 10,
      }}>
        <div style={{
          width: 28, height: 28, borderRadius: 7,
          background: '#eef2ff', color: '#2563eb',
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <rect x="3" y="3" width="18" height="18" rx="2" /><line x1="3" y1="9" x2="21" y2="9" /><line x1="9" y1="21" x2="9" y2="9" />
          </svg>
        </div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }}>粘贴名单</div>
          <div style={{ fontSize: 11, color: '#64748b' }}>每行一个姓名，系统自动分配学号</div>
        </div>
      </div>

      <textarea
        className="input"
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder={`张三\n李四\n王五\n赵六`}
        style={{
          height: 100, resize: 'vertical', fontSize: 13,
          fontFamily: 'monospace', lineHeight: 1.7,
        }}
      />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
        <div style={{
          fontSize: 12, color: names.length > 0 ? '#2563eb' : '#94a3b8',
          fontWeight: names.length > 0 ? 600 : 400,
        }}>
          共识别 {names.length} 名学生
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-ghost" onClick={onClose} style={{ fontSize: 12 }}>取消</button>
          <button className="btn btn-primary" onClick={handleSubmit} disabled={saving || names.length === 0}
            style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
            {saving ? '创建中...' : (
              <>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12" /></svg>
                确认创建
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

function EditStudentModal({ student, classId, onClose, onSaved, setToast }: {
  student: any; classId: string; onClose: () => void; onSaved: () => void; setToast: (t: { msg: string; type: 'success' | 'error' } | null) => void;
}) {
  const [name, setName] = useState(student.name || '');
  const [studentNo, setStudentNo] = useState(student.studentNo || '');
  const [tag, setTag] = useState(student.tag || '');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await api.updateStudent(classId, student.id, { name: name.trim(), studentNo: studentNo || undefined, tag: tag.trim() || undefined });
      onSaved();
    } catch (e: any) {
      setToast({ msg: '更新失败: ' + e.message, type: 'error' });
    }
    setSaving(false);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 400, padding: 28 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
          <div style={{
            width: 40, height: 40, borderRadius: 10,
            background: '#eef2ff', color: '#2563eb',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
          </div>
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>编辑学生</h2>
            <p style={{ fontSize: 12, color: '#64748b', margin: '2px 0 0' }}>修改学生信息</p>
          </div>
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 12, color: '#64748b', marginBottom: 4, display: 'block' }}>学号</label>
          <input className="input" value={studentNo} onChange={e => setStudentNo(e.target.value)}
            placeholder="不填则自动生成" />
        </div>

        <div style={{ marginBottom: 20 }}>
          <label style={{ fontSize: 12, color: '#64748b', marginBottom: 4, display: 'block' }}>姓名 *</label>
          <input className="input" value={name} onChange={e => setName(e.target.value)}
            placeholder="学生姓名" onKeyDown={e => e.key === 'Enter' && handleSave()} autoFocus />
        </div>

        <div style={{ marginBottom: 20 }}>
          <label style={{ fontSize: 12, color: '#64748b', marginBottom: 4, display: 'block' }}>标签</label>
          <input className="input" value={tag} onChange={e => setTag(e.target.value)}
            placeholder="如：组长、课代表" />
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn btn-secondary" onClick={onClose}>取消</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving || !name.trim()}>
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}

function BatchEditTagModal({ classId, studentIds, studentNames, onClose, onSaved, setToast }: {
  classId: string; studentIds: string[]; studentNames: string[]; onClose: () => void; onSaved: () => void; setToast: (t: { msg: string; type: 'success' | 'error' } | null) => void;
}) {
  const [tag, setTag] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      const tagValue = tag.trim() || null;
      for (const sid of studentIds) {
        await api.updateStudent(classId, sid, { tag: tagValue });
      }
      onSaved();
    } catch (e: any) {
      setToast({ msg: '批量更新失败: ' + e.message, type: 'error' });
    }
    setSaving(false);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 420, padding: 28 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: '#eef2ff', color: '#2563eb', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
          </div>
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>批量修改标签</h2>
            <p style={{ fontSize: 12, color: '#64748b', margin: '2px 0 0' }}>
              已选中 {studentIds.length} 名学生：{studentNames.join('、')}
            </p>
          </div>
        </div>
        <div style={{ marginBottom: 20 }}>
          <label style={{ fontSize: 12, color: '#64748b', marginBottom: 4, display: 'block' }}>标签</label>
          <input className="input" value={tag} onChange={e => setTag(e.target.value)}
            placeholder="输入标签，如：组长、课代表"
            onKeyDown={e => e.key === 'Enter' && handleSave()} autoFocus />
          <p style={{ fontSize: 11, color: '#94a3b8', marginTop: 6, lineHeight: 1.5 }}>
            留空则清空选中学生的标签。
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn btn-secondary" onClick={onClose}>取消</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? '保存中...' : (tag.trim() ? `应用标签 (${studentIds.length} 人)` : `清空标签 (${studentIds.length} 人)`)}
          </button>
        </div>
      </div>
    </div>
  );
}

const GROUP_COLORS = [
  { bg: '#eef2ff', border: '#c7d2fe', text: '#3730a3', badge: '#6366f1', light: '#e0e7ff' },
  { bg: '#f0fdf4', border: '#bbf7d0', text: '#166534', badge: '#22c55e', light: '#dcfce7' },
  { bg: '#fefce8', border: '#fef08a', text: '#854d0e', badge: '#eab308', light: '#fef9c3' },
  { bg: '#fef2f2', border: '#fecaca', text: '#991b1b', badge: '#ef4444', light: '#fee2e2' },
  { bg: '#f5f3ff', border: '#ddd6fe', text: '#4c1d95', badge: '#8b5cf6', light: '#ede9fe' },
  { bg: '#ecfeff', border: '#a5f3fc', text: '#155e75', badge: '#06b6d4', light: '#cffafe' },
];

function GroupManagement({ classId, students, onChanged }: {
  classId: string; students: any[]; onChanged: () => void;
}) {
  const [groups, setGroups] = useState<any[]>([]);
  const [newGroupName, setNewGroupName] = useState('');
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState<string | null>(null);
  const [selectedUnassigned, setSelectedUnassigned] = useState<Set<string>>(new Set());
  const [marqueeRect, setMarqueeRect] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const marqueeStartRef = useRef<{ x: number; y: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const loadGroups = () => {
    api.getGroups(classId).then(setGroups);
  };

  useEffect(() => { loadGroups(); }, [classId]);
  useEffect(() => { loadGroups(); }, [students.length]);

  const assignedIds = new Set(groups.flatMap(g => g.studentIds || []));
  const unassigned = [...students].filter(s => !assignedIds.has(s.id))
    .sort((a, b) => (parseInt(a.studentNo) || 0) - (parseInt(b.studentNo) || 0));

  const handleDragStart = (e: React.DragEvent, studentId: string, isUnassigned = false) => {
    e.dataTransfer.effectAllowed = 'move';

    if (isUnassigned && selectedUnassigned.size > 0 && selectedUnassigned.has(studentId)) {
      // 多选模式：拖拽时携带所有选中学生的 ID
      e.dataTransfer.setData('text/plain', JSON.stringify({ multi: true, ids: [...selectedUnassigned] }));
      setDraggedId(studentId);
    } else {
      // 单选模式
      e.dataTransfer.setData('text/plain', JSON.stringify({ multi: false, ids: [studentId] }));
      setDraggedId(studentId);
    }
  };

  const handleDrop = async (e: React.DragEvent, targetGroupId: string | null) => {
    e.preventDefault();
    const raw = e.dataTransfer.getData('text/plain');
    if (!raw) return;
    setDraggedId(null);

    // 解析拖拽数据（支持单人和多人）
    let ids: string[];
    try {
      const parsed = JSON.parse(raw);
      ids = parsed.ids;
    } catch {
      ids = [raw];
    }

    // 收集每个来源组中需要移除的学生
    const removals: Record<string, string[]> = {};
    for (const g of groups) {
      const toRemove = g.studentIds.filter((id: string) => ids.includes(id));
      if (toRemove.length > 0) {
        removals[g.id] = toRemove;
      }
    }

    let needsUpdate = false;

    // 从非目标组中批量移除学生
    for (const [gid, toRemove] of Object.entries(removals)) {
      if (gid !== targetGroupId) {
        const group = groups.find(g => g.id === gid);
        if (group) {
          await api.updateGroup(classId, gid, {
            studentIds: group.studentIds.filter((id: string) => !toRemove.includes(id)),
          });
          needsUpdate = true;
        }
      }
    }

    // 批量添加到目标组
    if (targetGroupId) {
      const targetGroup = groups.find(g => g.id === targetGroupId);
      if (targetGroup) {
        const existing = new Set(targetGroup.studentIds);
        const toAdd = ids.filter(id => !existing.has(id));
        if (toAdd.length > 0) {
          await api.updateGroup(classId, targetGroupId, {
            studentIds: [...targetGroup.studentIds, ...toAdd],
          });
          needsUpdate = true;
        }
      }
    }

    if (needsUpdate) { loadGroups(); onChanged?.(); }
    setSelectedUnassigned(new Set());
  };

  const handleCreateGroup = async () => {
    if (!newGroupName.trim()) return;
    await api.createGroup(classId, newGroupName.trim());
    setNewGroupName('');
    loadGroups();
    onChanged?.();
  };

  const handleDeleteGroup = async (groupId: string) => {
    if (!confirm('确定删除此分组？组内学生不会被删除，但会回到未分配状态。')) return;
    await api.deleteGroup(classId, groupId);
    loadGroups();
    onChanged?.();
  };

  const handleRenameGroup = async (groupId: string, name: string) => {
    if (!name.trim()) return;
    await api.updateGroup(classId, groupId, { name: name.trim() });
    loadGroups();
    onChanged?.();
  };

  const handleRemoveAllStudents = async (groupId: string) => {
    const group = groups.find(g => g.id === groupId);
    if (!group || !group.studentIds?.length) return;
    if (!confirm(`确定移除「${group.name}」中的所有学生？学生不会被删除。`)) return;
    await api.updateGroup(classId, groupId, { studentIds: [] });
    loadGroups();
    onChanged?.();
  };

  // 鼠标框选
  const marqueeListenersRef = useRef<(() => void) | null>(null);
  useEffect(() => () => marqueeListenersRef.current?.(), []);

  const handleContainerMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    // 不要在学生标签或交互元素上启动框选
    if (target.closest('[data-student-id]') || target.closest('button, input, textarea, a')) return;

    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const x = e.clientX - rect.left + containerRef.current!.scrollLeft;
    const y = e.clientY - rect.top + containerRef.current!.scrollTop;
    marqueeStartRef.current = { x, y };

    const onMove = (ev: MouseEvent) => {
      if (!containerRef.current || !marqueeStartRef.current) return;
      const cr = containerRef.current.getBoundingClientRect();
      const cx = ev.clientX - cr.left + containerRef.current.scrollLeft;
      const cy = ev.clientY - cr.top + containerRef.current.scrollTop;
      setMarqueeRect({
        left: Math.min(marqueeStartRef.current.x, cx),
        top: Math.min(marqueeStartRef.current.y, cy),
        width: Math.abs(marqueeStartRef.current.x - cx),
        height: Math.abs(marqueeStartRef.current.y - cy),
      });
    };

    const onUp = (ev: MouseEvent) => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      marqueeListenersRef.current = null;

      if (!containerRef.current || !marqueeStartRef.current) return;

      const cr = containerRef.current.getBoundingClientRect();
      const endX = ev.clientX - cr.left + containerRef.current.scrollLeft;
      const endY = ev.clientY - cr.top + containerRef.current.scrollTop;
      const l = Math.min(marqueeStartRef.current.x, endX);
      const t = Math.min(marqueeStartRef.current.y, endY);
      const r = Math.max(marqueeStartRef.current.x, endX);
      const b = Math.max(marqueeStartRef.current.y, endY);

      // 忽略太小（纯点击）
      if (r - l < 5 && b - t < 5) {
        marqueeStartRef.current = null;
        setMarqueeRect(null);
        return;
      }

      // 计算哪些学生被框住
      const toSelect: string[] = [];
      containerRef.current.querySelectorAll<HTMLElement>('[data-student-id]').forEach(el => {
        const er = el.getBoundingClientRect();
        const elL = er.left - cr.left + containerRef.current!.scrollLeft;
        const elT = er.top - cr.top + containerRef.current!.scrollTop;
        const elR = elL + er.width;
        const elB = elT + er.height;
        if (elL < r && elR > l && elT < b && elB > t) {
          toSelect.push(el.dataset.studentId!);
        }
      });

      if (toSelect.length > 0) {
        setSelectedUnassigned(prev => {
          const next = new Set(prev);
          toSelect.forEach(id => next.add(id));
          return next;
        });
      }

      marqueeStartRef.current = null;
      setMarqueeRect(null);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    marqueeListenersRef.current = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  };

  return (
    <div style={{ padding: 20 }}>
      {/* 添加分组 - 紧凑放在顶部 */}
      <div style={{
        display: 'flex', gap: 8, alignItems: 'center', marginBottom: 16,
        padding: '10px 14px', background: '#f8fafc', borderRadius: 8,
      }}>
        <input className="input" value={newGroupName} onChange={e => setNewGroupName(e.target.value)}
          placeholder="新分组名称，回车添加" style={{ width: 200, fontSize: 13 }}
          onKeyDown={e => e.key === 'Enter' && handleCreateGroup()} />
        <button className="btn btn-primary" onClick={handleCreateGroup}
          style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
          添加分组
        </button>
        {groups.length > 0 && (
          <span style={{ fontSize: 11, color: '#94a3b8', marginLeft: 'auto' }}>
            共 {groups.length} 组，{students.length} 人
          </span>
        )}
      </div>

      {/* 分组列表 — 网格布局，每行2列 */}
      {groups.length > 0 && (
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)',
          gap: 16, marginBottom: 20,
        }}>
          {groups.map((g, idx) => {
            const color = GROUP_COLORS[idx % GROUP_COLORS.length];
            const isDragOver = draggedId !== null;
            return (
              <div key={g.id}
                onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
                onDrop={e => handleDrop(e, g.id)}
                style={{
                  borderRadius: 12, overflow: 'hidden',
                  border: `2px solid ${isDragOver ? color.border : '#e2e8f0'}`,
                  background: isDragOver ? color.light : 'white',
                  transition: 'all 0.15s',
                  minHeight: 80,
                  boxShadow: isDragOver ? `0 0 0 3px ${color.light}` : 'none',
                }}>
                {/* 彩色顶部装饰条 */}
                <div style={{ height: 4, background: color.border }} />

                <div style={{ padding: '14px 16px' }}>
                  {/* 组头 */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                    <div style={{
                      width: 26, height: 26, borderRadius: 7,
                      background: color.badge, color: 'white',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 12, fontWeight: 700, flexShrink: 0,
                    }}>
                      {idx + 1}
                    </div>
                    {editingName === g.id ? (
                      <input className="input" defaultValue={g.name} autoFocus
                        onBlur={e => { setEditingName(null); if (e.target.value !== g.name) handleRenameGroup(g.id, e.target.value); }}
                        onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setEditingName(null); }}
                        style={{ width: 160, fontSize: 13, fontWeight: 600 }}
                      />
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}
                        onClick={() => setEditingName(g.id)}>
                        <span style={{ fontSize: 14, fontWeight: 600, color: color.text }}>{g.name}</span>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                          strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
                          style={{ flexShrink: 0, stroke: '#cbd5e1', transition: 'stroke 0.12s' }}
                          onMouseEnter={e => e.currentTarget.style.stroke = color.badge}
                          onMouseLeave={e => e.currentTarget.style.stroke = '#cbd5e1'}>
                          <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
                          <path d="M14 6l4 4" />
                        </svg>
                      </div>
                    )}
                    <div style={{ flex: 1 }} />
                    {g.studentIds?.length > 0 && (
                      <button onClick={() => handleRemoveAllStudents(g.id)}
                        style={{
                          background: 'transparent', border: 'none', cursor: 'pointer',
                          fontSize: 12, color: '#94a3b8', padding: '4px 6px', borderRadius: 4,
                          display: 'flex', alignItems: 'center', gap: 3,
                          transition: 'all 0.1s',
                        }}
                        onMouseEnter={e => { e.currentTarget.style.color = '#f59e0b'; e.currentTarget.style.background = '#fffbeb'; }}
                        onMouseLeave={e => { e.currentTarget.style.color = '#94a3b8'; e.currentTarget.style.background = 'transparent'; }}
                        title="全部移除">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
                        移除
                      </button>
                    )}
                    <button onClick={() => handleDeleteGroup(g.id)}
                      style={{
                        background: 'transparent', border: 'none', cursor: 'pointer',
                        fontSize: 12, color: '#94a3b8', padding: '4px 6px', borderRadius: 4,
                        display: 'flex', alignItems: 'center', gap: 3,
                        transition: 'all 0.1s',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.color = '#ef4444'; e.currentTarget.style.background = '#fef2f2'; }}
                      onMouseLeave={e => { e.currentTarget.style.color = '#94a3b8'; e.currentTarget.style.background = 'transparent'; }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                      删除
                    </button>
                    <div style={{
                      fontSize: 12, padding: '2px 10px', borderRadius: 6,
                      background: color.light, color: color.badge, fontWeight: 600,
                      whiteSpace: 'nowrap',
                    }}>
                      {g.studentIds?.length || 0} 人
                    </div>
                  </div>

                  {/* 组内学生标签 */}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {g.studentIds?.length > 0 ? (
                      [...students].filter(s => g.studentIds.includes(s.id))
                        .sort((a, b) => (parseInt(a.studentNo) || 0) - (parseInt(b.studentNo) || 0)).map(s => (
                        <div key={s.id} draggable
                          onDragStart={e => handleDragStart(e, s.id)}
                          onDragEnd={() => setDraggedId(null)}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 4,
                            padding: '4px 8px', borderRadius: 8, cursor: 'grab',
                            background: color.bg, color: color.text, fontSize: 13,
                            userSelect: 'none', transition: 'all 0.1s',
                            opacity: draggedId === s.id ? 0.35 : 1,
                            border: `1px solid ${color.light}`,
                            boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
                            whiteSpace: 'nowrap',
                          }}>
                          <div style={{
                            width: 22, height: 22, borderRadius: '50%',
                            background: color.badge, color: 'white',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: 10, fontWeight: 700, flexShrink: 0,
                          }}>
                            {s.name[0]}
                          </div>
                          {s.name}
                          {s.studentNo && <span style={{ fontSize: 10, color: color.badge, opacity: 0.6, fontFamily: 'monospace', marginLeft: 1 }}>#{s.studentNo}</span>}
                        </div>
                      ))
                    ) : (
                      <div style={{
                        fontSize: 12, color: '#94a3b8', padding: '8px 0',
                        width: '100%', textAlign: 'center',
                        border: '1px dashed #e2e8f0', borderRadius: 8,
                      }}>
                        将学生拖拽到此处
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 未分配学生 */}
      {unassigned.length > 0 && (
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /></svg>
            未分配学生
            <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 400 }}>{unassigned.length} 人</span>
            {selectedUnassigned.size > 0 ? (
              <>
                <span style={{ fontSize: 11, color: '#2563eb', fontWeight: 600 }}>
                  已选 {selectedUnassigned.size} 人
                </span>
                <span style={{ fontSize: 11, color: '#cbd5e1' }}>·</span>
                <button onClick={() => setSelectedUnassigned(new Set())}
                  style={{
                    background: 'transparent', border: 'none', cursor: 'pointer',
                    fontSize: 11, color: '#94a3b8', padding: 0,
                    textDecoration: 'underline', textUnderlineOffset: 2,
                  }}
                  onMouseEnter={e => e.currentTarget.style.color = '#64748b'}
                  onMouseLeave={e => e.currentTarget.style.color = '#94a3b8'}>
                  取消选择
                </button>
              </>
            ) : (
              <span style={{ fontSize: 11, color: '#cbd5e1', fontWeight: 400 }}>
                （点击可多选，然后拖拽到分组中）
              </span>
            )}
          </div>
          <div ref={containerRef}
            onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
            onDrop={e => handleDrop(e, null)}
            onMouseDown={handleContainerMouseDown}
            style={{
              position: 'relative',
              display: 'flex', flexWrap: 'wrap', gap: 10, minHeight: 44,
              padding: '12px 16px', borderRadius: 10,
              border: `2px dashed ${draggedId ? '#93c5fd' : selectedUnassigned.size > 0 ? '#2563eb' : '#e2e8f0'}`,
              background: draggedId ? '#f8faff' : selectedUnassigned.size > 0 ? '#f0f4ff' : '#fafbfc',
              transition: 'all 0.12s',
            }}>
            {/* 框选遮罩层 */}
            {marqueeRect && (
              <div style={{
                position: 'absolute',
                left: marqueeRect.left,
                top: marqueeRect.top,
                width: marqueeRect.width,
                height: marqueeRect.height,
                background: 'rgba(37,99,235,0.08)',
                border: '2px solid rgba(37,99,235,0.4)',
                borderRadius: 6,
                pointerEvents: 'none',
                zIndex: 20,
              }} />
            )}
            {unassigned.map(s => {
              const isSelected = selectedUnassigned.has(s.id);
              return (
              <div key={s.id} data-student-id={s.id} draggable
                onDragStart={e => handleDragStart(e, s.id, true)}
                onDragEnd={() => setDraggedId(null)}
                onClick={() => {
                  setSelectedUnassigned(prev => {
                    const next = new Set(prev);
                    if (next.has(s.id)) next.delete(s.id);
                    else next.add(s.id);
                    return next;
                  });
                }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  padding: '4px 6px', borderRadius: 8, cursor: 'grab',
                  background: isSelected ? '#eef2ff' : 'white',
                  color: isSelected ? '#2563eb' : '#0f172a', fontSize: 13,
                  border: `1.5px solid ${isSelected ? '#2563eb' : '#e2e8f0'}`,
                  userSelect: 'none',
                  opacity: draggedId === s.id ? 0.35 : 1,
                  transition: 'all 0.1s',
                  boxShadow: isSelected ? '0 1px 3px rgba(37,99,235,0.15)' : '0 1px 2px rgba(0,0,0,0.04)',
                  width: 'calc(20% - 8px)',
                }}>
                {/* 多选框 */}
                <div style={{
                  width: 16, height: 16, borderRadius: 4,
                  background: isSelected ? '#2563eb' : '#f1f5f9',
                  border: `1.5px solid ${isSelected ? '#2563eb' : '#cbd5e1'}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0, transition: 'all 0.1s',
                }}>
                  {isSelected && (
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round"><polyline points="20 6 9 17 4 12" /></svg>
                  )}
                </div>
                <div style={{
                  width: 22, height: 22, borderRadius: '50%',
                  background: isSelected ? '#dbeafe' : '#f1f5f9',
                  color: isSelected ? '#2563eb' : '#64748b',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 10, fontWeight: 700, flexShrink: 0,
                }}>
                  {s.name[0]}
                </div>
                {s.name}
                {s.studentNo && <span style={{ fontSize: 10, color: '#94a3b8', fontFamily: 'monospace' }}>#{s.studentNo}</span>}
              </div>
            );
          })}
          </div>
        </div>
      )}

      {/* 空状态 */}
      {groups.length === 0 && unassigned.length === 0 && students.length > 0 && (
        <div style={{ textAlign: 'center', padding: '48px 20px', color: '#94a3b8' }}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" style={{ marginBottom: 10, opacity: 0.5 }}>
            <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" />
          </svg>
          <p style={{ fontSize: 14, fontWeight: 600, color: '#64748b', margin: '0 0 4px' }}>暂未设置分组</p>
          <p style={{ fontSize: 13, margin: '0 0 16px' }}>在上方输入分组名称后点击"添加分组"</p>
        </div>
      )}

      {students.length === 0 && (
        <div style={{ textAlign: 'center', padding: '48px 20px', color: '#94a3b8' }}>
          <p style={{ fontSize: 14, fontWeight: 600, color: '#64748b', margin: '0 0 4px' }}>暂无学生</p>
          <p style={{ fontSize: 13, margin: 0 }}>请先在「学生列表」中添加学生</p>
        </div>
      )}
    </div>
  );
}
