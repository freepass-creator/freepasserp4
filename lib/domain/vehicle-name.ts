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

/**
 * 이름의 «단».
 *   base  = 제조사 + **모델**만        「현대 그랜저」        ← 요약·머리에 쓴다
 *   short = 제조사 + 세부모델 + 트림   「현대 더 뉴 그랜저 IG 르블랑」
 *   full  = short + variant·부가       (제일 긴 것)
 *   raw   = 감사 증거(정규화 안 함)
 *
 * ★`base` 는 2026-09-05 에 더했다. 사장님 「요약으로 보여주는 데는 **그냥 현대, 그랜저**
 *   이렇게만 보여줘도 상관은 없어. 그리고 차량 정보에 좀 **디테일한 차명 세부 트림**이 들어가는 거고」.
 *   손님 상세가 머리(요약)와 차량 정보 첫 줄에서 **같은 이름을 두 번** 말하고 있어서 갈랐다.
 */
export type NameTier = 'base' | 'short' | 'full' | 'raw';

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

function text(value: unknown): string {
  return S(value).replace(/\s+/g, ' ');
}

function comparable(value: unknown): string {
  return text(value).toLocaleLowerCase('ko').replace(/[\s\-_/·.,()]+/g, '');
}

function containsPart(base: unknown, part: unknown): boolean {
  const baseKey = comparable(base);
  const partKey = comparable(part);
  return !!baseKey && !!partKey && baseKey.includes(partKey);
}

const FLEX_SEPARATOR = '[\\s\\-_/·.,()]*';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 공백·구두점 차이를 무시하고 이미 알려진 차명 조각을 blob에서 제거한다.
 *
 * ⚠ **영숫자 경계를 반드시 건다.** 경계 없이 지우면 배기량 토큰이 트림 코드를 파먹는다 —
 * `comparable('2.0')` 은 `'20'` 이고, 그게 `'420d'` 안의 `20` 에 부분일치해
 * `BMW 3시리즈 G20 2.0 디젤 420d` → `BMW 3시리즈 G20 디젤 4 d` 가 됐다(실측).
 * 그 문자열은 deal.ts 가 계약의 trim_name_snapshot·vehicle_name_snapshot 으로 **굽고**,
 * 손님 서명화면(app/sign/[token]/page.tsx)에 그대로 게시된 뒤 되돌릴 수단이 없다.
 *
 * 한글 쪽은 경계를 열어 둔다 — `기아자동차` 에서 `기아` 를 걷어내는 기존 동작이 유지돼야 한다.
 */
function removeKnownPhrases(valueRaw: unknown, phrases: unknown[]): string {
  let value = text(valueRaw);
  const keys = [...new Set(phrases.map(comparable).filter(Boolean))]
    .sort((a, b) => b.length - a.length);
  for (const key of keys) {
    const body = Array.from(key).map(escapeRegExp).join(FLEX_SEPARATOR);
    const pattern = `(?<![0-9A-Za-z])${body}(?![0-9A-Za-z])`;
    value = value.replace(new RegExp(pattern, 'giu'), ' ');
  }
  return text(value);
}

/** 제원 blob 간 부분 중복 제거용 토큰. `디젤 2.2` ↔ `2.2 노블레스`도 한 번만 남긴다. */
function phraseTokens(...values: unknown[]): string[] {
  return [...new Set(values
    .flatMap((value) => text(value).split(' '))
    .filter((value) => comparable(value).length >= 2))];
}

/**
 * 일부 v3 계약은 maker_snapshot 없이 완성명만 남았다. 현재 상품을 끌어오지 않고,
 * 저장된 완성명에서 저장된 차종이 처음 시작하기 전의 짧은 접두어만 제조사로 복원한다.
 */
function inferLeadingMaker(nameRaw: unknown, identityValues: unknown[]): string {
  const name = text(nameRaw);
  if (!name) return '';
  const generic = new Set(['더', '뉴', '올', '디', 'the', 'new', 'all']);
  const candidates = phraseTokens(...identityValues)
    .filter((value) => !generic.has(value.toLocaleLowerCase('ko')));
  let first = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const key = comparable(candidate);
    if (!key) continue;
    const pattern = Array.from(key).map(escapeRegExp).join(FLEX_SEPARATOR);
    const match = new RegExp(pattern, 'iu').exec(name);
    if (match && match.index > 0) first = Math.min(first, match.index);
  }
  if (!Number.isFinite(first)) return '';
  const parts = text(name.slice(0, first)).split(' ').filter(Boolean);
  while (parts.length && generic.has(parts[parts.length - 1].toLocaleLowerCase('ko'))) parts.pop();
  const maker = parts.join(' ').replace(/[\-_/·.,()]+$/g, '').trim();
  return parts.length <= 3 && maker.length <= 24 ? maker : '';
}

