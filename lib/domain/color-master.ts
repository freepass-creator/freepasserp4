/**
 * 색상 SSOT — 외부·내부 색을 규격값으로 스냅.
 * 차종마스터와 같은 원칙: 시트·OCR·수기 어떤 경로든 손님·영업에게는 규격색만.
 *
 * 목록 출처: data-check COLORS (코드에 있던 유일 화이트리스트).
 * 확정 목록이 다르면 EXT_COLORS / INT_COLORS / COLOR_ALIAS 만 교체.
 */
import { type EntityRecord } from '@/lib/intake/entities';

/** 외부색상 규격 — 맞춤형·미매칭은 기타 */
export const EXT_COLORS = [
  '화이트', '블랙', '그레이', '실버', '레드', '블루', '네이비', '브라운', '베이지', '민트', '크레용', '기타',
] as const;

/** 내부색상 규격 — 외장과 동일 베이스(실내 전용 표기도 알리아스로 흡수). 미매칭=기타 */
export const INT_COLORS = [
  '블랙', '그레이', '베이지', '브라운', '화이트', '레드', '실버', '네이비', '민트', '기타',
] as const;

export type ExtColor = (typeof EXT_COLORS)[number];
export type IntColor = (typeof INT_COLORS)[number];

/** 필터 색상점 전용 실제 색상값. UI 장식색이 아니라 차량 색상 데이터의 시각 표현이다. */
const COLOR_SWATCH: Record<string, string> = {
  화이트: '#f7f7f5', 블랙: '#202124', 그레이: '#7d8289', 실버: '#c7cbd0',
  레드: '#c94747', 블루: '#3f6fae', 네이비: '#283b61', 브라운: '#76533f',
  베이지: '#d8c5a3', 민트: '#76b9a5', 크레용: '#ddd7cb', 기타: '#a4a7ab',
};

export function colorSwatch(raw: unknown): string {
  return COLOR_SWATCH[String(raw || '').trim()] || COLOR_SWATCH.기타;
}

/**
 * ★규격색 → 글자색(판매시트 외장/내장 칸 — 사장님 2026-08-19 「텍스트에 색깔 입혀 주면 좋아요」).
 *   흰 바탕에서 읽히도록 화이트·실버는 회색 계열, 나머지는 그 색의 어두운 톤. 기타는 검정 그대로.
 */
export const COLOR_INK: Record<string, string> = {
  화이트: '8A8F94', 블랙: '202124', 그레이: '5F6368', 실버: '80868B',
  레드: 'C5221F', 블루: '1A73E8', 네이비: '1E3A8A', 브라운: '795548',
  베이지: 'A0782C', 민트: '0F9D58', 크레용: '8D6E63',
};

/**
 * ★별칭 덧대기(런타임) — 원천대장 「색상마스터」 탭 @별칭 표(사람이 적는 원문→규격색)를 읽어 코드 기본 별칭 위에 얹는다.
 *   시트 값이 코드보다 이긴다. 규격색 밖 값으로 적으면 무시한다.
 */
const EXTRA_ALIAS: Record<string, string> = {};
export function registerColorAliases(pairs: Record<string, string> | [string, string][]): number {
  const list = Array.isArray(pairs) ? pairs : Object.entries(pairs);
  let n = 0;
  for (const [raw, target] of list) {
    const k = norm(raw); const t = String(target ?? '').trim();
    if (!k || !t) continue;
    if (!(EXT_COLORS as readonly string[]).includes(t) && !(INT_COLORS as readonly string[]).includes(t)) continue;
    EXTRA_ALIAS[k] = t; n++;
  }
  return n;
}
/**
 * ★엔카 색상 기준 «학습»(사장님 2026-08-19 「외장색상 엔카 기준 학습해 봐 — 똑같이 따라할 필요는 없음 · 내부색상 학습만」).
 *   엔카는 외장 30가지(검정색·검정투톤·쥐색·은색·은회색·은색투톤·흰색·진주색·흰색투톤·진주투톤·은하색·명은색·갈대색·연금색·갈색·갈색투톤·금색·금색투톤·
 *   청색·하늘색·담녹색·녹색·연두색·청옥색·빨간색·주황색·자주색·보라색·분홍색·노란색), 내장은 10 «계열»(검정·갈색·베이지·회색·노란·녹색·빨간·주황·청·흰색).
 *   우리는 12색/10색 규격을 유지하고 엔카 어휘를 별칭으로 흡수한다 — 투톤은 바탕색으로, 「계열」은 그 색으로, 금색/갈대색/연금색은 베이지, 은하색/명은색은 실버,
 *   은회색/쥐색은 그레이, 담녹·연두·청옥은 민트(초록 계열), 하늘색은 블루, 노랑·주황·자주·보라·분홍은 규격 밖 → 기타(렌트 재고엔 드물다).
 *   대응표는 ENCAR_EXTERIOR / ENCAR_INTERIOR(색상마스터 탭 「@참고 엔카 기준」에 찍힘).
 */
