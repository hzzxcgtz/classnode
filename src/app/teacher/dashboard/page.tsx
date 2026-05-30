'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import {
  platformLabels, platformColors, platformBadgeBg,
  classroomModeLabels, classroomModeColors, classroomModeBg,
  statusColors, statusLabels,
} from '@/lib/constants';

// ─── 辅助函数 ──────────────────────────────────────────────

function getApiBaseUrl(): string {
  const host = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
  return 'http://' + host + ':3001';
}

const greeting = () => {
  const hour = new Date().getHours();
  if (hour < 6) return '夜深了';
  if (hour < 9) return '早上好';
  if (hour < 12) return '上午好';
  if (hour < 14) return '中午好';
  if (hour < 18) return '下午好';
  return '晚上好';
};

// ─── 图表示例组件 ────────────────────────────────────────

/** 环形图 */
function Donut({ pct, size = 48, sw = 4, color = '#2563eb', bg = '#f1f5f9' }: {
  pct: number; size?: number; sw?: number; color?: string; bg?: string;
}) {
  const r = (size - sw) / 2;
  const circ = 2 * Math.PI * r;
  const off = circ * (1 - Math.min(pct, 100) / 100);
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flexShrink: 0 }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={bg} strokeWidth={sw} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={sw}
        strokeDasharray={`${circ} ${circ}`} strokeDashoffset={off}
        strokeLinecap="round" transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: 'stroke-dashoffset 0.6s ease' }} />
    </svg>
  );
}

/** 横向柱条 */
function HBar({ value, max, color = '#2563eb', height = 8 }: {
  value: number; max: number; color?: string; height?: number;
}) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div style={{
      width: '100%', height, borderRadius: height / 2,
      background: '#f1f5f9', overflow: 'hidden',
    }}>
      <div style={{
        width: `${pct}%`, height: '100%', borderRadius: height / 2,
        background: `linear-gradient(90deg, ${color}99, ${color})`,
        transition: 'width 0.5s ease',
      }} />
    </div>
  );
}

// ─── 统计卡片组件 ──────────────────────────────────────────

function StatCard({ label, value, unit, color, bg, icon }: {
  label: string; value: number | string; unit?: string; color: string; bg: string; icon: React.ReactNode;
}) {
  return (
    <div style={{
      background: 'white', borderRadius: 14, border: '1px solid #e2e8f0',
      padding: '18px 20px', transition: 'box-shadow 0.2s, transform 0.15s',
    }}
      onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,0.06)'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
      onMouseLeave={e => { e.currentTarget.style.boxShadow = 'none'; e.currentTarget.style.transform = 'none'; }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{
          width: 42, height: 42, borderRadius: 11,
          background: bg, color,
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>
          {icon}
        </div>
        <div>
          <div style={{ fontSize: 24, fontWeight: 700, color, lineHeight: 1.1 }}>
            {typeof value === 'number' ? value.toLocaleString() : value}
            {unit && <span style={{ fontSize: 13, fontWeight: 400, color: '#94a3b8', marginLeft: 4 }}>{unit}</span>}
          </div>
          <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{label}</div>
        </div>
      </div>
    </div>
  );
}

// ─── 区块容器 ──────────────────────────────────────────────

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{
      background: 'white', borderRadius: 16, border: '1px solid #e2e8f0',
      marginBottom: 24, overflow: 'hidden',
    }}>
      <div style={{
        padding: '18px 24px', borderBottom: '1px solid #eef2f6',
        display: 'flex', alignItems: 'center', gap: 10,
        background: 'linear-gradient(135deg, #f8faff 0%, #f0f4ff 100%)',
      }}>
        {icon}
        <h2 style={{ fontSize: 15, fontWeight: 700, margin: 0, color: '#0f172a' }}>{title}</h2>
      </div>
      <div style={{ padding: 20 }}>
        {children}
      </div>
    </div>
  );
}

// ─── 主页面 ────────────────────────────────────────────────

