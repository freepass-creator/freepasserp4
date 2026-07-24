# freepasserp4 코드 진단 보고서

진단 기준: 현재 작업 트리의 정적 코드 검토. 소스 코드와 설정은 수정하지 않았다. 보안 경계는 요청에 명시된 대로 `database.rules.json`만 신뢰했으며, 클라이언트의 역할별 화면/쿼리 제한은 보안 통제로 인정하지 않았다.

## 발견 항목

### 1. 공개 서명 레코드를 비인증 사용자가 임의 변조할 수 있음

- 파일:라인: `database.rules.json:84-87`, `lib/firebase/contract-sign-public.ts:41-59`
- 심각도: blocker
- 확신도: confirmed
- 문제: 토큰을 아는 비인증 사용자는 서명 완료 전 `contract_sign/{token}`의 PII, 금액, 계약코드, 상태, 서명 이미지를 제한 없이 덮어쓸 수 있다.
- 실패 시나리오: 고객이 받은 `/sign/{token}` 링크가 메신저·브라우저 기록 등에서 노출됨 → 공격자가 REST/SDK로 `contract_sign/{token}`에 `customer_phone`, `rent_amount_snapshot`, `deposit_amount_snapshot`, `contract_code`, `status: "pending_review"`, 임의 `sign_signature`를 씀 → 관리자 화면은 변조된 공개 슬롯을 계약 데이터와 병합해 위조된 서명과 금액을 검토한다.
- 근거:

  ```json
  "contract_sign": {
    "$token": {
      ".read": true,
      ".write": "auth != null || (data.exists() && data.child('status').val() !== '서명완료')"
    }
  }
  ```

  ```ts
  customer_name: c.customer_name || '',
  customer_phone: c.customer_phone || '',
  rent_amount_snapshot: c.rent_amount_snapshot,
  deposit_amount_snapshot: c.deposit_amount_snapshot,
  ```

- 제안 방향: 비인증 쓰기를 제출에 필요한 필드만 허용하고 기존 `contract_code`, 금액, 차량, 토큰은 불변 검증한다. 허용 상태 전이를 `sent → pending_review`로 제한하고, 서명 payload 크기·동의값·타임스탬프도 검증한다. 가능하면 서버 검증 엔드포인트 또는 Firebase App Check를 결합한다.

### 2. 모든 승인 사용자가 모든 계약의 PII를 읽고 계약 상태·금액을 쓸 수 있음

- 파일:라인: `database.rules.json:204-207`
- 심각도: blocker
- 확신도: confirmed
- 문제: `v4/contracts` 규칙에 테넌트/소유자 조건이 없어 승인된 A 공급사 또는 영업자가 B 공급사 계약 전체를 읽고 수정할 수 있다.
- 실패 시나리오: A 공급사 계정이 `ref("v4/contracts")`를 직접 조회 → B 공급사의 고객명·전화번호·계약금액을 전량 획득 → `v4/contracts/B계약/contract_status = "계약취소"` 또는 단계 필드를 직접 갱신 → B 계약이 취소되거나 정산 생성 조건이 왜곡된다.
- 근거:

  ```json
  "contracts": {
    ".read": "auth != null && auth.token.firebase.sign_in_provider !== 'anonymous' && root.child('users').child(auth.uid).child('status').val() !== 'pending'",
    ".write": "auth != null && auth.token.firebase.sign_in_provider !== 'anonymous' && root.child('users').child(auth.uid).child('status').val() !== 'pending'"
  }
  ```

- 제안 방향: 읽기는 관리자, 자기 `provider_company_code`, 자기 `agent_uid`/허용된 `agent_channel_code`, 해당 고객으로 제한한다. 쓰기는 레코드 단위로 역할별 허용 필드와 소유권을 `data`와 `newData` 양쪽에서 검증해 소유 필드 갈아끼우기를 막는다. 앱의 `readContractsScoped` 쿼리와 동일한 `query.orderByChild/equalTo` 조건을 규칙에서 강제한다.

