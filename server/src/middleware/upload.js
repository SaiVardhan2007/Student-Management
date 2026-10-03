import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';

export const UPLOAD_CATEGORIES = ['assignments', 'submissions', 'materials', 'documents', 'notices', 'complaints', 'achievements', 'photos', 'misc'];

const ALLOWED = {
  '.pdf': ['application/pdf'],
  '.doc': ['application/msword'],
  '.docx': ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  '.ppt': ['application/vnd.ms-powerpoint'],
  '.pptx': ['application/vnd.openxmlformats-officedocument.presentationml.presentation'],
  '.xls': ['application/vnd.ms-excel'],
  '.xlsx': ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  '.txt': ['text/plain'],
  '.csv': ['text/csv', 'application/vnd.ms-excel', 'text/plain'],
  '.png': ['image/png'],
  '.jpg': ['image/jpeg'],
  '.jpeg': ['image/jpeg'],
  '.zip': ['application/zip', 'application/x-zip-compressed'],
};
const IMAGE_ONLY = ['.png', '.jpg', '.jpeg'];

fs.mkdirSync(env.uploadDir, { recursive: true });

function makeFilter(exts) {
  return (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const mimes = ALLOWED[ext];
    if (!exts.includes(ext) || !mimes || !mimes.includes(file.mimetype)) {
      return cb(AppError.badRequest(`File type not allowed (${ext || 'unknown'}). Allowed: ${exts.join(', ')}`));
    }
    cb(null, true);
  };
}

function diskStorage(category) {
  const dir = path.join(env.uploadDir, category);
  fs.mkdirSync(dir, { recursive: true });
  return multer.diskStorage({
    destination: dir,
    filename: (_req, file, cb) =>
      cb(null, `${crypto.randomBytes(16).toString('hex')}${path.extname(file.originalname).toLowerCase()}`),
  });
}

const limits = { fileSize: env.maxFileSizeMb * 1024 * 1024, files: 5 };

const build = (category, exts) => multer({ storage: diskStorage(category), fileFilter: makeFilter(exts), limits });

/** Magic-number check: the content must match the extension (the MIME type is client-supplied). */
const SIGNATURES = {
  '.pdf': [[0x25, 0x50, 0x44, 0x46]],
  '.png': [[0x89, 0x50, 0x4e, 0x47]],
  '.jpg': [[0xff, 0xd8, 0xff]],
  '.jpeg': [[0xff, 0xd8, 0xff]],
  '.zip': [[0x50, 0x4b]],
  '.docx': [[0x50, 0x4b]],
  '.xlsx': [[0x50, 0x4b]],
  '.pptx': [[0x50, 0x4b]],
  '.doc': [[0xd0, 0xcf, 0x11, 0xe0]],
  '.xls': [[0xd0, 0xcf, 0x11, 0xe0]],
  '.ppt': [[0xd0, 0xcf, 0x11, 0xe0]],
};

async function signatureOk(file) {
  const ext = path.extname(file.originalname).toLowerCase();
  const head = file.buffer ? file.buffer.subarray(0, 512) : await readHead(file.path);
  if (ext === '.txt' || ext === '.csv') return !head.includes(0); // plain text has no NUL bytes
  const sigs = SIGNATURES[ext];
  return !sigs || sigs.some((sig) => sig.every((b, i) => head[i] === b));
}

async function readHead(filePath) {
  const fh = await fs.promises.open(filePath, 'r');
  try {
    const buf = Buffer.alloc(512);
    const { bytesRead } = await fh.read(buf, 0, 512, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}

/** Wrap a multer middleware so uploaded content is verified; bad files are deleted and rejected. */
const verified = (mw) => (req, res, next) =>
  mw(req, res, async (err) => {
    if (err) return next(err);
    try {
      const files = req.files || (req.file ? [req.file] : []);
      for (const f of files) {
        if (!(await signatureOk(f))) {
          files.forEach((x) => x.path && fs.promises.unlink(x.path).catch(() => {}));
          return next(AppError.badRequest(`"${f.originalname}" does not look like a valid ${path.extname(f.originalname).slice(1).toUpperCase()} file`));
        }
      }
      next();
    } catch (e) {
      next(e);
    }
  });

export const uploadSingle = (category, field = 'file', exts = Object.keys(ALLOWED)) => verified(build(category, exts).single(field));
export const uploadMany = (category, field = 'files', exts = Object.keys(ALLOWED)) => verified(build(category, exts).array(field, 5));
export const uploadImage = (category, field = 'file') => verified(build(category, IMAGE_ONLY).single(field));

/** CSV uploads are parsed in memory and never written to disk. */
export const uploadCsv = verified(
  multer({
    storage: multer.memoryStorage(),
    fileFilter: makeFilter(['.csv']),
    limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  }).single('file')
);

/** Convert a multer file to the metadata stored in MongoDB. */
export const toFileMeta = (file, category) =>
  file && {
    path: `${category}/${file.filename}`,
    originalName: file.originalname.slice(0, 200),
    mimeType: file.mimetype,
    size: file.size,
  };

/** Best-effort removal of an uploaded file (e.g. when the DB write fails). */
export function removeFile(meta) {
  const rel = typeof meta === 'string' ? meta : meta?.path;
  if (!rel) return;
  const abs = path.resolve(env.uploadDir, rel);
  if (abs.startsWith(path.resolve(env.uploadDir) + path.sep)) fs.promises.unlink(abs).catch(() => {});
}

export const removeUploaded = (req) => {
  const files = req.files || (req.file ? [req.file] : []);
  for (const f of files) fs.promises.unlink(f.path).catch(() => {});
};