export default function DashboardPage() {
  const [loading, setLoading] = useState(true);
  const [agents, setAgents] = useState<any[]>([]);
  const [classes, setClasses] = useState<any[]>([]);
  const [allClassrooms, setAllClassrooms] = useState<any[]>([]);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [a, c, cr] = await Promise.all([
        api.getAgents(),
        api.getClasses(),
        api.getAllClassrooms().catch(() => [] as any[]),
      ]);
      setAgents(a || []);
      setClasses(c || []);
      setAllClassrooms(cr || []);
    } catch {}
    setLoading(false);
  };

  // ── 统计数据 ──

  // Agent stats
  const agentTotal = agents.length;
  const agentEnabled = agents.filter(a => a.enabled !== false).length;
  const agentDisabled = agentTotal - agentEnabled;
  const agentPlatforms = agents.reduce((acc: Record<string, number>, a) => {
    const p = a.platform || 'unknown';
    acc[p] = (acc[p] || 0) + 1;
    return acc;
  }, {});
  const agentUsage = agents.map(a => {
    const count = allClassrooms.filter(cr =>
      cr.classroomAgents?.some((ca: any) => ca.agentId === a.id)
    ).length;
    return { ...a, usageCount: count };
  });
  const agentMaxUsage = Math.max(...agentUsage.map(a => a.usageCount), 1);

  // Class stats
  const classTotal = classes.length;
  const classTotalStudents = classes.reduce((sum: number, c) => sum + (c._count?.students || 0), 0);
  const classDetails = classes.map(c => {
    const usageCount = allClassrooms.filter(cr =>
      cr.classes?.some((cc: any) => cc.classId === c.id)
    ).length;
    return { ...c, usageCount };
  });
  const classMaxStudents = Math.max(...classDetails.map(c => c._count?.students || 0), 1);

  // Classroom stats
  const classroomTotal = allClassrooms.length;
  const classroomActive = allClassrooms.filter(c => c.status === 'active').length;
  const classroomPaused = allClassrooms.filter(c => c.status === 'paused').length;
  const classroomEnded = allClassrooms.filter(c => c.status === 'ended').length;
  const classroomByMode = allClassrooms.reduce((acc: Record<string, number>, c) => {
    const m = c.mode || 'standard';
    acc[m] = (acc[m] || 0) + 1;
    return acc;
  }, {});
  const classroomTotalInteractions = allClassrooms.reduce((sum: number, c) => sum + (c._count?.interactions || 0), 0);
  const classroomTotalStudents = allClassrooms.reduce((sum: number, c) => sum + (c._count?.students || 0), 0);

  // ── 渲染 ──

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '50vh' }}>
        <div style={{ color: '#94a3b8', fontSize: 14 }}>加载中...</div>
      </div>
    );
  }

  const platformEntries = Object.entries(agentPlatforms).sort((a, b) => b[1] - a[1]);
  const modeEntries = Object.entries(classroomByMode).sort((a, b) => b[1] - a[1]);

  return (
    <div>
      {/* ═══ 页面标题 ═══ */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, color: '#0f172a' }}>仪表盘</h1>
            </div>
            <p style={{ color: '#64748b', fontSize: 13, marginTop: 4 }}>
              {greeting()}，以下是系统的完整数据概览
            </p>
          </div>
          <button className="btn btn-primary" onClick={loadData}
            style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, padding: '8px 16px' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
            </svg>
            刷新数据
          </button>
        </div>
      </div>

      {/* ═══ AI智能体统计 ═══ */}
      <Section title="AI 智能体统计" icon={
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2" strokeLinecap="round">
          <rect x="4" y="4" width="16" height="16" rx="3" /><path d="M9 12h6" /><path d="M12 9v6" />
          <path d="M8 4V2" /><path d="M16 4V2" /><path d="M8 20v2" /><path d="M16 20v2" />
        </svg>
      }>
        {/* 汇总卡片 */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 20 }}>
          <StatCard label="已接入智能体" value={agentTotal} color="#2563eb" bg="#eef2ff"
            icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="4" y="4" width="16" height="16" rx="3" /><path d="M9 12h6" /><path d="M12 9v6" /></svg>} />
          <StatCard label="启用中" value={agentEnabled} color="#10b981" bg="#f0fdf4"
            icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><polyline points="20 6 9 17 4 12" /></svg>} />
          <StatCard label="已停用" value={agentDisabled} color="#94a3b8" bg="#f1f5f9"
            icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>} />
          <StatCard label="总被引用" value={agentUsage.reduce((s, a) => s + a.usageCount, 0)} color="#8b5cf6" bg="#f5f3ff"
            icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" /><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" /></svg>} />
        </div>

        <div style={{ display: 'flex', gap: 24 }}>
          {/* 平台分布 */}
          <div style={{
            flex: '0 0 280', padding: '14px 18px', borderRadius: 12,
            background: '#f8fafc', border: '1px solid #eef2f6',
          }}>
            <div style={{
              fontSize: 12, fontWeight: 600, color: '#64748b', marginBottom: 14,
              display: 'flex', alignItems: 'center', gap: 6,
            }}>
              <div style={{ width: 8, height: 8, borderRadius: 2, background: '#2563eb' }} />
              接入方式分布
            </div>
            {platformEntries.length === 0 ? (
              <div style={{ fontSize: 12, color: '#94a3b8', textAlign: 'center', padding: 20 }}>暂无数据</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {platformEntries.map(([platform, count]) => {
                  const color = platformColors[platform] || '#64748b';
                  const bg = platformBadgeBg[platform] || '#f1f5f9';
                  const label = platformLabels[platform] || platform;
                  const pct = agentTotal > 0 ? Math.round((count / agentTotal) * 100) : 0;
                  return (
                    <div key={platform}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{
                            padding: '1px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600,
                            background: bg, color,
                          }}>{label}</span>
                        </div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }}>
                          {count} <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 400 }}>个 ({pct}%)</span>
                        </div>
                      </div>
                      <HBar value={count} max={agentTotal} color={color} height={6} />
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* 各智能体引用次数 */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: 12, fontWeight: 600, color: '#64748b', marginBottom: 14,
              display: 'flex', alignItems: 'center', gap: 6,
            }}>
              <div style={{ width: 8, height: 8, borderRadius: 2, background: '#8b5cf6' }} />
              智能体被引用次数
            </div>
            {agentUsage.length === 0 ? (
              <div style={{ fontSize: 12, color: '#94a3b8', textAlign: 'center', padding: 20 }}>暂无数据</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {agentUsage.map(a => {
                  const color = platformColors[a.platform] || '#64748b';
                  return (
                    <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{
                        width: 26, height: 26, borderRadius: 6, flexShrink: 0,
                        background: a.enabled !== false ? `${color}18` : '#f1f5f9',
                        color: a.enabled !== false ? color : '#94a3b8',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 11, fontWeight: 700, overflow: 'hidden',
                      }}>
                        {a.logo
                          ? <img src={`${getApiBaseUrl()}${a.logo}`} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          : a.name[0]}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
                          <span style={{ fontSize: 13, fontWeight: 500, color: '#0f172a' }}>{a.name}</span>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{
                              width: 6, height: 6, borderRadius: '50%',
                              background: a.enabled !== false ? '#10b981' : '#d1d5db',
                            }} />
                            <span style={{ fontSize: 12, fontWeight: 600, color: '#8b5cf6' }}>{a.usageCount}</span>
                          </div>
                        </div>
                        <HBar value={a.usageCount} max={agentMaxUsage} color={color} height={5} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </Section>

      {/* ═══ 班级管理数据 ═══ */}
      <Section title="班级管理数据" icon={
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2" strokeLinecap="round">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      }>
        {/* 汇总卡片 */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 20 }}>
          <StatCard label="班级总数" value={classTotal} color="#16a34a" bg="#f0fdf4"
            icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /></svg>} />
          <StatCard label="学生总数" value={classTotalStudents} color="#8b5cf6" bg="#f5f3ff"
            icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>} />
          <StatCard label="使用中班级" value={classDetails.filter(c => c.usageCount > 0).length} color="#f59e0b" bg="#fffbeb"
            icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><polygon points="5 3 19 12 5 21 5 3" /></svg>} />
        </div>

        {/* 班级明细表 */}
        {classDetails.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '30px 0', color: '#94a3b8', fontSize: 13 }}>暂无班级数据</div>
        ) : (
          <div style={{ border: '1px solid #eef2f6', borderRadius: 10, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#f8fafc' }}>
                  <th style={thStyle}>班级名称</th>
                  <th style={{ ...thStyle, textAlign: 'center', width: 100 }}>是否分组</th>
                  <th style={{ ...thStyle, textAlign: 'center', width: 100 }}>学生人数</th>
                  <th style={{ ...thStyle, textAlign: 'center', width: 120 }}>课堂使用次数</th>
                </tr>
              </thead>
              <tbody>
                {classDetails.map((c, i) => (
                  <tr key={c.id} style={{ background: i % 2 === 0 ? 'white' : '#fafbfc' }}>
                    <td style={tdStyle}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{
                          width: 28, height: 28, borderRadius: 7,
                          background: c.usageCount > 0 ? 'linear-gradient(135deg, #16a34a, #34d399)' : '#f1f5f9',
                          color: c.usageCount > 0 ? 'white' : '#94a3b8',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 12, fontWeight: 700, flexShrink: 0,
                        }}>{c.name[0]}</div>
                        <span style={{ fontWeight: 500, fontSize: 13, color: '#0f172a' }}>{c.name}</span>
                      </div>
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'center' }}>
                      <span style={{
                        display: 'inline-block', padding: '2px 10px', borderRadius: 6,
                        fontSize: 11, fontWeight: 600,
                        background: (c._count?.groups || 0) > 0 ? '#f0fdf4' : '#f1f5f9',
                        color: (c._count?.groups || 0) > 0 ? '#16a34a' : '#94a3b8',
                      }}>
                        {(c._count?.groups || 0) > 0 ? '已分组' : '未分组'}
                      </span>
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'center' }}>
                      <span style={{
                        fontSize: 13, fontWeight: 600, color: '#8b5cf6',
                      }}>
                        {c._count?.students || 0}
                      </span>
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'center' }}>
                      <span style={{
                        fontSize: 13, fontWeight: 600,
                        color: c.usageCount > 0 ? '#2563eb' : '#94a3b8',
                      }}>
                        {c.usageCount}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* ═══ 课堂管理数据 ═══ */}
      <Section title="课堂管理数据" icon={
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round">
          <rect x="2" y="3" width="20" height="14" rx="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" />
        </svg>
      }>
        {/* 汇总卡片 */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 20 }}>
          <StatCard label="总课堂数" value={classroomTotal} color="#0f172a" bg="#f1f5f9"
            icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2" y="3" width="20" height="14" rx="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" /></svg>} />
          <StatCard label="进行中" value={classroomActive} color="#10b981" bg="#f0fdf4"
            icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><polygon points="5 3 19 12 5 21 5 3" /></svg>} />
          <StatCard label="已暂停" value={classroomPaused} color="#f59e0b" bg="#fffbeb"
            icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" /></svg>} />
          <StatCard label="已结束" value={classroomEnded} color="#94a3b8" bg="#f1f5f9"
            icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><polyline points="9 10 12 13 15 10" /><polyline points="9 17 12 20 15 17" /><circle cx="12" cy="12" r="10" /></svg>} />
        </div>

        <div style={{ display: 'flex', gap: 24 }}>
          {/* 模式分布 */}
          <div style={{
            flex: 1, padding: '14px 18px', borderRadius: 12,
            background: '#f8fafc', border: '1px solid #eef2f6',
          }}>
            <div style={{
              fontSize: 12, fontWeight: 600, color: '#64748b', marginBottom: 14,
              display: 'flex', alignItems: 'center', gap: 6,
            }}>
              <div style={{ width: 8, height: 8, borderRadius: 2, background: '#7c3aed' }} />
              课堂模式分布
            </div>
            {modeEntries.length === 0 ? (
              <div style={{ fontSize: 12, color: '#94a3b8', textAlign: 'center', padding: 20 }}>暂无数据</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {modeEntries.map(([mode, count]) => {
                  const color = classroomModeColors[mode] || '#64748b';
                  const bg = classroomModeBg[mode] || '#f1f5f9';
                  const label = classroomModeLabels[mode] || mode;
                  const pct = classroomTotal > 0 ? Math.round((count / classroomTotal) * 100) : 0;
                  return (
                    <div key={mode}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{
                            padding: '1px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600,
                            background: bg, color,
                          }}>{label}</span>
                        </div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }}>
                          {count} <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 400 }}>个 ({pct}%)</span>
                        </div>
                      </div>
                      <HBar value={count} max={classroomTotal} color={color} height={6} />
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* 状态分布 + 详情 */}
          <div style={{
            flex: 1, padding: '14px 18px', borderRadius: 12,
            background: '#f8fafc', border: '1px solid #eef2f6',
          }}>
            <div style={{
              fontSize: 12, fontWeight: 600, color: '#64748b', marginBottom: 14,
              display: 'flex', alignItems: 'center', gap: 6,
            }}>
              <div style={{ width: 8, height: 8, borderRadius: 2, background: '#10b981' }} />
              课堂状态分布
            </div>
            <div style={{ display: 'flex', gap: 20, alignItems: 'center' }}>
              {/* 环形图 */}
              <div style={{ display: 'flex', gap: 20 }}>
                {([
                  { label: '进行中', count: classroomActive, color: '#10b981' },
                  { label: '已暂停', count: classroomPaused, color: '#f59e0b' },
                  { label: '已结束', count: classroomEnded, color: '#94a3b8' },
                ] as const).map(s => (
                  <div key={s.label} style={{ textAlign: 'center' }}>
                    <Donut
                      pct={classroomTotal > 0 ? (s.count / classroomTotal) * 100 : 0}
                      size={60} sw={5}
                      color={s.color}
                      bg="#f1f5f9"
                    />
                    <div style={{ fontSize: 16, fontWeight: 700, color: s.color, marginTop: 6 }}>{s.count}</div>
                    <div style={{ fontSize: 11, color: '#94a3b8' }}>{s.label}</div>
                  </div>
                ))}
              </div>
              {/* 摘要信息 */}
              <div style={{ flex: 1, borderLeft: '1px solid #e2e8f0', paddingLeft: 20 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                    <span style={{ color: '#64748b' }}>参与学生</span>
                    <span style={{ fontWeight: 600, color: '#8b5cf6' }}>{classroomTotalStudents} 人次</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                    <span style={{ color: '#64748b' }}>互动轮数</span>
                    <span style={{ fontWeight: 600, color: '#2563eb' }}>{classroomTotalInteractions} 轮</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                    <span style={{ color: '#64748b' }}>平均每课学生</span>
                    <span style={{ fontWeight: 600, color: '#16a34a' }}>
                      {classroomTotal > 0 ? Math.round(classroomTotalStudents / classroomTotal) : 0} 人
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                    <span style={{ color: '#64748b' }}>平均每课互动</span>
                    <span style={{ fontWeight: 600, color: '#f59e0b' }}>
                      {classroomTotal > 0 ? Math.round(classroomTotalInteractions / classroomTotal) : 0} 轮
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </Section>

      {/* 底部信息 */}
      <div style={{
        padding: '12px 18px', borderRadius: 10,
        background: '#f8fafc', border: '1px solid #eef2f6',
        display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#94a3b8',
      }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
        </svg>
        数据在进入页面时自动加载 · 点击右上角「刷新数据」按钮手动更新
      </div>
    </div>
  );
}

// ─── 表格样式 ──────────────────────────────────────────────

const thStyle: React.CSSProperties = {
  padding: '10px 14px', fontSize: 12, fontWeight: 600, color: '#475569',
  borderBottom: '2px solid #e2e8f0', textAlign: 'left' as const,
  letterSpacing: '0.02em',
};

const tdStyle: React.CSSProperties = {
  padding: '10px 14px', fontSize: 13, color: '#334155',
  borderBottom: '1px solid #eef2f6',
};
