import assert from 'node:assert/strict';
import test from 'node:test';
import { zstdCompressSync } from 'node:zlib';
import { extractRpmFiles } from './orbitFarm-rpm.mjs';

const pad4 = length => Buffer.alloc((4 - length % 4) % 4);
const hex = value => value.toString(16).padStart(8, '0');

function entry(name, content = Buffer.alloc(0), mode = 0o100644) {
  const filename = Buffer.from(name + '\0');
  const fields = [1, mode, 0, 0, 1, 0, content.length, 0, 0, 0, 0, filename.length, 0];
  const header = Buffer.from('070701' + fields.map(hex).join(''));
  return Buffer.concat([header, filename, pad4(header.length + filename.length), content, pad4(content.length)]);
}

function rpm(entries) {
  const lead = Buffer.alloc(96);
  lead.writeUInt32BE(0xedabeedb);
  const header = Buffer.alloc(16);
  Buffer.from('8eade801', 'hex').copy(header);
  return Buffer.concat([lead, header, header,
    zstdCompressSync(Buffer.concat([...entries, entry('TRAILER!!!', Buffer.alloc(0), 0)]))]);
}

test('extracts aligned regular members by name without writing archive paths', () => {
  const library = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 1, 2, 3]);
  const license = Buffer.from('Expat license text');
  const source = rpm([entry('./usr/lib64/library.so', library), entry('./license', license)]);
  assert.deepEqual(extractRpmFiles(source, ['./license', 'usr/lib64/library.so']), [license, library]);
});

test('rejects truncated headers and missing requested members', () => {
  const source = rpm([entry('license', Buffer.from('license'))]);
  assert.throws(() => extractRpmFiles(source.subarray(0, 105), ['license']), /Invalid RPM/);
  assert.throws(() => extractRpmFiles(source, ['absent']), /Missing RPM member/);
});

test('does not substitute symlinks or duplicate members for a native library', () => {
  assert.throws(() => extractRpmFiles(rpm([entry('library.so', Buffer.from('other.so'), 0o120777)]), ['library.so']), /regular file/);
  const duplicate = rpm([entry('library.so', Buffer.from('first')), entry('library.so', Buffer.from('second'))]);
  assert.throws(() => extractRpmFiles(duplicate, ['library.so']), /regular file/);
});

test('rejects an incomplete CPIO payload even when a requested file occurs', () => {
  const source = rpm([entry('license', Buffer.from('license'))]);
  assert.throws(() => extractRpmFiles(source.subarray(0, source.length - 5), ['license']));
});
