/**
 * 색상 SSOT — 외부·내부 색을 규격값으로 스냅.
 * 차종마스터와 같은 원칙: 시트·OCR·수기 어떤 경로든 손님·영업에게는 규격색만.
 *
 * 목록 출처: data-check COLORS (코드에 있던 유일 화이트리스트).
 * 확정 목록이 다르면 EXT_COLORS / INT_COLORS / COLOR_ALIAS 만 교체.
 */
import { type EntityRecord } from '@/lib/intake/entities';

/** 외부색상 규격 */
export const EXT_COLORS = [
  '화이트', '블랙', '그레이', '실버', '레드', '블루', '네이비', '브라운', '베이지', '민트', '크레용',
] as const;

/** 내부색상 규격 — 외장과 동일 베이스(실내 전용 표기도 알리아스로 흡수) */
export const INT_COLORS = [
  '블랙', '그레이', '베이지', '브라운', '화이트', '레드', '실버', '네이비', '민트',
] as const;

export type ExtColor = (typeof EXT_COLORS)[number];
export type IntColor = (typeof INT_COLORS)[number];

const norm = (v: unknown) => String(v ?? '').trim().toLowerCase().replace(/[\s_\-./]/g, '');

/** 거친 표기 → 규격색. 키는 norm 적용 후. */
const COLOR_ALIAS: Record<string, string> = {
  // 화이트
  화이트: '화이트', 흰색: '화이트', 하얀색: '화이트', 백색: '화이트', white: '화이트',
  펄화이트: '화이트', 화이트펄: '화이트', 진주: '화이트', pearl: '화이트', pearlwhite: '화이트',
  아이보리: '화이트', ivory: '화이트', 크림: '화이트',
  // 블랙
  블랙: '블랙', 검정: '블랙', 검은색: '블랙', 흑색: '블랙', black: '블랙',
  팬텀블랙: '블랙', 솔리드블랙: '블랙', 유광블랙: '블랙',
  // 그레이
  그레이: '그레이', 회색: '그레이', gray: '그레이', grey: '그레이',
  차콜: '그레이', charcoal: '그레이', 건메탈: '그레이', gunmetal: '그레이',
  다크그레이: '그레이', 라이트그레이: '그레이',
  // 실버
  실버: '실버', 은색: '실버', silver: '실버', 실버메탈릭: '실버',
  // 레드
  레드: '레드', 빨강: '레드', 빨간: '레드', 적색: '레드', red: '레드',
  버건디: '레드', burgundy: '레드',
  // 블루
  블루: '블루', 파랑: '블루', 파란: '블루', 청색: '블루', blue: '블루',
  스카이블루: '블루', skyblue: '블루',
  // 네이비
  네이비: '네이비', 남색: '네이비', navy: '네이비', navyblue: '네이비', 네이비블루: '네이비',
  다크블루: '네이비',
  // 브라운
  브라운: '브라운', 갈색: '브라운', brown: '브라운', 커피: '브라운',
  // 베이지
  베이지: '베이지', beige: '베이지', 살구: '베이지', 카키: '베이지',
  // 민트 / 그린
  민트: '민트', mint: '민트', 그린: '민트', 초록: '민트', green: '민트',
  // 크레용
  크레용: '크레용', crayon: '크레용',
};

function listFor(kind: 'ext' | 'int'): readonly string[] {
  return kind === 'int' ? INT_COLORS : EXT_COLORS;
}

/**
 * 원문 → 규격색. 못 맞추면 '' (억지 추측 금지 — 차종마스터와 동일).
 */
export function snapColor(raw: unknown, kind: 'ext' | 'int' = 'ext'): string {
  const src = String(raw ?? '').trim();
  if (!src || src === '-') return '';
  const list = listFor(kind);
  const n = norm(src);
  if (!n) return '';

  for (const c of list) if (norm(c) === n) return c;

  const aliased = COLOR_ALIAS[n];
  if (aliased && list.includes(aliased)) return aliased;

  // 복합 표기 "어비스블랙펄" · "화이트 크림" — 포함 매칭(긴 규격 우선)
  const byLen = [...list].sort((a, b) => norm(b).length - norm(a).length);
  for (const c of byLen) {
    const cn = norm(c);
    if (cn && n.includes(cn)) return c;
  }
  for (const [alias, c] of Object.entries(COLOR_ALIAS)) {
    if (alias.length >= 2 && n.includes(alias) && list.includes(c)) return c;
  }
  return '';
}

/** 표시용 — 스냅 가능하면 규격, 아니면 원문(빈/대시 제외). */
export function colorDisplay(raw: unknown, kind: 'ext' | 'int' = 'ext'): string {
  const snapped = snapColor(raw, kind);
  if (snapped) return snapped;
  const s = String(raw ?? '').trim();
  return !s || s === '-' ? '' : s;
}

/** 매물 외·내장색 스냅. 바뀐 원문은 _raw_* 에 보존. */
export function applyColors(p: EntityRecord): EntityRecord {
  const out: EntityRecord = { ...p };
  let changed = false;

  const rawExt = String(p.ext_color ?? '').trim();
  if (rawExt && rawExt !== '-') {
    const snapped = snapColor(rawExt, 'ext');
    if (snapped && snapped !== rawExt) {
      if (!out._raw_ext_color) out._raw_ext_color = rawExt;
      out.ext_color = snapped;
      changed = true;
    } else if (snapped) {
      out.ext_color = snapped;
    }
  }

  const rawInt = String(p.int_color ?? '').trim();
  if (rawInt && rawInt !== '-') {
    const snapped = snapColor(rawInt, 'int');
    if (snapped && snapped !== rawInt) {
      if (!out._raw_int_color) out._raw_int_color = rawInt;
      out.int_color = snapped;
      changed = true;
    } else if (snapped) {
      out.int_color = snapped;
    }
  }

  if (changed) out._colors_snapped = true;
  return out;
}
