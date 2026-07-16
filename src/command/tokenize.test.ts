import { describe, expect, it } from 'vitest';
import { TokenizeError, tokenize } from './tokenize';

describe('tokenize', () => {
  it('공백으로 토큰을 나눈다', () => {
    expect(tokenize('git add f.txt')).toEqual([
      { value: 'git', quoted: false },
      { value: 'add', quoted: false },
      { value: 'f.txt', quoted: false },
    ]);
  });

  it('연속 공백과 탭, 앞뒤 공백을 무시한다', () => {
    expect(tokenize('  git \t status  ').map((t) => t.value)).toEqual(['git', 'status']);
  });

  it('빈 입력은 빈 배열', () => {
    expect(tokenize('')).toEqual([]);
    expect(tokenize('   ')).toEqual([]);
  });

  it('큰따옴표로 공백을 포함한 토큰을 만든다', () => {
    expect(tokenize('echo "hello world" > f.txt')).toEqual([
      { value: 'echo', quoted: false },
      { value: 'hello world', quoted: true },
      { value: '>', quoted: false },
      { value: 'f.txt', quoted: false },
    ]);
  });

  it('작은따옴표도 지원한다', () => {
    expect(tokenize("git commit -m 'first commit'").map((t) => t.value)).toEqual([
      'git', 'commit', '-m', 'first commit',
    ]);
  });

  it('따옴표 안의 다른 따옴표는 문자 그대로', () => {
    expect(tokenize(`echo "it's fine"`)[1]).toEqual({ value: "it's fine", quoted: true });
  });

  it('따옴표 구간과 비따옴표 구간이 섞인 토큰을 이어붙인다', () => {
    expect(tokenize('echo a"b c"d')[1]).toEqual({ value: 'ab cd', quoted: true });
  });

  it('빈 따옴표는 빈 토큰이 된다', () => {
    expect(tokenize('echo "" > f.txt')[1]).toEqual({ value: '', quoted: true });
  });

  it('따옴표로 감싼 >는 quoted로 표시된다 (리다이렉션과 구분)', () => {
    const tokens = tokenize('echo ">" > f.txt');
    expect(tokens[1]).toEqual({ value: '>', quoted: true });
    expect(tokens[2]).toEqual({ value: '>', quoted: false });
  });

  it('닫히지 않은 따옴표는 TokenizeError', () => {
    expect(() => tokenize('echo "abc')).toThrow(TokenizeError);
  });
});