export const ENCAR_EXTERIOR: [string, string][] = [
  ['검정색', '블랙'], ['검정투톤', '블랙'], ['쥐색', '그레이'], ['은색', '실버'], ['은회색', '그레이'], ['은색투톤', '실버'], ['흰색', '화이트'], ['진주색', '화이트'],
  ['흰색투톤', '화이트'], ['진주투톤', '화이트'], ['은하색', '실버'], ['명은색', '실버'], ['갈대색', '베이지'], ['연금색', '베이지'], ['갈색', '브라운'], ['갈색투톤', '브라운'],
  ['금색', '베이지'], ['금색투톤', '베이지'], ['청색', '블루'], ['하늘색', '블루'], ['담녹색', '민트'], ['녹색', '민트'], ['연두색', '민트'], ['청옥색', '민트'],
  ['빨간색', '레드'], ['주황색', '기타'], ['자주색', '기타'], ['보라색', '기타'], ['분홍색', '기타'], ['노란색', '기타'],
];
export const ENCAR_INTERIOR: [string, string][] = [
  ['검정색 계열', '블랙'], ['갈색 계열', '브라운'], ['베이지색 계열', '베이지'], ['회색 계열', '그레이'], ['노란색 계열', '기타'], ['녹색 계열', '민트'],
  ['빨간색 계열', '레드'], ['주황색 계열', '기타'], ['청색 계열', '네이비'], ['흰색 계열', '화이트'],
];
/** 규격 밖이면 「기타」(사장님 2026-08-19 「예전에 딱 정해 놓은 거 벗어나면 기타로」). 빈 원문은 빈칸. */
export function snapColorOrEtc(raw: unknown, kind: 'ext' | 'int' = 'ext'): string {
  const src = String(raw ?? '').trim();
  if (!src || src === '-') return '';
  return snapColor(src, kind) || '기타';
}

const norm = (v: unknown) => String(v ?? '').trim().toLowerCase().replace(/[\s_\-./]/g, '');

/** 거친 표기 → 규격색. 키는 norm 적용 후. */
const COLOR_ALIAS: Record<string, string> = {
  // 화이트
  화이트: '화이트', 흰색: '화이트', 하얀색: '화이트', 백색: '화이트', white: '화이트',
  펄화이트: '화이트', 화이트펄: '화이트', 진주: '화이트', pearl: '화이트', pearlwhite: '화이트',
  아이보리: '화이트', ivory: '화이트', 크림: '화이트',
  스노우화이트: '화이트', 스노화이트: '화이트', snowwhite: '화이트', snowwhitepearl: '화이트',
  화이트크림: '화이트', 크리미화이트: '화이트', 우노화이트: '화이트',
  // 2026-08-19 실측 보강(판매시트에 원문 그대로 새던 것) — 우유니 화이트(현대) · 세레니티 화이트 펄(기아) · 클라우드 화이트 펄 · 미색(아이보리)
  우유니화이트: '화이트', 우유니: '화이트', uyuni: '화이트', uyuniwhite: '화이트',
  세레니티화이트펄: '화이트', 세레니티화잉트펄: '화이트', 세레니티: '화이트', serenity: '화이트',
  클라우드화이트펄: '화이트', 클라우드펄: '화이트', 클라우드: '화이트', 클리어화이트: '화이트', clearwhite: '화이트',
  미색: '화이트', 아이보리색: '화이트',
  토프: '베이지', taupe: '베이지', 피칸: '브라운', pecan: '브라운', 옵시디언: '블랙', obsidian: '블랙',
  // 블랙
  블랙: '블랙', 검정: '블랙', 검은색: '블랙', 흑색: '블랙', black: '블랙',
  팬텀블랙: '블랙', 솔리드블랙: '블랙', 유광블랙: '블랙',
  어비스블랙: '블랙', 오로라블랙: '블랙', aurora: '블랙',
  // 그레이
  그레이: '그레이', 회색: '그레이', gray: '그레이', grey: '그레이',
  차콜: '그레이', charcoal: '그레이', 건메탈: '그레이', gunmetal: '그레이',
  다크그레이: '그레이', 라이트그레이: '그레이',
  쥐색: '그레이', 진회색: '그레이', 연회색: '그레이', 회색계열: '그레이', 스틸그레이: '그레이', 쉐도우그레이: '그레이',
  티타늄: '그레이', titanium: '그레이',
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
  민트: '민트', mint: '민트', 그린: '민트', 초록: '민트', green: '민트', 연두: '민트', 연두색: '민트', 청록: '민트', 청록색: '민트', 녹색: '민트',
  // 크레용
  크레용: '크레용', crayon: '크레용',
  // 기타
  기타: '기타', other: '기타', etc: '기타', 그외: '기타', 기타색: '기타',
  // 엔카 어휘(2026-08-19 학습) — 투톤·계열은 snapColor 가 접미를 벗겨 바탕색으로 본다
  진주색: '화이트', 은회색: '그레이', 은하색: '실버', 명은색: '실버', 갈대색: '베이지', 연금색: '베이지', 금색: '베이지', 골드: '베이지', 샴페인: '베이지', gold: '베이지',
  하늘색: '블루', 담녹색: '민트', 청옥색: '민트', 빨간색: '레드', 검정색: '블랙', 흰색계열: '화이트', 베이지색: '베이지',
  주황색: '기타', 주황: '기타', 오렌지: '기타', 자주색: '기타', 보라색: '기타', 보라: '기타', 퍼플: '기타', 분홍색: '기타', 핑크: '기타', 노란색: '기타', 노랑: '기타', 옐로우: '기타',
};

