'use client';
import { APP_VERSION } from '@/lib/version';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/api';

const painPoints = [
  { icon: 'send', title: '分发障碍', desc: '教师精心调优的 AI 智能体，难以便捷、安全地分发给全班学生同步使用。' },
  { icon: 'eye', title: '监控盲区', desc: '学生与 AI 交互时，教师无法实时查看对话内容，难以掌握学生的学习状态。' },
  { icon: 'wifi', title: '联网依赖', desc: '传统 AI 课堂要求学生的设备必须接入互联网才能与智能体互动，受学校网络环境和出口带宽限制较大。' },
  { icon: 'trash', title: '数据流失', desc: '课堂结束后对话数据随之流失，缺乏学情分析和教学反思的客观依据。' },
];

const solutions = [
  { icon: 'share', title: '一键分发', desc: '支持个人/小组等多种模式，将 AI 智能体快速分发至全班。' },
  { icon: 'monitor', title: '实时看板', desc: '「课堂看板」以"上帝视角"实时监测每位学生的对话内容与进度。' },
  { icon: 'wifi', title: '局域网互通', desc: '学生设备只需通过局域网与教师端连接即可与智能体对话，无需互联网访问。' },
  { icon: 'file', title: '数据沉淀', desc: '课后对话数据完整留存，内置高频词云分析并支持一键导出 Word 文档，为教研评课提供数据支撑。' },
];

const SvgIcon = ({ name, color }: { name: string; color: string }) => {
  const icons: Record<string, React.ReactNode> = {
    send: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>,
    eye: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>,
    trash: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>,
    share: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><line x1="8.59" y1="13.51" x2="15.42" y2="17.49" /><line x1="15.41" y1="6.51" x2="8.59" y2="10.49" /></svg>,
    monitor: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" /></svg>,
    chart: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" /></svg>,
    file: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></svg>,
    lock: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>,
    computer: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" /></svg>,
    wifi: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.55a11 11 0 0 1 14.08 0" /><path d="M1.42 9a16 16 0 0 1 21.16 0" /><path d="M8.53 16.11a6 6 0 0 1 6.95 0" /><circle cx="12" cy="20" r="1" /></svg>,
  };
  return <>{icons[name] ?? null}</>;
};

