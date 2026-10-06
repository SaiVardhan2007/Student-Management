// Runs before each test file: keep test uploads out of the real uploads folder and never touch the dev database.
import os from 'os';
import path from 'path';

process.env.UPLOAD_DIR = path.join(os.tmpdir(), 'sms-test-uploads');
process.env.JWT_SECRET = 'test-access-secret-test-access-secret-0123456789';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-test-refresh-secret-0123456789';
// an accidental connectDB() must fail loudly rather than reach a real database
process.env.MONGODB_URI = 'mongodb://127.0.0.1:1/never-used-in-tests';
