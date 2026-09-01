/**
 * 제조사 표기로 국산/수입을 가르는 가벼운 공통 규칙.
 * 판매시트 탭 이름만 읽는 감사기가 무거운 시트 수입·차종매칭 모듈 전체를 불러오지 않도록
 * 차종마스터와 무관한 이 규칙을 별도 모듈에 둔다.
 */
export const IMPORT_BRANDS = [
  'bmw', 'benz', 'mercedes', '벤츠', 'audi', '아우디', 'volvo', '볼보', 'lexus', '렉서스',
  'porsche', '포르쉐', 'jaguar', '재규어', 'land rover', '랜드로버', 'mini', '미니', 'volkswagen', '폭스바겐', 'peugeot',
  '푸조', 'maserati', '마세라티', 'bentley', '벤틀리', 'rolls', '롤스', 'ferrari', '페라리', 'lamborghini', '람보르기니',
  'tesla', '테슬라', 'lincoln', '링컨', 'toyota', '토요타', 'honda', '혼다', 'nissan', '닛산',
  'infiniti', '인피니티', 'jeep', '지프', 'chrysler', '크라이슬러', 'ford', '포드', 'cadillac', '캐딜락',
  'polestar', '폴스타', 'citroen', '시트로엥', 'fiat', '피아트', 'alfa romeo', '알파로메오',
  'dodge', '닷지', 'gmc', 'ram',
] as const;

export function isImportBrand(name: string): boolean {
  const normalized = String(name || '').toLowerCase();
  return IMPORT_BRANDS.some((brand) => normalized.includes(brand));
}