export default function AboutPage() {
  const router = useRouter();
  const [logoErr, setLogoErr] = useState(false);
  const [changelogs, setChangelogs] = useState<{ version: string; date: string | null; content: string }[] | null>(null);
  const [changelogsOpen, setChangelogsOpen] = useState(false);
  const [loadingLogs, setLoadingLogs] = useState(false);

  const toggleChangelogs = async () => {
    if (changelogsOpen) { setChangelogsOpen(false); return; }
    if (changelogs) { setChangelogsOpen(true); return; }
    setLoadingLogs(true);
    try {
      const data = await api.getChangelogs();
      setChangelogs(data);
      if (data.length > 0) setExpandedVersion(data[0].version);
      setChangelogsOpen(true);
    } catch {}
    setLoadingLogs(false);
  };

  const renderMarkdown = (text: string) => {
    const lines = text.split('\n');
    const elements: React.ReactNode[] = [];
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      const trimmed = line.trim();
      if (!trimmed) { i++; continue; }
      // 跳过 h1（# 更新日志）和 h2（版本标题，已在折叠按钮中显示）
      if (trimmed.startsWith('# ') || trimmed.startsWith('## ')) { i++; continue; }
      if (trimmed.startsWith('### ')) {
        const title = trimmed.replace('### ', '');
        elements.push(
          <div key={i} style={{
            fontSize: 12, fontWeight: 700, color: '#64748b',
            letterSpacing: 0.5, textTransform: 'uppercase',
            marginTop: i > 0 ? 16 : 0, marginBottom: 8,
            paddingBottom: 6, borderBottom: '1px solid #eef2f6',
          }}>{title}</div>
        );
      } else if (trimmed.startsWith('#### ')) {
        const title = trimmed.replace('#### ', '').replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
        elements.push(
          <div key={i} style={{
            fontSize: 13, fontWeight: 700, color: '#0f172a',
            marginTop: 10, marginBottom: 6,
          }} dangerouslySetInnerHTML={{ __html: title }} />
        );
      } else if (trimmed.startsWith('- ')) {
        const items: { text: string; sub: boolean }[] = [{ text: trimmed.replace(/^- /, ''), sub: false }];
        while (i + 1 < lines.length && lines[i + 1].trim().match(/^  - /)) {
          i++;
          items.push({ text: lines[i].trim().replace(/^  - /, ''), sub: true });
        }
        elements.push(
          <div key={i} style={{ marginBottom: 6 }}>
            {items.map((item, j) => (
              <div key={j} style={{
                fontSize: 12.5, color: '#475569', lineHeight: 1.7,
                paddingLeft: item.sub ? 28 : 16,
                position: 'relative',
              }}>
                <span style={{
                  position: 'absolute', left: item.sub ? 16 : 2, top: 0,
                  color: item.sub ? '#94a3b8' : '#64748b',
                  fontSize: item.sub ? 10 : 12,
                }}>{item.sub ? '‣' : '•'}</span>
                <span dangerouslySetInnerHTML={{ __html: item.text.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>') }} />
              </div>
            ))}
          </div>
        );
      } else if (trimmed.startsWith('### ')) {
        // already handled above, skip
      }
      i++;
    }
    return elements;
  };

  const [expandedVersion, setExpandedVersion] = useState<string | null>(null);

  return (
    <div style={{ padding: '32px 40px', maxWidth: 760, margin: '0 auto' }}>
      <button onClick={() => router.back()}
        style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#64748b', fontSize: 13, background: 'none', border: 'none', cursor: 'pointer', padding: 0, marginBottom: 24 }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" /></svg>
        返回
      </button>

      {/* Hero */}
      <div style={{
        background: '#ffffff', borderRadius: 16,
        border: '1px solid #e2e8f0',
        padding: 0, marginBottom: 28, overflow: 'hidden',
        boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
      }}>
        <div style={{
          background: 'linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)',
          padding: '28px 32px', borderBottom: '1px solid #e2e8f0',
          display: 'flex', alignItems: 'center', gap: 16,
        }}>
          {logoErr ? (
            <div style={{ width: 48, height: 48, borderRadius: 12, flexShrink: 0, background: 'linear-gradient(135deg, #667eea, #764ba2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 700, fontSize: 20 }}>C</div>
          ) : (
            <img src="/logo.png" alt="ClassNode" style={{ width: 48, height: 48, borderRadius: 12, flexShrink: 0 }} onError={() => setLogoErr(true)} />
          )}
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0, color: '#0f172a' }}>ClassNode</h1>
            <p style={{ fontSize: 13, color: '#64748b', margin: '2px 0 0' }}>
              AI 互动课堂系统 · 版本 {APP_VERSION}
            </p>
          </div>
          <button onClick={toggleChangelogs} style={{
            marginLeft: 'auto', flexShrink: 0,
            display: 'inline-flex', alignItems: 'center', gap: 5,
            fontSize: 12, color: '#475569', background: '#ffffff',
            border: '1px solid #d1d5db', borderRadius: 8, cursor: 'pointer',
            padding: '6px 12px', fontWeight: 500, lineHeight: 1,
            transition: 'all 0.12s', boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
          }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = '#2563eb'; e.currentTarget.style.color = '#2563eb'; e.currentTarget.style.boxShadow = '0 1px 3px rgba(37,99,235,0.15)'; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = '#d1d5db'; e.currentTarget.style.color = '#475569'; e.currentTarget.style.boxShadow = '0 1px 2px rgba(0,0,0,0.04)'; }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ flexShrink: 0 }}>
              <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/>
              <polyline points="17 6 23 6 23 12"/>
            </svg>
            {loadingLogs ? '加载中...' : changelogsOpen ? '收起更新日志' : '更新日志'}
          </button>
        </div>
        <div style={{ padding: '20px 32px' }}>
          <p style={{ margin: 0, fontSize: 15, color: '#475569', lineHeight: 1.8 }}>
            ClassNode 是一款专为真实课堂教学场景深度定制的 AI 互动课堂系统，
            <span style={{ color: '#2563eb', fontWeight: 600 }}>旨在打破 AI 技术落地课堂的「最后一公里」障碍</span>。
          </p>
        </div>
      </div>

      {/* 更新日志 */}
      {changelogsOpen && changelogs && (
        <div style={{
          background: '#ffffff', borderRadius: 16,
          border: '1px solid #e2e8f0', marginBottom: 28,
          overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
        }}>
          <div style={{
            padding: '14px 20px',
            background: '#f8fafc', borderBottom: '1px solid #e2e8f0',
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            <span style={{ fontWeight: 600, fontSize: 14, color: '#0f172a' }}>更新日志</span>
          </div>
          <div style={{ padding: '16px 20px' }}>
            {changelogs.map((log, idx) => {
              const isExpanded = expandedVersion === log.version;
              return (
                <div key={log.version} style={{
                  marginBottom: idx < changelogs.length - 1 ? 6 : 0,
                  borderRadius: 8, overflow: 'hidden',
                  border: isExpanded ? '1px solid #e2e8f0' : '1px solid transparent',
                  transition: 'border-color 0.15s',
                }}>
                  <button onClick={() => setExpandedVersion(isExpanded ? null : log.version)} style={{
                    display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                    padding: '9px 12px',
                    background: isExpanded ? '#f8fafc' : 'transparent',
                    border: 'none', cursor: 'pointer', textAlign: 'left',
                    fontSize: 13, color: '#0f172a', fontWeight: 600,
                    borderRadius: isExpanded ? '7px 7px 0 0' : 7,
                    transition: 'background 0.12s',
                  }}
                    onMouseEnter={e => { if (!isExpanded) e.currentTarget.style.background = '#f8fafc'; }}
                    onMouseLeave={e => { if (!isExpanded) e.currentTarget.style.background = 'transparent'; }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" style={{
                      transition: 'transform 0.15s',
                      transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
                      flexShrink: 0,
                    }}>
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                    <span style={{ flex: 1, color: '#0f172a' }}>{log.version}</span>
                    <span style={{
                      fontSize: 10, color: '#94a3b8', background: '#f1f5f9',
                      padding: '1px 6px', borderRadius: 4, marginLeft: 4,
                    }}>
                      {isExpanded ? '收起' : '展开'}
                    </span>
                  </button>
                  {isExpanded && (
                    <div style={{ padding: '10px 16px 14px' }}>
                      {renderMarkdown(log.content)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 痛点 */}
      <h2 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 12px', color: '#0f172a' }}>教学痛点</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 28 }}>
        {painPoints.map((p, i) => (
          <div key={i} style={{
            display: 'flex', alignItems: 'flex-start', gap: 12,
            background: '#fef2f2', borderRadius: 10, padding: '14px 16px',
            border: '1px solid #fecaca',
          }}>
            <div style={{ flexShrink: 0, width: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: 2 }}>
              <SvgIcon name={p.icon} color="#dc2626" />
            </div>
            <div>
              <div style={{ fontWeight: 600, fontSize: 14, color: '#991b1b', marginBottom: 2 }}>{p.title}</div>
              <div style={{ fontSize: 13, color: '#b91c1c', lineHeight: 1.6 }}>{p.desc}</div>
            </div>
          </div>
        ))}
      </div>

      {/* 解决方案 */}
      <h2 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 12px', color: '#0f172a' }}>解决方案</h2>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 28 }}>
        {solutions.map((s, i) => (
          <div key={i} style={{
            background: '#f0fdf4', borderRadius: 10, padding: 16,
            border: '1px solid #bbf7d0',
          }}>
            <div style={{ width: 24, height: 24, borderRadius: 6, background: '#dcfce7', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 8 }}>
              <SvgIcon name={s.icon} color="#16a34a" />
            </div>
            <div style={{ fontWeight: 600, fontSize: 14, color: '#166534', marginBottom: 2 }}>{s.title}</div>
            <div style={{ fontSize: 13, color: '#15803d', lineHeight: 1.6 }}>{s.desc}</div>
          </div>
        ))}
      </div>

      {/* 技术优势 */}
      <div style={{
        background: 'white', borderRadius: 12, padding: 24,
        border: '1px solid #e2e8f0', marginBottom: 28,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path d="M12 8h.01" /></svg>
          <span style={{ fontWeight: 600, fontSize: 15, color: '#0f172a' }}>技术优势</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <div style={{ flexShrink: 0, width: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: 1 }}>
              <SvgIcon name="computer" color="#2563eb" />
            </div>
            <div style={{ fontSize: 14, color: '#334155', lineHeight: 1.7 }}>
              <strong style={{ color: '#0f172a' }}>轻量化部署</strong>：无需复杂服务器配置，在个人电脑上即可一键安装使用。
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <div style={{ flexShrink: 0, width: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: 1 }}>
              <SvgIcon name="lock" color="#2563eb" />
            </div>
            <div style={{ fontSize: 14, color: '#334155', lineHeight: 1.7 }}>
              <strong style={{ color: '#0f172a' }}>数据本地化</strong>：采用 SQLite 本地存储，数据完全保存在本机，无需外部云服务，保障学生隐私安全。
            </div>
          </div>
        </div>
      </div>

      {/* 开发者信息 */}
      <div style={{
        background: '#f8fafc', borderRadius: 12, padding: 20,
        border: '1px solid #e2e8f0',
      }}>
        <div style={{ fontSize: 13, color: '#64748b', lineHeight: 2 }}>
          <div>开发者：张星昌 · 杭州市拱墅区教育研究院</div>
          <div>联系邮箱：<a href="mailto:hzzxc2012@163.com" style={{ color: '#2563eb', textDecoration: 'none' }}>hzzxc2012@163.com</a></div>
        </div>
      </div>
    </div>
  );
}
