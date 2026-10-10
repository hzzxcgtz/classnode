import test from 'node:test';
import assert from 'node:assert/strict';
import { mathBackgroundPatch, mathBackgroundSource } from './worksheet-drawing-background-choice.ts';
import { readDrawingBackground } from './worksheet-drawing.ts';
import { readDrawingStarter } from './worksheet-drawing-starter.ts';
import type { WorksheetQuestionNode } from './types.ts';

function question(data: Record<string, unknown>): WorksheetQuestionNode {
  return { id: 'drawing', type: 'drawing', inputMode: 'handwriting', prompt: '', data: { drawingTool: 'math', ...data }, children: [] };
}

test('switching from uploaded image to teacher drawing clears the image and creates a math starter', () => {
  const node = question({ drawingBackgroundPreset: 'custom', drawingBackgroundImageUrl: '/uploads/chat/chat-abcd.png' });
  assert.equal(mathBackgroundSource(node), 'upload');
  const next = question({ ...node.data, ...mathBackgroundPatch(node, 'draw') });
  assert.equal(mathBackgroundSource(next), 'draw');
  assert.equal(readDrawingStarter(next)?.tool, 'math');
  assert.notEqual(readDrawingBackground(next).preset, 'custom');
});

test('switching to upload removes the teacher drawing, and selecting drawing again preserves existing objects', () => {
  const drawingStarter = { tool: 'math', data: { objects: [{ id: 'teacher-line', type: 'line' }] } };
  const node = question({ drawingStarter });
  assert.equal(mathBackgroundSource(node), 'draw');
  assert.deepEqual(mathBackgroundPatch(node, 'draw').drawingStarter, drawingStarter);
  const next = question({ ...node.data, ...mathBackgroundPatch(node, 'upload') });
  assert.equal(readDrawingStarter(next), null);
  assert.equal(mathBackgroundSource(next), 'upload');
});

test('historical combined backgrounds become exclusive when either source is selected', () => {
  const node = question({ drawingStarter: { tool: 'math', data: {} }, drawingBackgroundPreset: 'custom', drawingBackgroundImageUrl: '/uploads/chat/chat-1234.png' });
  const drawn = question({ ...node.data, ...mathBackgroundPatch(node, 'draw') });
  assert.notEqual(readDrawingBackground(drawn).preset, 'custom');
  const uploaded = question({ ...node.data, ...mathBackgroundPatch(node, 'upload') });
  assert.equal(readDrawingStarter(uploaded), null);
  assert.equal(readDrawingBackground(uploaded).url, '/uploads/chat/chat-1234.png');
});
