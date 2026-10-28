import mongoose from 'mongoose';
import { env } from './env.js';
import { logger } from './logger.js';

export async function connectDatabase(): Promise<void> {
  mongoose.set('autoIndex', env.NODE_ENV !== 'production');
  mongoose.connection.on('disconnected', () => logger.warn('MongoDB connection lost'));
  mongoose.connection.on('reconnected', () => logger.info('MongoDB connection restored'));
  mongoose.connection.on('error', (error) => logger.error({ err: error }, 'MongoDB connection error'));
  await mongoose.connect(env.MONGO_URI, {
    serverSelectionTimeoutMS: env.MONGO_SERVER_SELECTION_TIMEOUT_MS,
    maxPoolSize: env.MONGO_MAX_POOL_SIZE,
    minPoolSize: env.MONGO_MIN_POOL_SIZE,
    autoIndex: env.NODE_ENV !== 'production'
  });
  logger.info('MongoDB connection established');
}

export function getDatabaseStatus(): 'connected' | 'connecting' | 'disconnected' | 'disconnecting' {
  switch (mongoose.connection.readyState) {
    case 1: return 'connected';
    case 2: return 'connecting';
    case 3: return 'disconnecting';
    default: return 'disconnected';
  }
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.disconnect();
}

