'use client';
import { APP_VERSION } from '@/lib/version';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/api';

const SvgIcon = ({ name, color, size = 20 }: { name: string; color?: string; size?: number }) => {
  const c = color || '#2563eb';
  const icons: Record<string, React.ReactNode> = {
    send: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.5" strokeLinecap="round"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>,
    eye: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.5" strokeLinecap="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>,
    wifi: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.5" strokeLinecap="round"><path d="M5 12.55a11 11 0 0 1 14.08 0" /><path d="M1.42 9a16 16 0 0 1 21.16 0" /><path d="M8.53 16.11a6 6 0 0 1 6.95 0" /><circle cx="12" cy="20" r="1" /></svg>,
    database: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.5" strokeLinecap="round"><ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" /><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" /></svg>,
    shield: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.5" strokeLinecap="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>,
    laptop: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.5" strokeLinecap="round"><rect x="2" y="3" width="20" height="14" rx="2" /><line x1="2" y1="20" x2="22" y2="20" /></svg>,
    check: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round"><polyline points="20 6 9 17 4 12" /></svg>,
  };
  return <>{icons[name] ?? null}</>;
};

const storyPainPoints = [
  {
    q: '分发难得像发传单？',
    a: '不用让学生挨个注册账号。互动码一开，全班扫码秒进。',
    icon: 'send',
  },
  {
    q: '学生聊什么真是"黑盒"？',
    a: '不用担心。每一句话都实时同步到教师端，谁在开小差、谁在深度思考，一目了然。',
    icon: 'eye',
  },
  {
    q: '一断网 AI 就罢工？',
    a: '局域网就是护城河。只要学生设备能连上老师电脑，就能正常对话，不依赖互联网。',
    icon: 'wifi',
  },
  {
    q: '下课铃一响数据全丢？',
    a: '所有对话记录本地保存，随时回溯。还能一键生成含高频词云的 Word 报告，教研评课不再愁没数据。',
    icon: 'database',
  },
];

const techPoints = [
  { title: '轻量化部署', desc: '不用求助网管，不用折腾服务器，在自己电脑上就能装。', icon: 'laptop' },
  { title: '数据本地化', desc: '所有互动数据留在您的硬盘里，不传云端，隐私无忧。', icon: 'shield' },
  { title: '局域网互通', desc: '基于局域网设计，不依赖互联网出口，网络再差也不怕。', icon: 'wifi' },
  { title: '教学全闭环', desc: '从备课、课堂互动监控到课后数据复盘，完整覆盖 AI 教学全流程。', icon: 'check' },
];

