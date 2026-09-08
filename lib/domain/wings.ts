/**
 * **채(館) — 이 건물을 «세 채»로 가른다.**
 *
 * ★★★사장님 2026-09-08
 *   「이제 분리할 준비 가야 하는 게 프리패스를 **상품찾기 / 견적 / 전자계약 및 정산·회원사파트너사 관리**
 *    이렇게 크게 3개로 쪼갤 거야」 · 「상품찾기는 지금 **화이트라벨 프로젝트로 분리해내고 있음**」
 *   쪼개는 까닭 셋(사장님 선택) — **따로 팔려고** · **역할별로 보이는 게 달라서** · **서로 안 부딪히게**.
 *
 * ★★**「동(棟)」과 「채(館)」는 다른 축이다. 헷갈리면 둘 다 못 쓴다.**
 * ```
 * 동  docs/건물도면.md   «어느 규격을 따르는가»  — 업무·로비·손님·별관·신관·기계실
 * 채  이 파일            «누구에게 파는 물건인가» — 찾기·견적·거래
 * ```
 *   한 층은 동 하나와 채 하나를 «둘 다» 갖는다. 예를 들어 `/shop` 은 «손님 동 · 찾기 채»다.
 *
 * ★★★**공용은 「세 채에 다 되는 것」이다.** 한 채만 쓰는데 공용 자리에 있으면 그건 공용이 아니라
 *   «아직 안 옮긴 것»이다. 따로 팔려면 공용이 세 벌로 갈라지면 안 된다 —
 *   갈라지는 순간 「어느 게 정본이냐」를 잃는다. 대수가 582에서 694로 뛰던 것과 같은 종류의 사고다.
 *
 * ⚠ 이 파일은 **지도**다. 지도를 고쳐서 실물을 바꾸지 않는다 — 실물을 옮기고 지도를 맞춘다.
 *   재는 것은 `npm run check:wings`.
 */

export type Wing = '찾기' | '견적' | '거래';

export const WINGS: { key: Wing; name: string; what: string }[] = [
  { key: '찾기', name: '상품찾기', what: '차를 찾아 손님에게 보낸다 — 매물·재고·원자 샘. ★화이트라벨 프로젝트로 분리 중' },
  { key: '견적', name: '견적', what: '차·조건을 넣으면 대여료와 손익이 나온다 — 원가 설정이 그 짝' },
  { key: '거래', name: '전자계약·정산·회원사', what: '계약을 맺고 돈을 주고받고, 회원사·파트너사를 관리한다' },
];

/**
 * **층(라우트) → 채.** `app/` 아래 폴더 이름 그대로 적는다.
 * ⚠ 새 층을 올리면 여기 한 줄을 더한다 — `check:wings` 가 빠진 것을 잡는다.
 */
export const ROUTE_WING: Record<string, Wing | '공용'> = {
  // ── 찾기 ─────────────────────────────────────────────
  '(shop)': '찾기',        // 가게 — 영업채널 이름으로 나가는 손님 매물 화면
  finder: '찾기',          // 매물 찾기(회원 첫 화면)
  catalog: '찾기',         // 매물 카탈로그
  interest: '찾기',        // 관심 매물
  m: '찾기',               // 모바일 매물 상세(손님 링크)
  q: '찾기',               // 견적 한 장 — «견적 엔진»이 아니라 매물 한 장을 보내는 링크다
  share: '찾기',           // 내 손님 링크
  inventory: '찾기',       // 재고 등록·편집 — 매물의 원천
  spring: '찾기',          // 원자 샘(Firestore products 그 자체)
  hub: '찾기',             // 원자 파이프라인 관제탑
  sonogong: '찾기',        // 별관 — 소노공 액자
  welrix: '찾기',          // 별관 — 웰릭스 액자
  'data-check': '찾기',    // 차종마스터 정합성

  // ── 견적 ─────────────────────────────────────────────
  estimate: '견적',        // 견적 + 원가 설정(/estimate/cost)

  // ── 거래 ─────────────────────────────────────────────
  esign: '거래',           // 계약서관리
  sign: '거래',            // 전자계약 서명(손님)
  verify: '거래',          // 계약서 진위 확인(손님)
  settlement: '거래',      // 정산 · 정산원장 · 정산서
  contract: '거래',        // 정산확인(영업자·공급사가 제 실적을 본다)
  members: '거래',         // 회원사·파트너사 관리
  chat: '거래',            // 문의·상담방
  connectors: '거래',      // 연동 허브

  // ── 공용 — 세 채에 다 되어야 하는 것 ──────────────────
  /**
   * ★★**「정책」은 한 채의 것이 아니다.** 계약정책·요금표는
   *   견적의 «입력»이고, 정산의 «근거»이고, 상품 카드 「정책 넷」(보험·계약·운전·기타)의 «원천»이다.
   *   어느 한 채에 넣으면 나머지 둘이 남의 집 문을 열어야 한다 — 그게 지금 SEAMS 셋 중 둘의 정체다.
   */
  policy: '공용',
  login: '공용',
  settings: '공용',
  faq: '공용',
  terms: '공용',
  privacy: '공용',
  api: '공용',
  dev: '공용',
  diag: '공용',
  audit: '공용',

  /**
   * ⚠ **아직 안 정한 것.** 공사가 끝나면 채를 정한다 — 지금 정하면 짓다 만 것을 규격으로 만든다.
   */
  erp5: '공용',
};

