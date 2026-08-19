/**
 * **제조사 표기 규격 — 시트에 적는 이름은 하나다.**
 *
 * ★사장님 2026-08-18 — 「제조사는 르노라고만 하고, KGM — 매뉴얼에 박아서 모든 시트 통일해야지」.
 *   공급사는 르노삼성·르노(삼성)·르노코리아, KG모빌리티·KG모빌리티(쌍용)·쌍용, 쉐보레(대우)·한국지엠 처럼 제각각 적고,
 *   차종마스터는 르노코리아·KG모빌리티 를 쓴다. 영업자·손님이 보는 이름은 **드롭다운 목록(`HANDLED_MAKER_OPTIONS`) 그대로**로 맞춘다.
 * ★적용 자리: 정제시트 미러(제조사) · 정제칸 채우기(제조사(정제)) · 판매시트 발행(제조사) · 일괄 통일 `scripts/unify-maker-names.mts`.
 *   차종마스터 원장은 안 건드린다(그건 «사전»이고 Gemini 가 만진다) — 매칭은 vehicle-master-match 의 그룹 별칭이 흡수한다.
 * ★모르는 이름은 그대로 둔다(지어내지 않는다).
 */
import { HANDLED_MAKER_OPTIONS } from './handled-makers';

const S = (v: unknown) => String(v ?? '').trim();
const key = (v: unknown) => S(v).toLowerCase().replace(/[\s_\-./·()（）]/g, '');

/** 표준 이름 → 옛/다른 표기. 왼쪽이 시트에 적는 이름이다. */
export const MAKER_ALIASES: Record<string, string[]> = {
  르노: ['르노삼성', '르노(삼성)', '르노코리아', '르노코리아자동차', '삼성', '삼성자동차', 'renault', 'renaultkorea', 'rsm', '르노삼성자동차'],
  KGM: ['kg모빌리티', 'kg모빌리티(쌍용)', 'kg 모빌리티', '케이지모빌리티', '쌍용', '쌍용자동차', 'kg', 'kgmobility', 'ssangyong'],
  쉐보레: ['쉐보레(대우)', '한국지엠', '한국gm', 'gm대우', '대우', '시보레', 'chevrolet', 'chevy'],
  벤츠: ['메르세데스', '메르세데스벤츠', '메르세데스-벤츠', 'mercedes', 'mercedesbenz', 'benz'],
  현대: ['현대자동차', 'hyundai'],
  기아: ['기아자동차', 'kia'],
  제네시스: ['genesis'],
  BMW: ['비엠더블유', 'bmw'],
  아우디: ['audi'],
  테슬라: ['tesla'],
  미니: ['mini', 'bmw미니', 'minicooper'],
  폭스바겐: ['volkswagen', 'vw', '폭스바겐코리아'],
  볼보: ['volvo'],
  캐딜락: ['cadillac'],
  지프: ['jeep'],
  포르쉐: ['porsche'],
  BYD: ['비야디', 'byd'],
  폴스타: ['polestar'],
  // ★취급 드롭다운 밖이지만 «알아보기 위해» 두는 이름(2026-08-19, 오토플러스 원본 「포드 익스플로러」) — 정제시트 모델명 분리(splitMakerModel)·제조사 규격화에만 쓴다.
  포드: ['ford'],
  렉서스: ['lexus'],
  토요타: ['toyota', '도요타'],
  혼다: ['honda'],
  닛산: ['nissan'],
  인피니티: ['infiniti'],
  랜드로버: ['landrover', 'land rover', '랜드 로버'],
  재규어: ['jaguar'],
  푸조: ['peugeot'],
  링컨: ['lincoln'],
  마세라티: ['maserati'],
  벤틀리: ['bentley'],
  롤스로이스: ['rollsroyce', 'rolls-royce'],
  람보르기니: ['lamborghini'],
  페라리: ['ferrari'],
};
const CANON = new Map<string, string>();
for (const name of HANDLED_MAKER_OPTIONS) CANON.set(key(name), name);
for (const [name, list] of Object.entries(MAKER_ALIASES)) { CANON.set(key(name), name); for (const a of list) CANON.set(key(a), name); }

/** 표기 규격으로 맞춘 제조사. 규격에 없는 이름은 원문 그대로(빈 값은 빈 값). */
export function canonMakerDisplay(raw: unknown): string {
  const v = S(raw);
  if (!v) return '';
  return CANON.get(key(v)) || v;
}
/** 규격 밖(그대로 둔) 이름인가 — 감사에서 세어 보여 준다. */
export function isStandardMaker(v: unknown): boolean { return !S(v) || CANON.get(key(v)) === S(v); }
export const MAKER_STANDARD_NOTE = `제조사는 드롭다운 이름 그대로 — ${HANDLED_MAKER_OPTIONS.join(' · ')}. 르노삼성·르노코리아 → 르노 / KG모빌리티·쌍용 → KGM / 쉐보레(대우)·한국지엠 → 쉐보레 / 메르세데스 → 벤츠.`;
