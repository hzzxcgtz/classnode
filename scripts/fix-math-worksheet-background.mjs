/**
 * 清理那份测试单里的**死数据**与**与实际不符的措辞**（教师 2026-10-08 要求）。
 *
 * 背景：我在造单时写了 `drawingBackgroundPreset: 'small-grid' / 'coordinate'`，
 * 以为学生会看到方格纸 / 坐标纸。实际不是 ——
 * `readDrawingBackground` 只在「`tool === 'math'` 且 `preset === 'custom'`」时才用自定义图，
 * **其余一律点阵**；而且界面上压根没有这些预设可挑（只有「上传图片」）。
 * ⇒ 那两处 preset 是**死数据**，而题干里的"方格纸 / 坐标纸"是**说了做不到**的话。
 *
 * 用法（仓库根）：
 *   npx tsx scripts/fix-math-worksheet-background.mjs          # 干跑
 *   npx tsx scripts/fix-math-worksheet-background.mjs --apply  # 真的改
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const requireFromServer = createRequire(path.join(ROOT, 'server', 'package.json'));
const { PrismaClient } = requireFromServer('@prisma/client');

const APPLY = process.argv.includes('--apply');
const ID = '60c5540d-f7b1-4fdf-84c4-9a08a514aa9c';

/**
 * 🔴 逐条替换，每条都**必须正好命中一次** —— 命中 0 次或多次就报错退出。
 *    （命中 0 次说明我记错了原文，那就不该改；命中多次说明有歧义，也不该盲改。）
 */
const REPLACEMENTS = [
  // ① 那一档没有方格纸，只有点阵 ⇒ 措辞改成不依赖可见网格的说法。
  [
    '在方格纸上画一个长 4 格、宽 2 格的长方形，并用**直角记号**标出它的四个直角。',
    '在画板上画一个长方形：长是宽的 2 倍（比如长 4、宽 2），并用**直角记号**标出它的四个直角。',
  ],
  [
    '长方形边长正确得 2 分（长 4 格、宽 2 格各 1 分）；四个直角记号齐全得 2 分（每缺一个扣 0.5 分，扣完为止）。画成正方形或边长不符的，边长部分不得分。',
    '长是宽的 2 倍、且四个角都是直角得 2 分；四个直角记号齐全得 2 分（每缺一个扣 0.5 分，扣完为止）。画成正方形或长宽不成 2 倍的，前一项不得分。',
  ],
  // ② 这一题**有**底图（坐标系），所以"方格"改成坐标系的单位。
  [
    '下面已经给出了一条线段和一个直角坐标系。请在坐标系里画出一个**面积为 4 个方格**的长方形，并用平行记号标出一组对边。',
    '下面已经给出了一条线段和一个直角坐标系。请在坐标系里画出一个**面积为 4 个平方单位**的长方形，并用平行记号标出一组对边。',
  ],
  [
    '长方形面积恰为 4 格得 3 分；用平行记号标出一组对边得 1 分。面积不对不得分。',
    '长方形面积恰为 4 个平方单位得 3 分；用平行记号标出一组对边得 1 分。面积不对不得分。',
  ],
  // ③ 这一题也有底图（坐标系）⇒ "坐标纸"要说成"给出的坐标系"。
  [
    '请根据下面的数据，在坐标纸上画一张**条形统计图**，并标出标题。',
    '请根据下面的数据，在给出的坐标系里画一张**条形统计图**，并标出标题。',
  ],
];

/** 死数据键：今天读它不会有任何效果，留着只会让下一个人以为配了底图。 */
const DEAD_KEYS = ['drawingBackgroundPreset', 'drawingBackgroundImageUrl'];

const prisma = new PrismaClient();
try {
  const row = await prisma.worksheet.findUnique({ where: { id: ID } });
  if (!row) throw new Error(`找不到学习单 ${ID}`);
  let text = JSON.stringify(row.content);

  const report = [];
  for (const [from, to] of REPLACEMENTS) {
    const count = text.split(from).length - 1;
    if (count !== 1) {
      console.error(`❌ 替换命中 ${count} 次（要求恰好 1 次）：${from.slice(0, 28)}…`);
      process.exit(1);
    }
    text = text.replace(from, to);
    report.push(`  ✓ ${from.slice(0, 24)}… → ${to.slice(0, 24)}…`);
  }

  const content = JSON.parse(text);
  let removed = 0;
  (function walk(list) {
    for (const n of list ?? []) {
      if (n.type === 'drawing') for (const key of DEAD_KEYS) if (key in (n.data ?? {})) { delete n.data[key]; removed += 1; }
      walk(n.children);
    }
  })(content.nodes);

  console.log('措辞替换：'); report.forEach((line) => console.log(line));
  console.log(`死数据：删掉 ${removed} 处 ${DEAD_KEYS.join(' / ')}`);
  console.log('删后每道绘图题的底图状态：');
  (function walk(list) {
    for (const n of list ?? []) {
      if (n.type === 'drawing') {
        console.log(`  · ${n.data?.drawingTool ?? '(无)'} 底稿=${n.data?.drawingStarter ? '有' : '无'} preset=${n.data?.drawingBackgroundPreset ?? '(已删)'}`);
      }
      walk(n.children);
    }
  })(content.nodes);

  if (!APPLY) { console.log('\n（干跑：没有写库。加 --apply 才改。）'); process.exit(0); }

  await prisma.worksheet.update({ where: { id: ID }, data: { content } });
  const back = await prisma.worksheet.findUnique({ where: { id: ID } });
  const stillDead = JSON.stringify(back.content).includes('drawingBackgroundPreset');
  console.log('\n✅ 已更新；库里还残留 preset？', stillDead ? '❌ 是' : '否');
} finally {
  await prisma.$disconnect();
}
