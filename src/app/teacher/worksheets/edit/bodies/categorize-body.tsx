'use client';

import type { WorksheetQuestionNode } from '@/lib/types';
import { TrashIcon } from '../editor-icons';
import {
  categorizeAddItem,
  categorizeAddZone,
  categorizeRemoveItem,
  categorizeRemoveZone,
  placementSet,
  readCategorize,
  renameEntryAt,
  writeCategorize,
  type CategorizeData,
} from '../worksheet-editor-core';

/** 框的名字（没写时也要能选、能读，所以给一句看得出是哪一个的话）。 */
function zoneLabel(text: string, index: number): string {
  return text.trim() || `框 ${index + 1}（还没写名字）`;
}

/**
 * 归类题：条目列表 + 框列表 + **每个条目一个「归到哪个框」的下拉**（brief Step 2）。
 *
 * 🔴 **答案是每个条目的归属**（`data.placement`，键是条目 id、值是这个框的 id）——
 * 条目在屏幕上的**先后顺序与答案无关**，服务端判分只读 `placement`。
 *
 * 🔴 **id 是学生作答值里的键**（`assignment: Record<itemId, zoneId>`，规格 §12）：
 * 改文字不碰 id（`renameEntryAt` 只换 `text`）；**永远不要用下标代替它**。
 *
 * ⚠️ 教师侧的 `placement` 与学生的 `assignment` **刻意不同名**（§12 的裁定）：
 * 撞名会让「学生归类答对了」被「响应不得含答案键」的扫描读成「答案泄漏」。
 *
 * 🔴 **删一个框会把它名下的归属一起清掉**（`categorizeRemoveZone`）：留着那些指向
 * 不存在的框的键，服务端会拒绝**整道题**（「每个条目都必须落到一个框里」），
 * 而教师看到的只是某个条目还显示着「已归到框二」。清掉之后它回到「请选择」。
 */
export function CategorizeBody({ node, onDataChange, showAnswer = true }: {
  node: WorksheetQuestionNode;
  onDataChange: (patch: Record<string, unknown>) => void;
  /** 关掉「允许自动评分」时为 `false` ⇒ 答案控件不渲染（题面照常）。 */
  showAnswer?: boolean;
}) {
  const categorize = readCategorize(node);
  const { items, zones, placement } = categorize;
  /** 三个键一起写（条目 + 框 + `placement`）—— 见内核里那一节的纪律 1。 */
  const commit = (next: CategorizeData) => onDataChange(writeCategorize(next.items, next.zones, next.placement));

  const unplaced = items.filter(entry => !placement[entry.id]).length;

  return (
    <>
      <div className="worksheet-editor-block">
        <span className="worksheet-editor-block-label">分类框</span>
        <div className="worksheet-editor-options">
          {zones.map((zone, index) => (
            // key 用下标：条目缺 id 时写回会补一个（见 `writeEntries`），用 id 当 key
            // 会让输入框在补 id 的那一刻被重挂载（焦点丢失）。
            <div className="worksheet-editor-option" key={index}>
              <input
                className="input"
                value={zone.text}
                placeholder={`框 ${index + 1}`}
                onChange={event => commit({ ...categorize, zones: renameEntryAt(zones, index, event.target.value) })}
              />
              <button
                type="button"
                className="worksheet-editor-icon-button is-danger"
                disabled={zones.length <= 2}
                title={zones.length <= 2 ? '归类题至少要有两个框' : '删除这个框（它名下的条目会回到「请选择」）'}
                aria-label={`删除${zoneLabel(zone.text, index)}`}
                onClick={() => commit(categorizeRemoveZone(categorize, index))}
              >
                <TrashIcon />
              </button>
            </div>
          ))}
        </div>
        <div className="worksheet-editor-inline-actions">
          <button type="button" className="btn btn-secondary" onClick={() => commit(categorizeAddZone(categorize, ''))}>
            ＋ 添加一个框
          </button>
        </div>
      </div>

      <div className="worksheet-editor-block">
        <span className="worksheet-editor-block-label">条目与归属</span>
        <div className="worksheet-editor-options">
          {items.map((entry, index) => {
            const zoneId = placement[entry.id] ?? '';
            const zoneExists = zones.some(zone => zone.id === zoneId);
            return (
              <div className="worksheet-editor-option" key={index}>
                <input
                  className="input"
                  value={entry.text}
                  placeholder={`条目 ${index + 1}`}
                  onChange={event => commit({ ...categorize, items: renameEntryAt(items, index, event.target.value) })}
                />
                {showAnswer && (<>
<select
                  className="input worksheet-editor-pair-select"
                  value={zoneId}
                  aria-label={`「${entry.text.trim() || `条目 ${index + 1}`}」归到哪个框`}
                  onChange={event => commit({ ...categorize, placement: placementSet(placement, entry.id, event.target.value) })}
                >
                  {/* 🔴 这些是**原生 `<option>`**，它只能装纯文本 ⇒ 下面那个框名里的
                      数学公式（`$x^2$`）**在这里渲染不出来**（会显示源码）。
                      这是**物理上限**，不是漏改：2026-09-30 那次「凡教师能打字处都支持」
                      有一条边界，见 `specs/2026-09-30-题干-数学公式.md` 的「明确不做」。
                      ⚠️ 要让它也渲染，得把这个下拉整个自绘掉 —— 成本远超收益，
                      而且它只是一个**选择器**，不是题面。 */}
                  <option value="">请选择</option>
                  {zones.map((zone, zoneIndex) => (
                    <option key={zone.id} value={zone.id}>{zoneLabel(zone.text, zoneIndex)}</option>
                  ))}
                  {zoneId && !zoneExists ? (
                    // 归属指向一个已经被删掉的框（手工改过的行才会出现）：显式画出来，
                    // 免得下拉显示成「请选择」而 `placement` 里其实还留着一条 —— 屏幕与数据必须一致。
                    <option value={zoneId}>（原来的框已经不在了）</option>
                  ) : null}
                </select>
                </>)}
                <button
                  type="button"
                  className="worksheet-editor-icon-button is-danger"
                  disabled={items.length <= 1}
                  title={items.length <= 1 ? '至少要有一个条目' : '删除这个条目'}
                  aria-label={`删除条目 ${entry.text.trim() || index + 1}`}
                  onClick={() => commit(categorizeRemoveItem(categorize, index))}
                >
                  <TrashIcon />
                </button>
              </div>
            );
          })}
        </div>
        <div className="worksheet-editor-inline-actions">
          <button type="button" className="btn btn-secondary" onClick={() => commit(categorizeAddItem(categorize, ''))}>
            ＋ 添加条目
          </button>
        </div>
      </div>

      {(unplaced > 0 || zones.length < 2) && (
        <p className="worksheet-editor-warn-hint">
          {unplaced > 0 ? `还有 ${unplaced} 个条目没有归属。` : ''}
          {zones.length < 2 ? ' 归类题至少需要两个分类框。' : ''}
        </p>
      )}
    </>
  );
}
