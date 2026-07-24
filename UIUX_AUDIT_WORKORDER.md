# UI/UX 규격 정합성 감사 — 작업지시서 (커서용)

## 목표
디자인 토큰(SSOT)을 우회한 **하드코딩·불일치**를 전수로 찾아 **리포트만 작성**한다.
⚠️ **코드 수정 금지.** 결과는 `UIUX_AUDIT_RESULTS.md` 한 파일로만. (수정은 사람이 검증 후 별도 진행)

## 규격 SSOT (이 값들이 "정답". 벗어나면 위반 후보)
`components/ui/tokens.ts` 기준:
- **FS** (콘텐츠 폰트 6단계, 이 외 숫자 금지): page 18 / title 14.5 / body 13 / sub 12 / cap 11 / micro 10
- **FW** (두께): body 400 / meta 500 / label 550 / strong 600 / title 650 / head 700 (800·900 금지, 대표 금액 히어로 1개만 예외)
- **C** (색 = CSS var, 다크모드 안전): ink/mute/sub/faint/line/line2/bg/zebra/head/hover/danger/ok/warn/accent/brand/taupe/taupeBg/… — 원색 hex/rgb 직접 금지
- **R** = 4 (반경). 완전 pill은 999 허용.
- **NUM** = var(--font-mono) (숫자·코드)
- **CTRL / ctrlH() / ctrlFs()**: 버튼·입력·칩 높이/폰트. 웹 md32·sm28 / 모바일 md40·sm36. height 숫자 직접 금지, size·헬퍼만.

## 점검 카테고리 (각 위반을 파일:줄로)
1. **하드코딩 폰트크기** — 콘텐츠에 `fontSize: <숫자>` 로 FS 스케일 우회(예: 12.5·13·15). FS.title(14.5)처럼 토큰 자체는 정상.
2. **하드코딩 두께** — `fontWeight: <숫자>` 로 FW 우회(특히 800/900).
3. **하드코딩 색** — `#xxxxxx`·`rgb(...)` 직접(다크모드 깨짐). 의도적 물리색(폰 베젤 `#0b0b0f`, 그림자 rgba)은 예외로 분류.
4. **컨트롤 규격 우회** — 버튼/입력/칩에 `height:<숫자>`·`fontSize:<숫자>` 직접(ctrlH/ctrlFs 미사용).
5. **원자 일관성** — 같은 역할인데 제각각인 곳. 특히 **카운트 뱃지(CountPill) 색·크기**, **액션 텍스트(해제·초기화·"선택→모델") 폰트/색 규격**, Badge/Btn/IconBtn 변형 혼용.
6. **반경** — `borderRadius: <숫자>` 가 R(4)·999 아닌 값.
7. **모바일/웹 분기 불일치** — 같은 컴포넌트가 `mobile ?` 분기에서 규격만 튀는 곳(의도 vs 실수 구분해서 메모).
8. **터치타겟** — 모바일 인터랙티브 요소가 최소 높이(≈36~40) 미만.
9. **정렬** — 뱃지↔텍스트 세로 어긋남(alignItems/lineHeight 원인) 의심 지점.

## 범위 (우선순위)
1. `components/ui/*` (tokens·badges·index·feedrow·table·detail)
2. `app/page.tsx` (파인더·필터패널·툴바·엑셀뷰)
3. `components/*` (list-rows·PageToolBar·ProductDetail·ProductCard·ProductRowCard·ContractPanel·TopBar·AppTabBar·VehicleMasterFilter)
4. `app/m/[code]/page.tsx`, `app/members`, `app/chat`, `app/contract`, `app/settlement`

## 출력 형식 — `UIUX_AUDIT_RESULTS.md` 만 생성
표로:

| 파일:줄 | 카테고리(1~9) | 현재값(위반) | 있어야 할 토큰/규격 | 심각도 | 비고(의도적 예외 여부) |
|---|---|---|---|---|---|

+ 맨 위에 요약: 카테고리별 건수, high 건수, "의도적 예외로 판단해 제외한 것" 목록.
+ 확신 없는 건 심각도 low + 비고에 "판단필요"로.

## 하지 말 것
- 코드 편집·리팩터·포맷 금지 (리포트 파일 1개만).
- 토큰 값 자체를 바꾸자는 제안 금지(기존 SSOT는 정답으로 간주).
- 애매하면 "위반 확정"하지 말고 low·판단필요로.
