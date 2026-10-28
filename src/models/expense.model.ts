import { model, Schema, type InferSchemaType } from 'mongoose';
import { generateBusinessId } from '../utils/business-id.js';

const schema = new Schema({
  expenseId: { type: String, required: true, unique: true, immutable: true },
  instituteId: { type: Schema.Types.ObjectId, ref: 'Institute', required: true, immutable: true, index: true },
  categoryId: { type: Schema.Types.ObjectId, ref: 'ExpenseCategory', required: true, index: true },
  amount: { type: Number, required: true, min: 0.01 },
  date: { type: Date, required: true, index: true },
  vendorPayee: { type: String, required: true, trim: true, maxlength: 200 },
  accountId: { type: Schema.Types.ObjectId, ref: 'FinancialAccount', required: true, index: true },
  reason: { type: String, required: true, trim: true, maxlength: 1000 },
  attachmentReference: { type: String, trim: true, maxlength: 1000 },
  approvalRequired: { type: Boolean, required: true },
  approvalStatus: { type: String, enum: ['PENDING', 'APPROVED', 'REJECTED', 'NOT_REQUIRED'], required: true, index: true },
  status: { type: String, enum: ['UNPAID', 'PAID', 'CANCELLED'], required: true, default: 'UNPAID', index: true },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  approvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  approvedAt: { type: Date },
  paidAt: { type: Date },
  paidBy: { type: Schema.Types.ObjectId, ref: 'User' },
  accountTransactionId: { type: Schema.Types.ObjectId, ref: 'AccountTransaction' },
  paymentReference: { type: String, trim: true, maxlength: 200 },
  paymentEvidenceReference: { type: String, trim: true, maxlength: 1000 }
}, { timestamps: true, versionKey: false });

schema.pre('validate', async function () { if (this.isNew) this.expenseId = await generateBusinessId('EXP'); });
schema.index({ instituteId: 1, createdBy: 1, status: 1 });
schema.index({ instituteId: 1, categoryId: 1, date: -1 });
schema.index({ instituteId: 1, vendorPayee: 1 });

export type Expense = InferSchemaType<typeof schema>;
export const ExpenseModel = model('Expense', schema);
