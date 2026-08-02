/**
 * 차명 표기 SSOT — 화면에 찍히는 차 이름은 **전부 여기를 거친다.**
 *
 * 왜 만들었나(2026-08 감사): 차명을 만드는 코드가 12군데로 갈라져 있었고, 그래서
 * 같은 차가 화면마다 다르게 보였다. 재고 상세 한 화면 안에서만 4번 나오는데 매번 규격이 달랐다 —
 * 목록·앱바는 제조사를 붙이고(`기아 쏘렌토 프레스티지`), 바로 아래 마스터 피커 요약줄은 빼고
 * (`마스터 · 쏘렌토 MQ4 · 2.2 디젤`), 그 아래 차종변환 줄은 모델을 두 번 붙였다
 * (`기아자동차 쏘렌토 쏘렌토 MQ4 2.2 디젤 프레스티지`). 사용자가 본 "양식이 다르다"가 이것이다.
 *
 * 실패했던 전제: **"차명 = 문자열 하나"**. 실제로는 폭·맥락에 따라 등급이 셋이다.
 *
 *   T1 short  제조사 + (세부모델‖모델) + 트림              목록·칩·앱바·정렬키
 *   T2 full   T1 + 파워트레인 + 추가표기                   상세·계약·서명·공유·문서
 *   T3 raw    원문 그대로(정규화·중복제거 없음)            검수 트레이스·감사로그 **전용**
 *
 * T1 에 트림을 남긴 건 의도적이다. 오늘 재고·계약 목록이 쓰는 표기가 정확히 이 모양이라,
 * 빼면 "불일치를 고친다"면서 멀쩡히 보이던 트림이 조용히 사라진다. 등급 도입은 표기를 통일하는
 * 작업이지 정보를 줄이는 작업이 아니다.
 *
 * 불변식:
 *  · T3 만 model 과 sub_model 을 **둘 다** 붙인다(증거 보존이 목적). T1/T2 는 `sub_model ‖ model` 하나.
 *  · 구분자는 **공백 1칸 고정.** ` · ` 는 KV·표의 필드 구분자이지 차명 내부 구분자가 아니다.
 *  · isNoTrimLabel 필터는 전 등급 항상 적용('없음'·'(세부등급없음)'이 제목에 찍히던 것 차단).
 *  · makerDisplay 는 T1/T2 항상 적용, T3 절대 미적용(원문이 증거다).
 *
 * 제조사 생략(omitMaker)은 **폭이 좁아서가 아니라 상위 UI 가 제조사를 이미 확정한 자리**에서만.
 * 좁은 화면은 제조사를 지우는 게 아니라 **등급을 T1 로 낮춰서** 푼다 —
 * 예전엔 모바일 파인더가 제조사 토큰 자체를 빼서, 폰에서는 제조사가 구조적으로 절대 안 보이고
 * 같은 차가 손님 카탈로그(데스크톱 경로)에서는 제조사와 함께 보였다.
 */
import { type EntityRecord } from '@/lib/intake/entities';
import { makerDisplay } from '@/lib/domain/vehicle-master-format';
import { isNoTrimLabel } from '@/lib/domain/vehicle-master-options';

export type NameTier = 'short' | 'full' | 'raw';

/** 빈 차명일 때 무엇으로 대신할지. 표·KV 자리는 'dash' 를 **명시적으로** 고른다(암묵 분기 금지). */
export type NameFallback = 'plate' | 'dash' | 'none';

export type NameSource =
  | { kind: 'product'; product: EntityRecord | null | undefined }
  | { kind: 'contract'; contract: EntityRecord | null | undefined; product?: EntityRecord | null }
  | { kind: 'raw'; raw: EntityRecord | null | undefined };

export type NameOptions = {
  tier?: NameTier;          // 기본 'short'
  omitMaker?: boolean;      // 부모가 제조사를 확정한 자리에서만 true
  fallback?: NameFallback;  // 기본 'plate'
};

export type NameParts = {
  maker: string;   // 표시용. omitMaker 면 ''
  main: string;    // sub_model ‖ model  (raw 면 model + sub_model)
  ext: string;     // 파워트레인 + 트림 + 추가표기 (full·raw 에서만)
  plate: string;
  /** 어디서 나온 이름인가 — 계약 화면이 "현재 매물" 보조줄을 붙일지 판단하는 근거 */
  origin: 'live' | 'snapshot' | 'raw' | 'none';
};

const S = (v: unknown): string => String(v ?? '').trim();
const trimOf = (v: unknown): string => (isNoTrimLabel(v) ? '' : S(v));

/** 계약 스냅샷이 쓸 만한가 — 제조사·세부모델이 **둘 다** 비면 결손으로 본다. */
function snapshotUsable(c: EntityRecord): boolean {
  return !!(S(c.maker_snapshot) || S(c.sub_model_snapshot));
}

