import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const logDir = path.resolve(__dirname, '..', 'logs');
const quiet = process.env.NODE_ENV === 'test';

function write(level, msg, extra) {
  const line = `${new Date().toISOString()} [${level}] ${msg}${extra ? ' ' + extra : ''}`;
  if (!quiet) (level === 'ERROR' ? console.error : console.log)(line);
  if (level === 'ERROR' && !quiet) {
    try {
      fs.mkdirSync(logDir, { recursive: true });
      fs.appendFileSync(path.join(logDir, 'error.log'), line + '\n');
    } catch {
      /* logging must never crash the app */
    }
  }
}

export const logger = {
  info: (m) => write('INFO', m),
  warn: (m) => write('WARN', m),
  error: (m, err) => write('ERROR', m, err?.stack || ''),
};
