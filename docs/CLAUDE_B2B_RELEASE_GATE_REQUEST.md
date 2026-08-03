# Claude B2B 제한 오픈 최종 게이트 요청

## 요청

`AGENTS.md`, `docs/AI_COLLABORATION.md`, `CLAUDE.md`, `.cursorrules`를 먼저 확인한다.

현재 목표는 손님용 전체 공개가 아니라 **영업자·공급사 B2B 제한 오픈 전 최종 위험영역 게이트**다. Codex가 만든 현재 미커밋 diff를 사용자의 원래 요구사항 기준으로 독립 검토한다.

## 집중 검토 파일

- `lib/server/firebase-admin.ts`
- `lib/domain/product-bridge.ts`
- `app/api/products/bridge/route.ts`
- `lib/firebase/rtdb-adapter.ts`
- `scripts/check-b2b-release.mts`
- `scripts/smoke-b2b-product-bridge.mts`
- `components/TopBar.tsx`
- `scripts/ruleprobe/release-candidate.rules.json`
- `VERIFICATION.md`
- `HANDOFF.md`

## 필수 검토 질문

1. 후보 Rules가 v3 `products` 원문을 비관리자에게 닫은 뒤에도 영업자·공급사 재고가 사라지지 않는가.
2. `verifyActiveBearer`가 익명·승인대기·삭제·반려·비활성·미배정 역할을 확실히 차단하는가.
3. 영업자와 타 공급사에 `vehicle_price`, `vin`, `account_number`, `price.*.fee/commission/fee_memo`가 노출되지 않는가.
4. 공급사가 자기 회사 private 원자만 볼 수 있는가.
5. 활성 재고와 계약·문의 참조 삭제이력 선별이 기존 계약/채팅 차량 복원을 누락하지 않는가.
6. `RtdbAdapter`의 v3+v4 tolerant read와 strict Sheet 검증을 깨지 않았는가.
7. 서버 브리지 실패 후 직접 read fallback이 후보 Rules 적용 시 빈 목록을 정상으로 오판하지 않는가.
8. 브리지 API가 read-only이며 v3/v4 write나 권한 우회 경로가 없는가.
9. `브리지 배포 → 실계정 smoke → 후보 Rules 게시` 순서가 안전한가.
10. 후보 Rules의 계약·정산·PII·전자서명·차량잠금 규칙이 정상 B2B 흐름을 막거나 비정상 흐름을 열지 않는가.

## 현재 검증 증거

- 상품 브리지 적대검증: **16/16 PASS**
- 재고 UI 의미·규격: **28/28 PASS**
- 영업자 전체 여정: **44/44 PASS**
- 공통 문의·계약: **48/48 PASS**
- 권한·소유권: **44/44 PASS**
- 채팅 Rules: **43/43 PASS**
- 계약 업무목록: **142/142 PASS**
- Sheet merge: **128/128 PASS**
- 차량잠금: **23/23 PASS**
- 3자 계약→정산: **22/22 PASS**
- 후보 Rules: 보안 **14/14**, 계약 **26/26**, 서명 **58/58**, 격리 Emulator **32/32 PASS**
- typecheck·fonts·tokens·UI contract: PASS
- production build: 정적 페이지 **30/30 PASS**
- Vercel Preview 실배포: Ready, 로그인 GET 200, Admin SDK 사용 API 비인증 403
- Firebase Admin 런타임 호환: `13.10.0 / jwks-rsa 3.2.2 / jose 4.15.9`
- Next 보안 패치·서버 경계: `next@15.5.21`, 없는 경로 404, Preview error 로그 0
- 운영 read-only 집계: v3-only **292건/288대**
- 서버 브리지 예상 응답: 원시 약 5,700건 중 **740건**
- 운영 데이터·Rules write: **0건**
- `SHEET_DAILY_SYNC_ENABLED`: true 아님

## 현재 배포 상태