### 3. 모든 승인 사용자가 모든 매물을 수정해 가격과 차량 락을 조작할 수 있음

- 파일:라인: `database.rules.json:143-146`, `lib/domain/settlement-engine.ts:208-225`
- 심각도: blocker
- 확신도: confirmed
- 문제: `v4/products` 쓰기가 역할·소유 회사를 확인하지 않아 영업자와 타 공급사가 임의 매물의 가격, 소유회사, `vehicle_status`, `locked_by_contract`를 변경할 수 있다.
- 실패 시나리오: 영업자 계정이 B 공급사 매물에 `provider_company_code: "A"`, 낮은 월대여료, `vehicle_status: "출고가능"`, `locked_by_contract: ""`를 직접 기록 → B가 보류하거나 계약이 선점한 차량이 다시 판매 가능하게 보이고 잘못된 가격으로 계약이 생성된다.
- 근거:

  ```json
  "products": {
    ".read": "auth != null && auth.token.firebase.sign_in_provider !== 'anonymous'",
    ".write": "auth != null && auth.token.firebase.sign_in_provider !== 'anonymous' && root.child('users').child(auth.uid).child('status').val() !== 'pending'"
  }
  ```

  ```ts
  const st = String(p?.vehicle_status || '');
  const owner = String(p?.locked_by_contract || '');
  ```

- 제안 방향: 공급사는 `provider_company_code`가 자기 회사인 레코드만 쓰게 하고 그 소유 필드는 불변으로 둔다. 영업자는 계약 엔진에 필요한 락 필드만 조건부로 쓰게 하되, 해당 계약의 소유·상태·상품 연결을 규칙에서 교차 검증한다. 더 안전한 방향은 차량 락 전이를 신뢰 서버/Cloud Function의 원자 트랜잭션으로 이동하는 것이다.

### 4. 채팅방과 메시지가 전 사용자에게 노출되고 임의 방에 메시지를 삽입할 수 있음

- 파일:라인: `database.rules.json:217-228`
- 심각도: blocker
- 확신도: confirmed
- 문제: `v4/rooms`와 `v4/messages` 읽기에 방 참여자 조건이 없고, 메시지 쓰기는 `sender_uid`만 본인인지 확인해 임의 `room_id`로 전송할 수 있다.
- 실패 시나리오: A 영업자가 `v4/rooms`와 `v4/messages`를 직접 전량 조회해 B 영업자와 공급사의 상담·첨부 URL을 읽음 → B의 `room_id`를 넣고 자기 UID로 허위 안내 메시지를 생성 → B 고객 상담 흐름에 공격자 메시지가 표시된다.
- 근거:

  ```json
  "rooms": {
    ".read": "auth != null ...",
    ".write": "auth != null ..."
  },
  "messages": {
    ".read": "auth != null ...",
    "$message_id": {
      ".write": "auth != null ... && newData.exists()",
      "sender_uid": { ".validate": "newData.val() === auth.uid" }
    }
  }
  ```

- 제안 방향: 방 읽기/쓰기는 방의 `agent_uid`, `agent_channel_code`, `provider_company_code`, `provider_uid`와 로그인 프로필을 대조한다. 메시지는 `newData.room_id`가 실제 방을 가리키고 현재 사용자가 그 방 참여자임을 검증하며, 기존 메시지 수정·삭제 여부도 명시적으로 제한한다.

### 5. 일반 사용자가 임의 정산을 생성하고 상태·환수액·귀속 회사를 조작할 수 있음

