// Where uploaded files live: the local disk (default) or MongoDB GridFS (STORAGE=gridfs, for hosts without a persistent disk).
import path from 'path';
import fs from 'fs';
import mongoose from 'mongoose';
import { env } from './env';
import { connectDB } from './mongodb';

const isGridFs = () => env.storage === 'gridfs';

async function bucket() {
  await connectDB();
  return new mongoose.mongo.GridFSBucket(mongoose.connection.db!, { bucketName: 'uploads' });
}

/** Store a file under "<category>/<filename>". */
export async function putFile(category: string, filename: string, data: Buffer, contentType?: string) {
  if (isGridFs()) {
    const b = await bucket();
    await new Promise<void>((resolve, reject) => {
      const stream = b.openUploadStream(`${category}/${filename}`, { metadata: { contentType } });
      stream.on('error', reject).on('finish', () => resolve());
      stream.end(data);
    });
    return;
  }
  const dir = path.join(env.uploadDir, category);
  await fs.promises.mkdir(dir, { recursive: true });
  await fs.promises.writeFile(path.join(dir, filename), data);
}

/** Read a stored file, or null when it does not exist. */
export async function getFile(category: string, filename: string): Promise<Buffer | null> {
  if (isGridFs()) {
    const b = await bucket();
    const chunks: Buffer[] = [];
    try {
      for await (const chunk of b.openDownloadStreamByName(`${category}/${filename}`)) chunks.push(chunk as Buffer);
    } catch (err: any) {
      if (err?.code === 'ENOENT' || /FileNotFound/i.test(err?.message || '')) return null;
      throw err;
    }
    return Buffer.concat(chunks);
  }
  const abs = path.resolve(env.uploadDir, category, filename);
  // extra safety against path traversal (e.g. "../")
  if (!abs.startsWith(path.resolve(env.uploadDir) + path.sep) || !fs.existsSync(abs)) return null;
  return fs.promises.readFile(abs);
}

/** Best-effort delete of "<category>/<filename>". */
export async function deleteFile(rel: string) {
  try {
    if (isGridFs()) {
      const b = await bucket();
      const docs = await b.find({ filename: rel }).toArray();
      await Promise.all(docs.map((d) => b.delete(d._id)));
      return;
    }
    const abs = path.resolve(env.uploadDir, rel);
    if (abs.startsWith(path.resolve(env.uploadDir) + path.sep)) await fs.promises.unlink(abs);
  } catch {
    /* already gone */
  }
}
