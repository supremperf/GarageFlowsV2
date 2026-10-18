'use strict'
const fs = require('node:fs')
/** Reads the same opened regular file, never stat(path) followed by read(path).
 * O_NOFOLLOW protects the final component where supported; callers must still
 * control parent directories and concurrent writers. This does not freeze an inode.
 */
function readRegularFile(file, { maxBytes = Infinity, io = fs } = {}) {
  if (!(maxBytes === Infinity || Number.isSafeInteger(maxBytes) && maxBytes >= 0)) throw new Error('Invalid read bound')
  const fd = io.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0))
  try {
    const stat = io.fstatSync(fd)
    if (!stat.isFile()) throw Object.assign(new Error('Regular file required'), { code: 'EISDIR' })
    if (stat.size > maxBytes) throw Object.assign(new Error('Read size limit exceeded'), { code: 'EFBIG' })
    if (maxBytes === Infinity) return io.readFileSync(fd)
    // Enforce the bound even if a concurrent writer grows the opened file.
    const chunks = [], buffer = Buffer.alloc(Math.min(65536, maxBytes + 1))
    let bytes = 0, n
    while ((n = io.readSync(fd, buffer, 0, Math.min(buffer.length, maxBytes + 1 - bytes), null)) > 0) {
      bytes += n
      if (bytes > maxBytes) throw Object.assign(new Error('Read size limit exceeded'), { code: 'EFBIG' })
      chunks.push(Buffer.from(buffer.subarray(0, n)))
    }
    return Buffer.concat(chunks, bytes)
  } finally { io.closeSync(fd) }
}
/** Git records symbolic-link text; do not inventory the linked target's bytes. */
function readGitEntry(file, { io = fs } = {}) {
  try { return Buffer.from(io.readlinkSync(file)) }
  catch (error) {
    if (error.code !== 'EINVAL' && error.code !== 'UNKNOWN') throw error
  }
  return readRegularFile(file, { io })
}
module.exports = { readRegularFile, readGitEntry }