- 파일:라인: `database.rules.json:189-198`, `lib/domain/settlement-engine.ts:49-56`
- 심각도: blocker
- 확신도: confirmed
- 문제: `v4/settlements/$sid`는 모든 승인 사용자에게 쓰기를 허용하며 금액 필드는 생성 시 임의값을 허용하고 상태·환수액·계약코드·귀속 필드는 검증하지 않는다.
- 실패 시나리오: 영업자 계정이 새 `v4/settlements/FAKE`에 `fee_amount: 9000000`, `agent_payout: 8000000`, `net_amount: 1000000`, 자기 `agent_code`, `settlement_status: "정산완료"`를 기록 → 생성 시 `!data.exists()` 때문에 금액 검증을 통과 → 정산 화면·엑셀 합계에 허위 지급액과 완료 건이 포함된다. 또는 기존 정산의 `clawback_amount`와 `settlement_status`만 직접 바꿔 환수를 제거한다.
- 근거:

  ```json
  "$sid": {
    ".write": "auth != null && auth.token.firebase.sign_in_provider !== 'anonymous' && root.child('users').child(auth.uid).child('status').val() !== 'pending'",
    "fee_amount": { ".validate": "!data.exists() || newData.val() === data.val() || ...admin..." },
    "agent_payout": { ".validate": "!data.exists() || newData.val() === data.val() || ...admin..." },
    "net_amount": { ".validate": "!data.exists() || newData.val() === data.val() || ...admin..." }
  }
  ```

- 제안 방향: 일반 클라이언트의 정산 생성/수정을 금지하고 관리자 또는 신뢰 서버만 쓰게 한다. 클라이언트 생성이 불가피하면 계약 존재, `ST_{contract_code}` 키, 계약 귀속, 스냅샷 요율, `fee = round(rent × rate)`, `net = fee - payout`, 허용 상태 전이를 모두 규칙에서 검증한다.

### 6. 공급사 수수료율 private 노드가 모든 영업자에게 전량 공개됨

- 파일:라인: `database.rules.json:161-166`, `lib/domain/private-fields.ts:2-4`
- 심각도: high
- 확신도: confirmed
- 문제: 상업기밀로 분리한 `v4/partners_private`의 부모 `.read`가 agent 계열 역할에 허용되어 모든 공급사의 `fee_rate`를 한 번에 읽을 수 있다.
- 실패 시나리오: 일반 영업자 계정이 `ref("v4/partners_private")`를 조회 → 모든 공급사의 수수료율을 비교·반출 → 공급사별 협상 조건과 프리패스 마진 구조가 노출된다.
- 근거:

  ```json
  "partners_private": {
    ".read": "auth != null && ... (role === 'admin' || role === 'agent' || role === 'agent_admin' || role === 'agent_manager')",
    ".write": "auth != null && ...role... === 'admin'"
  }
  ```

  ```ts
  * 민감필드(_private) 헬퍼 — 상업기밀(공급사 fee_rate)·PII(email 등)를
  * `v4/partners_private` · `v4/users_private` 노드로 분리한다.
  ```

- 제안 방향: 부모 전량 읽기를 관리자에게만 허용한다. 정산 계산에 영업자가 공급사율을 알아야 한다면 계산 자체를 신뢰 서버로 옮기고 결과 금액만 제공한다. 공급사는 자기 `$pid`만 읽게 유지한다.

### 7. 사용자 본노드 전량 읽기로 역할·회사·미이관 지급률이 노출됨

- 파일:라인: `database.rules.json:168-176`, `lib/domain/private-fields.ts:7-11`
- 심각도: high
- 확신도: confirmed
- 문제: `v4/users` 전체가 모든 비익명 사용자에게 읽히며, private 이관 실패 시 본노드에 `agent_payout_rate`를 유지하도록 설계되어 지급률과 사용자 프로필이 노출될 수 있다.
- 실패 시나리오: private 규칙 미게시 또는 마이그레이션 일부 실패로 `v4/users/{uid}/agent_payout_rate`가 본노드에 남음 → 공급사 또는 다른 영업자가 `v4/users` 전체를 조회 → 개인별 지급률, 역할, 회사·채널 배정을 획득한다.
- 근거:

  ```json
  "users": {
    ".read": "auth != null && auth.token.firebase.sign_in_provider !== 'anonymous'"
  }
  ```

  ```ts
  * private 노드가 없으면 ... 본노드 값으로 폴백
  * write 실패(false)로 보고 본노드에 그대로 남긴다
  ```

