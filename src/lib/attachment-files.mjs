import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';

export class AttachmentFiles {
  constructor(directory) {
    this.directory = resolve(directory);
  }

  pathFor(doctorId, attachmentId) {
    if (typeof doctorId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{2,31}$/.test(doctorId)) {
      throw new Error('Invalid doctor ID for prescription attachment storage.');
    }
    if (typeof attachmentId !== 'string' || !/^[\da-f]{8}-[\da-f]{4}-[1-8][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(attachmentId)) {
      throw new Error('Invalid prescription attachment ID for file storage.');
    }
    const doctorDirectory = resolve(this.directory, doctorId);
    if (!doctorDirectory.startsWith(`${this.directory}${sep}`)) {
      throw new Error('Invalid doctor directory for prescription attachment storage.');
    }
    return resolve(doctorDirectory, `${attachmentId}.gz`);
  }

  async save(doctorId, attachmentId, data) {
    const filePath = this.pathFor(doctorId, attachmentId);
    await mkdir(dirname(filePath), { recursive: true, mode: 0o700 });
    await writeFile(filePath, data, { mode: 0o600 });
  }

  async read(doctorId, attachmentId) {
    try {
      return await readFile(this.pathFor(doctorId, attachmentId));
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }

  async remove(doctorId, attachmentId) {
    await rm(this.pathFor(doctorId, attachmentId), { force: true });
  }
}
