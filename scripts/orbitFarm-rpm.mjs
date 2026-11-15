import * as zlib from 'node:zlib';

const align = (value, boundary) => Math.ceil(value / boundary) * boundary;

function headerEnd(buffer, offset) {
  if (offset + 16 > buffer.length || buffer.subarray(offset, offset + 4).toString('hex') !== '8eade801') {
    throw new Error('Invalid RPM header.');
  }
  const entries = buffer.readUInt32BE(offset + 8);
  const bytes = buffer.readUInt32BE(offset + 12);
  const end = offset + 16 + 16 * entries + bytes;
  if (end > buffer.length) throw new Error('Truncated RPM header.');
  return end;
}

function hexField(buffer, offset) {
  const text = buffer.subarray(offset, offset + 8).toString('ascii');
  if (!/^[a-f0-9]{8}$/i.test(text)) throw new Error('Invalid CPIO numeric field.');
  return Number.parseInt(text, 16);
}

/** Extract only named regular files from a checksum-verified RPM's newc payload.
 * No archive paths are written to disk. Node 24 supplies Zstandard decoding,
 * avoiding a platform-specific tar/zstd installation for release staging.
 */
export function extractRpmFiles(buffer, members) {
  if (buffer.length < 112 || buffer.subarray(0, 4).toString('hex') !== 'edabeedb') {
    throw new Error('Invalid RPM lead.');
  }
  const signatureEnd = headerEnd(buffer, 96);
  const payload = buffer.subarray(headerEnd(buffer, align(signatureEnd, 8)));
  const magic = payload.subarray(0, 4).toString('hex');
  let cpio;
  if (magic === '28b52ffd') {
    if (typeof zlib.zstdDecompressSync !== 'function') throw new Error('Vercel release staging requires Node.js 24 for Zstandard decoding.');
    cpio = zlib.zstdDecompressSync(payload, { maxOutputLength: 16 * 1024 * 1024 });
  } else if (magic.startsWith('1f8b')) {
    cpio = zlib.gunzipSync(payload, { maxOutputLength: 16 * 1024 * 1024 });
  } else {
    throw new Error('Unsupported RPM payload compression.');
  }
  const requested = new Set(members.map(name => name.replace(/^\.\//, '')));
  const found = new Map();
  let offset = 0;
  let trailer = false;
  while (offset + 110 <= cpio.length) {
    if (!['070701', '070702'].includes(cpio.subarray(offset, offset + 6).toString('ascii'))) {
      throw new Error('Invalid newc archive header.');
    }
    const size = hexField(cpio, offset + 54);
    const nameSize = hexField(cpio, offset + 94);
    const nameEnd = offset + 110 + nameSize;
    const dataStart = align(nameEnd, 4);
    const dataEnd = dataStart + size;
    if (nameSize < 1 || nameEnd > cpio.length || dataEnd > cpio.length || cpio[nameEnd - 1] !== 0) {
      throw new Error('Truncated newc archive entry.');
    }
    const name = cpio.subarray(offset + 110, nameEnd - 1).toString('utf8').replace(/^\.\//, '');
    if (name === 'TRAILER!!!') { trailer = true; break; }
    if (requested.has(name)) {
      if ((hexField(cpio, offset + 14) & 0o170000) !== 0o100000 || found.has(name)) {
        throw new Error(`RPM member must be one regular file: ${name}`);
      }
      found.set(name, cpio.subarray(dataStart, dataEnd));
    }
    offset = align(dataEnd, 4);
  }
  if (!trailer) throw new Error('The newc archive has no completion trailer.');
  for (const name of requested) if (!found.has(name)) throw new Error(`Missing RPM member: ${name}`);
  return members.map(name => found.get(name.replace(/^\.\//, '')));
}
