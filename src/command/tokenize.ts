/**
 * 셸 스타일 토크나이저.
 *
 * 정규식 조합 대신 문자 단위 스캔으로 구현한다 — 이후 `-m "msg"`, `--hard` 같은
 * 옵션 파싱이 전부 이 토큰 스트림 위에 올라간다.
 *
 * `quoted` 플래그를 남기는 이유: `echo ">" > f.txt`에서 첫 `>`는 내용이고
 * 둘째 `>`만 리다이렉션이다. 따옴표 여부를 잃으면 이를 구분할 수 없다.
 */
export interface Token {
  value: string;
  /** 토큰의 일부라도 따옴표로 감싸져 있었으면 true */
  quoted: boolean;
}

export class TokenizeError extends Error {}

const WHITESPACE = new Set([' ', '\t']);

export function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < input.length) {
    while (i < input.length && WHITESPACE.has(input[i])) i++;
    if (i >= input.length) break;

    let value = '';
    let quoted = false;
    // 공백을 만날 때까지가 한 토큰. `a"b c"d`처럼 따옴표 구간이 섞이면 이어붙인다.
    while (i < input.length && !WHITESPACE.has(input[i])) {
      const ch = input[i];
      if (ch === '"' || ch === "'") {
        quoted = true;
        i++;
        const start = i;
        while (i < input.length && input[i] !== ch) i++;
        if (i >= input.length) {
          throw new TokenizeError(`orrery: 닫히지 않은 따옴표(${ch})가 있습니다`);
        }
        value += input.slice(start, i);
        i++; // 닫는 따옴표
      } else {
        // SIMPLIFIED: 백슬래시 이스케이프(\", \\)는 지원하지 않는다
        value += ch;
        i++;
      }
    }
    tokens.push({ value, quoted });
  }
  return tokens;
}
