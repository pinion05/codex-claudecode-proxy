# codex-claudecode-proxy

openai oauth api 를 claude 호환 api 로 번역해주는 로컬 프록시 설치도우미 cli

## 그저 한줄.

```bash
npx -y codex-claudecode-proxy@latest
```

## 요구사항

- macOS 전용 (아직은)
- Claude Code 가 설치되어 있어야 함
- Codex Cli 에 로그인되어 있어야 함

## 명령어목록

```bash
# 설치(재실행해도 안전하게 동작)
npx -y codex-claudecode-proxy@latest

# 상태 확인
npx -y codex-claudecode-proxy@latest status

# 수동 시작/중지
npx -y codex-claudecode-proxy@latest start
npx -y codex-claudecode-proxy@latest stop

# 백그라운드 실행을 끄고 Claude Code 설정을 원래대로 되돌림
npx -y codex-claudecode-proxy@latest uninstall

# 제거 + 설치된 파일까지 모두 삭제
npx -y codex-claudecode-proxy@latest purge
```
## 무결성/안전

- Claude Code 설정은 자동으로 구성되며, 변경 전 백업을 남깁니다.
- `uninstall`을 실행하면 “프록시를 쓰도록 바꿔둔 Claude Code 설정”을 정리해 원복합니다.

## 라이선스

MIT
