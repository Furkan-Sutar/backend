import { CounterModel } from '../models/counter.model.js';

export async function generateBusinessId(prefix: 'INS' | 'USR' | 'AUD' | 'LEAD' | 'SRC' | 'ACT' | 'FUP' | 'CNSL' | 'ADM' | 'STU' | 'DOC' | 'GUA' | 'CRS' | 'CMD' | 'BAT' | 'ENR' | 'TIM' | 'ASN' | 'ATR' | 'PRG' | 'ASG' | 'SUB' | 'EXM' | 'QUE' | 'ATT' | 'RES' | 'FPL' | 'INSF' | 'FAC' | 'DSC' | 'PAY' | 'REC' | 'RFD' | 'ATX' | 'FPR' | 'TRF' | 'EXC' | 'EXP' | 'EAP' | 'SAL' | 'SPM' | 'CERT' | 'EVD' | 'STF' | 'TAS' | 'COL' | 'CPA' | 'NTF' | 'FILE' | 'INT'): Promise<string> {
  const year = new Date().getUTCFullYear();
  const key = `${prefix}-${year}`;
  const counter = await CounterModel.findOneAndUpdate(
    { key },
    { $inc: { value: 1 } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  ).orFail();
  return `SN-${prefix}-${year}-${String(counter.value).padStart(5, '0')}`;
}



