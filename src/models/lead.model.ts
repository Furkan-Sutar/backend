import { model, Schema, type InferSchemaType } from 'mongoose';
import { generateBusinessId } from '../utils/business-id.js';
import { LEAD_PRIORITIES, LEAD_STATUSES } from '../modules/crm/lead.constants.js';

const assignmentSchema = new Schema({
  fromUserId: { type: Schema.Types.ObjectId, ref: 'User' },
  toUserId: { type: Schema.Types.ObjectId, ref: 'User' },
  assignedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  assignedAt: { type: Date, required: true, default: Date.now },
  reason: { type: String, trim: true, maxlength: 500 }
}, { _id: false });

const leadSchema = new Schema({
  leadId: { type: String, required: true, unique: true, immutable: true },
  instituteId: { type: Schema.Types.ObjectId, ref: 'Institute', required: true, index: true, immutable: true },
  name: { type: String, required: true, trim: true, maxlength: 160 },
  mobile: { type: String, required: true, trim: true },
  email: { type: String, trim: true, lowercase: true },
  education: { type: String, trim: true, maxlength: 160 },
  interestedCourseId: { type: Schema.Types.ObjectId, ref: 'Course' },
  sourceId: { type: Schema.Types.ObjectId, ref: 'LeadSource', immutable: true },
  assignedTo: { type: Schema.Types.ObjectId, ref: 'User', index: true },
  assignmentHistory: { type: [assignmentSchema], default: [] },
  status: { type: String, enum: LEAD_STATUSES, required: true, default: 'NEW', index: true },
  priority: { type: String, enum: LEAD_PRIORITIES, required: true, default: 'NORMAL' },
  enquiryDate: { type: Date, required: true, default: Date.now, index: true },
  lastContactedAt: { type: Date },
  nextFollowUpAt: { type: Date, index: true },
  notes: { type: String, trim: true, maxlength: 5000 },
  tags: { type: [String], default: [] },
  archivedAt: { type: Date },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  updatedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true }
}, { timestamps: true, versionKey: false });

leadSchema.pre('validate', async function () {
  if (this.isNew) this.leadId = await generateBusinessId('LEAD');
});
leadSchema.index({ instituteId: 1, mobile: 1 }, { unique: true });
leadSchema.index({ instituteId: 1, email: 1 }, { unique: true, partialFilterExpression: { email: { $type: 'string' } } });
leadSchema.index({ instituteId: 1, status: 1, createdAt: -1 });
leadSchema.index({ instituteId: 1, assignedTo: 1, status: 1, nextFollowUpAt: 1 });
leadSchema.index({ instituteId: 1, sourceId: 1, status: 1 });
leadSchema.index({ instituteId: 1, interestedCourseId: 1, status: 1 });
leadSchema.index({ instituteId: 1, name: 1 });
leadSchema.index({ instituteId: 1, leadId: 1 }, { unique: true });

export type Lead = InferSchemaType<typeof leadSchema>;
export const LeadModel = model('Lead', leadSchema);
