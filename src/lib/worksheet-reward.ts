/**
 * 学习单的**奖励形式**（规格 §9）—— 常量 + 纯函数，不碰 React / DOM / 网络。
 *
 * ── 这一层是硬边界（规格 §9.1）────────────────────────────────────────────
 *
 * ```
 * 数据层     gradeState: correct | partial | incorrect | null   ← 判分结论（三态）
 *            score:      number  | null                          ← 得分（绝对值）
 *            isCorrect:  boolean | null   ← M3 及更早的旧字段：语义已收窄为「全对」，
 *                                           只增不改（协议字段），**未回填的旧行仍靠它兜底**
 *               │
 * 呈现层        ├─ 十一种卡通收藏图标 ×N
 *               └─ 分数 +N
 * ```
 *
 * ⊘ 2026-09-24（M4a）更正：这张图原先的数据层只有一行
 * `isCorrect: true | false ← 永远只有这一种，永远落库的只有它`。两句都不再成立：
 * 三态与得分（B1）之后库里还有 `gradeState` / `score`，而**显示层读的正是它们**
 *（`rewardAmount` 的入参是得分，不是那个布尔）。`isCorrect` 仍在、仍不许改名，
 * 但它的角色从「唯一真相源」变成了「旧行的兜底」（见 `scoreFromWire` 与 `rowVerdict`）。
 *
 * 🔴 **绝不把星星 / 花朵 / 分数存进数据库。** 一旦落库，教师端「哪道题错得多」、导出、
 * P4 的分析型智能体都要面对一个「⭐ 是什么数」的问题。
 * ⊘ 2026-09-24（M4a）更正：这句原先接着写「所以本文件里的每一个数都是**算出来的**，
 * `WorksheetAnswer` 上没有任何一列与之对应」—— 这句在 M4a 之后**不再成立**：
 * `WorksheetAnswer.score` 就是画出来的那个数（绝对值模型，`rewardAmount` 直接返回它）。
 * 变的不是这条规矩，而是「哪个数是算出来的」：**落库的 `score` 是教师逐题填的分值**，
 * 「画几个奖励图标」仍是本文件算出来的（`0` 与 `null` 两种不画）。
 * ⇒ 库里存的是**得分**，不存**呈现**。
 *
 * ── 单独成文件、单独可跑 ───────────────────────────────────────────────────
 *
 * 与 `worksheet-questions.ts` 同一个理由：取值的规则**错了不报错** —— 个数算错只会让
 * 学生少拿一朵花、多拿一颗星，界面上一切正常。所以它必须能被 `node --test` 直接断言：
 *
 * ```bash
 * node --test src/lib/worksheet-reward.test.ts
 * ```
 *
 * ⚠️ 因此本文件**不得出现 `@/…` 的运行时 import、不得引 React / DOM**（Node 解析不了
 * 联名路径）。它是零依赖的，这条约束今天自然成立，改动时请保持。
 */

/**
 * 奖励形式：十一种收藏型图标 + 分数。
 *
 * ⚠️ 取值与服务端 `routes/worksheets.ts` 的 `REWARD_STYLES` 是**同一套字面量**，
 * 而服务端复制了一份自己的（它读不到 `src/`）。与题型注册表（`QUESTION_TYPE_OPTIONS`
 * 对 `QUESTION_TYPES`）同一个由来：**两处必须一起改**，改一处会让「学生端认不出
 * 服务端存的样式」——而那种失效是静默的（落到默认档，画出来的是另一种奖励）。
 */
export type RewardStyle =
  | 'classnode'
  | 'star'
  | 'flower'
  | 'trophy'
  | 'bear'
  | 'rocket'
  | 'gem'
  | 'crown'
  | 'lightning'
  | 'bulb'
  | 'key'
  | 'points';

export interface RewardStyleOption {
  value: RewardStyle;
  /** 教师端奖励选项上的名称。 */
  label: string;
  /** 文本回退符号；界面中的收藏型奖励实际使用 `RewardIcon` 卡通图标。 */
  symbol: string | null;
  /** 步长的量词（星星/花朵/奖杯/小熊分别用颗/朵/座/只，分数用分）。 */
  unit: string;
  /** 教师端那行小字：说清学生**看到**什么。 */
  hint: string;
}

