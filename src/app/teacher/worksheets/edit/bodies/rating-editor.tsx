'use client';
import { EDITOR_CLOUD_HELP, EDITOR_CLOUD_PLACEHOLDER } from '../worksheet-editor-copy';
import { WorksheetFieldTag } from '@/components/worksheet-field-tag';
import { useEffect, useState } from 'react';
import { IconPlus, IconTrash } from '@tabler/icons-react';
import type { WorksheetQuestionNode } from '@/lib/types';
import { ratingConfig, ratingDimensionRows, ratingDimensionName, RATING_DIMENSION_LIMIT, type RatingConfig } from '@/lib/worksheet-rating';
import { normalizeRewardStyle, type RewardStyle } from '@/lib/worksheet-reward';
import { newItemId } from '../worksheet-editor-core';
import { RatingTextEditor } from './rating-text-editor';
import { RewardIcon } from '@/components/worksheet-reward-icon';
import styles from './rating-editor.module.css';

export function RatingEditor({ node, rewardStyle, onDataChange }: {
  node: WorksheetQuestionNode;
  rewardStyle?: RewardStyle;
  onDataChange: (patch: Record<string, unknown>) => void;
}) {
  const config = ratingConfig(node.data);
  const style = normalizeRewardStyle(rewardStyle);
  const [activeId, setActiveId] = useState(config.dimensions[0]?.id ?? '');
  const [toolbarTarget, setToolbarTarget] = useState<HTMLDivElement | null>(null);
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const query = window.matchMedia('(max-width: 600px)');
    const update = () => setMobile(query.matches);
    update(); query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  const rows = ratingDimensionRows(config);
  const active = rows.find(d => d.id === activeId) ?? rows[0];
  const numbering = new Map<string, string>();
  const siblingCounts = new Map<string, number>();
  for (const row of rows) {
    const parent = row.parentId ?? '';
    const index = (siblingCounts.get(parent) ?? 0) + 1;
    siblingCounts.set(parent, index);
    numbering.set(row.id, row.parentId ? `${numbering.get(row.parentId)}.${index}` : String(index));
  }
  const editingLabel = active ? `正在编辑：${ratingDimensionName(active.text, `维度 ${numbering.get(active.id)}`)}` : '请选择评价维度';
  const [minimumDraft, setMinimumDraft] = useState<string | null>(null);
  function change(patch: Partial<RatingConfig>) {
    onDataChange({ rating: { ...config, ...patch }, evaluationVersion: 1, evaluationMode: 'collect', evaluationScored: false, aiScoringEnabled: false, studentAiReviewEnabled: false });
  }
  return <div className={styles.editor}>
    <section className={styles.section} aria-label="评价设置">
      <div className={styles.heading}><h4>评价设置</h4><span>使用学习单图标</span></div>
      <div className={styles.scale}>
        <label className={styles.scaleControl}>评价上限
          <span className={styles.scaleInput}>
            <select className="input" aria-label="评价上限" value={config.maxStars} onChange={event => change({ maxStars: Number(event.target.value) })}>
              {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
            <RewardIcon kind={style} state="earned" size={26} />
          </span>
        </label>

      </div>
      <div className={styles.dimensionHeading}>
        <h4>评价维度 <span>{rows.filter(d => d.isLeaf).length} 项{rows.some(d => !d.isLeaf) && ` · ${rows.filter(d => !d.isLeaf).length} 个分组`}</span></h4>
        <button type="button" className={`btn btn-secondary ${styles.add}`} disabled={config.dimensions.length >= RATING_DIMENSION_LIMIT}
          onClick={() => change({ dimensions: [...config.dimensions, { id: newItemId(), text: '' }] })}>
          <IconPlus size={16} aria-hidden="true" />添加维度
        </button>
      </div>
      <p className={styles.treeHint}>最多三级；有子维度的项目仅作分组，只评价末级维度。</p>
      {!mobile && <div className={styles.sharedToolbar}>
        <span className={styles.editingLabel} title={editingLabel}>{editingLabel}</span>
        <div className="worksheet-editor-basic-format" ref={setToolbarTarget} />
      </div>}
      <div className={styles.dimensions}>
        {rows.map((dimension, i) => <div className={styles.row} key={dimension.id} data-active={active?.id === dimension.id} data-group={!dimension.isLeaf} style={{ marginLeft: dimension.depth * (mobile ? 12 : 20) }}>
          <span className={styles.number}>{numbering.get(dimension.id)}</span>
          <div className={styles.dimensionInput}>
            {mobile && active?.id === dimension.id && <div className={styles.mobileToolbar}>
              <span className={styles.editingLabel} title={editingLabel}>{editingLabel}</span>
              <div className="worksheet-editor-basic-format" ref={setToolbarTarget} />
            </div>}
            <RatingTextEditor toolbarTarget={active?.id === dimension.id ? toolbarTarget : null} onEditingFocus={() => setActiveId(dimension.id)} id={`${node.id}_${dimension.id}`} label={`评价维度 ${i + 1}`} text={dimension.text} runs={dimension.runs} limit={100}
            onChange={(text, runs) => change({ dimensions: config.dimensions.map(d => d.id === dimension.id ? { ...d, text, runs } : d) })} /></div>
          <div className={styles.rowActions}>
          {dimension.depth < 2 && <button type="button" className={`btn btn-secondary ${styles.add}`} disabled={config.dimensions.length >= RATING_DIMENSION_LIMIT}
            onClick={() => change({ dimensions: [...config.dimensions, { id: newItemId(), text: '', parentId: dimension.id }] })}>添加子维度</button>}
          <button type="button" className={`btn btn-secondary ${styles.remove}`} disabled={config.dimensions.length <= 1 || !dimension.isLeaf}
            title={dimension.isLeaf ? `删除评价维度 ${i + 1}` : '请先删除子维度，再删除分组'} aria-label={`删除评价维度 ${i + 1}`} onClick={() => change({ dimensions: config.dimensions.filter(d => d.id !== dimension.id) })}>
            <IconTrash size={17} aria-hidden="true" />
          </button>
          </div>
        </div>)}
      </div>
    </section>
    <section className={styles.section} aria-label="文字感想设置">
      <div className={styles.heading}>
        <div><h4>文字感想</h4><p>开启后需填写文字感想才能提交。</p></div>
        <label className="worksheet-editor-drawing-switch">
          <input type="checkbox" role="switch" aria-label="收集文字感想" checked={config.commentEnabled} onChange={event => change({ commentEnabled: event.target.checked })} />
        </label>
      </div>
      {config.commentEnabled && <div className={styles.commentSettings}>
        <div className={styles.commentRow}>
          <div className={styles.field}>文字提示<WorksheetFieldTag optional />
            <div className={styles.promptEditor}><RatingTextEditor id={`${node.id}_comment_prompt`} label="文字提示" text={config.commentPrompt} runs={config.commentPromptRuns} limit={500}
              onChange={(text, runs) => change({ commentPrompt: text, commentPromptRuns: runs })} /></div>
          </div>
          <label className={`${styles.field} ${styles.minimum}`}>最少字数
            <span className={styles.minimumInput}>
              <input className="input" type="number" min={1} max={10000} step={1} aria-label="文字感想最少字数"
                value={minimumDraft ?? config.minCommentLength}
                onChange={event => {
                  const raw = event.target.value;
                  setMinimumDraft(raw);
                  const length = Number(raw);
                  if (raw && Number.isInteger(length) && length >= 1 && length <= 10000) change({ minCommentLength: length });
                }} onBlur={() => setMinimumDraft(null)} />
              <span>字</span>
            </span>
          </label>
        </div>
        <label className={styles.field}>观点提炼要求<WorksheetFieldTag optional /><span className={styles.help}>{EDITOR_CLOUD_HELP}</span>
          <textarea className={`input ${styles.cloudRequirements}`} rows={7} maxLength={1200} value={typeof node.data.wordCloudRequirements === 'string' ? node.data.wordCloudRequirements : ''}
            placeholder={EDITOR_CLOUD_PLACEHOLDER}
            onChange={event => onDataChange({ wordCloudRequirements: event.target.value })} />
        </label>
      </div>}
    </section>
  </div>;
}