/** 완성명 blob을 걷어낸 뒤 가장자리에 남은 모델명 파편도 중복으로 제거한다. */
function removeIdentityEdges(valueRaw: unknown, identityRaw: unknown): string {
  const identity = comparable(identityRaw);
  const parts = text(valueRaw).split(' ').filter(Boolean);
  const isIdentityPart = (part: string) => {
    const key = comparable(part);
    return key.length >= 2 && identity.includes(key);
  };
  while (parts.length && isIdentityPart(parts[0])) parts.shift();
  while (parts.length && isIdentityPart(parts[parts.length - 1])) parts.pop();
  return parts.join(' ');
}

function residualText(valueRaw: unknown, phrases: unknown[], identityRaw: unknown): string {
  return removeIdentityEdges(removeKnownPhrases(valueRaw, phrases), identityRaw);
}

/** 제조사가 이미 들어간 레거시/구조화 차명에는 같은 제조사를 다시 붙이지 않는다. */
export function withVehicleMaker(makerRaw: unknown, nameRaw: unknown): string {
  const rawMaker = text(makerRaw);
  const maker = text(makerDisplay(rawMaker) || rawMaker);
  const name = text(nameRaw);
  if (!maker) return name;
  if (!name) return maker;
  return containsPart(name, maker) ? name : `${maker} ${name}`;
}

function appendUnique(baseRaw: unknown, valueRaw: unknown): string {
  const base = text(baseRaw);
  const value = text(valueRaw);
  if (!base) return value;
  if (!value || containsPart(base, value)) return base;
  return `${base} ${value}`;
}

/** 제조사만 있는 스냅샷은 차량 식별값이 아니므로 현재 상품/레거시명으로 보강한다. */
function snapshotUsable(c: EntityRecord): boolean {
  return !!(S(c.vehicle_name_snapshot) || S(c.sub_model_snapshot) || S(c.model_snapshot));
}

