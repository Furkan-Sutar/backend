import mongoose from 'mongoose';
import '../routes/v1.routes.js';
import { connectDatabase, disconnectDatabase } from '../config/database.js';
import { logger } from '../config/logger.js';

async function createIndexes(): Promise<void> {
  try {
    await connectDatabase();
    for (const model of Object.values(mongoose.models)) {
      logger.info({ model: model.modelName }, 'Creating MongoDB indexes');
      await model.createIndexes();
    }
    logger.info({ modelCount: Object.keys(mongoose.models).length }, 'MongoDB index creation complete');
  } finally {
    await disconnectDatabase();
  }
}

createIndexes().catch((error: unknown) => {
  logger.fatal({ err: error }, 'MongoDB index creation failed');
  process.exitCode = 1;
});
