# Claude 위험영역 게이트 — 견적기 상담 채팅 (2026-08-06)

대상: 미커밋 작업분 — `components/ConsultLayout.tsx` · `components/ConsultPanel.tsx` ·
`lib/domain/deal.ts`(`ensureConsultRoom`) · `features/chat/room-display.ts`(`isVehicleLessRoom`) ·
`app/chat/page.tsx` · `app/sonogong/page.tsx` · `app/welrix/page.tsx`
검수자: Claude · 방식: 코드 정독 + 설계 불변식 대조 (읽기 전용, 파일 미수정)

판정: **통과 1 · 차단 1 · 주의 2.** 방 생성 로직 자체는 요구한 불변식을 전부 지켰다.
막힌 건 **역할 범위**다 — 관리자가 공급사와 대화할 수 없다.

관련 설계: `sonogong-estimator/PLAN-상담패널.md` §5.5 (상담방 구조 SSOT)

---

## ✅ 통과 — 방 생성 불변식 4가지 모두 지켜졌다

`lib/domain/deal.ts:150-195` 를 정독했다. 착수 전 게이트로 걸었던 항목이 그대로 들어가 있다.

| 불변식 | 확인 | 위치 |
|---|---|---|
| 방 키 예측 불가 | `crypto.getRandomValues(8바이트)` → `CS_{PROVIDER}_{16자}` | `:133-141, :180` |
| 기존 방은 키 추측이 아니라 스코프 조회 | `(provider_company_code, agent_uid)` 로 find | `:163-171` |
| `agent_channel_code` 에 실제 채널코드 금지 | `= agentUid`, 사유 주석까지 | `:173, :176` |
| 필수 필드 비면 저장 금지 | provider·name·uid 각각 throw | `:153, :159, :161` |
| `is_admin_chat` 미설정 | 세우지 않음 (select '예/아니오' 함정 회피) | `:181-193` |

`consultRoomSuffix()` 가 crypto 미지원 환경에서 `Date.now()+Math.random()` 로 폴백하는데,
브라우저 실행이므로 실질 위험은 없다. 그대로 둔다.

---

# 🔴 차단 1 — 관리자가 공급사와 대화할 수 없다

## 사실관계

```ts
// lib/domain/deal.ts:157
const ag = actor('agent');
const agentUid = String(ag.uid || '').trim();
if (!agentUid) throw new Error('상담방 생성: agent_uid 누락');
```

`actor(r)` 는 **세션 역할이 `r` 과 같을 때만** 실제 uid 를 돌려준다.

```ts
// lib/domain/deal.ts:36
if (s && s.role === r) { … return { uid: s.uid, … }; }
return { ...ACTORS[r], … };          // 데모 스텁 — uid 없음
```

따라서 **관리자(admin)로 `/sonogong` 에 들어가면** 조건이 어긋나 스텁으로 떨어지고,
`agent_uid` 누락 throw → `roomId` null → `<ChatThread roomId={null}>` → **채팅창이 껍데기로 뜬다.**

## 왜 차단인가

erp4 는 3자 구조(공급사·영업·플랫폼)다. 상담이 필요한 조합은 최소 둘이다.

| 조합 | 지금 | 있어야 하는가 |
|---|---|---|
| 영업자 ↔ 공급사 | 동작 | 예 |
| **관리자 ↔ 공급사** | **불가** | **예** — 플랫폼이 공급사와 소통할 통로가 없다 |

내가 설계를 영업자 기준으로만 잡은 것이 원인이다. 설계 결함이지 구현 잘못이 아니다.

## 조치

`ensureConsultRoom` 이 역할을 고정하지 말고 **현재 세션 주체**를 쓴다.
방의 상대편 당사자 자리(`agent_uid`)에 로그인한 사람이 앉는 구조라, 역할만 안 박으면 그대로 돌아간다.

