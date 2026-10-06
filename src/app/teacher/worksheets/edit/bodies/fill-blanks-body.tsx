'use client';

import { useEffect, useRef, useState } from 'react';

import type { WorksheetQuestionNode } from '@/lib/types';
import { readBlankCount } from '@/lib/worksheet-questions';
import { BLANK_MARK_TEXT } from '@/lib/worksheet-prompt-marks';
import { CHOICE_JOINER, allowsAiGrading, blankSlots, fillGradingModesFor, fillGradingTotals, fillSettingsFor, hasExplicitFillGrading, sameChoiceItems, sharedPoolChoices, splitChoiceText, writeFillSettings, type FillAnswerMode, type FillBlankSetting, type FillGradingMode } from '@/lib/worksheet-fill-modes';
import { readPromptRunsFor } from '@/lib/worksheet-presentation';
import {
  readBlankAnswers,
  writeFillAnswers,
} from '../worksheet-editor-core';

/**
 * **单行**的「符号分隔列表」输入 —— 待选词与标准答案**共用这一个**（★ 2026-09-28，教师两轮）。
 *
 * 教师原话：第一轮「这个完全没必要一行一个，太占空间了，用单行即可，词与词之间提示
 * 使用常见的符号分隔即可。」第二轮「这里也改成单行了，而且可以使用哪些符号间隔，
 * 要提示一下，之前改的地方也是一样。」
 *
 * 🔴 **为什么自己存一份正在输入的文本**：每次按键都立刻 `split(text).join(…)` 回填的话，
 *   教师刚打完的那个分隔符会在同一瞬间被吃掉（「阳光、」→ 变回「阳光」）
 *   ⇒ **第二个词根本打不进去**。所以打字时只更新自己那一份。
 *
 * ★ 2026-09-30（教师第三轮）：「几个地方要统一下，用户在输入的时候可以用各种常见的
 *   分隔符号，**你多想几个，都是支持的**，也**不用刻意地转成某一个特别的符号**。」
 *   ⇒ 两件事：
 *   ① **显示分隔符收到一处**（`CHOICE_JOINER`，`@/lib/worksheet-fill-modes`）——
 *      原来四个调用点各传一个（` / ` / `；` / `、` / `、`），而主观题「参考答案」那处
 *      的占位语写的是顿号、值却用斜杠显示，自己跟自己不一致。
 *   ② **`onBlur` 那次「规范化」整个删掉**，回填改判「解析结果是否逐项相等」——
 *      见下面那个 effect。他打逗号就留逗号，打斜杠就留斜杠。
 *
 * ⚠️ **认哪些分隔符由 `split` 给**（`@/lib/worksheet-fill-modes` 的 `splitChoiceText`：
 *   顿号/逗号/分号/斜杠/竖线/间隔号/制表符/换行，**中英文都认**）—— 那里记着
 *   「代价是什么」（本身含标点的答案会被拆开）与教师为什么这么选。
 * ⚠️ 四处共用一个组件是刻意的：同屏几个同类输入框各写一份，改一处只改一处，
 *   而教师看到的是「几个长得不一样的框」。
 */
export function SymbolListInput({ values, split, placeholder, onChange }: {
  values: string[];
  split: (raw: string) => string[];
  placeholder: string;
  onChange: (items: string[]) => void;
}) {
  const canonical = values.join(CHOICE_JOINER);
  const [draft, setDraft] = useState(canonical);
  /**
   * 这一帧手里那一份。
   * ⚠️ 它进不了 effect 的依赖（`draft` 每次按键都变 ⇒ 那个 effect 会被自己触发的
   *    一次渲染再跑一遍）。用 ref 读当下值，与 `prompt-editor` 里 `runsRef` 同一套写法。
   */
  const draftRef = useRef(draft);
  draftRef.current = draft;

  /**
   * 什么时候拿**外面那份值**回填。
   *
   * 🔴 判据是「**手里这份解析出来与外面那份逐项相等，就一个字都不回填**」
   *    （★ 2026-09-30，教师第三轮：「也不用刻意地转成某一个特别的符号」）。
   *    教师打 `阳光,水分` 的那一刻，外面存下的是 `['阳光','水分']`、拼出来是
   *    `阳光、水分` —— **两份说的是同一个列表**，只是写法不同 ⇒ 别动他的稿子。
   *    ⚠️ 少了这条判据（比如只比「拼出来的字符串」），他刚打的逗号会**当场**被换成
   *    顿号；屏幕上看不出是谁改的，像是输入法在捣乱。
   * ⚠️ 真的变了（撤销 / 换题 / 别处改了同一个答案）⇒ 解析结果不同 ⇒ 照旧回填。
   * ⚠️ 依赖里带上 `values` / `split`：它俩每次渲染都是新的 ⇒ 这个 effect 每渲染跑一遍，
   *    但函数体第一句就把绝大多数情况挡回去了（判据只是几个短字符串的比较）。
   */
  useEffect(() => {
    if (sameChoiceItems(split(draftRef.current), values)) return;
    setDraft(values.join(CHOICE_JOINER));
  }, [canonical, values, split]);

  return (
    <input
      className="input"
      value={draft}
      placeholder={placeholder}
      onChange={(event) => {
        const next = event.target.value;
        setDraft(next);
        onChange(split(next));
      }}
    />
  );
}

