'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import {
  platformLabels, platformColors, platformBadgeBg,
  classroomModeLabels, classroomModeColors, classroomModeBg,
} from '@/lib/constants';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell,
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

function StackedBarTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const total = payload.reduce((sum: number, p: any) => sum + (p.value || 0), 0);
  const usageItem = payload.find((p: any) => p.name === '使用次数');
  return (
    <div style={{ background: '#1e293b', border: 'none', borderRadius: 6, padding: '6px 10px', fontSize: "0.75rem", color: '#f1f5f9', boxShadow: '0 4px 12px rgba(0,0,0,0.25)' }}>
      <div style={{ fontWeight: 600, marginBottom: 4, color: '#e2e8f0' }}>{payload[0]?.payload?.name}</div>
      {payload.filter((p: any) => p.name !== '使用次数').map((entry: any, i: number) => (
        <div key={i} style={{ color: entry.color || '#f1f5f9' }}>
          {entry.name}: {entry.value}人
        </div>
      ))}
      {usageItem && (
        <div style={{ color: '#f59e0b' }}>使用次数: {usageItem.value}</div>
      )}
      <div style={{ borderTop: '1px solid #334155', marginTop: 3, paddingTop: 3, color: '#f1f5f9' }}>
        总计: {total}人
      </div>
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

// ─── 辅助组件 ──────────────────────────────────────────────

function StatBar({ label, count, size, color }: { label: string; count: number; size: string; color: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: "0.75rem" }}>
      <span style={{ color: '#475569' }}>{label}</span>
      <span><b style={{ color }}>{count}</b> <span style={{ color: '#94a3b8' }}>{size}</span></span>
    </div>
  );
}

