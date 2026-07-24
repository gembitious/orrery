# orrery

git의 상태 전이를 작동하는 모형으로 보여주는 인터랙티브 시각화 웹앱.

이름의 유래: orrery(태양계의, 太陽系儀)는 행성의 운행을 기어로 재현하는 기계 모형이다. 이 프로젝트는 git의 커밋 그래프, refs, index, working tree가 명령에 따라 어떻게 움직이는지를 작동하는 모형으로 보여준다 — 정지된 다이어그램이 아니라.

## 목적과 정체성

- **주 목적**: git의 동작 원리를 시각화한다. 사용자가 실제 git CLI 문법으로 명령을 입력하면, 내부 상태(커밋 DAG, HEAD, branch refs, index, working tree)가 애니메이션으로 전이한다.
- **정체성 한 줄**: "git의 상태 전이를 투명하게 보여주는 계기판"
- **learngitbranching과의 차별점** (중요 — 이 프로젝트는 LGB 클론이 아니다):
  1. LGB는 커밋 그래프만 보여주지만, orrery는 3영역(HEAD / index / working tree)을 그래프와 동급으로 시각화한다. `add`, `reset --soft/--mixed/--hard`, `restore`, `stash`가 주력 콘텐츠다. LGB는 이것들을 아예 다루지 못한다.
  2. LGB는 레벨 클리어형 게임이지만, orrery는 자유 샌드박스다. 게임화 없음. (predict-then-run 모드는 Phase 5의 부가 기능)
  3. 투명한 내부: 커밋 노드/ref를 클릭하면 실제 git 객체 포맷과 `.git` 내부 파일 내용을 보여주는 인스펙터 패널 (Phase 5).
- 자체 축약 문법을 만들지 않는다. 실제 git CLI 문법의 서브셋을 그대로 파싱한다. 여기서 배운 근육이 실전으로 이전되어야 한다.

## 기술 스택

- Vite + React + TypeScript (strict)
- 시각화: SVG 직접 렌더링 (라이브러리 없음 — D3 금지, 커밋 DAG 레이아웃은 직접 구현)
- 애니메이션: FLIP 기법 (CSS transform 기반)
- 테스트: vitest
- 상태 관리: 코어는 순수 TS, UI 바인딩은 React 상태로 충분 (zustand 등 도입은 필요해질 때만)
- 배포: 정적 빌드 → GitHub Pages 또는 Vercel

## 아키텍처: 3층 분리

```
┌─────────────────────────────────────┐
│  UI Layer (React + SVG)             │  그래프, 3영역 패널, 명령 입력창, 인스펙터
├─────────────────────────────────────┤
│  Command Layer                      │  git CLI 파서 → 코어 API 호출 → StateDiff 반환
├─────────────────────────────────────┤
│  Core Layer (순수 TS, UI 무관)       │  git 상태 머신 + object store, vitest 완전 커버
└─────────────────────────────────────┘
```

Core Layer는 React를 import하지 않는다. UI 없이 테스트만으로 개발 가능해야 한다. 이 분리가 이 프로젝트의 최우선 원칙이다.

## 핵심 설계 결정

1. **진짜 SHA-1 해싱을 쓴다.** 커밋/트리/블롭을 실제 git 스펙대로 직렬화하여 해싱한다. 가짜 ID(C1, C2...)를 쓰지 않는다. 이유:
   - 인스펙터 패널(Phase 5)이 공짜로 따라온다 — 보여줄 실제 객체가 이미 있으므로.
   - "커밋 = 내용의 해시"라는 git의 근본 원리가 구현 자체에 반영된다.
   - UI 표시는 짧은 해시(7자)를 쓴다.
   - SHA-1 구현: Web Crypto는 SHA-1을 지원하므로 `crypto.subtle.digest('SHA-1', ...)`. 단, 동기적 해싱이 필요하면 순수 TS 구현을 vendored로 포함해도 됨 (판단 위임).
2. **객체 직렬화는 실제 git 포맷을 따른다.**
   - blob: `blob <size>\0<content>`
   - tree: `tree <size>\0` + 엔트리들 (`<mode> <name>\0<20-byte-sha>` 반복, 이름순 정렬)
   - commit: `commit <size>\0tree <sha>\nparent <sha>\n...author ...\ncommitter ...\n\n<message>`
   - zlib 압축은 저장 시 생략 가능 (인스펙터는 압축 전 형태를 보여주면 됨)
   - author/committer의 타임스탬프는 시뮬레이션 시계(단조 증가 카운터)를 써서 결정론적으로. 같은 명령 시퀀스 → 같은 해시가 나와야 테스트와 상태 공유(Phase 5+)가 가능하다.
3. **파일 시스템은 flat한 가상 FS로 시작한다.** 디렉터리 중첩은 Phase 1에서 스코프 아웃. 파일명에 `/`를 허용하지 않는다. (tree 객체의 재귀 구조는 Phase 5 인스펙터 시점에 재검토)

## Core 타입 설계 (Phase 1 기준)

