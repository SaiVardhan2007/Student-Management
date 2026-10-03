import { ZodError } from 'zod';
import mongoose from 'mongoose';
import multer from 'multer';
import { AppError } from '../utils/AppError.js';
import { formatZodError } from './validate.js';
import { logger } from '../utils/logger.js';
import { env } from '../config/env.js';

export const notFound = (req, _res, next) => next(AppError.notFound(`Route not found: ${req.method} ${req.originalUrl}`));

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  let status = err.statusCode || 500;
  let message = err.message;
  let errors = err.errors;

  if (err instanceof ZodError) {
    status = 400;
    errors = formatZodError(err);
    message = 'Validation failed';
  } else if (err instanceof mongoose.Error.ValidationError) {
    status = 400;
    errors = Object.values(err.errors).map((e) => ({ field: e.path, message: e.message }));
    message = 'Validation failed';
  } else if (err instanceof mongoose.Error.CastError) {
    status = 400;
    message = `Invalid ${err.path}`;
  } else if (err?.code === 11000) {
    status = 409;
    const fields = Object.keys(err.keyPattern || {});
    message = `Duplicate value: ${fields.join(', ') || 'a unique field'} already exists`;
    errors = fields.map((f) => ({ field: f, message: 'Already exists' }));
  } else if (err instanceof multer.MulterError) {
    status = 400;
    message = err.code === 'LIMIT_FILE_SIZE' ? `File is too large (max ${env.maxFileSizeMb} MB)` : `Upload error: ${err.message}`;
  } else if (err.type === 'entity.parse.failed') {
    status = 400;
    message = 'Malformed JSON in request body';
  } else if (err.type === 'entity.too.large') {
    status = 413;
    message = 'Request body too large';
  }

  if (status >= 500) {
    logger.error(`${req.method} ${req.originalUrl} -> ${status}: ${err.message}`, err);
    if (env.isProd) message = 'Internal server error. Please try again later.';
  }

  const body = { success: false, message };
  if (errors) body.errors = errors;
  if (!env.isProd && status >= 500) body.stack = err.stack;
  res.status(status).json(body);
}
