// AppError: the error class services throw on purpose; lib/api.ts turns it into a JSON response with the right status code.
export type FieldError = { field: string; message: string };

export class AppError extends Error {
  statusCode: number;
  errors?: FieldError[];
  isOperational = true;

  constructor(message: string, statusCode = 400, errors?: FieldError[]) {
    super(message);
    this.statusCode = statusCode;
    this.errors = errors;
  }
  static badRequest(m: string, errors?: FieldError[]) {
    return new AppError(m, 400, errors);
  }
  static unauthorized(m = 'Authentication required') {
    return new AppError(m, 401);
  }
  static forbidden(m = 'You do not have permission to perform this action') {
    return new AppError(m, 403);
  }
  static notFound(m = 'Resource not found') {
    return new AppError(m, 404);
  }
  static conflict(m: string, errors?: FieldError[]) {
    return new AppError(m, 409, errors);
  }
}
