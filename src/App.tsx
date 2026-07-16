import { useState } from 'react';
import { execute } from './command/execute';
import type { Repository } from './core/repository';
import { createRepository } from './core/repository';
import { AreasPanel } from './ui/AreasPanel';
import { GraphPanel } from './ui/GraphPanel';
import type { TerminalEntry } from './ui/Terminal';
import { Terminal } from './ui/Terminal';
import './App.css';

function App() {
  const [repo, setRepo] = useState<Repository>(createRepository);
  const [entries, setEntries] = useState<TerminalEntry[]>([]);

  const handleCommand = (input: string) => {
    const result = execute(repo, input);
    setRepo(result.repo);
    setEntries((prev) => [
      ...prev,
      { input, output: result.output, ...(result.error !== undefined && { error: result.error }) },
    ]);
  };

  return (
    <div className="app">
      <header className="app-header">
        <h1>orrery</h1>
        <p>git의 상태 전이를 투명하게 보여주는 계기판</p>
      </header>
      <main className="app-main">
        <GraphPanel repo={repo} />
        <AreasPanel repo={repo} />
      </main>
      <Terminal entries={entries} onCommand={handleCommand} />
    </div>
  );
}

export default App;
