'use client';
import { APP_VERSION } from '@/lib/version';
import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import { checkForUpdates, cacheCheckResult, clearDismiss, getCachedCheckResult } from '@/lib/upgrade-check';
import styles from './about.module.css';

const SectionCard = ({ title, color, children, icon }: { title: string; color: string; children: React.ReactNode; icon?: React.ReactNode }) => (
  <div style={{
    background: '#ffffff', borderRadius: 14, border: '1px solid #e2e8f0',
    overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
    marginBottom: 16,
  }}>
    <div style={{
      padding: '14px 20px',
      display: 'flex', alignItems: 'center', gap: 10,
      borderLeft: `3px solid ${color}`,
      background: `linear-gradient(135deg, ${color}08, ${color}04)`,
    }}>
      {icon && <span style={{ color, display: 'flex', flexShrink: 0 }}>{icon}</span>}
      <h3 style={{ fontSize: "1rem", fontWeight: 700, margin: 0, color: '#0f172a' }}>{title}</h3>
    </div>
    <div style={{ padding: '20px 24px' }}>
      {children}
    </div>
  </div>
);

const storyPainPoints = [
  {
    q: '四十个学生，怎样同时走进同一堂 AI 课？',
    a: '不必逐个注册账号，也不必记忆新的密码。教师开启课堂后，学生扫码或输入互动码即可加入；无论是平板、手机，还是临时加入的学生，都能从容开始。',
  },
  {
    q: '当学生与 AI 对话时，教师如何真正看见学习？',
    a: '全班互动会实时回到教师控制台。谁正在深入思考，谁需要提醒，谁还没有开口，都能及时看见；点开学生卡片，还可以沿着完整对话理解他的思路。',
  },
  {
    q: '校园网络并不理想，课堂还能顺畅开展吗？',
    a: '学生设备只需通过局域网连接教师电脑，无须分别访问外部 AI 平台。网络压力集中、入口更加纯净，也让课堂秩序和数据边界始终掌握在教师手中。',
  },
  {
    q: '下课之后，这些珍贵的对话能够留下什么？',
    a: '课堂记录会安静地保存在本地，随时可以回望、分析与导出。从个体思考到全班高频话题，一份报告把稍纵即逝的课堂生成，沉淀为下一次教学的依据。',
  },
];

