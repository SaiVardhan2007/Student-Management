import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const logDir = path.resolve(__dirname, '..', 'logs');
const quiet = process.env.NODE_ENV === 'test';

const json = process.env.NODE_ENV === 'production' || process.env.LOG_FORMAT === 'json';
// in containers logs go to stdout/stderr only; set LOG_TO_FILE=true to also keep logs/error.log
const toFile = !json || process.env.LOG_TO_FILE === 'true';

function write(level, msg, extra) {
  const ts = new Date().toISOString();
  const line = json
    ? JSON.stringify({ ts, level, msg, ...(extra ? { stack: extra } : {}) })
    : `${ts} [${level}] ${msg}${extra ? ' ' + extra : ''}`;
  if (!quiet) (level === 'ERROR' ? console.error : console.log)(line);
  if (level === 'ERROR' && !quiet && toFile) {
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