```typescript
// ── Object store ────────────────────────────────
type Sha = string; // 40-char hex

type GitObject =
  | { type: 'blob'; content: string }
  | { type: 'tree'; entries: TreeEntry[] }          // 이름순 정렬 불변식
  | { type: 'commit'; tree: Sha; parents: Sha[]; author: Signature; committer: Signature; message: string };

interface TreeEntry {
  mode: '100644';   // Phase 1: 일반 파일만
  name: string;
  sha: Sha;         // blob의 sha
}

interface Signature {
  name: string;
  email: string;
  timestamp: number; // 시뮬레이션 시계
}

// ── Refs ────────────────────────────────────────
type Head =
  | { kind: 'symbolic'; ref: string }   // 'refs/heads/main'
  | { kind: 'detached'; sha: Sha };

// ── Index / Working tree ────────────────────────
type IndexEntry =
  | { name: string; conflicted?: false; sha: Sha }  // 평시 (stage 0)
  | { name: string; conflicted: true;               // 머지 충돌 (unmerged)
      stages: { 1?: Sha; 2?: Sha; 3?: Sha } };      // 1=base, 2=ours, 3=theirs

// ── Repository (최상위 상태) ─────────────────────
interface Repository {
  initialized: boolean;           // git init 전에는 false — 가상 FS 명령만 동작
  objects: Map<Sha, GitObject>;
  refs: Map<string, Sha>;         // 'refs/heads/main' → sha
  head: Head;
  index: Map<string, IndexEntry>; // filename → entry
  workingTree: Map<string, string>; // filename → content
  stashes: Sha[];                 // stash 스택 (WIP 커밋 sha, [0]이 최신) — reflog 대체
  merging?: { theirs: Sha; message: string }; // 진행 중 머지 (MERGE_HEAD + MERGE_MSG)
  clock: number;                  // 시뮬레이션 시계
}
```

- Repository는 불변 갱신(명령 실행 시 새 객체 반환)으로 다룬다. undo/redo와 predict 모드(Phase 5)가 공짜로 따라온다. structural sharing은 Map 복사 비용이 문제될 규모가 아니므로 단순 복사로 충분.

## Command Layer

- 진입점: `execute(repo: Repository, input: string): CommandResult`

```typescript
interface CommandResult {
  repo: Repository;        // 새 상태
  output: string[];        // git이 stdout/stderr에 냈을 법한 메시지 (실제 문구에 가깝게)
  error?: string;          // 실패 시 (repo는 원본 그대로)
  diff: StateDiff;         // UI 애니메이션용 — 무엇이 변했는가
}

interface StateDiff {
  createdObjects: Sha[];
  movedRefs: { ref: string; from?: Sha; to: Sha }[];
  deletedRefs?: string[];         // git branch -d — movedRefs는 to가 필수라 삭제 표현 불가
  headChange?: { from: Head; to: Head };
  indexChanges: { file: string; kind: 'staged' | 'unstaged' | 'modified' }[];
  workingTreeChanges: { file: string; kind: 'created' | 'modified' | 'deleted' }[];
}
```

- 파서는 정규식 조합이 아니라 토크나이저 + 명령별 파서 함수로. 옵션 파싱 (`--hard`, `-b`, `-m "msg"`)을 지원해야 하므로 처음부터 구조를 잡는다.
- 지원하지 않는 명령/옵션은 침묵하지 말고 `error: "orrery: 'cherry-pick'은 아직 지원하지 않습니다"` 형태로 명시.
- working tree 조작용 가상 명령 2개 허용 (git 외 유일한 예외):
  - `echo "content" > file.txt` (파일 생성/덮어쓰기)
  - `rm file.txt`

## Phase 로드맵

한 번에 한 체크포인트만 진행한다. 각 체크포인트는 테스트가 통과하고 커밋 가능한 상태로 끝난다. 새 개념이 나오면 짧게 설명하면서 진행 (학습 프로젝트임).

### Phase 1 — 코어 상태 머신 (UI 없음, vitest만)

- [x] 1.1 객체 직렬화 + SHA-1: blob/tree/commit 직렬화, 해시 계산. known-answer 테스트 (실제 git으로 만든 해시와 대조: `echo -n 'hello' | git hash-object --stdin` = `b6fc4c620b67d95f953a5c1c1230aaab5db5a1b0`... 정확한 값은 검증하며 작성)
- [x] 1.2 Repository + `init`, 가상 FS 명령 (`echo >`, `rm`)
- [x] 1.3 `git add <file>` / `git add .`: blob 생성 + index 갱신
- [x] 1.4 `git commit -m`: index → tree 객체 → commit 객체, HEAD의 브랜치 전진. 빈 index("nothing to commit") 등 에러 경로 포함
- [x] 1.5 `git status`: 3영역 비교 로직 (untracked / modified / staged / staged+modified). 이 비교 함수는 UI 3영역 패널이 그대로 재사용한다
- [x] 1.6 `git branch <name>` / `git branch -d/-D` (미머지 판정 포함) / `git checkout <branch|sha>` / `git checkout -b`. detached HEAD 상태 전이 포함
- [x] 1.7 `git log`: first-parent 순회 출력

