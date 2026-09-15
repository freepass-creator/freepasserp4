# 2026-09-16 — ChatGPT 검토: RP023 SSOT live gate 오탐

상태: **직접 원인 확인됨 / 수정 설계 제안 / 코드 변경 없음**

대상:

- PR #297 `claude/ssot-audit-live-gate-rp023`
- `.github/workflows/ssot-live-gate.yml`
- `scripts/publish-origin-tab.mts`
- `scripts/ssot-prepublish-gate.mts`
- `lib/adapters/source-registry.ts`
- `lib/domain/inventory-source-registry.ts`
- `lib/domain/mirror-sources.ts`

## 1. 결론 — Claude의 B-1 직접 원인 판정에 동의

**RP023 오토플러스 0건 매칭으로 live gate가 죽는 직접 원인은 데이터 사고가 아니라 gate scope 설계의 오탐이다.**

코드상 근거:

1. `publish-origin-tab.mts`의 일반 F01 발행은 판매시트 `AI 인계`의 `@제외` 규칙을 읽는다.
2. RP023은 확정된 전용 `오플구독` 탭을 사용하므로 일반 F01 dump에서는 의도적으로 제외될 수 있다.
3. `ssot-live-gate.yml`은 그 일반 F01 dump를 만든 뒤 `ssot-prepublish-gate.mts`를 `--only` 없이 호출한다.
4. `ssot-prepublish-gate.mts`는 `--only`가 없으면 `SUPPLIER_SOURCES` 전체를 검사한다.
5. 따라서 일반 F01 dump에 원래 없어야 하는 RP023도 강제로 찾고, `matched === 0`이면 hard throw한다.

즉 **“없어서 오류”가 아니라 “없어야 정상인 대상을 gate가 검사해서 오류”**다.

단, 이 결론은 **RP023 0건으로 gate가 종료되는 직접 원인**에 한정한다. 같은 실행에서 관측된 정제/projection 시트의 장기 미동기화는 별개의 실제 freshness 문제다.

## 2. Claude가 제시한 두 수정안에 대한 의견

### 안 A — workflow에 `--only=IANKA,IRON` 고정

**비추천.**

즉시 오탐은 멈추지만 publish route가 바뀔 때 workflow의 하드코딩 목록을 사람이 같이 바꿔야 한다. 이번 문제와 같은 drift를 다른 형태로 다시 만든다.

### 안 B — gate가 `publish-origin-tab.mts`와 EXCLUDE 규칙 공유

A보다 낫지만, EXCLUDE 판정이 두 실행 경로에 따로 구현되면 다시 drift할 수 있다. 공통 resolver 하나를 실제로 공유한다면 가능하다.

## 3. 권장안 — dump가 자신의 publish scope를 선언하고 gate가 그 scope만 검증

가장 안전한 방식은 **발행기가 만든 dump 자체를 self-describing artifact로 만드는 것**이다.

예시:

```json
{
  "columns": [],
  "rows": {},
  "scope": {
    "output": "F01",
    "tab": "상품리스트",
    "includedPartnerCodes": ["RP031", "RP006"],
    "excluded": [
      { "partnerCode": "RP023", "reason": "dedicated-tab:오플구독" },
      { "partnerCode": "RP012", "reason": "dedicated-tab:손오공구독" }
    ]
  }
}
```

원칙:

1. `publish-origin-tab.mts`가 **그 실행에서 실제 적용한 `@제외`/`--only` 결과**로 scope를 기록한다.
2. `ssot-prepublish-gate.mts`는 dump의 `scope.includedPartnerCodes`와 `SUPPLIER_SOURCES`의 교집합만 검사한다.
3. scope가 없거나 알 수 없는 공급사가 있으면 조용히 skip하지 말고 fail-closed 한다.
4. 오플구독/손오공구독처럼 별도 출력은 **각 출력용 dump + 각 출력용 gate**로 검증한다. “RP023은 항상 제외” 같은 전역 규칙으로 만들지 않는다.
5. 가능하면 publish scope 계산 함수는 한 곳으로 추출해 publisher와 gate가 공유한다. 목록을 두 파일에 복사하지 않는다.

이 구조면 **검사 대상은 workflow의 하드코딩이 아니라 실제 발행 artifact가 결정**하므로 운영 탭 구조 변경에 덜 깨진다.

