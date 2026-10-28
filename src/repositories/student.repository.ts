import { StudentModel } from '../models/student.model.js';
import { GuardianModel } from '../models/guardian.model.js';
import { AdmissionModel } from '../models/admission.model.js';
import { StudentDocumentModel } from '../models/student-document.model.js';
import { UserModel } from '../models/user.model.js';
import type { ClientSession } from 'mongoose';

export const studentRepository = {
  userExists(instituteId: string, userId: string, session?: ClientSession) { return UserModel.exists({ instituteId, _id: userId, status: 'active', role: 'STUDENT' }).session(session ?? null); },
  findById(instituteId: string, id: string, session?: ClientSession, userId?: string) {
    const filter = /^[0-9a-f]{24}$/i.test(id) ? { $or: [{ _id: id }, { studentId: id }] } : { studentId: id };
    return StudentModel.findOne({ instituteId, ...filter, ...(userId ? { userId } : {}) }).populate('guardianIds').session(session ?? null);
  },
  create(input: Record<string, unknown>, session: ClientSession) { return StudentModel.create([input], { session }).then(([doc]) => doc!); },
  createGuardians(rows: Record<string, unknown>[], session: ClientSession) { return rows.length ? GuardianModel.create(rows, { session, ordered: true }) : Promise.resolve([]); },
  update(id: string, instituteId: string, update: Record<string, unknown>, session?: ClientSession) { return StudentModel.findOneAndUpdate({ _id: id, instituteId }, { $set: update }, { new: true, runValidators: true, ...(session ? { session } : {}) }).populate('guardianIds'); },
  list(instituteId: string, page: number, limit: number, status?: string, search?: string, userId?: string) {
    const filter: Record<string, unknown> = { instituteId, ...(status ? { status } : {}), ...(userId ? { userId } : {}) };
    if (search) { const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); filter.$or = [{ studentId: { $regex: escaped, $options: 'i' } }, { name: { $regex: escaped, $options: 'i' } }, { mobile: { $regex: escaped } }, { email: { $regex: escaped, $options: 'i' } }]; }
    return Promise.all([StudentModel.find(filter).select('-identityNumber -identityFingerprint').populate('guardianIds').sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(), StudentModel.countDocuments(filter)]).then(([items, total]) => ({ items, total }));
  },
  findDuplicates(instituteId: string, values: { identityFingerprint?: string | undefined; mobile?: string | undefined; email?: string | undefined; excludeId?: string | undefined }, session?: ClientSession) {
    const $or: Record<string, unknown>[] = [];
    if (values.identityFingerprint) $or.push({ identityFingerprint: values.identityFingerprint });
    if (values.mobile) $or.push({ mobile: values.mobile });
    if (values.email) $or.push({ email: values.email });
    return $or.length ? StudentModel.find({ instituteId, $or, ...(values.excludeId ? { _id: { $ne: values.excludeId } } : {}) }).select('studentId name mobile email status').session(session ?? null).lean() : Promise.resolve([]);
  },
  finance(instituteId: string, studentObjectId: string) {
    return Promise.all([
      AdmissionModel.find({ instituteId, studentObjectId }).select('admissionId courseId batchId feePlanId status createdAt').populate('courseId batchId feePlanId').lean(),
      StudentDocumentModel.countDocuments({ instituteId, studentId: studentObjectId })
    ]).then(([admissions, documentCount]) => ({ admissions, documentCount }));
  }
};
