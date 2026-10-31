'use client';
import { imageWheelZoomChange } from '@/lib/image-wheel-zoom';
import { useEffect, useRef, useState } from 'react';
import { useImageRotation } from '@/components/use-image-rotation';
import { ImageRotationControls } from '@/components/image-rotation-controls';
import { worksheetAssetUrl } from '@/lib/worksheet-presentation';
import { TaskAnnotationSurface, type TaskDrawingTools } from './task-annotation-surface';
export function TaskImage({url,active,tools,onFoundMarks}:{url:string;active:boolean;tools:TaskDrawingTools;onFoundMarks:()=>void}) {
 const rotation=useImageRotation(worksheetAssetUrl(url));
 const [zoom,setZoom]=useState(1);const [offset,setOffset]=useState({x:0,y:0});const [width,setWidth]=useState(1000);
 const img=useRef<HTMLImageElement>(null);const stage=useRef<HTMLDivElement>(null);const pan=useRef<{x:number;y:number;ox:number;oy:number}|null>(null);
 const scale=(change:number)=>setZoom(value=>Math.max(.3,Math.min(15,value+change)));
 useEffect(()=>{if(!img.current)return;const element=img.current;const measure=()=>setWidth(element.clientWidth||1000);const observer=new ResizeObserver(measure);observer.observe(element);measure();return()=>observer.disconnect();},[]);
 useEffect(()=>{const element=stage.current;if(!element)return;const wheel=(event:WheelEvent)=>{event.preventDefault();scale(imageWheelZoomChange(event.deltaY,event.deltaMode));};element.addEventListener('wheel',wheel,{passive:false});return()=>element.removeEventListener('wheel',wheel);},[]);
 return <div style={{height:'100%',display:'flex',flexDirection:'column',minHeight:0}}>
 <div data-task-image ref={stage} style={{flex:1,minHeight:120,position:'relative',overflow:'hidden',background:'#f5f8fb',borderRadius:8}}>
 <TaskAnnotationSurface target={url.split('?')[0]} active={active} tools={tools} textSize={24} onFoundMarks={onFoundMarks} onRestore={()=>{}} imageView={{zoom,offset,angle:rotation.angle,coordinateScale:width/1000,onZoom:scale,onPan:setOffset,onFit:()=>{setZoom(1);setOffset({x:0,y:0});}}}>
 <div style={{width:'100%',height:'100%',display:'flex',alignItems:'center',justifyContent:'center',touchAction:'none',cursor:'grab'}} onPointerDown={event=>{if(active)return;event.currentTarget.setPointerCapture(event.pointerId);pan.current={x:event.clientX,y:event.clientY,ox:offset.x,oy:offset.y};}} onPointerMove={event=>{if(pan.current)setOffset({x:pan.current.ox+event.clientX-pan.current.x,y:pan.current.oy+event.clientY-pan.current.y});}} onPointerUp={()=>{pan.current=null;}} onPointerCancel={()=>{pan.current=null;}}>
 <img ref={img} src={rotation.source} alt="学生作答图片" draggable={false} style={{width:'auto',height:'auto',maxWidth:'100%',maxHeight:'100%',objectFit:'contain',transform:`translate(${offset.x}px,${offset.y}px) scale(${zoom}) rotate(${rotation.angle}deg)`}}/>
 </div></TaskAnnotationSurface></div>
 <div data-task-image-controls style={{display:'flex',flexWrap:'wrap',alignItems:'center',justifyContent:'center',gap:8,paddingTop:10,fontSize:13}}>
 <button onClick={()=>scale(-.2)} aria-label="缩小图片">−</button><input type="range" aria-label="图片缩放" min={30} max={1500} step={10} value={Math.round(zoom*100)} onChange={e=>setZoom(Number(e.target.value)/100)}/><output>{Math.round(zoom*100)}%</output><button onClick={()=>scale(.2)} aria-label="放大图片">＋</button><button onClick={()=>{setZoom(1);setOffset({x:0,y:0});}}>适应窗口</button>{!active&&<ImageRotationControls rotation={rotation}/>}
 </div></div>;
}
