# Repository Guidelines

## Project Structure
- `bin/codex-claudecode-proxy.js`: 전체 CLI 구현부(설치/구성/시작/중지/상태/제거).
- `test/non-interactive.test.js`: 설치 흐름 회귀 테스트.
- Docs/config: `README.md`(사용자 안내), `CLAUDE.md`(아키텍처), `LICENSE`.

## Build, Test, and Development Commands
Node.js(>=18)만 필요합니다. 별도 빌드/의존성 설치가 없습니다.

```bash
# CLI usage / local smoke check
node bin/codex-claudecode-proxy.js help

# 상태 확인
node bin/codex-claudecode-proxy.js status

# 테스트 실행
node --test

# 선택: 문법 검사
node --check bin/codex-claudecode-proxy.js
```

전체 동작을 바꾸는 `install|start|stop|status|uninstall|purge` 실행은 README의 지침을 따르며,
로컬 홈 디렉터리와 LaunchAgents를 수정할 수 있습니다.

## Coding Style & Naming Conventions
- ESM only (`"type": "module"`).
- 기본 모듈만 사용, 새 의존성 추가 지양.
- 포맷: 2-space indent, double quotes, semicolons.
- 함수/변수: `camelCase`, 상수: `UPPER_SNAKE_CASE`.
- 출력/문서 텍스트는 ASCII 우선.

## Test Guidelines
- 테스트는 `node:test` + `node:assert/strict`.
- `test/*.test.js` 패턴.
- 실제 시스템 상태를 건드리지 않도록 스텁/임시 HOME 사용.

## Commit & PR Guidelines
- 커밋 메시지는 짧고 명령형.
- 설치/제거 동작 변경 시 macOS side-effect (`LaunchAgents`, 설정 파일 변경)와 테스트 결과를 PR에 요약.

## Security & Configuration Notes
- 토큰은 커밋/로그하지 않음.
- CLI는 `~/.codex/auth.json`을 읽고, `~/.cli-proxy-api/auths/`에 mirror 파일을 생성하되 권한은 제한(`chmod 600`)하도록 관리.
- 개발 중에는 기본적으로 `status`/테스트만 실행하고, 실제 설치/삭제는 필요한 경우에만 수행.

## Operational Notes
- 현재 구현은 `~/.zshrc` 래퍼를 주입하지 않습니다.
- `install`은 다음 항목을 재구성합니다:
  - `~/.cli-proxy-api/config.yaml`
  - `~/.cli-proxy-api/sync-codex-token.sh`
  - `~/Library/LaunchAgents/`의 proxy/sync plist
  - `~/.claude/settings.json`의 proxy 라우팅 env.
