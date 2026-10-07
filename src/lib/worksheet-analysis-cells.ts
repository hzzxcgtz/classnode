/**
 * 「这个学生是**第几格**、代号是什么」—— 教师核对 AI 评分用的。
 *
 * ★ 2026-10-07（教师：40 人一起交给智能体）—— 这一条补的是一个**静默**的坑：
 *   模型看串格时，分会**贴到别人头上**（解析只要求「代号在名单里」，认错了也照收），
 *   而教师能核对的那张「代号 ↔ 真名 ↔ 第几格」对照表藏在「查看发送数据」折叠区里 ——
 *   不看就无从核对，两边也都不报错。
 *
 * ⚠️ 格号就是**载荷里条目的序号**（+1）：联系表按同一个顺序排版（`layoutSheets` 逐片切），
 *    所以这里的号与图上的「第 N 格」是同一个号。另立一套编号必然对不上。
 */
export function cellNumberOf(
  entries: ReadonlyArray<{ studentId: string; anonLabel: string }>,
  studentId: string,
): { cell: number; anonLabel: string } | null {
  const index = entries.findIndex((entry) => entry.studentId === studentId);
  if (index < 0) return null;
  return { cell: index + 1, anonLabel: entries[index].anonLabel };
}

/** 评分行旁边那句话：「第 3 格 · 张伟#7」。读不出来时回 `null`（宁可不说，也不编一个号）。 */
export function cellLabelOf(
  entries: ReadonlyArray<{ studentId: string; anonLabel: string }>,
  studentId: string,
): string | null {
  const hit = cellNumberOf(entries, studentId);
  return hit ? `第 ${hit.cell} 格 · ${hit.anonLabel}` : null;
}

/**
 * 把**老结果**里嵌着的伪名（`User_00X`）换回真名。
 *
 * ★ 2026-10-07（教师：标签改用「姓名 + 学号」）——
 *   🔴 **朴素子串替换到这里为止。** 老写法（`acc.split(entry.anonLabel).join(real)`）的
 *   安全性**只依赖**「`User_001` 互不为子串」；换成真名之后，姓名可能是**别人姓名或
 *   正文的子串**（正文里恰好提到「张伟」这三个字）⇒ **静默改错文字**。
 * ⇒ 只认**老格式**那一种：一个班不可能有 1000 人，`User_` + 三位数不会误伤正文。
 *   新结果里的标签本来就是真名，**一个字都不需要替换**。
 *
 * ⚠️ 换不出来的（名册里查不到、或老结果的编号与现在这份名单对不上）**原样留着** ——
 *    留着 `User_003` 教师至少能看出「这里有个代号没换过来」，改错成另一个人则是看不出来的。
 */
export function localizeLegacyLabels(
  text: string | null | undefined,
  entries: ReadonlyArray<{ studentId: string; anonLabel: string }>,
  nameOf: (studentId: string) => string | null,
): string | null {
  if (!text) return text ?? null;
  /*
   * 🔴 老标签**不能从 `entry.anonLabel` 查** —— 它现在已经是 `张伟#7` 了，
   *   而老解读里嵌的是当年的 `User_001`。老标签是**按格序派生**的
   *   （`payloadLabels` 在 2026-10-07 之前的写法），所以这里按**下标**还原它。
   * ⚠️ 这把尺子的弱点与老写法**逐字相同**：老解读落库之后名册变过（有人退出 / 换班），
   *   编号会整体挪位 ⇒ 换出来的人名可能不是当年那个。不换的代价是教师读到一串 `User_005`
   *   （2026-09-29 那次修的就是它），换错的代价是读到一个错的人名 —— 两害相权，
   *   取「按产出时的口径还原」，并把这条弱点写在这里。
   */
  const byLabel = new Map<string, string>();
  entries.forEach((entry, index) => {
    const real = nameOf(entry.studentId);
    if (real) byLabel.set(`User_${String(index + 1).padStart(3, '0')}`, real);
  });
  /*
   * ⚠️ 名册里没有的条目**不需要**单独处理：`payloadLabels` 的回落支给它的老式伪名
   *   用的就是**它自己的下标**（`User_${index + 1}`）⇒ 与上面按序还原的那一个逐字相同。
   */
  return text.replace(/\bUser_\d{3,}\b/g, (found) => byLabel.get(found) ?? found);
}
