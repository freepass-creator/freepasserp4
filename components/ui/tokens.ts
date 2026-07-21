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
};
export const R = 4; // = --radius (jpkerp5 표준 4px)
export const NUM = 'var(--font-mono)';

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
 * 컨트롤 높이·폰트 SSOT — 페이지/컴포넌트는 height 숫자 금지, size·헬퍼만.
 *
 *  웹  md=32 / sm=28
 *  모바일 md=40 / sm=36 (높이는 터치 여유. 가로는 Btn 패딩으로 키움)
 *  입력·독 컨트롤 폰트 모바일=16 고정(검색·정렬·필터 동일 · iOS 줌 방지)
 *  칩 = 웹 sm(28) · 모바일 md(40)
 *
 *  바 높이 = CSS --fp-bar-h
 *    웹 32+12×2=56 · 모바일 40+8×2=56
 */
export type CtrlSize = 'md' | 'sm';

export const CTRL = {
  md: { web: 32, mobile: 40, fsWeb: 12.5, fsMobile: 16 },
  sm: { web: 28, mobile: 36, fsWeb: 12, fsMobile: 16 },
} as const;

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

/** 필터칩 높이 — 웹 sm · 모바일 md (옆 Btn/Search와 맞춤) */
export function ctrlChipH(mobile: boolean): number {
  return mobile ? CTRL.md.mobile : CTRL.sm.web;
}
