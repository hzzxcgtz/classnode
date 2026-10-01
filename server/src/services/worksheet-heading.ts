/**
 * 两级题号的**服务端镜像** —— 逐字镜像 `src/lib/worksheet-questions.ts` 的
 * `TASK_TYPE` / `flattenAnswerable` / `AnswerableQuestion`。
 *
 * 🔴 **本文件是镜像，不是共享。** 服务端读不到 `src/`，所以这里**必须**再写一份。
 * 改动规则只有一条：**改了 `src/lib/worksheet-questions.ts` 里对应的那一处，这里必须一起改。**
 * `src/lib/worksheet-heading-parity.test.ts` 会红 —— 它把同一批题目树喂给**两份**实现，
 * 题号必须逐字相同。
 *
 * 为什么非要拦住这件事：服务端的题号出现在**导出 Word**（`export-service.ts` 的行首）与
 * **M7a 分析载荷**（`analysis-payload.ts` 的「第 N 题」抬头）里，而教师看板那一列来自前端。
 * 两边算得不一样时，屏幕上、Word 里、载荷里是**三个不同的题号**，且**没有一处报错**。
 *
 * ⚠️ **本文件不许 import 任何东西**（连 `./worksheet-questions.js` 也不行）：
 * 对拍用例用 Node 的类型擦除**直接加载本文件**，而 Node **不会**把 `./x.js` 解析到 `./x.ts`
 * （实测：`ERR_MODULE_NOT_FOUND`）⇒ 一旦有 import，那条护栏就加载不起来。
 * 代价是本文件只能给**结构类型**（`HeadingNode`），不能引 `worksheet-questions.ts` 的
 * `QuestionNode` —— 调用方传自己的节点即可，泛型 `T` 会原样带回来。
 * 先例是 `ink-path.ts`（它为此连 `INK_FORMATS` 都抄了第三份）。
 *
 * ⚠️ 类名与行为都**逐字**来自前端那一份（含注释）。不要"顺手改顺"。
 */

/**
 * 「任务」这个**容器类型**的类型串 —— 与 `services/worksheet-questions.ts` 的
 * `QUESTION_TYPES` 里的那一项、以及前端的 `TASK_TYPE` 必须是**同一个串**。
 */
export const TASK_TYPE = 'task';

/**
 * 本文件认得的节点形状。**只要这三个字段**，所以调用方的 `QuestionNode` 天然满足它；
 * 写成结构类型而不是 import 那个接口，是因为本文件不许有 import（见文件头）。
 */
export interface HeadingNode {
  type: string;
  /** 任务的**标题**（不是说明）：`任务一`。留空 ⇒ 题号不带前缀。 */
  prompt?: string;
  children?: HeadingNode[];
}

/** `flattenAnswerable` 的一项：一道**可作答**的题，以及它在两级结构里的题号。 */
export interface AnswerableQuestion<T extends HeadingNode = HeadingNode> {
  node: T;
  /** 两级题号：`任务一 · 1`。任务标题留空时没有前缀（就是 `1`）。 */
  heading: string;
  /**
   * **全卷连续序号**（题号去掉任务前缀的数字部分）。
   *
   * 服务端**今天不读它** —— 加在这里只是为了「逐字镜像」这条规矩不出现例外
   * （本文件是镜像，见文件头）。前端矩阵按任务分块之后，小题上画的就是它；
   * 而它必须与 `heading` 出自同一个计数器，别在两处各算一遍。
   */
  label: string;
}

/**
 * 拍平成**可作答的题**，并给每一道带上两级题号（`任务一 · 1`）。
 *
 * 🔴 它**跳过任务节点**：任务是分组容器，没有作答值、不判分（教师裁定 ①a），
 * 因此它不该占一个题号、也不该出现在「一道题一条」的任何清单里。
 * 与前端同一份规矩，理由与逐条规则见 `src/lib/worksheet-questions.ts` 的同名函数。
 */
export function flattenAnswerable<T extends HeadingNode>(nodes: T[]): Array<AnswerableQuestion<T>> {
  const out: Array<AnswerableQuestion<T>> = [];
  /** `children` 的守卫 —— 与前端那一份、以及 `flattenQuestions` **逐字同形**（见那里的注释）。 */
  const kids = (node: T): T[] => (Array.isArray(node.children) ? (node.children as T[]) : []);

  /** 全卷只有一个计数器：进入新任务只换标题前缀，不从 1 重新开始。 */
  const counter = { n: 0 };
  const walk = (list: T[], prefix: string, counter: { n: number }) => {
    for (const node of list) {
      if (node.type === TASK_TYPE) {
        const title = typeof node.prompt === 'string' ? node.prompt.trim() : '';
        walk(kids(node), title ? `${title} · ` : '', counter);
        continue;
      }
      counter.n += 1;
      out.push({ node, heading: `${prefix}${counter.n}`, label: String(counter.n) });
      walk(kids(node), prefix, counter);
    }
  };
  walk(nodes, '', counter);
  return out;
}
