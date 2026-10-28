import { model, Schema } from 'mongoose';

const counterSchema = new Schema({
  key: { type: String, required: true, unique: true },
  value: { type: Number, required: true, default: 0 }
}, { versionKey: false });

export const CounterModel = model('Counter', counterSchema);
