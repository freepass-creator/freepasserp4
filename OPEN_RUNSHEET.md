# 오픈 실행표 — 위에서 아래로 (2026-08-04)

여러 문서에 흩어진 오픈 절차를 **실행 순서 하나**로 합친 것.
근거는 `LAUNCH_GONOGO.md` §1-1 · `CLAUDE_GATE_VEHICLE_CLAIM_2026-08-04.md` · `VERIFICATION.md`.

> **순서를 바꾸면 안 된다.** RTDB 는 `freepasserp3` 하나뿐이라 **Rules 게시는 즉시 전역**인데
> 환경변수는 **배포 단위**다. 이 어긋남이 이 표의 존재 이유다.

## 역할 분담

- **Claude Code:** 돈·권한·Rules·데이터·도메인 전환의 위험 게이트와 최종 go/no-go만 담당한다.
- **Cursor:** 오픈 게이트 누락이나 재현된 차단 결함의 기계적 구현만 담당하고 `IMPLEMENTATION_LOG.md`에 기록한다.
- **Codex:** 브라우저·실계정·시뮬레이션·빌드·배포 전후 검증과 수정·완료 판정을 담당한다.
- **사용자:** Production 환경 반영, 임시 QA 계정 생성, 아이언 적용, 후보 Rules 게시, 도메인 전환을 실행 직전에 승인한다.

홈 개편·추가기능·장기 리팩터링·비차단 UI 개선은 오픈 후로 미룬다.

---

## 0. 지금 상태

```
코드      ✅ 끝. release 차단 0 · 최신 B2B 55/55 · claim 17/17 · 차량락 38/38 · build 30/30
Preview   ✅ 운영자 7필드 · 서비스계정 · claim 두 플래그 · 재동의 ON — 실제 화면 확인됨
Production ❌ 필수 env 없음. main 자동배포로 생기는 fp4 Production은 env 검증 전 전부 사용 금지
운영 Rules ❌ 구 규칙 그대로(후보 미게시)
도메인    ❌ freepasserp.com 은 아직 구 프로젝트 freepasserp3 을 가리킴
```

법적 필드는 **전부 확정**됐다. 개인정보 보호책임자 = **박영협 · 대표이사**(2026-08-04 사용자 승인).

---

## 1. Preview 실계정 게이트 — Production보다 **먼저**

- [ ] 기존 회원 1명으로 재동의 **표시 → 저장 → 재로그인 시 미표시** 확인
- [ ] 5역할 QA 계정으로 session·상품 브리지 GET baseline 확인
- [ ] 관리자 아이언 미리보기에서 49/24/25 · 수정21 · 신규3 · 부재차단4와 영향 키 확인

자동 5역할 smoke는 읽기 전용이다. 계약·채팅·재고·정산 write 허용과 타 조직 denial은 8단계에서 별도로 확인한다.

## 2. Production 환경변수 — Rules 게시보다 **먼저**

Vercel → freepasserp4 → Settings → Environment Variables → **Production**

```
NEXT_PUBLIC_OPERATOR_COMPANY          프리패스모빌리티 주식회사
NEXT_PUBLIC_OPERATOR_CEO              박영협
NEXT_PUBLIC_OPERATOR_BIZ_NO           528-88-02988
NEXT_PUBLIC_OPERATOR_ADDRESS          서울시 강서구 양천로 53길 30, 서서울모터리움 1004호
NEXT_PUBLIC_OPERATOR_EMAIL            pyh@teamjpk.com
NEXT_PUBLIC_OPERATOR_PHONE            010-6384-9260
NEXT_PUBLIC_OPERATOR_PRIVACY_OFFICER  박영협

NEXT_PUBLIC_REQUIRE_LEGAL_RECONSENT   true

FIREBASE_SERVICE_ACCOUNT_JSON         (Preview 와 동일)
VEHICLE_CLAIM_SERVER_ENABLED          true
NEXT_PUBLIC_ATOMIC_VEHICLE_CLAIMS     true
IRONRENTCAR_SYNC_ENABLED               true
```

⚠ 한글은 **UTF-8 파일 stdin** 으로 넣는다. PowerShell 직접 입력은 `?` 로 깨진다(실측 사고).

재동의는 1단계 Preview 저장·재로그인 검수 뒤 Production 최초 후보부터 `true`로 넣는다.

## 3. Production 재배포 → 고유 URL 에서 확인

