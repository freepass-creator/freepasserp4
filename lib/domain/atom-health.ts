/**
 * 원자 «판정」 순수 로직 (SSOT) — 건강(무결성)·정책 조인·요금표.
 *
 * ★생성기(tmp 미리보기)와 실제 화면(app/spring)이 «이 한 파일」을 import 한다.
 *   규칙이 흩어지면 언젠가 한 곳이 달라진다 — 2026-09-05 일렉트리파이드 사고가 그거였다.
 *   fs·firebase-admin 없음(서버·클라이언트·스크립트 어디서나). 마스터·정책은 호출부가 넘긴다.
 *
 * 짝: 불변식 = [atom-invariants], 필드 역할 = [atom-fields], 원천 = docs/원자-원천지도.md.
 */
import { atomViolations, type MasterIndex, type AtomView, type Violation } from './atom-invariants';
import { makerGroup } from './vehicle-master-match';
import type { MasterEntry } from './vehicle-master-types';

const S = (v: unknown) => String(v ?? '').trim();
const N = (v: unknown) => S(v).toLowerCase().replace(/\s+/g, '');
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/** 차종마스터 배열 → 불변식 조회 인덱스(순수). check-atom-invariants.mts 와 같은 조립. */
export function buildMasterIndex(entries: MasterEntry[]): MasterIndex {
  const SUB = new Set<string>(); const TRIMS = new Map<string, string[]>();
  for (const e of entries) {
    if ((e as { retired?: boolean }).retired) continue; // 비활성(연료축 분리로 하이브리드 라벨 은퇴 등) — 검증에서 제외
    const mo = N(e.model), sm = N(e.sub_model); if (!mo || !sm) continue;
    for (const a of makerGroup(N(e.maker))) { SUB.add(`${a}|${mo}|${sm}`); if (e.trims?.length) TRIMS.set(`${a}|${mo}|${sm}`, e.trims); }
  }
  return {
    validSub: (mk, mo, sm) => { for (const a of makerGroup(N(mk))) if (SUB.has(`${a}|${N(mo)}|${N(sm)}`)) return true; return false; },
    trimsOf: (mk, mo, sm) => { for (const a of makerGroup(N(mk))) { const t = TRIMS.get(`${a}|${N(mo)}|${N(sm)}`); if (t) return t; } return []; },
  };
}

/** 원자 갱신 시각(변동 폴링 우선). */
export function updatedAt(atom: Record<string, unknown>): number {
  return num(atom._var_polled_at || atom._direct_ingest_at || atom._mirror_at);
}

export type Health = '정상' | '주의' | '문제';
export interface AtomHealth {
  health: Health;
  blocks: Violation[];   // 불변식 block — 확정 불가(모순)
  warns: Violation[];    // 불변식 warn — 확정되나 눈에 띔
  reasons: string[];     // 코드 요약(목록 「문제사유」)
  stale: boolean;        // 6h↑ 미갱신
  unconfirmed: boolean;  // 확정=false
}

/**
 * 실시간 건강 — 「절대 실수할 수 없는 엔진」 결과.
 *   block → 문제(빨강) · warn/미확정/지연 → 주의(주황) · 그 밖 → 정상(초록).
 */
export function atomHealth(atom: Record<string, unknown>, idx: MasterIndex, now: number, staleMs = 6 * 3600 * 1000): AtomHealth {
  const vio = atomViolations(atom as AtomView, idx);
  const blocks = vio.filter((v) => v.severity === 'block');
  const warns = vio.filter((v) => v.severity === 'warn');
  const upd = updatedAt(atom);
  const stale = !!upd && now - upd > staleMs;
  const unconfirmed = atom.확정 !== true;
  const health: Health = blocks.length ? '문제' : (warns.length || unconfirmed || stale ? '주의' : '정상');
  const reasons = [...blocks.map((v) => v.code), ...warns.map((v) => v.code), ...(unconfirmed && !blocks.length ? ['미확정'] : []), ...(stale ? ['지연'] : [])];
  return { health, blocks, warns, reasons, stale, unconfirmed };
}

/** policy_code → policy 문서. `_S0N`/`_P0N` 제로패딩 폴백까지. 없으면 null(프리패스 표준/미배정). */
export function joinPolicy(policyByKey: Map<string, Record<string, unknown>>, code: string): Record<string, unknown> | null {
  const c = S(code); if (!c) return null;
  return policyByKey.get(c) || policyByKey.get(c.replace(/_S(\d)$/, '_S0$1')) || policyByKey.get(c.replace(/_P(\d)$/, '_P0$1')) || null;
}

export type FareRow = { label: string; values: (number | null)[] };
export interface FareTable { periods: string[]; rows: FareRow[]; hasBuyout: boolean; count: number }

/**
 * 기간별 대여료 — 그 차가 «가진 기간만» 가로칸. 대여료/보증금 위아래(+인수형 별도줄).
 *   기본기간 = 접미사 없는 순수 개월. `_인수형` 있으면 인수 대여료·보증금 두 줄 추가.
 */
export function fareTable(price: unknown): FareTable {
  const p = (price && typeof price === 'object' ? price : {}) as Record<string, { rent?: unknown; deposit?: unknown }>;
  const keys = Object.keys(p);
  const periods = [...new Set(keys.map((k) => k.match(/^(\d+)(?:$|_)/)?.[1]).filter(Boolean) as string[])].sort((a, b) => +a - +b);
  const val = (period: string, suf: '' | '_인수형', field: 'rent' | 'deposit'): number | null => {
    const cell = p[suf ? period + suf : period]; const v = cell && (cell as Record<string, unknown>)[field];
    return v != null && num(v) ? num(v) : null;
  };
  const hasBuyout = periods.some((pr) => p[pr + '_인수형']);
  const rows: FareRow[] = [
    { label: '대여료', values: periods.map((pr) => val(pr, '', 'rent')) },
    { label: '보증금', values: periods.map((pr) => val(pr, '', 'deposit')) },
  ];
  if (hasBuyout) {
    rows.push({ label: '인수 대여료', values: periods.map((pr) => val(pr, '_인수형', 'rent')) });
    rows.push({ label: '인수 보증금', values: periods.map((pr) => val(pr, '_인수형', 'deposit')) });
  }
  return { periods, rows, hasBuyout, count: periods.length };
}

/** 목록 최저 대여료(요약 · 만원). */
export function lowestRent(price: unknown): number {
  const p = (price && typeof price === 'object' ? price : {}) as Record<string, { rent?: unknown }>;
  const rents = Object.values(p).map((x) => num(x?.rent)).filter((x) => x > 0);
  return rents.length ? Math.min(...rents) : 0;
}

/** 건강 → 신호 3색 토큰 이름. */
export const HEALTH_TONE: Record<Health, 'ok' | 'warn' | 'bad'> = { 정상: 'ok', 주의: 'warn', 문제: 'bad' };
/** 문제 먼저 정렬용 순위. */
export const HEALTH_RANK: Record<Health, number> = { 문제: 0, 주의: 1, 정상: 2 };
