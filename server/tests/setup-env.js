// Runs before each test file: keep test uploads out of the real uploads folder.
import os from 'os';
import path from 'path';

process.env.UPLOAD_DIR = path.join(os.tmpdir(), 'sms-test-uploads');
