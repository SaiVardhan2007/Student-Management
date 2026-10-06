import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { env } from './env';
import { AppError } from './errors';

export const UPLOAD_CATEGORIES = [
  'assignments',
  'submissions',
  'materials',
  'documents',
  'notices',
  'complaints',
  'achievements',
  'photos',
  'misc',
];

const ALLOWED: Record<string, string[]> = {
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
const MAX_FILES = 5;

/** Magic-number check: the content must match the extension (the MIME type is client-supplied). */
const SIGNATURES: Record<string, number[][]> = {
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

export interface UploadSpec {
  /** sub-folder of the upload dir (see UPLOAD_CATEGORIES) */
  category: string;
  /** form field that carries the file(s) */
  field?: string;
  /** accept several files under the field (max 5) */
  multiple?: boolean;
  /** restrict to images */
  imageOnly?: boolean;
  /** CSV imports are parsed in memory and never written to disk */
  csvInMemory?: boolean;
}

export interface UploadedFile {
  fieldname: string;
  originalname: string;
  mimetype: string;
  size: number;
  /** stored (random) file name — absent for in-memory uploads */
  filename?: string;
  /** absolute path on disk — absent for in-memory uploads */
  path?: string;
  buffer?: Buffer;
}

export const uploadSingle = (category: string, field = 'file'): UploadSpec => ({ category, field });
export const uploadMany = (category: string, field = 'files'): UploadSpec => ({ category, field, multiple: true });
export const uploadImage = (category: string, field = 'file'): UploadSpec => ({ category, field, imageOnly: true });
export const uploadCsv: UploadSpec = { category: 'misc', field: 'file', csvInMemory: true };

function checkType(name: string, mime: string, exts: string[]) {
  const ext = path.extname(name).toLowerCase();
  const mimes = ALLOWED[ext];
  if (!exts.includes(ext) || !mimes || !mimes.includes(mime)) {
    throw AppError.badRequest(`File type not allowed (${ext || 'unknown'}). Allowed: ${exts.join(', ')}`);
  }
}

function signatureOk(name: string, head: Buffer) {
  const ext = path.extname(name).toLowerCase();
  if (ext === '.txt' || ext === '.csv') return !head.includes(0); // plain text has no NUL bytes
  const sigs = SIGNATURES[ext];
  return !sigs || sigs.some((sig) => sig.every((b, i) => head[i] === b));
}

export type ParsedMultipart = { fields: Record<string, any>; files: UploadedFile[] };

/**
 * Parse a multipart/form-data request: validates type (extension + MIME + magic bytes), size and count, then writes
 * accepted files to the local upload directory under a random name.
 */
export async function parseMultipart(request: Request, spec: UploadSpec): Promise<ParsedMultipart> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw AppError.badRequest('Malformed multipart form data');
  }
  const field = spec.field || 'file';
  const exts = spec.csvInMemory ? ['.csv'] : spec.imageOnly ? IMAGE_ONLY : Object.keys(ALLOWED);
  const maxBytes = spec.csvInMemory ? 5 * 1024 * 1024 : env.maxFileSizeMb * 1024 * 1024;
  const maxFiles = spec.csvInMemory ? 1 : spec.multiple ? MAX_FILES : 1;

  const fields: Record<string, any> = {};
  const incoming: { name: string; file: File }[] = [];
  for (const [name, value] of form.entries()) {
    if (typeof value === 'string') {
      if (name in fields) fields[name] = Array.isArray(fields[name]) ? [...fields[name], value] : [fields[name], value];
      else fields[name] = value;
    } else if (value.size === 0 && !value.name) {
      continue; // empty file input
    } else {
      if (name !== field) throw AppError.badRequest('Upload error: Unexpected field');
      incoming.push({ name, file: value });
    }
  }
  if (incoming.length > maxFiles) throw AppError.badRequest('Upload error: Too many files');

  const prepared: { file: File; buffer: Buffer }[] = [];
  for (const { file } of incoming) {
    if (file.size > maxBytes) {
      throw AppError.badRequest(`File is too large (max ${spec.csvInMemory ? 5 : env.maxFileSizeMb} MB)`);
    }
    checkType(file.name, file.type, exts);
    const buffer = Buffer.from(await file.arrayBuffer());
    if (!signatureOk(file.name, buffer.subarray(0, 512))) {
      throw AppError.badRequest(`"${file.name}" does not look like a valid ${path.extname(file.name).slice(1).toUpperCase()} file`);
    }
    prepared.push({ file, buffer });
  }

  const files: UploadedFile[] = [];
  if (spec.csvInMemory) {
    for (const { file, buffer } of prepared)
      files.push({ fieldname: field, originalname: file.name, mimetype: file.type, size: file.size, buffer });
  } else {
    const dir = path.join(env.uploadDir, spec.category);
    await fs.promises.mkdir(dir, { recursive: true });
    try {
      for (const { file, buffer } of prepared) {
        const filename = `${crypto.randomBytes(16).toString('hex')}${path.extname(file.name).toLowerCase()}`;
        const abs = path.join(dir, filename);
        await fs.promises.writeFile(abs, buffer);
        files.push({ fieldname: field, originalname: file.name, mimetype: file.type, size: file.size, filename, path: abs });
      }
    } catch (err) {
      await removeUploadedFiles(files);
      throw err;
    }
  }
  return { fields, files };
}

/** Convert an uploaded file to the metadata stored in MongoDB. */
export const toFileMeta = (file: UploadedFile | undefined, category: string) =>
  file && {
    path: `${category}/${file.filename}`,
    originalName: file.originalname.slice(0, 200),
    mimeType: file.mimetype,
    size: file.size,
  };

/** Best-effort removal of a stored file (e.g. when it is replaced or the DB write fails). */
export function removeFile(meta: any) {
  const rel = typeof meta === 'string' ? meta : meta?.path;
  if (!rel) return;
  const abs = path.resolve(env.uploadDir, rel);
  if (abs.startsWith(path.resolve(env.uploadDir) + path.sep)) fs.promises.unlink(abs).catch(() => {});
}

export async function removeUploadedFiles(files: UploadedFile[]) {
  await Promise.all(files.filter((f) => f.path).map((f) => fs.promises.unlink(f.path!).catch(() => {})));
}