function partsOfRecord(p: EntityRecord, tier: NameTier, omitMaker: boolean): Omit<NameParts, 'origin'> {
  const rawMaker = S(p.maker);
  const maker = omitMaker ? '' : (tier === 'raw' ? rawMaker : (makerDisplay(rawMaker) || rawMaker));
  const model = S(p.model);
  const sub = S(p.sub_model);
  // T3 만 둘 다. T1/T2 는 세부모델이 있으면 그것만(모델 중복 방지).
  const main = tier === 'raw' ? [model, sub].filter(Boolean).join(' ') : (sub || model);
  const trim = trimOf(p.trim_name);
  const ext = tier === 'short'
    ? trim                                   // T1 = 오늘의 목록 표기 그대로(트림까지)
    : tier === 'full'
      ? [S(p.variant), trim, S(p.trim_extra)].filter(Boolean).join(' ')
      : [S(p.variant), trim].filter(Boolean).join(' ');   // raw = 증거, 추가표기는 별도 줄
  return { maker, main, ext, plate: S(p.car_number) || S(p.car_number_snapshot) };
}

/** 2줄·2색 렌더가 필요한 자리(카드 제목+회색 보조, 상세 h1+span)용 분해형. */
export function vehicleNameParts(src: NameSource, opt: NameOptions = {}): NameParts {
  const tier = opt.tier ?? 'short';
  const omitMaker = !!opt.omitMaker;

  if (src.kind === 'raw') {
    const r = src.raw;
    if (!r) return { maker: '', main: '', ext: '', plate: '', origin: 'none' };
    return { ...partsOfRecord(r, 'raw', omitMaker), origin: 'raw' };
  }

  if (src.kind === 'contract') {
    const c = src.contract;
    if (!c) return { maker: '', main: '', ext: '', plate: '', origin: 'none' };
    // **스냅샷이 정본.** 매물 이름은 계약 뒤에도 바뀐다(차종 재매칭이 maker·model·sub_model 을
    //  마스터 문자열로 갈아친다). 라이브를 보여주면 계약서와 화면이 어긋난다.
    if (snapshotUsable(c)) {
      const shaped: EntityRecord = {
        maker: c.maker_snapshot, model: c.model_snapshot, sub_model: c.sub_model_snapshot,
        variant: c.variant_snapshot, trim_name: c.trim_name_snapshot, trim_extra: c.trim_extra_snapshot,
        car_number: c.car_number_snapshot,
      };
      return { ...partsOfRecord(shaped, tier, omitMaker), origin: 'snapshot' };
    }
    // 스냅샷 결손(레거시 계약) → 매물로 보강.
    if (src.product) {
      const live = partsOfRecord(src.product, tier, omitMaker);
      return { ...live, plate: live.plate || S(c.car_number_snapshot), origin: 'live' };
    }
    return { maker: '', main: '', ext: '', plate: S(c.car_number_snapshot), origin: 'none' };
  }

  const p = src.product;
  if (!p) return { maker: '', main: '', ext: '', plate: '', origin: 'none' };
  return { ...partsOfRecord(p, tier, omitMaker), origin: 'live' };
}

function applyFallback(name: string, plate: string, fallback: NameFallback, code: string): string {
  if (name) return name;
  if (fallback === 'none') return '';
  if (fallback === 'dash') return '—';
  // 폴백 하나로 통일 — 예전엔 '차량'·'상품'·'—'·'-'·'[]'·'계약' 6종이 난립했다.
  return plate || code || '미등록 차량';
}

/** 화면에 찍는 차명 SSOT. 한 줄 문자열. */
export function vehicleNameOf(src: NameSource, opt: NameOptions = {}): string {
  const parts = vehicleNameParts(src, opt);
  const name = [parts.maker, parts.main, parts.ext].filter(Boolean).join(' ');
  const rec = src.kind === 'product' ? src.product : src.kind === 'raw' ? src.raw : src.contract;
  const code = S(rec?.product_code) || S(rec?.contract_code);
  return applyFallback(name, parts.plate, opt.fallback ?? 'plate', code);
}

/** 표·엑셀의 분리 열용 — 조립하지 않고 열 단위 표시값만 정규화한다. */
export function vehicleNameColumns(p: EntityRecord): {
  maker: string; model: string; sub_model: string; variant: string; trim_name: string;
} {
  const rawMaker = S(p.maker);
  return {
    maker: makerDisplay(rawMaker) || rawMaker,
    model: S(p.model),
    sub_model: S(p.sub_model),
    variant: S(p.variant),
    trim_name: trimOf(p.trim_name),
  };
}
