/**
 * 세부트림 «청소기» — 차명 원문이 통째로 새어들지 못하게 막는 마지막 방벽.
 *
 * ★사장님 2026-09-09 「아직도 세부트림에 이런 것들이 오염돼서 들어가네 … 진짜 힘들다」.
 *   실측: 109호2588 세부트림 = 「K5 렌터카 LPi 2.0 스탠다드 4 23MY」(= 차명 원문 통째).
 *   뿌리 = 마스터 「K5 DL3」 트림에 «스탠다드»가 없어(노블레스·시그니처·트렌디·프레스티지뿐),
 *   정제가 트림을 못 고르면 «차명을 그대로» 세부트림에 박았다.
 *
 * ★규칙: ① 마스터 트림과 (부분)일치하면 그 마스터 트림. ② 아니면 노이즈(렌터카·연료·배기량·인승·연식·
 *   구동·모델/세부모델 이름)를 벗겨 «핵심 트림 토큰»만. ③ 그래도 비면 «기본형»(사장님: 공란이거나 기본형).
 *   ⇒ 세부트림엔 절대 «차명 원문 통째»(렌터카·MY·배기량 포함)가 안 남는다.
 */

const S = (v: unknown) => String(v ?? '').trim();

/** 트림이 «차명 원문 통째»로 오염됐나 — 렌터카·연식MY·배기량·구동 같은 «트림이 아닌 말»이 섞였으면 오염. */
export function isTrimContaminated(trim: unknown): boolean {
  const t = S(trim);
  if (!t) return false;
  return /렌터카|리스|장기렌트|\bMY\b|\d{2}\s*MY|\b\d+\.\d+\b|\b\d+\s*인승|\b(LPi|LPG|가솔린|디젤|전기|하이브리드|EV|HEV|PHEV)\b|\b(2WD|4WD|AWD)\b/i.test(t);
}

/** 노이즈를 벗긴다 — 연료·배기량·구동·렌터카·연식·인승·모델/세부모델 이름·홑숫자. */
function stripNoise(raw: string, maker: string, model: string, subModel: string): string {
  let t = ` ${raw} `;
  for (const name of [subModel, model, maker].filter(Boolean)) {
    // 세부모델·모델·제조사 이름 자체는 트림이 아니다(K5·그랑 콜레오스…). 통째로만 지운다(부분단어 오삭제 방지).
    t = t.replace(new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi'), ' ');
    // gen_code 스러운 꼬리(DL3 등)도 세부모델과 함께 붙어 오면 지운다
  }
  t = t
    .replace(/렌터카|리스|장기렌트|재렌트/gi, ' ')
    .replace(/\b(LPi|LPG|가솔린|디젤|전기|하이브리드|수소|EV|HEV|PHEV|마일드\s*하이브리드)\b/gi, ' ')
    .replace(/\b(2WD|4WD|AWD|FWD|RWD|e-4WD)\b/gi, ' ')
    .replace(/\b\d{2}\s*MY\b/gi, ' ')            // 23MY
    .replace(/\b\d+\.\d+\s*(T|터보|GDI|MPI|TCi)?\b/gi, ' ')   // 2.0 · 1.5 · 1.6T
    .replace(/\b\d+\s*인승?\b/g, ' ')            // 5인승
    .replace(/\b[A-Z]{1,3}\d{1,3}\b/g, ' ')      // gen_code (DL3·MQ4…) 잔재
    .replace(/\s+\d\s+/g, ' ')                   // 홑숫자(인승 4·3)
    .replace(/\s+/g, ' ')
    .trim();
  return t;
}

/**
 * 세부트림을 청소한다. masterTrims 가 있으면 거기 맞춘다.
 * @param trim   현재 세부트림(오염됐을 수 있음)
 * @param maker/model/subModel  노이즈로 벗길 이름들
 * @param masterTrims  그 세부모델의 마스터 트림 목록(없으면 [])
 */
export function cleanTrim(trim: unknown, maker: unknown, model: unknown, subModel: unknown, masterTrims: string[] = []): string {
  const t = S(trim);
  if (!t) return '';
  const mk = S(maker), md = S(model), sm = S(subModel);
  const trims = masterTrims.map(S).filter(Boolean);

  // ① 정확 일치 우선 — 이미 마스터 트림이면 그대로(에스프리 알핀 → 에스프리 알핀, «누아르»로 늘리지 않는다).
  if (trims.includes(t)) return t;
  // ①′ 내 트림이 «마스터 트림 + 노이즈»면 그 마스터 트림으로(내가 더 긴 쪽). ⚠ 반대(마스터가 나를 포함)는 안 쓴다 — 더 긴 트림으로 오확장된다.
  const contained = trims.filter((mt) => t.includes(mt)).sort((a, b) => b.length - a.length)[0];
  if (contained && !isTrimContaminated(contained)) return contained;

  // 오염이 아니고 마스터도 조용하면 있는 값 그대로(이미 깨끗한 트림).
  if (!isTrimContaminated(t)) return t;

  // ② 오염 — 노이즈를 벗겨 핵심만.
  const core = stripNoise(t, mk, md, sm);
  // 벗긴 핵심이 마스터 트림과 맞으면 그걸로(정확 → 핵심이 마스터를 포함 순, «마스터가 핵심을 포함»은 안 씀).
  const coreHit = trims.includes(core) ? core : trims.filter((mt) => core.includes(mt)).sort((a, b) => b.length - a.length)[0];
  if (coreHit) return coreHit;
  // ③ 핵심이 남으면 그것(스탠다드 등), 없으면 기본형.
  return core || '기본형';
}
