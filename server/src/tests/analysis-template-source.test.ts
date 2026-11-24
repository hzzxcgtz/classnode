import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readAnalysisTemplate } from '../services/analysis-template-source.js';

test('universal and legacy template IDs all return the bundled template', () => {
  const text = readFileSync(new URL('../../../docs/project-notes/analysis-templates/universal.md', import.meta.url), 'utf8');
  const version = /Worksheet Analysis Prompts v(\d+\.\d+\.\d+)/.exec(text)?.[1];
  assert.ok(version);
  const bundled = readAnalysisTemplate('universal');
  assert.deepEqual(bundled, { text, version });

  for (const stage of ['primary', 'middle']) {
    for (const subject of ['chinese', 'math', 'english', 'science', 'information-technology', 'general']) {
      assert.deepEqual(readAnalysisTemplate(`${stage}-${subject}`), bundled);
    }
  }
});

test('unknown template IDs and URLs are rejected', () => {
  for (const id of ['https://localhost/', '../primary-math', 'primary-nope', 'primary-math?url=foo', '']) {
    assert.equal(readAnalysisTemplate(id), undefined);
  }
});