/** 教师端从左到右的显示顺序，分数保留在最后。 */
export const REWARD_STYLE_OPTIONS: readonly RewardStyleOption[] = [
  {
    value: 'classnode',
    label: '支点博士',
    symbol: '博',
    unit: '枚',
    hint: '每答对一题获得几枚支点博士徽章，答错不给。',
  },
  {
    value: 'star',
    label: '璀璨星星',
    symbol: '★',
    unit: '颗',
    hint: '每答对一题给几颗星，答错不给。',
  },
  {
    value: 'flower',
    label: '缤纷花朵',
    symbol: '✿',
    unit: '朵',
    hint: '每答对一题给几朵花，答错不给。',
  },
  {
    value: 'trophy',
    label: '荣耀奖杯',
    symbol: '奖',
    unit: '座',
    hint: '每答对一题赢得几座小奖杯，答错不给。',
  },
  {
    value: 'bear',
    label: '欢乐小熊',
    symbol: '熊',
    unit: '只',
    hint: '每答对一题收集几只小熊徽章，答错不给。',
  },
  {
    value: 'rocket',
    label: '探索火箭',
    symbol: '箭',
    unit: '枚',
    hint: '每答对一题获得几枚探索火箭，答错不给。',
  },
  {
    value: 'gem',
    label: '智慧宝石',
    symbol: '晶',
    unit: '颗',
    hint: '每答对一题收集几颗智慧宝石，答错不给。',
  },
  {
    value: 'crown',
    label: '闪耀皇冠',
    symbol: '冠',
    unit: '顶',
    hint: '每答对一题获得几顶闪耀皇冠，答错不给。',
  },
  {
    value: 'lightning',
    label: '能量闪电',
    symbol: '电',
    unit: '道',
    hint: '每答对一题积攒几道能量闪电，答错不给。',
  },
  {
    value: 'bulb',
    label: '灵感灯泡',
    symbol: '灯',
    unit: '盏',
    hint: '每答对一题点亮几盏灵感灯泡，答错不给。',
  },
  {
    value: 'key',
    label: '成长钥匙',
    symbol: '钥',
    unit: '把',
    hint: '每答对一题获得几把成长钥匙，答错不给。',
  },
  {
    value: 'points',
    label: '分数 ＋',
    symbol: '+',
    unit: '分',
    hint: '每答对一题加几分，答错不加。',
  },
];

/**
 * 默认档。
 *
 * ⚠️ 这是**这次改动定的**（规格 §9 与计划都没写默认值）：§9.2 的那张图里 `●` 打在
 * 「星星 ⭐」上、步长框里写的是 `1`，§8.2 的学生端版式图顶栏画的也是 `⭐×3` ——
 * 三处画的是同一个默认。改它等于改所有**已经存在**的学习单在学生眼前的样子。
 */
/**
 * 逐题分值后面那串字（**量词 + 图标**）—— 跟着学习单的奖励档走。
 *
 * ★ 2026-09-26（教师）：「这里要根据学习单的设置来调整，比如几朵花，几颗五角星，
 * **不能一直使用「分」**。」
 *
 * 🔴 与 `REWARD_STYLE_OPTIONS[].unit` **不是同一个东西**，别合并：
 *   · `unit` 是**步长**（学习单设置里「每答对一题得几 X」）的短量词；
 *   · 这个是**逐题分值**旁的完整名称，例如「颗星星」、「只小熊」。
 *
 * ⚠️ 「星星」取「颗」而不是「个」：教师原话是「几颗五角星」。
 * ⚠️ 名字里的 `Label` 是刻意的：它**不只是量词**，有符号的那两档还带着 ⭐ / 🌸
 *（教师 2026-09-26：「后面要加 🌸 或 ⭐ 图标」）。
 */
