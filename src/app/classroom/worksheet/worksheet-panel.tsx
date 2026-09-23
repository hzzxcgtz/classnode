'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { getStudentSessionAuthorization } from '@/lib/api';
import { getApiBaseUrl } from '@/lib/api-base';
import { effectiveGroupWorksheet } from '@/lib/classroom-material';
import type { WorksheetQuestionNode } from '@/lib/types';
import { flattenQuestions, isDraftEmpty, questionTypeLabel, readOptions, type AnswerDraft } from '@/lib/worksheet-questions';
import type { ModulePanelProps } from '../classroom-types';
import { ClassroomToast, useOverlayPortal } from '../layer-overlays';
import { MODULE_META } from '../module-meta';
import { useModuleViewport } from '../shell/use-module-viewport';
import {
  questionDisplayState,
  useWorksheetAnswers,
  type WorksheetQuestionStatus,
} from './use-worksheet-answers';
import styles from './worksheet.module.css';

/**
 * 学生端的学习单面板（规格 §8）。
 *
 * 契约与探究空间面板同款：`extends ModulePanelProps`，六项都由外壳给（`active` /
 * `state` / `classroom` / `session` / `toast` / `setToast`）。
 *
 * ── 三条硬约束，逐条对应下面的一处代码 ────────────────────────────────────────
 *
 * ① **层内滚动**（规格 §8.1）：`.stage` 是 `overflow: hidden`，每一层自己管自己的滚动。
 *    所以面板是 `height:100%` + **内部滚动容器**（`.scroller`），**不是滚页面** ——
 *    后者会让「保存了没有」那一条随整卷滚出视口。
 *
 * ② **iOS 键盘 / viewport 走 D1 抽出的共用 hook**（§3-AB）：**不要**在这里另写一套
 *    `visualViewport` 处理。两个模块各写一套必然分叉，其中一个修了 bug 另一个没修。
 *    ⚠️ `cssVar` 必须传 `'--module-viewport-height'` —— 与学伴面板**同一个名字**是刻意的
 *    （理由在那个 hook 的文档里：共用才不会出现「新面板的变量还没被设过」的那一帧）。
 *
 * ③ **本组未配置学习单 ≠ 老师没布置**（规格 §8.4）：高级模式下每个组各有一份，
 *    「这一组没有」被 `effectiveGroupWorksheet` 收成 `null`，界面要说对是谁的问题，
 *    并且**绝不拿别组的顶上**。
 *
 * ── 为什么首屏走 `GET /code/:code` 而不是 socket 的 `joined` ────────────────────
 * socket 的 `joined` 载荷里**只有 `groups[]`，没有课堂级 `worksheets`**（它从来也不发
 * `webapps`）。标准 / 分组模式的材料权威来源是**课堂级**那一个数组 ——
 * 面板若只依赖 `joined`，那两种模式下会「什么都没有」且不报错。本面板读的是外壳从
 * `useClassroomSession` 拿到的 `classroom`，而那条链路走的是 `GET /api/classroom/code/:code`，
 * 课堂级 `worksheets` 与 `groups[].worksheet` **都在**（`resolveGroupMaterialViews` /
 * `loadClassroomWorksheets`）。题目结构再按 id 单独拉（服务端已剥掉答案字段，§5.4）。
 */

/** `student-view` 的一次读取。`questions` 已拍平（见 `flattenQuestions`）。 */
interface LoadedWorksheet {
  id: string;
  title: string;
  questions: WorksheetQuestionNode[];
  /**
   * 「提交之后还能不能改」（规格 §8.4 的「三层控制」里的**第二层**）。
   *
   * 第一层在服务端（`PUT /:id/answers` 对已提交的题回 **409**，B3 做的）—— 那一层是
   * 唯一真正说了算的。但**只有它不够**：学生照样能敲字、能看见自己在改，然后那一次改动
   * 被 409 丢掉。所以这一层在这里：`false` 时已提交的题**收起输入控件**，
   * 与规格 §8.4 那张表说的「学生改已提交的题」的唯一合法前提（`allowResubmit` 为真）对齐。
   */
  allowResubmit: boolean;
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; worksheet: LoadedWorksheet }
  | { kind: 'error'; message: string };

