import { AuthenticationEventModel } from '../models/authentication-event.model.js';

export const authenticationEventRepository = {
  create(event: Record<string, unknown>) {
    return AuthenticationEventModel.create(event);
  }
};
