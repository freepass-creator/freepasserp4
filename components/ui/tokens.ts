// UI 토큰 SSOT(리프 — ui 다른 파일은 이걸 import, 순환 없음). globals.css 변수 브릿지.
export const C = {
  ink: 'var(--text-main)', mute: 'var(--text-sub)', sub: 'var(--text-sub)', faint: 'var(--text-weak)',
  line: 'var(--border)', line2: 'var(--border-soft)', lineStrong: 'var(--border-strong)',
  bg: 'var(--bg-page)', zebra: 'var(--bg-stripe)', head: 'var(--bg-header)', hover: 'var(--bg-hover)',
  danger: 'var(--red-text)', ok: 'var(--green-text)', warn: 'var(--orange-text)', accent: 'var(--text-link)',
  brand: 'var(--brand)', brandDeep: 'var(--brand-h)',
  /** 네이비의 짝 — 색 사다리 4단(영업자 패널 면). docs/DESIGN_COLOR_LADDER.md */
  sky: 'var(--sky)', skyBg: 'var(--sky-bg)', taupe: 'var(--text-sub)', taupeBg: 'var(--bg-card)', taupeLine: 'var(--border)',
  placeholder: 'var(--bg-placeholder)', // 사진/빈 서피스 배경
  sunken: 'var(--bg-sunken)',           // 한 겹 내려앉은 바닥 — 그 위에 흰 카드가 얹힌다(영업자 칼럼 등)
  selected: 'var(--bg-selected)',       // 선택 행/항목 강조 배경
  warnBg: 'var(--orange-bg)',           // 수기입력·주의 앰버 틴트 배경(=#fff7ed)
  warnLine: 'var(--orange-border)',     // 앰버 면(面)의 테두리. C.warn(글자색)을 테두리로 쓰면 알림 배너만큼 시끄럽다
  okBg: 'var(--green-bg)',              // 완료 스텝·성공 틴트
  dangerBg: 'var(--red-bg)',            // 취소·반려 틴트 배경. 다크에서도 같이 뒤집힌다(생 hex 로 쓰면 안 뒤집힌다)
  inverse: 'var(--text-inverse)',       // 대비 글자(흰/검정 — 테마 따라)
  focusRing: 'var(--focus-ring)',       // 포커스 링 틴트
};
export const R = 4; // = --radius (jpkerp5 표준 4px)
/**
 * 카드·패널처럼 «담는 것»의 모서리 = --radius-lg. 표·컨트롤·뱃지는 R(4) 그대로 둔다.
 *
 * 왜 두 단계인가: 전부 R 하나면 담는 것과 담기는 것이 같은 모양이라 층이 안 생기고
 * 화면이 종이 한 장처럼 평평해진다. (2026-08-20 외부 시안 6벌 대조 — 6벌 모두 카드를
 * 컨트롤보다 크게 잡았다. 3단 12/8/4까지 가면 B2B 밀도에 과해 2단에서 멈춘다.)
 */
export const R_CARD = 8;
/** 상태 배지·칩의 완전한 캡슐 모양. */
export const PILL_R = 999;
/** 재고·업로드 썸네일 폭 SSOT (PhotoUpload·공급사 사진 그리드). */
export const THUMB_W = 76;
export const NUM = 'var(--font-mono)';
/**
 * 숫자 폭 고정 — 세로로 쌓이는 금액이 행마다 흔들리지 않게.
 * ⚠ `--font-mono` 는 이름과 달리 Pretendard(가변폭)라 서체 지정만으로는 자릿수가 안 맞는다.
 *   금액·수량·기간처럼 열로 서는 숫자에는 이걸 같이 얹는다. (표 전체는 globals.css 가 이미 건다)
 */
export const TNUM = { fontVariantNumeric: 'tabular-nums' } as const;

/** 그림자 SSOT — globals.css --shadow-* 브릿지. 하드코딩 boxShadow 금지. */
export const SH = {
  cardRest: 'var(--shadow-sm)',
  cardHover: 'var(--shadow-md)',
  dock: 'var(--shadow-dock)',
  menu: 'var(--shadow-menu)',
  modal: 'var(--shadow-modal)',
} as const;

/** 스크림(오버레이 딤) SSOT — globals.css --scrim-* 브릿지. */
export const SCRIM = {
  light: 'var(--scrim-light)',
  heavy: 'var(--scrim-heavy)',
  /** 풀블리드 라이트박스(사진·문서) — light/heavy와 알파가 다름. */
  black: 'var(--scrim-black)',
} as const;

/**
 * 콘텐츠 타입 스케일 SSOT — 제목·본문·캡션은 이 6단계만 쓴다.
 *   (컨트롤=버튼·입력·칩 폰트는 ctrlFs/ctrlInputFs가 담당. 여기는 "읽는 글자")
 * ⚠ fontSize에 숫자를 직접 찍지 말 것. 손으로 찍으면 화면마다 11/11.5/12/12.5가 섞여 전체 톤이 깨진다.
 *   (실측: 콘텐츠 폰트가 19종까지 난립해 페이지마다 미묘하게 달라진 상태 → 이 스케일로 수렴)
 */
export const FS = {
  page: 18,    // 페이지·섹션 대제목
  title: 14.5, // 목록 행 제목·패널 제목
  body: 13,    // 본문
  sub: 12,     // 보조 설명·부제
  cap: 11,     // 캡션·메타(시간·코드·상대)
  micro: 10,   // 최소(뱃지 내부·마이크로 라벨)
} as const;

/** CI 워드마크 전용 서체 규격. 본문 FS/FW 스케일과 혼용하지 않는다. */
export const BRAND_TYPO = {
  heroSize: 34,
  mainWeight: 600,
  subWeight: 300,
} as const;

