import { useLayoutEffect, useRef, useState } from 'react';
import { execute } from './command/execute';
import type { Repository } from './core/repository';
import { createRepository } from './core/repository';
import type { Slide } from './ui/animations';
import { deriveSlides } from './ui/animations';
import { AreasPanel } from './ui/AreasPanel';
import { createFlip } from './ui/flip';
import { GraphPanel } from './ui/GraphPanel';
import type { TerminalEntry } from './ui/Terminal';
import { Terminal } from './ui/Terminal';
import './App.css';

function App() {
  const [repo, setRepo] = useState<Repository>(createRepository);
  const [entries, setEntries] = useState<TerminalEntry[]>([]);
  // stash 내부 커밋(WIP+index) 노출 토글 — 기본 노출이 orrery의 존재 이유
  const [showStash, setShowStash] = useState(true);

  const rootRef = useRef<HTMLDivElement>(null);
  const flipRef = useRef(createFlip(() => rootRef.current));
  const slidesRef = useRef<Slide[]>([]);

  const handleCommand = (input: string) => {
    flipRef.current.capture(); // First: 실행 직전 위치 기록
    const result = execute(repo, input);
    slidesRef.current = deriveSlides(result.diff, repo, result.repo);
    setRepo(result.repo);
    setEntries((prev) => [
      ...prev,
      { input, output: result.output, ...(result.error !== undefined && { error: result.error }) },
    ]);
  };

  useLayoutEffect(() => {
    // Last+Invert+Play: 리렌더 직후 새 위치에서 역변환 애니메이션
    flipRef.current.play(slidesRef.current);
    slidesRef.current = [];
  }, [repo, entries]);

  return (
    <div className="app" ref={rootRef}>
      <header className="app-header">
        <h1>orrery</h1>
        <p>git의 상태 전이를 투명하게 보여주는 계기판</p>
        <label className="stash-toggle">
          <input
            type="checkbox"
            checked={showStash}
            onChange={(ev) => setShowStash(ev.target.checked)}
          />
          stash 내부 커밋 표시
        </label>
      </header>
      <main className="app-main">
        <GraphPanel repo={repo} showStash={showStash} />
        <AreasPanel repo={repo} />
      </main>
      <Terminal entries={entries} onCommand={handleCommand} />
    </div>
  );
}

export default App;
