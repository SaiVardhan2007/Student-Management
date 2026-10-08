// Tiny console logger. Silent during tests; prints JSON lines in production.
const quiet = process.env.NODE_ENV === 'test';
const json = process.env.NODE_ENV === 'production' || process.env.LOG_FORMAT === 'json';

function write(level: string, msg: string, extra?: string) {
  if (quiet) return;
  const ts = new Date().toISOString();
  const line = json ? JSON.stringify({ ts, level, msg, ...(extra ? { stack: extra } : {}) }) : `${ts} [${level}] ${msg}${extra ? ' ' + extra : ''}`;
  (level === 'ERROR' ? console.error : console.log)(line);
}

export const logger = {
  info: (m: string) => write('INFO', m),
  warn: (m: string) => write('WARN', m),
  error: (m: string, err?: any) => write('ERROR', m, err?.stack || ''),
};
