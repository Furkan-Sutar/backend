import { Router } from 'express';
import { authenticate } from '../middleware/authentication.js';
import { instituteOwnership } from '../middleware/institute-ownership.js';
import { requirePermission, requireRole } from '../middleware/authorization.js';
import { ROLES } from '../types/rbac.js';
import { asyncHandler } from '../utils/async-handler.js';
import { academicAssessmentController as c } from './assessments.controller.js';

export const assignmentRouter = Router();
assignmentRouter.use(authenticate, instituteOwnership(), requireRole(...ROLES));
assignmentRouter.get('/', requirePermission('assignment.view'), asyncHandler(c.listAssignments));
assignmentRouter.post('/', requirePermission('assignment.create'), asyncHandler(c.createAssignment));
assignmentRouter.get('/:id', requirePermission('assignment.view'), asyncHandler(c.getAssignment));
assignmentRouter.patch('/:id', requirePermission('assignment.update'), asyncHandler(c.updateAssignment));
assignmentRouter.post('/:id/submissions', requirePermission('assignment.submit'), asyncHandler(c.submitAssignment));
assignmentRouter.get('/:id/submissions', requirePermission('assignment.view'), asyncHandler(c.listSubmissions));
assignmentRouter.patch('/submissions/:id', requirePermission('assignment.update'), asyncHandler(c.assessSubmission));

export const examRouter = Router();
examRouter.use(authenticate, instituteOwnership(), requireRole(...ROLES));
examRouter.get('/', requirePermission('exam.view'), asyncHandler(c.listExams));
examRouter.post('/', requirePermission('exam.create'), asyncHandler(c.createExam));
examRouter.get('/:id', requirePermission('exam.view'), asyncHandler(c.getExam));
examRouter.patch('/:id', requirePermission('exam.update'), asyncHandler(c.updateExam));
examRouter.get('/:id/questions', requirePermission('exam.view'), asyncHandler(c.listQuestions));
examRouter.post('/:id/questions', requirePermission('exam.update'), asyncHandler(c.createQuestion));
examRouter.post('/:id/attempts', requirePermission('exam.attempt'), asyncHandler(c.startAttempt));
examRouter.post('/attempts/:id/submit', requirePermission('exam.attempt'), asyncHandler(c.submitAttempt));

export const resultRouter = Router();
resultRouter.use(authenticate, instituteOwnership(), requireRole(...ROLES));
resultRouter.get('/', requirePermission('result.view'), asyncHandler(c.listResults));
resultRouter.get('/:id', requirePermission('result.view'), asyncHandler(c.getResult));
resultRouter.patch('/:id', requirePermission('result.update'), asyncHandler(c.adjustResult));
resultRouter.post('/:id/publish', requirePermission('result.publish'), asyncHandler(c.publishResult));
