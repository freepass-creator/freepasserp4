// UI 토큰 SSOT(리프 — ui 다른 파일은 이걸 import, 순환 없음). globals.css 변수 브릿지.
export const C = {
  ink: 'var(--text-main)', mute: 'var(--text-sub)', sub: 'var(--text-sub)', faint: 'var(--text-weak)',
  line: 'var(--border)', line2: 'var(--border-soft)',
  bg: 'var(--bg-page)', zebra: 'var(--bg-stripe)', head: 'var(--bg-header)', hover: 'var(--bg-hover)',
  danger: 'var(--red-text)', ok: 'var(--green-text)', warn: 'var(--orange-text)', accent: 'var(--text-link)',
  brand: 'var(--brand)', taupe: 'var(--text-sub)', taupeBg: 'var(--bg-card)', taupeLine: 'var(--border)',
  placeholder: 'var(--bg-placeholder)', // 사진/빈 서피스 배경
  selected: 'var(--bg-selected)',       // 선택 행/항목 강조 배경
  warnBg: 'var(--orange-bg)',           // 수기입력·주의 앰버 틴트 배경(=#fff7ed)
  okBg: 'var(--green-bg)',              // 완료 스텝·성공 틴트
  inverse: 'var(--text-inverse)',       // 대비 글자(흰/검정 — 테마 따라)
  focusRing: 'var(--focus-ring)',       // 포커스 링 틴트
};
export const R = 4; // = --radius (jpkerp5 표준 4px)
/** 재고·업로드 썸네일 폭 SSOT (PhotoUpload·공급사 사진 그리드). */
export const THUMB_W = 76;
export const NUM = 'var(--font-mono)';

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
 *  모바일 md=sm=36 — B2B 밀도. size와 무관하게 한 높이로 수렴(화면마다 36/40이 섞이던 문제 제거).
 *  입력·독 컨트롤 폰트 모바일=16 고정(검색·정렬·필터 동일 · iOS 줌 방지)
 *  칩 = 웹 sm(28) · 모바일 36
 *
 *  바 높이 = CSS --fp-bar-h
 *    웹 32+12×2=56 · 모바일 36+10×2=56 (바 높이는 56 유지)
 */
export type CtrlSize = 'md' | 'sm';

export const CTRL = {
  md: { web: 32, mobile: 36, fsWeb: 12.5, fsMobile: 16 },
  sm: { web: 28, mobile: 36, fsWeb: 12, fsMobile: 16 },
} as const;

/**
 * 아이콘 크기 SSOT — lucide size 숫자 하드코딩 금지.
 * 같은 동작이 화면마다 13/14/16/17/18/20으로 갈리던 문제 방지.
 *   sm=목록 행 안 보조 · md=버튼·행 기본 · lg=독·툴바·네비 · xl=상세 히어로
 */
export const ICON = { sm: 14, md: 16, lg: 18, xl: 20 } as const;

/** 컨트롤 좌우 패딩 SSOT — 전 요소 12(모바일). 바·독·툴바·목록행과 좌측 정렬 일치. */
export function ctrlPadX(mobile: boolean, size: CtrlSize = 'md'): number {
  if (mobile) return 12;
  return size === 'sm' ? 8 : 10;
}

export function ctrlH(mobile: boolean, size: CtrlSize = 'md'): number {
  return mobile ? CTRL[size].mobile : CTRL[size].web;
}

/** 버튼·칩·탭 글자 — 모바일은 검색/입력과 같이 16 (독·필터 통일) */
export function ctrlFs(mobile: boolean, size: CtrlSize = 'md'): number {
  if (mobile) return 16;
  return size === 'sm' ? CTRL.sm.fsWeb : CTRL.md.fsWeb;
}

/** Input/Select/Search — 모바일 16 고정 · 웹 md=13 / sm=12.5 */
export function ctrlInputFs(mobile: boolean, size: CtrlSize = 'md'): number {
  if (mobile) return 16;
  return size === 'sm' ? 12.5 : 13;
}

/** 필터칩 높이 — 웹 sm · 모바일 36 (옆 Btn/Search와 맞춤) */
export function ctrlChipH(mobile: boolean): number {
  return mobile ? CTRL.md.mobile : CTRL.sm.web;
}