function listFor(kind: 'ext' | 'int'): readonly string[] {
  return kind === 'int' ? INT_COLORS : EXT_COLORS;
}

/**
 * 원문 → 규격색.
 * 1) 완전일치·별칭·포함매칭 2) 그래도 없으면 '' (호출측 applyColors가 기타로 흡수).
 */
export function snapColor(raw: unknown, kind: 'ext' | 'int' = 'ext'): string {
  const src = String(raw ?? '').trim();
  if (!src || src === '-') return '';
  const list = listFor(kind);
  // 엔카식 접미(투톤·계열)와 「~색」은 벗겨 바탕색으로 본다 — 「검정투톤」→검정 · 「갈색 계열」→갈색 (2026-08-19 학습).
  const n0 = norm(src);
  const n = n0.replace(/(투톤|계열)$/, '') || n0;
  if (!n) return '';

  for (const c of list) if (norm(c) === n) return c;

  // 내장 규격엔 「블루」가 없다 — 파랑 계열 내장(엔카 「청색 계열」)은 네이비로 접는다.
  const fold = (c: string) => (list.includes(c) ? c : (kind === 'int' && c === '블루' && list.includes('네이비') ? '네이비' : ''));
  const extra = fold(EXTRA_ALIAS[n] || '');
  if (extra) return extra;
  const aliased = fold(COLOR_ALIAS[n] || '');
  if (aliased) return aliased;

  // 복합 표기 "어비스블랙펄" · "화이트 크림" — 포함 매칭(긴 규격 우선, 기타는 마지막)
  const byLen = [...list].filter((c) => c !== '기타').sort((a, b) => norm(b).length - norm(a).length);
  for (const c of byLen) {
    const cn = norm(c);
    if (cn && n.includes(cn)) return c;
  }
  for (const [alias, c] of [...Object.entries(EXTRA_ALIAS), ...Object.entries(COLOR_ALIAS)]) {
    if (c === '기타') continue;
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

/** 매물 외·내장색 스냅. 바뀐 원문은 _raw_* 에 보존. 미매칭 → 기타. */
export function applyColors(p: EntityRecord): EntityRecord {
  const out: EntityRecord = { ...p };
  let changed = false;

  const absorb = (field: 'ext_color' | 'int_color', rawKey: '_raw_ext_color' | '_raw_int_color', kind: 'ext' | 'int') => {
    const raw = String(p[field] ?? '').trim();
    if (!raw || raw === '-') return;
    const snapped = snapColor(raw, kind);
    if (snapped) {
      if (snapped !== raw) {
        if (!out[rawKey]) out[rawKey] = raw;
        out[field] = snapped;
        changed = true;
      } else {
        out[field] = snapped;
      }
      return;
    }
    // 규격·별칭에 없음 → 기타 (원문 보존)
    if (raw !== '기타') {
      if (!out[rawKey]) out[rawKey] = raw;
      out[field] = '기타';
      changed = true;
    }
  };

  absorb('ext_color', '_raw_ext_color', 'ext');
  absorb('int_color', '_raw_int_color', 'int');

  if (changed) out._colors_snapped = true;
  return out;
}
