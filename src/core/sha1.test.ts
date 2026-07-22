import { describe, expect, it } from 'vitest';
import { sha1Hex } from './sha1';

const encoder = new TextEncoder();

// 표준 테스트 벡터 (RFC 3174 + node crypto로 대조)
describe('sha1Hex', () => {
  it('빈 입력', () => {
    expect(sha1Hex(new Uint8Array(0))).toBe('da39a3ee5e6b4b0d3255bfef95601890afd80709');
  });

  it('"abc"', () => {
    expect(sha1Hex(encoder.encode('abc'))).toBe('a9993e364706816aba3e25717850c26c9cd0d89d');
  });

  it('"The quick brown fox jumps over the lazy dog"', () => {
    expect(sha1Hex(encoder.encode('The quick brown fox jumps over the lazy dog'))).toBe(
      '2fd4e1c67a2d28fced849ee1bb76e7391b93eb12',
    );
  });

  it('멀티 블록 입력 (1000바이트, 64바이트 블록 경계 넘김)', () => {
    expect(sha1Hex(encoder.encode('a'.repeat(1000)))).toBe(
      '291e9a6c66994949b57ba5e650361e98fc36b1ba',
    );
  });

  it('패딩 경계: 55/56/64바이트 입력도 길이 필드가 올바르게 들어간다', () => {
    // 55바이트: 패딩(0x80 + 길이 8바이트)이 같은 블록에 들어가는 최대 길이
    // 56바이트: 길이 필드가 다음 블록으로 밀리는 최소 길이
    const expected: Record<number, string> = {
      55: '8e8832c642a6a38c74c17fc92ccedc266c108e6c',
      56: '9438e360f578e12c0e0e8ed28e2c125c1cefee16',
      64: 'c8d7d0ef0eedfa82d2ea1aa592845b9a6d4b02b7',
    };
    for (const [n, hash] of Object.entries(expected)) {
      expect(sha1Hex(new Uint8Array(Number(n)))).toBe(hash);
    }
  });
});