도메인은 아직 건드리지 않는다. 새 Production 고유 URL 로만 본다.

- [ ] `/terms` · `/privacy` — 운영자 7값 표시, **경고 배너 0**, 한글 깨짐 0
- [ ] `npm run check:b2b-release` 를 Production 환경 기준으로 통과(최신 게이트 55/55)

## 4. Rules 게시 전 실계정 baseline — **두 경로 다**

게시 전에 서버 경로가 살아있다는 증거를 만든다. 이게 4단계의 안전장치다.

- [ ] **차량선점** — QA 계약 1건에 「계약금 입금」 체크 → 성공, 해제/복원까지 확인
- [ ] **재고 브리지** — 영업자 계정으로 재고 목록이 **정상 대수**로 보임

> 둘 다 게시 후에 죽는 경로다. 계약금은 401, 재고는 v3-only 292건/288대가 사라진다.
> 지금 되는 것을 확인해 둬야 게시 후 이상을 구분할 수 있다. 운영 계약을 테스트용으로 임의 변경하지 않는다.

## 5. 백업 — 게시 직전에 새로 뜬다

- [ ] RTDB 전체 export (직전 백업이 오래됐으면 재실행)
- [ ] **현재 라이브 Rules 텍스트 백업** ← 유일한 롤백 수단
- [ ] 직전 정상 배포 ID 기록

## 6. 사람/Claude 위험 게이트

- [ ] 1~5단계 증거를 Claude Code가 확인해 go/no-go 기록
- [ ] 사용자가 후보 Rules 게시 승인

## 7. 후보 Rules 게시

콘솔 → RTDB → 규칙 → `scripts/ruleprobe/release-candidate.rules.json` 전체 붙여넣기 → 게시

**1~6 이 끝나기 전에는 절대 하지 않는다.** 게시 대상은 오직 이 후보 파일이며 현재 `database.rules.json`을 대신 게시하지 않는다.

## 8. 게시 직후 재확인 + 5역할 수동 권한 smoke

- [ ] 계약금 입금 체크 1건 — 여전히 성공
- [ ] 영업자 재고 목록 — 대수 동일
- [ ] 관리자·영업관리자·영업자·공급사관리자·공급사직원: 계약·채팅·재고·정산의 허용 write와 타 조직 denial

여기서 실패하면 **즉시 5단계 백업 Rules 재게시.** 그것만으로 구 경로가 살아난다.

## 9. 아이언렌트카 재고 반영

- [ ] 관리자 미리보기에서 49/24/25 · 수정21 · 신규3 · 부재차단4 확인
- [ ] 영향 28키와 `v4/partners/RP006` preimage·명시 복구 경로 확인
- [ ] 명시 적용 28건 → RP006 활성 24대 · 시트 제외 · 감사로그 확인
- [ ] 실패 또는 사용자 판단 시 preimage 복구가 최신 적용을 덮지 않는지 확인

## 10. 도메인 전환 — 맨 마지막

- [ ] fp4 Production 고유 URL 검수 완료 확인
- [ ] `freepasserp.com` · `www` alias 를 fp4 최신 배포로 전환
- [ ] 구 fp3 배포 ID(`dpl_4K9TWPGwomjKnLmS2fc4VYFPmaJ5`) 롤백용 보존
- [ ] DNS·domain ownership 은 미리 제거하지 않는다

---

## 오픈 직후 볼 것

`v4/_client_errors` 급증 · Vercel Functions 에러율 · RTDB read 량 · 로그인 성공률.
자동 알림이 없으므로 **당일은 수동 관찰**이다.

## 알고 열는 잔여 (오픈 차단 아님)

| 항목 | 내용 | 근거 |
|---|---|---|
| 트윈 102그룹 | 같은 실물이 복수 코드. 가드로 막고 근원 제거(병합)는 사람 판단 | `DOUBLE_SALE_GUARD` §6 |
| 정산 이관분 14건 | R2 누락 — 정산 방식 확정 대기 | `SETTLEMENT_AUDIT` |
| 회원 45명 | 채널 미지정. 자동 배정은 유출 위험이라 보류 | `MEMBERSHIP_AUDIT` |
| 시트 회신 | 미게시 사유를 공급사에 돌려주는 기능 미구현 | `SHEET_WRITEBACK_PLAN` |
| npm audit | High 3 · Moderate 8. 완전수정은 Next 16 메이저 | `LAUNCH_GONOGO` |
