// 平台显示名
export const platformLabels: Record<string, string> = {
  coze: 'Coze 低代码',
  'coze-agent': 'Coze 编程',
  wenxin: '文心智能体',
  zhipuai: '清言智能体',
};

/*
 * 平台品牌色。
 *
 * ★ 2026-10-08（教师）：「仪表盘中的所有图表颜色要重新设计，过于暗淡，过于不协调」。
 * 🔴 原先这四色与仪表盘自己那套（`dashboard/page.tsx` 的 `COLORS`）是**两套并行的色板**，
 *   饱和度与色系都不是一家 —— 这正是「不协调」的来源之一：亮青 `#1d8cf8` 与鲜紫 `#7c3aed`
 *   摆在一堆灰调色旁边。现改为与仪表盘共用同一套。
 *
 * 🔴 **这四档按「全对」校验，不是按相邻**：平台环形图的数据是
 *   `platformData`（`dashboard/page.tsx`）**按数量降序**排出来的 ⇒ 哪两片挨着由数据决定，
 *   排序规避不了，必须任意两色都能分辨。所以只取互相最远的四档。
 *   ⚠️ 具体地：**蓝与紫不能同时出现在这四档里**（实测全对 ΔE 9.1，低于 15 的硬下限）。
 *   取舍是保 **coze 的蓝**（蓝是仪表盘主色，coze 也是最常见的平台），coze-agent 因此改暖色。
 *   ✅ 校验结果：明度带 / 彩度下限 / 常视力下限 / 对比度 全过；色盲区分度 6.3
 *     （落在 6–8 允许带内 ⇒ 依赖次级编码，而平台环形图带图例文字与 Tooltip，正是那一种）。
 *
 * ⚠️ 本仓还有两处**另外的系统**也在用这几个旧色值，**都不在本次范围**，别顺手改：
 *   · 学生端课堂 UI（`src/app/classroom/`，如 `module-meta.tsx` 的模块强调色、聊天面板）；
 *   · `--cn-primary*`（全站品牌色）。
 * ⚠️ 消费者：`dashboard/page.tsx`（平台环形图）与 `teacher/page.tsx:825`（课堂管理页的
 *   智能体图标底色）—— 后者会跟着一起变（同色系，属于本次要修的「协调」）。
 */
export const platformColors: Record<string, string> = {
  coze: '#3f6fa8',
  'coze-agent': '#b3821f',
  wenxin: '#b34a5e',
  zhipuai: '#2f9e63',
};

/*
 * 平台徽标背景色。
 * 🔴 2026-10-08 核出：**这是一个没有消费者的死常量**（全仓 grep 只有此处定义）。
 *   本次仍按新的 platformColors 把它配成同色系 —— 但那只是"万一将来有人用"，
 *   **不是**一条活的依赖。别把它当成"改 platformColors 必须同步的地方"。
 *   （真要清理是另一个话题：删掉它需要先确认没有外部/未来用点。）
 */
export const platformBadgeBg: Record<string, string> = {
  coze: '#eaf1f8',
  'coze-agent': '#f9f2e3',
  wenxin: '#faecef',
  zhipuai: '#e9f5ee',
};

export const classroomModeLabels: Record<string, string> = {
  standard: '标准模式',
  advanced: '高级模式',
  group: '分组模式',
};

export const classroomModeColors: Record<string, string> = {
  standard: '#527198',
  advanced: '#7c3aed',
  group: '#956834',
};

export const classroomModeBg: Record<string, string> = {
  standard: '#eef3f8',
  advanced: '#f5f3ff',
  group: '#faf4eb',
};

export const statusColors: Record<string, string> = {
  active: '#10b981',
  paused: '#956834',
  ended: '#94a3b8',
};

export const statusLabels: Record<string, string> = {
  active: '进行中',
  paused: '已暂停',
  ended: '已结束',
};
