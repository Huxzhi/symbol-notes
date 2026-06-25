// 内容哈希(MurmurHash3 x86_128, 128-bit, 同步, 不依赖 crypto.subtle)。输出 32 hex。
// 作解析缓存的键:path→hash(vault statCache)→FileCache(metadata parsedCache)。

function fmix32(h: number): number {
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0
  return (h ^ (h >>> 16)) >>> 0
}

export function hashContent(str: string): string {
  const bytes = new TextEncoder().encode(str)
  const len = bytes.length
  const nblocks = (len / 16) | 0
  const c1 = 0x239b961b, c2 = 0xab0e9789, c3 = 0x38b34ae5, c4 = 0xa1e38b93
  let h1 = 0, h2 = 0, h3 = 0, h4 = 0

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  for (let i = 0; i < nblocks; i++) {
    const b = i << 4
    let k1 = view.getUint32(b,      true)
    let k2 = view.getUint32(b + 4,  true)
    let k3 = view.getUint32(b + 8,  true)
    let k4 = view.getUint32(b + 12, true)

    k1 = Math.imul(k1, c1) >>> 0; k1 = ((k1 << 15) | (k1 >>> 17)) >>> 0; k1 = Math.imul(k1, c2) >>> 0
    h1 ^= k1; h1 = ((h1 << 19) | (h1 >>> 13)) >>> 0; h1 = (h1 + h2) >>> 0; h1 = (Math.imul(h1, 5) + 0x561ccd1b) >>> 0

    k2 = Math.imul(k2, c2) >>> 0; k2 = ((k2 << 16) | (k2 >>> 16)) >>> 0; k2 = Math.imul(k2, c3) >>> 0
    h2 ^= k2; h2 = ((h2 << 17) | (h2 >>> 15)) >>> 0; h2 = (h2 + h3) >>> 0; h2 = (Math.imul(h2, 5) + 0x0bcaa747) >>> 0

    k3 = Math.imul(k3, c3) >>> 0; k3 = ((k3 << 17) | (k3 >>> 15)) >>> 0; k3 = Math.imul(k3, c4) >>> 0
    h3 ^= k3; h3 = ((h3 << 15) | (h3 >>> 17)) >>> 0; h3 = (h3 + h4) >>> 0; h3 = (Math.imul(h3, 5) + 0x96cd1c35) >>> 0

    k4 = Math.imul(k4, c4) >>> 0; k4 = ((k4 << 18) | (k4 >>> 14)) >>> 0; k4 = Math.imul(k4, c1) >>> 0
    h4 ^= k4; h4 = ((h4 << 13) | (h4 >>> 19)) >>> 0; h4 = (h4 + h1) >>> 0; h4 = (Math.imul(h4, 5) + 0x32ac3b17) >>> 0
  }

  const off = nblocks << 4
  let k1 = 0, k2 = 0, k3 = 0, k4 = 0
  /* eslint-disable no-fallthrough */
  switch (len & 15) {
    case 15: k4 ^= bytes[off + 14] << 16 // falls through
    case 14: k4 ^= bytes[off + 13] << 8  // falls through
    case 13: k4 ^= bytes[off + 12]
      k4 = Math.imul(k4, c4) >>> 0; k4 = ((k4 << 18) | (k4 >>> 14)) >>> 0; k4 = Math.imul(k4, c1) >>> 0; h4 ^= k4
      // falls through
    case 12: k3 ^= bytes[off + 11] << 24 // falls through
    case 11: k3 ^= bytes[off + 10] << 16 // falls through
    case 10: k3 ^= bytes[off + 9] << 8   // falls through
    case  9: k3 ^= bytes[off + 8]
      k3 = Math.imul(k3, c3) >>> 0; k3 = ((k3 << 17) | (k3 >>> 15)) >>> 0; k3 = Math.imul(k3, c4) >>> 0; h3 ^= k3
      // falls through
    case  8: k2 ^= bytes[off + 7] << 24  // falls through
    case  7: k2 ^= bytes[off + 6] << 16  // falls through
    case  6: k2 ^= bytes[off + 5] << 8   // falls through
    case  5: k2 ^= bytes[off + 4]
      k2 = Math.imul(k2, c2) >>> 0; k2 = ((k2 << 16) | (k2 >>> 16)) >>> 0; k2 = Math.imul(k2, c3) >>> 0; h2 ^= k2
      // falls through
    case  4: k1 ^= bytes[off + 3] << 24  // falls through
    case  3: k1 ^= bytes[off + 2] << 16  // falls through
    case  2: k1 ^= bytes[off + 1] << 8   // falls through
    case  1: k1 ^= bytes[off]
      k1 = Math.imul(k1, c1) >>> 0; k1 = ((k1 << 15) | (k1 >>> 17)) >>> 0; k1 = Math.imul(k1, c2) >>> 0; h1 ^= k1
  }
  /* eslint-enable no-fallthrough */

  h1 ^= len; h2 ^= len; h3 ^= len; h4 ^= len
  h1 = (h1 + h2 + h3 + h4) >>> 0
  h2 = (h2 + h1) >>> 0; h3 = (h3 + h1) >>> 0; h4 = (h4 + h1) >>> 0
  h1 = fmix32(h1); h2 = fmix32(h2); h3 = fmix32(h3); h4 = fmix32(h4)
  h1 = (h1 + h2 + h3 + h4) >>> 0
  h2 = (h2 + h1) >>> 0; h3 = (h3 + h1) >>> 0; h4 = (h4 + h1) >>> 0

  return h1.toString(16).padStart(8, '0')
       + h2.toString(16).padStart(8, '0')
       + h3.toString(16).padStart(8, '0')
       + h4.toString(16).padStart(8, '0')
}
