# Claude UI 브랜치 독립 검수 — Codex → Claude

점검 기준: `fix/ui-audit` 브랜치 `c38cade7`  
비교 기준: 현재 작업 브랜치 `feat/spring-atom-monitor` `a14beb47`  
범위: 최근 손님 화면 UI 커밋(간격·제원·배지·옵션 칩·필터 시트·하단 독·임시 채널 경로)

## 판정: **NO-GO — 아래 3건 수정·재검증 전 병합/배포 금지**

`git diff --check a14beb47..c38cade7`은 통과했다. 그러나 이 브랜치는 현재 작업트리에 병합돼 있지 않으며, 실제 브라우저/운영에서의 재현은 아직 하지 못했다.

## 맞는 변경

- 카드/상세의 글자·간격을 `SHOP.fs`/`SHOP.sp` 중심으로 모으고, 상세·조건 시트·화이트라벨 독을 `ShopDock`으로 통합한 방향은 맞다.
- 옵션 칩을 표시용 `BADGE` 규격으로 낮춘 것은 사용자가 말한 “누르는 것이 아닌 옵션 칩”과 맞다.
- 필터 시트를 초안(draft) → `N대 보기` 적용 방식으로 바꾼 것은 닫기와 적용의 의미를 분리하는 정상적인 패턴이다.
- `previewPath` 기반 미들웨어 rewrite로 채널 추가를 표 한 줄로 만드는 구조도 방향은 맞다. 단, 실제 `/uniauto` 응답·메타·공유 링크 검증이 필요하다.

## 수정 필수

### 1. 다크 유리 토큰이 즉시 덮어써짐

`app/globals.css`의 `:root`에 `--scrim-glass`가 두 번 선언돼 있다.

```css
--scrim-glass: rgba(23,28,34,0.72);
--scrim-glass: rgba(255,255,255,0.72);
```

두 번째 선언이 항상 이기므로 첫 번째 선언과 “다크에서는 어두운 유리” 주석은 무효다. 라이트 기본값은 `:root`, 다크 값은 `html[data-theme="dark"]`에 한 번만 둬야 한다.

### 2. 필터 초안 선택 수가 즉시 반영되지 않음

`components/shop/ShopFilterSheet.tsx`는 `draft`로 조건을 변경하고 `preview(draft)`로 결과 수를 계산하지만, 좌측 축별 선택 건수는 `sel[axis].length`를 읽는다.

```ts
const n = sel[axis].length; // 이전에 적용된 값
```

따라서 시트 안에서 새 조건을 고르거나 해제해도 왼쪽 지도 배지가 적용 전 상태로 남는다. 주석의 “축 목록·건수도 초안으로 센다”와도 모순이다. `draft[axis].length`를 사용해야 한다.

### 3. 고정 하단 독의 안전영역이 본문 여백에 반영되지 않음

`ShopDock`은 `fixed`일 때 본문용 빈 공간을 `h + padY*2`(모바일 72px)만 만든다. 실제 독은 `safe-area-inset-bottom`만큼 `paddingBottom`이 추가돼 더 높아진다.

즉 iPhone처럼 안전영역이 있는 기기에서 목록 마지막 내용이 독 아래에 일부 가려질 수 있다. 빈 공간도 `calc(독 높이 + var(--fp-dock-safe))`로 같은 값만큼 확보하거나, 독 높이를 CSS 변수 하나로 산출해 spacer와 독이 함께 사용해야 한다.

## 병합 전 추가 확인

1. **태블릿 목록 문제는 이번 브랜치에서도 남아 있다.** `MOBILE_BP=760` 이후에도 `260px` 필터 + 3열 카드가 유지된다. 760px에서 카드 폭은 약 124px, 1024px에서는 약 212px이다. 1,120px 안팎부터 2열/필터 시트로 전환하는 별도 가게 breakpoint가 필요하다.
2. `/uniauto` 전용 route를 없애고 middleware rewrite로 바꿨다. `GET /uniauto`, 카드 클릭 상세, `?a=`, `?wl=`, 메타/JSON-LD, 모바일/웹을 실제로 확인해야 한다. 정적 검사만으로 대체하면 안 된다.
3. `check:tokens`와 `check:ui`는 기준 브랜치에서도 실패 중이다. Claude 브랜치의 최신 상태에서 다시 돌려, 이번 변경이 기존 실패를 줄였는지/새 실패를 만들지 않았는지 수치로 남겨야 한다.

## 권장 재검증 순서

1. 위 3건 수정.
2. `npx tsc --noEmit`, `npm run check:design`, `npm run check:tokens`, `npm run check:ui`.
3. 화면 폭 375, 430, 760, 1024, 1280, 1440에서 목록과 상세 캡처 비교.
4. `/uniauto` rewrite와 공유 상세 URL을 실제 배포 미리보기에서 확인 후에만 병합 판단.

## 검수 한계

현재 세션에는 Chrome/자동화 브라우저 표면이 없어 Claude 브랜치의 실제 렌더·네트워크를 실행하지 못했다. 위 판정은 커밋 diff와 소스 정적 대조에 근거한다.

