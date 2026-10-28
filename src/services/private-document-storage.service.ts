import { randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { env } from '../config/env.js';

/** Private object storage contract; references are opaque keys, never public URLs. */
export interface DocumentStorageProvider {
  put(bytes: Buffer): Promise<{ reference: string }>;
  get(reference: string): Promise<Buffer>;
  delete(reference: string): Promise<void>;
}

export class LocalPrivateDocumentStorage implements DocumentStorageProvider {
  private readonly root = path.resolve(env.PRIVATE_DOCUMENT_STORAGE_PATH);

  async put(bytes: Buffer): Promise<{ reference: string }> {
    const key = randomUUID();
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    await writeFile(path.join(this.root, key), bytes, { flag: 'wx', mode: 0o600 });
    return { reference: `private:${key}` };
  }

  async get(reference: string): Promise<Buffer> {
    return readFile(this.resolveReference(reference));
  }

  async delete(reference: string): Promise<void> {
    try { await unlink(this.resolveReference(reference)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }

  private resolveReference(reference: string) {
    const match = /^private:([0-9a-f-]{36})$/i.exec(reference);
    if (!match) throw new Error('Invalid private document reference');
    const target = path.resolve(this.root, match[1]!);
    if (path.dirname(target) !== this.root) throw new Error('Invalid private document reference');
    return target;
  }
}

export const documentStorage: DocumentStorageProvider = new LocalPrivateDocumentStorage();
