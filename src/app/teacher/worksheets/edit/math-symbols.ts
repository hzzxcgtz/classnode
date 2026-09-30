/**
 * 公式弹窗里那几排**符号按钮**的内容（★ 2026-09-30，教师第二轮）。
 *
 * 教师原话：「这里可以提供更多的在初中、小学中会用到的公式符号」，并在四类里都打了勾
 * （几何 / 代数与方程 / 推理与集合 / 绝对值与向量）。四类各自去找了该学段的常见写法，
 * 另外补了「数与运算」「比较与关系」两组，把原来那 12 个收编进去。
 *
 * 🔴 **本文件零 import、零 JSX，只有数据** —— 这是刻意的：
 *    `node --test` 的类型擦除不解析运行时 import，所以「点一下那个按钮到底给出什么」
 *    是这一层**唯一**本机验得到的部分（没有 jsdom、没有浏览器，「按钮画得好不好看」
 *    只能真机走查）。判据在 `math-symbols.test.ts`：其中一条把**每一个** `tex` 真的
 *    喂给 `mathMarkup` + `splitMath` 走一遍，要求切回来正好是一段公式、且 tex 一个字不差。
 *    ⚠️ 少了那条网，模板里混进一个换行（`$…$` 不跨行）或者少半个花括号，
 *      屏幕上只是「那个按钮画得怪」，而粘进题干之后是一段**永远不会渲染**的死源码。
 *
 * ⚠️ **`tex` 是源码字面量，不是渲染结果**：教师点一下，它原样插进弹窗的源码框，
 *    光标停在它后面，接着改（`x^2` → `x^2+1`）。所以这里写 `x^2` 而不是 `x²`。
 *
 * ⚠️ **有一档刻意没做**：角度的「分 / 秒」若写成 `^\prime`，教师点完 `^\circ` 再点它
 *    会拼出 `5^\circ^\prime` —— 那是 LaTeX 的**双上标**，KaTeX 直接报错。
 *    所以那两格给的是 `'` 与 `''`（KaTeX 在数学模式里把它们渲染成 ′ 与 ″，
 *    且天然跟在 `^\circ` 后面成立：`5^\circ 30'`）。
 */
export interface MathSymbol {
  /** 插进源码框的字面量（源码写法，不是渲染结果）。 */
  tex: string;
  /**
   * 这个按钮是什么 —— 同时是它的 `title` 与 `aria-label`。
   * 🔴 不是装饰：按钮上只有一个小图形，没有这句话教师看不出是什么，
   *    屏幕阅读器也读不出来（设计规范：图标按钮必须有 aria-label 和 tooltip）。
   */
  title: string;
}

export interface MathSymbolGroup {
  label: string;
  symbols: MathSymbol[];
}

export const MATH_SYMBOL_GROUPS: MathSymbolGroup[] = [
  {
    label: '数与运算',
    symbols: [
      { tex: 'x^2', title: '平方' },
      { tex: 'x^3', title: '立方' },
      { tex: 'x^n', title: 'n 次方' },
      { tex: 'x_1', title: '下标' },
      { tex: 'x_n', title: '第 n 项' },
      { tex: '\\frac{a}{b}', title: '分数' },
      { tex: '\\sqrt{x}', title: '平方根' },
      { tex: '\\sqrt[3]{x}', title: '立方根' },
      { tex: '\\times', title: '乘号' },
      { tex: '\\div', title: '除号' },
      { tex: '\\pm', title: '正负号' },
      { tex: '\\pi', title: '圆周率' },
      { tex: '\\%', title: '百分号' },
    ],
  },
  {
    label: '比较与关系',
    symbols: [
      { tex: '\\ne', title: '不等于' },
      { tex: '\\approx', title: '约等于' },
      { tex: '\\le', title: '小于等于' },
      { tex: '\\ge', title: '大于等于' },
    ],
  },
  {
    label: '几何',
    symbols: [
      { tex: '\\angle', title: '角' },
      { tex: '^\\circ', title: '度' },
      { tex: "'", title: '分（角度的分，跟在「度」后面用）' },
      { tex: "''", title: '秒（角度的秒，跟在「分」后面用）' },
      { tex: '\\perp', title: '垂直' },
      { tex: '\\parallel', title: '平行' },
      { tex: '\\triangle', title: '三角形' },
      { tex: '\\odot', title: '圆' },
      { tex: '\\cong', title: '全等' },
      { tex: '\\sim', title: '相似' },
      { tex: '\\overline{AB}', title: '线段 AB' },
    ],
  },
  {
    label: '代数与方程',
    symbols: [
      { tex: '|x|', title: '绝对值' },
      { tex: '\\vec{a}', title: '向量 a' },
      { tex: '1\\frac{1}{2}', title: '带分数（一又二分之一）' },
      // ⚠️ `\\` 是 LaTeX 的换行（方程组的第二行），不是源码里的换行 ——
      //    真的换行会让这串认不出公式（`$…$` 不跨行），那种错由 `math-symbols.test.ts` 挡。
      { tex: '\\begin{cases} x+y=1 \\\\ x-y=3 \\end{cases}', title: '方程组' },
    ],
  },
  {
    label: '推理与集合',
    symbols: [
      { tex: '\\because', title: '因为' },
      { tex: '\\therefore', title: '所以' },
      { tex: '\\in', title: '属于' },
      { tex: '\\notin', title: '不属于' },
      { tex: '\\cup', title: '并集' },
      { tex: '\\cap', title: '交集' },
    ],
  },
];