- 제안 방향: 공개 프로필과 민감 프로필을 구조적으로 분리하고 `v4/users`도 자기 자신·관리자·업무상 필요한 최소 공개 필드만 읽게 한다. 마이그레이션 완료 여부를 검증한 뒤 민감 본노드 필드를 제거한다.

### 8. 계약 완료·정산 생성·차량 잠금이 하나의 원자 쓰기가 아님

- 파일:라인: `lib/domain/settlement-engine.ts:249-255`, `lib/firebase/rtdb-adapter.ts:522`
- 심각도: high
- 확신도: confirmed
- 문제: 정산 생성, 계약 완료, 차량 출고불가가 서로 다른 RTDB 요청으로 순차 실행되어 중간 실패 시 상태가 갈라진다.
- 실패 시나리오: 마지막 계약 단계 체크 → 정산 `ST_C1` 생성 성공 → 계약 `contract_status: 계약완료` 성공 → 네트워크 단절로 상품 잠금 쓰기 실패 → 정산과 완료 계약은 존재하지만 차량은 `출고가능`으로 남아 다른 계약이 선점할 수 있다.
- 근거:

  ```ts
  await createSettlement(fresh);
  await store.update('contract', co, code, { contract_status: '계약완료' });
  if (productCode) await store.update('product', co, productCode, {
    vehicle_status: '출고불가', locked_by_contract: code
  });
  ```

  ```ts
  await dbUpdate(ref(this.db(), `${OVERLAY}/${node}/${key}`), p);
  ```

- 제안 방향: `v4/settlements/{id}`, `v4/contracts/{id}`, `v4/products/{id}`를 루트 기준 단일 multi-location `update()`로 커밋하고 규칙이 전체 전이를 함께 검증하게 한다. 경쟁 선점까지 막으려면 상품 락에 RTDB transaction 또는 신뢰 서버 직렬화를 사용한다.

### 9. 계약 취소도 계약·차량·환수 정산 사이에서 부분 완료될 수 있음

- 파일:라인: `lib/domain/settlement-engine.ts:75-93`
- 심각도: high
- 확신도: confirmed
- 문제: 취소 상태, 차량 락 재계산, 정산 환수 전이가 각각 별도 쓰기여서 실패 지점에 따라 돈과 재고 상태가 불일치한다.
- 실패 시나리오: 정산완료 계약 취소 → 계약 상태를 `계약취소`로 쓰는 데 성공 → 차량 락 해제 성공 → 정산 업데이트 직전에 연결 종료 → 차량은 재판매되지만 기존 정산은 계속 `정산완료`, `clawback_amount: 0`으로 남아 환수 대상에서 빠진다.
- 근거:

  ```ts
  await store.update('contract', co, code, { contract_status: '계약취소' });
  if (fresh.product_code) await syncVehicleLock(String(fresh.product_code), code);
  await onContractCancel(fresh);
  ```

  ```ts
  await store.update('settlement', co, code, {
    settlement_status: '환수대기',
    clawback_amount: clawbackCalc(st)
  });
  ```

- 제안 방향: 취소 이벤트, 차량 상태, 환수 상태를 단일 multi-location update로 저장한다. 재시도 가능한 취소 operation ID와 기대 이전 상태를 두고, 불완전 전이를 탐지·복구하는 대사 작업을 추가한다.

### 10. 계약 단계 선점이 읽기-판정-쓰기로 구현되어 동시 요청에서 이중 선점 가능

