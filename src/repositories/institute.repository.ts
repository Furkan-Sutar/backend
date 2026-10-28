import { InstituteModel } from '../models/institute.model.js';

export const instituteRepository = {
  findByBusinessId(instituteId: string) {
    return InstituteModel.findOne({ instituteId }).lean();
  },
  findById(id: string) {
    return InstituteModel.findById(id).lean();
  }
};