/**
 * ── 作答态渲染（唯一一份）────────────────────────────────────────────────────
 *
 * 🔴 这个组件**同时**被两处渲染，这是刻意的：
 *   · 学生端的本面板（`interactive`，学生真的在作答）；
 *   · 教师端的「学生端预览」（`interactive={false}`，只读）。
 *
 * 规格 §6.3 让教师**拿那个弹窗当验收依据**（原话是「教师看到的就是学生看到的宽度」）。
 * 在本次改动之前，教师端那个弹窗里是**手写的一份只读模仿** —— 于是同一份 `content`
 * 被两段各自演化的 JSX 画出来，「预览里长这样、学生那里不是」会成为一种没有任何报错的
 * 失真。现在两处是同一个组件、同一套样式（这个文件的 CSS module），分叉在结构上不可能。
 *
 * `interactive={false}` 时：控件 `disabled`、不渲染「提交本题」、不做任何状态芯片
 * （预览没有作答态可言），也不显示正确答案 —— 那会让教师误以为学生也看得到。
 *
 * 题目树在**调用方**拍平（`flattenQuestions`），所以两处传进来的都是扁平的一列 ——
 * 「屏幕上画几道」这条口径也只有一处。
 */
export interface WorksheetQuestionListProps {
  questions: WorksheetQuestionNode[];
  /** 界面上的输入态。只读态传空对象即可。 */
  drafts: Record<string, AnswerDraft>;
  statuses: Record<string, WorksheetQuestionStatus>;
  submitting: Record<string, boolean>;
  interactive: boolean;
  /**
   * 「提交之后还能不能改」（规格 §8.4 的第二层，第一层在服务端的 409）。
   *
   * `false` ⇒ **已提交**的题收起输入控件、不渲染「重新提交」。只读态（预览）不受影响 ——
   * 那里 `statuses` 是空的，没有「已提交」可言。
   */
  allowResubmit: boolean;
  onChange?: (node: WorksheetQuestionNode, draft: AnswerDraft) => void;
  onSubmit?: (node: WorksheetQuestionNode) => void;
}

export function WorksheetQuestionList({
  questions,
  drafts,
  statuses,
  submitting,
  interactive,
  allowResubmit,
  onChange,
  onSubmit,
}: WorksheetQuestionListProps) {
  if (questions.length === 0) {
    return (
      <div className={styles.questions} data-interactive={interactive ? '1' : '0'}>
        <p className={styles.cardNote}>这份学习单还没有题目。</p>
      </div>
    );
  }

  return (
    <div className={styles.questions} data-interactive={interactive ? '1' : '0'}>
      {questions.map((node, index) => {
        const draft = drafts[node.id] ?? { selected: '', text: '' };
        const state = questionDisplayState(statuses[node.id], draft);
        const submitted = statuses[node.id] === 'submitted';
        // 已提交 + 不许重交 ⇒ 这一题对学生是「定稿」。控件收起，按钮不出现。
        const locked = submitted && !allowResubmit;
        const options = readOptions(node);
        // 没内容可提交、又还没交过 ⇒ 按钮按不动（点下去必然被服务端 400 拒）。
        const submitDisabled = Boolean(submitting[node.id]) || (!submitted && isDraftEmpty(draft));
        const controlsDisabled = !interactive || locked;
        return (
          <section className={styles.question} key={node.id}>
            <div className={styles.questionHead}>
              <span className={styles.questionIndex}>{index + 1}</span>
              <span className={styles.questionType}>{questionTypeLabel(node.type)}</span>
              {/* 状态挂在题号旁（规格 §8.2）：`✓ 已提交` / `◐ 作答中` / 空白 = 未作答。
                  文案由 `questionDisplayState` 一处给出，样式按 `data-state` 分三态。 */}
              <span className={styles.questionState} data-state={state}>
                {state === 'submitted' ? '✓ 已提交' : state === 'drafting' ? '◐ 作答中' : ''}
              </span>
            </div>

            <div className={styles.prompt}>
              {node.prompt.trim()
                ? node.prompt
                : <span className={styles.placeholder}>（这道题的题干还没写）</span>}
            </div>

            {node.type === 'single-choice' ? (
              options.length === 0 ? (
                <p className={styles.cardNote}>（这道题还没有选项）</p>
              ) : (
                <div className={styles.options}>
                  {options.map((option) => (
                    <label
                      className={`${styles.option}${draft.selected === option.key ? ` ${styles.optionSelected}` : ''}`}
                      key={option.key}
                    >
                      <input
                        className={styles.optionInput}
                        type="radio"
                        // ⚠️ name 必须带 `node.id`：同卷多题如果共用名字，选了第 1 题会把
                        // 第 2 题的选择顶掉 —— 而两份 JSX（学生端 / 预览）也不会同时挂载。
                        name={`worksheet-choice-${node.id}`}
                        checked={draft.selected === option.key}
                        disabled={controlsDisabled}
                        onChange={() => onChange?.(node, { ...draft, selected: option.key })}
                      />
                      <span className={styles.optionKey}>{option.key}</span>
                      <span className={styles.optionText}>
                        {option.text.trim() || <span className={styles.placeholder}>（选项 {option.key} 还没写）</span>}
                      </span>
                    </label>
                  ))}
                </div>
              )
            ) : null}

            {node.type === 'fill-blank' ? (
              <input
                className={styles.input}
                type="text"
                value={draft.text}
                disabled={controlsDisabled}
                placeholder="在这里填写答案"
                onChange={(event) => onChange?.(node, { ...draft, text: event.target.value })}
              />
            ) : null}

            {node.type === 'short-answer' ? (
              <textarea
                className={`${styles.input} ${styles.textarea}`}
                value={draft.text}
                rows={3}
                disabled={controlsDisabled}
                placeholder="在这里作答"
                onChange={(event) => onChange?.(node, { ...draft, text: event.target.value })}
              />
            ) : null}

            {/* 未知题型：说清楚，而不是渲染成一个空的题（学生会以为界面坏了）。 */}
            {node.type !== 'single-choice' && node.type !== 'fill-blank' && node.type !== 'short-answer' ? (
              <p className={styles.cardNote}>（这道题的题型暂时没法在这里作答）</p>
            ) : null}

            {/* 「提交本题」内联在每题下方，**不做固定底栏**（规格 §3-AC）。
                ⚠️ 锁住时不渲染按钮，而是说清楚为什么 —— 一个按不动的「重新提交」比
                一句话难懂得多（学生会反复点它）。 */}
            {interactive ? (
              locked ? (
                <p className={styles.lockedNote}>老师已设置本题提交后不可修改</p>
              ) : (
                <div className={styles.submitRow}>
                  <button
                    type="button"
                    className={`${styles.submitButton}${submitted ? ` ${styles.submitButtonResubmit}` : ''}`}
                    disabled={submitDisabled}
                    onClick={() => onSubmit?.(node)}
                  >
                    {submitting[node.id] ? '提交中…' : submitted ? '重新提交' : '提交本题'}
                  </button>
                </div>
              )
            ) : null}
          </section>
        );
      })}
    </div>
  );
}

