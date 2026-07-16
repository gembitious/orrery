/**
 * 하단 명령 입력창 + 출력 로그.
 * ↑↓로 히스토리 탐색(셸 관례: 초안 보관/복원, 연속 중복 제거),
 * 실패한 명령은 로그에서 ✗와 함께 붉게 표시된다.
 */
import { useEffect, useRef, useState } from 'react';
import type { HistoryNav } from './history';
import { idleNav, navigateHistory, pushHistory } from './history';

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
  const [history, setHistory] = useState<string[]>([]);
  const [nav, setNav] = useState<HistoryNav>(idleNav);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    logRef.current?.scrollTo(0, logRef.current.scrollHeight);
  }, [entries]);

  const submit = () => {
    if (value.trim() === '') return;
    onCommand(value);
    setHistory((prev) => pushHistory(prev, value));
    setNav(idleNav);
    setValue('');
  };

  const handleKeyDown = (ev: React.KeyboardEvent<HTMLInputElement>) => {
    if (ev.key !== 'ArrowUp' && ev.key !== 'ArrowDown') return;
    ev.preventDefault();
    const result = navigateHistory(history, nav, ev.key === 'ArrowUp' ? 'up' : 'down', value);
    setNav(result.nav);
    setValue(result.value);
  };

  return (
    // 로그 여백을 눌러도 입력에 포커스가 가도록 (텍스트 선택은 방해하지 않게 클릭만)
    <footer className="terminal" onClick={() => {
      if (window.getSelection()?.isCollapsed !== false) inputRef.current?.focus();
    }}>
      <div className="terminal-log" ref={logRef}>
        {entries.length === 0 && (
          <p className="hint">
            지원 명령: git init · add · commit -m · status · branch · checkout · log,{' '}
            그리고 echo &quot;내용&quot; &gt; 파일 · rm 파일 — ↑↓로 히스토리 탐색
          </p>
        )}
        {entries.map((entry, i) => (
          <div
            className={entry.error === undefined ? 'terminal-entry' : 'terminal-entry entry-error'}
            key={i}
          >
            <div className="terminal-cmd">{entry.input}</div>
            {entry.output.map((line, j) => (
              <div className="terminal-out" key={j}>
                {line === '' ? ' ' : line}
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
          submit();
        }}
      >
        <span className="prompt" aria-hidden="true">
          $
        </span>
        <input
          ref={inputRef}
          value={value}
          onChange={(ev) => {
            setValue(ev.target.value);
            setNav(idleNav); // 직접 수정하면 탐색 모드 해제
          }}
          onKeyDown={handleKeyDown}
          placeholder="git 명령을 입력하세요 (↑↓ 히스토리)"
          aria-label="git 명령 입력"
          spellCheck={false}
          autoFocus
        />
      </form>
    </footer>
  );
}
