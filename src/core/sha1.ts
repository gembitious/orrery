/**
 * SHA-1 (RFC 3174) 순수 TS 동기 구현.
 *
 * Web Crypto의 `crypto.subtle.digest`는 Promise를 반환하므로, 이를 쓰면
 * 코어의 모든 명령 함수 `(repo, args) → CommandResult`가 async로 전염된다.
 * 코어를 순수 동기 함수로 유지하기 위해 SHA-1을 직접 vendored로 포함한다.
 * (git의 객체 해싱 용도 — 암호학적 보안 용도가 아님)
 */

function rotl(x: number, n: number): number {
  return ((x << n) | (x >>> (32 - n))) >>> 0;
}

/** 바이트 배열의 SHA-1 해시를 40자 소문자 hex 문자열로 반환한다. */
export function sha1Hex(data: Uint8Array): string {
  // 패딩: 메시지 + 0x80 + (0 채움) + 64비트 big-endian 비트 길이, 총 길이는 64바이트 배수
  const byteLen = data.length;
  const paddedLen = Math.ceil((byteLen + 1 + 8) / 64) * 64;
  const padded = new Uint8Array(paddedLen);
  padded.set(data);
  padded[byteLen] = 0x80;

  const view = new DataView(padded.buffer);
  const bitLen = byteLen * 8;
  // JS number는 2^53까지 정확하므로 상위/하위 32비트로 쪼개 기록
  view.setUint32(paddedLen - 8, Math.floor(bitLen / 0x1_0000_0000));
  view.setUint32(paddedLen - 4, bitLen >>> 0);

  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;

  const w = new Uint32Array(80);

  for (let block = 0; block < paddedLen; block += 64) {
    for (let t = 0; t < 16; t++) {
      w[t] = view.getUint32(block + t * 4);
    }
    for (let t = 16; t < 80; t++) {
      w[t] = rotl(w[t - 3] ^ w[t - 8] ^ w[t - 14] ^ w[t - 16], 1);
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;

    for (let t = 0; t < 80; t++) {
      let f: number;
      let k: number;
      if (t < 20) {
        f = (b & c) | (~b & d);
        k = 0x5a827999;
      } else if (t < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (t < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6;
      }
      const temp = (rotl(a, 5) + f + e + k + w[t]) >>> 0;
      e = d;
      d = c;
      c = rotl(b, 30);
      b = a;
      a = temp;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
  }

  return [h0, h1, h2, h3, h4].map((h) => h.toString(16).padStart(8, '0')).join('');
}