export default function AboutPage() {
  const router = useRouter();
  const [logoErr, setLogoErr] = useState(false);
  const [changelogs, setChangelogs] = useState<{ version: string; date: string | null; content: string }[] | null>(null);
  const [changelogsOpen, setChangelogsOpen] = useState(false);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [expandedVersion, setExpandedVersion] = useState<string | null>(null);
  const [showAllLogs, setShowAllLogs] = useState(false);

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
      if (trimmed.startsWith('# ') || trimmed.startsWith('## ')) { i++; continue; }
      if (trimmed.startsWith('### ')) {
        const title = trimmed.replace('### ', '');
        elements.push(
          <div key={i} style={{ fontSize: 12, fontWeight: 700, color: '#64748b', letterSpacing: 0.5, textTransform: 'uppercase', marginTop: i > 0 ? 16 : 0, marginBottom: 8, paddingBottom: 6, borderBottom: '1px solid #eef2f6' }}>{title}</div>
        );
      } else if (trimmed.startsWith('#### ')) {
        const title = trimmed.replace('#### ', '').replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
        elements.push(
          <div key={i} style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', marginTop: 10, marginBottom: 6 }} dangerouslySetInnerHTML={{ __html: title }} />
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
              <div key={j} style={{ fontSize: 12.5, color: '#475569', lineHeight: 1.7, paddingLeft: item.sub ? 28 : 16, position: 'relative' }}>
                <span style={{ position: 'absolute', left: item.sub ? 16 : 2, top: 0, color: item.sub ? '#94a3b8' : '#64748b', fontSize: item.sub ? 10 : 12 }}>{item.sub ? '‣' : '•'}</span>
                <span dangerouslySetInnerHTML={{ __html: item.text.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>') }} />
              </div>
            ))}
          </div>
        );
      } else if (!trimmed.startsWith('- ')) {
        elements.push(
          <div key={i} style={{ fontSize: 12.5, color: '#475569', lineHeight: 1.7, paddingLeft: 16 }}>
            <span dangerouslySetInnerHTML={{ __html: trimmed.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>') }} />
          </div>
        );
      }
      i++;
    }
    return elements;
  };

  return (
    <div style={{ padding: '40px 48px', maxWidth: 900, margin: '0 auto' }}>

      {/* ========== 返回按钮 ========== */}
      <button onClick={() => router.back()}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: '#64748b', fontSize: 14, background: 'none', border: 'none', cursor: 'pointer', padding: '6px 14px', borderRadius: 8, transition: 'background 0.12s', marginBottom: 28 }}
        onMouseEnter={e => { e.currentTarget.style.background = '#f1f5f9'; }}
        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" /></svg>
        返回
      </button>

      {/* ========== Hero ========== */}
      <div style={{
        background: '#ffffff', borderRadius: 20, overflow: 'hidden', marginBottom: 36,
        border: '1px solid #e2e8f0', boxShadow: '0 4px 24px rgba(0,0,0,0.06)',
        position: 'relative',
      }}>
        <div style={{ height: 4, width: '100%', background: 'linear-gradient(90deg, #3b82f6, #6366f1, #8b5cf6)' }} />
        <div style={{ padding: '36px 40px 30px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 24, marginBottom: 28 }}>
            {logoErr ? (
              <div style={{ width: 76, height: 76, borderRadius: 16, flexShrink: 0, background: 'linear-gradient(135deg, #3b82f6, #6366f1)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 700, fontSize: 30, boxShadow: '0 6px 16px rgba(59,130,246,0.25)' }}>C</div>
            ) : (
              <img src="/logo.png" alt="ClassNode" style={{ width: 76, height: 76, borderRadius: 16, flexShrink: 0 }} onError={() => setLogoErr(true)} />
            )}
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
                <h1 style={{ fontSize: 32, fontWeight: 700, margin: 0, color: '#0f172a', letterSpacing: -0.5 }}>ClassNode</h1>
                <span style={{ fontSize: 15, color: '#94a3b8', fontWeight: 500, padding: '2px 12px', borderRadius: 6, background: '#f1f4f9' }}>
                  v{APP_VERSION}
                </span>
              </div>
              <p style={{ fontSize: 16, color: '#64748b', margin: '6px 0 0', lineHeight: 1.5 }}>
                让 AI 在真实课堂落地，零门槛、不设限。
              </p>
            </div>
            <button onClick={toggleChangelogs} style={{
              flexShrink: 0, alignSelf: 'flex-start',
              display: 'inline-flex', alignItems: 'center', gap: 6,
              fontSize: 14, color: '#475569', background: '#f8fafc',
              border: '1px solid #d1d5db', borderRadius: 10, cursor: 'pointer',
              padding: '9px 18px', fontWeight: 500,
              transition: 'all 0.15s',
            }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = '#2563eb'; e.currentTarget.style.color = '#2563eb'; e.currentTarget.style.background = '#eef2ff'; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = '#d1d5db'; e.currentTarget.style.color = '#475569'; e.currentTarget.style.background = '#f8fafc'; }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>
              {loadingLogs ? '加载中...' : changelogsOpen ? '收起更新日志' : '更新日志'}
            </button>
          </div>
          <div style={{
            background: '#f8fafc', border: '1px solid #eef2f6',
            borderRadius: 12, padding: '18px 22px',
            display: 'flex', gap: 14, alignItems: 'flex-start',
          }}>
            <span style={{ flexShrink: 0, marginTop: 1, color: '#3b82f6', fontSize: 22, lineHeight: 1, fontStyle: 'italic', fontWeight: 300, fontFamily: 'Georgia, serif' }}>&ldquo;</span>
            <p style={{ margin: 0, fontSize: 15, color: '#475569', lineHeight: 1.8 }}>
              专为真实课堂而生。即使网络环境不那么完美，也能让老师精心调优的 AI 智能体，安全、可控、零门槛地送到每一个学生面前。
            </p>
            <span style={{ flexShrink: 0, marginTop: 1, color: '#3b82f6', fontSize: 22, lineHeight: 1, fontStyle: 'italic', fontWeight: 300, fontFamily: 'Georgia, serif', alignSelf: 'flex-end' }}>&rdquo;</span>
          </div>
        </div>
      </div>

      {/* ========== 更新日志 ========== */}
      {changelogsOpen && changelogs && (
        <div style={{ background: '#ffffff', borderRadius: 16, border: '1px solid #e2e8f0', marginBottom: 36, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
          <div style={{ padding: '16px 22px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: 8 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            <span style={{ fontWeight: 600, fontSize: 15, color: '#0f172a' }}>更新日志</span>
          </div>
          <div style={{ padding: '16px 22px' }}>
            {(showAllLogs ? changelogs : changelogs.slice(0, 5)).map((log, idx) => {
              const isExpanded = expandedVersion === log.version;
              return (
                <div key={log.version} style={{ marginBottom: idx < changelogs.length - 1 ? 6 : 0, borderRadius: 8, overflow: 'hidden', border: isExpanded ? '1px solid #e2e8f0' : '1px solid transparent', transition: 'border-color 0.15s' }}>
                  <button onClick={() => setExpandedVersion(isExpanded ? null : log.version)} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '10px 14px', background: isExpanded ? '#f8fafc' : 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', fontSize: 14, color: '#0f172a', fontWeight: 600, borderRadius: isExpanded ? '7px 7px 0 0' : 7, transition: 'background 0.12s' }}
                    onMouseEnter={e => { if (!isExpanded) e.currentTarget.style.background = '#f8fafc'; }}
                    onMouseLeave={e => { if (!isExpanded) e.currentTarget.style.background = 'transparent'; }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" style={{ transition: 'transform 0.15s', transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)', flexShrink: 0 }}><polyline points="9 18 15 12 9 6" /></svg>
                    <span style={{ flex: 1, color: '#0f172a' }}>{log.version}</span>
                    <span style={{ fontSize: 11, color: '#94a3b8', background: '#f1f5f9', padding: '1px 7px', borderRadius: 4, marginLeft: 4 }}>{isExpanded ? '收起' : '展开'}</span>
                  </button>
                  {isExpanded && <div style={{ padding: '12px 18px 16px' }}>{renderMarkdown(log.content)}</div>}
                </div>
              );
            })}
            {changelogs.length > 5 && !showAllLogs && (
              <button onClick={() => setShowAllLogs(true)}
                style={{ display: 'block', width: '100%', marginTop: 10, padding: '10px', border: '1px dashed #d1d5db', borderRadius: 8, background: 'transparent', cursor: 'pointer', fontSize: 13, color: '#64748b', textAlign: 'center' }}>
                显示全部更新日志（共 {changelogs.length} 条）
              </button>
            )}
          </div>
        </div>
      )}

      {/* ========== 缘起 ========== */}
      <div style={{
        background: '#fefcf7', borderRadius: 16,
        border: '1px solid #ede9e0', padding: '36px 44px 32px',
        marginBottom: 28, boxShadow: '0 6px 24px rgba(0,0,0,0.04)',
        position: 'relative',
      }}>
        {/* 右上角折纸效果 */}
        <div style={{
          position: 'absolute', top: 0, right: 0, overflow: 'hidden',
          width: 40, height: 40, borderRadius: '0 16px 0 0',
        }}>
          <div style={{
            position: 'absolute', top: 0, right: 0,
            width: 0, height: 0,
            borderStyle: 'solid',
            borderWidth: '0 40px 40px 0',
            borderColor: 'transparent #e2e0d8 transparent transparent',
          }} />
          <div style={{
            position: 'absolute', top: 0, right: 0,
            width: 0, height: 0,
            borderStyle: 'solid',
            borderWidth: '0 36px 36px 0',
            borderColor: 'transparent #fefcf7 transparent transparent',
          }} />
        </div>

        <div style={{ marginBottom: 28, display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
            <span style={{
              fontSize: 40, fontWeight: 200, color: '#1e3a5f',
              lineHeight: 1,
            }}>缘</span>
            <span style={{
              fontSize: 40, fontWeight: 200, color: '#1e3a5f',
              lineHeight: 1,
            }}>起</span>
            <span style={{
              display: 'inline-block', width: 4, height: 4,
              borderRadius: '50%', background: '#3b82f6',
              marginLeft: 10, marginTop: 4, opacity: 0.6,
            }} />
          </div>
          <span style={{
            fontSize: 13, color: '#a8a29e',
            paddingLeft: 16, borderLeft: '1px solid #e2e0d8',
            letterSpacing: 0.5,
          }}>为什么做这个系统</span>
        </div>

        <div style={{ fontSize: 16, color: '#57534e', lineHeight: 2.1 }}>
          <p style={{ margin: '0 0 18px' }}>
            AI 技术发展很快，现在很多老师都能调教出很出色的 AI 智能体。但要想让全班几十个孩子都用上，现实往往是另一回事：学校网络卡顿、学生注册账号太麻烦、他们在屏幕后聊了什么你不知道、下课以后数据全没了&hellip;&hellip;
          </p>
          <p style={{ margin: '0 0 18px' }}>
            <strong style={{ color: '#292524' }}>技术不难的时候，难的是落地。</strong>
          </p>
          <p style={{ margin: '0 0 18px' }}>
            ClassNode 不是大厂的云平台，而是一个能装进你电脑里的"AI 互动课堂系统"。老师用 Coze、智谱清言调教好的智能体，通过它就能安全、可控地分发给全班学生——不管学校网络好不好，不管学生用的是平板还是手机。
          </p>
          <p style={{ margin: 0, paddingLeft: 20, borderLeft: '3px solid #93c5fd' }}>
            <strong style={{ color: '#2563eb', fontWeight: 600 }}>目的只有一个：让 AI 课堂从"想试试"变成"天天用"。</strong>
          </p>
        </div>
      </div>

      {/* ========== 痛点 ========== */}
      <div style={{
        background: '#ffffff', borderRadius: 16,
        border: '1px solid #e2e8f0', padding: '32px 36px',
        marginBottom: 28, boxShadow: '0 4px 20px rgba(0,0,0,0.05)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: '#fef2f2', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
          </div>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: '#0f172a' }}>
            解决的教学<strong style={{ color: '#dc2626' }}>"老大难"</strong>
          </h2>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {storyPainPoints.map((item, i) => {
            const accentColors = ['#fee2e2', '#fef9c3', '#dbeafe', '#d1fae5'];
            const dotColors = ['#ef4444', '#eab308', '#3b82f6', '#10b981'];
            return (
              <div key={i} style={{
                display: 'flex', gap: 16, alignItems: 'flex-start',
                padding: 0, borderRadius: 12,
                background: '#ffffff',
                border: '1px solid #e8ecf0',
                overflow: 'hidden',
                transition: 'all 0.15s',
              }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = '#d0d5dd'; e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,0.06)'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = '#e8ecf0'; e.currentTarget.style.boxShadow = 'none'; }}>
                {/* 左侧色条 */}
                <div style={{ width: 4, flexShrink: 0, background: accentColors[i], alignSelf: 'stretch' }} />
                <div style={{ padding: '16px 20px 16px 0', flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: dotColors[i], flexShrink: 0 }} />
                    <span style={{ fontSize: 15, fontWeight: 600, color: '#0f172a' }}>
                      {item.q}
                    </span>
                  </div>
                  <div style={{ fontSize: 14, color: '#64748b', lineHeight: 1.8, paddingLeft: 0 }}>
                    <span style={{ color: dotColors[i], fontWeight: 500 }}>解决：</span>
                    {item.a}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ========== 技术底座 ========== */}
      <div style={{
        background: 'linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)',
        borderRadius: 16, padding: '32px 36px', marginBottom: 36,
        border: '1px solid #e2e8f0',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: '#eef2ff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2" strokeLinecap="round"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
          </div>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: '#0f172a' }}>
            技术底座
          </h2>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          {techPoints.map((item, i) => (
            <div key={i} style={{
              background: '#ffffff', borderRadius: 12,
              border: '1px solid #e8ecf0', padding: '20px 22px',
              transition: 'all 0.15s',
            }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = '#93c5fd'; e.currentTarget.style.boxShadow = '0 4px 16px rgba(37,99,235,0.1)'; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = '#e8ecf0'; e.currentTarget.style.boxShadow = 'none'; }}>
              <div style={{ width: 34, height: 34, borderRadius: 9, background: 'linear-gradient(135deg, #eef2ff, #e0e7ff)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}>
                <SvgIcon name={item.icon} color="#4f46e5" size={16} />
              </div>
              <div style={{ fontWeight: 600, fontSize: 15, color: '#0f172a', marginBottom: 6 }}>{item.title}</div>
              <div style={{ fontSize: 14, color: '#64748b', lineHeight: 1.8 }}>{item.desc}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ========== 底部信息 ========== */}
      <div style={{ textAlign: 'center', padding: '28px 0 12px', borderTop: '1px solid #eef2f6' }}>
        <div style={{ fontSize: 14, color: '#94a3b8', lineHeight: 2.2 }}>
          <div>张星昌 · 杭州市拱墅区教育研究院</div>
          <div>
            联系：
            <a href="mailto:hzzxc2012@163.com" style={{ color: '#3b82f6', textDecoration: 'none', fontWeight: 500 }}>hzzxc2012@163.com</a>
          </div>
          <div style={{ marginTop: 4, fontSize: 13, color: '#cbd5e1' }}>
            ClassNode v{APP_VERSION} &mdash; AI 互动课堂系统
          </div>
        </div>
      </div>
    </div>
  );
}
