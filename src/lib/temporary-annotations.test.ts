import test from 'node:test';import assert from 'node:assert/strict';
import {annotationHit,annotationPath,imageAnnotationPoint,type AnnotationStroke} from './temporary-annotations.ts';
const stroke:AnnotationStroke={id:1,tool:'pen',color:'red',width:4,points:[{x:0,y:0},{x:100,y:0}]};
test('整笔擦除命中线段而非只有端点，笔宽和容差生效',()=>{
 assert.equal(annotationHit(stroke,{x:50,y:5}),true);
 assert.equal(annotationHit(stroke,{x:50,y:30}),false);
 assert.equal(annotationHit({...stroke,width:28},{x:50,y:20}),true);
 assert.equal(annotationHit({...stroke,points:[{x:10,y:10}]},{x:10,y:12}),true);
});
test('单点可见，线段路径保留各点坐标',()=>{
 assert.equal(annotationPath([]),'');assert.equal(annotationPath([{x:10,y:10}]),'M 10 10 l 0.01 0');
 assert.equal(annotationPath(stroke.points),'M 0 0 L 100 0');
});

test('图片坐标逆变换在缩放、平移和四个旋转方向下保持对齐',()=>{
 for(const zoom of [.3,1,2,15]) for(const angle of [0,90,180,270]) {
  const point={x:125,y:-70}, centre={x:843,y:390}, radians=angle*Math.PI/180;
  const screen={x:centre.x+zoom*(point.x*Math.cos(radians)-point.y*Math.sin(radians)),y:centre.y+zoom*(point.x*Math.sin(radians)+point.y*Math.cos(radians))};
  const restored=imageAnnotationPoint(screen,centre,zoom,angle);
  assert.ok(Math.abs(restored.x-point.x)<1e-9);assert.ok(Math.abs(restored.y-point.y)<1e-9);
 }
});
