import mongoose from 'mongoose';
import { env } from './env.js';
import { logger } from '../utils/logger.js';

mongoose.set('strictQuery', true);

export async function connectDB(uri = env.mongoUri) {
  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000 });
    logger.info(`MongoDB connected: ${mongoose.connection.host}/${mongoose.connection.name}`);
  } catch (err) {
    logger.error(`Cannot connect to MongoDB at ${uri.replace(/\/\/.*@/, '//***@')}. Is MongoDB running locally? (${err.message})`);
    throw err;
  }
}

export async function disconnectDB() {
  await mongoose.disconnect();
}