/**
 * 폰트 두께 SSOT — "샤프하게". 위계는 크기(FS)+색(C.ink>mute>faint)으로 먼저,
 * 두께는 반 단계만. 800/900 금지(대표 금액 히어로 1개만 예외). 하드코딩 fontWeight 금지.
 */
export const FW = {
  body: 400,   // 본문·읽는 글자 기본
  meta: 500,   // 보조·메타·부제
  label: 550,  // 라벨·칩 활성·작은 태그
  strong: 600, // 목록 2차강조·표 숫자·뱃지
  title: 650,  // 행·패널·섹션 제목 (700 아님)
  head: 700,   // 페이지 대제목·핵심 큰 숫자·활성/선택
} as const;

/**
 * 컨트롤 높이·폰트 SSOT — 페이지/컴포넌트는 height 숫자 금지, size·헬퍼만.
 *
 *  웹  md=32 / sm=28
 *  모바일 md=40 / sm=36 — 터치 40(검색·툴바·md 버튼). sm은 표 안 보조만.
 *  입력·독 컨트롤 폰트 모바일=16 고정(검색·정렬·필터 동일 · iOS 줌 방지)
 *  칩 = 웹 sm(28) · 모바일 40(md)
 *
 *  바 높이 = CSS --fp-bar-h
 *    웹 32+12×2=56 · 모바일 40+8×2=56 (바 높이는 56 유지)
 */
export type CtrlSize = 'lg' | 'md' | 'sm';

/**
 * ★lg(웹 44 / 모바일 48) — **인증·손님 폼 한 장짜리 화면**만 쓴다.
 *   업무동은 고밀도가 규격이라 md 가 맞다. 여기에 lg 를 쓰면 콕핏이 헐거워진다.
 *
 *   왜 만들었나: 현관(`/login`)이 v3 에서 온 44/48 CSS 섬이라 원자를 못 쓰고 있었다
 *   (「원자 높이(32/40)와 충돌 → raw 유지」— 그 한 파일이 남은 임기응변의 1/3이었다).
 *   숫자는 그 CSS 값 그대로 옮긴 것이라 갈아끼워도 보이는 것은 바뀌지 않는다.
 *   사장님 2026-08-30 「원자 규격을 통일해서 그게 달라지면 거길 바꾸면 되니까」
 */
export const CTRL = {
  lg: { web: 44, mobile: 48, fsWeb: 13, fsMobile: 16 },
  md: { web: 32, mobile: 40, fsWeb: 12.5, fsMobile: 16 },
  sm: { web: 28, mobile: 36, fsWeb: 12, fsMobile: 16 },
} as const;

/**
 * 아이콘 크기 SSOT — lucide size 숫자 하드코딩 금지.
 * 같은 동작이 화면마다 13/14/16/17/18/20으로 갈리던 문제 방지.
 *   sm=목록 행 안 보조 · md=버튼·행 기본 · lg=독·툴바·네비 · xl=상세 히어로
 */
/**
 * 글리프 크기 SSOT. `tab` = 모바일 하단 홈바 전용 — 엄지로 누르는 주 탐색이라 한 단 크다
 * (당근 하단바와 같은 비율: 큰 아이콘 + 작은 라벨). 다른 곳에 tab 을 쓰지 않는다.
 */
export const ICON = { sm: 14, md: 16, lg: 18, xl: 20, tab: 24 } as const;

/** 컨트롤 좌우 패딩 SSOT — 전 요소 12(모바일). 바·독·툴바·목록행과 좌측 정렬 일치. */
export function ctrlPadX(mobile: boolean, size: CtrlSize = 'md'): number {
  if (mobile) return size === 'lg' ? 16 : 12; // lg 모바일 16 = v3 로그인 칸 좌우 여백 그대로
  if (size === 'lg') return 12;
  return size === 'sm' ? 8 : 10;
}

export function ctrlH(mobile: boolean, size: CtrlSize = 'md'): number {
  return mobile ? CTRL[size].mobile : CTRL[size].web;
}

/**
 * 라벨-값 2열 행의 라벨 폭 SSOT. 화면마다 110/116/120으로 갈리면
 * 나란한 카드끼리 값 시작선이 어긋나 열이 삐뚤어 보인다.
 */
export const KV_LABEL_W = 116;

/**
 * 컨트롤이 들어가는 행의 세로 패딩 SSOT.
 * 모바일 md 버튼은 40이라 행 구분선에 0px로 붙지 않게 세로 패딩이 필요하다 —
 * 세로 패딩이 없으면 버튼 테두리가 행 구분선에 0px로 맞닿아 "표 안에 끼인" 것처럼 보인다.
 * 웹은 행 32 vs 버튼 28 이라 이미 상하 2px가 남으므로 0(현행 렌더 보존).
 * 값 8 = 스택형 DetailRow·FeedListRow·MetricRow가 이미 쓰는 세로 패딩과 동일.
 */
export function rowPadY(mobile: boolean): number {
  return mobile ? R * 2 : 0;
}

/** 버튼·칩·탭 글자 — 모바일은 검색/입력과 같이 16 (독·필터 통일) */
export function ctrlFs(mobile: boolean, size: CtrlSize = 'md'): number {
  if (mobile) return 16;
  return CTRL[size].fsWeb;
}

/** Input/Select/Search — 모바일 16 고정 · 웹 lg·md=13 / sm=12.5 */
export function ctrlInputFs(mobile: boolean, size: CtrlSize = 'md'): number {
  if (mobile) return 16;
  return size === 'sm' ? 12.5 : 13;
}

/** 필터칩 높이 — 웹 sm · 모바일 md(옆 Btn/Search와 맞춤) */
export function ctrlChipH(mobile: boolean): number {
  return mobile ? CTRL.md.mobile : CTRL.sm.web;
}
