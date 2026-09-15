# 2026-09-16 — Codex CLI와 GPT CLI 분리 운영안

상태: **설계 제안 / 구현 전**

## 결론

Codex와 GPT를 CLI에서 **서로 별도 채널로 분리 운영하는 것이 가능하고, FreePass SSOT 운영에는 오히려 권장된다.**

권장 구조:

```text
Claude 단일 SSOT 구현 세션 = 실제 코드/구현 Owner

Codex CLI = 코드 실행/검증/로컬 분석 보조
GPT CLI   = 독립 감사/설계/리뷰 보조

GitHub MD = 공용 기억/소통 창구
```

## 1. Codex 쪽

OpenAI 공식 Codex CLI를 그대로 사용한다.

예:

```bash
codex
```

역할:

- 저장소 읽기
- 코드 분석
- 테스트 실행
- 수정 제안
- 필요 시 구현 보조

단, FreePass SSOT 운영 원칙상 **별도 Codex 세션이 실제 SSOT 코드를 독립적으로 쓰는 writer가 되면 안 된다.**

Codex는 지정된 Claude 구현 세션의 보조 검증/실행 채널로 사용한다.

## 2. GPT 쪽

Codex CLI와 별개로 `gpt` 또는 `gpt-audit` 같은 명령을 만들어 OpenAI Responses API를 호출한다.

예시 개념:

```bash
gpt-audit "현재 writer topology를 검토하고 충돌을 찾아라"
```

또는:

```bash
gpt-review docs/AI-SSOT-AUDIT-LOG.md
```

역할:

- 독립 코드 리뷰
- 아키텍처 검토
- SSOT 감사
- Claude 판단 교차검증
- GitHub MD용 검토 의견 생성

이 CLI는 현재 ChatGPT 웹 채팅 세션 자체를 직접 이어받는 방식이 아니라, OpenAI API를 통해 별도의 GPT 모델 호출 채널을 만드는 방식으로 이해한다.

## 3. 인증도 분리 가능

Codex CLI와 GPT API 호출은 같은 OpenAI 계정을 기반으로 할 수 있지만, 인증/실행 경로는 분리할 수 있다.

권장:

```text
Codex CLI
  - codex 전용 로그인/자격증명

GPT audit CLI
  - OPENAI_API_KEY 또는 전용 API project/key
```

운영 목적이 다르면 API key/project도 분리하는 것이 로그·비용·권한 추적에 유리하다.

## 4. 사용량/과금 구분 — 중요

사용자가 원하는 목적은 **Claude/Codex 작업 한도를 아끼면서 GPT 의견을 독립적으로 참고하는 것**이다.

이 방향은 가능하지만, `gpt-audit`를 OpenAI API로 호출한다고 해서 "완전히 무사용량/무료"가 되는 것은 아니다.

정확한 구분:

```text
ChatGPT / Codex 사용량·크레딧
        ≠
OpenAI API 사용량·과금
```

OpenAI의 현재 공식 안내상 ChatGPT 구독과 API 플랫폼은 별도의 결제 시스템이며, API 사용은 별도 API 사용량/과금으로 처리된다.

따라서:

- GPT API 호출은 **ChatGPT/Codex 쪽 사용 한도를 직접 소모하지 않는 별도 채널**로 운용할 수 있다.
- 대신 **API 토큰 사용량에 따른 별도 비용**은 발생할 수 있다.
- 그래서 대량 구현보다는 구조 검토·감사·의견 수렴처럼 짧고 가치가 높은 호출에 쓰는 것이 적합하다.
- `gpt-audit` 전용 API project/key를 두면 비용과 로그를 따로 추적하기 쉽다.

운영 표현은 "사용량 안 쓰는 GPT"보다 **"Codex/ChatGPT 한도와 분리된 GPT API 감사 채널"**이 정확하다.

## 5. FreePass에서 권장하는 실제 역할

### Claude

**단일 구현 Owner**

- SSOT 코드 수정
- branch/PR 작성
- 구조 통합
- 실제 구현 판단

### GPT

**독립 감사자**

- 구조 검토
- gate/CI 검토
- source → adapter → atom → projection 경로 검증
- Claude PR 검수
- 감사 MD 작성

### Codex CLI

**실행/검증 보조**

- grep/search
- 테스트
- 로컬 재현
- 코드 분석
- 변경 영향 확인

## 6. 권장 명령 구조

향후 AI Core 또는 FreePass repo에서 아래처럼 만들 수 있다.

```text
ai codex <task>
ai gpt <task>
ai audit <task>
ai relay
```

예:

```bash
ai codex "PR 297 테스트 재현"
ai gpt "PR 297 설계 검토"
ai audit "현재 SSOT writer topology 검사"
ai relay
```

`ai relay`는 `docs/ai-ssot-audit/AI-INBOX.md`를 읽고 현재 AI 간 요청을 요약하는 명령으로 만들 수 있다.

## 7. 중요한 원칙

CLI를 여러 개 붙인다고 **구현 Owner까지 여러 개로 늘리면 안 된다.**

정상:

```text
여러 AI가 읽고 검토
        ↓
한 Claude 세션이 구현
        ↓
GPT/Codex가 재검증
```

비정상:

```text
Claude 수정
Codex 수정
GPT 수정
Cursor 수정
→ 같은 SSOT 파일을 병렬 write
```

AI 호출 채널은 여러 개여도 **코드 write authority는 하나**로 유지한다.

## 8. 다음 구현 제안

실제로 CLI 통합을 만들 때는 아래 두 개부터 만든다.

1. `codex` 공식 CLI 연결 확인
2. `gpt-audit` 작은 Node/Python wrapper 생성

그 다음 둘 다 같은 GitHub MD와 audit log를 읽게 만든다.

최종 구조:

```text
Claude implementation session
        ↑
AI-INBOX / AUDIT-LOG / ARCHITECTURE-CONTRACT
        ↓
GPT audit CLI
Codex verification CLI
```

## 최종 문장

> **CLI는 Codex와 GPT를 따로 연결할 수 있다. GPT API는 ChatGPT/Codex 사용 한도와 분리할 수 있지만 별도 API 사용량·과금은 발생한다. 호출 채널은 여러 개로 만들되, FreePass SSOT의 실제 write authority는 지정된 Claude 단일 세션 하나로 유지한다.**
