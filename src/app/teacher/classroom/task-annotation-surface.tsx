'use client';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useAnnotationStorage } from './annotation-storage';
import { TemporaryAnnotations, type AnnotationImageView, type Tool } from './temporary-annotations';
import type { AnnotationFrame } from '@/lib/image-annotation-session';
export type TaskDrawingTools = {tool:Tool;color:string;width:number;visible:boolean;moving:boolean;clear:number};
export function TaskAnnotationSurface({ target, active, tools, imageView, textSize, onRestore, onFoundMarks, children }: {
 target:string; active:boolean; tools:TaskDrawingTools; imageView?:AnnotationImageView; textSize:number; onRestore:(size:number)=>void; onFoundMarks?:()=>void; children:ReactNode;
}) {
 const {session,state}=useAnnotationStorage(target);
 const host=useRef<HTMLDivElement>(null);
 const content=useRef<HTMLDivElement>(null);
 const restore=useRef(onRestore);restore.current=onRestore;
 const found=useRef(onFoundMarks);found.current=onFoundMarks;
 const restored=useRef(false);
 useLayoutEffect(()=>{if(state.ready&&!restored.current){restored.current=true;if(state.document?.strokes.length)found.current?.();}},[state.ready,state.document]);
 const [frame,setFrame]=useState<AnnotationFrame|null>(null);
 const [size,setSize]=useState({width:1,height:1});
 useLayoutEffect(()=>{const element=host.current;if(!element)return;const measure=()=>setSize({width:element.clientWidth,height:element.clientHeight});measure();const observer=new ResizeObserver(measure);observer.observe(element);return()=>observer.disconnect();},[]);
 useLayoutEffect(()=>{if(!state.ready || imageView)return;const saved=state.document?.frame;if(saved){setFrame(saved);restore.current(saved.textSize);}},[state.ready, state.document?.frame, imageView]);
 useLayoutEffect(()=>{if(!active || imageView || !host.current)return;setFrame(previous=>previous ?? {width:host.current!.clientWidth,height:host.current!.clientHeight,textSize,scroll:[...(content.current?.querySelectorAll<HTMLElement>('*') ?? [])].map(element=>({top:element.scrollTop,left:element.scrollLeft}))});},[active,imageView,textSize]);
 useLayoutEffect(()=>{if(!active||!frame)return;restore.current(frame.textSize);content.current?.querySelectorAll<HTMLElement>('*').forEach((element,index)=>{element.scrollTop=frame.scroll[index]?.top??0;element.scrollLeft=frame.scroll[index]?.left??0;});},[active,frame]);
 return <div ref={host} style={{position:'relative',height:'100%',width:'100%',minHeight:0,overflow:'hidden'}} onWheelCapture={event=>{if(active&&!imageView) {event.preventDefault();event.stopPropagation();}}}>
  <div ref={content} style={active&&frame&&!imageView?{position:'absolute',width:frame.width,height:frame.height,transformOrigin:'top left',transform:`scale(${size.width/frame.width},${size.height/frame.height})`,pointerEvents:'none'}:{height:'100%',minHeight:0}}>{children}</div>
  {state.error && <span role="alert" style={{position:'absolute',bottom:0,background:'#fff',color:'#a22',zIndex:5}}>批注保存异常：{state.error}<button onClick={()=>void (state.ready?session?.save():session?.load())}>重试</button></span>}
  {active&&state.ready&&!state.conflict&&<TemporaryAnnotations key={session?.cacheKey??target} toolbarHost={null} hideToolbar shared={tools} annotationKey={session?.cacheKey??target} imageView={imageView} frame={!imageView?frame??undefined:undefined} onChange={strokes=>session?.update({version:1,kind:imageView?'image':'text',strokes,...(!imageView&&frame?{frame}:{})})}/>}
 </div>;
}
