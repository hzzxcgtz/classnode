export interface DrawingSurfaceProps {
  data: unknown;
  backgroundUrl: string | null;
  disabled: boolean;
  onChange: (data: unknown) => void;
  /**
   * ★ 2026-10-06：画板抓到的**位图快照** URL（`/uploads/chat/chat-*.png`）。
   *
   * 🔴 与 `onChange` 分开是**有意的**：`onChange` 传的是**作答的真源**（学生能继续编辑
   *    的那份数据），而快照只是「给教师和 AI 看的一张图」——两者混在一个参数里，
   *    迟早会有人把快照当数据存/当数据读。抓不到就不调（`image` 保持上一次的值）。
   */
  /** 位图快照上传完的回调。⚠️ **可选**：教师端编辑「底稿」时不需要快照（没有学生作答）。 */
  onImage?: (url: string) => void;
  /**
   * ★ 2026-10-06（教师）：「学生可以完全从空白开始画，也可以在教师准备好的基础上继续画」。
   * 教师给的**底稿**（`data.drawingStarter`）；没有就是 `null` ⇒ 学生从空白开始。
   */
  starter?: import('@/lib/worksheet-drawing-starter.ts').DrawingStarter | null;
  /**
   * ★ 2026-10-06（教师在真机上发现全屏问题之后加的）：**撤销历史跨挂载存活用的 key**。
   *
   * 🔴 为什么需要：全屏必须走 `createPortal(content, document.body)`（去掉 portal，
   * `position: fixed` 就会被祖先劫持、全屏铺不满 —— 详见 `drawing-tool-body.tsx` 的注释）。
   * 而 portal 切换会让 React **卸载再挂载**整棵子树，画板实例重建 ⇒ 住在 `useRef` 里的历史归零。
   * ⇒ 历史改存在模块级的表里，按这个 key 索引（宿主传题目 id）。
   *
   * ⚠️ **可选**：不传就还是组件内的一份，行为与从前完全一样（别的画板、教师端底稿编辑都不受影响）。
   */
  historyKey?: string;
}
