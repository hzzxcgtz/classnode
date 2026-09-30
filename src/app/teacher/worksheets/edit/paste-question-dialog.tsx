'use client';

import { useMemo, useState } from 'react';

import type { WorksheetQuestionNode } from '@/lib/types';
import { BLANK_MARK_TEXT } from '@/lib/worksheet-prompt-marks';
// ★ 2026-09-30：粘贴预览里那些词 / 选项也认公式（教师从别处复制来的题干常常带 `$…$`）。
import { PromptText } from '@/lib/worksheet-prompt-text';
import {
  MAX_OPTIONS,
  isChoiceQuestion,
  optionKey,
  parsePasteFor,
  pasteResultFor,
  readCorrectKeys,
  readOptions,
  readOrder,
  type PasteQuestionResult,
} from './worksheet-editor-core';

/**
 * 「粘贴题目」的确认窗（★ 2026-09-27；★ 2026-09-29 扩到**四种题型**）。
 *
 * ★ 2026-09-29（教师）：「增加选择、判断、填空、排序题型的剪贴板粘贴导入功能」。
 * 此前只有选择题与排序题有这个按钮（`canPasteQuestion` 只认那两种）。
 *
 * ── 🔴 这个窗**不读剪贴板** ────────────────────────────────────────────────
 *
 * 第一版写的是 `await navigator.clipboard.readText()`，教师实测的反馈是：
 * 「点击这个按钮后会出现一个 tip（粘贴），然后点了其它地方弹窗才会出现」——
 * 那一下会拉起**浏览器自己的授权浮层**（Safari 弹一个原生「粘贴」按钮、Chrome 弹权限框），
 * 而浮层不处理掉，这一次读就**永远不返回**。
 * ⇒ 换成「开窗 + 一个已经聚焦的输入框」：教师按 ⌘V 那一下由输入框自己接住，
 * 不需要任何授权，也不会弹任何东西。
 *
 * ── 这个窗必须说清楚的几件事（少一件就是静默改写）──────────────────────────
 *
 * 1. **它是怎么拆的**（`optionSplit`）—— 「按 A. /（1）这类前缀」与「一行一个」的结果
 *    可以差很远，而教师只看结果不一定看得出来。
 * 2. **会丢掉什么** —— 超出 26 条的、原来选项上的图片。
 * 3. **正确答案会落到哪** —— 按位置保留；落到没了的位置上就会被清掉。
 * 4. ★ 2026-09-29：**标注行（答案 / 解析 / 分值）原样留在题干里**，所以要把它们
 *    **列出来**告诉教师「这几行我没有动，你自己删」。教师裁定是「答案全部不作处理」——
 *    认出来只报不动，比替他删一行安全（删错的代价是静默少一段正文）。
 *
 * ⚠️ 框是**可编辑**的：拆错了就地改一行，比重来一遍快。
 */
// ⚠️ `PasteQuestionResult` 的**定义在 `worksheet-editor-core.ts`**（★ 2026-09-29 搬过去）：
// 组装它是 `pasteResultFor` 的事，而那段判断必须能被 `node --test` 钉住。
// 这里转出去一次，调用方（`question-card.tsx`）的 import 路径不用改。
export type { PasteQuestionResult };

