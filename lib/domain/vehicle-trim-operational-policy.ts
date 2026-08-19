import type { VehicleTrimMasterRecord } from './vehicle-trim-master';

const S = (value: unknown) => String(value ?? '').trim();
const normalized = (value: unknown) => S(value).replace(/\s+/g, ' ').toLowerCase();

const OFFICIAL_HOSTS: Record<string, readonly string[]> = {
  '현대': ['hyundai.com'],
  '기아': ['kia.com', 'hyundaimotorgroup.com'],
  '제네시스': ['genesis.com'],
  'KG모빌리티': ['kg-mobility.com'],
  '쉐보레': ['chevrolet.co.kr'],
  '르노코리아': ['renault.co.kr'],
  'BMW': ['bmw.co.kr', 'bmw.com', 'bmw.com.au', 'bmwgroup.com'],
  '벤츠': ['mercedes-benz.co.kr', 'mercedes-benz-publicarchive.com', 'media.mercedes-benz.com'],
  '아우디': ['audi.co.kr'],
  '미니': ['mini.co.kr'],
  '포르쉐': ['porsche.com'],
  '폭스바겐': ['volkswagen.co.kr'],
  '볼보': ['volvocars.com'],
  '포드': ['ford.co.kr'],
  '지프': ['jeep.co.kr', 'jeep.com'],
  '시트로엥/DS': ['stellantis.com', 'citroen.com'],
  '캐딜락': ['cadillac.co.kr'],
  '르노': ['renault.com'],
  '도요타': ['toyota.co.kr'],
  '렉서스': ['lexus.co.kr'],
  '푸조': ['peugeot.co.kr', 'epeugeot.co.kr', 'stellantis.com'],
  '혼다': ['hondakorea.co.kr'],
  '폴스타': ['polestar.com'],
  '테슬라': ['tesla.com'],
  'BYD': ['bydauto.kr'],
  '지커': ['zeekrlife.com'],
};

const isBatteryElectric = (record: VehicleTrimMasterRecord) =>
  normalized(record.fuel) === '전기'
  || /(?:^|\s)ev(?:\s|$)/i.test(record.powertrain);

const isHydrogenElectric = (record: VehicleTrimMasterRecord) =>
  normalized(record.fuel) === '수소'
  || /수소전기/i.test(record.powertrain);

const hasDocumentedUndisclosedBattery = (record: VehicleTrimMasterRecord) =>
  ['테슬라', 'BMW'].includes(record.maker)
  && /공식/.test(record.evidence_note)
  && /(미공개|명시하지 않)/.test(record.evidence_note)
  && /공란/.test(record.evidence_note);

const hasCommercialGenerationIdentity = (record: VehicleTrimMasterRecord) =>
  record.maker === '테슬라'
  || (record.maker === 'BMW' && ['i4', 'iX'].includes(record.model))
  || (record.maker === '아우디' && isBatteryElectric(record))
  || new Set([
    '렉서스|ES', '렉서스|LS', '렉서스|NX', '렉서스|UX',
    '미니|에이스맨', '미니|쿠퍼 컨버터블',
    '볼보|EX30', '볼보|V60', '볼보|V90', '볼보|XC40', '볼보|XC90',
    '쉐보레|콜로라도', '제네시스|GV60', '지프|어벤저',
    '포드|머스탱', '포드|익스페디션',
    '푸조|2008', '푸조|3008', '푸조|308', '푸조|408',
    '혼다|오딧세이', 'KG모빌리티|액티언',
  ]).has(`${record.maker}|${record.model}`);

// These legacy groups were reviewed against the manufacturer evidence already stored on each row.
// Their immutable sub_model value is the generation identity; do not mutate N/O on an issued key.
const REVIEWED_LEGACY_GENERATION_IDENTITIES = new Set([
  '렉서스|ES|뉴 ES300h', '렉서스|ES|뉴 ES350',
  '렉서스|LS|LS460', '렉서스|LS|LS460L', '렉서스|LS|LS600hL', '렉서스|UX|UX250h',
  '르노|탈리스만|탈리스만', '르노코리아|XM3|XM3',
  '벤츠|SLK-클래스|뉴 SLK-클래스',
  '볼보|C40|C40 리차지', '볼보|S60|S60 3세대', '볼보|S60|S60 크로스컨트리',
  '볼보|S90|S90', '볼보|V40|V40 크로스컨트리', '볼보|V60|V60 크로스컨트리 2세대',
  '볼보|V90|V90 크로스컨트리', '볼보|XC40|XC40', '볼보|XC40|XC40 리차지',
  '볼보|XC90|XC90 2세대',
  '쉐보레|아베오|더 뉴 아베오 세단', '쉐보레|아베오|더 뉴 아베오 해치백',
  '쉐보레|이쿼녹스|더 넥스트 이쿼녹스', '쉐보레|이쿼녹스|이쿼녹스',
  '쉐보레|임팔라|임팔라', '쉐보레|캡티바|캡티바',
  '쉐보레|콜로라도|리얼 뉴 콜로라도', '쉐보레|콜로라도|콜로라도',
  '쉐보레|트래버스|트래버스',
  '시트로엥/DS|C4 피카소|그랜드 C4 피카소', '시트로엥/DS|C4 피카소|C4 피카소',
  '아우디|A5|A5', '아우디|A7|A7', '아우디|e-트론|e-트론',
  '아우디|e-트론 GT|e-트론 GT', '아우디|Q2|Q2', '아우디|Q5|Q5',
  '아우디|RS e-트론 GT|RS e-트론 GT', '제네시스|GV60|GV60 초기형',
  '지프|레니게이드|레니게이드', '지프|컴패스|컴패스 2세대',
  '테슬라|모델 3|모델 3', '테슬라|모델 S|모델 S', '테슬라|모델 X|모델 X', '테슬라|모델 Y|모델 Y',
  '포드|머스탱|머스탱',
  '푸조|2008|2008 2세대', '푸조|2008|e-2008 2세대',
  '푸조|3008|3008 2세대', '푸조|5008|5008 2세대',
  '현대|엑센트|엑센트(신형)',
  '혼다|어코드|올뉴어코드', '혼다|오딧세이|오딧세이',
  '혼다|파일럿|파일럿 3세대', '혼다|CR-V|New CR-V',
  'BMW|i4|i4', 'BMW|i8|i8', 'BMW|iX|iX', 'BMW|iX3|iX3',
  'KG모빌리티|코란도|더 뉴 코란도 스포츠',
]);

