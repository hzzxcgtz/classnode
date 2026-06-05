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

function SectionCard({ title, icon, color, children }: {
  title: string; icon: React.ReactNode; color: string; children: React.ReactNode;
}) {
  return (
    <div style={{
      background: 'white', borderRadius: 14, border: '1px solid #e2e8f0',
      overflow: 'hidden',
    }}>
      <div style={{
        padding: '11px 16px', borderBottom: '1px solid #eef2f6',
        display: 'flex', alignItems: 'center', gap: 8,
        background: `linear-gradient(135deg, ${color}08, ${color}14)`,
      }}>
        <span style={{ color, display: 'flex' }}>{icon}</span>
        <h3 style={{ fontSize: 13, fontWeight: 700, margin: 0, color: '#0f172a' }}>{title}</h3>
      </div>
      <div style={{ padding: 14 }}>{children}</div>
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
    <div style={{ background: '#1e293b', border: 'none', borderRadius: 6, padding: '6px 10px', fontSize: 12, color: '#f1f5f9', boxShadow: '0 4px 12px rgba(0,0,0,0.25)' }}>
      {payload.map((entry: any, i: number) => (
        <div key={i} style={{ color: '#f1f5f9' }}>{entry.payload.name || entry.name}: {entry.value}</div>
      ))}
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

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [a, c, cr, h] = await Promise.all([
        api.getAgents(),
        api.getClasses(),
        api.getAllClassrooms().catch(() => []),
        api.getHistory().catch(() => []),
      ]);
      setAgents(a || []);
      setClasses(c || []);
      setAllClassrooms(cr || []);
      setHistory(h || []);
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

  const formatChars = (n: number) =>
    n >= 10000 ? `${(n / 10000).toFixed(1)}万` : `${n}`;

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
    name: c.name,
    count: c.usageCount,
    color: ['#6366f1', '#818cf8', '#a5b4fc', '#c7d2fe', '#ddd6fe'][classByUsage.indexOf(c)],
  }));

  const statusData = [
    { name: '进行中', value: classroomActive, color: '#10b981' },
    { name: '已暂停', value: classroomPaused, color: '#f59e0b' },
    { name: '已结束', value: classroomEnded, color: '#94a3b8' },
  ].filter(s => s.value > 0);

  return (
    <div>
      {/* ═══ 页面标题 ═══ */}
      <div style={{
        marginBottom: 20, display: 'flex', alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0, color: '#0f172a' }}>仪表盘</h1>
          <span style={{ fontSize: 13, color: '#94a3b8' }}>{greeting()}，以下是系统概览</span>
        </div>
        <button className="btn btn-primary" onClick={loadData}
          style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, padding: '8px 16px' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2.5" strokeLinecap="round">
            <polyline points="23 4 23 10 17 10" />
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
          </svg>
          刷新数据
        </button>
      </div>

      {/* ═══ 核心 KPI 行 ═══ */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 20 }}>
        {([
          { label: '智能体', value: `${agentEnabled}/${agentTotal}`, color: '#2563eb' },
          { label: '班级', value: classTotal, color: '#16a34a' },
          { label: '学生', value: classTotalStudents, color: '#8b5cf6' },
          { label: '进行中课堂', value: `${classroomActive}/${classroomTotal}`, color: '#f59e0b' },
          { label: '总互动', value: classroomTotalInteractions, color: '#0f172a' },
        ] as const).map(card => (
          <div key={card.label}
            onMouseEnter={e => {
              e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,0.06)';
              e.currentTarget.style.transform = 'translateY(-1px)';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.boxShadow = 'none';
              e.currentTarget.style.transform = 'none';
            }}
            style={{
              background: 'white', borderRadius: 12, border: '1px solid #e2e8f0',
              padding: '14px 16px', textAlign: 'center', cursor: 'default',
              transition: 'box-shadow 0.2s, transform 0.15s',
            }}
          >
            <div style={{ fontSize: 22, fontWeight: 700, color: card.color, lineHeight: 1.1 }}>
              {typeof card.value === 'number' ? card.value.toLocaleString() : card.value}
            </div>
            <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{card.label}</div>
          </div>
        ))}
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
          {agentTotal === 0 ? (
            <div style={{ textAlign: 'center', padding: '24px 0', color: '#94a3b8', fontSize: 12 }}>
              暂无智能体数据
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* 数字概览 */}
              <div style={{ display: 'flex', gap: 0 }}>
                {[
                  { label: '总接入', value: agentTotal, color: '#2563eb' },
                  { label: '启用中', value: agentEnabled, color: '#10b981' },
                  { label: '已停用', value: agentDisabled, color: '#94a3b8' },
                ].map(s => (
                  <div key={s.label} style={{ flex: 1, textAlign: 'center' }}>
                    <div style={{ fontSize: 18, fontWeight: 700, color: s.color, lineHeight: 1.1 }}>
                      {s.value}
                    </div>
                    <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>{s.label}</div>
                  </div>
                ))}
              </div>

              {/* 健康状态 */}
              {(agentOk > 0 || agentError > 0) && (
                <div style={{ display: 'flex', gap: 20, fontSize: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#22c55e', flexShrink: 0 }} />
                    <span style={{ color: '#16a34a', fontWeight: 500 }}>正常</span>
                    <span style={{ color: '#64748b' }}>{agentOk}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#ef4444', flexShrink: 0 }} />
                    <span style={{ color: '#dc2626', fontWeight: 500 }}>异常</span>
                    <span style={{ color: '#64748b' }}>{agentError}</span>
                  </div>
                </div>
              )}

              {/* 接入方式分布 */}
              {platformData.length > 0 && (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#64748b', marginBottom: 8 }}>
                    接入方式
                  </div>
                  <ResponsiveContainer width="100%" height={platformData.length * 28 + 8}>
                    <BarChart data={platformData} layout="vertical" margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                      <XAxis type="number" hide />
                      <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: '#475569' }} width={56} axisLine={false} tickLine={false} />
                      <Tooltip content={<ChartTooltip />} cursor={{ fill: '#f1f5f9' }} />
                      <Bar dataKey="count" radius={[0, 3, 3, 0]} barSize={8}>
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

        {/* ─── 班级管理 ─── */}
        <SectionCard title="班级管理" color="#16a34a"
          icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
          </svg>}
        >
          {classTotal === 0 ? (
            <div style={{ textAlign: 'center', padding: '24px 0', color: '#94a3b8', fontSize: 12 }}>
              暂无班级数据
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* 数字概览 */}
              <div style={{ display: 'flex', gap: 0 }}>
                {[
                  { label: '总班级', value: classTotal, color: '#16a34a' },
                  { label: '总学生', value: classTotalStudents, color: '#8b5cf6' },
                  { label: '总分组数', value: classGroupTotal, color: '#f59e0b' },
                ].map(s => (
                  <div key={s.label} style={{ flex: 1, textAlign: 'center' }}>
                    <div style={{ fontSize: 18, fontWeight: 700, color: s.color, lineHeight: 1.1 }}>
                      {s.value}
                    </div>
                    <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>{s.label}</div>
                  </div>
                ))}
              </div>

              {/* 最常用班级 */}
              {classData.length > 0 && (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#64748b', marginBottom: 8 }}>
                    最常用班级（课堂引用次数）
                  </div>
                  <ResponsiveContainer width="100%" height={classData.length * 28 + 8}>
                    <BarChart data={classData} layout="vertical" margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                      <XAxis type="number" hide />
                      <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: '#475569' }} width={40} axisLine={false} tickLine={false} />
                      <Tooltip content={<ChartTooltip />} cursor={{ fill: '#f1f5f9' }} />
                      <Bar dataKey="count" radius={[0, 3, 3, 0]} barSize={8}>
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

        {/* ─── 课堂管理 ─── */}
        <SectionCard title="课堂管理" color="#f59e0b"
          icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round">
            <rect x="2" y="3" width="20" height="14" rx="2" />
            <line x1="8" y1="21" x2="16" y2="21" />
            <line x1="12" y1="17" x2="12" y2="21" />
          </svg>}
        >
          {classroomTotal === 0 ? (
            <div style={{ textAlign: 'center', padding: '24px 0', color: '#94a3b8', fontSize: 12 }}>
              暂无课堂数据
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* 状态分布 — 环形图 */}
              {statusData.length > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <ResponsiveContainer width={90} height={90}>
                    <PieChart>
                      <Pie
                        data={statusData}
                        cx="50%" cy="50%"
                        innerRadius={28} outerRadius={40}
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
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 5 }}>
                    {statusData.map(s => (
                      <div key={s.name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                          <span style={{ width: 7, height: 7, borderRadius: '50%', background: s.color, flexShrink: 0 }} />
                          <span style={{ color: '#64748b' }}>{s.name}</span>
                        </div>
                        <span style={{ fontWeight: 600, color: s.color }}>{s.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 模式分布 */}
              {modeData.length > 0 && (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#64748b', marginBottom: 6 }}>
                    课堂模式
                  </div>
                  <ResponsiveContainer width="100%" height={modeData.length * 28 + 8}>
                    <BarChart data={modeData} layout="vertical" margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                      <XAxis type="number" hide />
                      <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: '#475569' }} width={56} axisLine={false} tickLine={false} />
                      <Tooltip content={<ChartTooltip />} cursor={{ fill: '#f1f5f9' }} />
                      <Bar dataKey="count" radius={[0, 3, 3, 0]} barSize={8}>
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

        {/* ─── 数据管理 ─── */}
        <SectionCard title="数据管理" color="#7c3aed"
          icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round">
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>}
        >
          {historyTotal === 0 ? (
            <div style={{ textAlign: 'center', padding: '24px 0', color: '#94a3b8', fontSize: 12 }}>
              暂无数据
            </div>
          ) : (
            <div style={{
              padding: '4px 0',
              display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16,
            }}>
              {[
                { label: '已结束课堂', value: historyTotal, color: '#7c3aed' },
                { label: '参与人次', value: historyParticipants, color: '#0891b2' },
                { label: '总文字量', value: formatChars(historyTotalChars), color: '#db2777' },
                { label: '平均时长', value: `${historyAvgDuration}`, unit: '分钟/课', color: '#0f172a' },
              ].map(s => (
                <div key={s.label} style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 20, fontWeight: 700, color: s.color, lineHeight: 1.1 }}>
                    {typeof s.value === 'number' ? s.value.toLocaleString() : s.value}
                    {s.unit && <span style={{ fontSize: 11, fontWeight: 400, color: '#94a3b8', marginLeft: 3 }}>{s.unit}</span>}
                  </div>
                  <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>{s.label}</div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>

      </div>
    </div>
  );
}
