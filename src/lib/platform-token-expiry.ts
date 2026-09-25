/**
 * ★ 2026-09-25：**共享 API Token 的有效期还剩多久**。
 *
 * 这个文件不碰 React / DOM / 网络，理由与 `worksheet-drawer-state.ts` 那批逐字相同：
 * 这里的判据错了**不抛异常、不让编译失败**，只会让教师看到一句错的结论 ——
 * 而这句话的作用正是「催他及时换 Token」。**说错了比不说更糟**：
 * 说「还剩 12 天」而实际明天就到期，全班会在第二天集体提问失败，且没有任何预兆。
 *
 * 🔴 **「天」按自然日算，不按 24 小时**：教师问的是「还有几天」，不是「还有几小时」。
 * 实现上先各自落回**本地零点**再相减 —— 直接减时间戳会让「今晚 23:00 看明早到期」
 * 算成 0.08 天再取整成 0（显示「今天到期」，而它明明是明天）。
 *
 * 🔴 **有效期是教师手工填的，扣子没有「查有效期」的 API**（spec §五）。
 * 所以这一层只负责「按他填的那个日期算」，不负责判断那个日期对不对。
 * 也正因为日期可能填错 —— **过期只提醒、不停用智能体**（教师裁定）。
 */

/** 还剩多少「档」。`none` = 没填有效期（一个要被催促的状态，不是沉默的默认）。 */
export type TokenExpiryLevel = 'none' | 'ok' | 'soon' | 'urgent' | 'expired';

export interface TokenExpiryView {
  level: TokenExpiryLevel;
  /** 自然日之差：`0` = 今天到期，负数 = 已过去几天。`none` 档是 `null`。 */
  days: number | null;
  /** 界面上那句话。 */
  text: string;
}

/** 到了这一档就要显眼（≤7 天黄 / ≤3 天红）。 */
const SOON_DAYS = 7;
const URGENT_DAYS = 3;

/** 落回**本地零点**，好按自然日相减。 */
function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 读一条 `expiresAt`，给出该显示什么。
 *
 * ⚠️ **读不出来的值走 `none` 档，不写「还剩 0 天」**：后者会让教师以为今天就到期，
 * 而事实是我们根本不知道 —— 那会催他去换一个**可能还好好的** Token。
 */
export function tokenExpiryView(expiresAt: string | null | undefined, now: Date): TokenExpiryView {
  if (!expiresAt) return { level: 'none', days: null, text: '未设置有效期' };
  const parsed = new Date(expiresAt);
  if (Number.isNaN(parsed.getTime())) return { level: 'none', days: null, text: '未设置有效期' };

  const days = Math.round((startOfDay(parsed) - startOfDay(now)) / DAY_MS);
  if (days < 0) return { level: 'expired', days, text: `已过期 ${-days} 天` };
  if (days === 0) return { level: 'urgent', days, text: '今天到期' };
  if (days <= URGENT_DAYS) return { level: 'urgent', days, text: `还剩 ${days} 天` };
  if (days <= SOON_DAYS) return { level: 'soon', days, text: `还剩 ${days} 天` };
  return { level: 'ok', days, text: `还剩 ${days} 天` };
}

/**
 * 新建一份凭据时，有效期输入框的默认值：**今天 + 30 天**。
 *
 * 「30 天」是**扣子平台当前的最长有效期**（教师提供）—— 所以它是**默认值，不是硬上限**：
 * 扣子改了策略时教师自己改这个日期即可，我们**不去猜**、也不夹范围。
 *
 * ⚠️ 用 `setDate(getDate() + 30)` 而不是加 `30 * 86400000`：后者在夏令时切换那两天
 * 会差一小时再取整成差一天，而这件事只在一年里的两天发生 —— 最难复现的那一类。
 *
 * 返回 `YYYY-MM-DD`：`<input type="date">` 要的就是这个格式，不要 ISO 时间串。
 */
export function defaultExpiryDate(now: Date): string {
  const target = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 30);
  const month = String(target.getMonth() + 1).padStart(2, '0');
  const day = String(target.getDate()).padStart(2, '0');
  return `${target.getFullYear()}-${month}-${day}`;
}
