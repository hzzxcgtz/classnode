'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { platformColors, platformLabels, classroomModeLabels } from '@/lib/constants';
import {
  Bar, BarChart, Cell, Pie, PieChart, RadialBar, RadialBarChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import type {
  AgentSummary, BackupFile, ClassroomHistoryItem, ClassroomWarningSummary,
  DashboardClassroom, ShieldWord, StorageStats, WebappSummary, WorksheetSummary,
} from '@/lib/types';
import { TeacherPageHeader } from '@/lib/components';

type ChartPayloadItem = {
  name?: string;
  value?: number;
  color?: string;
  payload?: { name?: string; label?: string };
};

const COLORS = {
  primary: '#4f759d', primarySoft: '#91abc3', green: '#4e8063',
  amber: '#a7773e', red: '#a85d5d', grey: '#c6d0d9', slate: '#6f8295',
};

function greeting() {
  const hour = new Date().getHours();
  if (hour < 6) return '夜深了';
  if (hour < 9) return '早上好';
  if (hour < 12) return '上午好';
  if (hour < 14) return '中午好';
  if (hour < 18) return '下午好';
  return '晚上好';
}

function formatBytes(bytes: number) {
  if (bytes >= 1073741824) return `${(bytes / 1073741824).toFixed(1)} GB`;
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

function formatDuration(ms: number) {
  if (ms <= 0) return '无记录';
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest > 0 ? `${hours} 小时 ${rest} 分钟` : `${hours} 小时`;
}

function formatDate(value?: string | Date | null, withTime = false) {
  if (!value) return '-';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('zh-CN', withTime
    ? { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }
    : { year: 'numeric', month: '2-digit', day: '2-digit' });
}

async function loadAllWorksheets(): Promise<WorksheetSummary[]> {
  const first = await api.getWorksheets({ page: 1, pageSize: 100 });
  const pages = Math.ceil(first.total / first.pageSize);
  if (pages <= 1) return first.items;
  const rest = await Promise.all(
    Array.from({ length: pages - 1 }, (_, index) => api.getWorksheets({ page: index + 2, pageSize: 100 })),
  );
  return [first, ...rest].flatMap(result => result.items);
}

function ChartTooltip({ active, payload, suffix = '' }: {
  active?: boolean;
  payload?: ChartPayloadItem[];
  suffix?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="dashboard-chart-tooltip">
      {payload.map((entry, index) => (
        <div key={`${entry.name}-${index}`}>
          {entry.payload?.label || entry.payload?.name || entry.name}: {Number(entry.value || 0).toLocaleString()}{suffix}
        </div>
      ))}
    </div>
  );
}

function SectionCard({ title, description, icon, action, wide, children }: {
  title: string;
  description: string;
  icon: React.ReactNode;
  action?: React.ReactNode;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className={`dashboard-section-card${wide ? ' is-wide' : ''}`}>
      <div className="dashboard-section-card-header">
        <span className="dashboard-section-card-icon">{icon}</span>
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
        {action && <div className="dashboard-section-action">{action}</div>}
      </div>
      <div className="dashboard-section-card-body">{children}</div>
    </section>
  );
}

function KpiCard({ label, value, note, tone = 'blue', icon }: {
  label: string;
  value: string | number;
  note: string;
  tone?: 'blue' | 'green' | 'amber' | 'red';
  icon: React.ReactNode;
}) {
  return (
    <section className={`dashboard-kpi-card tone-${tone}`}>
      <div className="dashboard-kpi-card-main">
        <div>
          <div className="dashboard-kpi-label">{label}</div>
          <div className="dashboard-kpi-value">{typeof value === 'number' ? value.toLocaleString() : value}</div>
        </div>
        <span className="dashboard-kpi-icon">{icon}</span>
      </div>
      <div className="dashboard-kpi-note">{note}</div>
    </section>
  );
}

function MiniStats({ items }: {
  items: Array<{ label: string; value: string | number; tone?: 'default' | 'green' | 'amber' | 'red' }>;
}) {
  return (
    <div className="dashboard-mini-stats">
      {items.map(item => (
        <div key={item.label} className={`dashboard-mini-stat tone-${item.tone || 'default'}`}>
          <strong>{typeof item.value === 'number' ? item.value.toLocaleString() : item.value}</strong>
          <span>{item.label}</span>
        </div>
      ))}
    </div>
  );
}

function EmptyBlock({ children }: { children: React.ReactNode }) {
  return <div className="dashboard-empty-block">{children}</div>;
}

export default function DashboardPage() {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [allClassrooms, setAllClassrooms] = useState<DashboardClassroom[]>([]);
  const [history, setHistory] = useState<ClassroomHistoryItem[]>([]);
  const [worksheets, setWorksheets] = useState<WorksheetSummary[]>([]);
  const [webapps, setWebapps] = useState<WebappSummary[]>([]);
  const [backups, setBackups] = useState<BackupFile[]>([]);
  const [shieldWords, setShieldWords] = useState<ShieldWord[]>([]);
  const [warnings, setWarnings] = useState<ClassroomWarningSummary[]>([]);
  const [storageStats, setStorageStats] = useState<StorageStats | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadData(); }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function loadData() {
    setLoading(true);
    setLoadError(false);
    try {
      let partialFailure = false;
      const safe = async <T,>(promise: Promise<T>, fallback: T): Promise<T> => {
        try {
          return await promise;
        } catch {
          partialFailure = true;
          return fallback;
        }
      };
      const [agentData, classroomData, historyData, worksheetData, webappData, backupData, shieldData, warningData, storageData] = await Promise.all([
        safe(api.getAgents(), [] as AgentSummary[]),
        safe(api.getAllClassrooms(), [] as DashboardClassroom[]),
        safe(api.getHistory(), [] as ClassroomHistoryItem[]),
        safe(loadAllWorksheets(), [] as WorksheetSummary[]),
        safe(api.getWebapps(), [] as WebappSummary[]),
        safe(api.getBackups(), [] as BackupFile[]),
        safe(api.getShieldWords(), [] as ShieldWord[]),
        safe(api.getWarningsSummary(), [] as ClassroomWarningSummary[]),
        safe(api.getStorageStats(), null as StorageStats | null),
      ]);
      setAgents(agentData || []);
      setAllClassrooms(classroomData || []);
      setHistory(historyData || []);
      setWorksheets(worksheetData || []);
      setWebapps(webappData || []);
      setBackups(backupData || []);
      setShieldWords(shieldData || []);
      setWarnings(warningData || []);
      setStorageStats(storageData);
      setLoadError(partialFailure);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="dashboard-loading" aria-label="正在加载仪表盘">
        <div className="dashboard-loading-head" />
        <div className="dashboard-loading-kpis">{Array.from({ length: 4 }, (_, index) => <div key={index} />)}</div>
        <div className="dashboard-loading-sections">{Array.from({ length: 4 }, (_, index) => <div key={index} />)}</div>
      </div>
    );
  }

  const agentTotal = agents.length;
  const agentEnabled = agents.filter(agent => agent.enabled !== false).length;
  const agentOk = agents.filter(agent => agent.enabled !== false && agent.lastCheckOk === true).length;
  const agentError = agents.filter(agent => agent.enabled !== false && agent.lastCheckAt !== null && agent.lastCheckOk === false).length;
  const agentPending = agents.filter(agent => agent.enabled !== false && agent.lastCheckAt === null).length;
  const healthPercent = agentEnabled > 0 ? Math.round((agentOk / agentEnabled) * 100) : 0;
  const healthColor = agentError > 0 ? COLORS.red : agentPending > 0 ? COLORS.amber : COLORS.green;
  const platformData = Object.entries(agents.reduce<Record<string, number>>((result, agent) => {
    result[agent.platform || 'unknown'] = (result[agent.platform || 'unknown'] || 0) + 1;
    return result;
  }, {})).sort((a, b) => b[1] - a[1]).map(([key, value]) => ({
    name: platformLabels[key] || key, value, color: platformColors[key] || COLORS.slate,
  }));

  const classroomActive = allClassrooms.filter(classroom => classroom.status === 'active').length;
  const classroomPaused = allClassrooms.filter(classroom => classroom.status === 'paused').length;
  const classroomEnded = allClassrooms.filter(classroom => classroom.status === 'ended').length;
  const classroomParticipants = allClassrooms.filter(classroom => classroom.status !== 'ended')
    .reduce((sum, classroom) => sum + (Number(classroom.participantCount) || 0), 0);
  const classroomStatusData = [
    { name: '进行中', value: classroomActive, color: COLORS.green },
    { name: '已暂停', value: classroomPaused, color: COLORS.amber },
    { name: '已结束', value: classroomEnded, color: COLORS.grey },
  ].filter(item => item.value > 0);
  const classroomModeData = Object.entries(allClassrooms.reduce<Record<string, number>>((result, classroom) => {
    result[classroom.mode || 'standard'] = (result[classroom.mode || 'standard'] || 0) + 1;
    return result;
  }, {})).map(([mode, value]) => ({ name: classroomModeLabels[mode] || mode, value }));
  const recentClassrooms = [...allClassrooms]
    .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()).slice(0, 5);

  const worksheetTotal = worksheets.length;
  const worksheetUsed = worksheets.filter(worksheet => worksheet.classroomCount > 0).length;
  const worksheetUnused = worksheetTotal - worksheetUsed;
  const worksheetQuestionTotal = worksheets.reduce((sum, worksheet) => sum + worksheet.questionCount, 0);
  const worksheetSubmitted = history.reduce((sum, classroom) => sum + classroom.worksheetSubmitted, 0);
  const worksheetAnswers = history.reduce((sum, classroom) => sum + classroom.worksheetTotal, 0);
  const worksheetUsageData = [
    { name: '已用于课堂', value: worksheetUsed, color: COLORS.primary },
    { name: '尚未使用', value: worksheetUnused, color: COLORS.grey },
  ].filter(item => item.value > 0);
  const topWorksheets = [...worksheets]
    .sort((a, b) => b.classroomCount - a.classroomCount || b.questionCount - a.questionCount).slice(0, 5);
  const worksheetBarData = topWorksheets.map(worksheet => ({
    name: worksheet.title.length > 8 ? `${worksheet.title.slice(0, 8)}…` : worksheet.title,
    label: worksheet.title, value: worksheet.classroomCount,
  }));

  const webappTotal = webapps.length;
  const webappUsed = webapps.filter(webapp => webapp.classroomCount > 0).length;
  const webappUnused = webappTotal - webappUsed;
  const webappParticipants = history.reduce((sum, classroom) => sum + classroom.webappUsageCount, 0);
  const webappDuration = history.reduce((sum, classroom) => sum + classroom.webappDurationMs, 0);
  const webappUsageData = [
    { name: '已关联课堂', value: webappUsed, color: COLORS.green },
    { name: '尚未使用', value: webappUnused, color: COLORS.grey },
  ].filter(item => item.value > 0);
  const topWebapps = [...webapps]
    .sort((a, b) => b.classroomCount - a.classroomCount || new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()).slice(0, 5);
  const webappBarData = topWebapps.map(webapp => ({
    name: webapp.name.length > 8 ? `${webapp.name.slice(0, 8)}…` : webapp.name,
    label: webapp.name, value: webapp.classroomCount,
  }));

  const backupLatest = backups.length > 0
    ? backups.reduce((latest, backup) => new Date(backup.createdAt) > new Date(latest.createdAt) ? backup : latest)
    : null;
  const backupSize = backups.reduce((sum, backup) => sum + (backup.size || 0), 0);
  const warningCount = warnings.reduce((sum, classroom) => sum + classroom.warningCount, 0);
  const enabledShieldWords = shieldWords.filter(word => word.enabled).length;
  const totalStorage = storageStats ? storageStats.avatars.teacher.totalSize + storageStats.avatars.student.totalSize
    + storageStats.classIcons.totalSize + storageStats.agentLogos.totalSize + storageStats.classroomAttachments.totalSize : 0;
  const storageData = storageStats ? [
    { name: '课堂附件', value: storageStats.classroomAttachments.totalSize },
    { name: '学生头像', value: storageStats.avatars.student.totalSize },
    { name: '教师头像', value: storageStats.avatars.teacher.totalSize },
    { name: '班级图标', value: storageStats.classIcons.totalSize },
    { name: '智能体标志', value: storageStats.agentLogos.totalSize },
  ] : [];

  return (
    <div className="dashboard-page">
      <TeacherPageHeader title="仪表盘" description={`${greeting()}，这里汇总当前系统的资源与运行状态。`} actions={
        <button className="btn btn-primary" onClick={() => void loadData()}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" /></svg>
          刷新数据
        </button>
      } />

      {loadError && <div className="dashboard-load-warning" role="alert">部分统计没有加载出来，请检查服务状态后重新刷新。</div>}

      <div className="dashboard-kpi-grid">
        <KpiCard label="AI 智能体" value={`${agentOk}/${agentEnabled}`} note={agentError > 0 ? `${agentError} 个连接异常` : agentPending > 0 ? `${agentPending} 个尚未检测` : '已启用智能体状态正常'} tone={agentError > 0 ? 'red' : agentPending > 0 ? 'amber' : 'green'} icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><rect x="4" y="5" width="16" height="14" rx="3" /><path d="M9 10h.01M15 10h.01M9 15h6M12 2v3" /></svg>} />
        <KpiCard label="当前课堂" value={classroomActive} note={classroomPaused > 0 ? `${classroomPaused} 个已暂停，${classroomParticipants} 个参与者` : `${classroomParticipants} 个参与者，当前无暂停课堂`} tone={classroomPaused > 0 ? 'amber' : classroomActive > 0 ? 'green' : 'blue'} icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8M12 17v4" /></svg>} />
        <KpiCard label="学习单" value={`${worksheetUsed}/${worksheetTotal}`} note={worksheetUnused > 0 ? `${worksheetUnused} 份尚未用于课堂` : worksheetTotal > 0 ? '全部学习单均已投入使用' : '还没有学习单'} tone={worksheetUnused > 0 ? 'amber' : 'blue'} icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M9 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2h-4" /><rect x="9" y="2" width="6" height="4" rx="1" /><path d="m8 12 2 2 4-4" /><path d="M8 18h8" /></svg>} />
        <KpiCard label="探究空间" value={`${webappUsed}/${webappTotal}`} note={webappUnused > 0 ? `${webappUnused} 个网页尚未关联课堂` : webappTotal > 0 ? '全部网页均已关联课堂' : '还没有探究网页'} tone={webappUnused > 0 ? 'amber' : 'blue'} icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18" /></svg>} />
      </div>

      <div className="dashboard-section-grid">
        <SectionCard title="AI 智能体" description="连接健康度、接入方式与实际使用情况" action={<a href="/teacher/agents/">管理智能体</a>} icon={<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><rect x="4" y="5" width="16" height="14" rx="3" /><path d="M9 10h.01M15 10h.01M9 15h6M12 2v3" /></svg>}>
          {agentTotal === 0 ? <EmptyBlock>还没有配置 AI 智能体。</EmptyBlock> : <>
            <MiniStats items={[{ label: '全部', value: agentTotal }, { label: '启用中', value: agentEnabled, tone: 'green' }, { label: '异常', value: agentError, tone: agentError > 0 ? 'red' : 'default' }, { label: '未检测', value: agentPending, tone: agentPending > 0 ? 'amber' : 'default' }]} />
            <div className="dashboard-chart-pair">
              <div className="dashboard-chart-block"><h3>健康度</h3><div className="dashboard-gauge"><ResponsiveContainer width="100%" height={126}><RadialBarChart innerRadius="58%" outerRadius="86%" data={[{ value: healthPercent, fill: healthColor }]} startAngle={180} endAngle={0} barSize={12}><RadialBar dataKey="value" cornerRadius={6} background={{ fill: '#e7edf2' }} /></RadialBarChart></ResponsiveContainer><div><strong style={{ color: healthColor }}>{healthPercent}%</strong><span>启用智能体</span></div></div></div>
              <div className="dashboard-chart-block"><h3>接入方式</h3><div className="dashboard-donut-row"><ResponsiveContainer width={112} height={112}><PieChart><Pie data={platformData} dataKey="value" innerRadius={31} outerRadius={48} stroke="none">{platformData.map(item => <Cell key={item.name} fill={item.color} />)}</Pie><Tooltip content={<ChartTooltip suffix=" 个" />} /></PieChart></ResponsiveContainer><div className="dashboard-chart-legend">{platformData.slice(0, 4).map(item => <div key={item.name}><i style={{ background: item.color }} /><span>{item.name}</span><strong>{item.value}</strong></div>)}</div></div></div>
            </div>
            {storageStats?.agentUsage.length ? <div className="dashboard-table-wrap"><table className="dashboard-table"><thead><tr><th>智能体</th><th>状态</th><th>关联课堂</th><th>调用次数</th></tr></thead><tbody>{storageStats.agentUsage.slice(0, 5).map(usage => { const agent = agents.find(item => item.id === usage.id); const status = agent?.enabled === false ? '已停用' : agent?.lastCheckOk === true ? '正常' : agent?.lastCheckAt ? '异常' : '未检测'; return <tr key={usage.id}><td className="dashboard-primary-cell">{usage.name}</td><td><span className={`dashboard-status status-${status === '正常' ? 'ok' : status === '异常' ? 'error' : 'muted'}`}>{status}</span></td><td>{usage.classroomCount}</td><td>{usage.totalCalls.toLocaleString()}</td></tr>; })}</tbody></table></div> : null}
          </>}
        </SectionCard>

        <SectionCard title="课堂运行" description="当前课堂状态与最近创建的课堂" action={<a href="/teacher/">查看课堂</a>} icon={<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8M12 17v4" /></svg>}>
          {allClassrooms.length === 0 ? <EmptyBlock>还没有课堂，创建课堂后会在这里显示运行状态。</EmptyBlock> : <>
            <MiniStats items={[{ label: '进行中', value: classroomActive, tone: 'green' }, { label: '已暂停', value: classroomPaused, tone: classroomPaused > 0 ? 'amber' : 'default' }, { label: '已结束', value: classroomEnded }, { label: '当前参与者', value: classroomParticipants }]} />
            <div className="dashboard-chart-pair">
              <div className="dashboard-chart-block"><h3>课堂状态</h3><div className="dashboard-donut-row"><ResponsiveContainer width={118} height={118}><PieChart><Pie data={classroomStatusData} dataKey="value" innerRadius={32} outerRadius={50} stroke="none">{classroomStatusData.map(item => <Cell key={item.name} fill={item.color} />)}</Pie><Tooltip content={<ChartTooltip suffix=" 个" />} /></PieChart></ResponsiveContainer><div className="dashboard-chart-legend">{classroomStatusData.map(item => <div key={item.name}><i style={{ background: item.color }} /><span>{item.name}</span><strong>{item.value}</strong></div>)}</div></div></div>
              <div className="dashboard-chart-block"><h3>课堂模式</h3><ResponsiveContainer width="100%" height={118}><BarChart data={classroomModeData} margin={{ top: 8, right: 6, left: 2, bottom: 0 }}><XAxis dataKey="name" tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} /><YAxis hide allowDecimals={false} /><Tooltip content={<ChartTooltip suffix=" 个" />} cursor={{ fill: '#f3f6f8' }} /><Bar dataKey="value" fill={COLORS.primarySoft} radius={[5, 5, 0, 0]} barSize={24} /></BarChart></ResponsiveContainer></div>
            </div>
            <div className="dashboard-table-wrap"><table className="dashboard-table"><thead><tr><th>最近课堂</th><th>状态</th><th>参与者</th><th>互动对象</th></tr></thead><tbody>{recentClassrooms.map(classroom => <tr key={classroom.id}><td><span className="dashboard-primary-cell">{classroom.title || '未命名课堂'}</span><small>{formatDate(classroom.createdAt, true)}</small></td><td><span className={`dashboard-status status-${classroom.status === 'active' ? 'ok' : classroom.status === 'paused' ? 'warning' : 'muted'}`}>{classroom.status === 'active' ? '进行中' : classroom.status === 'paused' ? '已暂停' : '已结束'}</span></td><td>{classroom.participantCount}</td><td>{classroom._count.interactions}</td></tr>)}</tbody></table></div>
          </>}
        </SectionCard>

        <SectionCard title="学习单" description="资源规模、课堂引用与历史作答情况" action={<a href="/teacher/worksheets/">管理学习单</a>} icon={<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2h-4" /><rect x="9" y="2" width="6" height="4" rx="1" /><path d="m8 12 2 2 4-4" /><path d="M8 18h8" /></svg>}>
          {worksheetTotal === 0 ? <EmptyBlock>还没有学习单，创建后会统计题目与课堂使用情况。</EmptyBlock> : <>
            <MiniStats items={[{ label: '学习单', value: worksheetTotal }, { label: '已使用', value: worksheetUsed, tone: 'green' }, { label: '题目总数', value: worksheetQuestionTotal }, { label: '近期提交题次', value: worksheetSubmitted }]} />
            <div className="dashboard-chart-pair">
              <div className="dashboard-chart-block"><h3>使用状态</h3><div className="dashboard-donut-row"><ResponsiveContainer width={118} height={118}><PieChart><Pie data={worksheetUsageData} dataKey="value" innerRadius={32} outerRadius={50} stroke="none">{worksheetUsageData.map(item => <Cell key={item.name} fill={item.color} />)}</Pie><Tooltip content={<ChartTooltip suffix=" 份" />} /></PieChart></ResponsiveContainer><div className="dashboard-chart-legend">{worksheetUsageData.map(item => <div key={item.name}><i style={{ background: item.color }} /><span>{item.name}</span><strong>{item.value}</strong></div>)}</div></div></div>
              <div className="dashboard-chart-block"><h3>课堂引用较多的学习单</h3>{worksheetBarData.some(item => item.value > 0) ? <ResponsiveContainer width="100%" height={118}><BarChart data={worksheetBarData} margin={{ top: 8, right: 6, left: 2, bottom: 0 }}><XAxis dataKey="name" tick={{ fontSize: 9, fill: '#64748b' }} axisLine={false} tickLine={false} /><YAxis hide allowDecimals={false} /><Tooltip content={<ChartTooltip suffix=" 个课堂" />} cursor={{ fill: '#f3f6f8' }} /><Bar dataKey="value" fill={COLORS.primary} radius={[5, 5, 0, 0]} barSize={22} /></BarChart></ResponsiveContainer> : <EmptyBlock>目前还没有学习单被课堂引用。</EmptyBlock>}</div>
            </div>
            <div className="dashboard-table-wrap"><table className="dashboard-table"><thead><tr><th>学习单</th><th>题目</th><th>关联课堂</th><th>最近更新</th></tr></thead><tbody>{topWorksheets.map(worksheet => <tr key={worksheet.id}><td className="dashboard-primary-cell">{worksheet.title}</td><td>{worksheet.questionCount}</td><td>{worksheet.classroomCount}</td><td>{formatDate(worksheet.updatedAt)}</td></tr>)}</tbody></table></div>
            <p className="dashboard-section-note">最近的历史课堂中已产生 {worksheetAnswers.toLocaleString()} 条作答记录，其中 {worksheetSubmitted.toLocaleString()} 条已经提交。</p>
          </>}
        </SectionCard>

        <SectionCard title="探究空间" description="网页资源、课堂关联与历史使用记录" action={<a href="/teacher/webapps/">管理探究空间</a>} icon={<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18" /></svg>}>
          {webappTotal === 0 ? <EmptyBlock>还没有探究网页，上传后会统计课堂关联与使用情况。</EmptyBlock> : <>
            <MiniStats items={[{ label: '网页资源', value: webappTotal }, { label: '已关联', value: webappUsed, tone: 'green' }, { label: '尚未使用', value: webappUnused, tone: webappUnused > 0 ? 'amber' : 'default' }, { label: '近期使用人次', value: webappParticipants }]} />
            <div className="dashboard-chart-pair">
              <div className="dashboard-chart-block"><h3>关联状态</h3><div className="dashboard-donut-row"><ResponsiveContainer width={118} height={118}><PieChart><Pie data={webappUsageData} dataKey="value" innerRadius={32} outerRadius={50} stroke="none">{webappUsageData.map(item => <Cell key={item.name} fill={item.color} />)}</Pie><Tooltip content={<ChartTooltip suffix=" 个" />} /></PieChart></ResponsiveContainer><div className="dashboard-chart-legend">{webappUsageData.map(item => <div key={item.name}><i style={{ background: item.color }} /><span>{item.name}</span><strong>{item.value}</strong></div>)}</div></div></div>
              <div className="dashboard-chart-block"><h3>课堂引用较多的网页</h3>{webappBarData.some(item => item.value > 0) ? <ResponsiveContainer width="100%" height={118}><BarChart data={webappBarData} margin={{ top: 8, right: 6, left: 2, bottom: 0 }}><XAxis dataKey="name" tick={{ fontSize: 9, fill: '#64748b' }} axisLine={false} tickLine={false} /><YAxis hide allowDecimals={false} /><Tooltip content={<ChartTooltip suffix=" 个课堂" />} cursor={{ fill: '#f3f6f8' }} /><Bar dataKey="value" fill={COLORS.green} radius={[5, 5, 0, 0]} barSize={22} /></BarChart></ResponsiveContainer> : <EmptyBlock>目前还没有探究网页被课堂引用。</EmptyBlock>}</div>
            </div>
            <div className="dashboard-table-wrap"><table className="dashboard-table"><thead><tr><th>探究网页</th><th>入口文件</th><th>关联课堂</th><th>最近更新</th></tr></thead><tbody>{topWebapps.map(webapp => <tr key={webapp.id}><td className="dashboard-primary-cell">{webapp.name}</td><td><span className="dashboard-code-cell">{webapp.entryPath}</span></td><td>{webapp.classroomCount}</td><td>{formatDate(webapp.updatedAt)}</td></tr>)}</tbody></table></div>
            <p className="dashboard-section-note">最近的历史课堂记录到 {webappParticipants.toLocaleString()} 人次使用探究空间，累计记录时长 {formatDuration(webappDuration)}。</p>
          </>}
        </SectionCard>

        <SectionCard title="数据与系统管理" description="存储、备份、课堂安全与需要关注的运行信息" wide action={<a href="/teacher/history/">查看数据管理</a>} icon={<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v7c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12v7c0 1.7 3.6 3 8 3s8-1.3 8-3v-7" /></svg>}>
          <MiniStats items={[{ label: '近期历史课堂', value: history.length }, { label: '存储占用', value: formatBytes(totalStorage) }, { label: '最近备份', value: backupLatest ? formatDate(backupLatest.createdAt) : '暂无' }, { label: '安全提醒', value: warningCount, tone: warningCount > 0 ? 'red' : 'green' }]} />
          <div className="dashboard-system-grid">
            <div className="dashboard-chart-block dashboard-storage-chart"><h3>资源存储占用</h3>{storageStats ? <ResponsiveContainer width="100%" height={210}><BarChart data={storageData} layout="vertical" margin={{ top: 4, right: 24, left: 12, bottom: 0 }}><XAxis type="number" hide /><YAxis type="category" dataKey="name" width={68} tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} /><Tooltip formatter={(value) => formatBytes(Number(value || 0))} cursor={{ fill: '#f3f6f8' }} /><Bar dataKey="value" fill={COLORS.primarySoft} radius={[0, 5, 5, 0]} barSize={15} /></BarChart></ResponsiveContainer> : <EmptyBlock>暂时没有读取到存储信息。</EmptyBlock>}</div>
            <div className="dashboard-system-list"><h3>备份状态</h3><div className="dashboard-system-list-items"><div><span>备份文件</span><strong>{backups.length} 个</strong></div><div><span>备份总大小</span><strong>{formatBytes(backupSize)}</strong></div><div><span>最近备份</span><strong>{backupLatest ? formatDate(backupLatest.createdAt, true) : '尚未备份'}</strong></div></div></div>
            <div className="dashboard-system-list"><h3>需要关注</h3><div className="dashboard-attention-list">{agentError > 0 && <div className="tone-error"><strong>{agentError} 个智能体连接异常</strong><span>请到 AI 智能体页面检查连接</span></div>}{agentPending > 0 && <div className="tone-warning"><strong>{agentPending} 个智能体尚未检测</strong><span>建议在上课前完成连接测试</span></div>}{warningCount > 0 && <div className="tone-error"><strong>{warningCount} 条课堂安全提醒</strong><span>涉及 {warnings.length} 个课堂</span></div>}{classroomPaused > 0 && <div className="tone-warning"><strong>{classroomPaused} 个课堂处于暂停状态</strong><span>可以恢复课堂或结束课堂</span></div>}{agentError === 0 && agentPending === 0 && warningCount === 0 && classroomPaused === 0 && <div className="tone-ok"><strong>当前没有需要处理的异常</strong><span>{enabledShieldWords} 个屏蔽词正在生效</span></div>}</div></div>
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
