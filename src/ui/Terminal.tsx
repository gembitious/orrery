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

/** 상시 노출되는 명령 레퍼런스 — 칩을 누르면 입력창에 채워진다 */
const COMMAND_GUIDE: { group: string; items: { label: string; insert: string }[] }[] = [
  {
    group: '시작',
    items: [
      { label: 'init', insert: 'git init' },
      { label: 'echo >', insert: 'echo "내용" > 파일.txt' },
      { label: 'rm', insert: 'rm 파일.txt' },
    ],
  },
  {
    group: '기록',
    items: [
      { label: 'add', insert: 'git add ' },
      { label: 'commit', insert: 'git commit -m ""' },
      { label: '--amend', insert: 'git commit --amend -m ""' },
      { label: 'status', insert: 'git status' },
      { label: 'log', insert: 'git log' },
    ],
  },
  {
    group: '브랜치',
    items: [
      { label: 'branch', insert: 'git branch ' },
      { label: 'checkout', insert: 'git checkout ' },
      { label: '-b', insert: 'git checkout -b ' },
      { label: 'merge', insert: 'git merge ' },
      { label: 'rebase', insert: 'git rebase ' },
      { label: 'cherry-pick', insert: 'git cherry-pick ' },
    ],
  },
  {
    group: '3영역',
    items: [
      { label: 'reset', insert: 'git reset --hard HEAD~1' },
      { label: 'restore', insert: 'git restore ' },
      { label: '--staged', insert: 'git restore --staged ' },
      { label: 'stash', insert: 'git stash' },
      { label: 'rm --cached', insert: 'git rm --cached ' },
    ],
  },
];

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
            아래 명령 칩을 누르거나 직접 입력해 보세요 — 실제 git CLI 문법 그대로, ↑↓로 히스토리
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
      <div className="terminal-guide" aria-label="사용 가능한 명령">
        {COMMAND_GUIDE.map((group) => (
          <span className="guide-group" key={group.group}>
            <span className="guide-label">{group.group}</span>
            {group.items.map((item) => (
              <button
                type="button"
                className="guide-chip"
                key={item.label}
                title={item.insert}
                onClick={() => {
                  setValue(item.insert);
                  setNav(idleNav);
                  inputRef.current?.focus();
                }}
              >
                {item.label}
              </button>
            ))}
          </span>
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