export function pointsUnitLabel(style: RewardStyle): string {
  // ★ 2026-09-26（教师）：「后面要加 🌸 或 ⭐ 图标」—— 于是教师填分值时看到的
  // 就是学生将会看到的那一个（星星 / 花朵 / 只是一个分数）。
  //
  // 🔴 **按档位分支，不要按「有没有 `symbol`」判**：分数档（`points`）的 `symbol` 是
  // `'+'`，但它是**前缀**（学生端画的是 `+3`，见 `rewardMark`），不是跟在数字后面的量词。
  // 拿它去拼量词会得到「分 +」—— 2026-09-26 我第一版就是这么写的，用例当场抓住。
  if (style === 'classnode') return '枚博士徽章';
  if (style === 'star') return '颗星星';
  if (style === 'flower') return '朵花';
  if (style === 'trophy') return '座奖杯';
  if (style === 'bear') return '只小熊';
  if (style === 'rocket') return '枚火箭';
  if (style === 'gem') return '颗宝石';
  if (style === 'crown') return '顶皇冠';
  if (style === 'lightning') return '道闪电';
  if (style === 'bulb') return '盏灯泡';
  if (style === 'key') return '把钥匙';
  return '分';
}

export const DEFAULT_REWARD_STYLE: RewardStyle = 'star';
export const DEFAULT_REWARD_STEP = 1;
/** 全对档步长的可选项（规格 §9.2 定死 1 / 2 / 3 / 5）。 */
export const REWARD_STEPS: readonly number[] = [1, 2, 3, 5];

/**
 * ★ M4a：**部分给分档**步长的默认值与取值域。
 *
 * 🔴 `HALF_STEPS` **比 `REWARD_STEPS` 多一个 `0`** —— 这不是笔误，两者**本来就不同**：
 * `rewardStep` 是「答对一题得几个」，`0` 在那里无意义（答对却得 0 个）；而部分给分档的 `0`
 * 是**一个合法的选择** = 这单不给部分分（规格 §12 裁定 3 定的默认值就是它）。
 *
 * ⚠️ **别复用 `normalizeRewardStep` 来归一化部分给分档**（这是 2026-09-24 实测定下的一条）：
 * `REWARD_STEPS.includes(0)` 为假 ⇒ `normalizeRewardStep(0)` 回落到 `DEFAULT_REWARD_STEP = 1`
 * ⇒ 教师配的「部分给分 0」在学生端变成「部分给分 1」，既与裁定 3 的「与第一批行为逐字相同」打架，
 * 也与服务端下发的 0 打架。另一个修法（给 `normalizeRewardStep` 加个 `fallback` 参数）
 * 也不行：那样 `0` 之所以合法**只是因为它恰好等于 fallback**
 * （`normalizeRewardStep(4, 0)` 也回 0），一个合法值与一个越界值产生**同一个观测**，
 * 读者没法从代码看出「0 算不算数」。
 *
 * ⚠️ 这三个字面量在**服务端**（`server/src/routes/worksheets.ts` 的 `HALF_STEPS` 与
 * `DEFAULT_SETTINGS.halfStep`）各有一份：服务端读不到 `src/`。**两处必须一起改**，
 * 改一处不会报错，只会让教师配的档与学生看到的档不是同一个。
 */
export const DEFAULT_HALF_STEP = 0;
export const HALF_STEPS: readonly number[] = [0, 1, 2, 3, 5];

