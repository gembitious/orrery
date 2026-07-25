/**
 * 좌측 커밋 그래프 (SVG 직접 렌더링).
 * 위치 계산은 layoutCommits(순수 함수), ref 라벨 수집은 collectLabels가 하고
 * 여기는 좌표 변환과 그리기만 한다.
 *
 * HEAD의 두 형태를 시각적으로 구분한다:
 *   symbolic → [HEAD]가 브랜치 칩에 붙어서 그려진다 (HEAD는 브랜치를 가리킨다)
 *   detached → [HEAD] 칩이 커밋에 직접 붙는다
 *
 * FLIP 규칙: 위치 지정용 transform 속성이 있는 g의 "안쪽" 그룹에
 * data-flip-key를 단다 (CSS transform과 속성 transform의 충돌 방지).
 * 커밋 노드는 pop으로 등장, ref 칩은 커밋 사이를 날아다닌다(키가 이름 기준).
 */
import { shortSha } from '../core/objects';
import type { Repository } from '../core/repository';
import { resolveHead } from '../core/repository';
import { collectLabels, listCommitsByTime, stashInternalCommits } from './graphData';
import { layoutCommits } from './layout';

const ROW_H = 56;
const LANE_W = 36;
const PAD_X = 28;
const PAD_Y = 32;
const NODE_R = 9;
const CHIP_H = 18;
const CHAR_W = 7.3; // ui-monospace 12px 기준 추정 폭 — 모노스페이스라 안정적
const SHA_COL_W = 60;

const laneX = (lane: number): number => PAD_X + lane * LANE_W;
const rowY = (row: number): number => PAD_Y + row * ROW_H;
const chipW = (text: string): number => Math.round(text.length * CHAR_W) + 12;

/** 같은 레인은 직선, 레인이 다르면 완만한 베지어로 잇는다 */
function edgePath(x1: number, y1: number, x2: number, y2: number): string {
  if (x1 === x2) return `M ${x1} ${y1} L ${x2} ${y2}`;
  const midY = (y1 + y2) / 2;
  return `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`;
}

function Chip({ x, text, kind }: { x: number; text: string; kind: 'head' | 'branch' | 'stash' }) {
  return (
    <g transform={`translate(${x} ${-CHIP_H / 2})`}>
      <g
        className={`chip chip-${kind}`}
        data-flip-key={`ref:${kind === 'head' ? 'HEAD' : text}`}
        data-flip-enter="pop"
      >
        <rect width={chipW(text)} height={CHIP_H} rx={3} />
        <text x={chipW(text) / 2} y={CHIP_H / 2 + 4} textAnchor="middle">
          {text}
        </text>
      </g>
    </g>
  );
}

export function GraphPanel({
  repo,
  showStash,
  selected,
  onSelect,
}: {
  repo: Repository;
  showStash: boolean;
  /** 인스펙터가 열어둔 객체 (커밋이면 노드를 강조) */
  selected: string | null;
  onSelect: (sha: string) => void;
}) {
  const hidden = showStash ? new Set<string>() : stashInternalCommits(repo);
  const nodes = listCommitsByTime(repo).filter((n) => !hidden.has(n.sha));
  const layout = layoutCommits(nodes);
  const labels = collectLabels(repo);
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
                  data-flip-key={`edge:${node.sha}:${parent}`}
                  data-flip-enter="fade"
                  d={edgePath(laneX(from.lane), rowY(from.row), laneX(to.lane), rowY(to.row))}
                />
              );
            });
          })}
          {nodes.map((node) => {
            const p = layout.positions.get(node.sha);
            if (p === undefined) return null;
            const classes = ['node'];
            if (node.sha === headSha) classes.push('node-head');
            if (node.sha === selected) classes.push('node-selected');
            return (
              <g key={node.sha} transform={`translate(${laneX(p.lane)} ${rowY(p.row)})`}>
                <g data-flip-key={`node:${node.sha}`} data-flip-enter="pop">
                  <circle
                    className={classes.join(' ')}
                    r={NODE_R}
                    role="button"
                    tabIndex={0}
                    aria-label={`커밋 ${shortSha(node.sha)} 인스펙터로 열기`}
                    onClick={() => onSelect(node.sha)}
                    onKeyDown={(ev) => {
                      if (ev.key === 'Enter' || ev.key === ' ') onSelect(node.sha);
                    }}
                  />
                </g>
              </g>
            );
          })}
          {nodes.map((node) => {
            const p = layout.positions.get(node.sha);
            if (p === undefined) return null;
            const l = labels.get(node.sha);
            const chips: { text: string; kind: 'head' | 'branch' | 'stash' }[] = [];
            if (l !== undefined) {
              if (l.detachedHead) chips.push({ text: 'HEAD', kind: 'head' });
              if (l.headBranch !== undefined) {
                chips.push({ text: 'HEAD', kind: 'head' });
                chips.push({ text: l.headBranch, kind: 'branch' });
              }
              for (const name of l.branches) chips.push({ text: name, kind: 'branch' });
              for (const name of l.stashes) chips.push({ text: name, kind: 'stash' });
            }

            let x = SHA_COL_W;
            const rendered = chips.map((chip, i) => {
              const el = <Chip key={chip.text + chip.kind} x={x} text={chip.text} kind={chip.kind} />;
              // HEAD 칩과 그 브랜치 칩은 붙여서 "HEAD가 브랜치에 붙어 있음"을 표현
              const gap = chip.kind === 'head' && chips[i + 1]?.kind === 'branch' ? 1 : 6;
              x += chipW(chip.text) + gap;
              return el;
            });

            return (
              <g key={node.sha} transform={`translate(${labelX} ${rowY(p.row)})`}>
                <g data-flip-key={`label:${node.sha}`} data-flip-enter="fade">
                  <text className="node-sha" dy="4">
                    {shortSha(node.sha)}
                  </text>
                  <text className="node-msg" x={x + 4} dy="4">
                    {node.commit.message.split('\n')[0]}
                  </text>
                </g>
                {rendered}
              </g>
            );
          })}
        </svg>
      )}
    </section>
  );
}
