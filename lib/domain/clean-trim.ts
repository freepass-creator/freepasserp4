/**
 * 세부트림 = «마스터에서 복사» — 지어내지 않는다 (사장님 2026-09-09).
 *
 * ★사장님 원칙(백번 말씀): 「마스터에 있는 내용으로만 · 원문을 확인해서 마스터 내용으로 복사 붙여넣어준다 ·
 *   분명하게 복사라고. 마스터가 못 덮으면 경고가 오는 거고, 마스터를 채워서 그걸 복사해 간다.」
 *   ⇒ 트림은 오직 두 가지 — ⓐ 마스터 트림을 «복사», ⓑ 마스터가 못 덮으면 «공란»(검수대기+경고).
 *   «노이즈 벗겨 core»·«기본형» 같은 «지어내기(추출)»는 사장님이 거부 — 폐기했다(2026-09-09).
 *
 * 규칙5(atom-invariants)와 정합: 「세부트림은 그 세부모델 마스터 트림이거나 «비어야» 한다.」
 * 마스터를 못 덮는 차는 `audit-atom-master-warnings.mts` 가 경고로 뽑는다 → 사람이 마스터를 채운다 → 다음 회차에 복사됨.
 */

const S = (v: unknown) => String(v ?? '').trim();
const N = (v: unknown) => S(v).toLowerCase().replace(/\s+/g, '');

/** 트림이 «차명 원문 통째»로 오염됐나 — 렌터카·연식MY·배기량·구동 같은 «트림이 아닌 말»이 섞였으면 오염.
 *  (경고 리포트가 «오염» vs «마스터 구멍»을 가르는 데 쓴다. 복사 규칙 자체는 이걸 안 본다 — 마스터에 없으면 어차피 공란.) */
export function isTrimContaminated(trim: unknown): boolean {
  const t = S(trim);
  if (!t) return false;
  return /렌터카|리스|장기렌트|\bMY\b|\d{2}\s*MY|\b\d+\.\d+\b|\b\d+\s*인승|\b(LPi|LPG|가솔린|디젤|전기|하이브리드|EV|HEV|PHEV)\b|\b(2WD|4WD|AWD)\b/i.test(t);
}

/**
 * 세부트림을 마스터에서 «복사»한다 — 지어내지 않는다.
 * @param trim   원문/원자에 붙은 현재 트림(오염됐을 수 있음)
 * @param masterTrims  그 세부모델의 마스터 트림 목록(없거나 못 맞으면 공란 반환)
 * @returns  마스터 트림(정본 철자) 또는 «공란»(마스터가 못 덮음 → 검수대기+경고). 절대 지어낸 값 아님.
 */
export function cleanTrim(trim: unknown, _maker: unknown, _model: unknown, _subModel: unknown, masterTrims: string[] = []): string {
  const t = S(trim);
  if (!t) return '';
  const trims = masterTrims.map(S).filter(Boolean);
  if (!trims.length) return '';   // 마스터가 트림을 안 갖고 있으면(세부등급 없음) 공란이 정답.

  // ① 정확 일치 → 마스터의 «정본 철자»로 복사(Black → 블랙 같은 표기차 흡수).
  const exact = trims.find((mt) => N(mt) === N(t));
  if (exact) return exact;

  // ★부분일치(«마스터 트림이 안에 든다») 추측은 «폐기»한다 — 4-AI 적대검증(Codex 2026-09-09)이 반례를 잡았다:
  //   마스터=[프리미엄,익스클루시브] 일 때 「프리미엄 아님」→「프리미엄」, 「프리미엄 또는 익스클루시브」→「익스클루시브」로
  //   «반대 의미»를 오배정했다. 마스터 값이 문자열에 든다는 사실이 그 차의 트림임을 «입증하지 못한다».
  //   ⇒ 정확히 같을 때만 복사. 아니면 공란(검수대기). 이게 사장님 「마스터에 있는 내용으로만 · 지어내지 마」.

  // ② 마스터가 이 트림을 «정확히» 덮지 못한다 → «공란»(검수대기). 추측·부분일치 없음.
  return '';
}
