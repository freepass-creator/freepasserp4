# Claude B2B 제한 오픈 게이트 — 판정

요청: `docs/CLAUDE_B2B_RELEASE_GATE_REQUEST.md` (Codex)
판정 기준: `docs/AI_COLLABORATION.md` — **"로컬 에뮬레이터 통과 ≠ 실데이터 안전"**.
내가 볼 것은 보안 구멍이 아니라 **정당한 사용자가 못 하게 되는 것**이다.
방법: 후보 Rules·브리지 코드를 **운영 실데이터**에 대고 직접 실행(읽기 전용, write 0건).

## 결론

**B2B 제한 오픈 GO** — 단, 게시 순서를 지킬 것(§3). 남은 차단은 법정 운영자 정보 6필드 하나뿐이다.

---

## 1. 필수 질문 판정

### Q1. 후보가 v3 `products` 를 관리자 전용으로 닫은 뒤 영업자·공급사 재고가 사라지는가 → **아니다. 누락 0**

후보 `products['.read']` 는 `role === 'admin'` 으로 닫히고 `.write = false` 다. 실측:

```
v3 products 5,730 (살아있음 443) · v4 overlay 5,649 (살아있음 644)
현재 병합 살아있는 매물                     1,086
후보 적용 후 직접 read 로 보이는 것(v4만)     644
브리지가 보충하는 레거시 매물                716
────────────────────────────────────────────────
커버 1,359 / 필요 1,086 · 누락 0
```

`selectLegacyProductsForBridge` 가 **활성 + 계약·문의 참조 삭제이력**을 같이 집어 와서
Q5(참조 삭제이력 선별)도 함께 만족한다. 브리지 없이 후보만 게시하면 영업자 화면이
**1,086 → 644 로 반토막** 나므로, 게시 순서가 §3 처럼 강제된다.

### Q2. `verifyActiveBearer` 가 익명·승인대기·삭제·반려·비활성·미배정을 차단하는가 → **차단한다**

`lib/server/firebase-admin.ts:55-84` 실측:
- 토큰 없음 → null · 익명(`sign_in_provider === 'anonymous'`) → null
- 프로필 없음 또는 `role` 이 `ACTIVE_ROLES` 밖(미배정) → null
- `status` 가 `pending`·`deleted`·`rejected` → null
- `is_active === false || '아니오'` → null

`is_active` 판정이 **blacklist** 라 필드가 아예 없는 레거시 회원 157명이 잠기지 않는다 — 이 프로젝트에서
whitelist 로 했다가 실제로 다친 적이 있는 자리인데 제대로 피했다.

### Q3. 영업자·타 공급사에 `vehicle_price`·`vin`·`account_number`·`price.*.fee` 가 노출되는가 → **안 된다**

브리지 원문에는 실제로 비공개 원자가 들어 있다(`account_number` 394 · `vehicle_price` 115).
`projectLegacyProductsForActor` 투영 후 실측:

| 역할 | 응답 건수 | 자기회사 | 비공개 원자 |
|---|---:|---:|---|
| 영업자 | 716 | 39 | **없음** ✓ |
| 공급사 RP004 | 716 | 100 | **없음** ✓ |
| 공급사 RP023 | 716 | 125 | **없음** ✓ |
| 관리자 | 716 | 39 | `account_number` 394 · `vehicle_price` 115 (정당) |

### Q4. 공급사가 자기 회사 private 원자만 볼 수 있는가 → **자기 것도 못 본다(과잉 마스킹)**

Q3 표대로 공급사는 **자기 회사 매물의 원가도** 못 본다. 유출은 아니라 fail-safe 쪽이고
B2B 제한 오픈을 막을 사유는 아니다. 다만 공급사가 자기 매입원가를 자기 화면에서 못 보는 것이
의도인지 확인이 필요하다. 의도라면 그대로, 아니라면 투영에서 `provider_company_code === companyCode`
조건으로 자기 것만 남기면 된다. **오픈 후 처리 가능.**

### Q6. v3+v4 tolerant read 와 strict Sheet 검증을 깨지 않았는가 → **안 깼다**

`merged(entity, co, strict=false)` 는 `liveRead.catch(()=>[])` · `overlayRead.catch(()=>[])` 를 유지한다.
`strictHealth` 호출부는 `sheet-merge.ts` 2곳 + `sheet-sync-all.ts` 1곳 뿐 — **시트 저장 전용**이고
계약·정산 페이지는 `list()` → `merged(strict=false)` 를 탄다. AI_COLLABORATION 의 금지 조항 통과.

### Q8. 브리지가 read-only 인가 → **그렇다**

`app/api/products/bridge/route.ts` 는 GET 만 export 하고 `firebaseAdminDatabase().ref(...).get()` 만 쓴다.
응답에 `Cache-Control: private, no-store` · `Vary: Authorization` 이 붙어 프록시 캐시로 역할이 섞이지 않는다.

### Q10. 후보 Rules 가 정상 B2B 흐름을 막는가 → **막았다. 고쳤다**