- 파일:라인: `lib/domain/settlement-engine.ts:205-237`
- 심각도: high
- 확신도: confirmed
- 문제: 경쟁 계약 조회와 상품 락 확인 후 계약 체크를 쓰는 과정에 compare-and-set이 없어 두 클라이언트가 동시에 같은 차량을 선점할 수 있다.
- 실패 시나리오: 계약 C1과 C2가 같은 상품 P를 대상으로 동시에 입금확인을 누름 → 두 클라이언트 모두 기존 계약목록에서 rival 없음, 상품 owner 없음으로 판정 → 각각 자기 계약의 입금 체크를 기록 → 후속 락 쓰기 순서에 따라 한 계약만 상품 owner로 남지만 두 계약 모두 입금 선점 상태가 되어 정산·완료 경쟁이 발생한다.
- 근거:

  ```ts
  const contracts = await store.list('contract', co);
  const rival = rivalDepositClaimFrom(contracts, productCode, code);
  if (rival) throw new Error(...);
  const p = await store.get('product', co, productCode);
  ...
  await store.update('contract', co, code, { [key]: value });
  ```

- 제안 방향: 상품의 락 소유자를 transaction으로 `빈 값 → 계약코드` 조건부 변경한 뒤에만 단계 체크를 확정한다. 계약과 락을 함께 처리하는 신뢰 서버 함수가 가장 명확하다.

### 11. 음수 정산 금액을 양수로 뒤집어 임포트함

- 파일:라인: `lib/domain/settlement-import.ts:8-13`, `lib/domain/settlement-import.ts:68-81`
- 심각도: high
- 확신도: confirmed
- 문제: 문자열 금액에서 숫자 외 문자를 모두 제거해 `-100,000`을 `100000`으로 변환하므로 환불·차감 행의 부호가 반전된다.
- 실패 시나리오: 정산 XLSX의 `에이전시지급액` 셀에 `-100,000원` 입력 → `money()`가 `100000` 반환 → `net_amount = recv - paid`에서 실제로는 가산돼야 할 10만원이 차감되어 순수익이 20만원 어긋난다.
- 근거:

  ```ts
  const s = norm(v).replace(/[^0-9]/g, '');
  return s && Number(s) > 0 ? Number(s) : 0;
  ```

  ```ts
  const recv = money(g('recv')); const paid = money(g('paid'));
  net_amount: recv - paid,
  ```

- 제안 방향: 괄호 음수, 선행/후행 마이너스, 숫자형 음수를 명시적으로 보존하고 허용할 필드별 부호 정책을 정한다. 임포트 전 미리보기에서 원문·파싱값·오류를 나란히 검증한다.

### 12. 이미지 프록시가 허용 호스트의 리다이렉트 후 목적지를 재검증하지 않음

- 파일:라인: `app/api/img/route.ts:7-16`, `lib/net/proxy-hosts.ts:1-30`
- 심각도: high
- 확신도: plausible
- 문제: 최초 URL만 allowlist로 검사하고 자동 리다이렉트를 따라가므로 허용 호스트가 내부/메타데이터 주소로 리다이렉트할 수 있다면 SSRF가 가능하다.
- 실패 시나리오: allowlist에 포함된 외부 이미지 호스트의 사용자 제어 URL이 `http://169.254.169.254/...`로 302 응답 → `/api/img?url=허용URL` 호출 → 서버 `fetch(..., redirect: "follow")`가 최종 호스트를 재검증하지 않고 내부 주소에 요청한다.
- 근거:

  ```ts
  if (!allowedHost(url, 'img')) return new Response('host not allowed', { status: 403 });
  const upstream = await fetch(url, { ..., redirect: 'follow' });
  ```

- 제안 방향: `redirect: "manual"`로 각 Location을 재검증하고, 최종 DNS 해석 IP가 loopback/private/link-local인지 차단한다. 응답 크기·시간 제한도 둔다.

### 13. 인증 없는 서버 프록시 라우트에 호출량·응답 크기 제한이 없음

