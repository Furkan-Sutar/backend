import { model, Schema, type InferSchemaType } from 'mongoose';
import { generateBusinessId } from '../utils/business-id.js';

const instituteSchema = new Schema({
  instituteId: { type: String, required: true, unique: true, immutable: true },
  name: { type: String, required: true, trim: true, maxlength: 160 },
  contact: { type: Schema.Types.Mixed, default: {} },
  email: { type: String, trim: true, lowercase: true, index: true },
  address: { type: Schema.Types.Mixed, default: {} },
  status: { type: String, enum: ['active', 'inactive', 'suspended'], default: 'active', required: true },
  settings: { type: Schema.Types.Mixed, default: {} }
}, { timestamps: true, versionKey: false });

instituteSchema.pre('validate', async function () {
  if (this.isNew) this.instituteId = await generateBusinessId('INS');
});

export type Institute = InferSchemaType<typeof instituteSchema>;
export const InstituteModel = model('Institute', instituteSchema);


