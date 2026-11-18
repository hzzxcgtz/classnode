'use client';

import { useCallback, useState, type CSSProperties, type ReactNode } from 'react';
import { APP_VERSION } from '@/lib/version';
import { api } from '@/lib/api';
import styles from './about.module.css';

type Changelog = {
  version: string;
  date: string | null;
  content: string;
};

type SectionCardProps = {
  title: string;
  color: string;
  children: ReactNode;
};

function SectionCard({ title, color, children }: SectionCardProps) {
  return (
    <section
      className={styles.sectionCard}
      style={{ '--section-accent': color } as CSSProperties}
    >
      <header className={styles.sectionCardHeader}>
        <h2>{title}</h2>
      </header>
      <div className={styles.sectionCardBody}>{children}</div>
    </section>
  );
}

function ChevronIcon({ open, size = 16 }: { open: boolean; size?: number }) {
  return (
    <svg
      className={open ? styles.chevronOpen : styles.chevron}
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function renderMarkdown(text: string) {
  return text.split('\n').map((line, index) => {
    const content = line.trim();
    if (!content || /^#{1,2}\s/.test(content)) return null;

    if (/^#{3,4}\s/.test(content)) {
      return (
        <h4 key={index}>
          {content.replace(/^#{3,4}\s*/, '').replace(/\*\*/g, '')}
        </h4>
      );
    }

    const isListItem = /^[-*]\s/.test(content);
    return (
      <p key={index} className={isListItem ? styles.logItem : undefined}>
        {isListItem && <span aria-hidden="true">•</span>}
        {content.replace(/^[-*]\s*/, '').replace(/\*\*/g, '').replace(/`/g, '')}
      </p>
    );
  });
}

export default function AboutPage() {
  const [logoError, setLogoError] = useState(false);
  const [changelogs, setChangelogs] = useState<Changelog[] | null>(null);
  const [changelogsOpen, setChangelogsOpen] = useState(false);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [expandedVersion, setExpandedVersion] = useState<string | null>(null);
  const [showAllLogs, setShowAllLogs] = useState(false);

  const loadChangelogs = useCallback(async () => {
    if (changelogs !== null) return;
    setLoadingLogs(true);
    try {
      const data = await api.getChangelogs();
      setChangelogs(data);
    } catch {
      setChangelogs([]);
    } finally {
      setLoadingLogs(false);
    }
  }, [changelogs]);

  const toggleChangelogs = useCallback(() => {
    const nextOpen = !changelogsOpen;
    setChangelogsOpen(nextOpen);
    if (nextOpen) void loadChangelogs();
  }, [changelogsOpen, loadChangelogs]);

  const visibleLogs = showAllLogs ? changelogs : changelogs?.slice(0, 5);

  return (
    <main className={styles.page}>
      <header className={styles.hero}>
        {logoError ? (
          <span className={styles.logoFallback}>支</span>
        ) : (
          <img className={styles.logo} src="/logo.png" alt="支点课堂 ClassNode" onError={() => setLogoError(true)} />
        )}
        <div className={styles.heroContent}>
          <div className={styles.titleRow}>
            <h1>支点课堂</h1>
            <span className={styles.version}>v{APP_VERSION}</span>
          </div>
          <p>ClassNode · 让每一次 AI 探索，都自然地发生在真实课堂里。</p>
        </div>
      </header>

      <section className={styles.letter} aria-labelledby="developer-letter-title">
        <div className={styles.letterContent}>
          <header className={styles.letterHeading}>
            <p className={styles.letterEyebrow}>写给每一位愿意尝试 AI 的老师</p>
            <h2 id="developer-letter-title"><span>让 AI 更容易</span><span>走进课堂，</span><span>陪伴学生学习</span></h2>
          </header>
          <div className={styles.letterMain}>
            <div className={styles.letterBody}>
              <p>
                支点课堂（ClassNode）源于我们在教学中的共同需要：老师精心设计了智能体，怎样才能方便地用到课堂上，让它真正成为学生的学习伙伴？
              </p>
              <p>
                在课堂上，学生的疑问需要及时回应，学习中的困难也需要尽早被看见。我们希望，学生能在与智能体的交流中获得及时反馈，继续思考和探索；老师也能了解学生的提问与学习进展，在需要的时候给予引导，让反馈和帮助就在学习发生的当下到来。
              </p>
              <p>
                为此，我们把不同平台的智能体接入同一个课堂入口，减少来回切换和重复操作，让各个平台的能力围绕教学需要协同起来。老师用心设计的智能体，也因此能够更自然地融入教学，陪伴学生提问、尝试和解决问题。
              </p>
              <p>
                我们也希望，这样的课堂尝试不需要复杂的准备。支点课堂以轻量化的方式运行在教师电脑上，学生通过互动码进入课堂，让老师更容易上手，把更多精力留给教学设计和学生。
              </p>
              <p className={styles.letterWish}>
                这就是我们做支点课堂的初衷：把平台连接好，把使用门槛降下来，让老师的用心设计，成为学生在学习中随时用得上的支持。
              </p>
            </div>
            <div className={styles.signature}>
              <span>
                <strong>张星昌</strong>
                <small>杭州市拱墅区教育研究院</small>
              </span>
            </div>
          </div>
        </div>
      </section>

      <SectionCard title="更新日志" color="#64748b">
        <button className={styles.logToggle} type="button" onClick={toggleChangelogs}>
          <ChevronIcon open={changelogsOpen} />
          <span className={styles.clock}><ClockIcon /></span>
          <strong>更新日志</strong>
          {loadingLogs && <small>加载中…</small>}
        </button>

        {changelogsOpen && changelogs && (
          <div className={styles.logList}>
            {changelogs.length === 0 ? (
              <p className={styles.logEmpty}>暂时无法获取更新日志</p>
            ) : (
              <>
                {visibleLogs?.map((log, index) => {
                  const expanded = expandedVersion === log.version;
                  return (
                    <div
                      className={`${styles.logVersion} ${expanded ? styles.logVersionExpanded : ''}`}
                      key={`${log.version}-${index}`}
                    >
                      <button
                        type="button"
                        onClick={() => setExpandedVersion(expanded ? null : log.version)}
                      >
                        <ChevronIcon open={expanded} size={12} />
                        <strong>{log.version}</strong>
                        {log.date && <time>{log.date}</time>}
                      </button>
                      {expanded && <div className={styles.logBody}>{renderMarkdown(log.content)}</div>}
                    </div>
                  );
                })}
                {!showAllLogs && changelogs.length > 5 && (
                  <button className={styles.showAllButton} type="button" onClick={() => setShowAllLogs(true)}>
                    显示全部更新日志（共 {changelogs.length} 条）
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </SectionCard>

      <footer className={styles.footer}>
        <strong>教学互促 · 源码共研</strong>
        <p>欢迎对技术感兴趣的老师访问仓库交流</p>
        <nav aria-label="支点课堂 ClassNode 代码仓库">
          <a href="https://gitcode.com/weixin_41523975/classnode" target="_blank" rel="noreferrer">
            <img src="/gitcode_logo.png" alt="" />
            GitCode
          </a>
          <a href="https://github.com/hzzxcgtz/classnode" target="_blank" rel="noreferrer">
            <img src="/github_logo.png" alt="" />
            GitHub
          </a>
        </nav>
        <small>Copyright 2026 编程研习工坊</small>
      </footer>
    </main>
  );
}
