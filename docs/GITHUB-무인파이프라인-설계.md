# GitHub 무인 파이프라인 설계 — 차종 매칭·정제·발행을 코드+CI로 (AI 루프 제거)

> 사장님(2026-08-29): 「이걸 GitHub이 로직대로 하게 해야지, 이제 AI 돌리지 말고.」
> 원리: [반복 실수는 코드 게이트로]. 규칙=문서면 AI 드리프트 → 규칙=코드+CI면 결정적·무인.

## 목표

차종 매칭·정제칸·F01·ERP 를 **결정적 코드**로 만들고 **GitHub Actions**가 자동 운영한다. **매 작업마다 AI(Claude/Cursor/Codex)를 돌리지 않는다.** AI는 로직/규칙이 바뀔 때 PR 리뷰만.

## 워크플로우 A — 게이트 (on push / PR)

머지 전 불변식 위반 시 **실패 → 머지 차단**(거짓 초록불 없음):

| 체크 | 내용 | 이미 있음? |
|---|---|---|
| `tsc --noEmit` | 타입 | ✓ |
| `check:master-frozen` | F03 이름 7열 해시 불변(동결). 바뀌면 실패(사장님 플래그 없이) | 신규 |
| `check:submodel-in-f03` | 정제칸/F01 발행 세부모델 ⊆ F03 집합. 비-F03(디올뉴 싼타페 등) 있으면 실패 | 신규 |
| `check:sync` | F01 4탭·열 수 매뉴얼 정합 | ✓ |
| `check-vehicle-master-lock` | 코드↔마스터 잠금 | ✓ |

## 워크플로우 B — 파이프라인 (schedule cron, 매시간)

무인 운영: 원문 pull → 정제(F03 매칭) → F01 발행 → 천이 → ERP. **게이트 통과분만 반영.**

```
① 원문 pull(손오공 API·미러)
② 정제: 원문 → F03 매칭(submodel-normalize-f03, 확정원자만) → 정제칸
   └ ★단일 관문 assertSubmodelInF03(sub): F03에 없으면 throw → 발행 거부(검수대기)
③ F01 4탭 발행 · ④ 천이 · ⑤ ERP 동기
⑥ 완료검사: 정제칸↔F01↔천이↔ERP 차번 대조. 불일치면 쓰기 차단·이슈 생성.
```

- 한 단계라도 게이트/읽기 실패 → 그 실행 실패, 다음 쓰기 막고 알림(GitHub Issue/Slack).
- provenance(F03 해시·규칙버전·대상수) 로그를 아티팩트로.

## 단일 관문 (구조적 차단의 핵심)

모든 «세부모델 발행」이 반드시 지나는 한 함수:
```ts
// lib/domain/publish-gate.ts
export function assertSubmodelInF03(sub: string, f03Set: Set<string>): void {
  if (!f03Set.has(sub)) throw new PublishBlocked(`비-F03 세부모델 발행 거부: ${sub}`);
}
```
정제칸 write·F01 publish·ERP sync 전 이 함수를 호출 → 「디올뉴 싼타페 MX5」류는 코드가 막아 **불가능**.

## 정본 하나

- 차종 매칭 = **F03 시트만**(런타임). `vehicle-master.json`은 F03서 «재생성 + 해시 일치검사」, 불일치면 빌드 실패. 스테일 사전 드리프트 제거.

## 인프라

- **Secrets(GitHub repo)**: `GOOGLE_SERVICE_ACCOUNT_JSON`(pyh 위임)·Firebase 키. 워크플로우가 이걸로 시트·RTDB 접근.
- 현재 로컬 schtask(`aiops/손오공-매일`) → GitHub Actions cron 이관(또는 병행 후 전환).
- 리전·권한은 기존 그대로.

## AI 역할 (축소)

- **운영: 0** (GitHub이 한다).
- **로직/규칙 변경 시에만**: 매뉴얼(SSOT) 고침 → 코드/게이트 PR → CI 통과 → 머지. Claude 설계·Cursor 구현·Codex 검증은 «그때만».

## 구현 순서 (Cursor)

1. `assertSubmodelInF03` 단일 관문 + 정제칸/F01/ERP 발행부에 배선.
2. `check:submodel-in-f03`·`check:master-frozen` 스크립트 + `package.json`.
3. `.github/workflows/gate.yml`(push/PR) · `pipeline.yml`(cron) + Secrets.
4. `vehicle-master.json` = F03 재생성+해시검사.
5. 로컬 schtask → cron 이관.