이게 이번 게이트의 핵심 발견이다. 후보는 에뮬레이터 32/32 · 계약 26/26 · 전자서명 58/58 을 통과하는데도
**운영 실데이터에서 v3 계약 32건이 0/32 전건 차단**됐다. 그 테스트들이 실제 v3 레코드로 승격을
시도하지 않아서 안 보였다.

수정(커밋 `0c84ae5`): `build-release-candidate.mjs` 의 `.validate` 두 곳
1. 생성 가드에 레거시 마커 — `data.exists() || root.child('contracts').child($contract_id).exists() || …`
2. `hasChildren` 에서 `contract_status` 제거 — ①만으로는 부족했다(레거시 patch 에 그 필드가 없어 먼저 걸림)

위조 우려 없음: v3 `contracts` 노드에 `.write` 가 **아예 없다**(기본 거부) → 마커는 신뢰 가능.
신규 계약이 `계약요청` 이어야 하는 강제는 마지막 절에 그대로 남는다.

부수로 `agent_channel_code` 5건 백필(값을 만들지 않고 `agent_uid` → users 채널 승계).

```
레거시 승격  0/32 → 26/27
  (남은 1건 TMP-260604-10 은 전 필드 공란 껍데기 = 정상 차단)
보안 회귀 없음 — 계약 26/26 · 전자서명 58/58 · 보안 14/14 (후보 기준 재실행)
```

---

## 2. 미판정 — 오픈 차단은 아님

- **Q7 브리지 실패 후 직접 read fallback 이 빈 목록을 정상으로 오판하는가.** 코드상 fallback 경로는
  확인했으나 후보 Rules 적용 상태에서의 실제 응답을 재현하지 못했다(규칙 미게시). §3 순서를 지키면
  브리지가 먼저 살아 있으므로 이 경로에 도달하지 않는다. **게시 직후 눈으로 확인할 항목**에 넣었다.
- **Q9 순서 안전성** → §3 에서 판정.

---

## 3. 게시 순서 — 반드시 이 순서

되돌림 비용이 비대칭이다. 코드는 Vercel 재배포(수 분), 규칙은 콘솔 이전 버전 복원(30초).
**위험한 쪽을 나중에** 넣고 바로 관측한다.

1. **브리지 배포 먼저.** 후보 Rules 를 먼저 게시하면 브리지가 없는 동안 영업자·공급사 재고가
   1,086 → 644 로 반토막 난다(Q1). 배포 후 영업자·공급사 실계정으로 재고 건수를 눈으로 확인.
2. **실계정 smoke.** 영업자·공급사 각 1계정으로 재고 목록 · 상세 · 문의 · 계약 진행 1건.
3. **현재 규칙 텍스트 백업** → 콘솔에 후보 게시.
4. **게시 직후 확인**(아래 §4). 이상하면 이전 버전 복원 30초.

---

## 4. 게시 직후 사람이 눈으로 볼 항목

| 확인 | 대상 | 기대 |
|---|---|---|
| 레거시 계약 진행 | `-OvsSFneml1sy3fwfX0U` (계약요청, 최원영/SP001) | 단계 체크가 저장된다 |
| 레거시 계약 진행 2 | `-OwuEaGuDu97x6dJWJBs` (계약요청, 최원영/SP001) | 동일 |
| 재고 건수 | 영업자·공급사 세션 | 게시 전과 같다(1,086 수준) |
| 원가 비노출 | 공급사 세션에서 **타 공급사** 매물 상세 | 매입원가·VIN 안 보인다 |
| 정산 생성 | 계약 1건 완료 처리 | 정산이 만들어지고 금액이 맞다 |
| 브리지 장애 시 | (선택) 브리지 API 일시 차단 | 빈 목록을 정상으로 오판하지 않는다(Q7) |

---

## 5. 남은 오픈 차단

```
check-release(후보) — 차단 1 · 경고 1
  FAIL  약관·개인정보 운영자 정보: 상호·대표자·주소·사업자등록번호·문의 이메일·개인정보 보호책임자
  WARN  서비스 워커 없음 (웹앱 범위 밖)
```

PWA 아이콘 경고는 해소했다(`public/icon-192.png`·`icon-512.png`·`icon-maskable-512.png` 생성,
재생성기 `scripts/build-icons.mjs`). 운영자 정보 6필드는 사실정보라 임의 작성하지 않았다.

---

## 6. 잘한 것

- **v3 를 닫으면서 브리지를 같이 낸 것.** 닫기만 했으면 재고가 반토막 났다. 순서 의존이 생겼지만
  그건 §3 으로 관리 가능한 종류다.
- **투영을 서버에서 강제한 것.** `projectLegacyProductsForActor` 를 Admin SDK read 직후에 두어
  클라이언트가 우회할 여지를 없앴다. 실측으로 유출 0 확인.
- **`is_active` blacklist 판정.** whitelist 로 했으면 레거시 회원 157명이 잠겼다.
- **응답 캐시 헤더.** `private, no-store` + `Vary: Authorization` 으로 역할 간 캐시 혼입을 막았다.
