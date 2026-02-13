# codex-claudecode-proxy

Claude Code CLI(`claude`)가 **내 Codex 로그인 상태를 재사용**할 수 있도록, 로컬에 필요한 구성(프록시/자동 실행/설정)을 한 번에 잡아주는 `npx` 설치 도구입니다.

## 설치 (한 줄)

```bash
npx -y codex-claudecode-proxy@latest
```

## 사용

설치가 끝나면:

```bash
claude
```

## 요구사항

- macOS 전용
- Claude Code CLI(`claude`)가 설치되어 있어야 함
- Codex CLI에 로그인되어 있어야 함

## 자주 쓰는 명령어

```bash
# 설치(재실행해도 안전하게 동작)
npx -y codex-claudecode-proxy@latest

# 상태 확인
npx -y codex-claudecode-proxy@latest status

# 수동 시작/중지
npx -y codex-claudecode-proxy@latest start
npx -y codex-claudecode-proxy@latest stop

# 제거(원복): 백그라운드 실행을 끄고 Claude Code 설정을 원래대로 되돌림
npx -y codex-claudecode-proxy@latest uninstall

# 완전 삭제: 제거 + 설치된 파일까지 모두 삭제
npx -y codex-claudecode-proxy@latest purge
```

## 동작 방식 (사용자 관점)

- **비대화형**으로만 동작합니다(질문/프롬프트 없음).
- 설정 플래그로 이것저것 조정하는 방식 대신, 기본값으로 바로 쓸 수 있게 구성되어 있습니다.

## 무결성/안전

- `~/.zshrc`를 수정하지 않습니다.
- Claude Code 설정은 자동으로 구성되며, 변경 전 백업을 남깁니다.
- `uninstall`을 실행하면 “프록시를 쓰도록 바꿔둔 Claude Code 설정”을 정리해 원복합니다.

## 문제 해결

- 설치 중 “로그인이 필요”하다는 메시지가 나오면: Codex CLI에서 로그인 후 다시 실행하세요.
- `claude`가 실행되지 않으면: Claude Code CLI가 설치되어 있는지 확인한 다음 다시 설치를 실행하세요.

## 라이선스

MIT
