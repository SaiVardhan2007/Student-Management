export class AppError extends Error {
  constructor(message, statusCode = 400, errors = undefined) {
    super(message);
    this.statusCode = statusCode;
    this.errors = errors;
    this.isOperational = true;
  }
  static badRequest(m, errors) {
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
  static conflict(m, errors) {
    return new AppError(m, 409, errors);
  }
}