### Phase 2 — 시각화 셸

- [x] 2.1 앱 레이아웃: 좌측 커밋 그래프(SVG) / 우측 3영역 패널 / 하단 명령 입력창 + 출력 로그
- [x] 2.2 커밋 DAG 레이아웃 알고리즘: 레인(lane) 배정. 브랜치 십수 개 규모면 단순 탐욕 배정으로 충분. 레이아웃은 순수 함수로 분리 (`layout(commits) → positions`)
- [x] 2.3 refs 렌더링: 브랜치 라벨, HEAD 포인터 (symbolic이면 브랜치에 붙고, detached면 커밋에 직접)
- [x] 2.4 3영역 패널: working tree / index / HEAD 컬럼, `git status` 로직 기반 파일 상태 배지
- [x] 2.5 StateDiff → FLIP 애니메이션: 새 커밋 등장, ref 이동, 파일이 컬럼 간 슬라이드
- [x] 2.6 명령 입력창: 히스토리(↑↓), 에러 표시

### Phase 3 — 3영역 심화 (이 프로젝트의 킬러 콘텐츠)

- [x] 3.1 `git reset --soft/--mixed/--hard [<commit>]`: HEAD~N, 해시 지정. 세 모드가 3영역에 미치는 영향 차이가 애니메이션으로 명확히 보여야 한다
- [x] 3.2 `git restore <file>` / `git restore --staged <file>`
- [x] 3.3 `git stash` / `stash pop` / `stash list`: stash가 실제로는 커밋(WIP + index 커밋)이라는 것을 그래프에 노출할지 여부는 토글로 (기본: 노출 — 이게 orrery의 존재 이유)
- [x] 3.4 `git rm --cached`, `git commit --amend`

### Phase 4 — 히스토리 조작

- [x] 4.1 `git merge`: fast-forward / 3-way 구분, merge commit (parents 2개)
- [x] 4.2 충돌 상태 모델링: conflicted index (stage 1/2/3 단순화 가능), 충돌 마커가 든 working tree 파일, `git add` → `git commit`으로 해소하는 플로우
- [ ] 4.3 `git rebase <branch>`: 커밋 재적용, 원본 커밋과 새 커밋의 관계 시각화 (재적용 시 해시가 바뀐다는 것이 눈에 보여야 함)
- [ ] 4.4 `git cherry-pick`

### Phase 5 — 투명한 내부

- [ ] 5.1 인스펙터 패널: 커밋/트리/블롭 노드 클릭 → 실제 직렬화 포맷 표시
- [ ] 5.2 `.git` 가상 파일 트리 뷰: `HEAD`, `refs/heads/*`, `objects/ab/cdef...` 실제 내용
- [ ] 5.3 predict-then-run 모드: 명령 실행 전 결과를 먼저 예측(ref 위치 드래그 등), 실행 후 대조
- [ ] 5.4 상태 공유: Repository를 URL 해시로 직렬화 (명령 히스토리 리플레이 방식 권장 — 결정론적 해시 덕분에 가능)

## 코딩 컨벤션

- TypeScript strict. `any` 금지. 코어 레이어는 discriminated union + exhaustive switch.
- 코어 레이어의 모든 명령은 순수 함수: `(repo, args) → CommandResult`. 부수효과 금지.
- 테스트는 명령 시퀀스 → 최종 상태 단언 스타일. 예:

```typescript
const repo = run(['git init', 'echo "a" > f.txt', 'git add f.txt', 'git commit -m "c1"']);
expect(resolveHead(repo)).toBe(repo.refs.get('refs/heads/main'));
```

- git의 실제 동작과 다르게 단순화한 지점은 코드 주석에 `// SIMPLIFIED:` 마커로 남긴다. (예: index의 stat 캐시 생략, config 생략, reflog 생략)
- 커밋 메시지는 conventional commits (`feat:`, `fix:`, `test:`, `refactor:`).

## 스코프 아웃 (하지 않는 것)

- 원격(remote/push/pull/fetch/clone) — 로컬 상태 머신에 집중. 추후 재검토
- reflog, tag, submodule, worktree, hooks, config
- packfile — loose object만
- 실제 git 바이너리 실행 / isomorphic-git 등 외부 git 구현 사용 금지 — 직접 구현이 이 프로젝트의 학습 목적 그 자체다
- 게임화 (레벨, 점수, 클리어 조건)
- 모바일 대응 (데스크탑 우선, 반응형은 나중)

## 진행 방식

- 한 세션에 한 체크포인트. 체크포인트 완료 = 테스트 통과 + 커밋.
- diff를 제시할 때, 새로 등장하는 git 내부 개념(예: tree 객체의 정렬 규칙, detached HEAD의 의미)은 2~3문장으로 설명을 곁들인다.
- 설계 판단이 갈리는 지점(예: SHA-1 동기/비동기, 충돌 모델 단순화 수준)은 독단으로 진행하지 말고 옵션을 제시하고 물어볼 것.