/**
 * 面板本体。
 *
 * props 就是契约那六项，没有额外项 —— 与探究空间面板不同，学习单**不需要**借 socket
 * （作答走 HTTP，实时广播是服务端 → 教师看板那一侧的事，§5.7）。
 */
export function WorksheetPanel({ active, classroom, session, toast, setToast }: ModulePanelProps) {
  const accent = MODULE_META.worksheet.accent;
  const label = MODULE_META.worksheet.label;

  const containerRef = useRef<HTMLDivElement | null>(null);
  // 见文件头 ②：`cssVar` 与学伴面板共用同一个名字，**不要**改成模块专属的名字。
  useModuleViewport({ active, containerRef, cssVar: '--module-viewport-height' });

  /**
   * 🔴 网页/智能体/学习单三者的解析口径**完全一致**（`@/lib/classroom-material`）：
   * 高级模式只认**学生自己的组**，本组没配就是 `null`，**不回落**到课堂级数组
   * （那个数组在高级模式下可能是别的组的材料 —— 学生会静默地用别的组的单子，
   * 而画面看起来完全正常）。
   */
  const material = effectiveGroupWorksheet(classroom, session);
  const worksheetId = material?.id ?? null;

  const [load, setLoad] = useState<LoadState>({ kind: 'loading' });
  /** 重试按钮的计数器：+1 ⇒ 重新拉一次（不改 key，避免把面板整个重挂）。 */
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (!worksheetId) {
      setLoad({ kind: 'loading' });
      return;
    }
    let cancelled = false;
    setLoad({ kind: 'loading' });
    (async () => {
      try {
        const res = await fetch(`${getApiBaseUrl()}/api/worksheets/${encodeURIComponent(worksheetId)}/student-view`, {
          credentials: 'include',
          headers: { ...getStudentSessionAuthorization() },
        });
        if (cancelled) return;
        if (!res.ok) {
          const payload = await res.json().catch(() => null);
          const message = payload && typeof payload.error === 'string' && payload.error ? payload.error : null;
          setLoad({ kind: 'error', message: message || `读取学习单失败（错误 ${res.status}）` });
          return;
        }
        const data = await res.json() as {
          id: string;
          title: string;
          content?: { nodes?: unknown };
          settings?: { allowResubmit?: unknown };
        };
        if (cancelled) return;
        const rawNodes = data.content && Array.isArray(data.content.nodes) ? data.content.nodes : [];
        setLoad({
          kind: 'ready',
          worksheet: {
            id: data.id,
            title: data.title,
            questions: flattenQuestions(rawNodes as WorksheetQuestionNode[]),
            // 缺字段时按**允许**处理：服务端的 `readStudentSettings` 一定会补齐这两个键
            // （落库的 `settings` 都过了 `normalizeSettings`），所以缺字段只可能是更老的
            // 服务端。那种情况下把学生锁住，才是真正的伤害。
            allowResubmit: data.settings?.allowResubmit !== false,
          },
        });
      } catch {
        if (!cancelled) setLoad({ kind: 'error', message: '网络不太好，学习单没能读出来' });
      }
    })();
    return () => { cancelled = true; };
  }, [worksheetId, reloadToken]);

  const questions = load.kind === 'ready' ? load.worksheet.questions : [];
  const answers = useWorksheetAnswers({
    classroomId: classroom?.id ?? null,
    participantId: session?.id ?? null,
    worksheetId,
    questions,
    setToast,
  });

  const handleChange = useCallback((node: WorksheetQuestionNode, draft: AnswerDraft) => {
    answers.setDraft(node, draft);
  }, [answers]);
  const handleSubmit = useCallback((node: WorksheetQuestionNode) => {
    void answers.submit(node);
  }, [answers]);

  const overlayPortal = useOverlayPortal(active);

  const submittedCount = questions.filter((node) => answers.statuses[node.id] === 'submitted').length;
  const total = questions.length;

  /**
   * 顶部那一条的保存状态（规格 §8.2）。四种文案，**判据只在这里一处**：
   *   · 有积压且上一次尝试失败/浏览器自报离线 ⇒ 「⚠ 离线 · N 条待同步」（整条变琥珀）
   *   · 自报离线但暂时没有积压 ⇒ 「⚠ 离线」（那时说「已保存」是一句假话）
   *   · 有改动在防抖窗口里 / 有请求在途 / 队列非空 ⇒ 「保存中…」
   *   · 其余 ⇒ 「已保存 ✓」
   */
  const saveText = answers.pendingCount > 0 && answers.offline
    ? `⚠ 离线 · ${answers.pendingCount} 条待同步`
    : answers.offline
      ? '⚠ 离线'
      : answers.saving
        ? '保存中…'
        : '已保存 ✓';

  return (
    <div
      className={styles.panel}
      ref={containerRef}
      style={{ '--module-accent': accent } as CSSProperties}
      // 排障用的观测点：它记的是**界面上看不见、错了也不报错**的状态 ——
      // 「以为在线」与「其实在断网重试」在截图上完全一样。
      data-offline={answers.offline ? '1' : '0'}
      data-pending={answers.pendingCount}
      data-load={load.kind}
    >
      {worksheetId && load.kind === 'ready' ? (
        <>
          <div className={styles.topbar} data-offline={answers.offline ? '1' : '0'}>
            <div className={styles.title}>{load.worksheet.title || '学习单'}</div>
            <div className={styles.progress}>
              <span className={styles.progressTrack}>
                <span
                  className={styles.progressFill}
                  style={{ width: total > 0 ? `${Math.round((submittedCount / total) * 100)}%` : '0%' }}
                />
              </span>
              <span className={styles.progressText}>{submittedCount}/{total}</span>
            </div>
            <div className={styles.saveState}>{saveText}</div>
            {/* 奖励累计的位置（规格 §9.3）。D5 才往里放东西，这里现在是个空盒子。 */}
            <div className={styles.rewardSlot} />
          </div>

          <div className={styles.scroller}>
            <WorksheetQuestionList
              questions={questions}
              drafts={answers.drafts}
              statuses={answers.statuses}
              submitting={answers.submitting}
              interactive
              allowResubmit={load.worksheet.allowResubmit}
              onChange={handleChange}
              onSubmit={handleSubmit}
            />
          </div>
        </>
      ) : (
        <div className={styles.overlay}>
          <div className={styles.card} style={{ '--module-accent': accent } as CSSProperties}>
            <span className={styles.badge}>{label}</span>
            {!worksheetId ? (
              // 高级模式下「本组没配」是**合法状态**，不是「老师忘了」——
              // 说错会把学生引向「等老师加」，而正确的话是「问老师要你们组的那一份」。
              classroom?.mode === 'advanced' ? (
                <>
                  <p className={styles.cardTitle}>本组未配置学习单</p>
                  <p className={styles.cardNote}>你们这一组没有安排学习单，先和小组同伴一起讨论，或者问问老师。</p>
                </>
              ) : (
                <>
                  <p className={styles.cardTitle}>老师还没有布置学习单</p>
                  <p className={styles.cardNote}>等老师把学习单放进来，这里就能直接作答。</p>
                </>
              )
            ) : load.kind === 'error' ? (
              <>
                <p className={styles.cardTitle}>学习单没能打开</p>
                <p className={styles.cardNote}>{load.message}。点一下重试，不用退出重来。</p>
                <button type="button" className={styles.retry} onClick={() => setReloadToken((prev) => prev + 1)}>
                  重试
                </button>
              </>
            ) : (
              <>
                <p className={styles.cardTitle}>正在打开学习单…</p>
                <p className={styles.cardNote}>马上就好。</p>
              </>
            )}
          </div>
        </div>
      )}

      {overlayPortal(toast ? <ClassroomToast toast={toast} setToast={setToast} /> : null)}
    </div>
  );
}
