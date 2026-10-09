'use client';

import { RewardIcon } from '@/components/worksheet-reward-icon';
import { rewardAmount, rewardAmountLabel, rewardSlotPlan, type RewardScale } from '@/lib/worksheet-reward';
import type { WorksheetScore } from './use-worksheet-answers';
import styles from './worksheet.module.css';

/**
 * 奖励数量那几个字（`×N` / 分数档是 `+N`）。
 *
 * ★ 2026-09-29：**导出**给教师看板那一格用（教师：「箭头所指的地方要用图标，『×3』字要小一点」）。
 * 🔴 那个 `×` / `+` 的分别只在**这一处**：看板那一格自己拼一遍的话，某天改动这里
 *（比如分数档也换成 `×`）就会出现「学生端写 +3、教师端写 ×3」，而两边都不报错。
 */
export function RewardAmount({ scale, amount }: { scale: RewardScale; amount: number }) {
  // ★ 2026-09-29：`×N` / `+N` 那条规则搬去了 `@/lib/worksheet-reward`（教师看板那一格
  // 也要它，而那边不能引本文件 —— 本文件 import 了学生端学习单整张 CSS module）。
  return <span className={styles.rewardCount}>{rewardAmountLabel(scale.style, amount)}</span>;
}

/**
 * 一行里每枚图标的边长。
 *
 * ★ 2026-09-29 那版是 22（角标只有那么大）。第 7 项改成行内槽位时压到 18（要挤进那一行），
 *   **2026-10-08 第二批**（教师）：「图标在框外，**图标可以大一些**」⇒ 回到 22；
 *   随后：「**图标继续加大，高度可以与右边的框的一致**」⇒ 提到 32；
 *   再随后：「**图标再小点，不超过两条红线**」⇒ **28**（教师在那张图上用两条红线
 *   标出框的上下沿，要求图标别越出去）。
 *
 * 🔴 这两个数**是量出来的，不是估的**：无头 Chrome 里量到右边那个框 `.questionResult`
 *   高 **33.5px**（内格 `.resultCell` 31.5px）⇒ 28 稳稳在里面（上下各余 2.75px）。
 *   ⚠️ 上界是硬的：**必须小于 33.5**，否则图标会反过来把那一条撑高，
 *     而 09-28 那条「保证左边两个框高度一致」的顾虑正是要保这个。
 *   ⚠️ 若哪天改了 `.resultCell` 的 `padding`（现为 `6px 12px`），33.5 会变，这个数要跟着重算。
 *   ⚠️ 宽度也要留意：最多 5 枚 + 一个 `×N`，28px 一枚 ⇒ 最宽约 150px 再多一个角标。
 *
 * 🔎 另一件事（**别混淆**）：面板里还有一枚 **54px** 的图标 —— `RewardBurst`，
 *   那是"刚答对"那一下弹出的**庆祝动画**（绝对定位、转瞬即逝，见 `.rewardBurst`）。
 *   若在截图里看到"图标比框大出一大截"，很可能是截到了它，而不是这里的槽位。
 *   两者是**不同的东西** —— 改这个常量不会影响那个动画。
 */
const REWARD_SLOT_ICON_SIZE = 28;

