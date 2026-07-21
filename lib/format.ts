// 금액·숫자 표기 SSOT(표현 계층). 전체 '원' 표기는 components/ui의 won 사용, 여기선 축약·부가 포맷만.

/** 만원 단위 축약 — 카드/집계 서브바 등 좁은 자리. 예: 1,250,000 → "125만". 0/빈값 → "0". */
export const man = (n: unknown): string => {
  const v = Number(n);
  return v ? `${Math.round(v / 10000).toLocaleString()}만` : '0';
};

/** 주행거리 표시 SSOT — `0.0만`·`3.0만`(10만 미만 소수1) / `18만`(10만↑ 버림·소수없음). */
export function kmDisplay(raw: unknown): string {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return '';
  if (n < 1000) return '0.0만';
  const v = Math.round(n / 1000) / 10; // 만km, 소수 1자리
  if (v >= 10) return `${Math.floor(v)}만`;
  return `${v.toFixed(1)}만`;
}

/** 채팅 버블 시각 — 오늘=`HH:mm`, 아니면 `M/D HH:mm`. `dateOnly`면 비오늘은 `M/D`만. */
export function msgClock(ms: unknown, opts?: { dateOnly?: boolean }): string {
  const n = Number(ms);
  if (!n) return '';
  const d = new Date(n);
  const hm = d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return hm;
  const md = `${d.getMonth() + 1}/${d.getDate()}`;
  return opts?.dateOnly ? md : `${md} ${hm}`;
}
