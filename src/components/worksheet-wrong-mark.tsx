'use client';

import { WorksheetStatusIcon } from './worksheet-status-icon';

/**
 * 需要再试一次的标记：温和的红色回转箭头，不再使用会给学生挫败感的叉号。
 *
 * ★ 2026-09-27：**从 `src/lib/worksheet-prompt-text.tsx` 搬到这里。**
 * 教师那天要求「选择和判断学生错误后也要与填空一样给出叉叉符号」—— 于是它现在有**两个**
 * 使用者：题干里的填空域（`worksheet-prompt-text.tsx`）与选择题的选项（`questions/choice-body.tsx`）。
 * 从「题干渲染器」里导出一个给选项用的标记，读起来是错的层次；它本来就是一枚**独立的小图标**。
 *
 * 🔴 **一处定义** —— 这轮已经有三次「同一个东西写两处、然后分叉」的教训（字重、红色、
 * 覆盖顺序），所以标记也只有这一份。两处各画一个叉的后果是「填空那个叉和选择那个叉长得不一样」，
 * 而那是教师最会一眼看出来的东西。
 *
 * ⚠️ **内联 SVG，不用 emoji**：学生端跑在学校的旧 iPad 上，emoji 各家字体渲染差很远。
 * ⚠️ **不要用 `<sup>`**：它自带 `vertical-align: super`，与 `line-height: 0` 叠加之后会把标记
 *    挤出盒子（2026-09-27 教师看到的「落到框外面/右下角」就是它）。位置一律交给**布局**。
 * 🔴 **不许用 `position: absolute`**：那样它就会浮在内容上面。这条有过一次真实缺陷 ——
 *    填空的输入框那边原来把叉绝对定位在框的右上角，而框是按内容算宽的 ⇒ 学生的答案一长，
 *    叉就压在字上（教师 2026-09-27 报的「原来的字会最淡」）。
 *    `src/lib/worksheet-prompt-text.test.ts` 有一条用例钉着那个文件里不许出现定位。
 * ⚠️ `role="img"` + `aria-label`：光秃秃一个叉对读屏无意义（本仓立过
 *    「图标化只减视觉宽度、不减无障碍信息」）。
 */
export function WrongMark() {
  return (
    <span role="img" aria-label="再想一想" style={{ display: 'inline-flex', marginLeft: 3, flexShrink: 0 }}>
      <WorksheetStatusIcon name="retry" size={13} />
    </span>
  );
}
