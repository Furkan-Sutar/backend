import { AdmissionModel } from '../models/admission.model.js';
import { LeadModel } from '../models/lead.model.js';
import { CourseModel } from '../models/course.model.js';
import { BatchModel } from '../models/batch.model.js';
import { FeePlanModel } from '../models/fee-plan.model.js';
import type { ClientSession } from 'mongoose';

export const admissionRepository = {
  findLead(instituteId: string, leadId: string, session?: ClientSession) {
    return LeadModel.findOne({ instituteId, $or: [{ leadId }, ...( /^[0-9a-f]{24}$/i.test(leadId) ? [{ _id: leadId }] : [])] }).session(session ?? null);
  },
  findById(instituteId: string, id: string, session?: ClientSession) {
    const filter = /^[0-9a-f]{24}$/i.test(id) ? { $or: [{ _id: id }, { admissionId: id }] } : { admissionId: id };
    return AdmissionModel.findOne({ instituteId, ...filter }).session(session ?? null);
  },
  create(input: Record<string, unknown>, session: ClientSession) { return AdmissionModel.create([input], { session }).then(([doc]) => doc!); },
  update(id: string, instituteId: string, update: Record<string, unknown>, session: ClientSession) { return AdmissionModel.findOneAndUpdate({ _id: id, instituteId }, { $set: update }, { new: true, runValidators: true, session }); },
  list(instituteId: string, page: number, limit: number, status?: string) {
    const filter = { instituteId, ...(status ? { status } : {}) };
    return Promise.all([AdmissionModel.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(), AdmissionModel.countDocuments(filter)]).then(([items, total]) => ({ items, total }));
  },
  async validateReferences(instituteId: string, courseId: string, batchId: string, feePlanId: string, session: ClientSession) {
    const [course, batch, feePlan] = await Promise.all([
      CourseModel.exists({ _id: courseId, instituteId, status: 'ACTIVE' }).session(session),
      BatchModel.exists({ _id: batchId, instituteId, courseId, status: 'ACTIVE' }).session(session),
      FeePlanModel.exists({ _id: feePlanId, instituteId, courseId, status: 'ACTIVE' }).session(session)
    ]);
    return { course: Boolean(course), batch: Boolean(batch), feePlan: Boolean(feePlan) };
  }
};
