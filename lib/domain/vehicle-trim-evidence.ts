import { mostSpecificBoundedVehiclePhrases } from './vehicle-master-format';
import { canonMasterTrim } from './vehicle-master-match';

const S = (value: unknown) => String(value ?? '').trim();
const compact = (value: unknown) => S(value).normalize('NFKC').replace(/[\s·._()[\]/-]+/g, '').toLowerCase();

// 공급사마다 별도 트림 열을 비우고 차명 끝에 트림을 붙이는 경우가 많다.
// 후보 마스터에서 역추론하지 않고 실제 차명에 적힌 판매 트림만 읽는다.
const EXPLICIT_TRIM_TOKENS = [
  '프레스티지 스페셜', '프리미엄 초이스', '베스트 셀렉션', '스포츠 패키지', '노블레스 그래비티', '시그니처 그래비티',
  'Business 2', 'Business 1', 'Exclusive', 'Prestige', 'Premium', 'Smart', 'FLUX',
  '비즈니스 2', '비즈니스 1', '비지니스2', '비지니스1', '디자인플러스',
  '인스퍼레이션', '익스클루시브', '프리미엄 플러스', '프리미엄 패밀리',
  'M Sport Pack', 'M Sport Package', 'x라인 스페셜에디션', 'x라인 스페셜 에디션',
  '베스트 셀렉션 I', '베스트셀렉션Ⅰ', '아방가르드', 'GT Line', 'S line',
  'H-PICK', '노블레스', '시그니처', '프레스티지', '트렌디', '프리미엄',
  '모빌리티', '디 에센셜', '그래비티', '캘리그래피', '기본형', '스마트', '더 블랙',
  '모던', '에어', '어스', '런칭', '블랙', '트렌드', 'LT', 'LE', 'SLX',
] as const;

const bounded = (source: string, token: string) => new RegExp(
  `(?:^|[^0-9A-Za-z가-힣])${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|[^0-9A-Za-z가-힣])`,
  'i',
).test(source);

/** 후보를 보기 전에도 읽을 수 있는 공급사 명시 트림. */
export function explicitSupplierTrimSignal(value: unknown): string {
  const source = S(value);
  // A source label can contain both a base grade and its more specific derivative.
  // Prefer the longest explicit phrase regardless of declaration order.
  return [...EXPLICIT_TRIM_TOKENS]
    .sort((left, right) => compact(right).length - compact(left).length)
    .find((token) => bounded(source, token)) || '';
}

/** 후보 정본 트림 중 공급사 원문에 직접 적힌 가장 구체적인 완전명. */
export function explicitMasterTrimSignals(evidence: unknown, candidateTrims: unknown[]): string[] {
  return mostSpecificBoundedVehiclePhrases(evidence, candidateTrims);
}

export function canonicalVehicleTrimSignal(value: unknown): string {
  const normalized = compact(canonMasterTrim(value));
  const aliases: Record<string, string> = {
    exclusive: compact('익스클루시브'),
    prestige: compact('프레스티지'),
    business1: compact('비즈니스1'),
    business2: compact('비즈니스2'),
    비지니스1: compact('비즈니스1'),
    비지니스2: compact('비즈니스2'),
    기본: compact('기본형'),
    기본사양: compact('기본형'),
    msportpack: compact('M 스포츠'),
    msportpackage: compact('M 스포츠'),
    x라인스페셜에디션: compact('X라인'),
    black: compact('블랙에디션'),
    블랙: compact('블랙에디션'),
    더블랙: compact('블랙에디션'),
    트렌드: compact('트렌디'),
  };
  return aliases[normalized] || normalized;
}

/**
 * 명시 트림과 마스터 정본 트림을 비교한다. 인승·구동·렌터카처럼 별도 축으로
 * 관리되는 접미사만 떼며 `아방가르드`를 `아방가르드 리미티드`로 넓히지 않는다.
 */
export function vehicleTrimSignalMatches(
  signal: unknown,
  recordTrim: unknown,
  recordAliases: unknown[] = [],
): boolean {
  const wanted = canonicalVehicleTrimSignal(signal);
  if (!wanted) return true;
  const actual = canonicalVehicleTrimSignal(recordTrim);
  if (actual === wanted || actual.endsWith(wanted)) return true;
  const withoutAxisSuffix = actual.replace(/(?:(?:렌터?카|자가용|[0-9]+인승|2wd|4wd|awd|밴|승용))+$/i, '');
  if (withoutAxisSuffix === wanted || withoutAxisSuffix.endsWith(wanted)) return true;
  return recordAliases.some((alias) => {
    const normalized = canonicalVehicleTrimSignal(alias);
    if (/^(?:2wd|4wd|awd|fwd|rwd|xdrive|4matic|quattro|콰트로|[0-9]+인승)$/i.test(normalized)) return false;
    return normalized === wanted;
  });
}
