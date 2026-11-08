'use client';
import {useLayoutEffect,useRef} from 'react';
import {cellTextRuns,type WorksheetTableCell} from '@/lib/worksheet-table';
import {atomicPromptDeletion,movePromptBlank} from '@/lib/worksheet-fill-edit';
import {removePromptRange,type PromptRun} from '@/lib/worksheet-prompt-marks';
import {renderRunsInto,promptModelText,promptOffsetAtPoint,selectedRange,caretOffset,placeSelection} from './prompt-rich-text';

type Props={cell:WorksheetTableCell;label:string;placeholder:string;onSelect:(range:{from:number;to:number})=>void;onChange:(text:string)=>void;onRichChange:(text:string,runs:PromptRun[])=>void;onBlankSelect?:(id:string)=>void;numberOf?:(id:string)=>number};
export function TableCellTextEditor({cell,label,placeholder,onSelect,onChange,onRichChange,onBlankSelect,numberOf}:Props) {
  const ref=useRef<HTMLDivElement>(null);
  const composing=useRef(false);
  const dragged=useRef<string|null>(null);
  const remember=()=>{const el=ref.current;if(!el)return;const range=selectedRange(el);const caret=caretOffset(el);if(range)onSelect(range);else if(caret!==null)onSelect({from:caret,to:caret});};
  useLayoutEffect(()=>{
    const el=ref.current;if(!el||composing.current)return;
    const runs=cellTextRuns(cell),signature=JSON.stringify(runs);
    if(promptModelText(el)!==cell.text||el.dataset.promptRuns!==signature){
      const focused=el.contains(document.activeElement),range=focused?selectedRange(el):null,caret=focused?caretOffset(el):null;
      renderRunsInto(el,cell.text,runs);
      if(range)placeSelection(el,range.from,range.to);else if(caret!==null)placeSelection(el,caret,caret);
    }
    el.querySelectorAll<HTMLElement>('[data-blank-id]').forEach(blank=>{const number=numberOf?.(blank.dataset.blankId!);if(number)blank.dataset.blankNumber=String(number);});
  },[cell,numberOf]);
  const restoreCaret=(at:number)=>requestAnimationFrame(()=>{if(ref.current)placeSelection(ref.current,at,at);});
  const insert=(text:string)=>{const el=ref.current;if(!el)return;const range=selectedRange(el);const caret=caretOffset(el)??cell.text.length;const from=range?.from??caret,to=range?.to??caret;onChange(cell.text.slice(0,from)+text+cell.text.slice(to));restoreCaret(from+text.length);};
  return <div ref={ref} className="worksheet-editor-cell-text" contentEditable suppressContentEditableWarning role="textbox" aria-multiline="true" aria-label={label} data-placeholder={placeholder} style={{textAlign:cell.align??'left'}}
    onClick={event=>{const blank=(event.target as HTMLElement).closest<HTMLElement>('[data-blank-id]');if(blank){event.stopPropagation();onBlankSelect?.(blank.dataset.blankId!);}}}
    onDragStart={event=>{event.stopPropagation();const id=(event.target as HTMLElement).closest<HTMLElement>('[data-blank-id]')?.dataset.blankId;if(!id){event.preventDefault();return;}dragged.current=id;event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('application/x-worksheet-cell-blank',id);}}
    onDragEnd={event=>{event.stopPropagation();dragged.current=null;}}
    onDragOver={event=>{event.stopPropagation();if(dragged.current){event.preventDefault();event.dataTransfer.dropEffect='move';}}}
    onDrop={event=>{event.stopPropagation();event.preventDefault();const id=dragged.current;dragged.current=null;if(!id||!ref.current)return;const at=promptOffsetAtPoint(ref.current,event.clientX,event.clientY);if(at===null)return;const moved=movePromptBlank(cell.text,cellTextRuns(cell),id,at);onRichChange(moved.text,moved.runs);onBlankSelect?.(id);}}
    onFocus={remember} onMouseUp={remember} onKeyUp={remember}
    onInput={()=>{if(ref.current&&!composing.current)onChange(promptModelText(ref.current));}}
    onCompositionStart={()=>{composing.current=true;}} onCompositionEnd={()=>{composing.current=false;if(ref.current)onChange(promptModelText(ref.current));}}
    onKeyDown={event=>{
      if(event.nativeEvent.isComposing)return;
      if(event.key==='Enter'){event.preventDefault();insert('\n');return;}
      if((event.key==='Backspace'||event.key==='Delete')&&ref.current){const range=selectedRange(ref.current),caret=caretOffset(ref.current);if(caret===null&&!range)return;const deletion=atomicPromptDeletion(cell.text,cellTextRuns(cell),range?.from??caret!,range?.to??caret!,event.key==='Backspace'?'backward':'forward');if(deletion){event.preventDefault();const next=removePromptRange(cellTextRuns(cell),cell.text,deletion.from,deletion.to);onRichChange(next.text,next.runs);restoreCaret(deletion.from);}}
    }}
    onPaste={event=>{event.preventDefault();insert(event.clipboardData.getData('text/plain'));}}/>;
}