/**
 * 一份学习单上的奖励配置：**哪一档**（十一种收藏图标 + 分数）。
 *
 * ── ★ M4a：这里曾经还有 `step` / `halfStep` 两个数，**已删** ────────────────
 *
 * 那两个数是 0/1 时代「得分 → 奖励」的**乘法模型**的输入
 *（`答对 ⇒ step`、`部分给分 ⇒ halfStep ?? floor(step × score)`）。M4a 把奖励层改成
 * **绝对值模型**（`rewardAmount` 直接返回 `score`，规格 §12「得分与奖励不再是两件事，
 * 而是同一个数的两种画法」）之后，本文件与它的两个消费方（`reward-badge.tsx` /
 * `worksheet-panel.tsx`）**一个字节都不再读它们**。
 *
 * 🔴 **证据是类型级的，不是 grep 级的**（2026-09-24 更正，替换掉原先那句「grep 零命中」）：
 * `RewardScale` 上**已经没有这两个字段**，所以任何一处 `scale.step` / `scale.halfStep`
 * 都**编译不过** —— 「没有活的读者」这句话的全部证据就是 `tsc --noEmit` 为 0。
 * ⊘ 原先这里逐字写着 `grep -rn "scale\.step\|scale\.halfStep" src server/src` **零命中**，
 * 那是**假的**，而且假在一个很容易复发的点上（本项目已经栽过一次同形的）：
 *   · 用 `rg` 跑那条命令**确实回 0 行** —— 但原因是 **`rg` 里 `\|` 是字面量**（不是「或」），
 *     整串被当成一个不存在的模式；换成 `rg -n "scale\.step|scale\.halfStep" src server/src`
 *     就**有命中**（同一条模式，两个实现给出两个结果 —— 这一条才是最该记住的）。
 *   · `/usr/bin/grep -rn "scale\.step\|scale\.halfStep" src server/src`（BRE 下 `\|` 才是「或」）
 *     同样**有命中**，而且**全在注释里**（历史引用，没有一处是读取）。
 *     ⚠️ 这里刻意**不写条数**：本条注释自己就会被那条命令数进去（2026-09-24 实测，
 *     写完它命中数就 4 → 5）—— 写一个每改一次就过期的数，等于给下一个人留一句假话。
 * ⇒ 所以「删掉这两个成员是安全的」这个结论**仍然成立**，但它靠的是上面那条**类型级**证据，
 * 与这条 grep 无关（grep 只说明「剩下的都是注释」）。
 * ⚠️ 教训写在这里：**凡是把一条命令写进注释，自己先跑一遍、逐字贴输出** ——
 * 一条没跑过的验证命令本身就是一句假话，而且它比写错一个词更隐蔽（读者会以为已经核过了）。
 *
 * ⇒ 删除，而不是留着当历史：
 * 它们就摆在 `rewardAmount` 旁边，下一个人看见「本单的步长」会顺手乘回去，
 * 而那正是本次要拆掉的那个模型。
 *
 * ⚠️ **那两个数没有消失，只是换了消费方。** 学习单级的 `rewardStep` / `halfStep` 仍然落在
 * `Worksheet.settings` 里（规格 §12 裁定 4：「本单未单独设置的题用这个」），由**服务端**的
 * `pointsFromSettings` 读出来、经 `resolvePoints` 折算成**得分** —— 它们现在走的是
 * 「先变成 `score`、再被画出来」这一条路，而不是「在显示层被乘一次」。
 * 教师端也照旧读写它们（那是 `WorksheetSettings`，`worksheet-editor-core.ts` 的
 * `normalizeRewardStep` / `normalizeHalfStep` 归一化的是那一份，**不是**本类型）。
 */
export interface RewardScale {
  /** 哪一档：十一种收藏图标之一或分数。**只有它决定画什么**；画几个由得分定。 */
  style: RewardStyle;
}

/** 认不出的样式一律落到默认档（库里手工改过的行不该让面板画不出东西）。 */
export function normalizeRewardStyle(raw: unknown): RewardStyle {
  return REWARD_STYLE_OPTIONS.some(option => option.value === raw)
    ? raw as RewardStyle
    : DEFAULT_REWARD_STYLE;
}

/**
 * 步长只认 1 / 2 / 3 / 5 这四个值。
 *
 * 🔴 越界值**回落到默认**而不是「夹到区间里」：`0.5` 会让每题显示半颗星（画不出来），
 * `100` 会让一屏被星星塞满。夹逼看起来更温和，但它把一个**不属于取值域**的数
 * 变成一个看起来合法的数 —— 与「缺字段按默认走」相比，后者至少是可解释的。
 */
export function normalizeRewardStep(raw: unknown): number {
  return typeof raw === 'number' && REWARD_STEPS.includes(raw) ? raw : DEFAULT_REWARD_STEP;
}

/**
 * 部分给分档只认 0 / 1 / 2 / 3 / 5 这五个值（越界与缺字段一律回落到 **0**）。
 *
 * ⚠️ 与 `normalizeRewardStep` **不是**同一条规则，也**不许**合并 —— 两者的域不同、
 * 默认值也不同（这里是 0、那里是 1）。理由与代价写在 `HALF_STEPS` 上。
 */
export function normalizeHalfStep(raw: unknown): number {
  return typeof raw === 'number' && HALF_STEPS.includes(raw) ? raw : DEFAULT_HALF_STEP;
}

