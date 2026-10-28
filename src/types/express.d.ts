import 'express-serve-static-core';
import type { AuthenticatedUser } from './auth.js';

declare module 'express-serve-static-core' {
  interface Request {
    correlationId: string;
    auth?: AuthenticatedUser;
  }
}
