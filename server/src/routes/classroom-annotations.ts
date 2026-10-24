import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import { requireTeacher } from '../middleware/auth.js';
import { AnnotationError, readAnnotation, saveAnnotation } from '../services/classroom-annotations.js';

const router: Router = Router({mergeParams:true});
router.use(requireTeacher);
router.post('/read', async (req, res) => {
  try {
    res.setHeader('Cache-Control','no-store');
    res.json(await readAnnotation(req.app.get('prisma') as PrismaClient, (req.params as Record<string,string>).id, req.body?.target));
  } catch(error) {
    if (!(error instanceof AnnotationError)) console.error('[Annotations] read failed:', error);
    res.status(error instanceof AnnotationError ? error.status : 500).json({error:error instanceof AnnotationError ? error.message : '读取批注失败，请重试'});
  }
});
router.put('/', async (req, res) => {
  try {
    res.json(await saveAnnotation(req.app.get('prisma') as PrismaClient, (req.params as Record<string,string>).id, req.body?.target, req.body?.document, req.body?.revision));
  } catch(error) {
    if (!(error instanceof AnnotationError)) console.error('[Annotations] save failed:', error);
    res.status(error instanceof AnnotationError ? error.status : 500).json({error:error instanceof AnnotationError ? error.message : '保存批注失败，请重试'});
  }
});
export default router;
