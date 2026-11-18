import { test } from 'node:test';
import assert from 'node:assert/strict';
import {canvasColorOpacity, canvasColorWithOpacity, canvasChoiceFill, canvasWidgetStyle, canvasRecordingStyle, readImageCanvas} from './worksheet-image-canvas.ts';

test('底色透明度保存往返，普通控件和录音使用相同颜色，不影响文字和框色', () => {
  for (const opacity of [0,25,50,75,100]) {
    const color=canvasColorWithOpacity('#ff0000',opacity);
    const canvas=readImageCanvas({url:'/uploads/chat/chat-abcdef.png',width:960,height:1280,widgets:[{
      id:'one',kind:'answer',mode:'keyboard',label:'填写',detail:'',x:10,y:10,width:30,height:20,
      backgroundColor:color,borderColor:'#0000ff',textColor:'#000000',
    }]});
    assert.ok(canvas);
    const widget=canvas.widgets[0];
    assert.equal(widget.backgroundColor,color);
    assert.equal(canvasColorOpacity(color),opacity);
    assert.equal(canvasWidgetStyle(widget).backgroundColor,color);
    assert.equal(canvasRecordingStyle(widget)['--canvas-voice-background' as keyof ReturnType<typeof canvasRecordingStyle>],color);
    assert.equal(widget.borderColor,'#0000ff');assert.equal(widget.textColor,'#000000');
  }
});

test('拖拽文字背景保留旧版默认半透明，显式透明度不再追加 alpha', () => {
  assert.equal(canvasChoiceFill({id:'one',color:'#ff0000'}),'#ff0000b3');
  assert.equal(canvasChoiceFill({id:'one',color:'#ff000080'}),'#ff000080');
  assert.equal(canvasChoiceFill({id:'one',color:'transparent'}),'transparent');
  assert.equal(canvasColorWithOpacity('transparent',100),'#ffffffff');
});