/**
 * 从 `Worksheet.settings` 那一坨里取出奖励配置（缺字段 / 坏值一律回落到默认档）。
 *
 * ★ M4a：它过去还顺带归一化 `rewardStep` / `halfStep`，**现在只归一化 `style`** ——
 * 那两个数改由服务端的 `pointsFromSettings` 消费（理由与实测写在 `RewardScale` 上）。
 * 它们各自「缺字段 / 越界值回落到哪一个默认」的判据因此只剩两处：服务端那一份
 *（判分用）与教师端 `worksheet-editor-core.ts` 那一份（面板的受控 `<select>` 用）。
 * **学生端不再复制第三份** —— 复制出来的那份没有消费方，只有漂移的机会。
 */
export function resolveRewardScale(settings: unknown): RewardScale {
  const source = settings && typeof settings === 'object' && !Array.isArray(settings)
    ? settings as Record<string, unknown>
    : {};
  return {
    style: normalizeRewardStyle(source.rewardStyle),
  };
}

/**
 * **得分 → 奖励个数**（规格 §9.1 / §12「得分与奖励是同一个数的两种画法」）。
 *
 * 🔴 ★ M4a（2026-09-24 裁定）：**绝对值模型 —— 画出来的就是得分本身，不乘任何步长。**
 * 教师逐题填的「全对给几 / 部分给分给几」**就是**那个数：全对填 5 ⇒ ⭐⭐⭐⭐⭐（分数档 `+5`）、
 * 部分给分填 2 ⇒ ⭐⭐。所以本函数在符号档上是一行 `return score`。
 *
 * ── 为什么不能再乘 `step`（这是本次改动的全部理由）────────────────────────
 *
 * `score` 与旧的步长**是同一个数走两条路**：逐题分值留空时服务端按「继承学习单级」
 * 折算（`pointsFromSettings` ⇒ `resolvePoints`），所以学习单级的 `rewardStep` **已经进了
 * `score`**——再乘一次就是乘两遍。乘法模型只在「每题都是学习单级那个档」时看起来对，
 * 而那正是默认配置（留空 ⇒ `rewardStep` 恰好也是 1）下的巧合。
 *
 * 🔴 实测反例（2026-09-24，B2 那轮抓的）：学习单级 `rewardStep = 3` + 某题 `full = 5`
 * ⇒ 旧实现先 `score >= 1` 判真、返回 `scale.step` ⇒ 学生看到 **⭐⭐⭐**，
 * 而规格 §12 明写「得分与奖励是同一个数的两种画法」（应是 ⭐⭐⭐⭐⭐）。
 * 同一条路还会把「部分给分 1 分」画成 3 个符号（`1 >= 1` ⇒ 走全对那一支）——两个方向都错。
 *
 * 旧模型里那条 `score < 1` 的分支（`halfStep ?? floor(step × score)`）在真实数据上
 * **一次都走不到**：归一化后的 `score` 是整数（`normalizePointValue`），`0 < score < 1`
 * 不存在。这也是 `RewardScale` 上那两个数被删掉的原因之一（见那个类型的注释）。
 *
 * 🔴 入参是**得分**，不是 `isCorrect` 布尔：`null` ⇒ 没判分（主观题 / 关掉自动判分）
 * ⇒ 0 —— **不是「0 分」**，两者在界面上都画不出奖励，但「没判」是「不知道」，
 * 把它当成 0 会让将来的统计把它算成答错。
 *
 * ⚠️ 坏数字（`NaN` / `Infinity` / 负数）与 0 同路：符号档的 `repeat(N)` 拿到 `NaN` 会
 * **抛 RangeError**（渲染路径上的一次白屏），负数同理由此挡住。
 */
/**
 * 奖励数量那几个字（收藏图标档写 `×3`、分数档写 `+3`）。
 *
 * ★ 2026-09-29（教师）：「箭头所指的地方要用图标，『×3』字要小一点」——
 * 那一格改成画卡通图标之后，剩下的就是这几个字。
 *
 * 🔴 **它必须在这里**（而不是各处自己拼一个 `×`）：学生端的 `RewardAmount`
 * 与教师看板那一格都要它，而后者**不能**去引学生端那个组件 —— 那个组件 import 了
 * 学生端学习单整张 CSS module，从教师页引它会把那一整份样式拉进教师看板的产物里。
 * ⚠️ 两处各拼一遍的后果是「学生端写 +3、教师端写 ×3」，而两边都不报错。
 */
