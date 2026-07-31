# UI 실측 — 눈이 아니라 픽셀로 잰다

정적 분석으로는 "버튼이 셀 경계에 붙었다"를 못 본다. 실제로 렌더해서 브라우저가 계산한 값을 읽는다.
2026-07-31에 이 방식으로 20건을 찾았다(그중 2건은 기능이 막혀 있던 것).

## 1. QA 서버 띄우기 (시드 데이터 + 인증 게이트 없음)

**운영 dev 서버(4004)를 쓰면 안 된다.** 로그인·실데이터가 필요하고, `.next` 를 공유해 서로 깨진다.
`next.config` 의 `NEXT_DIST_DIR` 로 산출물을 분리한 별도 서버를 4005에 띄운다.

```bash
NEXT_DIST_DIR=.next-qa \
NEXT_PUBLIC_DATA_BACKEND= \
NEXT_PUBLIC_FIREBASE_API_KEY= NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN= \
NEXT_PUBLIC_FIREBASE_DATABASE_URL= NEXT_PUBLIC_FIREBASE_PROJECT_ID= NEXT_PUBLIC_FIREBASE_APP_ID= \
npx next dev -p 4005
```

- `DATA_BACKEND` 를 비우면 LocalAdapter + `lib/seed.ts` 시드(매물 12·계약 3·방·메시지)가 들어간다.
- Firebase env 를 비우면 `firebaseReady()` 가 false → AuthProvider 게이트가 꺼진다.

## 2. 계측 돌리기

```bash
node scripts/ui-audit.mjs tmp/ui-audit
```

`tmp/ui-audit/shots/*.png` (모바일 390×844 · 데스크톱 1440×900 fullPage) + `tmp/ui-audit/audit.json`.

**세션 주입이 핵심이다.** 스크립트가 `fp4_session` 을 시드 행위자(usr_park / sup_jeil / usr_admin)로
넣는다. 이게 없으면 `canAccessOwnedRecord` 가 scope 'none' 이라 계약·문의·정산이 **전부 빈 화면**으로
찍히고, 아무것도 못 찾는다.

## 3. 재는 것

| 항목 | 무엇을 잡나 |
|---|---|
| `control-gap` | 행 안 컨트롤의 상하/좌우 여백 비대칭·경계 접촉 |
| `overflow` | 부모 밖으로 실제로 넘친 요소 |
| `touch-target` | 모바일 34px 미만 |
| `clipped-text` | 잘리는데 말줄임 없음 |
| `v-align` | 같은 flex 행에서 세로 중심 어긋남 |
| `no-tabular` | 숫자인데 tabular-nums 아님 |
| `stats` | 간격·폰트·모서리 히스토그램(리듬 확인) |

## 4. 오탐을 반드시 걸러라

휴리스틱이라 오탐이 많다. **스크린샷을 눈으로 보고 확인한 것만** 고친다.
- flex-wrap 으로 줄바꿈된 칩 묶음 → `v-align` 이 크게 나오지만 정상
- 넓은 툴바 안 왼쪽 정렬 컨트롤 → "가로 vs 세로 여백" 차이가 크지만 정상
- 하단 독·탭바 → 바를 꽉 채우는 게 정상

## 5. 끝나면 서버를 죽여라

QA 서버가 4GB 까지 부푼다. 2026-07-31에 이걸 켜둔 채로 두어 전체 메모리가 10.7GB 가 되고
운영 dev 서버가 먹통이 됐다. **증상이 "먹통"이면 프로세스 메모리부터 본다.**

```bash
# 4005 잡고 있는 프로세스 종료 + playwright 가 남긴 Edge 정리
```

## 곁다리: JSX 주석 검사

```bash
node scripts/check-jsx-comments.mjs
```

JSX 자식 위치의 `//` 주석은 **화면에 글자로 그대로 찍힌다.** 2026-07-31 재고관리에서 실제로
배포까지 나갔다. `return (` 바로 뒤 주석은 JSX 밖이라 정상이다(그건 오탐).
