# CLAUDE.md

이 파일은 이 저장소를 작업할 때 Claude가 따를 가이드를 제공합니다.

## What this repo is
- `codex-claudecode-proxy`는 macOS에서 동작하는 로컬 프록시 설치/관리 CLI입니다.
- `~/.codex/auth.json`의 OAuth 토큰을 읽어 `CLIProxyAPI`를 통해 Claude Code와 연결합니다.
- 기본 upstream 모델은 `gpt-5.3-codex`입니다.

## Repo layout
- `bin/codex-claudecode-proxy.js`: 전체 CLI 로직(설치·시작·중지·상태·제거)
- `test/non-interactive.test.js`: node:test 기반 통합 테스트
- `README.md`, `AGENTS.md`, `package.json`, `LICENSE`
- npm 배포 파일은 `package.json`의 `files`에서 `bin/`만 포함

## Common commands
- `node bin/codex-claudecode-proxy.js help`
- `node bin/codex-claudecode-proxy.js status`
- `node --test`
- `node --check bin/codex-claudecode-proxy.js`

## Architecture (current implementation)
- 진입점: `main()`이 `parseArgs()` 결과를 읽어 `install|start|stop|status|uninstall|purge`로 분기.
- `install`:
  1) `darwin` 플랫폼 확인
  2) `~/.codex/auth.json` 존재 확인
  3) 기존 설치 흔적 제거(`~/.cli-proxy-api`, LaunchAgent, Claude settings 백업 복구)
  4) CLIProxyAPI 바이너리 확인/설치 (`~/.local/bin/cli-proxy-api`)
  5) `~/.cli-proxy-api/config.yaml` 생성 (`models` 오버라이드로 `reasoning.effort` 매핑 포함)
  6) `~/.cli-proxy-api/sync-codex-token.sh` 생성 후 1회 실행
  7) LaunchAgent 두 개 생성 및 시작:
     - Proxy (`KeepAlive`)
     - Token sync (`WatchPaths`, `~/.codex/auth.json`)
  8) `/v1/models` health check
  9) `~/.claude/settings.json` 업데이트
     - `ANTHROPIC_BASE_URL`/`ANTHROPIC_AUTH_TOKEN` 설정
     - tier별 기본 모델(`gpt-5.3-codex(xhigh|high|medium)`) 주입
     - 타임아웃 기본값 보강
  10) `/v1/responses`으로 Opus/Sonnet/Haiku `reasoning.effort` 동작 검증
- `start`: 기존 plists가 있으면 proxy + sync Agent 시작
- `stop`: proxy/sync Agent `bootout`
- `status`: health + launchctl load 상태 출력
- `uninstall`: Agent 정리 + Claude 설정 복원
- `purge`: `uninstall` + `~/.cli-proxy-api` 및 `~/.local/bin/cli-proxy-api` 삭제

## Safety / side effects
- 이 CLI는 로컬 상태를 변경합니다.
  - `~/.cli-proxy-api/`(config/log/auth/동기화 스크립트)
  - `~/Library/LaunchAgents/`(proxy/sync plist)
  - `~/.local/bin/cli-proxy-api`
  - `~/.claude/settings.json`
- 현재 버전은 `~/.zshrc`를 수정하지 않습니다.

개발/검증 단계에서는 `help`/`status` 또는 테스트 실행을 우선 사용하세요.
