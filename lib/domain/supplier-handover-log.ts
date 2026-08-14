/**
 * **제공시트 숨긴 탭 「AI 인계」의 @이력 — 언제 무엇이 돌았나.**
 *
 * ★왜(사장님 2026-08-14 — 「각 시트마다 탭을 숨겨서 거기서 뭔가 코드? 매뉴얼? 소통을 할 수 있게끔」)
 *   규격화시트를 쓰기 시작하면 «동기화가 멈춘 채 영업자가 옛 값을 보는 것»이 유일한
 *   조용한 실패 경로가 된다. 아무도 안 죽고, 화면에 아무 표시도 없고, 값만 낡는다.
 *   그래서 돌 때마다 그 시트에 한 줄 남기고, 발행기가 그 줄을 보고 오래됐으면 알린다.
 *
 * ⚠ 이력은 **덧붙이기만** 한다. 지우지 않는다 — 「언제부터 안 돌았나」를 알려면 과거가 있어야 한다.
 * ⚠ @메모(사람이 적는 자리)는 건드리지 않는다.
 */

const S = (v: unknown) => String(v ?? '').trim();

export const HANDOVER_TAB = 'AI 인계';

/** 한국 시각 「2026-08-14 13:05」. 시트에 적히는 유일한 시각 표기다. */
export const nowKST = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 16).replace('T', ' ');

/** 이력 한 줄. */
export type LogLine = { at: string; what: string };

/** @이력 블록을 찾아 그 «끝 줄 번호»(0-based)를 준다. 없으면 -1. */
export function findLogEnd(rows: string[][]): number {
  return rows.findIndex((r) => S(r[0]) === '@이력끝');
}

/** 지금 있는 이력을 읽는다 — 마지막이 언제였나 보려고. */
export function readLog(rows: string[][]): LogLine[] {
  const from = rows.findIndex((r) => S(r[0]) === '@이력');
  if (from < 0) return [];
  const out: LogLine[] = [];
  for (const r of rows.slice(from + 1)) {
    if (S(r[0]) === '@이력끝') break;
    if (S(r[1])) out.push({ at: S(r[1]), what: S(r[2]) });
  }
  return out;
}

/** 마지막으로 돈 지 며칠 됐나. 이력이 없으면 null. */
export function daysSince(log: LogLine[], now = new Date()): number | null {
  const last = log.map((l) => l.at).filter(Boolean).sort().pop();
  if (!last) return null;
  const t = Date.parse(`${last.replace(' ', 'T')}:00+09:00`);
  if (!Number.isFinite(t)) return null;
  return (now.getTime() - t) / 86_400_000;
}

/** 오래됐다고 볼 기준(일). 하루 한 번 도는 일이라 이틀이면 «멈췄다»고 본다. */
export const STALE_DAYS = 2;
