import mongoose, { type Model, type Schema } from 'mongoose';

mongoose.set('strictQuery', true);

// Create a model only once. Next.js can load this code again (hot reload), and creating the same model twice
// would throw an error, so we reuse the existing one if it is already registered.
export function registerModel(name: string, schema: Schema): Model<any> {
  return (mongoose.models[name] as Model<any>) || mongoose.model(name, schema);
}
