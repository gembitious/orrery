/**
 * 우측 3영역 패널: working tree / index / HEAD tree.
 * 파일 상태 배지는 core의 computeStatus를 그대로 사용한다 — git status와
 * 이 패널이 항상 같은 것을 말하는 이유. (배지 심화와 애니메이션은 2.4~2.5)
 */
import type { Repository } from '../core/repository';
import { resolveHead } from '../core/repository';
import { commitTreeMap } from '../core/revision';
import { computeStatus } from '../core/status';

function Area({
  title,
  files,
  badgeOf,
}: {
  title: string;
  files: string[];
  badgeOf: (file: string) => string | undefined;
}) {
  return (
    <div className="area">
      <h3>{title}</h3>
      {files.length === 0 ? (
        <p className="empty">비어 있음</p>
      ) : (
        <ul>
          {files.map((file) => {
            const badge = badgeOf(file);
            return (
              <li key={file}>
                <span className="file-name">{file}</span>
                {badge !== undefined && <span className={`badge badge-${badge}`}>{badge}</span>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function AreasPanel({ repo }: { repo: Repository }) {
  const status = computeStatus(repo);
  const byFile = new Map(status.entries.map((e) => [e.file, e]));
  const headSha = resolveHead(repo);
  const headFiles = headSha === undefined ? [] : [...commitTreeMap(repo, headSha).keys()].sort();

  return (
    <aside className="panel areas-panel">
      <h2>3영역</h2>
      <div className="areas">
        <Area
          title="working tree"
          files={[...repo.workingTree.keys()].sort()}
          badgeOf={(f) => byFile.get(f)?.worktree}
        />
        <Area
          title="index"
          files={[...repo.index.keys()].sort()}
          badgeOf={(f) => byFile.get(f)?.index}
        />
        <Area title="HEAD" files={headFiles} badgeOf={() => undefined} />
      </div>
    </aside>
  );
}
