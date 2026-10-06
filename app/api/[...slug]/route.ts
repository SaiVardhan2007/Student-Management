import { apiNotFound } from '@/lib/api';

// any /api path that matches no route handler gets the standard 404 envelope
export const GET = apiNotFound;
export const POST = apiNotFound;
export const PUT = apiNotFound;
export const PATCH = apiNotFound;
export const DELETE = apiNotFound;