const hasReviewedLegacyGenerationIdentity = (record: VehicleTrimMasterRecord) =>
  REVIEWED_LEGACY_GENERATION_IDENTITIES.has(`${record.maker}|${record.model}|${record.sub_model}`);

const isCurrentNew = (record: VehicleTrimMasterRecord) =>
  record.market_status === '신차'
  && record.production_end === '현재'
  && record.model_year_end === '현재';

const isRecentUsed = (record: VehicleTrimMasterRecord) =>
  record.market_status === '중고차'
  && /^\d{4}-\d{2}$/.test(record.production_end)
  && Number(record.model_year_end) >= 2016;

export const automaticFiveKey = (record: VehicleTrimMasterRecord) =>
  [record.maker, record.model, record.sub_model, record.powertrain, record.trim]
    .map(normalized)
    .join('|');

export const automaticSpecKey = (record: VehicleTrimMasterRecord) =>
  [automaticFiveKey(record), record.drivetrain, record.seats, record.battery_kwh]
    .map(normalized)
    .join('|');

export function operationalPromotionFailures(record: VehicleTrimMasterRecord): string[] {
  const failures: string[] = [];
  if (record.management_status !== '검증중') failures.push('management');
  if (!['1차확인', '교차확인'].includes(record.verification_status)) failures.push('verification');
  const currentNew = isCurrentNew(record);
  const recentUsed = isRecentUsed(record);
  if (!currentNew && !recentUsed) failures.push('market_period');
  if (![record.trim_row_key, record.master_id, record.maker, record.model, record.sub_model,
    record.powertrain, record.trim, record.production_start, record.model_year_start,
    record.fuel, record.drivetrain, record.evidence_url, record.evidence_note, record.data_as_of]
    .every((value) => S(value))) failures.push('required_identity');
  if (!record.generation_name && !record.development_code
    && !(currentNew && hasCommercialGenerationIdentity(record))
    && !(recentUsed && hasReviewedLegacyGenerationIdentity(record))) failures.push('generation_or_code');
  if (!record.powertrain_seq || !record.trim_seq) failures.push('sequence');
  if (record.turbo === null || !record.seats) failures.push('required_spec');
  if (isBatteryElectric(record)) {
    const documentedBatteryException = hasDocumentedUndisclosedBattery(record)
      && (currentNew || (recentUsed && record.maker === '테슬라'));
    if (record.engine_cc !== null
      || (record.battery_kwh === null && !documentedBatteryException)) failures.push('electric_spec');
  } else if (!isHydrogenElectric(record) && record.engine_cc === null) {
    failures.push('engine_cc');
  }
  let host = '';
  try {
    const url = new URL(record.evidence_url);
    if (url.protocol !== 'https:') failures.push('https');
    host = url.hostname.toLowerCase();
  } catch {
    failures.push('evidence_url');
  }
  const allowed = OFFICIAL_HOSTS[record.maker] || [];
  if (!allowed.some((domain) => host === domain || host.endsWith(`.${domain}`))) failures.push('official_host');
  if (recentUsed && !/(공식|Korea|코리아)/i.test(record.evidence_note)) failures.push('official_note');
  if (!/^2026-08-(14|15|16)$/.test(record.data_as_of)) failures.push('data_as_of');
  return [...new Set(failures)];
}

export type OperationalPromotionPlan = {
  selected: VehicleTrimMasterRecord[];
  heldForAmbiguity: VehicleTrimMasterRecord[];
  rejected: VehicleTrimMasterRecord[];
  failureCounts: Record<string, number>;
};

export function planOperationalPromotions(records: VehicleTrimMasterRecord[]): OperationalPromotionPlan {
  const eligible: VehicleTrimMasterRecord[] = [];
  const rejected: VehicleTrimMasterRecord[] = [];
  const failureCounts: Record<string, number> = {};
  for (const record of records) {
    if (record.usage_tier !== 'manual') continue;
    const failures = operationalPromotionFailures(record);
    if (!failures.length) eligible.push(record);
    else {
      rejected.push(record);
      for (const failure of failures) failureCounts[failure] = (failureCounts[failure] || 0) + 1;
    }
  }

  const proposed = [...records.filter((record) => record.usage_tier === 'automatic'), ...eligible];
  const counts = new Map<string, number>();
  for (const record of proposed) {
    const key = automaticSpecKey(record);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const heldForAmbiguity = eligible.filter((record) => (counts.get(automaticSpecKey(record)) || 0) > 1);
  const heldKeys = new Set(heldForAmbiguity.map((record) => record.trim_row_key));
  const selected = eligible.filter((record) => !heldKeys.has(record.trim_row_key));
  return { selected, heldForAmbiguity, rejected, failureCounts };
}
