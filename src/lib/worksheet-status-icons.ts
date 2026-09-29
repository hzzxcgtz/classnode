/** 学习单状态图标的唯一资源表。名称表达语义，不表达具体形状。 */
export const WORKSHEET_STATUS_ICON_SOURCES = {
  completed: '/worksheet/status-icons/completed.svg',
  submitted: '/worksheet/status-icons/submitted.svg',
  drafting: '/worksheet/status-icons/drafting.svg',
  unanswered: '/worksheet/status-icons/unanswered.svg',
  correct: '/worksheet/status-icons/correct.svg',
  partial: '/worksheet/status-icons/partial.svg',
  retry: '/worksheet/status-icons/retry.svg',
} as const;

export type WorksheetStatusIconName = keyof typeof WORKSHEET_STATUS_ICON_SOURCES;
