'use client';

import { useMemo, useState } from 'react';

import type { WorksheetQuestionNode } from '@/lib/types';
import {
  MAX_OPTIONS,
  optionKey,
  parseQuestionPaste,
  readCorrectKeys,
  readOptions,
  readOrder,
} from './worksheet-editor-core';

/**
 * 「粘贴题目」的确认窗（★ 2026-09-27）。
 *
 * 完整题目粘贴确认窗：用于选择题和排序题，把题干与选项／排序条目一次拆开。
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
 * ── 三件事必须由这个窗说清楚（少一件就是静默改写）──────────────────────────
 *
 * 1. **它是怎么拆的**（`optionSplit`）—— 「按 A. /（1）这类前缀」与「一行一个」的结果
 *    可以差很远，而教师只看结果不一定看得出来。
 * 2. **会丢掉什么** —— 超出 26 条的、原来选项上的图片。
 * 3. **正确答案会落到哪** —— 按位置保留；落到没了的位置上就会被清掉。
 *
 * ⚠️ 框是**可编辑**的：拆错了就地改一行，比重来一遍快。
 */
export interface PasteQuestionResult {
  /** 要写进题干的那一段（`null` = 这次不动题干）。 */
  stem: string | null;
  /** 要替换掉的选项（空数组 = 这次不动选项）。 */
  texts: string[];
}

export function PasteQuestionDialog({ text, node, onTextChange, onCancel, onConfirm }: {
  text: string;
  /**
   * 粘贴到的是**哪一道题**。
   * 这个窗只从选择题或排序题的工具栏打开（见 `prompt-editor.tsx` 的
   * `canPasteQuestion`），其余题型不会进入这里。
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
   */
  const [stemOnly, setStemOnly] = useState(false);
  const isOrder = node.type === 'order';

  const parsed = useMemo(() => parseQuestionPaste(text), [text]);
  const raw = text.trim();

  // 「只作题干」= 整段原样进题干（连换行一起），不碰选项。
  const result: PasteQuestionResult = stemOnly || !parsed
    ? { stem: raw || null, texts: [] }
    : { stem: parsed.stem, texts: parsed.texts };

  const options = readOptions(node);
  const orderItems = isOrder ? readOrder(node).items : [];
  const correctKeys = readCorrectKeys(node);
  const willReplaceOptions = result.texts.length > 0;
  const withImage = willReplaceOptions ? options.filter(option => option.imageUrl).length : 0;
  // 正确答案现在落在第几个位置（`-1` = 那个 key 已经不在选项里了，按不存在算）。
  const slots = willReplaceOptions
    ? correctKeys.map(key => options.findIndex(option => option.key === key)).filter(slot => slot >= 0)
    : [];
  const kept = slots.filter(slot => slot < result.texts.length);
  const lost = slots.length - kept.length;
  const canConfirm = Boolean(result.stem) || willReplaceOptions;

  return (
    <>
      <div className="modal-overlay" onClick={onCancel} />
      <div className="worksheet-editor-dialog worksheet-editor-paste-dialog" role="dialog" aria-modal="true" aria-labelledby="worksheet-paste-title">
        <h3 id="worksheet-paste-title">粘贴题目</h3>
        <p className="worksheet-editor-dialog-note">
          把题目原样粘进来即可：题干与{isOrder ? '排序条目' : '选项'}会<strong>自动分开</strong>，条目前缀认
          <code>A.</code> <code>1、</code> <code>(1)</code> <code>（A）</code> 这几种写法。
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
              : '例如：\n下列哪个是首都？\nA. 北京\nB. 上海\nC. 广州\nD. 深圳'}
          />
        </label>
        <p className="worksheet-editor-paste-hint" role="status">
          {raw ? '内容不对可以直接在上面的框里改，下面的结果会跟着变。' : '在上面那个框里按 ⌘V（Windows 上 Ctrl+V）粘贴。'}
        </p>

        <div className="worksheet-editor-paste-mode">
          <span>识别为</span>
          <div className="worksheet-editor-mode-tabs" role="radiogroup" aria-label="怎么使用这段粘贴">
            <label className={stemOnly ? '' : 'is-selected'}>
              <input type="radio" name={`paste-mode-${node.id}`} checked={!stemOnly} onChange={() => setStemOnly(false)} />
              <span>题干 + {isOrder ? '条目' : '选项'}</span>
            </label>
            <label className={stemOnly ? 'is-selected' : ''}>
              <input type="radio" name={`paste-mode-${node.id}`} checked={stemOnly} onChange={() => setStemOnly(true)} />
              <span>整段作题干</span>
            </label>
          </div>
        </div>

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
                      {item ? <span className="worksheet-editor-paste-text">{item}</span> : <em className="worksheet-editor-paste-empty">（这一条是空的）</em>}
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </div>
        )}

        {(!stemOnly && parsed?.dropped) || withImage > 0 || kept.length > 0 || lost > 0 || willReplaceOptions ? (
          <ul className="worksheet-editor-paste-notes">
            {/* ⚠️ 「丢了几条」只在真的打算填选项时说 —— 「整段作题干」那一次根本没打算填。 */}
            {!stemOnly && Boolean(parsed?.dropped) && <li>有 {parsed?.dropped} 条超出了上限（最多 {MAX_OPTIONS} 个选项），不会被填进来。</li>}
            {!isOrder && withImage > 0 && <li>原来 {withImage} 个选项上的图片会被一起清掉。</li>}
            {!isOrder && kept.length > 0 && <li>已选的正确答案会按位置留在第 {kept.map(slot => slot + 1).join('、')} 个选项上。</li>}
            {!isOrder && lost > 0 && <li>有 {lost} 个正确答案的位置超出了新的选项数，那个标记会被清掉，需要重新选。</li>}
            {isOrder && willReplaceOptions && <li>粘贴的条目顺序会作为<strong>正确顺序</strong>，学生看到的顺序将自动重新排列。</li>}
            {willReplaceOptions && <li>确认后会换掉这道题<strong>现在全部 {isOrder ? orderItems.length : options.length} 个{isOrder ? '条目' : '选项'}</strong>。</li>}
          </ul>
        ) : null}

        <div className="worksheet-editor-paste-actions">
          <button type="button" className="btn btn-secondary" onClick={onCancel}>取消</button>
          <button type="button" className="btn btn-primary" disabled={!canConfirm} onClick={() => onConfirm(result)}>
            {willReplaceOptions ? `填入题干与${isOrder ? '条目' : '选项'}` : '填入题干'}
          </button>
        </div>
      </div>
    </>
  );
}
