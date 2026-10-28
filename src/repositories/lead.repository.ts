import mongoose, { type ClientSession } from 'mongoose';
import { LeadModel } from '../models/lead.model.js';
import { LeadActivityModel } from '../models/lead-activity.model.js';
import { FollowUpModel } from '../models/follow-up.model.js';
import { LeadSourceModel } from '../models/lead-source.model.js';
import { UserModel } from '../models/user.model.js';
import { CounsellingModel } from '../models/counselling.model.js';

export interface LeadListQuery {
  instituteId: string;
  search?: string;
  status?: string;
  priority?: string;
  sourceId?: string;
  assignedTo?: string;
  interestedCourseId?: string;
  missedFollowUp?: boolean;
  sortBy: 'createdAt' | 'updatedAt' | 'enquiryDate' | 'nextFollowUpAt' | 'name' | 'priority';
  sortOrder: 'asc' | 'desc';
  page: number;
  limit: number;
}

export const leadRepository = {
  findDuplicates(instituteId: string, mobile: string, email?: string, excludeId?: string, session?: ClientSession) {
    const matches: Record<string, string>[] = [{ mobile }];
    if (email) matches.push({ email });
    const filter: Record<string, unknown> = { instituteId, $or: matches };
    if (excludeId) filter._id = { $ne: excludeId };
    return LeadModel.find(filter)
      .select('leadId name mobile email status priority sourceId assignedTo interestedCourseId enquiryDate')
      .limit(10).session(session ?? null).lean();
  },
  findById(instituteId: string, id: string, session?: ClientSession) {
    const identity = mongoose.isValidObjectId(id) ? { $or: [{ _id: id }, { leadId: id }] } : { leadId: id };
    return LeadModel.findOne({ instituteId, ...identity }).session(session ?? null).lean();
  },
  create(input: Record<string, unknown>, session?: ClientSession) {
    return LeadModel.create([input], session ? { session } : undefined).then(([lead]) => lead!);
  },
  update(id: string, instituteId: string, update: Record<string, unknown>, session?: ClientSession) {
    return LeadModel.findOneAndUpdate({ _id: id, instituteId }, { $set: update }, { new: true, runValidators: true, ...(session ? { session } : {}) });
  },
  async list(query: LeadListQuery) {
    const filter: Record<string, unknown> = { instituteId: query.instituteId, archivedAt: { $exists: false } };
    if (query.status) filter.status = query.status;
    if (query.priority) filter.priority = query.priority;
    if (query.sourceId) filter.sourceId = query.sourceId;
    if (query.assignedTo) filter.assignedTo = query.assignedTo;
    if (query.interestedCourseId) filter.interestedCourseId = query.interestedCourseId;
    if (query.search) {
      const escaped = query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [
        { name: { $regex: escaped, $options: 'i' } },
        { email: { $regex: escaped, $options: 'i' } },
        { mobile: { $regex: escaped, $options: 'i' } },
        { leadId: { $regex: escaped, $options: 'i' } }
      ];
    }
    if (query.missedFollowUp) filter.$and = [
      { nextFollowUpAt: { $lt: new Date() } },
      { status: { $nin: ['ADMISSION', 'NOT_INTERESTED', 'LOST'] } }
    ];
    const sort: Record<string, mongoose.SortOrder> = { [query.sortBy]: query.sortOrder === 'asc' ? 1 : -1, _id: -1 };
    const [items, total] = await Promise.all([
      LeadModel.find(filter).sort(sort).skip((query.page - 1) * query.limit).limit(query.limit).lean(),
      LeadModel.countDocuments(filter)
    ]);
    return { items, total };
  },
  sourceExists(instituteId: string, sourceId: string, session?: ClientSession) {
    return LeadSourceModel.exists({ instituteId, _id: sourceId, isActive: true }).session(session ?? null);
  },
  activeUserExists(instituteId: string, userId: string, session?: ClientSession) {
    return UserModel.exists({ instituteId, _id: userId, status: 'active' }).session(session ?? null);
  },
  funnelBy(instituteId: string, dimension: 'sourceId' | 'assignedTo' | 'interestedCourseId') {
    return LeadModel.aggregate([
      { $match: { instituteId: new mongoose.Types.ObjectId(instituteId), archivedAt: { $exists: false } } },
      { $group: { _id: { dimension: `$${dimension}`, status: '$status' }, count: { $sum: 1 } } },
      { $sort: { '_id.dimension': 1, '_id.status': 1 } }
    ]);
  },
  createActivity(input: Record<string, unknown>, session: ClientSession) {
    return LeadActivityModel.create([input], { session }).then(([activity]) => activity!);
  },
  createFollowUp(input: Record<string, unknown>, session: ClientSession) {
    return FollowUpModel.create([input], { session }).then(([followUp]) => followUp!);
  },
  createCounselling(input: Record<string, unknown>, session: ClientSession) {
    return CounsellingModel.create([input], { session }).then(([counselling]) => counselling!);
  }
};