/**
 * 一道题的奖励 —— **行内的一排槽位**（满分几枚就画几枚，已得的那几枚是彩色）。
 *
 * ★ 2026-10-08（教师，原话）：「这个奖励图标改一种显示方式，**移动到这行绿色文字信息框的前面**，
 *   例如这题满分是 2 个图标，在完成评分前先显示两个**非常浅的灰度化**处理的图标，
 *   评分后，根据评分结果将**指定个数的图标改为正常颜色**显示。」
 *   并选定：**超过 5 个封顶，改用 `×N`**。
 *
 * 🔴 **这是这条设计线上的第三次反转**，前两次都逐字记着，别再当成"回退"：
 *   · 2026-09-28（图 56）：「火箭和 ×1 不需要框在圆角矩形里」「保证左边两个框的高度一致」
 *     ⇒ 它搬到框**外面**当兄弟；⚠️ 那条顾虑**至今有效**，见下。
 *   · 2026-09-29（⑤）：「叠加在『全部答对』这个框的右上角」「适当缩小」「超过一个加 ×N」
 *     ⇒ 改成**绝对定位的角标 + 只画一枚**。反转理由是「角标只有那么大，画不下五个」。
 *   · 本次：回到**多枚**、并移出行内角标 —— 因为图标**离开了角标**，那个"画不下"的约束
 *     就不存在了。**但 09-28 的"框高一致"要重新自己保**：图标现在占行内空间，
 *     所以尺寸压到 18、`gap: 1px`，且这一组是 `.questionResult` 的**第一个**子项
 *     （`align-items: stretch` 那一排里它自己不设高度，由图标决定）。
 *
 * ⚠️ **未评分时也画**（这是本次的要害）：`score === null` 不再返回 `null`，
 *   而是画一排 `state="empty"` 的灰图标 —— `RewardIcon` 的 `empty` 档正是
 *   `filter: grayscale(1); opacity: .32`，即教师说的"非常浅的灰度化"。
 * ⚠️ **分数档（`points`）例外**：那一档的奖励是**一个数**，不是收藏品，
 *   画一排「+」徽章没有意义 ⇒ 保持"一枚 + 数字"。
 */
export function QuestionReward({ scale, full, score }: { scale: RewardScale; full: number; score: WorksheetScore }) {
  const amount = score === null ? 0 : rewardAmount(score, scale);

  if (scale.style === 'points') {
    return (
      <span className={styles.questionReward} data-style={scale.style}>
        <RewardIcon kind="points" state={amount > 0 ? 'earned' : 'empty'} size={REWARD_SLOT_ICON_SIZE} />
        {amount > 0 && <RewardAmount scale={scale} amount={amount} />}
      </span>
    );
  }

  const plan = rewardSlotPlan(full, amount);
  if (plan.slots <= 0) return null;
  return (
    <span
      className={styles.questionReward}
      data-style={scale.style}
      /* 🔴 图标化的东西必须自带可访问名（本仓的既有规矩）：一排灰/彩图标对读屏是无声的，
         而"本题满分几个、拿到几个"正是这一格要传达的全部信息。 */
      role="img"
      aria-label={amount > 0 ? `本题满分 ${full}，已获得 ${amount}` : `本题满分 ${full}，尚未获得奖励`}
    >
      {Array.from({ length: plan.slots }, (_, index) => (
        <RewardIcon
          key={index}
          kind={scale.style}
          state={index < plan.lit ? 'earned' : 'empty'}
          size={REWARD_SLOT_ICON_SIZE}
        />
      ))}
      {plan.overflow !== null && <RewardAmount scale={scale} amount={plan.overflow} />}
    </span>
  );
}

/** 顶栏累计：始终是一枚图标加数量，数量大时也不会挤成一串。 */
export function RewardTotal({ scale, amount }: { scale: RewardScale; amount: number }) {
  if (amount <= 0) return null;
  return (
    <span className={styles.rewardTotal} aria-label={`已获得 ${amount}`}>
      <RewardIcon kind={scale.style} state="earned" size={24} />
      <RewardAmount scale={scale} amount={amount} />
    </span>
  );
}

/** 只在一次新的“全部答对”响应到达时挂载，结束后淡出，静态得奖信息仍留在反馈框。 */
export function RewardBurst({ scale, score }: { scale: RewardScale; score: WorksheetScore }) {
  const amount = rewardAmount(score, scale);
  if (amount <= 0) return null;
  return (
    <span className={styles.rewardBurst} aria-live="polite" aria-label={`答对了，获得 ${amount} 个奖励`}>
      <span className={styles.rewardBurstHalo} aria-hidden="true" />
      <RewardIcon kind={scale.style} state="earned" size={54} />
      <RewardAmount scale={scale} amount={amount} />
    </span>
  );
}
