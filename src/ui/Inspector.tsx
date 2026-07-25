/**
 * 인스펙터 패널 — 객체의 실제 직렬화 포맷을 보여준다.
 * 화면의 바이트열이 곧 SHA-1 입력이고, sha 토큰을 클릭하면
 * commit → tree → blob 참조 체인을 따라 내려갈 수 있다.
 */
import { shortSha } from '../core/objects';
import type { Repository } from '../core/repository';
import { inspectObject } from './inspect';

export function Inspector({
  repo,
  sha,
  onSelect,
  onClose,
}: {
  repo: Repository;
  sha: string;
  onSelect: (sha: string) => void;
  onClose: () => void;
}) {
  const inspection = inspectObject(repo, sha);

  return (
    <section className="panel inspector-panel">
      <h2>
        inspector
        <button type="button" className="inspector-close" onClick={onClose} aria-label="닫기">
          ✕
        </button>
      </h2>
      {inspection === undefined ? (
        <p className="empty">
          이 sha의 객체가 아직 object store에 없습니다. working tree 내용의 해시라면{' '}
          <code>git add</code>를 해야 비로소 blob으로 저장됩니다 — sha는 저장 전에도 내용만으로
          정해집니다.
        </p>
      ) : (
        <div className="inspector-body">
          <div className="inspector-meta">
            <span className={`obj-type obj-${inspection.type}`}>{inspection.type}</span>
            <span className="inspector-sha">{inspection.sha}</span>
          </div>
          <pre className="inspector-bytes">
            {inspection.tokens.map((token, i) => {
              if (token.kind === 'text') return <span key={i}>{token.text}</span>;
              if (token.kind === 'nul') {
                return (
                  <span className="tok-nul" key={i} title="NUL 바이트 (\0)">
                    \0
                  </span>
                );
              }
              return (
                <button
                  type="button"
                  className={token.raw ? 'tok-sha tok-sha-raw' : 'tok-sha'}
                  key={i}
                  title={
                    token.raw
                      ? '실제 파일에는 20바이트 이진값으로 저장된다 — 클릭해서 열기'
                      : '클릭해서 열기'
                  }
                  onClick={() => onSelect(token.sha)}
                >
                  {token.raw ? shortSha(token.sha) + '…' : token.sha}
                </button>
              );
            })}
          </pre>
          <p className="inspector-note">
            위 바이트열이 SHA-1의 입력이다 — 그래서 이 객체의 이름이{' '}
            <b>{shortSha(inspection.sha)}</b>다.
            {inspection.type === 'tree' && ' (tree의 sha는 hex가 아니라 20바이트 raw로 저장된다)'}
          </p>
        </div>
      )}
    </section>
  );
}
