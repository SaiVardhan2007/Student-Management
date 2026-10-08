// MongoDB connection helper shared by API routes, scripts and tests.
import mongoose from 'mongoose';
import { env } from './env';
import { logger } from './logger';

mongoose.set('strictQuery', true);

type Cache = { conn: typeof mongoose | null; promise: Promise<typeof mongoose> | null };
const g = globalThis as unknown as { __mongoose?: Cache };
const cache: Cache = g.__mongoose || (g.__mongoose = { conn: null, promise: null });

/** Connect once and reuse the connection across hot reloads and route handlers. */
export async function connectDB(uri: string = env.mongoUri): Promise<typeof mongoose> {
  if (mongoose.connection.readyState === 1) return (cache.conn = mongoose); // already connected (hot reload, tests, scripts)
  if (!cache.promise) {
    cache.promise = mongoose.connect(uri, { serverSelectionTimeoutMS: 8000 }).then((m) => {
      logger.info(`MongoDB connected: ${m.connection.host}/${m.connection.name}`);
      return m;
    });
  }
  try {
    cache.conn = await cache.promise;
  } catch (err: any) {
    cache.promise = null;
    logger.error(`Cannot connect to MongoDB at ${uri.replace(/\/\/.*@/, '//***@')}. Is MongoDB running locally? (${err.message})`);
    throw err;
  }
  return cache.conn;
}

export async function disconnectDB() {
  await mongoose.disconnect();
  cache.conn = null;
  cache.promise = null;
}