/**
 * ★★★**걸린 자리 — 「찾기」를 뜯어낼 때 «따라오는 짐».**
 *
 * 실측 2026-09-08 — 찾기 층 열둘이 «하나도 빠짐없이» 거래 쪽 파일을 끌고 있었다.
 * 손님만 보는 `/shop`·`/q`·`/m` 도 그랬다. 길은 넷이었는데, **재 보니 셋은 짐이 아니었다.**
 * ```
 * product.ts → policy-money-rate      import 0개 — 아무것도 안 끈다. 이름만 «policy» 다
 * entities.ts → policy-value-spec     import 0개 — 같다. 원자 스키마의 일부다
 * tabbar.tsx → deal.ts (type Role)    type 라 빌드에선 지워진다 — 그래도 파일 경계는 짐이었다
 * product.ts → esign-required-documents → esign-contract-kind   ★이것만 진짜였다
 * ```
 *
 * ⇒ **이름이 아니라 «딸려 오는 것»으로 잰다.** `check:wings` 가 파일마다 그 무게를 세므로,
 *   여기 손으로 적어 둔 목록을 믿지 않는다 — 아래는 «푼 기록»이다.
 *
 * ★★푼 것(2026-09-08)
 * ```
 * lib/domain/required-documents.ts   서류를 «읽는» 것만 — 공용. product.ts 가 여기를 부른다
 * lib/domain/esign-required-documents.ts   계약을 «진행»할 때 쓰는 것만 남기고 위를 다시 내보낸다
 * lib/domain/roles.ts                역할 셋(agent·provider·admin) — 공용. deal.ts 가 다시 내보낸다
 * ```
 *   이제 손님 매물 화면은 위약금율·지연이자·계약종류(`esign-contract-kind`)를 안 끈다.
 *
 * ⚠ **아직 안 푼 것** — `lib/store.ts` → `rtdb-adapter` → `contract-dedupe`.
 *   저장소 어댑터가 계약을 안다. 찾기가 제 저장소를 갖게 될 때 같이 본다.
 */
export const SEAMS_SOLVED = [
  { from: 'lib/domain/product.ts', to: 'lib/domain/esign-contract-kind.ts',
    how: 'required-documents(공용)로 «읽기»만 갈랐다', at: '2026-09-08' },
  { from: 'lib/tabbar.tsx', to: 'lib/domain/deal.ts',
    how: 'roles.ts(공용)로 옮기고 deal 이 다시 내보낸다', at: '2026-09-08' },
] as const;

/** 아직 안 푼 것 — 재서 줄여 나간다. */
export const SEAMS = [
  { from: 'lib/store.ts', to: 'lib/domain/contract-dedupe.ts', why: '저장소 어댑터(rtdb-adapter)가 계약 중복제거를 안다', how: '찾기가 제 저장소를 갖게 될 때 같이 본다' },
] as const;

/** `app/` 아래 폴더 이름에서 채를 읽는다. 모르면 `null` — 그건 도면에 없는 층이다. */
export const wingOfRoute = (folder: string): Wing | '공용' | null => ROUTE_WING[folder] ?? null;
