// Short-lived in-process cache for documents that nearly every request reads (the signed-in user, the app settings),
// so they are not fetched from MongoDB again on each request. Each server instance has its own copy; the models clear
// it whenever the document is written here, and the TTL bounds how stale another instance's copy can be.
import mongoose, { type Model } from 'mongoose';

const { BSON } = mongoose.mongo;

type Entry = { raw: Buffer; expires: number };

export function createDocCache(name: string, ttlMs: number) {
  const g = globalThis as unknown as Record<string, Map<string, Entry> | undefined>;
  const entries: Map<string, Entry> = g[`__docCache_${name}`] || (g[`__docCache_${name}`] = new Map());

  return {
    /** A fresh Mongoose document for `key`, or null when it is not cached (or expired). */
    get<T = any>(Model: Model<any>, key: string): T | null {
      const hit = entries.get(key);
      if (!hit) return null;
      if (hit.expires < Date.now()) {
        entries.delete(key);
        return null;
      }
      // a new document every time, so one request changing it can never affect another
      return Model.hydrate(BSON.deserialize(hit.raw)) as T;
    },
    /** Store a plain (lean) document under `key`. */
    set(key: string, lean: Record<string, any>) {
      if (entries.size > 5000) entries.clear(); // safety cap; it refills on demand
      entries.set(key, { raw: Buffer.from(BSON.serialize(lean)), expires: Date.now() + ttlMs });
    },
    delete(key: string) {
      entries.delete(key);
    },
    clear() {
      entries.clear();
    },
  };
}

// The signed-in user is read by every API request and every page render.
export const userCache = createDocCache('user', 30_000);
// Settings change rarely and are read by attendance, marks, library and dashboard code.
export const settingsCache = createDocCache('settings', 60_000);
