'use client';

import { Suspense, useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';

const helpImages: Record<string, string[]> = {
  coze: [
    '/images/help/coze-login.png',
    '/images/help/coze-create-bot.png',
    '/images/help/coze-bot-config.png',
    '/images/help/coze-publish.png',
    '/images/help/coze-create-token.png',
    '/images/help/coze-fill-config.png',
  ],
  'coze-agent': [
    '/images/help/coze-agent-api-url.png',
    '/images/help/coze-agent-project.png',
    '/images/help/coze-agent-token.png',
  ],
  wenxin: [
    '/images/help/wenxin-login.png',
    '/images/help/wenxin-create-agent.png',
    '/images/help/wenxin-api-config.png',
  ],
  zhipuai: [
    '/images/help/zhipuai-login.png',
    '/images/help/zhipuai-create-assistant.png',
    '/images/help/zhipuai-assistant-config.png',
    '/images/help/zhipuai-api-key.png',
    '/images/help/zhipuai-secret-key.png',
    '/images/help/zhipuai-fill-config.png',
  ],
};

export default function AgentHelpPage() {
  return (
    <Suspense fallback={<div style={{ height: '100vh', background: '#0f172a' }} />}>
      <Content />
    </Suspense>
  );
}

function Content() {
  const searchParams = useSearchParams();
  const platform = searchParams.get('platform') || 'coze';
  const images = helpImages[platform] || [];
  const [current, setCurrent] = useState(0);

  const go = useCallback((n: number) => {
    setCurrent(Math.max(0, Math.min(n, images.length - 1)));
  }, [images.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') window.close();
      if (e.key === 'ArrowLeft') go(current - 1);
      if (e.key === 'ArrowRight') go(current + 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [current, go]);

  if (images.length === 0) {
    return (
      <div style={{
        height: '100vh', background: 'radial-gradient(ellipse at center, #1e293b 0%, #0f172a 100%)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#64748b', fontSize: 16, fontFamily: 'system-ui',
      }}>
        该平台暂无配置帮助图片
      </div>
    );
  }

  return (
    <div style={{
      height: '100vh', background: 'radial-gradient(ellipse at center, #1e293b 0%, #0f172a 100%)',
      display: 'flex', flexDirection: 'column',
      fontFamily: 'system-ui', userSelect: 'none', position: 'relative',
    }}>
      {/* 关闭按钮 */}
      <button onClick={() => window.close()}
        style={{
          position: 'absolute', top: 16, right: 16, zIndex: 10,
          width: 36, height: 36, borderRadius: 8, border: 'none',
          background: 'rgba(255,255,255,0.06)', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'rgba(255,255,255,0.4)', fontSize: 18, fontFamily: 'inherit',
          transition: 'all 0.15s',
        }}
        onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.12)'; e.currentTarget.style.color = 'rgba(255,255,255,0.7)'; }}
        onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; e.currentTarget.style.color = 'rgba(255,255,255,0.4)'; }}
        title="关闭">
        ✕
      </button>
      {/* 图片区域 */}
      <div style={{
        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '48px 40px 100px', minHeight: 0, overflow: 'hidden',
      }}>
        <img
          src={images[current]}
          alt={`配置步骤 ${current + 1}`}
          style={{
            maxWidth: '100%', maxHeight: '100%', objectFit: 'contain',
            borderRadius: 8, boxShadow: '0 8px 40px rgba(0,0,0,0.5)',
          }}
        />
      </div>

      {/* 底部导航 — 固定定位，始终可见 */}
      {images.length > 1 && (
        <div style={{
          position: 'fixed', bottom: 0, left: 0, right: 0,
          padding: '16px 24px 28px',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12,
          background: 'linear-gradient(transparent, rgba(15,23,42,0.6) 40%, rgba(15,23,42,0.9))',
        }}>
          {/* 圆点指示器 */}
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {images.map((_, i) => (
              <button key={i} onClick={() => setCurrent(i)}
                style={{
                  width: current === i ? 24 : 6, height: 6, borderRadius: 3, border: 'none',
                  background: current === i ? '#3b82f6' : 'rgba(255,255,255,0.2)',
                  cursor: 'pointer', transition: 'all 0.2s', padding: 0,
                }}
              />
            ))}
          </div>

          {/* 箭头 + 页码 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
            <button onClick={() => go(current - 1)} disabled={current === 0}
              title="上一张"
              style={{
                width: 70, height: 70, borderRadius: '50%',
                border: '2px solid rgba(255,255,255,0.3)',
                background: current === 0 ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.12)',
                cursor: current === 0 ? 'default' : 'pointer',
                color: current === 0 ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.9)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
                transition: 'all 0.15s',
                backdropFilter: 'blur(4px)',
              }}
              onMouseEnter={e => { if (current > 0) { e.currentTarget.style.background = 'rgba(255,255,255,0.25)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.6)'; e.currentTarget.style.transform = 'scale(1.08)'; e.currentTarget.style.boxShadow = '0 0 20px rgba(255,255,255,0.15)'; } }}
              onMouseLeave={e => { e.currentTarget.style.background = current === 0 ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.12)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.3)'; e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.boxShadow = 'none'; }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
              <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 14, letterSpacing: 0 }}>
                点击翻页
              </span>
              <span style={{ color: 'rgba(255,255,255,0.7)', fontSize: 15, fontWeight: 600 }}>
                {current + 1} / {images.length}
              </span>
            </div>
            <button onClick={() => go(current + 1)} disabled={current === images.length - 1}
              title="下一张"
              style={{
                width: 70, height: 70, borderRadius: '50%',
                border: '2px solid rgba(255,255,255,0.3)',
                background: current === images.length - 1 ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.12)',
                cursor: current === images.length - 1 ? 'default' : 'pointer',
                color: current === images.length - 1 ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.9)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
                transition: 'all 0.15s',
                backdropFilter: 'blur(4px)',
              }}
              onMouseEnter={e => { if (current < images.length - 1) { e.currentTarget.style.background = 'rgba(255,255,255,0.25)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.6)'; e.currentTarget.style.transform = 'scale(1.08)'; e.currentTarget.style.boxShadow = '0 0 20px rgba(255,255,255,0.15)'; } }}
              onMouseLeave={e => { e.currentTarget.style.background = current === images.length - 1 ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.12)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.3)'; e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.boxShadow = 'none'; }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
