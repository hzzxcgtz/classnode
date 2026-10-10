'use client';

import type { WorksheetQuestionNode } from '@/lib/types';
import { PromptText } from '@/lib/worksheet-prompt-text';
import { readPromptImage, readPromptRunsFor, worksheetAssetUrl } from '@/lib/worksheet-presentation';
import { readOptions, readOrderItems, readMatchLeft, readMatchRight, readCategorizeItems, readCategorizeZones, questionTypeLabel, TRUE_FALSE_OPTIONS } from '@/lib/worksheet-questions';
import { fillSettingsFor, sharedPoolChoices } from '@/lib/worksheet-fill-modes';
import { readDrawingBackground, readDrawingTool } from '@/lib/worksheet-drawing';
import { readDrawingStarter } from '@/lib/worksheet-drawing-starter';
import { DrawingDocumentPreview } from './drawing-document-preview';
import styles from './question-content-preview.module.css';

export function QuestionContentPreview({ node }: {node:WorksheetQuestionNode}) {
  const runs = readPromptRunsFor(node);
  const image = readPromptImage(node);
  const options = node.type === 'true-false' ? TRUE_FALSE_OPTIONS : readOptions(node);
  const left = node.type === 'match' ? readMatchLeft(node) : [];
  const right = node.type === 'match' ? readMatchRight(node) : [];
  const items = node.type === 'order' ? readOrderItems(node) : node.type === 'categorize' ? readCategorizeItems(node) : [];
  const zones = node.type === 'categorize' ? readCategorizeZones(node) : [];
  const choices = node.type === 'fill-blank' || node.type === 'choice-blank' ? fillSettingsFor(node,runs) : [];
  const pool = sharedPoolChoices(node);
  const starter = readDrawingStarter(node);
  const background = node.type === 'drawing' ? readDrawingBackground(node) : null;
  const toolNames = {free:'基础绘图',math:'数学作图','mind-map':'思维导图',flowchart:'流程图'};
  return <div className={styles.preview}>
    <span className={styles.type}>{node.type === 'drawing' ? toolNames[readDrawingTool(node)] : questionTypeLabel(node.type)}</span>
    <div className={styles.prompt}><PromptText text={node.prompt} runs={runs} table={node.data.table} placeholder="题干未填写" /></div>
    {image && <img className={styles.image} src={worksheetAssetUrl(image)} alt="题干配图" />}
    {options.length>0 && ['single-choice','multi-choice','true-false'].includes(node.type) && <ul className={styles.items}>{options.map(option=><li key={option.key}><b>{option.key}</b><span><PromptText text={option.text} placeholder="" />{option.imageUrl && <img className={styles.image} src={worksheetAssetUrl(option.imageUrl)} alt={`${option.key}选项配图`} />}</span></li>)}</ul>}
    {left.length>0 && <div className={styles.match}><div><small>左侧</small>{left.map(item=><p key={item.id}><PromptText text={item.text} placeholder="" /></p>)}</div><div><small>右侧</small>{right.map(item=><p key={item.id}><PromptText text={item.text} placeholder="" /></p>)}</div></div>}
    {items.length>0 && <ul className={styles.items}>{items.map((item,index)=><li key={item.id}><b>{index+1}</b><PromptText text={item.text} placeholder="" /></li>)}</ul>}
    {zones.length>0 && <div className={styles.pool}><small>分类框</small>{zones.map(zone=><span key={zone.id}><PromptText text={zone.text} placeholder="" /></span>)}</div>}
    {choices.map((choice,index)=>choice.choices.length>0 && <div className={styles.pool} key={index}><small>第{index+1}空待选词</small>{choice.choices.map((word,i)=><span key={i}><PromptText text={word} placeholder="" /></span>)}</div>)}
    {pool.length>0 && <div className={styles.pool}><small>共用选词</small>{pool.map((word,index)=><span key={index}><PromptText text={word} placeholder="" /></span>)}</div>}
    {starter && <div className={styles.starter}><small>教师初始图</small><DrawingDocumentPreview document={starter} width={600} height={400} backgroundUrl={background?.url ?? null} /></div>}
    {!starter && background?.preset === 'custom' && background.url && <img className={styles.image} src={worksheetAssetUrl(background.url)} alt="题目绘图底图" />}
  </div>;
}