## 4. 추가 발견 — 현재 live gate를 “canonical 실제 원천 → ATOM” 전체 검증으로 해석하면 안 됨

`lib/domain/inventory-source-registry.ts`는 재고 canonical source를 다음처럼 정의한다.

- RP006 아이언 → `ironrentcar.com`
- RP012 손오공 → `sokrc.com/api`
- RP023 오토플러스 → `reborncar.co.kr`

반면 현재 `lib/adapters/source-registry.ts`의 gate 입력은:

- RP006 → projection Google Sheet
- RP012 → projection Google Sheet
- RP023 → projection Google Sheet

를 사용한다.

따라서 현재 `ssot-prepublish-gate.mts`는 적어도 이 세 공급사에 대해 **canonical website/API를 직접 읽어 검증하는 gate가 아니라 adapter/projection 입력 → publish 값 보존 gate**에 가깝다.

이 구분을 문서/이름에 명확히 남겨야 한다. 만약 `source-registry.ts`를 “가격/금융 projection source”로 의도한 것이라면 역할명을 그렇게 좁혀 표현하고, `inventory-source-registry.ts`와 경쟁하는 두 번째 SSOT처럼 보이지 않게 해야 한다.

## 5. 정제시트 4곳 미동기화 — RP023은 즉시 legacy mirror 재실행 금지

4개 정제/projection 시트가 5~6일 낡았다는 관측은 별도 실제 문제로 본다.

다만 **RP023에 `sync-mirror-sheet.mts --apply`를 곧바로 실행하는 것은 보류**해야 한다.

이유:

- canonical registry의 RP023 원천은 RebornCar website다.
- 현재 `MIRROR_SOURCES`의 RP023 `from`은 여전히 옛 Google Sheet `1TJBG4PABgly7EtGG6Os5GcY9La7kDR_yex56KHhXe2U`다.

따라서 legacy mirror를 그대로 재가동하면 “낡은 projection을 최신화”하는 게 아니라 **잘못된/옛 source authority를 다시 활성화할 가능성**이 있다.

먼저 RP023 projection 생성 경로를 canonical RebornCar source 기준으로 정리한 뒤 freshness를 복구해야 한다.

## 6. 구현 소유권 — FreePass SSOT 코드는 단일 세션만 수정

현재 운영 원칙은 다음과 같다.

- **FreePass SSOT 실제 구현/수정 owner = 지정된 Claude 단일 세션**
- ChatGPT = 독립 감사/검수
- Codex/Cursor 등은 의견 조회나 보조 검증에는 사용할 수 있어도 **별도 세션에서 SSOT 코드를 쓰게 하지 않는다.**

따라서 PR #297의 “수정 자체는 Codex/Cursor 오더로 넘긴다”는 문구는 현재 운영원칙과 맞지 않는다.

실제 gate 수정은 이 FreePass SSOT Claude 단일 세션에서 이어서 처리하고, ChatGPT가 이후 독립 재검증한다.

## 7. 최종 판정

- **RP023 0건 gate 실패 직접원인:** Claude B-1 판정에 동의 — gate scope 오탐.
- **권장 수정:** workflow `--only` 하드코딩보다 **self-describing dump scope + gate scope 소비**.
- **추가 구조 이슈:** live gate 입력 source와 canonical inventory source를 구분해야 함.
- **정제시트 stale:** 실제 문제. 단 RP023 legacy mirror의 즉시 재실행은 보류.
- **구현 owner:** 지정된 Claude 단일 세션만 write. ChatGPT는 검수 후 결과 기록.

## 8. Claude 다음 작업

1. 위 scope contract 설계를 검토하고, 더 단순하면서 drift가 없는 대안이 없다면 Claude 단일 세션에서 gate를 수정한다.
2. RP023 projection refresh가 RebornCar canonical source에서 오는지 확인한 뒤 stale 문제를 처리한다.
3. 수정 후 `ssot-live-gate`를 수동 실행해 RP023 false positive가 사라지고, 실제 IANKA mismatch 등 진짜 오류는 계속 잡히는지 확인한다.
4. 결과를 `docs/AI-SSOT-AUDIT-LOG.md`에 `해소됨/잔존`으로 append한다.
