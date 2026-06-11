'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import {
  platformLabels, platformColors, platformBadgeBg,
  classroomModeLabels, classroomModeColors, classroomModeBg,
} from '@/lib/constants';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell,
} from 'recharts';

// ─── 区块卡片 ──────────────────────────────────────────────

function SectionCard({ title, icon, color, children, accent }: {
  title: string; icon: React.ReactNode; color: string; children: React.ReactNode; accent?: boolean;
}) {
  return (
    <div style={{
      background: 'white', borderRadius: 14, border: '1px solid #e2e8f0',
      overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
      transition: 'box-shadow 0.2s',
    }}
      onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 4px 20px rgba(0,0,0,0.06)'; }}
      onMouseLeave={e => { e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.03)'; }}
    >
      <div style={{
        padding: '12px 16px',
        display: 'flex', alignItems: 'center', gap: 8,
        borderLeft: `3px solid ${color}`,
        background: `linear-gradient(135deg, ${color}06, ${color}12)`,
      }}>
        <span style={{ color, display: 'flex' }}>{icon}</span>
        <h3 style={{ fontSize: "0.813rem", fontWeight: 700, margin: 0, color: '#0f172a' }}>{title}</h3>
      </div>
      <div style={{ padding: 16 }}>{children}</div>
    </div>
  );
}

// ─── 问候语 ────────────────────────────────────────────────

function greeting() {
  const hour = new Date().getHours();
  if (hour < 6) return '夜深了';
  if (hour < 9) return '早上好';
  if (hour < 12) return '上午好';
  if (hour < 14) return '中午好';
  if (hour < 18) return '下午好';
  return '晚上好';
}

// ─── 自定义 Tooltip ─────────────────────────────────────────

function ChartTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: '#1e293b', border: 'none', borderRadius: 6, padding: '6px 10px', fontSize: "0.75rem", color: '#f1f5f9', boxShadow: '0 4px 12px rgba(0,0,0,0.25)' }}>
      {payload.map((entry: any, i: number) => (
        <div key={i} style={{ color: '#f1f5f9' }}>{entry.payload.name || entry.name}: {entry.value}</div>
      ))}
    </div>
  );
}

// ─── KPI 卡片 ────────────────────────────────────────────────

function KpiCard({ label, value, color, icon, trend, trendUp }: {
  label: string; value: string | number; color: string; icon: React.ReactNode; trend?: string; trendUp?: boolean;
}) {
  return (
    <div style={{
      background: `linear-gradient(135deg, ${color}, ${color}dd)`,
      borderRadius: 14, padding: '18px 20px', position: 'relative', overflow: 'hidden',
      boxShadow: `0 4px 16px ${color}33`,
      transition: 'transform 0.2s, box-shadow 0.2s',
    }}
      onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = `0 8px 28px ${color}44`; }}
      onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = `0 4px 16px ${color}33`; }}
    >
      {/* 装饰圆 */}
      <div style={{ position: 'absolute', right: -20, top: -20, width: 100, height: 100, borderRadius: '50%', background: 'rgba(255,255,255,0.08)' }} />
      <div style={{ position: 'absolute', right: -10, bottom: -30, width: 80, height: 80, borderRadius: '50%', background: 'rgba(255,255,255,0.06)' }} />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', position: 'relative' }}>
        <div>
          <div style={{ fontSize: "1.75rem", fontWeight: 700, color: '#ffffff', lineHeight: 1.1, letterSpacing: '-0.02em' }}>
            {typeof value === 'number' ? value.toLocaleString() : value}
          </div>
          <div style={{ fontSize: "0.75rem", color: 'rgba(255,255,255,0.75)', marginTop: 4 }}>{label}</div>
        </div>
        <span style={{ color: 'rgba(255,255,255,0.6)', flexShrink: 0 }}>{icon}</span>
      </div>
      {trend && (
        <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 4, position: 'relative' }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            {trendUp
              ? <polyline points="18 15 12 9 6 15" />
              : <polyline points="6 9 12 15 18 9" />
            }
          </svg>
          <span style={{ fontSize: "0.688rem", color: 'rgba(255,255,255,0.7)' }}>{trend}</span>
        </div>
      )}
    </div>
  );
}

// ─── 主组件 ────────────────────────────────────────────────

