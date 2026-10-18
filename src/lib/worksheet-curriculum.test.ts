import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { WORKSHEET_GRADES, WORKSHEET_SUBJECTS, normalizeWorksheetCurriculum, worksheetCurriculumContext, worksheetCurriculumError, worksheetTemplateRecommendation } from './worksheet-curriculum.ts';
import { DEFAULT_SETTINGS, buildPayload, createEmptyContent, normalizeLoadedSettings, parseDraft } from '../app/teacher/worksheets/edit/worksheet-editor-core.ts';

test('年级与学科前后端使用相同选项和规则，未知值不猜测、不默认选中', () => {
  assert.equal(fs.readFileSync(new URL('./worksheet-curriculum.ts', import.meta.url), 'utf8'), fs.readFileSync(new URL('../../server/src/services/worksheet-curriculum.ts', import.meta.url), 'utf8'));
  assert.equal(WORKSHEET_GRADES.length, 9);
  assert.equal(new Set(WORKSHEET_SUBJECTS).size, WORKSHEET_SUBJECTS.length);
  assert.deepEqual(normalizeWorksheetCurriculum({}), {});
  assert.deepEqual(normalizeWorksheetCurriculum({ gradeLevel: '3', subject: '不存在的学科' }), { gradeLevel: null, subject: null });
  assert.match(worksheetCurriculumContext({}), /不根据标题或班名推测/);
  assert.match(worksheetCurriculumError({})!, /年级和学科/);
  assert.equal(worksheetCurriculumError({}, false), null, '保留旧客户端未提供新字段的兼容路径');
  assert.match(worksheetCurriculumError({ gradeLevel: 3 }, false)!, /学科/);
  assert.equal(worksheetTemplateRecommendation({ gradeLevel: 3, subject: '语文' }), '小学语文');
  assert.equal(worksheetTemplateRecommendation({ gradeLevel: 8, subject: '物理' }), '初中科学');
  assert.equal(worksheetTemplateRecommendation({ gradeLevel: 8, subject: '历史' }), '初中其他学科通用');
});

test('适用年级与学科经过编辑、保存载荷、草稿恢复后保持原值', () => {
  const settings = normalizeLoadedSettings({ ...DEFAULT_SETTINGS, gradeLevel: 8, subject: '英语' });
  const content = createEmptyContent();
  const payload = buildPayload('模拟学习单', '', settings, content);
  const draft = parseDraft(JSON.stringify({ savedAt: 1, ...payload, description: '' }));
  assert.ok(draft);
  for (const value of [settings, payload.settings, draft.settings]) {
    assert.equal(value.gradeLevel, 8);
    assert.equal(value.subject, '英语');
    assert.equal(worksheetCurriculumError(value), null);
    assert.match(worksheetCurriculumContext(value), /初中八年级/);
  }
  const old = normalizeLoadedSettings(DEFAULT_SETTINGS);
  assert.equal(old.gradeLevel, undefined);
  assert.equal(old.subject, undefined);
});
