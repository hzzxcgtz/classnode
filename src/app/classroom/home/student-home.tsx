'use client';

import { useState } from 'react';
import type { CSSProperties, Dispatch, SetStateAction } from 'react';
import type { AvatarSummary } from '@/lib/types';
import { MODULE_ID_BY_KEY, MODULE_KEYS, moduleStateOf } from '@/lib/classroom-modules';
import type { ChatToast, ClassroomInfo, ModuleId, StudentChatMessage, StudentSession } from '../classroom-types';
import { ClassroomToast, useOverlayPortal } from '../layer-overlays';
import { MODULE_META } from '../module-meta';
import { SvgAvatar } from '../chat/svg-avatar';
import { AvatarChangerModal, finishAvatarChange } from '../chat/avatar-changer';
import styles from './home.module.css';

export interface StudentHomeProps {
  /**
   * 首页此刻是否在前台（Task 5 引入，**无默认值**）。
   *
   * 首页常驻之后（§4.5 的挂载策略同样适用于它）「挂载」不再等于「可见」：学生进入任一
   * 模块后首页仍在 DOM 里，只为保留它自己的状态（滚动位置、换头像弹窗是否开着）。
   * 它自己没有任何页面级副作用，唯一需要这道闸的是下面那个 portal —— 提到 `document.body`
   * 的元素不继承本层的 `visibility:hidden`，会在模块之上浮起来（Ruling 5 / Task 2 同类问题）。
   */
  active: boolean;
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
 * 每张卡片的静态部分（模块名、图标、主色、按钮文案）住在 `../module-meta`：
 * 外壳的 Tab 栏与这里必须用同一份（§4.6：学生在卡片上认到的颜色，进到模块里还是同一个
 * 颜色），各写一份必然漂移。
 */

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
  active,
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
  // 与学伴面板同一套机制 —— 实现只留在 layer-overlays.tsx 一份。
  const overlayPortal = useOverlayPortal(active);

  const studentName = selectedStudent?.name || '同学';
  const studentAvatarSvg = selectedStudent?.avatarId ? avatarSvgs[selectedStudent.avatarId] : undefined;
  const canChangeAvatar = Boolean(selectedStudent?.studentId) && avatarTokenCount > 0;

  // 与学伴面板顶部栏同一套取值顺序（小组智能体优先，其次课堂第一个智能体），
  // 否则首页说「小科老师」、进去变成另一个名字。
  //
  // 兜底用模块的身份名（`MODULE_META.companion.label`，也就是卡片上的「智能学伴」）而不是
  // 再写一遍字面量：零智能体的课堂里，首页卡片、Tab 与面板标题必须说同一个名字，而三处
  // 各写一份字面量必然漂移。面板那一侧读的是同一个字段。
  const agentName = (() => {
    const fallbackName = MODULE_META.companion.label;
    if (!classroom) return fallbackName;
    const group = selectedStudent?.groupId
      ? classroom.groups?.find((item) => item.id === selectedStudent.groupId)
      : undefined;
    return group?.agent?.name || classroom.agents?.[0]?.name || fallbackName;
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

  // 换头像的收尾（写透当前会话 → 拉服务端权威数据）与学伴面板共用一份实现：
  // 首页的 props 结构性地满足 `AvatarChangeHost`，所以直接按名字传进去。
  const handleAvatarChanged = async (result: { avatarId: number; svgContent: string }) => {
    await finishAvatarChange(
      { classroom, selectedStudent, setAvatarSvgs, setSelectedStudent, setAllStudentAvatars, fetchStudentTokens },
      result,
      () => setShowAvatarChanger(false),
    );
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
                const card = MODULE_META[moduleId];
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

      {overlayPortal(
        // Task 5：弹窗与提示条都逃出了本层的 `visibility:hidden`（Ruling 5），所以要**显式**
        // 按 `active` 决定可见性 —— 否则学生在首页打开换头像弹窗后进入任一模块，弹窗会浮在
        // 模块之上。具体机制见 layer-overlays.tsx（与学伴面板同一份实现）。
        <>
          {toast && <ClassroomToast toast={toast} setToast={setToast} />}
          {showAvatarChanger && (
            <AvatarChangerModal
              titleId="home-avatar-changer-title"
              avatarTokenCount={avatarTokenCount}
              studentId={selectedStudent?.id ?? ''}
              avatars={allStudentAvatars}
              setToast={setToast}
              onClose={() => setShowAvatarChanger(false)}
              onChanged={handleAvatarChanged}
            />
          )}
        </>,
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