export default function DashboardPage() {
  const [loading, setLoading] = useState(true);
  const [agents, setAgents] = useState<any[]>([]);
  const [classes, setClasses] = useState<any[]>([]);
  const [allClassrooms, setAllClassrooms] = useState<any[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [backups, setBackups] = useState<any[]>([]);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [a, c, cr, h, b] = await Promise.all([
        api.getAgents(),
        api.getClasses(),
        api.getAllClassrooms().catch(() => []),
        api.getHistory().catch(() => []),
        api.getBackups().catch(() => []),
      ]);
      setAgents(a || []);
      setClasses(c || []);
      setAllClassrooms(cr || []);
      setHistory(h || []);
      setBackups(b || []);
    } catch {}
    setLoading(false);
  };

  // ── AI 智能体 ──
  const agentTotal = agents.length;
  const agentEnabled = agents.filter(a => a.enabled !== false).length;
  const agentDisabled = agentTotal - agentEnabled;
  const agentOk = agents.filter(a => a.lastCheckOk === true).length;
  const agentError = agents.filter(a => a.lastCheckAt !== null && a.lastCheckOk === false).length;
  const agentPlatforms = agents.reduce((acc: Record<string, number>, a) => {
    const p = a.platform || 'unknown';
    acc[p] = (acc[p] || 0) + 1;
    return acc;
  }, {});

  // ── 班级 ──
  const classTotal = classes.length;
  const classTotalStudents = classes.reduce((sum, c) => sum + (c._count?.students || 0), 0);
  const classGroupTotal = classes.reduce((sum, c) => sum + (c._count?.groups || 0), 0);
  const classUsage = classes.map(c => {
    const count = allClassrooms.filter(cr =>
      cr.classes?.some((cc: any) => cc.classId === c.id)
    ).length;
    return { id: c.id, name: c.name, usageCount: count };
  });
  const classByUsage = classUsage.sort((a, b) => b.usageCount - a.usageCount).slice(0, 5);
  const classMaxUsage = Math.max(...classByUsage.map(c => c.usageCount), 1);

  // ── 课堂 ──
  const classroomTotal = allClassrooms.length;
  const classroomActive = allClassrooms.filter(c => c.status === 'active').length;
  const classroomPaused = allClassrooms.filter(c => c.status === 'paused').length;
  const classroomEnded = allClassrooms.filter(c => c.status === 'ended').length;
  const classroomByMode = allClassrooms.reduce((acc: Record<string, number>, c) => {
    const m = c.mode || 'standard';
    acc[m] = (acc[m] || 0) + 1;
    return acc;
  }, {});
  const classroomTotalInteractions = allClassrooms.reduce(
    (sum, c) => sum + (c._count?.interactions || 0), 0,
  );

  // ── 数据管理 ──
  const historyTotal = history.length;
  const historyParticipants = history.reduce(
    (sum, h) => sum + (Number(h.participantCount) || 0), 0,
  );
  const historyTotalChars = history.reduce(
    (sum, h) => sum + (Number(h.totalChars) || 0), 0,
  );
  const historyTotalDuration = history.reduce((sum, h) => {
    if (!h.endedAt) return sum;
    return sum + (new Date(h.endedAt).getTime() - new Date(h.createdAt).getTime());
  }, 0);
  const historyAvgDuration = historyTotal > 0
    ? Math.round(historyTotalDuration / historyTotal / 60000)
    : 0;

  // ── 备份 ──
  const backupTotal = backups.length;
  const backupTotalSize = backups.reduce((sum, b) => sum + (b.size || 0), 0);
  const backupLatest = backupTotal > 0
    ? new Date(backups.reduce((latest, b) => new Date(b.createdAt) > new Date(latest) ? b : backups[0]).createdAt)
    : null;

  const formatBytes = (bytes: number) =>
    bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : bytes >= 1024 ? `${(bytes / 1024).toFixed(0)} KB` : `${bytes} B`;

  const formatChars = (n: number) =>
    n >= 10000 ? `${(n / 10000).toFixed(1)}万` : `${n}`;

  // ── 渲染 ──

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '50vh' }}>
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" style={{ animation: 'spin 1s linear infinite' }}>
          <circle cx="12" cy="12" r="10" strokeDasharray="50" strokeDashoffset="15" strokeLinecap="round" />
        </svg>
        <span style={{ marginLeft: 10, color: '#94a3b8', fontSize: "0.875rem" }}>加载中...</span>
      </div>
    );
  }

  const platformEntries = Object.entries(agentPlatforms).sort((a, b) => b[1] - a[1]);
  const modeEntries = Object.entries(classroomByMode).sort((a, b) => b[1] - a[1]);

  // Recharts 数据
  const platformData = platformEntries.map(([k, v]) => ({
    name: platformLabels[k] || k,
    count: v,
    color: platformColors[k] || '#64748b',
    bg: platformBadgeBg[k] || '#f1f5f9',
  }));

  const modeData = modeEntries.map(([k, v]) => ({
    name: classroomModeLabels[k] || k,
    count: v,
    color: classroomModeColors[k] || '#64748b',
  }));

  const classData = classByUsage.map(c => ({
    name: c.name.length > 6 ? c.name.slice(0, 6) + '…' : c.name,
    count: c.usageCount,
    color: ['#6366f1', '#818cf8', '#a5b4fc', '#c7d2fe', '#ddd6fe'][classByUsage.indexOf(c)],
  }));

  const statusData = [
    { name: '进行中', value: classroomActive, color: '#10b981' },
    { name: '已暂停', value: classroomPaused, color: '#f59e0b' },
    { name: '已结束', value: classroomEnded, color: '#94a3b8' },
  ].filter(s => s.value > 0);

  const hasAgentData = agentTotal > 0;
  const hasClassData = classTotal > 0;
  const hasClassroomData = classroomTotal > 0;
  const hasHistoryData = historyTotal > 0;

  return (
    <div>

      {/* ═══ 页面标题 ═══ */}
      <div style={{
        marginBottom: 22, display: 'flex', alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <div>
          <h1 style={{ fontSize: "1.375rem", fontWeight: 700, margin: 0, color: '#0f172a' }}>仪表盘</h1>
          <p style={{ fontSize: "0.813rem", color: '#94a3b8', margin: '2px 0 0' }}>{greeting()}，以下是系统整体概览</p>
        </div>
        <button className="btn btn-primary" onClick={loadData}
          style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: "0.813rem", padding: '8px 16px' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2.5" strokeLinecap="round">
            <polyline points="23 4 23 10 17 10" />
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
          </svg>
          刷新数据
        </button>
      </div>

      {/* ═══ 核心 KPI 行 ═══ */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 22 }}>
        <KpiCard
          label="AI 智能体"
          value={`${agentEnabled}/${agentTotal}`}
          color="#2563eb"
          trend={agentError > 0 ? `${agentError} 个异常` : '全部正常'}
          trendUp={agentError === 0}
          icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><rect x="4" y="4" width="16" height="16" rx="3" /><path d="M9 12h6" /><path d="M12 9v6" /></svg>}
        />
        <KpiCard
          label="班级总数"
          value={classTotal}
          color="#10b981"
          trend={`${classTotalStudents} 名学生 · ${classGroupTotal} 个分组`}
          trendUp
          icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /></svg>}
        />
        <KpiCard
          label="进行中课堂"
          value={classroomActive > 0 ? `${classroomActive}/${classroomTotal}` : classroomTotal}
          color="#f59e0b"
          trend={classroomActive > 0 ? `${classroomActive} 个课堂正在进行` : '暂无活跃课堂'}
          trendUp={classroomActive > 0}
          icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><rect x="2" y="3" width="20" height="14" rx="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" /></svg>}
        />
        <KpiCard
          label="总互动次数"
          value={classroomTotalInteractions}
          color="#7c3aed"
          trend={`${historyTotal} 节历史课堂`}
          trendUp
          icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>}
        />
      </div>

      {/* ═══ 四宫格核心卡片 ═══ */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16, marginBottom: 0 }}>

        {/* ─── AI 智能体 ─── */}
        <SectionCard title="AI 智能体" color="#2563eb"
          icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round">
            <rect x="4" y="4" width="16" height="16" rx="3" />
            <path d="M9 12h6" /><path d="M12 9v6" />
          </svg>}
        >
          {!hasAgentData ? (
            <div style={{ textAlign: 'center', padding: '32px 0', color: '#94a3b8', fontSize: "0.75rem" }}>
              暂无智能体数据
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* 数字概览 + 健康状态 */}
              <div style={{ display: 'flex', gap: 12 }}>
                {[
                  { label: '总接入', value: agentTotal, color: '#2563eb', bg: '#eef2ff' },
                  { label: '启用中', value: agentEnabled, color: '#10b981', bg: '#f0fdf4' },
                  { label: '已停用', value: agentDisabled, color: '#94a3b8', bg: '#f8fafc' },
                ].map(s => (
                  <div key={s.label} style={{ flex: 1, background: s.bg, borderRadius: 10, padding: '10px 8px', textAlign: 'center' }}>
                    <div style={{ fontSize: "1.25rem", fontWeight: 700, color: s.color, lineHeight: 1.1 }}>
                      {s.value}
                    </div>
                    <div style={{ fontSize: "0.688rem", color: '#64748b', marginTop: 2 }}>{s.label}</div>
                  </div>
                ))}
              </div>

              {/* 健康状态指示器 */}
              {(agentOk > 0 || agentError > 0) && (
                <div style={{ display: 'flex', gap: 24, padding: '8px 4px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#22c55e', flexShrink: 0, boxShadow: '0 0 6px rgba(34,197,94,0.4)' }} />
                    <span style={{ fontSize: "0.75rem", color: '#16a34a', fontWeight: 500 }}>正常 {agentOk}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: agentError > 0 ? '#ef4444' : '#e2e8f0', flexShrink: 0, boxShadow: agentError > 0 ? '0 0 6px rgba(239,68,68,0.4)' : 'none' }} />
                    <span style={{ fontSize: "0.75rem", color: agentError > 0 ? '#dc2626' : '#94a3b8', fontWeight: 500 }}>异常 {agentError}</span>
                  </div>
                  <div style={{ flex: 1, textAlign: 'right' }}>
                    <span style={{ fontSize: "0.688rem", color: '#94a3b8' }}>
                      健康率 {agentTotal > 0 ? Math.round((agentOk / agentTotal) * 100) : 0}%
                    </span>
                  </div>
                </div>
              )}

              {/* 接入方式分布 */}
              {platformData.length > 0 && (
                <div>
                  <div style={{ fontSize: "0.688rem", fontWeight: 600, color: '#64748b', marginBottom: 8 }}>
                    接入方式分布
                  </div>
                  <ResponsiveContainer width="100%" height={platformData.length * 28 + 8}>
                    <BarChart data={platformData} layout="vertical" margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                      <XAxis type="number" hide />
                      <YAxis type="category" dataKey="name" tick={{ fontSize: "0.688rem", fill: '#475569' }} width={56} axisLine={false} tickLine={false} />
                      <Tooltip content={<ChartTooltip />} cursor={{ fill: '#f1f5f9' }} />
                      <Bar dataKey="count" radius={[0, 3, 3, 0]} barSize={10}>
                        {platformData.map((entry, i) => (
                          <Cell key={i} fill={entry.color} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          )}
        </SectionCard>

        {/* ─── 课堂管理 ─── */}
        <SectionCard title="课堂管理" color="#f59e0b"
          icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round">
            <rect x="2" y="3" width="20" height="14" rx="2" />
            <line x1="8" y1="21" x2="16" y2="21" />
            <line x1="12" y1="17" x2="12" y2="21" />
          </svg>}
        >
          {!hasClassroomData ? (
            <div style={{ textAlign: 'center', padding: '32px 0', color: '#94a3b8', fontSize: "0.75rem" }}>
              暂无课堂数据
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* 状态分布 — 环形图 */}
              {statusData.length > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                  <div style={{ position: 'relative', width: 100, height: 100, flexShrink: 0 }}>
                    <ResponsiveContainer width={100} height={100}>
                      <PieChart>
                        <Pie
                          data={statusData}
                          cx="50%" cy="50%"
                          innerRadius={32} outerRadius={46}
                          dataKey="value"
                          startAngle={90} endAngle={-270}
                          stroke="none"
                        >
                          {statusData.map((entry, i) => (
                            <Cell key={i} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip content={<ChartTooltip />} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', textAlign: 'center' }}>
                      <div style={{ fontSize: "1.125rem", fontWeight: 700, color: '#0f172a', lineHeight: 1 }}>{classroomTotal}</div>
                      <div style={{ fontSize: "0.625rem", color: '#94a3b8' }}>总计</div>
                    </div>
                  </div>
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {statusData.map(s => (
                      <div key={s.name} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: "0.75rem" }}>
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: s.color, flexShrink: 0 }} />
                        <span style={{ color: '#64748b', flex: 1 }}>{s.name}</span>
                        <span style={{ fontWeight: 600, color: s.color, fontSize: "0.875rem" }}>{s.value}</span>
                        <span style={{ color: '#94a3b8', fontSize: "0.688rem" }}>
                          {classroomTotal > 0 ? Math.round((s.value / classroomTotal) * 100) : 0}%
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 模式分布 */}
              {modeData.length > 0 && (
                <div>
                  <div style={{ fontSize: "0.688rem", fontWeight: 600, color: '#64748b', marginBottom: 8 }}>
                    课堂模式分布
                  </div>
                  <ResponsiveContainer width="100%" height={modeData.length * 28 + 8}>
                    <BarChart data={modeData} layout="vertical" margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                      <XAxis type="number" hide />
                      <YAxis type="category" dataKey="name" tick={{ fontSize: "0.688rem", fill: '#475569' }} width={56} axisLine={false} tickLine={false} />
                      <Tooltip content={<ChartTooltip />} cursor={{ fill: '#f1f5f9' }} />
                      <Bar dataKey="count" radius={[0, 3, 3, 0]} barSize={10}>
                        {modeData.map((entry, i) => (
                          <Cell key={i} fill={entry.color} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          )}
        </SectionCard>

        {/* ─── 班级管理 ─── */}
        <SectionCard title="班级管理" color="#10b981"
          icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
            <path d="M16 3.13a4 4 0 0 1 0 7.75" />
          </svg>}
        >
          {!hasClassData ? (
            <div style={{ textAlign: 'center', padding: '32px 0', color: '#94a3b8', fontSize: "0.75rem" }}>
              暂无班级数据
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* 数字概览 */}
              <div style={{ display: 'flex', gap: 12 }}>
                {[
                  { label: '总班级', value: classTotal, color: '#10b981', bg: '#f0fdf4' },
                  { label: '总学生', value: classTotalStudents, color: '#8b5cf6', bg: '#f5f3ff' },
                  { label: '总分组', value: classGroupTotal, color: '#f59e0b', bg: '#fffbeb' },
                ].map(s => (
                  <div key={s.label} style={{ flex: 1, background: s.bg, borderRadius: 10, padding: '10px 8px', textAlign: 'center' }}>
                    <div style={{ fontSize: "1.25rem", fontWeight: 700, color: s.color, lineHeight: 1.1 }}>
                      {s.value}
                    </div>
                    <div style={{ fontSize: "0.688rem", color: '#64748b', marginTop: 2 }}>{s.label}</div>
                  </div>
                ))}
              </div>

              {/* 最常用班级 */}
              {classData.length > 0 && (
                <div>
                  <div style={{ fontSize: "0.688rem", fontWeight: 600, color: '#64748b', marginBottom: 8 }}>
                    最常用班级
                  </div>
                  <ResponsiveContainer width="100%" height={classData.length * 28 + 8}>
                    <BarChart data={classData} layout="vertical" margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                      <XAxis type="number" hide />
                      <YAxis type="category" dataKey="name" tick={{ fontSize: "0.688rem", fill: '#475569' }} width={40} axisLine={false} tickLine={false} />
                      <Tooltip content={<ChartTooltip />} cursor={{ fill: '#f1f5f9' }} />
                      <Bar dataKey="count" radius={[0, 3, 3, 0]} barSize={10}>
                        {classData.map((entry, i) => (
                          <Cell key={i} fill={entry.color} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          )}
        </SectionCard>

        {/* ─── 数据管理 ─── */}
        <SectionCard title="数据管理" color="#7c3aed"
          icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round">
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>}
        >
          {!hasHistoryData && backupTotal === 0 ? (
            <div style={{ textAlign: 'center', padding: '32px 0', color: '#94a3b8', fontSize: "0.75rem" }}>
              暂无数据
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
                {[
                  { label: '已结束课堂', value: historyTotal, color: '#7c3aed', bg: '#f5f3ff' },
                  { label: '参与人次', value: historyParticipants, color: '#0891b2', bg: '#ecfeff' },
                  ...(backupTotal > 0 ? [
                    { label: '备份文件', value: `${backupTotal} 个 · ${formatBytes(backupTotalSize)}`, color: '#059669', bg: '#f0fdf4' },
                    { label: '最近备份', value: backupLatest ? backupLatest.toLocaleDateString('zh-CN') : '-', color: '#0f172a', bg: '#f8fafc' },
                  ] : [
                    { label: '备份文件', value: 0, color: '#94a3b8', bg: '#f8fafc' },
                  ]),
                ].map(s => (
                  <div key={s.label} style={{ background: s.bg, borderRadius: 10, padding: '12px 10px', textAlign: 'center' }}>
                    <div style={{ fontSize: "1.125rem", fontWeight: 700, color: s.color, lineHeight: 1.1 }}>
                      {typeof s.value === 'number' ? s.value.toLocaleString() : s.value}
                    </div>
                    <div style={{ fontSize: "0.688rem", color: '#64748b', marginTop: 2 }}>
                      {s.label}
                    </div>
                  </div>
                ))}
              </div>
              {backupTotal > 0 && (
                <div style={{ fontSize: "0.688rem", color: '#94a3b8', textAlign: 'center', paddingTop: 4, borderTop: '1px solid #f1f5f9' }}>
                  备份文件保障数据安全，可随时恢复
                </div>
              )}
            </div>
          )}
        </SectionCard>

      </div>
    </div>
  );
}
