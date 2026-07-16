/**
 * 하단 명령 입력창 + 출력 로그.
 * SIMPLIFIED: 히스토리(↑↓) 탐색과 에러 표시 심화는 2.6에서.
 */
import { useEffect, useRef, useState } from 'react';

export interface TerminalEntry {
  input: string;
  output: string[];
  error?: string;
}

export function Terminal({
  entries,
  onCommand,
}: {
  entries: TerminalEntry[];
  onCommand: (input: string) => void;
}) {
  const [value, setValue] = useState('');
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logRef.current?.scrollTo(0, logRef.current.scrollHeight);
  }, [entries]);

  return (
    <footer className="terminal">
      <div className="terminal-log" ref={logRef}>
        {entries.length === 0 && (
          <p className="hint">
            지원 명령: git init · add · commit -m · status · branch · checkout · log,{' '}
            그리고 echo &quot;내용&quot; &gt; 파일 · rm 파일
          </p>
        )}
        {entries.map((entry, i) => (
          <div className="terminal-entry" key={i}>
            <div className="terminal-cmd">{entry.input}</div>
            {entry.output.map((line, j) => (
              <div className="terminal-out" key={j}>
                {line === '' ? ' ' : line}
              </div>
            ))}
            {entry.error !== undefined && <div className="terminal-err">{entry.error}</div>}
          </div>
        ))}
      </div>
      <form
        className="terminal-form"
        onSubmit={(ev) => {
          ev.preventDefault();
          if (value.trim() === '') return;
          onCommand(value);
          setValue('');
        }}
      >
        <span className="prompt" aria-hidden="true">
          $
        </span>
        <input
          value={value}
          onChange={(ev) => setValue(ev.target.value)}
          placeholder="git 명령을 입력하세요"
          aria-label="git 명령 입력"
          spellCheck={false}
          autoFocus
        />
      </form>
    </footer>
  );
}
