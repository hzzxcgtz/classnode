'use client';

import { useEffect, useState } from 'react';
import type { CSSProperties, Dispatch, ReactNode, SetStateAction } from 'react';
import { createPortal } from 'react-dom';
import { api } from '@/lib/api';
import { Toast } from '@/lib/components';
import type { AvatarSummary } from '@/lib/types';
import { MODULE_ID_BY_KEY, MODULE_KEYS, moduleStateOf } from '@/lib/classroom-modules';
import type { ChatToast, ClassroomInfo, ModuleId, StudentChatMessage, StudentSession } from '../classroom-types';
import { fixSvgUrl } from '../avatar-utils';
import { SvgAvatar } from '../chat/svg-avatar';
import { AvatarChangerContent } from '../chat/avatar-changer';
import styles from './home.module.css';

export interface StudentHomeProps {
  code: string;
  classroom: ClassroomInfo | null;
  selectedStudent: StudentSession | null;
  avatarSvgs: Record<number, string>;
  allStudentAvatars: AvatarSummary[];
  avatarTokenCount: number;
  /** 学伴的历史消息：只读最后一次非空内容，用于「上次聊到…」。 */
  messages: StudentChatMessage[];
  toast: ChatToast | null;
  setToast: Dispatch<SetStateAction<ChatToast | null>>;
  setAvatarSvgs: Dispatch<SetStateAction<Record<number, string>>>;
  setAllStudentAvatars: Dispatch<SetStateAction<AvatarSummary[]>>;
  setSelectedStudent: Dispatch<SetStateAction<StudentSession | null>>;
  fetchStudentTokens: () => Promise<void>;
  onOpenModule: (moduleId: ModuleId) => void;
  onExit: () => void;
}

/**
 * 每张卡片的静态部分：模块名、图标、主色、按钮文案。
 *
 * 用 `Record<ModuleId, …>` 而不是数组或索引签名：模块词汇表（`ModuleId`）扩项时这里
 * **必须**报错，否则新模块在首页上会没有卡片。
 *
 * 三个颜色就是 §4.6 给模块定的身份色（学习单=蓝 / 探究助手=紫 / 学伴=青），与 Task 7 的
 * Tab 栏滑块同源 —— 学生在卡片上认到的颜色，进到模块里还是同一个颜色。
 */
const MODULE_CARDS: Record<ModuleId, { label: string; accent: string; cta: string; icon: ReactNode }> = {
  worksheet: {
    label: '学习单',
    accent: '#2563eb',
    cta: '继续作答',
    icon: (
      <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
      </svg>
    ),
  },
  explore: {
    label: '探究助手',
    accent: '#7c3aed',
    cta: '去探究',
    icon: (
      <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M9.5 2v6.2L4.6 17.4A1.8 1.8 0 0 0 6.2 20h11.6a1.8 1.8 0 0 0 1.6-2.6L14.5 8.2V2" />
        <path d="M8 2h8" />
        <path d="M7.4 14h9.2" />
      </svg>
    ),
  },
  companion: {
    label: '智能学伴',
    // §4.6 的「青」压深了一档（#0891b2 → #0e7490）：白字落在 #0891b2 上只有 4.0:1，
    // 按钮文字是 0.875rem 正文大小，够不到 AA 的 4.5:1。
    accent: '#0e7490',
    cta: '开始对话',
    icon: (
      <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5z" />
      </svg>
    ),
  },
};

/** 锁定角标（🔒）。画成 SVG 而不是用 emoji：与全局图标同一套线条，缩放不糊。 */
function LockBadge() {
  return (
    <span className={styles.lockBadge} aria-hidden="true">
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <rect x="4" y="11" width="16" height="10" rx="2" />
        <path d="M8 11V7a4 4 0 0 1 8 0v4" />
      </svg>
    </span>
  );
}

/**
 * 把最后一条有内容的消息压成一句短摘要。
 *
 * 从后往前找而不是取末条：助手回复可能只有空白或附件占位，那边界情况下取末条会得到
 * 一张空摘要。Markdown 记号一律压成空格 —— 卡片只有一行位置，`###` 与反引号在这
 * 里只是噪点。
 */
