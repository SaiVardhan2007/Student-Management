import mongoose, { type Model, type Schema } from 'mongoose';
import { recordDb } from '@/lib/request-timing';

mongoose.set('strictQuery', true);

const QUERY_OPS = [
  'countDocuments',
  'estimatedDocumentCount',
  'deleteMany',
  'deleteOne',
  'distinct',
  'find',
  'findOne',
  'findOneAndDelete',
  'findOneAndReplace',
  'findOneAndUpdate',
  'replaceOne',
  'updateMany',
  'updateOne',
] as const;
const started = new WeakMap<object, number>();
const start = function (this: object) {
  started.set(this, performance.now());
};
const stop = function (this: object) {
  const t0 = started.get(this);
  if (t0 !== undefined) recordDb(performance.now() - t0);
};

/** Times queries, aggregations and saves for the Server-Timing header (see lib/request-timing.ts). */
function timingPlugin(schema: Schema) {
  schema.pre(QUERY_OPS as any, start);
  schema.post(QUERY_OPS as any, stop);
  schema.pre('aggregate', start);
  schema.post('aggregate', stop);
  schema.pre('save', start);
  schema.post('save', stop);
}

// Create a model only once. Next.js can load this code again (hot reload), and creating the same model twice
// would throw an error, so we reuse the existing one if it is already registered.
export function registerModel(name: string, schema: Schema): Model<any> {
  if (mongoose.models[name]) return mongoose.models[name] as Model<any>;
  schema.plugin(timingPlugin);
  return mongoose.model(name, schema);
}
