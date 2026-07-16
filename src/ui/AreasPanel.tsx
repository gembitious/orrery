/**
 * 우측 3영역 패널: 파일별 행 정렬 테이블.
 * 한 파일이 working tree / index / HEAD 어디에 어떤 내용(blob sha)으로
 * 존재하는지 한 줄에서 비교한다. 뷰 모델은 buildAreasView(순수 함수)가 만든다.
 * (파일이 컬럼 간 슬라이드하는 애니메이션은 2.5)
 */
import { shortSha } from '../core/objects';
import type { Repository } from '../core/repository';
import type { AreaRow } from './areasData';
import { buildAreasView } from './areasData';

function Cell({
  cell,
  deleted,
}: {
  cell?: { sha: string; badge?: string };
  deleted: boolean;
}) {
  if (cell !== undefined) {
    return (
      <div className="cell">
        <span className="cell-sha">{shortSha(cell.sha)}</span>
        {cell.badge !== undefined && (
          <span className={`badge badge-${cell.badge}`}>{cell.badge}</span>
        )}
      </div>
    );
  }
  if (deleted) {
    return (
      <div className="cell cell-deleted">
        <span className="badge badge-deleted">deleted</span>
      </div>
    );
  }
  return <div className="cell cell-absent">—</div>;
}

function Row({ row }: { row: AreaRow }) {
  return (
    <>
      <div className="cell cell-file">{row.file}</div>
      <Cell cell={row.worktree} deleted={row.worktreeDeleted} />
      <Cell cell={row.index} deleted={row.indexDeleted} />
      <Cell cell={row.head} deleted={false} />
    </>
  );
}

export function AreasPanel({ repo }: { repo: Repository }) {
  const view = buildAreasView(repo);

  return (
    <aside className="panel areas-panel">
      <h2>3영역</h2>
      {view.rows.length === 0 ? (
        <p className="empty">
          아직 파일이 없습니다. <code>echo &quot;내용&quot; &gt; 파일명</code>으로 만들어 보세요.
        </p>
      ) : (
        <div className="areas-table">
          <div className="cell cell-header">file</div>
          <div className="cell cell-header">working tree</div>
          <div className="cell cell-header">index</div>
          <div className="cell cell-header">
            HEAD <span className="head-context">· {view.headLabel}</span>
          </div>
          {view.rows.map((row) => (
            <Row key={row.file} row={row} />
          ))}
        </div>
      )}
    </aside>
  );
}