export function rewardAmountLabel(style: RewardStyle, amount: number): string {
  return `${style === 'points' ? '+' : '×'}${amount}`;
}

export function rewardAmount(score: number | null, _scale: RewardScale): number {
  // 保留第二个参数，让调用方始终以「得分 + 奖励样式」请求呈现；
  // 绝对值模型下它不再参与数学计算。
  void _scale;
  if (score === null || !Number.isFinite(score) || score <= 0) return 0;
  return score;
}

/** 这一档的文本回退符号。 */
export function rewardSymbol(style: RewardStyle): string | null {
  return REWARD_STYLE_OPTIONS.find(option => option.value === style)?.symbol ?? null;
}

/**
 * **每题旁**那个奖励的字面（规格 §9.3）。`null` = 这一题不画任何东西。
 *
 * 两处「不画」是刻意的，不是漏了：
 *   · `score === null` —— 没判分（主观题、关掉自动判分）⇒ 没有奖励可言；
 *   · 符号档拿到 0 个 —— 「0 颗星」就是一颗都不画（规格 §9.1：显示值 = 答对 ? N : 0）。
 */
export function rewardMark(scale: RewardScale, score: number | null): string | null {
  if (score === null) return null;
  const amount = rewardAmount(score, scale);
  if (amount <= 0) return null;
  if (scale.style === 'points') return `+${amount}`;
  // `String.prototype.repeat` 是 ES6，Safari 15 有（`Array.prototype.at` 才没有，别混用）。
  return rewardSymbol(scale.style)?.repeat(amount) ?? null;
}

/**
 * **顶部累计**那个字面（规格 §9.3 的 `⭐×3`）。`null` = 一个都不画（累计为 0）。
 *
 * 累计的口径是**各题得分之和**（M4a 起：得分是绝对值，所以它同时就是「奖励之和」——
 * 规格 §12「同一个数的两种画法」；0/1 时代那一句「答对题数 × N」是这句话的特例）。
 * 分数档累加出来是一个数，所以它画成 `+3 分` 而不是 `＋×3` —— 后者是对着样式图硬套。
 */
export function rewardTotalText(scale: RewardScale, amount: number): string | null {
  if (amount <= 0) return null;
  if (scale.style === 'points') return `+${amount} 分`;
  const symbol = rewardSymbol(scale.style);
  return symbol ? `${symbol}×${amount}` : null;
}

/**
 * 题目那一行最多画几个奖励图标。
 *
 * ★ 2026-10-08（教师）：「满分是 2 个图标……评分后，根据评分结果将指定个数的图标改为正常颜色显示」
 *   并选定：**超过 5 个封顶，改用 `×N`**。
 * ⚠️ 这一档是**为版面**定的，不是为语义：教师逐题手填的分值没有上界（`isValidPointNumber`），
 *   真填 20 就会把整行撑破 —— 而那一行里还有「已完成」「全部答对」两格。
 */
export const MAX_REWARD_SLOTS = 5;

export interface RewardSlotPlan {
  /** 一共画几枚图标（含灰的那几枚）。 */
  slots: number;
  /** 其中几枚是**正常颜色**（已获得）。 */
  lit: number;
  /** 画不下时补的那个数（`×N` 里的 N）；不需要补就是 `null`。 */
  overflow: number | null;
}

/** 只认非负整数（坏值一律当 0）——`repeat`/循环次数拿到小数或负数会抛。 */
function slotCount(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return Math.round(raw);
}

/**
 * **满分与得分 → 那一行画什么**（几枚灰、几枚亮、要不要补 `×N`）。
 *
 * ```
 * slots = min(max(满分, 得分), 5)      ← 至少盖得住"已得"，最多 5
 * lit   = min(得分, slots)
 * ×N    = 得分 > slots 时补得分
 * ```
 *
 * 🔴 **`slots` 取 `max(满分, 得分)` 的理由**：这两件事正常一致（得分 ≤ 满分），
 *   但「混合填空按空计分」那一档**不保证** —— 服务端在那里给的是 `命中空数 × full`
 *   （`worksheet-questions.ts` 的 `per-blank` 分支），于是得分可以**大于**逐题分值。
 *   只按满分画的话，学生答对 3 空、满格只画 1 枚，看起来像丢了两个奖励。
 *   ⇒ 槽位数自己往上撑，宁可多画一枚，不做"少画"。
 *   ⚠️ 这**不是**完美解：真正的满分在那一档是「空数 × full」，而客户端拿不到空数。
 *     所以 `×N` 兜住"多出来的那部分"，而不是假装满分就是 `full`。
 */
