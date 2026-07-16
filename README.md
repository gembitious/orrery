# orrery

git의 상태 전이를 작동하는 모형으로 보여주는 인터랙티브 시각화 웹앱.

실제 git CLI 문법으로 명령을 입력하면 내부 상태(커밋 DAG, HEAD, branch refs, index, working tree)가 애니메이션으로 전이합니다. 진짜 SHA-1 해싱과 실제 git 객체 포맷을 사용합니다.

프로젝트 헌장과 로드맵은 [CLAUDE.md](./CLAUDE.md) 참고.

## 개발

```bash
npm install
npm test        # vitest
npm run dev     # Vite dev server
npm run build   # 정적 빌드
```