function summarizeLastRound(messages: StudentChatMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const text = (messages[i].content || '').replace(/[#*`>~\s]+/g, ' ').trim();
    if (text) return text.length > 32 ? `${text.slice(0, 32)}…` : text;
  }
  return null;
}

/**
 * 学生端首页（常驻门户，§4.2）：进入课堂后的默认落点，不是直接掉进某个模块。
 *
 * 三件事：我是谁（头像/姓名，可换头像）、这是哪堂课（班级名 + 互动码）、今天能做什么
 * （三张模块卡片，三态由教师实时决定）。
 *
 * **卡片从 `MODULE_KEYS` 渲染，不按 `classroom.modules` 的数组下标**（§4.11 B6）：
 * `applyModuleState` 在键缺失时会追加元素，下标会漂移 —— 按下标渲染，教师改一次态就可能
 * 让卡片换位甚至串号。这里遍历词汇表、逐键查态，顺序恒定。
 */
export function StudentHome({
  code,
  classroom,
  selectedStudent,
  avatarSvgs,
  allStudentAvatars,
  avatarTokenCount,
  messages,
  toast,
  setToast,
  setAvatarSvgs,
  setAllStudentAvatars,
  setSelectedStudent,
  fetchStudentTokens,
  onOpenModule,
  onExit,
}: StudentHomeProps) {
  const [showAvatarChanger, setShowAvatarChanger] = useState(false);
  // 浮层一律走 portal：Task 5 的切换动画会让首页成为 `transform` 容器，届时留在树内的
  // `position: fixed` 会被重新锚定到首页盒子（Task 2 同类问题）。现在就先摆正，
  // 顺带避开 SSR（静态导出）期没有 document 的问题。
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const studentName = selectedStudent?.name || '同学';
  const studentAvatarSvg = selectedStudent?.avatarId ? avatarSvgs[selectedStudent.avatarId] : undefined;
  const canChangeAvatar = Boolean(selectedStudent?.studentId) && avatarTokenCount > 0;

  // 与学伴面板顶部栏同一套取值顺序（小组智能体优先，其次课堂第一个智能体），
  // 否则首页说「小科老师」、进去变成另一个名字。
  const agentName = (() => {
    if (!classroom) return '智能学伴';
    const group = selectedStudent?.groupId
      ? classroom.groups?.find((item) => item.id === selectedStudent.groupId)
      : undefined;
    return group?.agent?.name || classroom.agents?.[0]?.name || '智能学伴';
  })();

  // 换头像要消耗老师奖励的机会（服务端 `avatarChangeTokens >= 1` 才放行）。没有机会时
  // 不留一个按不动的按钮，而是说清楚为什么 —— 空状态要给出方向，不是把入口藏掉。
  // 小组参与者没有这个入口（`studentId` 为空），也就没有这句提示。
  const avatarHint = !canChangeAvatar && selectedStudent?.studentId ? '换头像的机会由老师奖励' : null;

  const lastRound = summarizeLastRound(messages);

  // 三态的「主内容」：M2/M3 到位后只换这两个字符串，卡片结构不动。
  const cardContent: Record<ModuleId, { title: string; meta: string }> = {
    worksheet: {
      title: '还没有布置',
      meta: '老师布置后会出现在这里',
    },
    explore: {
      title: '还没有资料',
      meta: '老师添加网页后会出现在这里',
    },
    companion: {
      title: agentName,
      meta: lastRound ? `上次聊到：${lastRound}` : '还没开始对话，打个招呼吧',
    },
  };

  const cards = MODULE_KEYS
    .map((moduleKey) => ({ moduleKey, state: moduleStateOf(classroom?.modules, moduleKey) }))
    // `hidden` 是「不显示」而不是「灰掉」（§4.4）：教师没安排这个环节，学生不该看见它。
    .filter((entry) => entry.state !== 'hidden');

  const handleAvatarChanged = async (result: { avatarId: number; svgContent: string }) => {
    // 与学伴面板的头像弹窗同一套收尾：先写透当前会话，再拉一次服务端权威数据。
    setAvatarSvgs((current) => ({ ...current, [result.avatarId]: fixSvgUrl(result.svgContent) }));
    setSelectedStudent((current) => (current ? { ...current, avatarId: result.avatarId } : current));
    setShowAvatarChanger(false);
    void fetchStudentTokens();
    try {
      const [allAvatars, teacherAvatars] = await Promise.all([
        api.getAvatarsAll('student'),
        api.getAvatars('student'),
      ]);
      const svgMap: Record<number, string> = {};
      allAvatars.forEach((avatar) => { svgMap[avatar.id] = fixSvgUrl(avatar.svgContent); });
      setAvatarSvgs(svgMap);
      setAllStudentAvatars(teacherAvatars);
      if (classroom?.id && selectedStudent?.id) {
        const students = await api.getClassroomStudents(classroom.id);
        const updated = students.find((student) => student.id === selectedStudent.id);
        if (updated) setSelectedStudent(updated);
      }
    } catch {}
  };

  return (
    <div className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.topBar}>
          <div className={styles.classroomName}>{classroom?.title || '互动课堂'}</div>
          <div className={styles.codeChip}>
            <span className={styles.codeChipLabel}>互动码</span>
            <span className={styles.codeValue}>{code}</span>
          </div>
          <button type="button" className={styles.exitButton} onClick={onExit}>
            退出课堂
          </button>
        </header>

        <main className={styles.desk}>
          <section className={styles.identity}>
            {canChangeAvatar ? (
              <button
                type="button"
                className={styles.avatarButton}
                onClick={() => setShowAvatarChanger(true)}
                title="更换头像"
                aria-label="更换头像"
              >
                <AvatarFace svg={studentAvatarSvg} name={studentName} size={64} />
              </button>
            ) : (
              <span className={styles.avatarStatic}>
                <AvatarFace svg={studentAvatarSvg} name={studentName} size={64} />
              </span>
            )}
            <div className={styles.identityText}>
              <div className={styles.studentName}>{studentName}</div>
              <div className={styles.studentMeta}>
                {selectedStudent?.participantType === 'group'
                  ? '小组'
                  : selectedStudent?.studentNo
                    ? `学号 ${selectedStudent.studentNo}`
                    : '本班同学'}
              </div>
            </div>
            {canChangeAvatar ? (
              <button type="button" className={styles.changeAvatarButton} onClick={() => setShowAvatarChanger(true)}>
                换头像
                <span className={styles.tokenCount}>{avatarTokenCount}</span>
              </button>
            ) : avatarHint ? (
              <div className={styles.tokenHint}>{avatarHint}</div>
            ) : null}
          </section>

          <div className={styles.rule} />

          <h2 className={styles.sectionTitle}>今天的学习</h2>

          {cards.length === 0 ? (
            <p className={styles.emptyNote}>老师还没有开放今天的内容，先等等吧。</p>
          ) : (
            <div className={styles.cards}>
              {cards.map(({ moduleKey, state }) => {
                const moduleId = MODULE_ID_BY_KEY[moduleKey];
                const card = MODULE_CARDS[moduleId];
                const content = cardContent[moduleId];
                const locked = state === 'preview';
                return (
                  <button
                    key={moduleKey}
                    type="button"
                    className={locked ? `${styles.card} ${styles.cardLocked}` : styles.card}
                    style={{ '--card-accent': card.accent } as CSSProperties}
                    aria-disabled={locked || undefined}
                    onClick={() => {
                      if (locked) {
                        setToast({ msg: '老师还没开放', type: 'info' });
                        return;
                      }
                      onOpenModule(moduleId);
                    }}
                  >
                    <span className={styles.cardIcon}>
                      {card.icon}
                      {locked && <LockBadge />}
                    </span>
                    <span className={styles.cardBody}>
                      <span className={styles.cardName}>{card.label}</span>
                      <span className={styles.cardTitle}>{content.title}</span>
                      <span className={styles.cardMeta}>{content.meta}</span>
                    </span>
                    <span className={styles.cardCta}>{locked ? '未开放' : card.cta}</span>
                  </button>
                );
              })}
            </div>
          )}
        </main>
      </div>

      {mounted && createPortal(
        <>
          {toast && <Toast msg={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
          {showAvatarChanger && (
            <div className="modal-overlay" onClick={() => setShowAvatarChanger(false)}>
              <div
                className="modal-content"
                role="dialog"
                aria-modal="true"
                aria-labelledby="home-avatar-changer-title"
                onClick={(event) => event.stopPropagation()}
                style={{ maxWidth: 480, padding: 24 }}
              >
                <button
                  type="button"
                  aria-label="关闭更换头像窗口"
                  onClick={() => setShowAvatarChanger(false)}
                  style={{ float: 'right', border: 'none', background: 'transparent', cursor: 'pointer', fontSize: '1.25rem', color: '#64748b', lineHeight: 1 }}
                >
                  ×
                </button>
                <h3 id="home-avatar-changer-title" style={{ fontSize: '1rem', fontWeight: 600, margin: '0 0 4px' }}>更换头像</h3>
                <p style={{ fontSize: '0.75rem', color: '#64748b', margin: '0 0 4px' }}>
                  剩余 <strong style={{ color: '#d97706' }}>{avatarTokenCount}</strong> 次更换机会，由教师奖励获得
                </p>
                <p style={{ fontSize: '0.688rem', color: '#94a3b8', margin: '0 0 16px' }}>
                  可从教师头像库中选择，也可粘贴自定义 SVG 代码
                </p>
                <AvatarChangerContent
                  studentId={selectedStudent?.id ?? ''}
                  avatars={allStudentAvatars}
                  onChanged={handleAvatarChanged}
                  setToast={setToast}
                />
              </div>
            </div>
          )}
        </>,
        document.body,
      )}
    </div>
  );
}

/** 头像位：有自定义头像用头像，否则用姓名首字兜底（与身份页同一套降级）。 */
function AvatarFace({ svg, name, size }: { svg?: string; name: string; size: number }) {
  if (svg) return <SvgAvatar svg={svg} size={size} fallback={name[0]} />;
  return (
    <span className={styles.avatarFallback} style={{ width: size, height: size, fontSize: size * 0.4 }}>
      {name[0]}
    </span>
  );
}