- 파일:라인: `app/api/img/route.ts:7-16`, `app/api/sheet/route.ts:21-43`, `app/api/extract-photos/route.ts:95-115`
- 심각도: med
- 확신도: confirmed
- 문제: 외부 fetch를 수행하는 세 GET 라우트가 인증·호출량 제한 없이 공개되어 Vercel 대역폭과 실행 시간을 제3자가 소모할 수 있다.
- 실패 시나리오: 외부 사용자가 수천 개의 허용 이미지 URL과 공개 시트 URL을 반복 호출 → Vercel 함수가 외부 대용량 응답을 계속 다운로드·재전송 → 함수 실행량과 egress 비용 증가, 정상 사용자의 지연/쿼터 고갈.
- 근거:

  ```ts
  export async function GET(req: NextRequest) { ... fetch(url) ... }
  export async function GET(request: Request): Promise<Response> { ... fetch(csvUrl) ... }
  export async function GET(request: Request): Promise<Response> { ... scrapePage(src) ... }
  ```

- 제안 방향: 공개 사용이 의도된 라우트라도 origin별 rate limit, 캐시 키 정규화, 최대 응답 바이트, 동시성 제한을 둔다. 내부 ERP 전용 기능은 Firebase ID token을 서버에서 검증한다.

### 14. 로컬 OCR 라우트가 비인증 대용량 요청마다 프로세스를 생성함

- 파일:라인: `app/api/ocr/extract/route.ts:14-35`
- 심각도: med
- 확신도: confirmed
- 문제: Vercel 외 환경에서 인증·본문 크기·동시성 제한 없이 Base64 전체를 메모리에 올리고 요청마다 Python/GPU 프로세스를 실행한다.
- 실패 시나리오: 개발 PC가 LAN에 노출된 상태에서 공격자가 100MB Base64 요청 10개를 병렬 전송 → Node가 각 요청을 디코딩하고 Python 프로세스 10개를 생성 → 메모리/GPU 고갈로 개발 서버와 OCR 작업이 중단된다.
- 근거:

  ```ts
  try { ({ dataUrl } = await req.json()); }
  const buf = Buffer.from(m[2], 'base64');
  await writeFile(tmp, buf);
  const p = spawn(PY, [script, tmp], { windowsHide: true });
  ```

- 제안 방향: 개발 전용 바인딩을 loopback으로 제한하고 인증 토큰, Content-Length/디코딩 후 크기 제한, MIME 실검증, 작업 큐와 동시 실행 1개 제한, 프로세스 타임아웃을 둔다. dev 전용 라우트라는 의도 가능성 있음.

### 15. RTDB 읽기 실패를 빈 목록으로 바꿔 “데이터 없음”으로 오인시킴

- 파일:라인: `lib/firebase/rtdb-adapter.ts:407-427`
- 심각도: med
- 확신도: confirmed
- 문제: 권한·네트워크·쿼리 오류를 빈 배열로 삼켜 실제 데이터가 있는 상태를 빈 상태로 렌더링한다.
- 실패 시나리오: 정산 규칙 배포 후 인덱스/쿼리 조건 불일치로 `v4/settlements` 읽기가 거부됨 → `.catch(() => [])`가 오류를 숨김 → 관리자/사용자 화면에 정산 0건과 0원 합계가 표시되어 누락으로 판단하거나 중복 임포트를 실행한다.
- 근거:

  ```ts
  bridge ? this.readNode(...).catch(() => [] as EntityRecord[]) : Promise.resolve([]),
  this.readNode(...).catch(() => [] as EntityRecord[]),
  ```

  ```ts
  } catch (e) {
    console.warn(`RTDB merged(${entity}) 실패...`);
    return [];
  }
  ```

- 제안 방향: 반환 상태를 `loading | success | empty | permission-error | network-error`로 구분한다. 돈/계약 화면에서는 오류 시 합계와 빈 상태를 표시하지 말고 재시도 및 진단 정보를 제공한다.

### 16. 전체 메시지 목록 조회가 방 개수에 비례해 RTDB 요청을 팬아웃함

