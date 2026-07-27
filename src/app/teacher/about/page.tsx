'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { api } from '@/lib/api';
import { APP_VERSION } from '@/lib/version';
import styles from './about.module.css';

type Changelog = {
  version: string;
  date: string | null;
  content: string;
};

const principles = [
  {
    title: '轻量进入',
    text: '不要求学生注册，不让课堂时间消耗在账号和配置上。',
  },
  {
    title: '过程可见',
    text: '让教师看见每个学生与 AI 的互动，而不是只看到最终答案。',
  },
  {
    title: '本地掌控',
    text: '课堂记录保存在教师电脑中，教学过程与数据始终由教师管理。',
  },
];

function renderChangelog(text: string) {
  const elements: ReactNode[] = [];
  text.split('\n').forEach((line, index) => {
    const content = line.trim();
    if (!content || content.startsWith('# ') || content.startsWith('## ')) return;
    if (/^#{3,4}\s/.test(content)) {
      elements.push(<h4 key={index}>{content.replace(/^#{3,4}\s*/, '').replace(/\*\*/g, '')}</h4>);
      return;
    }
    elements.push(
      <p key={index}>
        {content.startsWith('- ') ? '· ' : ''}
        {content.replace(/^-\s*/, '').replace(/\*\*/g, '')}
      </p>
    );
  });
  return elements;
}

export default function AboutPage() {
  const [logoError, setLogoError] = useState(false);
  const [changelogs, setChangelogs] = useState<Changelog[] | null>(null);

  useEffect(() => {
    let active = true;
    api.getChangelogs()
      .then(data => { if (active) setChangelogs(data); })
      .catch(() => { if (active) setChangelogs([]); });
    return () => { active = false; };
  }, []);

  const recentLogs = changelogs?.slice(0, 3) || [];
  const currentRelease = changelogs?.find(log => log.version.replace(/^v/i, '') === APP_VERSION) || changelogs?.[0];

  return (
    <main className={styles.page}>
      <header className={styles.pageHeader}>
        <div className={styles.brand}>
          {logoError ? (
            <span className={styles.logoFallback}>C</span>
          ) : (
            <img src="/logo.png" alt="ClassNode" onError={() => setLogoError(true)} />
          )}
          <div>
            <h1>关于 ClassNode</h1>
            <p>面向真实课堂的 AI 互动系统</p>
          </div>
        </div>
        <span className={styles.currentBadge}>当前版本&nbsp; v{APP_VERSION}</span>
      </header>

      <section className={styles.philosophy} aria-labelledby="philosophy-title">
        <div className={styles.sectionLabel}>
          <span>01</span>
          系统设计理念
        </div>
        <div className={styles.philosophyIntro}>
          <h2 id="philosophy-title">让技术站在教学身后。</h2>
          <p>
            ClassNode 不试图改变课堂，而是减少 AI 进入课堂时的阻力，
            让教师把注意力留给教学与学生。
          </p>
        </div>
        <div className={styles.principleGrid}>
          {principles.map((principle, index) => (
            <article key={principle.title}>
              <span>0{index + 1}</span>
              <div>
                <h3>{principle.title}</h3>
                <p>{principle.text}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <div className={styles.releaseGrid}>
        <section className={styles.versionCard} aria-labelledby="version-title">
          <div className={styles.sectionLabel}>
            <span>02</span>
            最新版本
          </div>
          <div className={styles.versionMain}>
            <small>CLASSNODE</small>
            <h2 id="version-title">v{APP_VERSION}</h2>
            <span>已安装</span>
          </div>
          <dl>
            <div>
              <dt>发布日期</dt>
              <dd>{currentRelease?.date || '—'}</dd>
            </div>
            <div>
              <dt>更新状态</dt>
              <dd>{changelogs === null ? '正在检查' : '当前版本信息已载入'}</dd>
            </div>
          </dl>
        </section>

        <section className={styles.changelogCard} aria-labelledby="changelog-title">
          <div className={styles.changelogHeader}>
            <div className={styles.sectionLabel}>
              <span>03</span>
              最近更新
            </div>
            <h2 id="changelog-title">版本更新日志</h2>
          </div>

          {changelogs === null ? (
            <div className={styles.logsState}>正在加载更新日志…</div>
          ) : recentLogs.length === 0 ? (
            <div className={styles.logsState}>暂时无法获取更新日志</div>
          ) : (
            <div className={styles.releaseList}>
              {recentLogs.map((log, index) => (
                <details key={log.version} open={index === 0}>
                  <summary>
                    <span className={index === 0 ? styles.releaseDotCurrent : styles.releaseDot} />
                    <strong>{log.version}</strong>
                    {index === 0 && <em>最新</em>}
                    <time>{log.date}</time>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="m6 9 6 6 6-6" />
                    </svg>
                  </summary>
                  <div className={styles.releaseBody}>{renderChangelog(log.content)}</div>
                </details>
              ))}
            </div>
          )}
        </section>
      </div>

      <section className={styles.developerCard} aria-labelledby="developer-title">
        <div className={styles.developerIntro}>
          <div className={styles.sectionLabel}>
            <span>04</span>
            开发者信息
          </div>
          <h2 id="developer-title">张星昌</h2>
          <p>杭州市拱墅区教育研究院</p>
        </div>

        <div className={styles.developerDetails}>
          <div>
            <span>身份</span>
            <strong>ClassNode 开发者</strong>
          </div>
          <div>
            <span>关注方向</span>
            <strong>AI 与真实课堂的融合应用</strong>
          </div>
        </div>

        <nav className={styles.links} aria-label="ClassNode 相关链接">
          <a href="https://www.aicls.xyz" target="_blank" rel="noreferrer">
            官方网站
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M7 17 17 7M7 7h10v10" /></svg>
          </a>
          <a href="https://github.com/hzzxcgtz/classnode" target="_blank" rel="noreferrer">
            GitHub
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M7 17 17 7M7 7h10v10" /></svg>
          </a>
          <a href="https://gitcode.com/weixin_41523975/classnode" target="_blank" rel="noreferrer">
            GitCode
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M7 17 17 7M7 7h10v10" /></svg>
          </a>
        </nav>
      </section>

      <footer className={styles.footer}>© 2026 编程研习工坊</footer>
    </main>
  );
}