- Vercel Production은 Ready이며 기존 인증·재고 화면은 동작한다.
- Production의 `/api/products/bridge`는 아직 **404**다. Production 환경·별칭은 변경하지 않았다.
- Vercel에는 Firebase 클라이언트 필수값과 Google Drive 백업 변수가 Production·Preview에 등록돼 있다.
- 서버 전용 `FIREBASE_SERVICE_ACCOUNT_JSON`은 Preview에만 Sensitive로 등록했다. 값은 저장소·출력에 남기지 않았다.
- 첫 Preview에서 `firebase-admin@14.2.0` 하위 `jwks-rsa@4/jose@6` CJS·ESM 충돌로 Admin SDK 사용 API 500을 발견했다. `firebase-admin@13.10.0`, `next@15.5.21`, 서버 `not-found` 리프 import, SheetJS 0.20.3을 반영한 최종 Preview `dpl_9H8TtHymfPhUcocr1gbvpnim66FQ`는 Ready이고 `/login` 200, 없는 경로 404, `/api/products/bridge`·기존 Admin API 비인증 요청 403, error 로그 0이다.
- 중단된 npm `xlsx@0.18.5`는 SheetJS 공식 보안 수정본 `0.20.3` CDN tarball로 교체해 정산·Sheet 회귀를 통과했다. production `npm audit`는 critical 0 / high 3 / moderate 8이며 남은 high는 Next 내부 `postcss/sharp` 전이 항목과 그 집계다.
- `npm run check:b2b-release`: 서비스계정을 현재 프로세스에만 주입한 실제 설정 **23 PASS / 0 FAIL**.
- 기존 후보에서 발견된 `v4/products` 계정상태 우회는 후보 생성기와 Emulator 테스트를 보강해 닫았지만 운영 Rules에는 게시하지 않았다.
- 영업자·공급사 인증 성공 브리지 smoke는 전용 QA ID token 2개가 없어 미실행이다. 실제 운영 사용자는 임의 가장하지 않았다.

## Claude가 반드시 제출할 판정

아래 순서와 형식으로 작성한다.

1. 최종 판정: `GO`, `CONDITIONAL GO`, `NO-GO` 중 하나
2. 출시 차단 이슈와 코드·데이터 근거
3. 보안·데이터·계약·정산별 잔여 위험
4. 반드시 수정할 코드와 파일/라인
5. 코드 수정 없이 운영 절차로 막을 수 있는 항목
6. Preview 배포 전 조건
7. 후보 Rules 게시 전 조건
8. Rules 게시 후 실계정 smoke 항목
9. Sheet 자동동기화 활성화 가능 여부

검토 결과는 저장소 루트 `CLAUDE_REVIEW_B2B_RELEASE.md`에 기록한다. 기존 `CLAUDE_REVIEW_2026-08-03.md`를 덮어쓰지 않는다.

## 금지 사항

- 운영 `database.rules.json` 게시 금지
- 운영 데이터 write 금지
- v3 데이터 이관·삭제 금지
- 서비스계정·ID token·비밀값 출력 금지
- 차단 결함과 무관한 기능 추가 금지
- `rtdb-adapter`, 정산 엔진, Rules를 근거 제시 전에 수정하지 않기
- 로컬 Emulator 통과만으로 운영 Rules 안전을 확정하지 않기
- 실계정 smoke 전에 Production 전체 오픈 판정하지 않기

## 재현 명령

```powershell
npm run check:b2b-release
npx tsx scripts/sim-product-bridge.mts
npx tsx scripts/sim-inventory-display.mts
npx tsx scripts/sim-agent.mts
npx tsx scripts/sim-phase12.mts
npx tsx scripts/sim-work-list-semantics.mts
npx tsx scripts/sim-authorization.mts
npx tsx scripts/sim-chat-rules.mts
npx tsx scripts/sim-vehicle-lock.mts
npx tsx scripts/sim-e2e-settlement.mts
npx tsx scripts/sim-sheet-merge.mts
npx tsc --noEmit
npm run check:fonts
npm run check:tokens
npm run check:ui
npm run build
```

Preview 배포 후 실계정 smoke는 토큰을 파일이나 명령행에 쓰지 않고 현재 셸 환경변수로만 주입한다.

```powershell
$env:B2B_BASE_URL='https://<preview-host>'
$env:B2B_AGENT_ID_TOKEN='<현재 셸에만 주입>'
$env:B2B_PROVIDER_ID_TOKEN='<현재 셸에만 주입>'
$env:B2B_PROVIDER_COMPANY_CODE='<QA 공급사 코드>'
npx tsx scripts/smoke-b2b-product-bridge.mts
```

검증 뒤 토큰 환경변수는 즉시 제거한다.

```powershell
Remove-Item Env:B2B_AGENT_ID_TOKEN
Remove-Item Env:B2B_PROVIDER_ID_TOKEN
```
