'use client';

import { useEffect, useRef, useState, type ClipboardEvent as ReactClipboardEvent } from 'react';

import type { WorksheetQuestionNode } from '@/lib/types';
import { readBlankCount } from '@/lib/worksheet-questions';
import { BLANK_MARK_TEXT } from '@/lib/worksheet-prompt-marks';
// ★ 2026-10-06：粘贴去格式那一个纯函数（唯一一份，题目卡里「评分标准」那个 textarea 用的也是它）。
import { normalizePastedText } from '@/lib/worksheet-text-normalize';
import { CHOICE_JOINER, FILL_GRADING_MODE, blankSlots, fillSettingsFor, hasExplicitFillGrading, isLegacyFillGrading, sameChoiceItems, sharedPoolChoices, splitChoiceText, writeFillSettings, type FillAnswerMode, type FillBlankSetting } from '@/lib/worksheet-fill-modes';
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

  /**
   * ★ 2026-10-06（教师）：「这里复制进来的文本，格式要去掉」——**粘贴去格式**。
   *
   * 🔴 从 Word / PDF / 网页复制中文带进来的**不是内容，是排版**：每行缩进、全角空格、
   *    标点**前面**多一个空格（「（1 分） ；」）—— 肉眼以为是内容，其实全是噪音。
   *    ⇒ 与题目卡里「评分标准」那个 textarea 的 `onPaste` **同一种接法**：接管粘贴
   *      （`preventDefault` + 直接写入归一化后的文本，避免「先脏后清」闪一下）。
   *
   * ⚠️ ★ 2026-10-06（**只接 `onPaste`，不接 `onBlur`**）：本文件有一条**既有判据**不许出现
   *    `onBlur`（`fill-blanks-body.test.ts` 第一条 —— 教师 2026-09-30 明确要求
   *    「不用刻意地转成某一个特别的符号」：那次失焦时的重排会把教师刚打的「阳光,水分」
   *    当场改成「阳光、水分」）。而对这个**列表**输入，失焦再收一次本来就**没有第二份东西可收**：
   *    `data` 里存的从来就是 `split` 解析好的词表 —— 排版（空格 / 缩进）压根没进过数据，
   *    真正需要接管的是**粘贴那一瞬间**（老师的原文第一次出现的地方）。
   *    ⚠️ 于是「参考答案 / 参考要点」那一处（同一个组件）也**只有 `onPaste`**：
   *       它要的第二次收口在这个组件里做不到，而在外面挂一个 `onBlur` 既不改变屏幕上的字
   *       （回填判据是 `sameChoiceItems`，词表没变就不回填），又会白白多写一次同值。
   *
   * ⚠️ 这个组件是**参考答案 / 参考要点（主观题）、每一空的答案与评分标准、待选词、共用选词**
   *    共用的那一个单行列表输入 ⇒ 接线接在这里，几处一起拿到同一个行为（各接一份必然漂移）。
   * ⚠️ **制表符 / 换行先换成显示分隔符**（`CHOICE_JOINER`，见下面 `cleanedText`）：`<input>`
   *    显示不了换行，而制表符 / 换行本来就是 `split` 认的分隔符 ⇒ 换成顿号后**解析出来的词
   *    一个都没变**，屏幕上却真的看得见词与词的分界（不换的话浏览器会把两行拼成「阳光水分」，
   *    而 `normalizePastedText` 会把制表符变成**空格** —— 空格不是分隔符，一列词会粘成一个词）。
   * ⚠️ **`onChange`（打字那条路）一个字都没动** —— 教师打 `阳光,水分` 时那个逗号仍然原样留着
   *    （见上面那个 effect 的说明）。
   */
  const cleanedText = (raw: string) => normalizePastedText(
    // 🔴 **先把制表符 / 换行换成显示分隔符，再去格式**。
    //    理由：`normalizePastedText` 会把制表符换成普通空格，而**空格不是分隔符**
    //    （`CHOICE_SPLIT` 只认 `CHOICE_SEPARATORS` + `\t\r\n`）⇒ 从 Excel / 表格里粘进来
    //    的一列词会被粘成**一个词**（静默丢条目，屏幕上只是少了几项）。
    //    换成顿号之后，解析出来的词与粘之前**逐项相同**，而屏幕上也真的看得见分界。
    raw.replace(/[\t\r\n]+/g, CHOICE_JOINER),
  );

  const pasteCleanedText = (event: ReactClipboardEvent<HTMLInputElement>) => {
    const raw = event.clipboardData.getData('text/plain');
    if (!raw) return;
    event.preventDefault();
    const element = event.currentTarget;
    const start = element.selectionStart ?? element.value.length;
    const end = element.selectionEnd ?? element.value.length;
    const next = `${element.value.slice(0, start)}${cleanedText(raw)}${element.value.slice(end)}`;
    setDraft(next);
    onChange(split(next));
  };

  return (
    <input
      className="input"
      value={draft}
      placeholder={placeholder}
      onPaste={pasteCleanedText}
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
    // ★ 2026-10-09：**不再碰 `aiScoringEnabled`** —— 填空题不涉及 AI 评分（教师裁定），
    //   原先这里按「有没有 AI 空」写那个开关，而它今天恒为 false。老题库里那个键原样留着
    //   （`aiScoredFor` 会按题型把它挡掉，看板不会再挂「AI 评分」）。
    onDataChange({
      fillBlankSettings: writeFillSettings(node, runs, next),
    });
  };
  /**
   * 这一空是不是**历史**的评分方式（`'ai'` / `'none'`）。
   *
   * ★ 2026-10-09（教师裁定）：这两档已经从界面上删掉了，而库里写着它们的空**不再计分** ——
   *   所以它们必须在屏幕上**看得出来**（下面那句提示），否则教师只会看到「这一空填了也白填」。
   * ⚠️ `undefined`（老题压根没有逐空设置）**不走这里**：那是题目级规则，不是历史值
   *   （`isLegacyFillGrading` 的注释）。
   */
  const legacyGradingOf = (setting: FillBlankSetting): boolean => isLegacyFillGrading(setting.gradingMode);
  /** 这道题里**还有几个空不算分**（老数据）。> 0 时卡片底部那句提示才出现。 */
  const legacyBlankCount = settings.filter(legacyGradingOf).length;
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
    // 🔴 历史值**原样保留**（不许顺手把它们翻成 'auto'）：翻掉之后那些空会立刻要求答案键
    //    （服务端校验会拒绝保存），于是「教师改一下别的空 ⇒ 存不下」——
    //    那是**硬拦**，而教师的裁定要的是「提示教师改」。改哪一空由教师自己决定。
    gradingMode: setting.gradingMode ?? FILL_GRADING_MODE,
    // ⚠️ 缺省跟着上面那个 `inheritScore`：**接管逐空评分这一步不许把分值静默改成 1**
    //    （一道「每空 3 座奖杯」的题，教师点一下「本地评分」就变成每空 1 座）。
    maxScore: setting.maxScore ?? inheritScore,
  }));
  const setMode = (index: number, mode: FillAnswerMode) => {
    // ★ 2026-10-09：原先这里还带一手「选词那两种方式 ⇒ 顺手把这一空的 AI 评分关掉」，
    //    它服务的是那条**会拒绝保存**的服务端校验（「只有手工填写时才能使用 AI 评分」）。
    //    两档一起删之后没有这个组合了，历史值也原样留着 —— 那一条接线整个删掉。
    updateSettings(settings.map((setting, settingIndex) => (
      settingIndex === index ? { ...setting, mode } : setting
    )));
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
              {/* ★ 2026-10-09（教师裁定）：**「评分方式」那一排整个删了** —— 填空题只剩
                  「每空有答案键、都算分」一条路（想让学生自由写就用问答题）。
                  只剩一档的选择器不是简化，是装饰：它会让人以为还有别的档。
                  ⚠️ 老库里写着 `'ai'` / `'none'` 的空下面那句提示会点出来（见 `legacyGradingOf`）。 */}
              {/* 答案独占第三行；本空的分值紧跟在这一行末尾。 */}
              {gradingEnabled && <div className="worksheet-editor-fill-answer-field">
                <span>答案</span>
                <div className="worksheet-editor-fill-answer-editor">
                  <SymbolListInput
                    values={answerSets[index] ?? []}
                    split={splitChoiceText}
                    placeholder="本空的答案"
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
                {perBlankScoreShown && (
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
                {legacyGradingOf(settings[index]) && (
                  <p className="worksheet-editor-legacy-grading-note">
                    {slot.label}用的是旧版的「AI 评分 / 不评分」，<strong>现在不计分</strong>；
                    给它填上答案之后，它就按答案计分。
                  </p>
                )}
              </div>}
            </section>
          ))}
          {gradingEnabled && (<>
            {node.type === 'fill-blank' && explicitGrading && legacyBlankCount > 0 && (
              // ★ 2026-10-09（教师裁定）：AI / 不算分两档删掉之后，逐空账只剩**一笔**
              //（本地评分），所以上面那行「本地 X 分 + AI Y 分」的合计删了 —— 总数由题目卡
              //右上角那个「本题满分」徽章说。这里只留一件徽章说不出的事：
              //**还有几个空压根不算分**（老数据），以及教师该怎么办。
              <p className="worksheet-editor-legacy-grading-note">
                有 {legacyBlankCount} 个空还是旧版的「AI 评分 / 不评分」，它们<strong>不计分</strong>、
                也算不进「本题满分」—— 请给这些空填上答案（想让学生自由写，请改用<strong>问答题</strong>）。
              </p>
            )}
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
