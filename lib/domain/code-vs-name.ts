/**
 * **차종코드가 «그 차»의 코드가 맞나** — 코드의 모델 이름(별칭)·세부모델 개발코드가 공급사 원문(제조사·차명(세부모델+트림)·옵션)에 하나라도 있는지.
 *
 * ★왜(2026-08-19 실측 — 손오공 161허1165 셀토스 줄에 쏘나타 DN8 코드): 08-10 새 시트가 줄이 밀린 채 만들어졌을 때 정제칸에 박힌 차종코드가
 *   공급사 칸을 바로잡은 뒤에도 남았고, 정제칸 채우기가 «상품마스터에 코드가 없으면 시트에 적힌 코드를 그대로 정본으로» 믿어 잘못된 이름을 매일 다시 썼다.
 *   → 시트에 남은 코드는 원문과 맞을 때만 믿는다(여기). 상품마스터 확정 코드도 같은 검사로 감사한다(audit-code-vs-supplier-name).
 * ★판정은 «모델 수준»으로 느슨하게 — 트림·세대까지 따지면 오탐이 난다. 모델 글자가 원문에 없으면(또는 개발코드·세부모델도 없으면) 불일치.
 */
const S = (v: unknown) => String(v ?? '').trim();
export const normText = (v: unknown) => S(v).toLowerCase().replace(/[\s\-_./()（）·,]/g, '');

/** 코드 모델 이름이 원문에 다르게 적히는 것 — 최소 별칭(영문·오타·숫자 표기) */
export const MODEL_ALIAS: Record<string, string[]> = {
  그랜저: ['grandeur', '그랜져'], 쏘나타: ['sonata'], 아반떼: ['avante', '아반테'], 싼타페: ['santafe', '산타페'], 스포티지: ['sportage', '스포티'], 쏘렌토: ['sorento', '소렌토'],
  카니발: ['carnival'], 팰리세이드: ['palisade', '팰리'], 셀토스: ['seltos'], 투싼: ['tucson'], K5: ['k5'], K8: ['k8'], K7: ['k7'], K3: ['k3'], K9: ['k9'], 모닝: ['morning'],
  레이: ['ray'], 니로: ['niro'], 아이오닉5: ['ioniq5', '아이오닉 5'], 아이오닉6: ['ioniq6', '아이오닉 6'], GV70: ['gv70'], GV80: ['gv80'], G80: ['g80'], G70: ['g70'], G90: ['g90'],
  스타리아: ['staria'], 캐스퍼: ['casper'], 코나: ['kona'], 베뉴: ['venue'], 토레스: ['torres'], 티볼리: ['tivoli'], 렉스턴: ['rexton'], 코란도: ['korando'], QM6: ['qm6'], SM6: ['sm6'], XM3: ['xm3'],
  아르카나: ['arkana'], 트랙스: ['trax'], 트레일블레이저: ['trailblazer'], 말리부: ['malibu'], 스파크: ['spark'], '볼트 EUV': ['bolteuv', '볼트euv'], '볼트 EV': ['boltev', '볼트ev'],
  '1시리즈': ['1series', '118', '120', '1 시리즈'], '3시리즈': ['3series', '320', '330', '3 시리즈'], '5시리즈': ['5series', '520', '530', '5 시리즈'], '7시리즈': ['7series', '740', '7 시리즈'],
  'E-클래스': ['e-class', 'e200', 'e220', 'e300', 'e클래스', 'e 클래스'], 'S-클래스': ['s-class', 's350', 's450', 's500', 's클래스'], 'C-클래스': ['c-class', 'c200', 'c220', 'c클래스'],
  A6: ['a6'], A4: ['a4'], 모델3: ['model3', '모델 3'], 모델Y: ['modely', '모델 y'], X5: ['x5'], X3: ['x3'], GLC: ['glc'], GLE: ['gle'],
};

export type CodeNameRecord = { model?: string; sub_model?: string; maker?: string };

/** 코드(마스터 행)와 원문이 같은 차인가 — 모델·별칭·개발코드·세부모델 중 하나라도 원문에 있으면 참. 원문이 비면 «모름»(true 로 두어 함부로 안 지운다). */
export function codeMatchesRawName(rec: CodeNameRecord | undefined, rawText: string): boolean {
  if (!rec) return false;
  const text = normText(rawText);
  if (!text) return true;
  const model = S(rec.model);
  const words = [model, ...(MODEL_ALIAS[model] || [])].map(normText).filter((w) => w.length >= 2);
  const sub = normText(rec.sub_model);
  const devCodes = (S(rec.sub_model).match(/\b[A-Za-z]{1,3}\d{1,2}[A-Za-z]?\b/g) || []).map((c) => c.toLowerCase()).filter((c) => c !== normText(model));
  return words.some((w) => text.includes(w)) || devCodes.some((c) => text.includes(c)) || (sub.length >= 3 && text.includes(sub));
}