function partsOfRecord(p: EntityRecord, tier: NameTier, omitMaker: boolean): Omit<NameParts, 'origin'> {
  // 코드 없는 차의 사람 3축 결정 — 자동확정(_product_master_identity_authoritative)이 아닐 때만 표시에 쓴다.
  const review = (!p._product_master_identity_authoritative && p._review_identity
    && typeof p._review_identity === 'object')
    ? p._review_identity as EntityRecord
    : null;
  /**
   * ★**ERP 값이 이긴다 — 사람 결정은 «빈칸만» 채운다**(사장님 2026-08-23 「있는 걸 그대로 갖고 오는 거잖아」).
   *
   * ⚠ 전에는 `_review_identity` 가 **ERP 값을 덮었다.** 그래서 시트·ERP 는 「싼타페 MX5」인데
   *   화면만 「디 올 뉴 싼타페 MX5」로 나갔다(실측 2026-08-23: 39대 — 「쏘나타 디 엣지」▶「쏘나타 DN8 디 엣지」,
   *   「GV80 JX1 FL」▶「GV80 부분변경 JX1」도 같은 경로). 사장님이 「아직도 현대 디 올뉴 이렇게 나오는데」로
   *   짚으신 것이 이것이다 — 정제칸을 고쳐도 화면이 안 바뀌던 이유.
   *
   *   `_review_identity` 는 정제칸이 정본이 되기 전, 코드 없는 차를 사람이 3축으로 정하던 자리다.
   *   지금은 정제칸 ▶ 판매시트 ▶ ERP 가 그 역할을 하므로 **ERP 에 값이 있으면 그것이 이름**이고,
   *   ERP 가 빈 축만 옛 결정으로 메운다(이름이 없는 것보다는 낫다).
   */
  const display = review
    ? {
      ...p,
      maker: S(p.maker) || S(review.maker),
      model: S(p.model) || S(review.model),
      sub_model: S(p.sub_model) || S(review.sub_model),
      trim_name: S(p.trim_name) || S(review.trim_name),
    }
    : p;
  const rawMaker = S(display.maker);
  const maker = tier === 'raw' ? rawMaker : (makerDisplay(rawMaker) || rawMaker);
  const model = S(display.model);
  const sub = S(display.sub_model);
  const trim = trimOf(display.trim_name);
  const plate = S(p.car_number) || S(p.car_number_snapshot);

  // T3는 감사 증거다. 정규화·제조사 중복 제거·필드 간 중복 제거를 하지 않는다.
  if (tier === 'raw') {
    return {
      maker: omitMaker ? '' : rawMaker,
      main: [model, sub, S(p.vehicle_name)].filter(Boolean).join(' '),
      ext: [S(p.variant), trim].filter(Boolean).join(' '),
      plate,
    };
  }

  const makerAliases = [rawMaker, maker];
  /**
   * ★★**이름 = 세부모델 + 세부트림**(사장님 2026-08-23 「보여 달라고 할 때 모델명=아반떼 ·
   *   세부모델=아반떼 CN7 · 세부모델+세부트림=아반떼 CN7 인스퍼레이션 · 요청하는 대로 거기에 노출해 줘야 해」).
   *
   *   ⚠ **공급사 원문(`supplier_vehicle_name`)을 이름으로 쓰지 마라.** 2026-08-20 에 그렇게 정했었는데
   *     (그때는 우리가 조립한 이름이 틀렸다 — 아반떼MD 를 「더 뉴 아반떼 CN7 스마트」로 불렀다),
   *     그 뒤 **정제칸이 정본**이 되면서 전제가 바뀌었다. 원문을 이름으로 쓰면 엔진·구동·인승·판매문구가
   *     이름에 섞여 나온다 — 실측 2026-08-23:
   *       「HEV 그랜저 GN7 런칭 자가용 하이브리드 1.6T 2WD 익스클루시브」
   *       「더 뉴싼타페 가솔린 2.5 터보 2WD 5인승 프리미엄 초이스」
   *     연식·연료·배기량·구동·인승은 **원자로 따로 갖고 있다가 있는 것만 골라 쓴다**(사장님 같은 날).
   *     이름에 섞으면 같은 값이 두 번 나오고, 차마다 이름 길이가 제각각이 된다.
   *
   *   공급사 원문은 **상세 「기타」에 참고용**으로 따로 선다(「2중 보관」) — 버리는 게 아니라 자리를 옮긴 것이다.
   *   정제칸이 통째로 빈 차만 마지막 수단으로 원문을 쓴다(이름이 없는 것보다는 낫다).
   */
  /*
   * ★`base` 는 **모델**을 먼저 본다(그 밖의 단은 세부모델이 먼저다).
   *   「그랜저」가 있으면 그걸 쓰고, 모델칸이 빈 차만 세부모델로 떨어진다 —
   *   이름이 아예 없는 것보다는 세부모델이라도 있는 게 낫다.
   */
  const rawMain = tier === 'base'
    ? text(model || sub || S((display as Record<string, unknown>).supplier_vehicle_name))
    : text(sub || model || S((display as Record<string, unknown>).supplier_vehicle_name));
  let main = removeKnownPhrases(rawMain, makerAliases);
  // 실데이터: maker=테슬라, 차종 공란, variant=EV RWD, trim="테슬라 모델Y RWD".
  // 제조사가 들어간 완성형 trim에 한해서만 제원 토큰을 걷어 모델명을 복원한다.
  if (!main && makerAliases.some((alias) => alias && containsPart(trim, alias))) {
    const inferred = removeKnownPhrases(
      removeKnownPhrases(trim, makerAliases),
      phraseTokens(p.variant, p.trim_extra),
    );
    if (inferred) main = inferred;
  }
  const identity = [maker, main].filter(Boolean).join(' ');
  const variant = residualText(p.variant, makerAliases.concat(main), identity);
  const variantTokens = phraseTokens(p.variant);
  // short는 트림 원문 안의 제원 표기도 보존하고, full에서만 별도 variant와 겹치는 조각을 걷는다.
  const shortTrim = residualText(trim, makerAliases.concat(main), identity);
  const fullTrim = residualText(trim, [...makerAliases, main, p.variant, ...variantTokens], identity);
  const cleanTrim = tier === 'short' ? shortTrim : fullTrim;
  const extra = residualText(
    p.trim_extra,
    [...makerAliases, main, p.variant, ...variantTokens, trim, ...phraseTokens(trim)],
    identity,
  );

  let ext = '';
  if (tier === 'base') {
    /* 「현대 그랜저」에서 끝낸다 — 트림·variant·부가는 한 조각도 안 붙인다. */
    ext = '';
  } else if (tier === 'short') {
    ext = cleanTrim;
  } else {
    ext = appendUnique(ext, variant);
    ext = appendUnique(ext, cleanTrim);
    ext = appendUnique(ext, extra);
  }

  const legacy = text(p.vehicle_name);
  if (legacy) {
    if (!main) {
      // 구조화 차종이 전혀 없는 레거시 행은 완성명을 유일한 정본으로 보존한다.
      const legacyMain = removeKnownPhrases(legacy, makerAliases);
      return {
        maker: omitMaker ? '' : maker,
        main: legacyMain,
        ext,
        plate,
      };
    }

    // 구조화 snapshot을 뼈대로 쓰고 레거시 완성명에서는 아직 없는 제원·트림만 보강한다.
    const legacyExtra = residualText(
      legacy,
      [
        ...makerAliases, model, sub, main,
        p.variant, ...phraseTokens(p.variant),
        trim, ...phraseTokens(trim),
        p.trim_extra, ...phraseTokens(p.trim_extra),
      ],
      identity,
    );
    if (tier !== 'base' && (tier === 'full' || !cleanTrim)) ext = appendUnique(ext, legacyExtra);
  }

  return {
    maker: omitMaker ? '' : maker,
    main,
    ext,
    plate,
  };
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
      const snapshotName = S(c.vehicle_name_snapshot);
      const snapshotOrContainedLive = (snapshotValue: unknown, liveValue: unknown): string => {
        const stored = S(snapshotValue);
        if (stored) return stored;
        const live = S(liveValue);
        return live && containsPart(snapshotName, live) ? live : '';
      };
      const contractModel = c.model_snapshot || c.model;
      const contractSubModel = c.sub_model_snapshot || c.sub_model;
      const shaped: EntityRecord = {
        // 계약 자체의 v3 필드도 계약 당시 값이다. 그것마저 없을 때만 완성명 접두어/연결 상품을 쓴다.
        maker: c.maker_snapshot || c.maker
          || inferLeadingMaker(snapshotName, [contractModel, contractSubModel])
          || src.product?.maker,
        model: contractModel, sub_model: contractSubModel,
        // 레거시 완성명 안에 실제로 존재하는 라이브 조각만 구조 복원 힌트로 쓴다.
        // 현재 상품의 새 값을 snapshot에 새로 보태지는 않는다.
        variant: snapshotOrContainedLive(c.variant_snapshot || c.variant, src.product?.variant),
        trim_name: snapshotOrContainedLive(c.trim_name_snapshot || c.trim_name, src.product?.trim_name),
        trim_extra: snapshotOrContainedLive(c.trim_extra_snapshot || c.trim_extra, src.product?.trim_extra),
        vehicle_name: snapshotName,
        car_number: c.car_number_snapshot || src.product?.car_number,
      };
      return { ...partsOfRecord(shaped, tier, omitMaker), origin: 'snapshot' };
    }
    // 일부 레거시 계약은 *_snapshot 없이 계약 자체의 완성 차명만 보존한다.
    if (S(c.vehicle_name)) {
      const legacy: EntityRecord = {
        maker: c.maker_snapshot || c.maker
          || inferLeadingMaker(c.vehicle_name, [c.model, c.sub_model])
          || src.product?.maker,
        model: c.model,
        sub_model: c.sub_model,
        variant: c.variant,
        trim_name: c.trim_name,
        trim_extra: c.trim_extra,
        vehicle_name: c.vehicle_name,
        car_number: c.car_number_snapshot || src.product?.car_number,
      };
      return { ...partsOfRecord(legacy, tier, omitMaker), origin: 'snapshot' };
    }
    // 스냅샷 결손(레거시 계약) → 매물로 보강.
    if (src.product) {
      const live = partsOfRecord(src.product, tier, omitMaker);
      return { ...live, plate: S(c.car_number_snapshot) || live.plate, origin: 'live' };
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
