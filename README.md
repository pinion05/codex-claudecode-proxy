# codex-claudecode-proxy

Claude Code에서 **로컬 프록시(CLIProxyAPI)** 를 통해 **OpenAI Codex OAuth 토큰(`~/.codex/auth.json`)** 을 재사용하도록 자동 세팅하는 설치 도구입니다.

## Quick Start

```bash
npx -y codex-claudecode-proxy@latest --yes
```

설치가 끝나면:

```bash
source ~/.zshrc
claude
```

## What It Does

- `CLIProxyAPI` 바이너리 설치: `~/.local/bin/cli-proxy-api`
- 설정 생성: `~/.cli-proxy-api/config.yaml` (Codex 프로토콜 `gpt-*`에 `reasoning.effort=xhigh` 강제)
- 토큰 동기화:
  - 입력: `~/.codex/auth.json`
  - 출력: `~/.cli-proxy-api/auths/codex-from-codex-cli.json`
- LaunchAgent 등록(자동 실행/재시작):
  - `com.$USER.cli-proxy-api`
  - `com.$USER.cli-proxy-api-token-sync` (auth.json 변경시 자동 동기화)
- Claude Code 설정 업데이트: `~/.claude/settings.json`
  - `ANTHROPIC_BASE_URL=http://127.0.0.1:8317`
  - 모든 모델 키를 `gpt-5.3-codex`로 고정
- `~/.zshrc`에 `claude()` 래퍼 함수 추가:
  - `claude` 실행 시 프록시 자동 기동(이미 켜져있으면 `[proxy][CANCEL]`)

## Commands

```bash
npx -y codex-claudecode-proxy@latest          # install (interactive)
npx -y codex-claudecode-proxy@latest --yes    # install (non-interactive)
npx -y codex-claudecode-proxy@latest status
npx -y codex-claudecode-proxy@latest start
npx -y codex-claudecode-proxy@latest stop
npx -y codex-claudecode-proxy@latest uninstall
```

## Requirements

- macOS (LaunchAgents 사용)
- `claude`(Claude Code CLI) 설치
- `codex`(Codex CLI) 로그인 완료 (`~/.codex/auth.json` 존재)

## Notes

- 이 프로젝트는 Claude Code의 Anthropic 호환 설정을 “로컬 프록시”로 돌려서 OpenAI 계정(OAuth)을 재사용합니다.
- 실제 토큰은 `~/.codex/auth.json`에서만 읽고, 프록시용 auth 파일로만 복사합니다.