export function rewardSlotPlan(full: number, amount: number): RewardSlotPlan {
  const max = slotCount(full);
  const got = slotCount(amount);
  const slots = Math.min(Math.max(max, got), MAX_REWARD_SLOTS);
  const lit = Math.min(got, slots);
  const overflow = got > slots ? got : null;
  return { slots, lit, overflow };
}

/**
 * 一道题的**满分**（= 全对时能得几分 = 画几枚图标）。
 *
 * 🔴🔴 **这是与服务端逐字对齐的镜像**，改一处就要三处一起改：
 *   ① 服务端判分：`server/src/services/worksheet-questions.ts` 的
 *      `resolvePoints(node, pointsFromSettings(settings))`（**判分用的是这一份**）；
 *   ② 教师端编辑页：`worksheet-editor-core.ts` 里那一份（受控输入框用）；
 *   ③ 本函数与 `resolveWorksheetFullStep`（学生端**画槽位**用）。
 *
 * ⚠️ **别拿 `normalizeRewardStep` 当这个镜子的回落**（我第一版就是那么写的，是错的）：
 *   它的域是 `{1,2,3,5}`（那是**教师端下拉框**的可选项），而服务端 `pointsFromSettings`
 *   对 `rewardStep` 只要求 `1..POINTS_MAX`。库里若有个手改出来的 `7`，
 *   服务端按 `7` 判分、按 `{1,2,3,5}` 归一化的客户端会画 `1` 枚 ⇒ 静默错位。
 *
 * ⚠️ 还有一处**形状**上的坑，同样照服务端抄（`normalizePoints` 用的是 `??`）：
 *   整份 `points` 只要**有一格**可用就会被采用，而 `full` 不可用时填的是
 *   `DEFAULT_POINTS.full`（= 1）—— **不是**学习单级。所以 `{ half: 2 }` 这种
 *   "只填了部分分"的形状上，满分是 **1**，而不是 `rewardStep`。
 *
 * ⚠️ 为什么学生端要自己算、而不等服务端下发：服务端只下发**得分**（绝对值模型），
 *   不下发"满分"。要让它下发就得改接口 —— 那是另一件事。这里刻意只镜像**一条**规则。
 */
export function resolveFullPoints(
  nodePoints: { full?: unknown; half?: unknown } | null | undefined,
  fallbackFull: number,
): number {
  const own = usableFullPointValue(nodePoints?.full);
  if (own !== null) return own;
  if (usablePointValue(nodePoints?.half) !== null) return DEFAULT_REWARD_STEP;
  return fallbackFull;
}

/** 「全对」分值的下界与上界 —— 与服务端 `POINTS_FULL_MIN` / `POINTS_MAX` 同口径。 */
const POINTS_FULL_MIN = 1;
const POINTS_MAX = 99;

/** 服务端 `isUsableFullPointValue`：**全对**档的判据（下界是 1，`0` 算"没填"）。 */
function usableFullPointValue(raw: unknown): number | null {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
  const rounded = Math.round(raw);
  return rounded >= POINTS_FULL_MIN && rounded <= POINTS_MAX ? rounded : null;
}

/** 服务端 `isUsablePointValue`：**部分给分**档的判据（下界是 0 —— `0` 在那一档合法）。 */
function usablePointValue(raw: unknown): number | null {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
  const rounded = Math.round(raw);
  return rounded >= 0 && rounded <= POINTS_MAX ? rounded : null;
}

/**
 * 学习单级的**全对分值**（= `settings.rewardStep` 里那个数）。
 * 与服务端 `pointsFromSettings(settings).full` 同口径：认得出就用，否则默认 1。
 */
export function resolveWorksheetFullStep(settings: unknown): number {
  const source = settings && typeof settings === 'object' && !Array.isArray(settings)
    ? settings as Record<string, unknown>
    : {};
  return usableFullPointValue(source.rewardStep) ?? DEFAULT_REWARD_STEP;
}
