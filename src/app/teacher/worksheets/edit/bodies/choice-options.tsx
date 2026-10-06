'use client';

import { useCallback, useEffect, useRef, useState, type ClipboardEvent as ReactClipboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { api } from '@/lib/api';
import type { WorksheetQuestionNode } from '@/lib/types';
import { worksheetAssetUrl } from '@/lib/worksheet-presentation';
// ★ 2026-10-06：粘贴去格式那一个纯函数（唯一一份，题目卡里「评分标准」那个 textarea 用的也是它）。
import { normalizePastedText } from '@/lib/worksheet-text-normalize';
import { TrashIcon } from '../editor-icons';
import {
  dropIndexAt,
  MAX_OPTIONS,
  moveOptionTo,
  optionKey,
  readCorrectKeys,
  readOptions,
  writeMultipleOptions,
  writeOptions,
  type ChoiceOption,
} from '../worksheet-editor-core';

/**
 * 选项列表 + 正确答案 —— **单选与多选共用的那一份**。
 *
 * 🔴 **每次改动都把 `options` 与 `correctKeys` 一起交给 `writeOptions` / `writeMultipleOptions`。**
 * 分开写会有一个窗口期：选项已经重编号、正确答案还指着旧字母 —— 而那个窗口期一旦被
 * 保存或撤销命中，落库的就是一张判分全错的题（**没有任何报错**）。
 * 这个纪律原来写在 `question-card.tsx` 的 `SingleChoiceBody` 上；那个组件写死了单选，
 * M4a 加多选题时把它拆成了**这一个受控组件 + 一个 `multiple` 开关**，
 * 于是那条纪律只有一处需要遵守 —— 而这里是它唯一的实现。
 *
 * ⚠️ **重编号与翻译 `correctKeys` 的判据全在 `worksheet-editor-core.ts` 里**
 *（`writeOptions` / `writeMultipleOptions`，它们共用一份实现）。这个组件只负责
 * 「把控件画出来、把改动交上去」，不做任何判断 —— 组件这一层**没有回归网**
 *（本仓前端没有 jsdom / testing-library），判据留在这里就等于没有验证过。
 */
export function ChoiceOptionsEditor({ node, multiple, onDataChange, showAnswer = true }: {
  node: WorksheetQuestionNode;
  /** `true` = 多选题（可勾多个、正确答案可以不止一个）。`false` = 单选/判断以外的单选口径。 */
  multiple: boolean;
  onDataChange: (patch: Record<string, unknown>) => void;
  /** 关掉「允许自动评分」时为 `false` ⇒ **只隐藏「正确答案」那几个圆点/勾选框**，选项列表照常。 */
  showAnswer?: boolean;
}) {
  const options = readOptions(node);
  const correctKeys = readCorrectKeys(node);

  const commit = (nextOptions: ChoiceOption[], nextCorrect: unknown) => {
    const written = multiple
      ? writeMultipleOptions(nextOptions, nextCorrect)
      : writeOptions(nextOptions, nextCorrect);
    onDataChange({ options: written.options, correctKeys: written.correctKeys });
  };

  /** 只改**一个**选项的文字，其余与正确答案原样交回 `commit`（重编号纪律见文件头）。 */
  const commitOptionText = (index: number, text: string) => {
    commit(options.map((item, itemIndex) => (itemIndex === index ? { ...item, text } : item)), correctKeys);
  };

  /**
   * ★ 2026-10-06（教师）：「这里复制进来的文本，格式要去掉」——选项文字那一格的**粘贴去格式**。
   *
   * 🔴 从 Word / 网页复制进来的**不是内容，是排版**（行首缩进、全角空格、标点**前面**多一个
   *    空格）⇒ 与题目卡里「评分标准」那个 textarea **同一种接法**：`onPaste` 接管
   *    （`preventDefault` + 直接写入归一化后的文本，避免「先脏后清」闪一下），
   *    **离开输入框时**再收一次（接上之前就已经粘进来的旧内容也能被清干净 ——
   *    `normalizePastedText` 是幂等的，干净的文本不会被改样）。
   * ⚠️ **只接管 `onPaste` 与 `onBlur`**：打字那条路（`onChange`）一个字都没动。
   * ⚠️ `onBlur` **只在内容真的变了才写回**：没改样就不写，不白占一格撤销栈。
   */
  const pasteOptionText = (index: number, event: ReactClipboardEvent<HTMLInputElement>) => {
    const raw = event.clipboardData.getData('text/plain');
    if (!raw) return;
    event.preventDefault();
    const element = event.currentTarget;
    const start = element.selectionStart ?? element.value.length;
    const end = element.selectionEnd ?? element.value.length;
    commitOptionText(index, `${element.value.slice(0, start)}${normalizePastedText(raw)}${element.value.slice(end)}`);
  };

  const flushOptionText = (index: number, value: string) => {
    const next = normalizePastedText(value);
    if (next !== value) commitOptionText(index, next);
  };

  /**
   * ★ 2026-09-27（教师）：「4 个选项可以拖拽、上下移动、改变位置。」
   *
   * 与题目那边的拖动**同一套手法**（`edit/page.tsx`）：指针事件 + `dropIndexAt` 算落点
   * + 一条 `position: fixed` 的线。**不用 HTML5 拖放**（老 iPad 上不可用，学生端的
   * `use-pointer-drag.ts` 已经踩过一遍），教师端也可能在触屏笔记本上开。
   */
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dropLine, setDropLine] = useState<{ y: number; left: number; width: number } | null>(null);
  const dropIndexRef = useRef<number | null>(null);
  /**
   * 🔴 落点那一下要读的是**当下**的选项与正确答案，不是拖动开始时那一份。
   * 走 ref 而不是把它们放进 effect 依赖：`options` 每次渲染都是新数组、
   * `commit` 又闭包着父组件每次渲染新建的 `onDataChange` —— 放进依赖会让这个 effect
   * 在拖动过程中被反复拆掉重建（监听器一断，指针事件就漏了）。
   */
  const latestRef = useRef({ options, correctKeys, commit });
  latestRef.current = { options, correctKeys, commit };

  const startDrag = useCallback((event: ReactPointerEvent<HTMLElement>, index: number) => {
    // ⚠️ `preventDefault`：不拦的话按住把手拖到文字上会**顺带选中一片文字**。
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dropIndexRef.current = null;
    setDropLine(null);
    setDragFrom(index);
  }, []);

  useEffect(() => {
    if (dragFrom === null) return;
    // 只认**这一道题**的选项行：同一页里可能还有别的题（折叠态的预览不画这个把手，
    // 但 `data-option-row` 是这道题独有的，比按类名找稳）。
    const rowsInThisQuestion = () => Array.from(
      document.querySelectorAll<HTMLElement>(`[data-option-row="${CSS.escape(node.id)}"]`),
    );
    const onMove = (event: PointerEvent) => {
      const rects = rowsInThisQuestion().map(row => row.getBoundingClientRect());
      if (rects.length === 0) return;
      const index = dropIndexAt(rects.map(rect => ({ top: rect.top, height: rect.height })), event.clientY);
      dropIndexRef.current = index;
      // 线画在**行的边界**上（第 0 位画在第一行上沿，其余画在第 index-1 行的下沿）。
      const first = rects[0];
      setDropLine({
        y: index === 0 ? first.top : rects[index - 1].bottom,
        left: first.left,
        width: first.width,
      });
    };
    const onUp = () => {
      const index = dropIndexRef.current;
      const { options: current, correctKeys: currentKeys, commit: apply } = latestRef.current;
      // 🔴 落点是从「还带着被拖那一行」的列表里量出来的 ⇒ 往下拖时下标要多减一。
      if (index !== null) {
        const to = index > dragFrom ? index - 1 : index;
        const next = moveOptionTo(current, dragFrom, to);
        // ⚠️ 原地不动时 `moveOptionTo` 返回**原数组** ⇒ 这里别再 commit：
        //    一次「拖回原位」不该占掉一格撤销栈（`updateData` 按 `===` 判有没有变）。
        if (next !== current) apply(next, currentKeys);
      }
      dropIndexRef.current = null;
      setDragFrom(null);
      setDropLine(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    // ⚠️ `pointercancel` 也要收尾（系统手势抢走指针时）：不然线会**永远留在屏幕上**。
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [dragFrom, node.id]);

  /**
   * 写回某一行的配图。
   *
   * ★ 2026-10-05：抽出来是因为**同一件事现在有两个调用点**（图标按钮换图 / 缩略图旁边的
   * 「移除图片」），两处各写一遍 map+commit 就是本仓最防的那种分叉。
   * `undefined` = 移除（写回时把键删掉，与 `OptionImageButton` 原来的写法逐字一致）。
   */
  const setOptionImage = (index: number, imageUrl?: string) => {
    commit(options.map((item, itemIndex) => (
      itemIndex === index ? { ...item, ...(imageUrl ? { imageUrl } : { imageUrl: undefined }) } : item
    )), correctKeys);
  };

  return (
    <>
      <div className="worksheet-editor-options">
        {/*
          ★ 2026-10-05（教师）：「答案选择的上面要有提示文字」。
          ⇒ 答案那一列现在是**光秃秃一个圆点**（原来盒子里还写着字母），不说明白没人知道点它是干嘛。
          🔴 表头**只画右边那三个槽**：左边（把手 / 字母 / 选项文字）宽度随内容变，
             而右边三个盒是**定宽 28px** ⇒ 用一条 `flex: 1` 的空白把它们顶到与行内同一列，
             不依赖左边任何宽度。这也是为什么「移除图片」必须从这一簇里搬走
             （它一出现，那一行的尾巴就宽 42px，整列立刻对不齐）。
        */}
        {showAnswer && (
          <div className="worksheet-editor-options-head" aria-hidden="true">
            <span className="worksheet-editor-options-head-gap" />
            <span className="worksheet-editor-options-head-slot">
              <span className="worksheet-editor-options-head-label">正确答案</span>
            </span>
            <span className="worksheet-editor-options-head-slot" />
            <span className="worksheet-editor-options-head-slot" />
          </div>
        )}
        {options.map((option, optionIndex) => (
          <div className="worksheet-editor-option" key={option.key} data-option-row={node.id}>
            <button
              type="button"
              className="worksheet-editor-option-drag"
              onPointerDown={event => startDrag(event, optionIndex)}
              aria-label={`拖动选项 ${option.key} 调整顺序`}
              title="拖动调整选项顺序"
            >⠿</button>
            {/*
              ★ 2026-10-05（教师）：「答案的设置统一移动到最右侧」。
              ⇒ 这一行原来是 [把手][●A][选项文字][配图][删除]：**答案那个圆点在行首**，
                而其它题型的答案设置都在右边（归类题 `[输入框][归属下拉][删除]`、
                连线题右侧那一列、排序题右侧的「正确顺序」）⇒ 只有选项行是反的。
              ⇒ 现在：[把手][A][选项文字][答案][配图][删除]。
                · 字母**留在行首**：它是行标、不是答案设置；而且关掉自动评分时它必须还在
                  （「四个选项长得一模一样，教师在『正确答案是 B』里找不到 B」）。
                · 答案只留控件本身（原来那个盒子里还塞着字母），选中时整块亮起来（`.is-on`）——
                  教师扫一行时不必去认那个小圆点里点没点。
              ⚠️ 选中态用 **React 算出来的 `is-on`**，不是 `:has(input:checked)`：
                `:has(` 在 `globals.css` 里被 Safari 15 兼容闸门列为**禁用标记**
                （`check-classroom-browser-compat.mjs` 的 `HARD_TOKENS`），而那个门禁管的是
                **文件**不是页面 —— 编辑页的样式同样写在 `globals.css` 里。
            */}
            <span className="worksheet-editor-option-correct is-readonly">{option.key}</span>
            <div className="worksheet-editor-option-content">
              <input
                className="input"
                value={option.text}
                placeholder={`选项 ${option.key}`}
                // 粘贴去格式（`onPaste` 接管 + `onBlur` 再收一次）。⚠️ 打字那条路 `onChange` 没动。
                onPaste={event => pasteOptionText(optionIndex, event)}
                onBlur={event => flushOptionText(optionIndex, event.target.value)}
                onChange={event => commitOptionText(optionIndex, event.target.value)}
              />
              {option.imageUrl && (
                /* ★ 2026-10-05：「移除图片」原来挤在右边那三个小盒中间。它一出现，
                   那一行的**尾巴就宽了约 42px** ⇒ 这一行的答案圆点比同题其它行靠左，
                   「答案列」不成一条线（上面那个表头更对不齐）。
                   挪到缩略图旁边 —— 与「评分标准图片」那一块同一套做法（预览 + 操作按钮并排）。 */
                <div className="worksheet-editor-option-image-preview">
                  <img src={worksheetAssetUrl(option.imageUrl)} alt={`选项 ${option.key} 配图预览`} />
                  <button
                    type="button"
                    className="btn btn-secondary"
                    title={`移除选项 ${option.key} 的图片`}
                    onClick={() => setOptionImage(optionIndex, undefined)}
                  >
                    移除图片
                  </button>
                </div>
              )}
            </div>
            {showAnswer && (
              <label
                className={`worksheet-editor-option-answer${correctKeys.includes(option.key) ? ' is-on' : ''}`}
                title={multiple ? '勾选为正确答案（可以选多个）' : '选为正确答案'}
              >
                <input
                  // ⚠️ 多选是勾选框、单选是圆点。`name` 必须带 `node.id`：同卷多题如果共用名字，
                  // 第 1 题的选择会把第 2 题的顶掉（学生端 `worksheet-panel.tsx` 上有一条同源的注释）。
                  type={multiple ? 'checkbox' : 'radio'}
                  name={`correct-${node.id}`}
                  checked={correctKeys.includes(option.key)}
                  aria-label={`把选项 ${option.key} 设为正确答案`}
                  onChange={() => {
                    if (!multiple) {
                      commit(options, [option.key]);
                      return;
                    }
                    // 多选：勾上就加、取消就减（顺序按点击次序，服务端只把它当一个集合读）。
                    const next = correctKeys.includes(option.key)
                      ? correctKeys.filter((key) => key !== option.key)
                      : [...correctKeys, option.key];
                    commit(options, next);
                  }}
                />
              </label>
            )}
            <OptionImageButton
              optionKey={option.key}
              hasImage={Boolean(option.imageUrl)}
              onChange={(imageUrl) => setOptionImage(optionIndex, imageUrl)}
            />
            <button
              type="button"
              className="worksheet-editor-icon-button is-danger"
              disabled={options.length <= 2}
              title={options.length <= 2 ? '至少要保留两个选项' : '删除这个选项'}
              aria-label={`删除选项 ${option.key}`}
              onClick={() => commit(options.filter((_, itemIndex) => itemIndex !== optionIndex), correctKeys)}
            >
              <TrashIcon />
            </button>
          </div>
        ))}
      </div>

      <div className="worksheet-editor-choice-actions">
        <button
          type="button"
          className="btn btn-secondary"
          disabled={options.length >= MAX_OPTIONS}
          title={options.length >= MAX_OPTIONS ? `选项最多 ${MAX_OPTIONS} 个（A–Z）` : '再加一个选项'}
          onClick={() => commit([...options, { key: optionKey(options.length), text: '' }], correctKeys)}
        >
          ＋ 添加选项
        </button>
        {options.length === 0 && (
          <span className="worksheet-editor-choice-warning" role="status">
            <strong>需要补充选项</strong>
            这道题还没有选项。请至少添加两个选项，再设置正确答案。
          </span>
        )}
        {options.length > 0 && (multiple ? correctKeys.length === 0 : correctKeys.length !== 1) && (
          // ★ 2026-10-06：「点选项右侧的圆点 / 方框」这件事由卡片顶部那句块提示讲一次
          //（`question-card.tsx` 的「正确答案点选项右侧的圆点。」）—— 警告条只说结论。
          <span className="worksheet-editor-choice-warning" role="status">
            <strong>尚未设置正确答案</strong>
          </span>
        )}
      </div>

      {/* ★ 2026-09-27：**落点那条线**（不是整块高亮 —— 高亮会盖住行本身，而教师要看的是
          「插到哪两行之间」）。`position: fixed` + 指针量出来的坐标，与题目拖动共用同一个类。 */}
      {dragFrom !== null && dropLine && (
        <div
          className="worksheet-editor-drop-line"
          style={{ top: dropLine.y, left: dropLine.left, width: dropLine.width }}
        />
      )}
    </>
  );
}

function OptionImageButton({ optionKey, hasImage, onChange }: {
  optionKey: string;
  hasImage: boolean;
  onChange: (imageUrl?: string) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const upload = async (file: File) => {
    setUploading(true);
    setError('');
    try {
      const result = await api.uploadWorksheetImage(file);
      onChange(result.url);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : '上传失败');
    } finally {
      setUploading(false);
    }
  };
  return (
    <div className="worksheet-editor-option-image-action">
      <label title={hasImage ? `更换选项 ${optionKey} 的图片` : `给选项 ${optionKey} 添加图片`}>
        <input type="file" accept="image/png,image/jpeg,image/webp" disabled={uploading} onChange={event => {
          const file = event.target.files?.[0];
          if (file) void upload(file);
          event.target.value = '';
        }} />
        {/* ★ 2026-09-26（教师：「用图标」）：原来这里是「配图 / 换图」两个字的按钮，
            在一行四个控件里显得又长又抢眼。换成一个小图标（挂在 `title` 上的说明没变，
            读屏与悬停都还读得到「给选项 X 添加图片」）。
            ⚠️ `stroke="currentColor"`：它的颜色要跟着按钮的 `color` 走（hover / disabled 都算）。 */}
        {uploading ? '…' : (
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
            <rect x="1.6" y="2.6" width="12.8" height="10.8" rx="2" fill="none" stroke="currentColor" strokeWidth="1.4" />
            <circle cx="5.6" cy="6.3" r="1.25" fill="currentColor" />
            <path d="M2.6 12.2l3.5-3.5 2.3 2.3 1.9-1.9 3.1 3.1" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </label>
      {error && <span role="alert">{error}</span>}
    </div>
  );
}