function StatBlock({ label, count, size, color }: { label: string; count: number; size: string; color: string }) {
  return (
    <div>
      <div style={{ fontSize: "0.688rem", fontWeight: 600, color: '#64748b', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: "0.813rem", fontWeight: 700, color }}>{count}</div>
      <div style={{ fontSize: "0.688rem", color: '#94a3b8' }}>{size}</div>
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
  const [shieldWords, setShieldWords] = useState<any[]>([]);
  const [shieldConfig, setShieldConfig] = useState<any>(null);
  const [storageStats, setStorageStats] = useState<any>(null);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [a, c, cr, h, b, sw, sconf, ss] = await Promise.all([
        api.getAgents(),
        api.getClasses(),
        api.getAllClassrooms().catch(() => []),
        api.getHistory().catch(() => []),
        api.getBackups().catch(() => []),
        api.getShieldWords().catch(() => []),
        api.getShieldConfig().catch(() => null),
        api.getStorageStats().catch(() => null),
      ]);
      setAgents(a || []);
      setClasses(c || []);
      setAllClassrooms(cr || []);
      setHistory(h || []);
      setBackups(b || []);
      setShieldWords(sw || []);
      setShieldConfig(sconf);
      setStorageStats(ss);
    } catch {}
    setLoading(false);
  };

  // ── AI 智能体 ──
  const agentTotal = agents.length;
  const agentEnabled = agents.filter(a => a.enabled !== false).length;
  const agentDisabled = agentTotal - agentEnabled;
  const agentOk = agents.filter(a => a.lastCheckOk === true).length;
  const agentError = agents.filter(a => a.lastCheckAt !== null && a.lastCheckOk === false).length;
  const agentPending = agentTotal - agentOk - agentError;
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
  const classByUsage = classUsage.sort((a, b) => a.name.localeCompare(b.name)).slice(0, 5);

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

  // ── 屏蔽词 ──
  const shieldCustomCount = shieldWords.filter(w => !w.builtin).length;
  const shieldBuiltinCount = shieldWords.filter(w => w.builtin).length;
  const shieldEnabled = shieldConfig?.enabled !== false;

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

  const stackedClassData = classByUsage.map(c => {
    const cls = classes.find(cl => cl.id === c.id);
    const maleCount = cls?.maleCount || 0;
    const femaleCount = cls?.femaleCount || 0;
    const unknownCount = Math.max(0, (cls?._count?.students || 0) - maleCount - femaleCount);
    return {
      name: c.name.length > 6 ? c.name.slice(0, 6) + '…' : c.name,
      usageCount: c.usageCount,
      maleCount,
      femaleCount,
      unknownCount,
    };
  });

  // ── 头像 ──
  const classAvatarData = [...classes]
    .sort((a, b) => (b.uploadedAvatarCount || 0) - (a.uploadedAvatarCount || 0))
    .slice(0, 5)
    .map(c => ({
      name: c.name.length > 8 ? c.name.slice(0, 8) + '…' : c.name,
      total: c._count?.students || 0,
      uploadedAvatar: c.uploadedAvatarCount || 0,
      remainingTokens: c.totalTokens || 0,
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
          trend={agentError > 0 ? `${agentError} 个异常` : '全部健康'}
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

              {/* 健康度 & 接入方式 — 双环形图 */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                {/* 健康度 */}
                <div>
                  <div style={{ fontSize: "0.688rem", fontWeight: 600, color: '#64748b', marginBottom: 6 }}>智能体健康度</div>
                  {agentTotal > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <div style={{ width: '100%', height: 10, background: '#e2e8f0', borderRadius: 5, overflow: 'hidden', display: 'flex' }}>
                        {agentError === 0 && agentPending === 0 ? (
                          <div style={{ width: '100%', height: '100%', background: '#22c55e', borderRadius: 5 }} />
                        ) : (
                          <>
                            {agentOk > 0 && (
                              <div style={{ width: `${(agentOk / agentTotal) * 100}%`, height: '100%', background: '#22c55e', borderRadius: '5px 0 0 5px', transition: 'width 0.4s' }} />
                            )}
                            {agentError > 0 && (
                              <div style={{ width: `${(agentError / agentTotal) * 100}%`, height: '100%', background: '#ef4444', borderRadius: agentPending > 0 ? '0' : '0 5px 5px 0', transition: 'width 0.4s' }} />
                            )}
                            {agentPending > 0 && (
                              <div style={{ flex: 1, height: '100%', background: '#d1d5db', borderRadius: '0 5px 5px 0' }} />
                            )}
                          </>
                        )}
                      </div>
                      <div style={{ display: 'flex', gap: 12, fontSize: "0.688rem" }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                          <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#22c55e', flexShrink: 0 }} />
                          <span style={{ color: '#475569' }}>健康</span>
                          <b style={{ color: '#16a34a' }}>{agentOk}</b>
                        </span>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                          <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#ef4444', flexShrink: 0 }} />
                          <span style={{ color: '#475569' }}>异常</span>
                          <b style={{ color: agentError === 0 ? '#94a3b8' : '#dc2626' }}>{agentError}</b>
                        </span>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                          <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#d1d5db', flexShrink: 0 }} />
                          <span style={{ color: '#475569' }}>未检测</span>
                          <b style={{ color: agentPending === 0 ? '#94a3b8' : '#94a3b8' }}>{agentPending}</b>
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div style={{ fontSize: "0.688rem", color: '#94a3b8', padding: '4px 0' }}>暂无数据</div>
                  )}
                </div>

                {/* 接入方式分布 */}
                <div>
                  <div style={{ fontSize: "0.688rem", fontWeight: 600, color: '#64748b', marginBottom: 6 }}>接入方式分布</div>
                  {platformData.length > 0 ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ position: 'relative', width: 80, height: 80, flexShrink: 0 }}>
                        <ResponsiveContainer width={80} height={80}>
                          <PieChart>
                            <Pie
                              data={platformData}
                              cx="50%" cy="50%"
                              innerRadius={24} outerRadius={36}
                              dataKey="count"
                              startAngle={90} endAngle={-270}
                              stroke="none"
                            >
                              {platformData.map((entry, i) => (
                                <Cell key={i} fill={entry.color} />
                              ))}
                            </Pie>
                            <Tooltip content={<ChartTooltip />} />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 3 }}>
                        {platformData.map(s => (
                          <div key={s.name} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: "0.688rem" }}>
                            <span style={{ width: 6, height: 6, borderRadius: '50%', background: s.color, flexShrink: 0 }} />
                            <span style={{ color: '#64748b', flex: 1 }}>{s.name}</span>
                            <span style={{ fontWeight: 600, color: s.color }}>
                              {agentTotal > 0 ? Math.round((s.count / agentTotal) * 100) : 0}%
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div style={{ fontSize: "0.688rem", color: '#94a3b8', padding: '4px 0' }}>暂无数据</div>
                  )}
                </div>
              </div>

              {/* 智能体使用率 */}
              {storageStats?.agentUsage?.length > 0 && (
                <div>
                  <div style={{ fontSize: "0.688rem", fontWeight: 600, color: '#64748b', marginBottom: 8 }}>
                    智能体使用率
                  </div>
                  <table style={{ width: '100%', fontSize: "0.688rem", borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ color: '#94a3b8', textAlign: 'left' }}>
                        <th style={{ padding: '5px 4px', borderBottom: '1px solid #e2e8f0' }}>智能体名称</th>
                        <th style={{ padding: '5px 4px', borderBottom: '1px solid #e2e8f0', textAlign: 'center' }}>状态</th>
                        <th style={{ padding: '5px 4px', borderBottom: '1px solid #e2e8f0', textAlign: 'center' }}>被引用数</th>
                        <th style={{ padding: '5px 4px', borderBottom: '1px solid #e2e8f0', textAlign: 'center' }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                            调用次数
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                              <line x1="12" y1="5" x2="12" y2="19" />
                              <polyline points="19 12 12 19 5 12" />
                            </svg>
                          </span>
                        </th>
                        <th style={{ padding: '5px 4px', borderBottom: '1px solid #e2e8f0', textAlign: 'center' }}>总字数</th>
                      </tr>
                    </thead>
                    <tbody>
                      {storageStats.agentUsage.slice(0, 5).map((a: any) => {
                        const agentInfo = agents.find(ag => ag.id === a.id);
                        const isEnabled = agentInfo?.enabled !== false;
                        const isHealthy = agentInfo?.lastCheckOk === true;
                        const isError = agentInfo?.lastCheckAt !== null && agentInfo?.lastCheckOk === false;
                        let statusLabel = '停用';
                        let statusColor = '#94a3b8';
                        let statusBg = '#f1f5f9';
                        if (isEnabled && agentInfo?.lastCheckAt === null) {
                          statusLabel = '未检测';
                          statusColor = '#94a3b8';
                          statusBg = '#f1f5f9';
                        } else if (isEnabled && isHealthy) {
                          statusLabel = '健康';
                          statusColor = '#16a34a';
                          statusBg = '#f0fdf4';
                        } else if (isEnabled && isError) {
                          statusLabel = '异常';
                          statusColor = '#dc2626';
                          statusBg = '#fef2f2';
                        }
                        return (
                        <tr key={a.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                          <td style={{ padding: '5px 4px', color: '#0f172a', fontWeight: 600, maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {a.name}
                          </td>
                          <td style={{ padding: '5px 4px', textAlign: 'center' }}>
                            <span style={{ display: 'inline-block', padding: '1px 5px', borderRadius: 4, fontSize: "0.625rem", background: statusBg, color: statusColor }}>
                              {statusLabel}
                            </span>
                          </td>
                          <td style={{ padding: '5px 4px', textAlign: 'center', color: '#475569' }}>{a.classroomCount}</td>
                          <td style={{ padding: '5px 4px', textAlign: 'center', fontWeight: 600, color: '#6366f1' }}>{a.totalCalls}</td>
                          <td style={{ padding: '5px 4px', textAlign: 'center', color: '#94a3b8' }}>{formatChars(a.totalChars)}</td>
                        </tr>
                        );
                      })}
                    </tbody>
                  </table>
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
              {/* 数字概览 */}
              <div style={{ display: 'flex', gap: 12 }}>
                {[
                  { label: '进行中', value: classroomActive, color: '#10b981', bg: '#f0fdf4' },
                  { label: '已暂停', value: classroomPaused, color: '#f59e0b', bg: '#fffbeb' },
                  { label: '已结束', value: classroomEnded, color: '#94a3b8', bg: '#f8fafc' },
                ].map(s => (
                  <div key={s.label} style={{ flex: 1, background: s.bg, borderRadius: 10, padding: '10px 8px', textAlign: 'center' }}>
                    <div style={{ fontSize: "1.25rem", fontWeight: 700, color: s.color, lineHeight: 1.1 }}>
                      {s.value}
                    </div>
                    <div style={{ fontSize: "0.688rem", color: '#64748b', marginTop: 2 }}>{s.label}</div>
                  </div>
                ))}
              </div>
              {/* 双环形图：模式占比 + 课堂附件空间占比 */}
              {modeData.length > 0 && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  {/* 模式占比 */}
                  <div>
                    <div style={{ fontSize: "0.688rem", fontWeight: 600, color: '#64748b', marginBottom: 6 }}>模式占比</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ position: 'relative', width: 80, height: 80, flexShrink: 0 }}>
                        <ResponsiveContainer width={80} height={80}>
                          <PieChart>
                            <Pie
                              data={modeData}
                              cx="50%" cy="50%"
                              innerRadius={24} outerRadius={36}
                              dataKey="count"
                              startAngle={90} endAngle={-270}
                              stroke="none"
                            >
                              {modeData.map((entry, i) => (
                                <Cell key={i} fill={entry.color} />
                              ))}
                            </Pie>
                            <Tooltip content={<ChartTooltip />} />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 3 }}>
                        {modeData.map(s => (
                          <div key={s.name} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: "0.688rem" }}>
                            <span style={{ width: 6, height: 6, borderRadius: '50%', background: s.color, flexShrink: 0 }} />
                            <span style={{ color: '#64748b', flex: 1 }}>{s.name}</span>
                            <span style={{ fontWeight: 600, color: s.color }}>
                              {classroomTotal > 0 ? Math.round((s.count / classroomTotal) * 100) : 0}%
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* 空间占比 */}
                  <div>
                    <div style={{ fontSize: "0.688rem", fontWeight: 600, color: '#64748b', marginBottom: 6 }}>空间占比</div>
                    {(() => {
                      const spaceColors = ['#6366f1', '#8b5cf6', '#a78bfa', '#94a3b8'];
                      const allClassrooms = storageStats?.classroomAttachments?.classrooms || [];
                      const sorted = [...allClassrooms].sort((a: any, b: any) => b.totalSize - a.totalSize);
                      const top3 = sorted.slice(0, 3).filter((cr: any) => cr.totalSize > 0);
                      const others = sorted.slice(3).reduce((sum: number, cr: any) => sum + cr.totalSize, 0);
                      const totalSize = sorted.reduce((sum: number, cr: any) => sum + cr.totalSize, 0);
                      const spaceData = top3.map((cr: any, i: number) => ({
                        name: cr.title || '(未命名)',
                        value: totalSize > 0 ? cr.totalSize : 0,
                        color: spaceColors[i],
                      }));
                      if (others > 0) spaceData.push({ name: '其它', value: others, color: spaceColors[3] });
                      return spaceData.length > 0 ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ position: 'relative', width: 80, height: 80, flexShrink: 0 }}>
                            <ResponsiveContainer width={80} height={80}>
                              <PieChart>
                                <Pie
                                  data={spaceData}
                                  cx="50%" cy="50%"
                                  innerRadius={24} outerRadius={36}
                                  dataKey="value"
                                  startAngle={90} endAngle={-270}
                                  stroke="none"
                                >
                                  {spaceData.map((entry, i) => (
                                    <Cell key={i} fill={entry.color} />
                                  ))}
                                </Pie>
                                <Tooltip content={<ChartTooltip />} />
                              </PieChart>
                            </ResponsiveContainer>
                          </div>
                          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 3 }}>
                            {spaceData.map((s: any) => (
                              <div key={s.name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: "0.688rem" }}>
                                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: s.color, flexShrink: 0 }} />
                                  <span style={{ color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 90 }}>{s.name}</span>
                                </span>
                                <span style={{ fontWeight: 600, color: s.name === '其它' ? '#94a3b8' : s.color }}>
                                  {totalSize > 0 ? Math.round((s.value / totalSize) * 100) : 0}%
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <div style={{ fontSize: "0.688rem", color: '#94a3b8', padding: '4px 0' }}>暂无数据</div>
                      );
                    })()}
                  </div>
                </div>
              )}

              {/* 课堂空间占用量 */}
              {storageStats?.classroomAttachments?.classrooms?.filter((cr: any) => cr.attachmentCount > 0).length > 0 && (
                <div>
                  <div style={{ fontSize: "0.688rem", fontWeight: 600, color: '#64748b', marginBottom: 8 }}>
                    课堂空间占用量
                  </div>
                  <table style={{ width: '100%', fontSize: "0.688rem", borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ color: '#94a3b8', textAlign: 'left' }}>
                        <th style={{ padding: '5px 4px', borderBottom: '1px solid #e2e8f0', width: 6 }}>#</th>
                        <th style={{ padding: '5px 4px', borderBottom: '1px solid #e2e8f0' }}>课堂名称</th>
                        <th style={{ padding: '5px 4px', borderBottom: '1px solid #e2e8f0', textAlign: 'center' }}>状态</th>
                        <th style={{ padding: '5px 4px', borderBottom: '1px solid #e2e8f0', textAlign: 'center' }}>附件数</th>
                        <th style={{ padding: '5px 4px', borderBottom: '1px solid #e2e8f0', textAlign: 'center' }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                            占用空间
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                              <line x1="12" y1="5" x2="12" y2="19" />
                              <polyline points="19 12 12 19 5 12" />
                            </svg>
                          </span>
                        </th>
                        <th style={{ padding: '5px 4px', borderBottom: '1px solid #e2e8f0', textAlign: 'center' }}>对话轮数</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...storageStats.classroomAttachments.classrooms]
                        .filter((cr: any) => cr.attachmentCount > 0)
                        .sort((a: any, b: any) => b.totalSize - a.totalSize)
                        .slice(0, 5)
                        .map((cr: any, i: number) => (
                        <tr key={cr.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                          <td style={{ padding: '5px 4px', color: '#94a3b8', textAlign: 'center' }}>{i + 1}</td>
                          <td style={{ padding: '5px 4px', color: '#0f172a', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {cr.title || '(未命名)'}
                          </td>
                          <td style={{ padding: '5px 4px', textAlign: 'center' }}>
                            <span style={{
                              display: 'inline-block', padding: '1px 5px', borderRadius: 4, fontSize: "0.625rem",
                              background: cr.status === 'active' ? '#dcfce7' : cr.status === 'ended' ? '#f1f5f9' : '#fef3c7',
                              color: cr.status === 'active' ? '#16a34a' : cr.status === 'ended' ? '#94a3b8' : '#d97706',
                            }}>
                              {cr.status === 'active' ? '进行中' : cr.status === 'ended' ? '已结束' : '已暂停'}
                            </span>
                          </td>
                          <td style={{ padding: '5px 4px', textAlign: 'center', fontWeight: 600, color: '#0f172a' }}>{cr.attachmentCount}</td>
                          <td style={{ padding: '5px 4px', textAlign: 'center', color: '#64748b' }}>{cr.totalSizeText}</td>
                          <td style={{ padding: '5px 4px', textAlign: 'center', color: '#64748b' }}>{cr.totalRounds}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
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

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                {/* 左: 最常用班级 */}
                {stackedClassData.length > 0 && (
                  <div>
                    <div style={{ fontSize: "0.688rem", fontWeight: 600, color: '#64748b', marginBottom: 8 }}>
                      最常用班级
                    </div>
                    <ResponsiveContainer width="100%" height={180}>
                      <ComposedChart data={stackedClassData} margin={{ top: 0, right: 10, bottom: 0, left: 10 }}>
                        <XAxis dataKey="name" tick={{ fontSize: "0.688rem", fill: '#475569' }} axisLine={false} tickLine={false} />
                        <YAxis hide />
                        <Tooltip content={<StackedBarTooltip />} cursor={{ fill: '#f1f5f9' }} />
                        <Bar dataKey="unknownCount" stackId="gender" fill="#cbd5e1" radius={[4, 4, 0, 0]} barSize={24} name="未设置" />
                        <Bar dataKey="femaleCount" stackId="gender" fill="#f472b6" barSize={24} name="女生" />
                        <Bar dataKey="maleCount" stackId="gender" fill="#6366f1" barSize={24} name="男生" />
                        <Line type="monotone" dataKey="usageCount" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3, fill: '#f59e0b' }} name="使用次数" />
                      </ComposedChart>
                    </ResponsiveContainer>
                    <div style={{ display: 'flex', gap: 14, fontSize: "0.688rem", marginTop: 6, justifyContent: 'center' }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#6366f1', flexShrink: 0 }} />
                        <span style={{ color: '#475569' }}>男生</span>
                      </span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#f472b6', flexShrink: 0 }} />
                        <span style={{ color: '#475569' }}>女生</span>
                      </span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#cbd5e1', flexShrink: 0 }} />
                        <span style={{ color: '#94a3b8' }}>未设置</span>
                      </span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                        <span style={{ width: 12, height: 2, background: '#f59e0b', flexShrink: 0, borderRadius: 1 }} />
                        <span style={{ color: '#475569' }}>使用次数</span>
                      </span>
                    </div>
                  </div>
                )}

                {/* 右: 头像分配概况 */}
                {classAvatarData.length > 0 && (
                  <div>
                    <div style={{ fontSize: "0.688rem", fontWeight: 600, color: '#64748b', marginBottom: 8 }}>
                      头像分配概况
                    </div>
                    <table style={{ width: '100%', fontSize: "0.688rem", borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ color: '#94a3b8' }}>
                          <th style={{ padding: '4px 4px', borderBottom: '1px solid #e2e8f0' }}>班级</th>
                          <th style={{ padding: '4px 4px', borderBottom: '1px solid #e2e8f0', textAlign: 'center' }}>人数</th>
                          <th style={{ padding: '4px 4px', borderBottom: '1px solid #e2e8f0', textAlign: 'center' }}>个性化头像</th>
                          <th style={{ padding: '4px 4px', borderBottom: '1px solid #e2e8f0', textAlign: 'center' }}>剩奖励次数</th>
                        </tr>
                      </thead>
                      <tbody>
                        {classAvatarData.map(c => (
                          <tr key={c.name} style={{ borderBottom: '1px solid #f1f5f9' }}>
                            <td style={{ padding: '5px 4px', color: '#0f172a', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 72 }}>
                              {c.name}
                            </td>
                            <td style={{ padding: '5px 4px', textAlign: 'center', fontWeight: 600, color: '#0f172a' }}>{c.total}</td>
                            <td style={{ padding: '5px 4px', textAlign: 'center', color: c.uploadedAvatar > 0 ? '#6366f1' : '#94a3b8' }}>{c.uploadedAvatar}</td>
                            <td style={{ padding: '5px 4px', textAlign: 'center', fontWeight: 600, color: c.remainingTokens > 0 ? '#10b981' : '#94a3b8' }}>{c.remainingTokens}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
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
          {!hasHistoryData && backupTotal === 0 && shieldCustomCount === 0 && shieldBuiltinCount === 0 ? (
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

              {/* 屏蔽词统计 */}
              {(shieldCustomCount > 0 || shieldBuiltinCount > 0) && (
                <div>
                  <div style={{ fontSize: "0.688rem", fontWeight: 600, color: '#64748b', marginBottom: 8, marginTop: 4 }}>
                    屏蔽词
                  </div>
                  <div style={{ display: 'flex', gap: 12 }}>
                    {[
                      { label: '自定义屏蔽词', value: shieldCustomCount, color: '#dc2626', bg: '#fef2f2' },
                      { label: '系统屏蔽词', value: shieldBuiltinCount, color: '#7c3aed', bg: '#f5f3ff' },
                    ].map(s => (
                      <div key={s.label} style={{ flex: 1, background: s.bg, borderRadius: 10, padding: '12px 10px', textAlign: 'center' }}>
                        <div style={{ fontSize: "1.125rem", fontWeight: 700, color: s.color, lineHeight: 1.1 }}>
                          {s.value.toLocaleString()}
                        </div>
                        <div style={{ fontSize: "0.688rem", color: '#64748b', marginTop: 2 }}>
                          {s.label}
                        </div>
                      </div>
                    ))}
                    <div style={{ flex: 1, background: shieldEnabled ? '#f0fdf4' : '#fef2f2', borderRadius: 10, padding: '12px 10px', textAlign: 'center', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
                        <span style={{ width: 7, height: 7, borderRadius: '50%', background: shieldEnabled ? '#22c55e' : '#ef4444', display: 'inline-block', flexShrink: 0 }} />
                        <span style={{ fontSize: "0.75rem", fontWeight: 600, color: shieldEnabled ? '#16a34a' : '#dc2626' }}>
                          {shieldEnabled ? '已开启' : '未开启'}
                        </span>
                      </div>
                      <div style={{ fontSize: "0.688rem", color: '#64748b', marginTop: 2 }}>屏蔽词开关</div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </SectionCard>

      </div>
    </div>
  );
}
