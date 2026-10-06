import mongoose, { type Model, type Schema } from 'mongoose';

mongoose.set('strictQuery', true);

/**
 * Register a model once. Next.js re-evaluates modules on hot reload (and in separate route bundles), so a plain
 * `mongoose.model(name, schema)` would throw OverwriteModelError.
 */
export function registerModel(name: string, schema: Schema): Model<any> {
  return (mongoose.models[name] as Model<any>) || mongoose.model(name, schema);
}
