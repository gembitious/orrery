/**
 * 좌측 커밋 그래프 (SVG 직접 렌더링).
 * 위치 계산은 전부 layoutCommits(순수 함수)가 하고, 여기는 좌표 변환과 그리기만.
 * 브랜치 라벨/HEAD 포인터 렌더링은 2.3에서.
 */
import { shortSha } from '../core/objects';
import type { Repository } from '../core/repository';
import { resolveHead } from '../core/repository';
import { listCommitsByTime } from './graphData';
import { layoutCommits } from './layout';

const ROW_H = 56;
const LANE_W = 36;
const PAD_X = 28;
const PAD_Y = 32;
const NODE_R = 9;

const laneX = (lane: number): number => PAD_X + lane * LANE_W;
const rowY = (row: number): number => PAD_Y + row * ROW_H;

/** 같은 레인은 직선, 레인이 다르면 완만한 베지어로 잇는다 */
function edgePath(x1: number, y1: number, x2: number, y2: number): string {
  if (x1 === x2) return `M ${x1} ${y1} L ${x2} ${y2}`;
  const midY = (y1 + y2) / 2;
  return `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`;
}

export function GraphPanel({ repo }: { repo: Repository }) {
  const nodes = listCommitsByTime(repo);
  const layout = layoutCommits(nodes);
  const headSha = resolveHead(repo);
  const labelX = PAD_X + layout.laneCount * LANE_W + 8;

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
          height={layout.rowCount * ROW_H + PAD_Y}
          role="img"
          aria-label="커밋 그래프"
        >
          {nodes.map((node) => {
            const from = layout.positions.get(node.sha);
            if (from === undefined) return null;
            return node.commit.parents.map((parent) => {
              const to = layout.positions.get(parent);
              if (to === undefined) return null;
              return (
                <path
                  key={`${node.sha}-${parent}`}
                  className="edge"
                  d={edgePath(laneX(from.lane), rowY(from.row), laneX(to.lane), rowY(to.row))}
                />
              );
            });
          })}
          {nodes.map((node) => {
            const p = layout.positions.get(node.sha);
            if (p === undefined) return null;
            return (
              <g key={node.sha} transform={`translate(${laneX(p.lane)} ${rowY(p.row)})`}>
                <circle className={node.sha === headSha ? 'node node-head' : 'node'} r={NODE_R} />
              </g>
            );
          })}
          {nodes.map((node) => {
            const p = layout.positions.get(node.sha);
            if (p === undefined) return null;
            return (
              <g key={node.sha} transform={`translate(${labelX} ${rowY(p.row)})`}>
                <text className="node-sha" dy="4">
                  {shortSha(node.sha)}
                </text>
                <text className="node-msg" x={70} dy="4">
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