```ts
const s = getSession();
const uid  = String(s?.uid || '').trim();
const name = String(s?.name || '').trim();
const code = String(s?.user_code || s?.code || s?.uid || '').trim();
```

- **provider 역할이면 방을 만들지 않고 `null` 반환** — 자기 자신과의 대화가 되기 때문.
  `ConsultLayout` 은 null 이면 패널에 "이 상담은 계약문의에서 확인하세요" 안내.
- 나머지 불변식은 **그대로 유지** — provider·name·uid 비면 throw, `agent_channel_code = uid`,
  키 `CS_{PROVIDER}_{랜덤}`, 기존 방은 `(provider, uid)` 조회.

`agent_uid` 가 사람마다 다르므로 방은 자연히 분리된다.
공급사는 `provider_company_code` 스코프로 **영업자 방·관리자 방을 한 목록에서** 본다.
관리자는 스코프 없이 전량 조회하므로 그대로 다 본다.

**목록 표기 확인** — 관리자가 연 방은 ②줄에 관리자 이름이 뜬다(`agent_name`).
공급사 화면에서 "누가 건 대화인지" 구분되므로 추가 표기는 불필요하다.

---

# 🟡 주의 1 — 실패가 조용하다

`ensureConsultRoom` 이 throw 하면 콘솔로만 가고 화면엔 아무 안내가 없다.
지금 사용자가 "채팅이 왜 안 되냐"고 묻게 된 직접 원인이다.

`ConsultLayout` 에서 잡아 패널 상단에 사유를 띄울 것.

| 사유 | 문구(예) |
|---|---|
| 미로그인 | 로그인하면 상담을 시작할 수 있습니다 |
| 승인 대기(`status==='pending'`) | 가입 승인 후 이용할 수 있습니다 |
| 공급사 본인 | 이 상담은 계약문의에서 확인하세요 |
| 생성 실패 | 상담방을 열지 못했습니다 — 잠시 후 다시 시도 |

**빈 화면에 입력창만 살아 있는 상태를 남기지 말 것.** 보낸 줄 알고 기다리게 된다.

---

# 🟡 주의 2 — 첨부가 저장되지 않는다

`ConsultPanel` 의 첨부는 `useState` 로컬 표시뿐이다. `LocalAtt` 가 `{id,name,size,type}` 만 들고
**File 객체조차 보관하지 않는다**(`ConsultPanel.tsx:16`). 업로드 경로가 없다.

영업자가 서류를 올리고 "보냈다"고 오해할 수 있다. 둘 중 하나로 정리할 것.

1. `ChatThread` 기존 첨부 업로드 경로에 연결 (권장 — 새 업로드 로직 만들지 말 것)
2. 연결 전까지는 드롭존을 비활성화하고 "준비 중" 표기

---

## 배포 전 확인

- [ ] 위 파일들이 **전부 미커밋**이다. 커밋·배포 전엔 `freepasserp4.vercel.app` 에 이 기능이 없다.
      로컬 `:4004` 에서만 동작한다 — 테스트 환경을 혼동하지 말 것.
- [ ] 영업자·관리자 각각 `/sonogong` 진입 → 방 생성 → 메시지 전송
- [ ] 공급사(RP012) 계정으로 `/chat` → 두 방이 모두 보이고 ②줄에 상대 이름
- [ ] 공급사 본인이 `/sonogong` 진입 시 방이 안 생기고 안내가 뜸
- [ ] 기존 차량 문의방 목록·중복정리·필터 탭 회귀 없음
- [ ] `/welrix` 도 동일 동작 (provider RP013)

## 손대지 말 것

- `features/chat/room-filter.ts:33` — `CS_` 접두 + `is_admin_chat` 미설정이면 그대로 통과한다.
  고치면 소유필드 없는 레거시 `ADMIN_` 방(운영 28건)이 함께 노출돼 읽음처리가 거부된다.
- `agent_channel_code` 에 실제 채널코드 — 레거시 `SP999` 채널 75명 문제. 반드시 `uid` 유지.
