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
}
