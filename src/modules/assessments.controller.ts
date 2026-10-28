import type { Request, Response } from 'express';
import { z } from 'zod';
import { ApiError } from '../utils/api-error.js';
import { assessmentsService as s } from '../services/assessments.service.js';

const id = z.string().min(1).max(100);
const base = { courseId: id, moduleId: id, batchId: id, title: z.string().trim().min(1).max(200), description: z.string().trim().max(10000).default(''), deadline: z.coerce.date(), totalMarks: z.number().positive().max(100000).default(100), status: z.enum(['DRAFT','OPEN','CLOSED','ARCHIVED']).default('DRAFT') };
const assignment = z.object(base).strict();
const patchAssignment = z.object({ title: base.title.optional(), description: base.description.optional(), deadline: base.deadline.optional(), totalMarks: base.totalMarks.optional(), status: base.status.optional() }).strict();
const exam = z.object({ courseId:id,moduleId:id,batchId:id,title:z.string().trim().min(1).max(200),description:z.string().max(10000).default(''),totalMarks:z.number().positive().max(100000),passMarks:z.number().min(0),duration:z.number().int().positive().max(1440),attemptRules:z.object({maxAttempts:z.number().int().positive().max(10).default(1),allowRetakeAfterFailure:z.boolean().default(false)}).strict().default({maxAttempts:1,allowRetakeAfterFailure:false}),status:z.enum(['DRAFT','ACTIVE','CLOSED','ARCHIVED']).default('DRAFT') }).strict();
const patchExam = z.object({title:z.string().trim().min(1).max(200).optional(),description:z.string().max(10000).optional(),passMarks:z.number().min(0).optional(),duration:z.number().int().positive().max(1440).optional(),attemptRules:z.object({maxAttempts:z.number().int().positive().max(10),allowRetakeAfterFailure:z.boolean()}).strict().optional(),status:z.enum(['DRAFT','ACTIVE','CLOSED','ARCHIVED']).optional()}).strict();
const question = z.object({question:z.string().trim().min(1).max(5000),type:z.enum(['MULTIPLE_CHOICE','TRUE_FALSE']),options:z.array(z.string().max(500)).default([]),correctAnswer:z.string().min(1).max(500),marks:z.number().positive(),sequence:z.number().int().positive()}).strict();
const answers = z.object({answers:z.array(z.object({questionId:id,answer:z.string().max(500)}).strict()).min(1).max(200)}).strict();
const assess = z.object({marks:z.number().min(0),feedback:z.string().max(5000).default('')}).strict();
const adjust = z.object({marks:z.number().min(0),reason:z.string().trim().min(1).max(500)}).strict();
function parse<T>(schema:z.ZodType<T>, input:unknown):T { const out=schema.safeParse(input); if(!out.success) throw new ApiError(400,'VALIDATION_ERROR','Request validation failed',out.error.issues); return out.data; }
function auth(req:Request) { if(!req.auth) throw new ApiError(401,'AUTHENTICATION_REQUIRED','Authentication is required'); return req.auth; }
export const academicAssessmentController = {
 async listAssignments(req:Request,res:Response){res.json({success:true,data:await s.listAssignments(auth(req))});},
 async createAssignment(req:Request,res:Response){res.status(201).json({success:true,data:await s.createAssignment(auth(req),req,parse(assignment,req.body))});},
 async getAssignment(req:Request,res:Response){res.json({success:true,data:await s.getAssignment(auth(req),String(req.params.id))});},
 async updateAssignment(req:Request,res:Response){res.json({success:true,data:await s.updateAssignment(auth(req),req,String(req.params.id),parse(patchAssignment,req.body))});},
 async submitAssignment(req:Request,res:Response){const body=z.object({content:z.string().max(20000).optional(),secureStorageReferences:z.array(z.string().max(1000)).max(20).default([])}).strict();res.status(201).json({success:true,data:await s.submitAssignment(auth(req),req,String(req.params.id),parse(body,req.body))});},
 async listSubmissions(req:Request,res:Response){res.json({success:true,data:await s.listSubmissions(auth(req),String(req.params.id))});},
 async assessSubmission(req:Request,res:Response){res.json({success:true,data:await s.assessSubmission(auth(req),req,String(req.params.id),parse(assess,req.body))});},
 async listExams(req:Request,res:Response){res.json({success:true,data:await s.listExams(auth(req))});},
 async createExam(req:Request,res:Response){res.status(201).json({success:true,data:await s.createExam(auth(req),req,parse(exam,req.body))});},
 async getExam(req:Request,res:Response){res.json({success:true,data:await s.getExam(auth(req),String(req.params.id))});},
 async updateExam(req:Request,res:Response){res.json({success:true,data:await s.updateExam(auth(req),req,String(req.params.id),parse(patchExam,req.body))});},
 async listQuestions(req:Request,res:Response){res.json({success:true,data:await s.listQuestions(auth(req),String(req.params.id))});},
 async createQuestion(req:Request,res:Response){res.status(201).json({success:true,data:await s.createQuestion(auth(req),req,String(req.params.id),parse(question,req.body))});},
 async startAttempt(req:Request,res:Response){res.status(201).json({success:true,data:await s.startAttempt(auth(req),String(req.params.id))});},
 async submitAttempt(req:Request,res:Response){res.json({success:true,data:await s.submitAttempt(auth(req),req,String(req.params.id),parse(answers,req.body))});},
 async listResults(req:Request,res:Response){res.json({success:true,data:await s.listResults(auth(req),typeof req.query.examId==='string'?req.query.examId:undefined)});},
 async getResult(req:Request,res:Response){res.json({success:true,data:await s.getResult(auth(req),String(req.params.id))});},
 async adjustResult(req:Request,res:Response){res.json({success:true,data:await s.adjustResult(auth(req),req,String(req.params.id),parse(adjust,req.body))});},
 async publishResult(req:Request,res:Response){res.json({success:true,data:await s.publishResult(auth(req),req,String(req.params.id))});}
};