export default function AboutPage() {
  const [logoErr, setLogoErr] = useState(false);
  const [changelogs, setChangelogs] = useState<{ version: string; date: string | null; content: string }[] | null>(null);
  const [changelogsOpen, setChangelogsOpen] = useState(false);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [expandedVersion, setExpandedVersion] = useState<string | null>(null);
  const [showAllLogs, setShowAllLogs] = useState(false);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateMsg, setUpdateMsg] = useState<{ type: 'success' | 'info' | 'error'; text: string } | null>(null);
  const [updateFound, setUpdateFound] = useState(false);

  useEffect(() => {
    // 页面加载时从缓存恢复版本检测状态（刷新后红点不消失）
    const timer = window.setTimeout(() => {
      const cached = getCachedCheckResult();
      if (cached && cached.hasUpdate) {
        setUpdateFound(true);
        setUpdateMsg({ type: 'success', text: `v${cached.latestVersion} 可用，前往更新` });
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  // 首次展开时懒加载更新日志
  const loadChangelogs = useCallback(async () => {
    if (changelogs) return;
    setLoadingLogs(true);
    try {
      const data = await api.getChangelogs();
      setChangelogs(data);
    } catch {}
    setLoadingLogs(false);
  }, [changelogs]);

  const toggleChangelogs = useCallback(() => {
    if (changelogsOpen) {
      setChangelogsOpen(false);
    } else {
      loadChangelogs();
      setChangelogsOpen(true);
    }
  }, [changelogsOpen, loadChangelogs]);

  const checkUpdate = useCallback(async () => {
    setCheckingUpdate(true);
    setUpdateMsg(null);
    try {
      // 通过后端 API 检测版本
      const data = await checkForUpdates();
      // 无论是否有更新，都将结果写入缓存，覆盖可能的脏数据
      cacheCheckResult(data);
      if (data.hasUpdate) {
        setUpdateMsg({ type: 'success', text: `v${data.latestVersion} 可用，前往更新` });
        setUpdateFound(true);
        // 先清除忽略状态 → 再缓存检测结果 → 最后通知侧栏
        clearDismiss();
        window.dispatchEvent(new CustomEvent('classnode-update-found', {
          detail: { version: data.latestVersion },
        }));
      } else {
        setUpdateMsg({ type: 'info', text: '已是最新版' });
        setUpdateFound(false);
      }
    } catch (e) {
      console.error('检查更新失败:', e);
      setUpdateMsg({ type: 'error', text: '检查失败' });
      setUpdateFound(false);
      // 检查失败时清除缓存，避免下次加载页面时仍显示旧的版本提示
      clearDismiss();
    }
    setCheckingUpdate(false);
  }, []);

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
          <div key={i} style={{ fontSize: "0.813rem", fontWeight: 700, color: '#64748b', letterSpacing: 0.5, textTransform: 'uppercase', marginTop: i > 0 ? 16 : 0, marginBottom: 8, paddingBottom: 6, borderBottom: '1px solid #eef2f6' }}>{title}</div>
        );
      } else if (trimmed.startsWith('#### ')) {
        const title = trimmed.replace('#### ', '').replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
        elements.push(
          <div key={i} style={{ fontSize: "0.813rem", fontWeight: 700, color: '#0f172a', marginTop: 10, marginBottom: 6 }} dangerouslySetInnerHTML={{ __html: title }} />
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
              <div key={j} style={{ fontSize: "0.813rem", color: '#475569', lineHeight: 1.7, paddingLeft: item.sub ? 28 : 16, position: 'relative' }}>
                <span style={{ position: 'absolute', left: item.sub ? 16 : 2, top: 0, color: item.sub ? '#94a3b8' : '#64748b', fontSize: item.sub ? 10 : 12 }}>{item.sub ? '‣' : '•'}</span>
                <span dangerouslySetInnerHTML={{ __html: item.text.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>') }} />
              </div>
            ))}
          </div>
        );
      } else if (!trimmed.startsWith('- ')) {
        elements.push(
          <div key={i} style={{ fontSize: "0.813rem", color: '#475569', lineHeight: 1.7, paddingLeft: 16 }}>
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

      {/* ========== Hero ========== */}
      <div style={{
        display: 'flex', alignItems: 'flex-start', gap: 20,
        marginBottom: 28,
      }}>
        {logoErr ? (
          <div style={{ width: 48, height: 48, borderRadius: 10, flexShrink: 0, background: 'linear-gradient(135deg, #3b82f6, #6366f1)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 700, fontSize: "1.25rem", boxShadow: '0 4px 12px rgba(59,130,246,0.25)' }}>C</div>
        ) : (
          <img src="/logo.png" alt="ClassNode" style={{ width: 48, height: 48, borderRadius: 10, flexShrink: 0 }} onError={() => setLogoErr(true)} />
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <h1 style={{ fontSize: "1.5rem", fontWeight: 700, margin: 0, color: '#0f172a', letterSpacing: -0.3 }}>ClassNode</h1>
            <span style={{ fontSize: "0.813rem", color: '#94a3b8', fontWeight: 500, padding: '1px 10px', borderRadius: 6, background: '#f1f4f9' }}>
              v{APP_VERSION}
            </span>
            <span style={{ position: 'relative', display: 'inline-flex' }}>
              <button onClick={checkUpdate} disabled={checkingUpdate} style={{
                  fontSize: "0.75rem", color: '#64748b', background: 'transparent',
                  border: '1px solid #d1d5db', borderRadius: 6, cursor: checkingUpdate ? 'not-allowed' : 'pointer',
                  padding: '2px 10px', fontWeight: 500, opacity: checkingUpdate ? 0.6 : 1,
                  transition: 'all 0.15s', lineHeight: '22px',
                }}
                  onMouseEnter={e => { if (!checkingUpdate) { e.currentTarget.style.borderColor = '#2563eb'; e.currentTarget.style.color = '#2563eb'; e.currentTarget.style.background = '#eef2ff'; } }}
                  onMouseLeave={e => { if (!checkingUpdate) { e.currentTarget.style.borderColor = '#d1d5db'; e.currentTarget.style.color = '#64748b'; e.currentTarget.style.background = 'transparent'; } }}>
                  {checkingUpdate ? '检查中...' : '检查更新'}
                </button>
              {updateFound && (
                <span style={{
                  position: 'absolute', top: -3, right: -3,
                  width: 7, height: 7, borderRadius: '50%',
                  background: '#ef4444',
                }} />
              )}
            </span>
            {updateMsg && (
              <a href={updateMsg.type === 'success' ? 'https://gitcode.com/weixin_41523975/classnode/releases' : undefined}
                 target={updateMsg.type === 'success' ? '_blank' : undefined}
                 rel={updateMsg.type === 'success' ? 'noopener noreferrer' : undefined}
                 style={{
                textDecoration: 'none', cursor: updateMsg.type === 'success' ? 'pointer' : 'default',
                display: 'inline-flex', alignItems: 'center', gap: 4,
                fontSize: "0.75rem", fontWeight: 500,
                padding: '2px 8px', borderRadius: 6,
                flexShrink: 0, maxWidth: 240, overflow: 'hidden',
                color: updateMsg.type === 'success' ? '#166534' : updateMsg.type === 'error' ? '#991b1b' : '#475569',
                background: updateMsg.type === 'success' ? '#f0fdf4' : updateMsg.type === 'error' ? '#fef2f2' : '#f8fafc',
                border: updateMsg.type === 'success' ? '1px solid #bbf7d0' : updateMsg.type === 'error' ? '1px solid #fecaca' : '1px solid #e2e8f0',
              }}>
                <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: '20px' }}>{updateMsg.text}</span>
                <span onClick={(e) => { e.preventDefault(); e.stopPropagation(); setUpdateMsg(null); }} style={{
                  cursor: 'pointer', opacity: 0.4, flexShrink: 0,
                  fontSize: "0.688rem", lineHeight: '20px',
                }}
                  onMouseEnter={e => { e.currentTarget.style.opacity = '1'; }}
                  onMouseLeave={e => { e.currentTarget.style.opacity = '0.4'; }}
                >✕</span>
              </a>
            )}
          </div>
          <p style={{ fontSize: "0.938rem", color: '#64748b', margin: '4px 0 0', lineHeight: 1.5 }}>
            让每一次 AI 探索，都自然地发生在真实课堂里。
          </p>
        </div>
      </div>

      {/* ========== 写给使用者的话 ========== */}
      <section className={styles.letter} aria-labelledby="developer-letter-title">
        <div className={styles.letterGlow} aria-hidden="true" />
        <div className={styles.letterMark} aria-hidden="true">“</div>
        <div className={styles.letterContent}>
          <div className={styles.letterEyebrow}>写给每一位愿意尝试 AI 的老师</div>
          <h2 id="developer-letter-title">愿技术靠近课堂，而不是让课堂迁就技术</h2>
          <div className={styles.letterBody}>
            <p>
              做 ClassNode，不是因为课堂还缺少一个平台，而是因为我一次次看到：老师花了许多个夜晚打磨出很好的智能体，真正带进教室时，却常常被账号、网络和设备挡在门外。
            </p>
            <p>
              我始终相信，好的技术应该站在教学身后。它不要求每位老师先成为工程师，也不该让一堂珍贵的课消耗在登录和配置上。于是我把 ClassNode 做成一座尽可能轻的桥——连接老师精心创造的智能体，也连接屏幕前每一个正在思考的孩子。
            </p>
            <p className={styles.letterWish}>
              如果它能让你少一次手忙脚乱，多看见一个学生真实的想法；能让一次勇敢的尝试，慢慢长成日常，我所做的一切就有了意义。
            </p>
          </div>
          <div className={styles.signature}>
            <span className={styles.signatureAvatar}>张</span>
            <span><strong>张星昌</strong><small>杭州市拱墅区教育研究院</small></span>
          </div>
        </div>
      </section>

      {/* ========== 更新日志 ========== */}
      <SectionCard title="更新日志" color="#64748b">
          <button onClick={toggleChangelogs} style={{
            width: '100%', padding: '14px 20px', background: '#f8fafc',
            border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10,
            borderBottom: changelogsOpen ? '1px solid #e2e8f0' : 'none',
            transition: 'background 0.12s',
          }}
            onMouseEnter={e => { e.currentTarget.style.background = '#f1f5f9'; }}
            onMouseLeave={e => { e.currentTarget.style.background = '#f8fafc'; }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="1.8" strokeLinecap="round" style={{ transition: 'transform 0.2s', transform: changelogsOpen ? 'rotate(90deg)' : 'rotate(0deg)', flexShrink: 0 }}><polyline points="9 18 15 12 9 6" /></svg>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="1.8" strokeLinecap="round" style={{ flexShrink: 0 }}><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            <span style={{ fontWeight: 600, fontSize: "0.938rem", color: '#0f172a', flex: 1, textAlign: 'left' }}>更新日志</span>
            {loadingLogs && <span style={{ fontSize: "0.75rem", color: '#94a3b8' }}>加载中...</span>}
          </button>
          {changelogsOpen && changelogs && (
          <div style={{ padding: '12px 20px 16px' }}>
            {(showAllLogs ? changelogs : changelogs.slice(0, 5)).map((log, idx) => {
              const isExpanded = expandedVersion === log.version;
              const accentColor = idx === 0 ? '#3b82f6' : '#94a3b8';
              return (
                <div key={log.version} style={{
                  marginBottom: idx < changelogs.length - 1 ? 6 : 0,
                  borderLeft: `3px solid ${isExpanded ? accentColor : '#e2e8f0'}`,
                  borderRadius: 0, overflow: 'hidden',
                  paddingLeft: 12, transition: 'border-color 0.15s',
                }}>
                  <button onClick={() => setExpandedVersion(isExpanded ? null : log.version)} style={{
                    display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                    padding: '8px 0', background: 'transparent',
                    border: 'none', cursor: 'pointer', textAlign: 'left',
                    fontSize: "0.875rem", color: '#0f172a', fontWeight: 600,
                    transition: 'opacity 0.12s',
                  }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" style={{ transition: 'transform 0.15s', transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)', flexShrink: 0 }}><polyline points="9 18 15 12 9 6" /></svg>
                    <span style={{ flex: 1, color: '#0f172a' }}>{log.version}</span>
                    {log.date && <span style={{ fontSize: "0.688rem", color: '#94a3b8', fontWeight: 400 }}>{log.date}</span>}
                  </button>
                  {isExpanded && (
                    <div style={{ padding: '2px 0 8px 20px', fontSize: "0.813rem", color: '#475569', lineHeight: 1.8 }}>
                      {renderMarkdown(log.content)}
                    </div>
                  )}
                </div>
              );
            })}
            {changelogs.length > 5 && !showAllLogs && (
              <button onClick={() => setShowAllLogs(true)}
                style={{ display: 'block', width: '100%', marginTop: 10, padding: '8px', border: '1px dashed #d1d5db', borderRadius: 8, background: 'transparent', cursor: 'pointer', fontSize: "0.813rem", color: '#64748b', textAlign: 'center' }}>
                显示全部更新日志（共 {changelogs.length} 条）
              </button>
            )}
          </div>
        )}
      </SectionCard>

      {/* ========== 缘起 ========== */}
      <SectionCard title="缘起 · 从一堂真实的 AI 课出发" color="#d97706">
        <div style={{ fontSize: "0.938rem", color: '#475569', lineHeight: 1.9 }}>
          <p style={{ margin: '0 0 18px' }}>
            今天，越来越多的老师开始创造属于自己课堂的 AI 智能体：它可以陪学生练习表达，可以循着问题启发思考，也可以把一段知识变成一次有趣的探究。真正困难的，往往不是把智能体做出来，而是让它自然地走进一间有四十个孩子的教室。
          </p>
          <p style={{ margin: '0 0 18px' }}>
            真实课堂有自己的节奏：网络未必稳定，设备各不相同，注册登录可能占去宝贵的时间；学生与 AI 说了什么，教师需要及时了解；下课之后，那些闪光的提问与思考也应该被好好留下。再好的技术，若不能融入这些细节，就很难成为教学的一部分。
          </p>
          <p style={{ margin: '0 0 18px' }}>
            ClassNode 就从这些细小而真实的问题里生长出来。它安静地运行在教师电脑上，把老师精心准备的智能体带到每一个学生面前，也把课堂中的互动、秩序与数据重新交还给教师掌握。
          </p>
          <p style={{ margin: '0 0 18px' }}>
            从第一堂试验课到今天，它始终只围绕一件事打磨：让工具少占一点注意力，让教师多留一点心力给学生。
          </p>
          <p style={{ margin: 0, paddingLeft: 20, borderLeft: '3px solid #93c5fd' }}>
            <strong style={{ color: '#2563eb', fontWeight: 600 }}>让 AI 课堂不止是一次新鲜的尝试，而成为每位老师都能从容使用的日常。</strong>
          </p>
        </div>
      </SectionCard>

      {/* ========== 痛点 ========== */}
      <SectionCard title="把难题留给系统，把课堂还给教师" color="#dc2626">
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
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      width: 20, height: 20, borderRadius: 5, flexShrink: 0,
                      background: dotColors[i], color: 'white',
                      fontSize: "0.625rem", fontWeight: 700, lineHeight: 1,
                    }}>Q</span>
                    <span style={{ fontSize: "1rem", fontWeight: 600, color: '#0f172a' }}>
                      {item.q}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      width: 20, height: 20, borderRadius: 5, flexShrink: 0, marginTop: 2,
                      background: '#f1f5f9', color: '#64748b',
                      fontSize: "0.625rem", fontWeight: 700, lineHeight: 1,
                    }}>A</span>
                    <span style={{ fontSize: "0.875rem", color: '#64748b', lineHeight: 1.8, flex: 1 }}>
                      {item.a}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </SectionCard>

      {/* ========== 底部信息 ========== */}
      <div style={{ textAlign: 'center', padding: '24px 0 16px', borderTop: '1px solid #eef2f6' }}>
        <div style={{ fontSize: "0.875rem", color: '#64748b', lineHeight: 2 }}>
          <div style={{ fontWeight: 600, color: '#334155' }}>教学互促 · 源码共研</div>
          <div style={{ fontSize: "0.813rem", color: '#94a3b8' }}>欢迎对技术感兴趣的老师访问仓库交流</div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, margin: '12px 0 16px' }}>
            <a href="#" onClick={(e) => { e.preventDefault(); window.open('https://gitcode.com/weixin_41523975/classnode'); }}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 8, textDecoration: 'none', fontSize: "0.813rem", fontWeight: 500, color: '#e4392b', transition: 'all 0.2s' }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(228,57,43,0.06)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}>
              <img src="/gitcode_logo.png" alt="" style={{ width: 18, height: 18, borderRadius: '50%' }} />
              GitCode
            </a>
            <a href="#" onClick={(e) => { e.preventDefault(); window.open('https://github.com/hzzxcgtz/classnode'); }}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 8, textDecoration: 'none', fontSize: "0.813rem", fontWeight: 500, color: '#24292f', transition: 'all 0.2s' }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(0,0,0,0.04)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}>
              <img src="/github_logo.png" alt="" style={{ width: 18, height: 18, borderRadius: '50%' }} />
              GitHub
            </a>
          </div>
          <div style={{ fontSize: "0.813rem", color: '#94a3b8' }}>
            Copyright 2026 编程研习工坊
          </div>
        </div>
      </div>
    </div>
  );
}