/**
 * 「每个空的作答方式 + 它的答案」。
 *
 * ★ 2026-09-28（教师反馈）：它管的是**这道题全部的空**（题干里的 + 表格里的），
 * 不再只认题干里那几个。
 *
 * ★ 2026-10-05（教师裁定）：「填空题的答案放到这里」——每个空的**答案**从「标准答案」
 * 那一块搬到了本卡片内，并由题目级「自动评分」总开关统一显示 / 隐藏。
 * 三条连带，都是有意的：
 *   · 空的数量仍然**只有一个来源**：题干 `promptRuns` 里带稳定 blank id 的占位符，
 *     加上表格里标成「填空」的格子。这里不提供「增加/删除答案框」——
 *     题干有两个空、下面却有三个答案框，那种双真源正是原来那个组件的存在理由。
 *   · 关闭总开关只隐藏设置，不删除 `fillBlankSettings` 与答案；重新开启后原值恢复。
 *   · 原来那两句说明（「每个空可以填多个可接受答案…」与「逐空给分」的算术）跟着搬到列表下方。
 */
/**
 * 评分方式的中文名 —— **一份**（那一排按钮与汇总那两句都从这儿取）。
 *
 * ★ 2026-10-05（教师）：「填空题的空的评分方式的三项，其中『自动评分』这个名字不好，
 * 自动评分我一般是指**整体的称呼**，包括根据答案的自动批和 AI 的分析评分。」
 * ⇒ 逐空那一档改叫「**本地评分**」（我提过几个备选，教师选了这个）：它同时点出两件事 ——
 *    **怎么判**（拿学生填的与学生答案逐一比对）、**在哪儿判**（不联网，就在本机）。
 *    与「AI 评分」正好成对。整题那张卡仍叫「自动评分」—— 那才是教师嘴里的**整体称呼**。
 * ⚠️ 数据值仍是 `'auto'`（`FillGradingMode`）—— 改的只是屏幕上那一行字，
 *    动数据值会让库里的 `fillBlankSettings` 全部读不出来。
 */
const FILL_GRADING_LABELS: Record<FillGradingMode, string> = {
  auto: '本地评分',
  ai: 'AI 评分',
  none: '不评分',
};

