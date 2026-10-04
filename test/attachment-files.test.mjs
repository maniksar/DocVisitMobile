import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { gzipSync } from 'node:zlib';
import { AttachmentFiles } from '../src/lib/attachment-files.mjs';

test('compressed attachments are saved below the doctor medfiles directory', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'docvisit-medfiles-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const attachments = new AttachmentFiles(directory);
  const attachmentId = randomUUID();
  const compressed = gzipSync(Buffer.from('compressed attachment'));

  await attachments.save('doctor-ava', attachmentId, compressed);

  const expectedPath = resolve(directory, 'doctor-ava', `${attachmentId}.gz`);
  assert.deepEqual(await attachments.read('doctor-ava', attachmentId), compressed);
  assert.deepEqual(await readFile(expectedPath), compressed);
  assert.equal(await attachments.read('doctor-ava', randomUUID()), null);
  await attachments.remove('doctor-ava', attachmentId);
  assert.equal(await attachments.read('doctor-ava', attachmentId), null);
});

test('attachment file paths reject unsafe doctor and attachment IDs', async () => {
  const attachments = new AttachmentFiles('medfiles');

  assert.throws(() => attachments.pathFor('../outside', randomUUID()), /Invalid doctor ID/);
  assert.throws(() => attachments.pathFor('doctor-ava', '../outside'), /Invalid prescription attachment ID/);
});