- 파일:라인: `lib/firebase/rtdb-adapter.ts:200-222`, `lib/firebase/rtdb-adapter.ts:400-409`
- 심각도: med
- 확신도: confirmed
- 문제: 메시지 전체 로드는 먼저 모든 방을 읽은 후 각 방마다 v3와 v4 메시지 요청을 병렬 실행해 약 `2 × 방 수` 요청을 만든다.
- 실패 시나리오: 접근 가능한 방이 500개인 영업 채널에서 채팅 목록 진입 → 방 목록 뒤 `messages/{roomId}` 500회와 `v4/messages?room_id=...` 500회가 동시에 실행 → 모바일 연결에서 지연·요청 폭주·렌더 갱신 지연이 발생한다.
- 근거:

  ```ts
  await Promise.all(roomIds.map(async (roomId) => { ... }));
  ```

  ```ts
  const rooms = await this.merged('room', co);
  roomIds = rooms.map((r) => String(r._key)).filter(Boolean);
  ```

- 제안 방향: 방 목록에는 마지막 메시지/미읽음 요약을 비정규화하고, 실제 메시지는 선택한 방만 페이지네이션 조회한다. 마이그레이션 기간의 v3/v4 이중 읽기는 종료 조건과 백필 완료 체크를 둔다.

### 17. 클릭 가능한 비시맨틱 요소가 키보드로 작동하지 않음

- 파일:라인: `components/ChatThread.tsx:96,130`, `components/ContractDocs.tsx:163-167,187`
- 심각도: low
- 확신도: confirmed
- 문제: 이미지·`div`·`span`에 `onClick`만 부여하고 버튼 역할, 포커스, 키보드 핸들러가 없어 키보드 사용자가 미리보기/닫기를 실행할 수 없다.
- 실패 시나리오: 키보드만 사용하는 사용자가 채팅 첨부 이미지 확대 또는 문서 미리보기를 열고 닫으려 함 → Tab 포커스 대상이 아니어서 기능에 접근하지 못하거나 모달을 닫지 못한다.
- 근거:

  ```tsx
  <img ... onClick={() => setFull(String(m.image_url))} />
  <div onClick={() => setFull(null)} ...>
  <span onClick={() => canPreview(a) && setPreview(a)} ...>
  ```

- 제안 방향: 상호작용 요소를 `button`으로 바꾸고 명확한 accessible name을 제공한다. 모달은 포커스 트랩, Escape 닫기, 열기 전 요소로 포커스 복귀를 지원한다.

## 영역별 결론

- 보안: blocker 5건, high 3건, med 2건 확인. RTDB 규칙이 클라이언트의 역할별 쿼리를 강제하지 않는 것이 중심 원인이다.
- 돈 흐름: 정산 임의 쓰기, 비원자 완료/취소, 동시 선점, 음수 임포트 반전 발견.
- 데이터 정합: 계약↔정산↔차량의 비원자 쓰기와 오류의 빈 목록 변환 발견. 검토한 private 이관의 multi-location update 자체는 단일 RTDB update를 사용하므로 그 부분에서 별도 확정 결함은 발견 없음.
- 성능: 메시지 방별 팬아웃 발견.
- 에러/빈/로딩 처리: RTDB 오류를 빈 목록으로 오인하는 경로 발견.
- 접근성: 클릭 가능한 비시맨틱 요소 발견.
- 의도 예외: `global-error`의 리터럴 색, login 독립 스타일, `/m` 프리뷰 크롬은 이번 우선순위와 직접 관련된 확정 결함을 발견하지 않아 항목화하지 않았다. OCR은 dev 전용 의도 가능성을 명시했다.

## 가장 위험한 3가지

1. `v4/contracts`, `v4/products`, `v4/rooms`, `v4/messages`의 테넌트/참여자 검증 부재: 승인 계정 하나로 타 공급사 PII 열람, 계약·재고 변조, 타 채팅 삽입이 가능하다.
2. `v4/settlements`의 일반 사용자 쓰기 허용: 허위 정산 생성과 상태·환수 조작이 가능해 실제 돈 흐름을 직접 훼손한다.
3. `contract_sign/{token}`의 비인증 무제한 필드 쓰기: 링크 토큰 노출만으로 고객 PII·금액·계약코드·서명을 위조할 수 있다.