export function ChoiceBlankSetup({ node, onDataChange, fullPoints = 0, pointsUnit = '分' }: {
  node: WorksheetQuestionNode;
  onDataChange: (patch: Record<string, unknown>) => void;
  /** 「全对」的奖励数量（逐题或继承学习单级）——只用来把「逐空评分」那笔账算给教师看。 */
  fullPoints?: number;
  /** 跟随学习单奖励形式，例如「分」「座奖杯」「颗星星」。 */
  pointsUnit?: string;
}) {
  const runs = readPromptRunsFor(node);
  // ★ 2026-09-28（教师反馈）：清单走 `blankSlots` —— **题干里的空与表格里的空是同一批**。
  // 原来只遍历 `promptRuns` ⇒ 一道表格题在这里显示「题干中还没有填空域」，
  // 而上面明明有一张表标着空（两块互相打脸 —— 教师：「一头雾水，东跳跳西跳跳」）。
  const slots = blankSlots(node, runs);
  // ★ 2026-10-05：答案跟着清单走同一个下标空间 —— `blankSlots` 的顺序与
  // `readBlankCount` 是同一套口径（题干标记前的空 → 表格里的空 → 标记后的空），
  // 所以 `answerSets[index]` 就是这张卡那一个空的答案（原来那个网格也是这么对的）。
  const answerSets = readBlankAnswers(node);
  const answerSlots = readBlankCount(node);
  const settings = fillSettingsFor(node, runs);
  const gradingEnabled = node.autoGrade !== false;
  const poolChoices = sharedPoolChoices(node);
  const updateSettings = (next: typeof settings) => {
    const totals = fillGradingTotals(next);
    onDataChange({
      fillBlankSettings: writeFillSettings(node, runs, next),
      ...(node.type === 'fill-blank' && hasExplicitFillGrading(next) ? {
        aiScoringEnabled: totals.ai > 0,
      } : {}),
    });
  };
  /**
   * 这一空**实际生效**的评分方式。
   *
   * 老题没有 `gradingMode` ⇒ `aiScoringEnabled` 为真时保留旧的 AI 选择，否则回落本地评分。
   * 🔴 回退也必须看**作答方式**：选词那两种方式下 `'ai'` 根本不合法
   *    （`fillGradingModesFor` 只给 `auto` / `none`）—— 否则界面会渲染成「一个都没选中」，
   *    而那个组合服务端**存不下**（会回一句「只有手工填写时才能使用 AI 评分」）。
   */
  const gradingModeOf = (setting: FillBlankSetting): FillGradingMode => setting.gradingMode ?? (
    allowsAiGrading(setting.mode) && node.data.aiScoringEnabled === true
      ? 'ai' : 'auto'
  );
  /**
   * 逐空那一份设置是不是**本题真正的判分口径**（与题目卡的 `explicitFillScoring` 同源）。
   * ⚠️ 只有它为真时，下面那些「分值」才是判分读的东西。
   */
  const explicitGrading = hasExplicitFillGrading(settings);
  /**
   * 还没有逐空设置时，那一格「分值」**缺省是几** —— 必须等于**判分真正会用的那个数**。
   *
   * ★ 2026-10-05（教师裁定）：「总开关只需要负责是否自动评分（含 AI 评分），打开后逐空
   *   设置、逐空给分，**已经不涉及按整题给的问题**。」⇒ 逐空那一份是**唯一**的分值来源，
   *   它的缺省值就是**题目级分值**（逐题 `points.full`，没设就用学习单级那个）。
   *
   * 🔴 这一条同时修掉两处「屏幕上的数不是发出去的那个数」：
   *   · 旧口径「按空给分」下服务端算的是 `命中空数 × 题目级满分`
   *     （`worksheet-questions.ts` 的 `grade()`）⇒ 每一空的生效值正是题目级分值，
   *     而这一格原来**写死显示 1**（题级 3 分时屏幕写 1、实际发 3）；
   *   · 接管逐空那一步原来也按 1 写回 ⇒ 教师点一下「本地评分」，一道「每空 3 座奖杯」
   *     的题就静默变成每空 1 座。
   * ⚠️ 这正是 `worksheet-points-migration.ts` 那条纪律：**写进去的是它当时实际用的那个数，
   *    不是默认值** —— 猜一个 1 就是静默改分。
   */
  const inheritScore = fullPoints > 0 ? fullPoints : 1;
  /**
   * 这一格「分值」**会不会被谁读** —— 不被读的就不画（死控件会在屏幕上静静说谎）。
   *
   * 🔴 判分只有**填空题**走逐空那一支：`worksheet-questions.ts` 的 `grade()` 里写死了
   *    `node.type === 'fill-blank'`，AI 评分（`analysis-scoring.ts`）同样只认填空题
   *    ⇒ **选择填空**空卡片上那一格填进去没有任何人读，判分仍按题目级「得分方式 + 分值」。
   * ⚠️ 旧口径的「整题给分」里也没有逐空分值这回事（所有空都答对才发一份），照样不画 ——
   *    那一型由下面那句「旧口径」说明 + 一个转换按钮交代（**不猜**：不替教师把整题那一份
   *    分偷偷摊到每个空上，那是静默改分）。
   */
  const perBlankScoreShown = node.type === 'fill-blank'
    && (explicitGrading || node.data.fillScoring === 'per-blank');
  const explicitSettings = () => settings.map(setting => ({
    ...setting,
    gradingMode: gradingModeOf(setting),
    // ⚠️ 缺省跟着上面那个 `inheritScore`：**接管逐空评分这一步不许把分值静默改成 1**
    //    （一道「每空 3 座奖杯」的题，教师点一下「本地评分」就变成每空 1 座）。
    maxScore: setting.maxScore ?? inheritScore,
  }));
  const setMode = (index: number, mode: FillAnswerMode) => {
    const next = settings.map((setting, settingIndex) => settingIndex === index
      ? { ...setting, mode, ...(mode !== 'text' && setting.gradingMode === 'ai' ? { gradingMode: 'auto' as const } : {}) }
      : setting);
    updateSettings(next);
  };
  const setGradingMode = (index: number, gradingMode: FillGradingMode) => {
    // ⚠️ 不再在这里补 `maxScore ?? 1`：`explicitSettings()` 已经把缺省值补成
    //    `inheritScore`，两处各写一个缺省就是两处会漂移的地方。
    const next = explicitSettings().map((setting, settingIndex) => settingIndex === index
      ? { ...setting, gradingMode, ...(gradingMode === 'ai' ? { mode: 'text' as const } : {}) }
      : setting);
    updateSettings(next);
  };
  const setMaxScore = (index: number, raw: string) => {
    const maxScore = Number(raw);
    if (!Number.isInteger(maxScore) || maxScore < 1 || maxScore > 99) return;
    updateSettings(explicitSettings().map((setting, settingIndex) => settingIndex === index ? {
      ...setting,
      maxScore,
    } : setting));
  };
  // ★ 2026-09-28：直接收词表 —— 原来收一个字符串再 `splitChoiceLines` 解析一遍，
  // 而单行输入那一侧已经解析过了（多一次往返就多一处会分叉的地方）。
  const setInlineChoices = (index: number, words: string[]) => {
    const next = settings.map((setting, settingIndex) => settingIndex === index
      ? { ...setting, choices: words }
      : setting);
    updateSettings(next);
  };

  return (
    <div className="worksheet-editor-choice-blank-setup">
      {slots.length === 0 ? (
        <div className="worksheet-editor-blank-empty">
          <strong>还没有填空的位置</strong>
          <span>把光标放到题干的目标位置再点“{BLANK_MARK_TEXT}”；或者在上面加一张表格、把某几格标成「填空」。</span>
        </div>
      ) : (
        <div className="worksheet-editor-fill-mode-list">
          {slots.map((slot, index) => (
            // key 用空的身份（不是下标）：题干里插一个空时，后面那些卡不会整排重挂载
            <section className="worksheet-editor-fill-mode-card" key={slot.id}>
              <div className="worksheet-editor-fill-mode-head">
                {/* ★ 位置**说实话**：题干里的空说「第 2 空」，表格里的空说「第 2 行第 2 格」 */}
                <strong>{slot.label}</strong>
                {slot.kind === 'table' && (
                  // 位置之外再说一句「它在表格里」：清单里两种空混着排，光看标签要能一眼分清
                  <span className="worksheet-editor-blank-hint">在表格里</span>
                )}
                {/* ★ 2026-09-28（教师）：「这里也应该可以设置三种方式，跟普通填空域一样：
                    手工填、右侧选、下方选。」⇒ 表格里的空**与题干里的空同一套单选**
                    （上一版只报位置、不摆单选，那是 v1 的临时限制，教师否了）。 */}
                <div className="worksheet-editor-mode-tabs" role="radiogroup" aria-label={`${slot.label}的作答方式`}>
                  {([
                    ['text', '手工填写'],
                    ['inline', '右侧选词'],
                    ['pool', '下方选词'],
                  ] as const).map(([mode, label]) => (
                    <label className={settings[index].mode === mode ? 'is-selected' : ''} key={mode}>
                      <input type="radio" name={`fill-mode-${node.id}-${index}`} checked={settings[index].mode === mode} onChange={() => setMode(index, mode)} />
                      <span>{label}</span>
                    </label>
                  ))}
                </div>
              </div>
              {settings[index].mode === 'inline' && (
                <label className="worksheet-editor-field worksheet-editor-inline-word-field">
                  <span>这一空的待选词</span>
                  <SymbolListInput
                    values={settings[index].choices}
                    split={splitChoiceText}
                    placeholder="例如：唐、宋、元"
                    onChange={words => setInlineChoices(index, words)}
                  />
                </label>
              )}
              {node.type === 'fill-blank' && gradingEnabled && (
                <div className="worksheet-editor-fill-grading-row">
                  <span>评分方式</span>
                  {/*
                    ★ 2026-10-05（教师）：评分方式仍使用胶囊，但必须与上方作答方式区分。
                    ⇒ 上方是「共用浅灰底槽 + 白色选中块」的分段控件；这里是彼此分开的
                      「细描边胶囊」，选中时只铺浅蓝底、加深边框，不再使用下划线页签。
                  */}
                  <div className="worksheet-editor-mode-tabs is-scoring-pills" role="radiogroup" aria-label={`${slot.label}的评分方式`}>
                    {/*
                      ★ 2026-10-05（教师）：「手工填写含三项评分方式，……右侧或下方选词则只有
                      自动评分或不评分。」⇒ 这一排由 `fillGradingModesFor(本空的作答方式)` 给，
                      与那条会**拒绝保存**的服务端校验同源（见 `worksheet-fill-modes.ts` 的注释）。
                    */}
                    {fillGradingModesFor(settings[index].mode).map((mode) => {
                      const selected = gradingModeOf(settings[index]) === mode;
                      return (
                        <label className={selected ? 'is-selected' : ''} key={mode}>
                          <input type="radio" name={`fill-grading-${node.id}-${index}`} checked={selected} onChange={() => setGradingMode(index, mode)} />
                          <span>{FILL_GRADING_LABELS[mode]}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}
              {/* 答案/评分标准独占第三行；本空的分值紧跟在这一行末尾，评分方式行只负责选方式。 */}
              {gradingEnabled && <div
                className="worksheet-editor-fill-answer-field"
                // ★ 2026-10-06：非 AI 那一档原来还挂着「每个空可以填多个可接受答案；
                // 学生答出其中一个就算对」—— 与下面那句 `.worksheet-editor-compact-note`
                // 逐字重复 ⇒ 这里只留 AI 那一档的说明（那句别处没有）。
                title={gradingModeOf(settings[index]) === 'ai'
                  ? `${slot.label}：这一空交给 AI 评分，这里写的是它评分（以及「发给 AI 分析」）依据的标准。`
                  : undefined}
              >
                <span>{gradingModeOf(settings[index]) === 'ai' ? '评分标准' : '答案'}</span>
                <div className="worksheet-editor-fill-answer-editor">
                  <SymbolListInput
                    values={answerSets[index] ?? []}
                    split={splitChoiceText}
                    placeholder={gradingModeOf(settings[index]) === 'ai' ? '这一空的评分标准' : '本空的答案'}
                    onChange={items => onDataChange({
                      blanks: undefined,
                      answers: Array.from(
                        { length: answerSlots },
                        (_, answerIndex) => answerIndex === index
                          ? writeFillAnswers(items.join('\n'))
                          : (answerSets[answerIndex] ?? []),
                      ),
                    })}
                  />
                </div>
                {perBlankScoreShown && gradingModeOf(settings[index]) !== 'none' && (
                  <label className="worksheet-editor-fill-score-input worksheet-editor-fill-answer-score">
                    <span>{pointsUnit === '分' ? '分值' : '奖励数量'}</span>
                    {/*
                      ★ 2026-10-05：「留空 = 跟随」那一套（与 `PointsRow` 同一条）：没设过逐空
                      分值时框里是**空的**、灰字写着**生效的那个数**。原来这里是
                      `value={… ?? 1}` —— 题级 3 分时屏幕写 1、服务端发 3，两处不是同一个数。
                      ⚠️ 打字即接管（`setMaxScore` 会把每个空写成显式值），所以「空」不是空洞。
                    */}
                    <input
                      type="number"
                      min={1}
                      max={99}
                      value={settings[index].maxScore ?? ''}
                      placeholder={String(inheritScore)}
                      onChange={event => setMaxScore(index, event.target.value)}
                    />
                    <b>{pointsUnit}</b>
                  </label>
                )}
              </div>}
            </section>
          ))}
          {gradingEnabled && (<>
            {node.type === 'fill-blank' && explicitGrading && (() => {
              const totals = fillGradingTotals(settings);
              // ★ 2026-10-06：「本题合计 N 分」与题目卡右上角那个「本题满分 N 分」
              // 徽章复述的是同一个总数（同一张卡里说两遍）⇒ 这里只说徽章给不出的那一半
              // （本地评分与 AI 评分各占多少），总数由徽章说。
              return <p className="worksheet-editor-fill-score-summary">本题：本地评分 {totals.auto} {pointsUnit}，AI 评分 {totals.ai} {pointsUnit}。</p>;
            })()}
            <p className="worksheet-editor-compact-note">
              每个空可以填多个可接受答案；学生答出其中一个就算对。
            </p>
            {/* ⚠️ 只在**旧口径**下说这句（`!explicitGrading`）：接管逐空之后每个空的分值
                可能各不相同，而这句话还按题目级分值报「每个空 X × N 空 ⇒ 全对最多 Y」——
                它会与上面那句逐空构成说明、以及题目卡上那个「本题满分」徽章给出不同的数。
                逐空的账由上面那一行 + 徽章说。
                🔴 它说的数**与判分逐字一致**：服务端旧口径这一支就是
                `命中空数 × 题目级满分`（`grade()`），所以它不是复述、是同一个事实。 */}
            {!explicitGrading && node.data.fillScoring === 'per-blank' && fullPoints > 0 && (
              <p className="worksheet-editor-compact-note">
                逐空给分：每个空 {fullPoints} {pointsUnit} × {slots.length} 空 ⇒ 全对最多 <strong>{fullPoints * slots.length}</strong> {pointsUnit}。
              </p>
            )}
            {/*
              ★ 2026-10-05：旧口径「整题给分」那一档 —— **不给控件，只给一句实话 + 一次转换**。

              「得分方式（按空给分 / 整题给分）」那两个选项已随教师裁定删除（总开关只负责
              是否评分，分值是逐空的事）。但库里还躺着 `fillScoring: 'whole'` 的老题：
              它们**仍然按「全对才给一份分」在给学生发分**，而逐空那一格对它们没有意义。
              三种做法里选了最不伤人的一种：
                · 照旧判分（不动学生已有的分）——**不猜**：把题级那一份摊到每个空上是猜，
                  摊成几份就凭空改了整题的分（`worksheet-points-migration.ts` 纪律 1）；
                · 在屏幕上照实说明它是旧口径 + 一个明确的转换按钮（教师按一下才动）；
                · 一旦转换，它就与其它填空题一模一样（逐空设置 + 逐空给分）。
              ⚠️ 转换写的是 `inheritScore`（题目级分值）——**它当时实际用的那个数**，
                 不是默认 1；写多少由上面那句话先告诉教师。

              🔴 判据里的 `node.type === 'fill-blank'` 不能少：这一段与「得分方式」那两个
                 控件是**两型的两种情形** —— 选择填空的「整题给分」是它**今天合法的**口径
                 （那个开关就在下面那张卡里），对它说「这是旧口径，改成逐空吧」是错的。
            */}
            {node.type === 'fill-blank' && !explicitGrading && node.data.fillScoring !== 'per-blank' && (
              <p className="worksheet-editor-compact-note worksheet-editor-fill-legacy-note">
                <span>
                  这道题还是旧口径「整题给分」：所有空都答对才得 {inheritScore} {pointsUnit}。
                  改成逐空给分后，每个空先按 {inheritScore} {pointsUnit} 填好，可以再逐个调整。
                </span>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => updateSettings(explicitSettings())}
                >
                  改成逐空给分
                </button>
              </p>
            )}
          </>)}
        </div>
      )}

      {/* ★ 2026-10-05（教师，截图标注）：「"下方共用词池" 改为 "共用选词"，并移到右侧，
          左右分栏显示。」
          ⇒ ① 标题改名（就这一处；保存校验那句报错在 `worksheet-questions.ts` 跟着改了，
             那句是同一件事的另一份拷贝）。
             ② 挪到右列**只靠 CSS**（外层那个 grid 现在两列）——这两块在 DOM 里本来就是
             兄弟，列表在前、词池在后，JSX 一行没动。
          ⚠️ 改的只是**编辑页的控制面板**：三个单选里那个「下方选词」**没动** ——
             它说的是学生从哪儿取词，而学生端那个词库仍然印在题干下方
             （`classroom/.../choice-blank-answer.tsx` 的 `choicePoolArea` 排在题干之后，
              提示语原话就是「待选词会显示在题干下方」）。位置对得上就不该改那句。 */}
      {settings.some(setting => setting.mode === 'pool') && (
        <label className="worksheet-editor-field worksheet-editor-choice-words">
          <span>共用选词</span>
          <SymbolListInput
            values={poolChoices}
            split={splitChoiceText}
            placeholder="例如：阳光、水分、空气"
            onChange={words => onDataChange({ fillChoicePool: words })}
          />
        </label>
      )}
    </div>
  );
}
