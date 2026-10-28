import type { Role } from './rbac.js';

export interface AuthenticatedUser {
  objectId: string;
  userId: string;
  instituteId: string;
  instituteBusinessId: string;
  name: string;
  email?: string;
  mobile?: string;
  role: Role;
  authVersion: number;
}
