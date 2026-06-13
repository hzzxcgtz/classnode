'use client';

import { useState, useEffect, useRef } from 'react';
import { api } from '@/lib/api';
import { Toast } from '@/lib/components';
import { getApiBaseUrl } from '@/lib/api-base';
const API_BASE = typeof window !== 'undefined' ? getApiBaseUrl() : '';
function fixSvgUrl(svg: string) { return svg ? svg.replace(/href="\/uploads\//g, `href="${API_BASE}/uploads/`) : svg; }

type TabType = 'student' | 'class';

interface Avatar {
  id: number;
  name: string;
  svgContent: string;
  category: string;
  gender: string;
  sortOrder: number;
  isActive: boolean;
  source?: string;
}

export default function AvatarsPage() {
  const [tab, setTab] = useState<TabType>('student');
  const [avatars, setAvatars] = useState<Avatar[]>([]);
  const [studentCount, setStudentCount] = useState(0);
  const [classCount, setClassCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showEditor, setShowEditor] = useState<{ mode: 'create' | 'edit' | 'view'; avatar?: Avatar } | null>(null);
  const [showDelete, setShowDelete] = useState<Avatar | null>(null);
  const [showRandom, setShowRandom] = useState(false);
  const [randomPool, setRandomPool] = useState<any[]>([]);
  const [selectedRandom, setSelectedRandom] = useState<Set<number>>(new Set());
  const [generating, setGenerating] = useState(false);
  const [randomGenerated, setRandomGenerated] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  const loadAvatars = async () => {
    setLoading(true);
    try {
      const [teacherAvatars, allAvatars, allStudentAvatars, allClassAvatars] = await Promise.all([
        api.getAvatars(tab),
        api.getAvatarsAll(tab),
        api.getAvatars('student'),
        api.getAvatars('class'),
      ]);
      setAvatars(teacherAvatars);
      setStudentCount(allStudentAvatars.length);
      setClassCount(allClassAvatars.length);
      // 学生上传的头像 = 全部 - 教师
      const teacherIds = new Set(teacherAvatars.map((a: any) => a.id));
      setStudentUploadedAvatars(allAvatars.filter((a: any) => !teacherIds.has(a.id)));
    } catch { setAvatars([]); setStudentUploadedAvatars([]); }
    setLoading(false);
  };

  useEffect(() => { loadAvatars(); }, [tab]);

  const handleRandomGenerate = async (cat?: string) => {
    const category = cat || tab;
    if (randomGenerated) {
      setRandomPool([]);
      setSelectedRandom(new Set());
      await new Promise(r => setTimeout(r, 150));
    }
    setGenerating(true);
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/avatars/random-pool`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ category, count: 10 }) });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      setRandomPool(data.avatars || []);
      setSelectedRandom(new Set());
      setRandomGenerated(true);
    } catch { setToast({ msg: '生成失败，请重试', type: 'error' }); }
    setGenerating(false);
  };

  const handleImportRandom = async () => {
    const importIds = [...selectedRandom];
    if (importIds.length === 0) { setToast({ msg: '请选择要导入的头像', type: 'error' }); return; }
    try {
      const selected = randomPool.filter((_, i) => importIds.includes(i));
      for (const av of selected) {
        await api.createAvatar({ svgContent: av.svgContent, category: tab, gender: av.gender || 'neutral' });
      }
      setToast({ msg: `成功导入 ${selected.length} 个头像`, type: 'success' });
      setShowRandom(false);
      loadAvatars();
    } catch { setToast({ msg: '导入失败', type: 'error' }); }
  };

  const handleImportAll = async () => {
    if (randomPool.length === 0) return;
    try {
      for (const av of randomPool) {
        await api.createAvatar({ svgContent: av.svgContent, category: tab, gender: av.gender || 'neutral' });
      }
      setToast({ msg: `成功导入全部 ${randomPool.length} 个头像`, type: 'success' });
      setShowRandom(false);
      loadAvatars();
    } catch { setToast({ msg: '导入失败', type: 'error' }); }
  };

  const [studentUploadedAvatars, setStudentUploadedAvatars] = useState<any[]>([]);
  const boyAvatars = avatars.filter(a => a.gender === 'boy');
  const girlAvatars = avatars.filter(a => a.gender === 'girl');
  const neutralAvatars: any[] = [];

  const handleDelete = async (avatar: Avatar) => {
    try {
      const result = await api.deleteAvatar(avatar.id);
      setToast({
        msg: `已删除${result.studentCount > 0 ? `（${result.studentCount} 名学生正在使用，不受影响）` : ''}`,
        type: 'success',
      });
      setShowDelete(null);
      loadAvatars();
    } catch (e: any) {
      setToast({ msg: e.message || '删除失败', type: 'error' });
    }
  };

  return (
    <div>
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h1 style={{ fontSize: "1.375rem", fontWeight: 700, margin: 0, color: '#0f172a' }}>头像管理</h1>
            <p style={{ color: '#64748b', fontSize: "0.813rem", marginTop: 4 }}>
              管理学生头像和班级图标库，支持新增、编辑、删除和随机生成
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-secondary" onClick={() => { setShowRandom(true); setRandomGenerated(false); setRandomPool([]); setSelectedRandom(new Set()); }} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/></svg>
              随机生成
            </button>
            <button className="btn btn-primary" onClick={() => setShowEditor({ mode: 'create' })} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              新增{tab === 'student' ? '头像' : '图标'}
            </button>
          </div>
        </div>
      </div>

      {/* Tab 切换 */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 24, borderBottom: '2px solid #e2e8f0' }}>
        {[
          { key: 'student' as TabType, label: '学生头像', desc: `${studentCount} 个` },
          { key: 'class' as TabType, label: '班级图标', desc: `${classCount} 个` },
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            style={{
              padding: '10px 20px', fontSize: "0.875rem", fontWeight: tab === t.key ? 600 : 400,
              color: tab === t.key ? '#2563eb' : '#64748b',
              background: 'transparent', border: 'none', cursor: 'pointer',
              borderBottom: `2px solid ${tab === t.key ? '#2563eb' : 'transparent'}`,
              marginBottom: -2, transition: 'all 0.12s',
              display: 'flex', alignItems: 'center', gap: 8,
            }}>
            {t.label}
            <span style={{
              fontSize: "0.688rem", padding: '1px 7px', borderRadius: 10,
              background: tab === t.key ? '#eef2ff' : '#f1f5f9',
              color: tab === t.key ? '#2563eb' : '#94a3b8',
            }}>{t.desc}</span>
          </button>
        ))}
      </div>

      {/* 当前分类操作栏 */}
      {!loading && avatars.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
          <button onClick={async () => {
            if (!confirm(`确定清空所有${tab === 'student' ? '头像' : '图标'}？已使用的不会受影响，但头像库将变为空。`)) return;
            try { const r = await api.clearAllAvatars(tab); setToast({ msg: `已清空 ${r.cleared} 个${tab === 'student' ? '头像' : '图标'}`, type: 'success' }); loadAvatars(); } catch { setToast({ msg: '清空失败', type: 'error' }); }
          }} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 12px', borderRadius: 6, border: '1px solid #fca5a5', background: 'white', color: '#ef4444', cursor: 'pointer', fontSize: "0.75rem" }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            清空所有
          </button>
        </div>
      )}

      {/* 头像网格 */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: '#94a3b8' }}>加载中...</div>
      ) : avatars.length === 0 ? (
        <div style={{
          background: 'white', borderRadius: 14, border: '1px solid #e2e8f0',
          textAlign: 'center', padding: '60px 20px',
        }}>
          <div style={{
            width: 52, height: 52, borderRadius: 14,
            background: '#f1f5f9', margin: '0 auto 12px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.5">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
            </svg>
          </div>
          <p style={{ fontSize: "0.938rem", fontWeight: 600, color: '#0f172a', margin: '0 0 4px' }}>
            暂无{tab === 'student' ? '头像' : '图标'}
          </p>
          <p style={{ fontSize: "0.813rem", color: '#94a3b8', margin: '0 0 4px' }}>
            点击右上角「随机生成」按钮，生成一批{tab === 'student' ? '头像' : '图标'}
          </p>
          <p style={{ fontSize: "0.813rem", color: '#94a3b8', margin: '0 0 16px' }}>
            满意的选中后导入，或一键导入全部
          </p>
        </div>
      ) : null}

      {/* 教师头像区域 */}
      {tab === 'student' ? (
        <div>
          {/* 男孩区域 */}
          {boyAvatars.length > 0 && (
            <div style={{ marginBottom: 24 }}>
              <div style={{ fontSize: "0.75rem", fontWeight: 600, color: '#2563eb', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 3, height: 14, borderRadius: 2, background: '#2563eb', display: 'inline-block' }} />
                男孩头像
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {boyAvatars.map(av => <AvatarCard key={av.id} av={av} tab={tab} onEdit={() => setShowEditor({ mode: 'view', avatar: av })} onDelete={() => setShowDelete(av)} />)}
              </div>
            </div>
          )}
          {/* 女孩区域 */}
          {girlAvatars.length > 0 && (
            <div style={{ marginBottom: 24 }}>
              <div style={{ fontSize: "0.75rem", fontWeight: 600, color: '#e91e63', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 3, height: 14, borderRadius: 2, background: '#e91e63', display: 'inline-block' }} />
                女孩头像
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {girlAvatars.map(av => <AvatarCard key={av.id} av={av} tab={tab} onEdit={() => setShowEditor({ mode: 'view', avatar: av })} onDelete={() => setShowDelete(av)} />)}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {avatars.map(av => <AvatarCard key={av.id} av={av} tab={tab} onEdit={() => setShowEditor({ mode: 'view', avatar: av })} onDelete={() => setShowDelete(av)} />)}
        </div>
      )}

      {/* 学生自定义区域 — 显示在最下方 */}
      {tab === 'student' && (
        <div style={{ marginTop: 24, marginBottom: 24 }}>
          <div style={{ fontSize: "0.75rem", fontWeight: 600, color: '#f59e0b', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 3, height: 14, borderRadius: 2, background: '#f59e0b', display: 'inline-block' }} />
            学生自定义
            <span style={{ fontSize: "0.625rem", color: '#94a3b8', fontWeight: 400 }}>（学生自己上传，可在此管理删除）</span>
          </div>
          {studentUploadedAvatars.length > 0 ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {studentUploadedAvatars.map(av => <AvatarCard key={av.id} av={av} tab={tab} onEdit={() => setShowEditor({ mode: 'view', avatar: av })} onDelete={() => setShowDelete(av)} />)}
            </div>
          ) : (
            <p style={{ fontSize: "0.75rem", color: '#94a3b8', padding: '8px 0' }}>暂无学生自定义头像</p>
          )}
        </div>
      )}

      {/* 新增/编辑弹窗 */}
      {showEditor && (
        <AvatarEditorModal
          mode={showEditor.mode}
          avatar={showEditor.avatar}
          category={tab}
          onClose={() => setShowEditor(null)}
          onSaved={() => { setShowEditor(null); loadAvatars(); }}
          setToast={setToast}
        />
      )}

      {/* 删除确认弹窗 */}
      {showDelete && (
        <div className="modal-overlay" onClick={() => setShowDelete(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 400, padding: 28 }}>
            <div style={{ textAlign: 'center', marginBottom: 20 }}>
              <div style={{
                width: 48, height: 48, margin: '0 auto 12px',
                borderRadius: '50%', overflow: 'hidden',
              }} dangerouslySetInnerHTML={{ __html: fixSvgUrl(showDelete.svgContent).replace('<svg', '<svg width="48" height="48"') }} />
              <h3 style={{ fontSize: "1rem", fontWeight: 600, margin: '0 0 4px' }}>删除此{showDelete.category === 'class' ? '图标' : '头像'}</h3>
              <p style={{ fontSize: "0.813rem", color: '#64748b', margin: 0 }}>
                删除后此{tab === 'student' ? '头像' : '图标'}将从选择列表中隐藏，
                但已使用的学生/班级不受影响。
              </p>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
              <button className="btn btn-secondary" onClick={() => setShowDelete(null)}>取消</button>
              <button className="btn btn-danger" onClick={() => handleDelete(showDelete)}>确认删除</button>
            </div>
          </div>
        </div>
      )}

      {/* 随机生成弹窗 */}
      {showRandom && (
        <div className="modal-overlay" onClick={() => setShowRandom(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 600, padding: 28, maxHeight: '80vh', overflow: 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <div style={{
                width: 40, height: 40, borderRadius: 10,
                background: '#fef3c7', color: '#f59e0b',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/></svg>
              </div>
              <div>
                <h3 style={{ fontSize: "1rem", fontWeight: 600, margin: 0 }}>随机生成{tab === 'student' ? '头像' : '图标'}</h3>
                <p style={{ fontSize: "0.75rem", color: '#64748b', margin: '2px 0 0' }}>每次生成都不重样，选择满意的导入头像库</p>
              </div>
            </div>

            {!randomGenerated ? (
              <div style={{ textAlign: 'center', padding: '40px 20px' }}>
                <div style={{
                  width: 64, height: 64, borderRadius: 16,
                  background: '#fef3c7', margin: '0 auto 16px',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="1.5"><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/></svg>
                </div>
                <p style={{ fontSize: "0.938rem", fontWeight: 600, color: '#0f172a', margin: '0 0 4px' }}>
                  💡 点击下方按钮，为你随机生成 10 个{tab === 'student' ? '头像' : '图标'}
                </p>
                <p style={{ fontSize: "0.813rem", color: '#94a3b8', margin: '0 0 24px' }}>
                  满意的选中后一键导入，不满意的可以再来一批
                </p>
                <button className="btn btn-primary btn-lg" onClick={() => handleRandomGenerate(tab)} disabled={generating}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: "0.938rem", padding: '12px 32px' }}>
                  {generating ? (
                    <>生成中...</>
                  ) : (
                    <><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/></svg>
                      随机生成一批
                    </>
                  )}
                </button>
              </div>
            ) : (
              <>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
                  {[0, 5].map(startIdx => (
                    <div key={startIdx} style={{ display: 'flex', justifyContent: 'center', gap: 10 }}>
                      {randomPool.slice(startIdx, startIdx + 5).map((av: any, j: number) => {
                        const i = startIdx + j;
                        return (
                          <div key={i}
                            onClick={() => { setSelectedRandom(prev => { const n = new Set(prev); if (n.has(i)) n.delete(i); else n.add(i); return n; }); }}
                            style={{
                              width: 80, padding: 8, textAlign: 'center',
                              borderRadius: 10, border: `2px solid ${selectedRandom.has(i) ? '#2563eb' : '#e2e8f0'}`,
                              background: selectedRandom.has(i) ? '#f8faff' : 'white',
                              cursor: 'pointer', transition: 'all 0.15s',
                            }}>
                            <div style={{
                              width: 52, height: 52, margin: '0 auto 4px',
                              borderRadius: '50%', overflow: 'hidden',
                            }} dangerouslySetInnerHTML={{ __html: av.svgContent.replace('<svg', '<svg width="52" height="52"') }} />
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <button onClick={() => handleRandomGenerate(tab)} disabled={generating}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 6,
                      padding: '8px 18px', borderRadius: 8, border: '1px dashed #cbd5e1',
                      background: generating ? '#f1f5f9' : '#f8fafc',
                      color: generating ? '#94a3b8' : '#475569',
                      cursor: generating ? 'not-allowed' : 'pointer',
                      fontSize: "0.813rem", fontWeight: 500,
                      transition: 'all 0.12s',
                    }}
                    onMouseEnter={e => { if (!generating) { e.currentTarget.style.background = '#eef2ff'; e.currentTarget.style.borderColor = '#93c5fd'; e.currentTarget.style.color = '#2563eb'; }}}
                    onMouseLeave={e => { if (!generating) { e.currentTarget.style.background = '#f8fafc'; e.currentTarget.style.borderColor = '#cbd5e1'; e.currentTarget.style.color = '#475569'; }}}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
                    {generating ? '生成中...' : '换一批'}
                  </button>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <span style={{ fontSize: "0.813rem", fontWeight: 500, color: '#64748b' }}>已选 <span style={{ color: '#2563eb', fontWeight: 700 }}>{selectedRandom.size}</span> / {randomPool.length}</span>
                    <button onClick={handleImportAll}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 6,
                        padding: '8px 16px', borderRadius: 8, border: 'none',
                        background: 'linear-gradient(135deg, #059669, #10b981)',
                        color: 'white', cursor: 'pointer',
                        fontSize: "0.813rem", fontWeight: 600,
                        boxShadow: '0 2px 6px rgba(5,150,105,0.25)',
                        transition: 'all 0.12s',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 4px 12px rgba(5,150,105,0.35)'; }}
                      onMouseLeave={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = '0 2px 6px rgba(5,150,105,0.25)'; }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>
                      导入全部
                    </button>
                    <button className="btn btn-primary" onClick={handleImportRandom} disabled={selectedRandom.size === 0}>
                      导入选中 ({selectedRandom.size})
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <style>{`.avatar-card:hover .avatar-card-del { opacity: 1 !important; }`}</style>
      {toast && <Toast msg={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}

function AvatarCard({ av, tab, onEdit, onDelete }: { av: Avatar; tab: string; onEdit: () => void; onDelete: () => void }) {
  const size = tab === 'class' ? 64 : 60;
  const [usageCount, setUsageCount] = useState<number | null>(null);
  const [usageDetail, setUsageDetail] = useState<string>('');
  const [badgeHover, setBadgeHover] = useState(false);
  useEffect(() => {
    api.getAvatarUsage(av.id).then(data => {
      setUsageCount((data.students?.length || 0) + (data.classes?.length || 0));
      if (data.students?.length) {
        setUsageDetail(data.students.map((s: any) => s.class?.name ? `${s.class.name}/${s.name}` : s.name).join('、'));
      }
    }).catch(() => {});
  }, [av.id]);
  return (
    <div className="avatar-card"
      onClick={onEdit}
      style={{
        background: 'white', borderRadius: 12, border: '1px solid #e2e8f0',
        padding: 8, textAlign: 'center', position: 'relative', cursor: 'pointer',
      }}>
      <div style={{
        width: size, height: size, margin: '0 auto',
        borderRadius: tab === 'class' ? 10 : '50%',
        overflow: 'hidden',
      }}
        dangerouslySetInnerHTML={{ __html: fixSvgUrl(av.svgContent).replace('<svg', `<svg width="${size}" height="${size}"`) }} />
      {usageCount !== null && usageCount > 0 && (
        <div
          onMouseEnter={() => av.source === 'student' && setBadgeHover(true)}
          onMouseLeave={() => setBadgeHover(false)}
          style={{
            position: 'absolute', bottom: -2, right: -2,
            minWidth: 16, height: 16, borderRadius: 8,
            background: '#1e293b', color: 'white',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: "0.563rem", fontWeight: 700,
            padding: '0 4px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
        }}>
          {usageCount}
          {badgeHover && usageDetail && (
            <div style={{
              position: 'absolute', bottom: '100%', left: '50%', transform: 'translateX(-50%)',
              background: '#1e293b', color: 'white', padding: '4px 8px', borderRadius: 4,
              fontSize: "0.625rem", whiteSpace: 'nowrap', zIndex: 10, marginBottom: 4,
              pointerEvents: 'none', maxWidth: 250, overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              {usageDetail}
            </div>
          )}
        </div>
      )}
      <div className="avatar-card-del"
        onClick={e => { e.stopPropagation(); onDelete(); }}
        style={{
          position: 'absolute', top: 2, right: 2,
          width: 20, height: 20, borderRadius: '50%',
          background: '#fef2f2', border: '1px solid #fca5a5',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', opacity: 0, transition: 'opacity 0.12s',
        }} title="删除">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="3" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </div>
    </div>
  );
}

function AvatarEditorModal({ mode, avatar, category, onClose, onSaved, setToast }: {
  mode: 'create' | 'edit' | 'view';
  avatar?: Avatar;
  category: string;
  onClose: () => void;
  onSaved: () => void;
  setToast: (t: { msg: string; type: 'success' | 'error' } | null) => void;
}) {
  const [gender, setGender] = useState(avatar?.gender || 'neutral');
  const [svgContent, setSvgContent] = useState(avatar?.svgContent || '');
  const [saving, setSaving] = useState(false);
  const [previewSvg, setPreviewSvg] = useState(avatar?.svgContent || '');
  const [showHint, setShowHint] = useState(true);
  const [usage, setUsage] = useState<{ students: any[]; classes: any[] } | null>(null);
  const isImage = avatar?.svgContent?.includes('<image ') || false;
  useEffect(() => {
    if (mode === 'view' && avatar) {
      api.getAvatarUsage(avatar.id).then(setUsage).catch(() => {});
    }
  }, [mode, avatar]);

  const handlePreview = () => {
    setPreviewSvg(svgContent);
    setShowHint(false);
  };

  const handleSave = async () => {
    if (!svgContent.trim()) return;
    setSaving(true);
    try {
      if (mode === 'create') {
        await api.createAvatar({ svgContent, category, gender });
      } else if (avatar) {
        await api.updateAvatar(avatar.id, { svgContent, gender });
      }
      onSaved();
    } catch (e: any) {
      setToast({ msg: (mode === 'create' ? '创建' : '更新') + '失败: ' + e.message, type: 'error' });
    }
    setSaving(false);
  };

  // 查看模式
  if (mode === 'view' && avatar) {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 440, padding: 28, textAlign: 'center' }}>
          <h2 style={{ fontSize: "1rem", fontWeight: 600, margin: '0 0 16px' }}>{category === 'student' ? '头像' : '图标'}详情</h2>
          <div style={{
            width: 120, height: 120, margin: '0 auto 16px',
            borderRadius: category === 'class' ? 16 : '50%', overflow: 'hidden',
            border: '2px solid #e2e8f0', boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
          }}
            dangerouslySetInnerHTML={{ __html: fixSvgUrl(avatar.svgContent).replace('<svg', '<svg width="120" height="120"') }} />
          {category === 'student' && !isImage && (
            <p style={{ fontSize: "0.813rem", color: '#64748b', marginBottom: 12 }}>
              性别：{avatar.gender === 'boy' ? '男孩' : avatar.gender === 'girl' ? '女孩' : '通用'}
            </p>
          )}

          {/* 使用情况 */}
          <div style={{ textAlign: 'left', marginBottom: 12 }}>
            <p style={{ fontSize: "0.75rem", fontWeight: 600, color: '#475569', marginBottom: 6 }}>使用情况：</p>
            {!usage ? (
              <p style={{ fontSize: "0.75rem", color: '#94a3b8' }}>加载中...</p>
            ) : usage.students.length === 0 && usage.classes.length === 0 ? (
              <p style={{ fontSize: "0.75rem", color: '#94a3b8' }}>暂无使用</p>
            ) : (
              <div style={{ maxHeight: 160, overflow: 'auto' }}>
                {usage.students.length > 0 && (
                  <div style={{ marginBottom: 4 }}>
                    <p style={{ fontSize: "0.688rem", color: '#94a3b8', marginBottom: 2 }}>学生（{usage.students.length}）：</p>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {usage.students.map((s: any, i: number) => (
                        <span key={i} style={{
                          padding: '3px 6px', borderRadius: 4, fontSize: "0.688rem",
                          background: '#f1f5f9', color: '#475569', display: 'inline-flex', alignItems: 'center', gap: 2,
                        }}>
                          {s.class?.name ? (
                            <><span style={{ color: '#2563eb', fontWeight: 600 }}>{s.class.name}</span><span style={{ color: '#94a3b8' }}>·</span><span>{s.name}</span></>
                          ) : s.name}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {usage.classes.length > 0 && (
                  <div>
                    <p style={{ fontSize: "0.688rem", color: '#94a3b8', marginBottom: 2 }}>班级（{usage.classes.length}）：</p>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {usage.classes.map((c: any, i: number) => (
                        <span key={i} style={{
                          padding: '3px 8px', borderRadius: 4, fontSize: "0.688rem",
                          background: '#f0fdf4', color: '#059669',
                        }}>
                          {c.name}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {!isImage && (
            <div style={{ textAlign: 'left', marginBottom: 16 }}>
              <p style={{ fontSize: "0.75rem", color: '#94a3b8', marginBottom: 4 }}>SVG 代码：</p>
              <pre style={{
                background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: 12,
                fontSize: "0.625rem", fontFamily: 'monospace', lineHeight: 1.5, maxHeight: 160, overflow: 'auto',
                whiteSpace: 'pre-wrap', wordBreak: 'break-all', color: '#334155',
              }}>{avatar.svgContent}</pre>
            </div>
          )}
          <button className="btn btn-primary" onClick={onClose} style={{ width: '100%', padding: '10px 0' }}>确定</button>
        </div>
      </div>
    );
  }

  // 创建/编辑模式
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 520, padding: 28 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
          <div style={{
            width: 40, height: 40, borderRadius: 10,
            background: '#eef2ff', color: '#2563eb',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
            </svg>
          </div>
          <div>
            <h2 style={{ fontSize: "1rem", fontWeight: 600, margin: 0 }}>{mode === 'create' ? '新增' : '编辑'}{category === 'student' ? '头像' : '图标'}</h2>
            <p style={{ fontSize: "0.75rem", color: '#64748b', margin: '2px 0 0' }}>
              {mode === 'create' ? '输入 SVG 代码创建新头像' : '修改头像信息'}
            </p>
          </div>
        </div>

        {category === 'student' && (
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: "0.75rem", color: '#64748b', marginBottom: 4, display: 'block' }}>性别倾向</label>
            <div style={{ display: 'flex', gap: 8 }}>
              {[{ value: 'boy', label: '男孩' }, { value: 'girl', label: '女孩' }].map(g => (
                <button key={g.value}
                  onClick={() => setGender(g.value)}
                  style={{
                    padding: '6px 16px', borderRadius: 8, fontSize: "0.75rem", fontWeight: 500,
                    background: gender === g.value ? (g.value === 'boy' ? '#eef2ff' : '#fce4ec') : 'white',
                    color: gender === g.value ? (g.value === 'boy' ? '#2563eb' : '#e91e63') : '#64748b',
                    border: `1px solid ${gender === g.value ? (g.value === 'boy' ? '#bfdbfe' : '#f8bbd0') : '#e2e8f0'}`,
                    cursor: 'pointer',
                  }}>
                  {g.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: "0.75rem", color: '#64748b', marginBottom: 4, display: 'block' }}>SVG 代码 *</label>
          <textarea className="input" value={svgContent} onChange={e => setSvgContent(e.target.value)}
            rows={6} style={{ fontFamily: 'monospace', fontSize: "0.688rem", resize: 'vertical' }}
            placeholder={'<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">\n  ...\n</svg>'} />
          <p style={{ fontSize: "0.625rem", color: '#94a3b8', marginTop: 4 }}>需要包含 viewBox="0 0 40 40" 的完整 SVG 代码</p>
        </div>

        <div style={{ marginBottom: 16 }}>
          <button className="btn btn-secondary" onClick={handlePreview}
            style={{ fontSize: "0.75rem", display: 'flex', alignItems: 'center', gap: 4 }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
            </svg>
            预览
          </button>
          {!showHint && (
            <div style={{ marginTop: 10, display: 'flex', justifyContent: 'center' }}>
              <div style={{
                width: 80, height: 80, padding: 10,
                background: '#f8fafc', borderRadius: 12,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {previewSvg ? (
                  <div style={{
                    width: 48, height: 48,
                    borderRadius: category === 'class' ? 12 : '50%',
                    overflow: 'hidden',
                  }} dangerouslySetInnerHTML={{ __html: previewSvg.replace('<svg', '<svg width="48" height="48"') }} />
                ) : (
                  <span style={{ fontSize: "0.75rem", color: '#cbd5e1' }}>无效</span>
                )}
              </div>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn btn-secondary" onClick={onClose}>取消</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving || !svgContent.trim()}>
            {saving ? '保存中...' : (mode === 'create' ? '创建' : '保存')}
          </button>
        </div>
      </div>
    </div>
  );
}
