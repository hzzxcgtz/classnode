'use client';

import type { CSSProperties, Dispatch, SetStateAction } from 'react';
import { MODULE_ID_BY_KEY } from '@/lib/classroom-modules';
import { effectiveGroupAgent, effectiveGroupWebapp, effectiveGroupWorksheet, visibleModules } from '@/lib/classroom-material';
import type { ClassroomWebappSummary, WorksheetMaterialSummary } from '@/lib/types';
import type { ChatToast, ClassroomInfo, ModuleId, StudentChatMessage, StudentSession } from '../classroom-types';
import { ClassroomToast, useOverlayPortal } from '../layer-overlays';
import { MODULE_META } from '../module-meta';
import { SvgAvatar } from '../chat/svg-avatar';
import styles from './home.module.css';

export interface StudentHomeProps {
  /**
   * 首页此刻是否在前台（Task 5 引入，**无默认值**）。
   *
   * 首页常驻之后（§4.5 的挂载策略同样适用于它）「挂载」不再等于「可见」：学生进入任一
   * 模块后首页仍在 DOM 里，只为保留它自己的状态（滚动位置）。它自己没有任何页面级副作用，
   * 唯一需要这道闸的是下面那个 portal —— 提到 `document.body` 的元素不继承本层的
   * `visibility:hidden`，会在模块之上浮起来（Ruling 5 / Task 2 同类问题）。
   */
  active: boolean;
  classroom: ClassroomInfo | null;
  selectedStudent: StudentSession | null;
  avatarSvgs: Record<number, string>;
  /** 学伴的历史消息：只读最后一次非空内容，用于「上次聊到…」。 */
  messages: StudentChatMessage[];
  toast: ChatToast | null;
  setToast: Dispatch<SetStateAction<ChatToast | null>>;
  onOpenModule: (moduleId: ModuleId) => void;
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

/* ⊘ 2026-09-27（v6 改版）删除 `clipCardText`（32 字截断）。
 *
 * 它当初的理由是「超长文案会把卡片撑高，而三张卡的按钮靠 `min-height` 对齐」——
 * 新版卡片的信息块是**固定高度 + `-webkit-line-clamp: 2`**：按真实宽度截断、且高度恒定，
 * 那两件事都由 CSS 一处负责。留着 JS 那一份的话，一张 50 字的学习单标题会被截在 32 字，
 * 而它本来放得下 —— 学生看不到自己那份单子的全名，且没有任何线索说明为什么。 */

/**
 * 把最后一条有内容的消息压成一句短摘要。
 *
 * 从后往前找而不是取末条：助手回复可能只有空白或附件占位，那边界情况下取末条会得到
 * 一张空摘要。Markdown 记号一律压成空格 —— 卡片上那一格是两行正文，`###` 与反引号
 * 在那里只是噪点。
 *
 * ★ 2026-09-27（v6 改版）：**去掉了 32 字的 JS 截断**。原来它承担的是「三张卡的按钮对齐」
 * （靠 `.cardMeta` 的 `min-height`）—— 现在那一格是**固定高度 + `-webkit-line-clamp: 2`**，
 * 截断由 CSS 按真实宽度做，比按字符数猜准得多。两套截断并存只会让「到底谁在截」说不清。
 */
function summarizeLastRound(messages: StudentChatMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const text = (messages[i].content || '').replace(/[#*`>~\s]+/g, ' ').trim();
    if (text) return text;
  }
  return null;
}

/**
 * 「学习单」卡片信息块里的那一句话 —— **这个学生（这一组）此刻该作答的是哪一份**。
 *
 * ⚠️ 数据来源是 `effectiveGroupWorksheet`，**本函数不自己挑**（理由见下面各处的注释）。
 * ⚠️ **`null` 时分成两种说法**，不能合并（规格 §8.4，与学生端面板 `worksheet-panel.tsx` 的
 * 空状态**逐字对齐**）：
 *   · 高级模式 —— `null` 是「**本组**没配」，不是「老师没布置」：别的组可能有。
 *     面板在那里说「本组未配置学习单」，卡片必须说同一件事。
 *   · 其余 —— 才是「老师还没有布置」。
 * 两者都说清出路（「问问老师」/「以后会出现」），因为卡片那一格只有两行，而这两句都给出路。
 *
 * ★ 2026-09-27（v6）：原来这里返回 `{title, meta}` 两句（标题 + 「老师布置的学习单」），
 * 而新版卡片的信息块只有**一句话** —— 「老师布置的学习单」那句由药丸
 * （`MODULE_META.summaryLabel` 的「今天的任务」）承担了，再写一遍就是同一句话说两次。
 */
function worksheetCardSummary(
  classroom: ClassroomInfo | null,
  worksheet: WorksheetMaterialSummary | null,
): string {
  if (worksheet) return worksheet.title;
  if (classroom?.mode === 'advanced') return '本组未配置学习单，先和同伴讨论或问问老师';
  return '老师布置后会出现在这里';
}

/**
 * 「探究空间」卡片信息块里的那一句话 —— **这个学生此刻能打开的那个网页叫什么**。
 *
 * 🔴 **取哪个网页由 `effectiveGroupWebapp` 决定，本函数不自己挑**：它原来读的是
 * `classroom.webapps[0]`（课堂级），高级模式下会让卡片写着 A 组网页的名字、点进去却是
 * 「本组未配置探究网页」—— 同一张卡与面板两个说法（与学伴卡那边「首页说一个名字、
 * 进去变成另一个」是同一类漂移）。
 *
 * ⚠️ **有关联网页时刻意不写「共 N 个」**：面板此刻只加载那一个网页（多网页的列表选择是
 * P2 已知的收窄）—— 承诺一个点不到的东西是**同一类撒谎换了个方向**。
 * 空状态那句与原来逐字相同：对这个学生而言，确实就是「（我这边）还没有」+「以后会出现」。
 */
function exploreCardSummary(webapp: ClassroomWebappSummary | null): string {
  if (!webapp) return '老师添加网页后会出现在这里';
  return webapp.name;
}

/**
 * 「智能学伴」卡片信息块里的那一句话 —— 上次聊到哪儿，或者为什么还没聊起来。
 *
 * 🔴 **「本组没配智能体」要说出来**（P2 那条「高级模式不回落」的同一条纪律）：不说的话，
 * 那种课堂上的学生只会看到一句「还没开始对话，打个招呼吧」，进去才发现根本没有人可聊 ——
 * 而「问了没反应」与「这里本来就没有学伴」是两件完全不同的事。
 */
function companionCardSummary(hasAgent: boolean, lastRound: string | null): string {
  if (lastRound) return lastRound;
  if (!hasAgent) return '本组还没配置学伴，先问问老师';
  return '还没开始对话，打个招呼吧';
}

/**
 * 学生端首页（常驻门户，§4.2）：进入课堂后的默认落点，不是直接掉进某个模块。
 *
 * 今天只做一件事：**今天能做什么**（三张模块卡片，三态由教师实时决定）。
 * 另外两项「我是谁」「这是哪堂课」在 M1b-3 里逐项离场：
 *   · 「我是谁」的**入口**（换头像）T2 起归顶栏的学生 chip（Ruling 1）—— 首页只**显示**当前
 *     头像，那是下面那张身份卡（`.identity`）的事，本任务一行没动；
 *   · 「这是哪堂课」（班级名 + 互动码）与它同行的那枚「退出课堂」**整个头部行**随本任务（T6）
 *     撤除（Ruling 9 / Ruling 10）：班级名与互动码是教师视角的编排信息，学生端不需要；
 *     退出课堂也已经在顶栏有一份（M1b-3 T5），留着就是同一能力两个入口。
 *   ⇒ 撤除之后 `.shell` 里只剩 `.desk` 一张卡，首页正文直接顶上来。
 *
 * ⚠️ 因此 `StudentHomeProps` 里不再有 `code` 与 `onExit` —— 它们在本文件里的最后两个读者
 * 就是被撤除的那一行。删掉之后**编译期会立刻发现漏改**：`page.tsx` 给 `home` 对象传的
 * `code` / `onExit` 变成多余属性，`tsc` 直接报错（`_ContractCheck` 抓不住「把契约改宽」，
 * 但这一路是收窄，靠调用点就能收口）。
 *
 * **卡片从 `MODULE_KEYS` 渲染，不按 `classroom.modules` 的数组下标**（§4.11 B6）：
 * `applyModuleState` 在键缺失时会追加元素，下标会漂移 —— 按下标渲染，教师改一次态就可能
 * 让卡片换位甚至串号。这里遍历词汇表、逐键查态，顺序恒定。
 */
export function StudentHome({
  active,
  classroom,
  selectedStudent,
  avatarSvgs,
  messages,
  toast,
  setToast,
  onOpenModule,
}: StudentHomeProps) {
  // 浮层一律走 portal：Task 5 的切换动画会让首页成为 `transform` 容器，届时留在树内的
  // `position: fixed` 会被重新锚定到首页盒子（Task 2 同类问题）。现在就先摆正，
  // 顺带避开 SSR（静态导出）期没有 document 的问题。
  // 与学伴面板同一套机制 —— 实现只留在 layer-overlays.tsx 一份。
  const overlayPortal = useOverlayPortal(active);

  const studentName = selectedStudent?.name || '同学';
  const studentAvatarSvg = selectedStudent?.avatarId ? avatarSvgs[selectedStudent.avatarId] : undefined;

  // 与学伴面板**欢迎卡片**说同一个名字，否则首页说「小科老师」、进去变成另一个名字。
  // ⚠️ 原文写的是「与学伴面板顶部栏同一套取值顺序」—— 那行头部已由 M1b-3 T4 整个撤除。
  // 但这条不变量**仍然真实存在**：面板仅存的展示点是欢迎卡片（chat-panel.tsx 的
  // renderAgentAvatar 那一处）。
  //
  // 🔴 **P2 起两边不再「各写一份、保证顺序一致」，而是读同一个函数**
  // （`@/lib/classroom-material` 的 `effectiveGroupAgent`，chat-panel.tsx 那侧同款调用）。
  // 各写一份的代价实测出来过：那两份都写了「找不到自己组的就回落到 `classroom.agents[0]`」，
  // 而该数组在高级模式下曾是各组智能体的并集 ⇒ 组里没配智能体的学生在首页看到**别的组的
  // 名字**，AI 照常回答、教师完全看不出（spec §1.2 ①）。高级模式**不回落**这条现在只有
  // 一份实现，顺序漂移这件事在结构上不可能再发生。
  //
  // 兜底用模块的身份名（`MODULE_META.companion.label`，也就是卡片上的「智能学伴」）而不是
  // 再写一遍字面量：零智能体的课堂里，首页卡片、Tab 与面板标题必须说同一个名字，而三处
  // 各写一份字面量必然漂移。面板那一侧读的是同一个函数、同一份兜底。
  const agent = effectiveGroupAgent(classroom, selectedStudent);
  const agentName = agent?.name || MODULE_META.companion.label;

  // 换头像要消耗老师奖励的机会（服务端 `avatarChangeTokens >= 1` 才放行）。那套「没有机会
  // 时要说清为什么」的反馈没有丢，只是搬到了顶栏那个入口上：M1b-3 T2 起点击顶栏头像时由
  // 外壳说一句同样的「换头像的机会由老师奖励」（这里原本有一行常驻提示与 `canChangeAvatar`
  // 判断，随首页的两个入口一并撤除）。

  const lastRound = summarizeLastRound(messages);

  // 信息块里那一句话 —— 三张卡**都读真数据**（学习单标题 / 关联网页名 / 最后一轮对话）。
  // ★ 2026-09-27（v6）：从「标题 + 副标题」两句压成**一句**（新版卡片那一格只有一行数据，
  // 上面那枚药丸已经把「这是什么」说了）。取数据的判据一个字没改，全在三个 helper 里。
  const cardSummary: Record<ModuleId, string> = {
    worksheet: worksheetCardSummary(classroom, effectiveGroupWorksheet(classroom, selectedStudent)),
    // 同一个 `effectiveGroupWebapp`：卡片说的网页就是面板会打开的那一个。
    explore: exploreCardSummary(effectiveGroupWebapp(classroom, selectedStudent)),
    companion: companionCardSummary(Boolean(agent), lastRound),
  };
  /**
   * 「智能学伴」的副标题。★ v6：**有真智能体时把名字写进去** ——
   * 新版卡片的副标题位从「模块说明」换成了设计稿写死的「和 AI 一起思考」，
   * 而「这个课堂的 AI 叫什么」是学生该知道的（面板里用的就是这个名字）。
   * 没有智能体时用设计稿原话，不编一个「和智能学伴一起思考」那种绕口的句子。
   */
  const companionSubtitle = agent ? `和${agent.name}一起思考` : MODULE_META.companion.subtitle;

  // ★ 2026-09-27：这段原来是 `MODULE_KEYS.map(…).filter(state !== 'hidden')` —— 与
  // `shell/use-module-tabs.ts` 里那份**逐字相同的拷贝**。两者现在都走 `visibleModules`：
  // 🔴 判据这轮多了一条（「这节课没有对应材料的模块也不显示」，教师 2026-09-27 的要求），
  //    拷贝留着就会长出「顶栏藏了、首页还摆着一张点进去什么都没有的卡」这种自相矛盾。
  // 判据的完整理由（含为什么学伴恒真、为什么按学生自己的组判）在 `visibleModules` 上。
  const cards = visibleModules(classroom, selectedStudent);

  // 换头像的收尾（写透当前会话 → 拉服务端权威数据）不再长在这里：它随两个入口一起搬进了
  // 外壳（`shell/classroom-shell.tsx` 的 `handleAvatarChanged`）。共用实现没变，仍是
  // `avatar-changer.tsx` 的 `finishAvatarChange` —— 只是换成外壳把自己的 `chat` 传进去。

  return (
    <div className={styles.page}>
      <div className={styles.shell}>
        <main className={styles.desk}>
          <section className={styles.identity}>
            {/* 头像只**显示**，不再是一个按钮（M1b-3 T2）：换头像的唯一入口是顶栏的学生
                chip，两个入口并存正是本次要消掉的那种重复。 */}
            <span className={styles.avatarStatic}>
              <AvatarFace svg={studentAvatarSvg} name={studentName} size={64} />
            </span>
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
          </section>

          <div className={styles.rule} />

          <header className={styles.heading}>
            <h2 className={styles.headingTitle}>今天的学习</h2>
            <p className={styles.headingLead}>一步一步，发现新知识</p>
          </header>

          {cards.length === 0 ? (
            <p className={styles.emptyNote}>老师还没有开放今天的内容，先等等吧。</p>
          ) : (
            <div className={styles.cards}>
              {cards.map(({ moduleKey, state }) => {
                const moduleId = MODULE_ID_BY_KEY[moduleKey];
                const card = MODULE_META[moduleId];
                const locked = state === 'preview';
                const open = () => {
                  if (locked) {
                    setToast({ msg: '老师还没开放', type: 'info' });
                    return;
                  }
                  onOpenModule(moduleId);
                };
                return (
                  /* ★ 2026-09-27（v6）：卡片从 `<button>` 改成 `<article>` + 内层一个真正的
                     `<button>`。**不是风格问题**：新版卡片里有一个通栏按钮，而 `<button>`
                     里不能再套 `<button>`（非法 HTML，浏览器会把嵌套的那个拆出去，行为
                     因浏览器而异）。原来「点卡片任意处」那一层热点由这一枚通栏按钮承担 ——
                     它占满卡片宽度、44px 以上，也是键盘可达的那一个。
                     ⚠️ 所以**不要**给 `<article>` 加 onClick：一个能点但键盘到不了的 div
                     比少一层热点糟得多。 */
                  <article
                    key={moduleKey}
                    className={locked ? `${styles.card} ${styles.cardLocked}` : styles.card}
                    /* 🔴 **八个变量一个都不能少。** CSS 侧 `home.module.css` 的 `.card` 给它们
                       都写了蓝色兜底值 ⇒ 漏传的那几个会**静默变成蓝色**（三张卡里有一张
                       长得跟学习单一样），而 `tsc` / `eslint` / 渲染都不报任何错 ——
                       变量名是字符串，没人核对。`home-module-meta.test.ts` 有一条网钉着
                       「CSS 读的每一个 `--card-*` 这里都设了」。 */
                    style={{
                      '--card-accent': card.accent,
                      '--card-accent-strong': card.accentStrong,
                      '--card-icon-tint': card.iconTint,
                      '--card-icon-rim': card.iconRim,
                      '--card-surface': card.cardSurface,
                      '--card-surface-deep': card.cardSurfaceDeep,
                      '--card-pill': card.cardPill,
                      '--card-line': card.cardLine,
                    } as CSSProperties}
                  >
                    <div className={styles.cardHero}>
                      <div className={styles.cardIdentity}>
                        <h3 className={styles.cardName}>{card.label}</h3>
                        <p className={styles.cardSubtitle}>
                          {moduleId === 'companion' ? companionSubtitle : card.subtitle}
                        </p>
                      </div>
                      <span className={styles.cardIcon}>
                        {/* `iconSrc` 而不是 `card.icon`：卡片用插画，Tab 用的白色线稿在 21px
                            上只剩几根细线。分工见 `module-meta.tsx`。
                            `alt=""` 是刻意的 —— 卡片正文紧接着就是模块名，图标是装饰，
                            读屏再念一遍只是啰嗦。 */}
                        <img className={styles.cardIconImage} src={card.iconSrc} alt="" width={104} height={104} />
                        {locked && <LockBadge />}
                      </span>
                    </div>
                    <div className={styles.cardRule} />
                    <div className={styles.cardInfo}>
                      <span className={styles.cardPill}>{card.summaryLabel}</span>
                      <p className={styles.cardSummary}>{cardSummary[moduleId]}</p>
                    </div>
                    <button
                      type="button"
                      className={styles.cardCta}
                      aria-disabled={locked || undefined}
                      onClick={open}
                    >
                      {locked ? '未开放' : card.cta}
                      <span className={styles.cardCtaArrow} aria-hidden="true">→</span>
                    </button>
                  </article>
                );
              })}
            </div>
          )}
        </main>
      </div>

      {overlayPortal(
        // Task 5：提示条逃出了本层的 `visibility:hidden`（Ruling 5），所以要**显式**按 `active`
        // 决定可见性 —— 否则学生在首页拿到一条提示后进入任一模块，它会浮在模块之上。具体
        // 机制见 layer-overlays.tsx（与学伴面板同一份实现）。
        //
        // 这里原本还并排渲染着首页自己的换头像弹窗，M1b-3 T2 撤除：换头像的入口只剩顶栏
        // 一个，弹窗跟着入口一起上移到外壳，而外壳那个 portal 传的是**恒为真**的 `active`
        // （理由见 classroom-shell.tsx）。首页这个 portal 继续只管提示条，`active` 语义不变。
        toast && <ClassroomToast toast={toast} setToast={setToast} />,
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
