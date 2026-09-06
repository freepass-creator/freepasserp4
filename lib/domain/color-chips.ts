/**
 * **색 이름 → 색칩(코드).** 원자가 색을 «스스로 설명»하게 한다 — 다른 데서 원자를 당겨갈 때
 * 이름만이 아니라 «코드(hex)»까지 같이 와서, B2C·카드·화이트라벨 어디서든 같은 견본을 그린다.
 *   사장님 2026-09-05 「색상 칩 데이터를 원자에 반영 — 화이트면 화이트 컬러 코드를 같이 쓸 수 있게」.
 *
 * ★SSOT 는 여기 하나. 원자에 박는 `ext_color_code`·`int_color_code` 는 이 표로 «파생»된다
 *   (ingest/refine 때 다시 계산 — 표가 바뀌면 원자도 따라 갱신). 로컬 색맵 금지, 이 표만 쓴다.
 * ★동의어를 대표색으로 모은다(흰색=화이트 · 쥐색=그레이 · 검정시트=블랙 …) — 실측 24/16종을 덮는다.
 * ★`border` = 바탕이 흰/옅어서 «테두리 없으면 안 보이는» 색(화이트·실버·민트·베이지·하늘색).
 */
export type ColorChip = { name: string; code: string; border: boolean };

/** 동의어 → 대표 이름. 원본 표기는 원자의 ext_color/int_color 에 그대로 둔다(이건 코드 계산용). */
const ALIAS: Record<string, string> = {
  '흰색': '화이트',
  '검정': '블랙', '검정색': '블랙', '검정시트': '블랙', '검정색 시트': '블랙', '검정 시트': '블랙',
  '쥐색': '그레이', '회색': '그레이', '시트회색': '그레이', '쥐색 시트': '그레이', '쥐색시트': '그레이',
  '파랑색': '블루', '파랑': '블루',
  '남색': '네이비',
  '녹색': '초록', '초록색': '초록', '국방색': '초록',
  '미색': '베이지',
  '갈색': '브라운',
};

/** 대표 이름 → 칩. (원본이 대표와 같으면 ALIAS 없이 바로 여기서 잡힌다.) */
const CHIP: Record<string, ColorChip> = {
  '화이트': { name: '화이트', code: '#FFFFFF', border: true },
  '블랙':   { name: '블랙',   code: '#1A1A1A', border: false },
  '그레이': { name: '그레이', code: '#8A8D91', border: false },
  '실버':   { name: '실버',   code: '#C6C9CE', border: true },
  '블루':   { name: '블루',   code: '#2F6FED', border: false },
  '네이비': { name: '네이비', code: '#1E2F52', border: false },
  '민트':   { name: '민트',   code: '#8FD6C4', border: true },
  '베이지': { name: '베이지', code: '#E4D6BC', border: true },
  '초록':   { name: '초록',   code: '#3B7A3B', border: false },
  '레드':   { name: '레드',   code: '#D23B34', border: false },
  '청옥색': { name: '청옥색', code: '#128C8C', border: false },
  '금색':   { name: '금색',   code: '#C9A64B', border: false },
  '브라운': { name: '브라운', code: '#7A5230', border: false },
  '하늘색': { name: '하늘색', code: '#8FCDF2', border: true },
  '카멜':   { name: '카멜',   code: '#C19A6B', border: false },
};

/** 색 이름 → 칩. 못 알아보거나 색이 아닌 값(«기타»·«-»·빈칸)은 null(칩 안 그린다). */
export function colorChip(name: unknown): ColorChip | null {
  const raw = String(name ?? '').trim();
  if (!raw || raw === '-' || raw === '기타') return null;
  const key = ALIAS[raw] || raw;
  return CHIP[key] || null;
}

/** 원자에 박을 코드(hex)만. 칩 없으면 빈 문자열. */
export function colorCode(name: unknown): string {
  return colorChip(name)?.code || '';
}
