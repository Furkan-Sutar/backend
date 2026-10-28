import { model, Schema, type InferSchemaType } from 'mongoose';

const schema = new Schema({
  instituteId: { type: Schema.Types.ObjectId, ref: 'Institute', required: true, index: true },
  jobKey: { type: String, required: true, trim: true, maxlength: 120 },
  scheduledFor: { type: Date, required: true, index: true },
  status: { type: String, enum: ['SCHEDULED', 'RUNNING', 'SUCCEEDED', 'FAILED'], required: true, default: 'SCHEDULED', index: true },
  attemptCount: { type: Number, required: true, default: 0 },
  startedAt: { type: Date }, completedAt: { type: Date },
  result: { type: Schema.Types.Mixed }, error: { type: String, maxlength: 2000 }
}, { timestamps: true, versionKey: false });
schema.index({ instituteId: 1, jobKey: 1, scheduledFor: 1 }, { unique: true });
schema.index({ status: 1, scheduledFor: 1 });
export type ScheduledJob = InferSchemaType<typeof schema>;
export const ScheduledJobModel = model('ScheduledJob', schema);
