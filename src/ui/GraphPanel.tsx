/**
 * 좌측 커밋 그래프 (SVG 직접 렌더링).
 * SIMPLIFIED: 2.1은 단일 레인 세로 나열 — 브랜치 분기 레이아웃(레인 배정)은 2.2,
 * 브랜치 라벨/HEAD 포인터 렌더링은 2.3에서.
 */
import { shortSha } from '../core/objects';
import type { Repository } from '../core/repository';
import { resolveHead } from '../core/repository';
import { listCommitsByTime } from './graphData';

const ROW_H = 56;
const NODE_X = 44;
const NODE_R = 10;

export function GraphPanel({ repo }: { repo: Repository }) {
  const nodes = listCommitsByTime(repo);
  const yOf = new Map(nodes.map((node, i) => [node.sha, 32 + i * ROW_H]));
  const headSha = resolveHead(repo);

  return (
    <section className="panel graph-panel">
      <h2>commit graph</h2>
      {nodes.length === 0 ? (
        <p className="empty">
          아직 커밋이 없습니다.
          <br />
          아래 입력창에서 <code>git init</code>부터 시작해 보세요.
        </p>
      ) : (
        <svg
          width="100%"
          height={nodes.length * ROW_H + 16}
          role="img"
          aria-label="커밋 그래프"
        >
          {nodes.map((node) =>
            node.commit.parents.map((parent) => {
              const fromY = yOf.get(node.sha);
              const toY = yOf.get(parent);
              if (fromY === undefined || toY === undefined) return null;
              return (
                <line
                  key={`${node.sha}-${parent}`}
                  className="edge"
                  x1={NODE_X}
                  y1={fromY}
                  x2={NODE_X}
                  y2={toY}
                />
              );
            }),
          )}
          {nodes.map((node) => {
            const y = yOf.get(node.sha);
            if (y === undefined) return null;
            return (
              <g key={node.sha} transform={`translate(0 ${y})`}>
                <circle
                  className={node.sha === headSha ? 'node node-head' : 'node'}
                  cx={NODE_X}
                  r={NODE_R}
                />
                <text className="node-sha" x={NODE_X + 22} dy="4">
                  {shortSha(node.sha)}
                </text>
                <text className="node-msg" x={NODE_X + 92} dy="4">
                  {node.commit.message.split('\n')[0]}
                </text>
              </g>
            );
          })}
        </svg>
      )}
    </section>
  );
}