export function PasteQuestionDialog({ text, node, onTextChange, onCancel, onConfirm }: {
  text: string;
  /**
   * 粘贴到的是**哪一道题**。
   * 这个窗从题干工具栏那个「粘贴题目」按钮打开，四种题型都会进来
   *（判据见 `prompt-editor.tsx` 的 `canPasteQuestion`）。
   */
  node: WorksheetQuestionNode;
  onTextChange: (value: string) => void;
  onCancel: () => void;
  onConfirm: (result: PasteQuestionResult) => void;
}) {
  /**
   * 「题干 + 选项」还是「整段都当题干」。
   *
   * 🔴 它救的是**解析一定会错的那一类**：一段多行的题干（没有任何选项前缀）会被按
   * 「一行一个选项」拆开 —— 那是对的吗？只有教师知道。给他一个开关，比让他取消重来强。
   * ⚠️ 判断题与填空题**没有这一档**：它们的整段就是题干，给它一个「题干 + 选项」的
   * 选项只会让教师以为还有别的用法。
   */
  const [stemOnly, setStemOnly] = useState(false);
  const [applyPoolMode, setApplyPoolMode] = useState(true);
  /**
   * ★ 2026-09-29（教师）：「排序题中有没有办法自动识别这个的导入内容，如图，
   * 每个排序项前没有编号」→ 随后：「你要不加一个选项，让用户选择第 1 行是不是题干」。
   *
   * 🔴 于是这个选择**一直在**（只要这一档里它有意义），而不只在判据命中时出现：
   * 判据是个启发式 —— 它认不出「教师自己知道」。`null` = 还没动过 ⇒ **跟着判据走**
   *（`parsed.firstLineAsStem` 就是判据给的默认），一勾一放就固定成教师说的那个。
   */
  const [firstLineAsStem, setFirstLineAsStem] = useState<boolean | null>(null);
  const isOrder = node.type === 'order';
  const isChoice = isChoiceQuestion(node);
  /** 有「题干 + 选项/条目」这一档的只有选择题与排序题。 */
  const splittable = isChoice || isOrder;
  const isFill = node.type === 'fill-blank' || node.type === 'choice-blank';
  /** 选项 / 条目那两个字，按题型换。 */
  const itemWord = isOrder ? '条目' : '选项';

  const parsed = useMemo(() => parsePasteFor(node, text), [node, text]);
  const raw = text.trim();

  // ⚠️ 组装那一段的判断在 `pasteResultFor`（纯逻辑、有用例）—— 这里只读它的结果。
  // 🔴 它**不能**在本组件里顺手写：第一版就是在这儿写成「`stemOnly` ⇒ 用原文」的，
  // 而填空题没有「整段作题干」这一档却被那一支兜住 ⇒ `convertBlankMarks` 与
  // `extractPoolWords` 的结果**整个丢掉**，屏幕上只是「粘进去的括号还在」，不报错。
  /** 教师没动过就跟着判据走（`parsed.firstLineAsStem` 是判据给的默认答案）。 */
  const instructionAsStem = firstLineAsStem ?? parsed?.firstLineAsStem ?? false;
  const result: PasteQuestionResult = pasteResultFor(node, text, { stemOnly, instructionAsStem, applyPoolMode })
    ?? { stem: null, texts: [], pool: [], applyPoolMode };

  const options = readOptions(node);
  const orderItems = isOrder ? readOrder(node).items : [];
  const correctKeys = readCorrectKeys(node);
  const willReplaceOptions = result.texts.length > 0;
  const withImage = willReplaceOptions ? options.filter(option => option.imageUrl).length : 0;
  // 正确答案现在落在第几个位置（`-1` = 那个 key 已经不在选项里了，按不存在算）。
  const slots = willReplaceOptions && isChoice
    ? correctKeys.map(key => options.findIndex(option => option.key === key)).filter(slot => slot >= 0)
    : [];
  const kept = slots.filter(slot => slot < result.texts.length);
  const lost = slots.length - kept.length;
  const canConfirm = Boolean(result.stem) || willReplaceOptions;
  /** ★ 2026-09-29：题干里识别到的空有几个（只对填空题有意义）。 */
  const blankCount = parsed?.stem ? parsed.stem.split(BLANK_MARK_TEXT).length - 1 : 0;

  return (
    <>
      <div className="modal-overlay" onClick={onCancel} />
      <div className="worksheet-editor-dialog teacher-editor-dialog worksheet-editor-paste-dialog" role="dialog" aria-modal="true" aria-labelledby="worksheet-paste-title">
        <h3 id="worksheet-paste-title">粘贴题目</h3>
        <p className="worksheet-editor-dialog-note">
          {splittable
            ? `把题目原样粘进来即可：题干与${itemWord}会`
            : isFill
              ? '把整道题粘进来即可：题干里的小括号与一串下划线会变成'
              : '把整道题粘进来即可：整段会作为'}
          {splittable && <strong>自动分开</strong>}
          {splittable && <>，条目前缀认 <code>A.</code> <code>1、</code> <code>(1)</code> <code>（A）</code> 这几种写法。</>}
          {isFill && <><code>{BLANK_MARK_TEXT}</code>（就是学生要填的位置）。</>}
          {!splittable && !isFill && <>题干。</>}
        </p>

        {/* ⚠️ `autoFocus`：这个框是**这次粘贴唯一的入口**（见文件头那段），
            焦点不在里面的话 ⌘V 就粘到别处去了。 */}
        <label className="worksheet-editor-paste-source">
          <span>粘贴内容</span>
          <textarea
            className="input"
            rows={5}
            value={text}
            autoFocus
            onChange={event => onTextChange(event.target.value)}
            placeholder={isOrder
              ? '例如：\n请按事情发展顺序排列。\n1. 放学走出校门\n2. 看见路边落叶\n3. 拿起扫帚扫地'
              : isChoice
                ? '例如：\n下列哪个是首都？\nA. 北京\nB. 上海\nC. 广州\nD. 深圳'
                : node.type === 'true-false'
                  ? '例如：\n地球是绕太阳转的。'
                  : '例如：\n植物进行光合作用需要____，动物呼吸需要（   ）。'}
          />
        </label>
        <p className="worksheet-editor-paste-hint" role="status">
          {raw ? '内容不对可以直接在上面的框里改，下面的结果会跟着变。' : '在上面那个框里按 ⌘V（Windows 上 Ctrl+V）粘贴。'}
        </p>

        {splittable && (
          <div className="worksheet-editor-paste-mode">
            <span>识别为</span>
            <div className="worksheet-editor-mode-tabs" role="radiogroup" aria-label="怎么使用这段粘贴">
              <label className={stemOnly ? '' : 'is-selected'}>
                <input type="radio" name={`paste-mode-${node.id}`} checked={!stemOnly} onChange={() => setStemOnly(false)} />
                <span>题干 + {itemWord}</span>
              </label>
              <label className={stemOnly ? 'is-selected' : ''}>
                <input type="radio" name={`paste-mode-${node.id}`} checked={stemOnly} onChange={() => setStemOnly(true)} />
                <span>整段作题干</span>
              </label>
            </div>
          </div>
        )}

        {/* ★ 2026-09-29：**第 1 行是题干还是条目，由教师说了算**（判据只给默认值）。
            ⚠️ 两个不画的情形：`firstLineAsStem === null`（这一档里没有这个选择 ——
            前缀之前已经有题干了，再问就是拿条目顶掉那段题干）；「整段作题干」那一档
            （整段都进题干，第 1 行是什么已经不成问题）。 */}
        {parsed?.firstLineAsStem != null && !stemOnly && (
          <label className="worksheet-editor-paste-mode">
            <input
              type="checkbox"
              checked={instructionAsStem}
              onChange={event => setFirstLineAsStem(event.target.checked)}
            />
            <span>
              第 1 行「{(parsed.stem ?? parsed.texts[0] ?? '').slice(0, 24)}」是<strong>题目要求</strong>
              （不勾就是第 1 个条目）
            </span>
          </label>
        )}

        {!parsed && !stemOnly ? (
          <p className="worksheet-editor-paste-empty-note">上面还是空的，粘一段内容进来看结果。</p>
        ) : (
          <div className="worksheet-editor-paste-result">
            {result.stem && (
              <div className="worksheet-editor-paste-block">
                {/* ⚠️ 「整段替换」这四个字要写出来：教师可能以为这次粘贴是**追加**到
                    已有题干后面（那是「在光标处插入」那个按钮的语义）。 */}
                <span className="worksheet-editor-paste-block-head">题干（整段替换）</span>
                <p>{result.stem}</p>
              </div>
            )}
            {isFill && (
              <div className="worksheet-editor-paste-block">
                <span className="worksheet-editor-paste-block-head">学生要填的位置</span>
                <p>
                  {blankCount > 0
                    ? `识别到 ${blankCount} 个填空位置${parsed && parsed.converted > 0 ? `（其中 ${parsed.converted} 处是这次由括号 / 下划线统一过来的）` : ''}。`
                    : '这一段里没有识别到填空位置 —— 学生将无处可填。可以在上面的框里用「（   ）」或「____」标出要填的地方。'}
                </p>
              </div>
            )}
            {result.pool.length > 0 && (
              <div className="worksheet-editor-paste-block">
                <span className="worksheet-editor-paste-block-head">待选词 {result.pool.length} 个</span>
                <ul className="worksheet-editor-paste-list">
                  {result.pool.map((word, index) => (
                    <li key={`${word}-${index}`}>
                      <span className="worksheet-editor-paste-key">{index + 1}</span>
                      <span className="worksheet-editor-paste-text"><PromptText text={word} placeholder="" /></span>
                    </li>
                  ))}
                </ul>
                {/* 🔴 默认**勾上**：抽出待选词这件事本身就说明这是「选词」那一档；
                    但它是可取消的 —— 「作答方式」是教师的决定，不是这次粘贴的副产品。 */}
                <label className="worksheet-editor-paste-mode">
                  <input type="checkbox" checked={applyPoolMode} onChange={event => setApplyPoolMode(event.target.checked)} />
                  <span>同时把这些空的作答方式改成「下方选词」</span>
                </label>
              </div>
            )}
            {result.texts.length > 0 && (
              <div className="worksheet-editor-paste-block">
                <span className="worksheet-editor-paste-block-head">
                  {isOrder ? '排序条目' : '选项'} {result.texts.length} 个
                  {!stemOnly && parsed?.optionSplit === 'marker' && '（按前缀拆分）'}
                  {!stemOnly && parsed?.optionSplit === 'line' && '（按每行一个拆分）'}
                </span>
                <ol className="worksheet-editor-paste-list">
                  {result.texts.map((item, index) => (
                    <li key={index}>
                      <span className="worksheet-editor-paste-key">{isOrder ? index + 1 : optionKey(index)}</span>
                      {item
                        ? <span className="worksheet-editor-paste-text"><PromptText text={item} placeholder="" /></span>
                        : <em className="worksheet-editor-paste-empty">（这一条是空的）</em>}
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </div>
        )}

        {(!stemOnly && parsed?.dropped) || withImage > 0 || kept.length > 0 || lost > 0 || willReplaceOptions
          || (parsed?.notes.length ?? 0) > 0 || (parsed?.poolLoose ?? 0) > 0 || isFill ? (
          <ul className="worksheet-editor-paste-notes">
            {/* ⚠️ 「丢了几条」只在真的打算填选项时说 —— 「整段作题干」那一次根本没打算填。 */}
            {!stemOnly && Boolean(parsed?.dropped) && <li>有 {parsed?.dropped} 条超出了上限（最多 {MAX_OPTIONS} 个选项），不会被填进来。</li>}
            {!isOrder && withImage > 0 && <li>原来 {withImage} 个选项上的图片会被一起清掉。</li>}
            {!isOrder && kept.length > 0 && <li>已选的正确答案会按位置留在第 {kept.map(slot => slot + 1).join('、')} 个选项上。</li>}
            {!isOrder && lost > 0 && <li>有 {lost} 个正确答案的位置超出了新的选项数，那个标记会被清掉，需要重新选。</li>}
            {isOrder && willReplaceOptions && <li>粘贴的条目顺序会作为<strong>正确顺序</strong>，学生看到的顺序将自动重新排列。</li>}
            {willReplaceOptions && <li>确认后会换掉这道题<strong>现在全部 {isOrder ? orderItems.length : options.length} 个{itemWord}</strong>。</li>}
            {/* 🔴 教师裁定「答案全部不作处理」⇒ 这几行**原样留在题干里**，所以要列出来。
                不列的话教师只会看到题干末尾多出两行莫名其妙的东西，而不知道那是可以删的。 */}
            {(parsed?.notes.length ?? 0) > 0 && (
              <li>
                下面这几行看起来是答案 / 解析 / 分值标注，<strong>没有动它们</strong>（会留在题干里）；
                不需要的话请在上面的框里删掉：{parsed?.notes.map(note => `「${note}」`).join('、')}
              </li>
            )}
            {(parsed?.poolLoose ?? 0) > 0 && (
              <li>
                有 {parsed?.poolLoose} 处括号里只有空格分隔 —— 按<strong>待选词</strong>处理了。
                如果那本来是一个词（例如 <code>New York</code>），请把它改回题干。
              </li>
            )}
            {isFill && <li>标准答案<strong>不会</strong>从粘贴里识别，请粘完之后自己填。</li>}
          </ul>
        ) : null}

        <div className="worksheet-editor-paste-actions">
          <button type="button" className="btn btn-secondary" onClick={onCancel}>取消</button>
          <button type="button" className="btn btn-primary" disabled={!canConfirm} onClick={() => onConfirm(result)}>
            {willReplaceOptions ? `填入题干与${itemWord}` : '填入题干'}
          </button>
        </div>
      </div>
    </>
  );
}
