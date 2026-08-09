import { isHandledMaker } from '@/lib/domain/handled-makers';
import type { EntityRecord } from '@/lib/intake/entities';
import {
  FUEL_ALIAS,
  fuelDisplay,
  fuelEmbeddedCc,
  parseYear,
} from '@/lib/domain/vehicle-master-format';
import { vehicleSignalBlob } from '@/lib/domain/vehicle-master-signals';
import { sourcesFor } from '@/lib/domain/vehicle-match-sources';
import { isNoTrimLabel, realMasterTrims } from '@/lib/domain/vehicle-master-options';
import type { MasterEntry } from '@/lib/domain/vehicle-master-types';

export type VehicleNormalizeDeps = {
  norm: (value: unknown) => string;
  carYear: (product: EntityRecord) => number;
  seatsFromBlob: (blob: string) => number;
  normDrive: (value: unknown) => string;
  driveFromBlob: (blob: string) => string;
  makerGroup: (maker: string) => string[];
  looksCompoundVehicleText: (value: unknown) => boolean;
  canonMasterTrim: (value: unknown, pool?: string[] | null) => string;
  modelAlias: Record<string, string>;
};

function yearFromBlob(blob: string): number {
  const match =
    /(\d{2,4})\s*년\s*식/.exec(blob) ||
    /(20\d{2}|\d{2})\s*년(?!\s*식)/.exec(blob) ||
    // 「25MY」= 2025년식. 공급사 시트가 모델연도를 이 꼴로 적는다(빌린카·우리캐피탈·웰릭스).
    // 아래 4자리 패턴보다 **먼저** 봐야 한다 — 「25MY … 2.0(렌트)」에서 엉뚱한 숫자를 집지 않게.
    /(\d{2})\s*MY\b/i.exec(blob) ||
    /\b(20\d{2})\b/.exec(blob);
  return match ? parseYear(match[1]) : 0;
}

function ccFromBlob(blob: string): number {
  const liter = /(?:^|[^\d])(\d\.\d)\s*(?:l|L|리터)?(?=$|[^\d])/.exec(blob);
  if (liter) {
    const number = Number(liter[1]);
    if (number >= 0.6 && number <= 8) return Math.round(number * 1000);
  }
  const cc = /(?:^|[^\d])([1-7]\d{3})\s*(?:cc|CC)?(?=$|[^\d.])/.exec(blob);
  if (cc) {
    const number = Number(cc[1]);
    if (number >= 600 && number <= 8000 && !(number >= 1990 && number <= 2099)) return number;
  }
  return 0;
}

export function unpackVehicleSignalsEngine(
  product: EntityRecord,
  entries: MasterEntry[],
  deps: VehicleNormalizeDeps,
): EntityRecord {
  if (!entries.length) return product;
  const out: EntityRecord = { ...product };
  const blob = vehicleSignalBlob(out);
  if (!blob.trim()) return out;
  const normalizedBlob = deps.norm(blob.replace(/트랜디/g, '트렌디'));

  /**
   * 연식은 **여기서 `out.year` 에 못 박아야 한다.**
   *
   * 아래에서 `trim_name` 을 마스터 트림(「인스퍼레이션」)으로 덮어쓰는데, 원문의 연식 표기가
   * 거기 섞여 있으면 그 순간 신호가 사라진다. 그러면 세대 선택이 연식을 못 써서
   * 「더뉴아반떼 25MY」가 **MD(2013~2015)** 로 붙는다 — 실제는 CN7 이다(실측 2026-08-09).
   *
   * 옛 코드는 else 갈래에서 `yearFromBlob(String(out.year))` 을 봤는데, `out.year` 가 비어 있으면
   * 문자열 "undefined" 를 뒤지는 셈이라 아무것도 못 찾았다. 블롭을 봐야 한다.
   */
  {
    const year = parseYear(out.year) || yearFromBlob(blob);
    if (year) out.year = String(year);
  }

  {
    const rawCc = String(out.engine_cc ?? '').trim();
    const number = Number(rawCc.replace(/,/g, ''));
    let cc = 0;
    if (Number.isFinite(number) && number > 0) {
      if (number >= 0.6 && number <= 8) cc = Math.round(number * 1000);
      else if (number >= 600 && number <= 8000) cc = Math.round(number);
    }
    if (!cc) cc = fuelEmbeddedCc(out.fuel_type) || ccFromBlob(blob);
    if (cc) out.engine_cc = String(cc);
  }

  if (!(Number(out.seats) > 0)) {
    const seats = deps.seatsFromBlob(blob);
    if (seats) out.seats = String(seats);
  }
  if (!deps.normDrive(out.drive_type)) {
    const drive = deps.driveFromBlob(blob);
    if (drive) out.drive_type = drive;
  } else {
    out.drive_type = deps.normDrive(out.drive_type) || out.drive_type;
  }

  if (!fuelDisplay(out.fuel_type)) {
    for (const key of Object.keys(FUEL_ALIAS)) {
      if (!normalizedBlob.includes(key)) continue;
      const display = fuelDisplay(FUEL_ALIAS[key]);
      if (display) {
        out.fuel_type = display;
        break;
      }
    }
  }

  const catalog = String(out.catalog_id || out.type_number || '').trim().toUpperCase();
  if (catalog) {
    let candidates = entries.filter((entry) => String(entry.gen_code || '').trim().toUpperCase() === catalog);
    const maker = String(out.maker || '').trim();
    if (maker) {
      const makerGroup = deps.makerGroup(deps.norm(maker));
      candidates = candidates.filter((entry) => makerGroup.some((group) => {
        const entryMaker = deps.norm(entry.maker);
        return entryMaker === group || entryMaker.includes(group) || group.includes(entryMaker);
      }));
    }
    const model = String(out.model || '').trim();
    if (model && !deps.looksCompoundVehicleText(model)) {
      candidates = candidates.filter((entry) => deps.norm(entry.model) === deps.norm(model) || deps.norm(model).includes(deps.norm(entry.model)));
    }
    if (candidates.length === 1) {
      const hit = candidates[0];
      if (!String(out.sub_model ?? '').trim()) out.sub_model = hit.sub_model;
      if (!String(out.model ?? '').trim()) out.model = hit.model;
      if (!maker) out.maker = hit.maker;
    } else if (candidates.length > 1) {
      const models = new Set(candidates.map((entry) => entry.model));
      const makers = new Set(candidates.map((entry) => entry.maker));
      if (models.size === 1 && !String(out.model ?? '').trim()) out.model = candidates[0].model;
      if (makers.size === 1 && !maker) out.maker = candidates[0].maker;
    }
  }

  // 근거 칸은 `vehicle-match-sources.ts` 가 정한다 — 여기서 임의로 늘리지 말 것.
  const modelProbe = deps.norm(sourcesFor('model').evidence
    .map((f) => String((out as Record<string, unknown>)[f] ?? '').trim())
    .filter(Boolean).join(' '));
  /**
   * 띄어쓰기를 살린 원문 — 짧은 모델명의 «단어 경계»를 보려면 필요하다.
   * `norm` 은 공백을 지우므로 여기서는 소문자화만 한다. 근거 칸은 위와 같다.
   */
  const modelProbeSpaced = sourcesFor('model').evidence
    .map((f) => String((out as Record<string, unknown>)[f] ?? '').trim())
    .filter(Boolean).join(' ').toLowerCase();

  /**
   * 「S3」·「A3」처럼 짧은 영숫자 모델명은 **부분일치로 찾으면 안 된다.**
   * 실측(2026-08-07): 벤츠 S클래스 행의 트림 「S350 d 4매틱」 안에 든 「S3」가 걸려
   * 아우디 S3/A3 로 붙었다. 트림·옵션 글에는 배기량·등급 코드가 널려 있어 반드시 오탐이 난다.
   * 그래서 짧은 이름은 앞뒤가 영숫자가 아닐 때(=한 낱말일 때)만 인정한다.
   */
  const shortAlnum = (value: string) => /^[a-z]{0,3}\d{1,3}[a-z]?$/.test(value) || value.length <= 3;
  const hitsShortModel = (normalizedModel: string) => {
    const escaped = normalizedModel.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');
    return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`).test(modelProbeSpaced);
  };

  /**
   * 후보 모델명은 **우리가 취급하는 브랜드**로 좁힌다. 마스터는 74개 브랜드짜리 사전이라
   * 그대로 쓰면 짧은 이름이 안 다루는 차에 걸린다(「어드밴티지」 안의 「밴티지」 → 애스턴마틴).
   * 좁힌 목록에서 아무것도 못 찾으면 아래에서 전체로 되돌아간다 — 막는 게 아니라 뒤로 미루는 것이다.
   */
  const handledModels = [...new Set(entries.filter((entry) => isHandledMaker(entry.maker)).map((entry) => entry.model))]
    .sort((a, b) => b.length - a.length);
  const allModels = [...new Set(entries.map((entry) => entry.model))].sort((a, b) => b.length - a.length);
  const models = handledModels.length ? handledModels : allModels;
  /** 브랜드 이름 자체(제네시스·미니·테슬라)는 모델명으로도 마스터에 있다. 그 구분에 쓴다. */
  const makerNames = new Set(entries.map((entry) => deps.norm(entry.maker)).filter(Boolean));
  const findHit = (pool: string[]): string => {
    const hits: string[] = [];
    for (const model of pool) {
      const normalizedModel = deps.norm(model);
      if (normalizedModel.length < 2) continue;
      const hit = shortAlnum(normalizedModel)
        ? hitsShortModel(normalizedModel)
        : modelProbe.includes(normalizedModel);
      if (hit) hits.push(model);
    }
    if (!hits.length) return '';
    /**
     * 브랜드 이름이 모델명으로도 있으면 «구체적인 쪽»을 고른다.
     * 「제네시스 G80 RG3」은 제조사 「제네시스」와 현대의 옛 모델 「제네시스」에 둘 다 걸리는데,
     * 목록이 긴 이름 우선이라 옛 모델이 먼저 잡혀 G80 이 통째로 무시됐다(실측 2026-08-08).
     */
    return hits.find((model) => !makerNames.has(deps.norm(model))) || hits[0];
  };

  let hitModel = '';
  if (modelProbe) {
    hitModel = findHit(models);
    if (!hitModel) {
      /**
       * 수입차 «숫자 이름» 구제 — 520i·120i·420d·E200·C300 처럼 실제로 쓰이는 표기는
       * 마스터 모델명(5시리즈·E-클래스)에 문자열로 닿지 않는다. 그러면 매처가 브랜드를 잃고
       * 엉뚱한 데로 샌다 — 실측(2026-08-08): 「BMW 120i」→인피니티 I30 · 「E200」→크라이슬러 200 ·
       * 「BMW 520i」→인피니티 M35. 손님 화면에 다른 차가 뜨는 사고다.
       *
       * ⚠ 브랜드 신호가 있을 때만 적용한다. 숫자 표기는 트림·배기량 글에도 널려 있어
       *   무조건 걸면 국산차가 수입차로 끌려간다.
       */
      const brandBlob = `${modelProbeSpaced} ${String(out.maker ?? '')}`.toLowerCase();
      const isBmw = /bmw|비엠|베엠/.test(brandBlob);
      // 브랜드 단어가 없어도 「E200·C300·S350·A180」은 그 자체로 벤츠 표기다 —
      // 맨 앞에 한 글자+세 자리로 서는 이름은 다른 브랜드에 거의 없다. 실측: 「E200 아방가르드」가
      // 크라이슬러 200 으로 붙고 있었다. 문장 «맨 앞»일 때만 인정해 오탐을 막는다.
      const benzToken = /^(?:the\s+)?[acegs]\s?\d{3}(?:\s|$|[a-z])/i.test(modelProbeSpaced.trim());
      const isBenz = /벤츠|메르세데스|benz|mercedes/.test(brandBlob) || benzToken;
      let importAlias = '';
      if (isBmw) {
        // 520i·320d·M340i → N시리즈. X·Z 계열은 이름 그대로라 건드리지 않는다.
        const m = /(?:^|[^0-9a-z])m?([1-8])\d{2}\s?(?:i|d|e|xdrive)?(?:[^0-9a-z]|$)/i.exec(modelProbeSpaced);
        if (m) importAlias = `${m[1]}시리즈`;
      } else if (isBenz) {
        // E200·C300·S350·GLE450 → X-클래스. GL 계열은 별도 모델이라 제외한다.
        const m = /(?:^|[^0-9a-z])(?!gl)([acegsv])\s?\d{2,3}\s?(?:d|e)?(?:[^0-9a-z]|$)/i.exec(modelProbeSpaced);
        if (m) importAlias = `${m[1].toUpperCase()}-클래스`;
      }
      if (importAlias) {
        const real = models.find((model) => deps.norm(model) === deps.norm(importAlias));
        if (real) hitModel = real;
      }
    }
    // 별칭까지 해보고도 없으면 그때 전체 마스터를 본다 — 되돌림은 «마지막»이어야 한다.
    // 먼저 되돌리면 취급하지 않는 브랜드(애스턴마틴·크라이슬러)를 다시 집어 온다.
    if (!hitModel && models !== allModels) hitModel = findHit(allModels);
    if (!hitModel) {
      // 별칭은 «못 찾았을 때»가 아니라 진작 봤어야 한다 — 「S클래스」(하이픈 없음)는 마스터의
      // 「S-클래스」에 문자열 포함으로 닿지 않는다. 실측: 그 사이에 짧은 오탐이 먼저 걸려
      // 벤츠 S클래스가 아우디로 갔다. 짧은 이름 경계 검사를 넣은 지금은 여기까지 내려온다.
      for (const [alias, canonical] of Object.entries(deps.modelAlias)) {
        if (!modelProbe.includes(alias)) continue;
        const real = models.find((model) => deps.norm(model) === deps.norm(canonical))
          || models.find((model) => deps.norm(model) === alias);
        if (real) {
          hitModel = real;
          break;
        }
      }
    }
  }

  const trimHintModel = hitModel;
  const trimEmpty = !String(out.trim_name ?? '').trim();
  const modelWasBlob = deps.looksCompoundVehicleText(product.model)
    || deps.looksCompoundVehicleText(product.sub_model)
    || deps.looksCompoundVehicleText(product.cert_car_name)
    || deps.looksCompoundVehicleText(product.vehicle_name);
  if (trimEmpty || modelWasBlob) {
    const trimSet = new Set<string>();
    for (const entry of entries) {
      if (trimHintModel && entry.model !== trimHintModel) continue;
      for (const trim of realMasterTrims(entry.trims)) trimSet.add(trim);
      for (const variant of entry.variants || []) {
        for (const trim of realMasterTrims(variant.trims)) trimSet.add(trim);
      }
    }
    if (!trimHintModel) {
      for (const entry of entries) {
        for (const trim of realMasterTrims(entry.trims)) trimSet.add(trim);
        for (const variant of entry.variants || []) {
          for (const trim of realMasterTrims(variant.trims)) trimSet.add(trim);
        }
      }
    }
    for (const trim of [...trimSet].sort((a, b) => b.length - a.length)) {
      if (deps.norm(trim).length < 2) continue;
      if (normalizedBlob.includes(deps.norm(trim))) {
        out.trim_name = trim;
        break;
      }
    }
  }

  {
    const rawTrim = String(out.trim_name || '').trim();
    const pool: string[] = [];
    const hint = String(out.model || hitModel || '').trim();
    for (const entry of entries) {
      if (hint && entry.model !== hint) continue;
      for (const trim of realMasterTrims(entry.trims)) pool.push(trim);
      for (const variant of entry.variants || []) {
        for (const trim of realMasterTrims(variant.trims)) pool.push(trim);
      }
    }
    /**
     * 트림은 **원문에서 규격값을 뽑아낸다.** 문장을 그대로 남기지 않는다.
     *
     * 예전에는 두 갈래로 새고 있었다.
     *   · 40자 넘으면 통째로 버렸다 — 「팰리세이드 … 7인승 캘리그래피 …」 안의 등급까지 사라짐.
     *   · 40자 이하인데 캐논 매칭이 안 되면 문장이 그대로 트림 이름이 됐다.
     *
     * 아이카 B형 `트림` 열은 풀 문장이다. 마스터 노드가 「LPI 트렌디(렌터카)」처럼
     * 접두·괄호가 있어도 원문 「… 트렌디」에서 핵심 등급만 고른다. 「트랜디」 오탈자 → 트렌디.
     */
    const nraw = deps.norm(rawTrim.replace(/트랜디/g, '트렌디'));
    const coreOf = (trim: string) => deps.norm(trim)
      .replace(/(?:lpi|gdi|hev|phev|ev|tng|렌터카|자가용|장애인용|일반인|\d+)/g, '')
      .replace(/[()[\]{}]/g, '');
    const embedded = () => {
      const uniq = [...new Set(pool)].filter((t) => deps.norm(t).length >= 2)
        .sort((a, b) => b.length - a.length);
      const exact = uniq.find((t) => nraw.includes(deps.norm(t)));
      if (exact) return exact;
      const byCore = uniq.find((t) => {
        const core = coreOf(t);
        return core.length >= 2 && nraw.includes(core);
      });
      if (!byCore) return '';
      const core = coreOf(byCore);
      return uniq.find((t) => deps.norm(t) === core) || byCore;
    };
    const KNOWN_GRADES = [
      '캘리그래피', '인스퍼레이션', '프레스티지', '노블레스', '익스클루시브', '시그니처',
      '트렌디', '스탠다드', '모던', '스마트', '럭셔리', '디럭스', '기본형', '그래비티',
      '컨비니언스', '얼티메이트', '리미티드', '엘레강스', '인텐시브', '르블랑', '어스', '에어',
    ];
    const knownInText = () => KNOWN_GRADES
      .slice()
      .sort((a, b) => b.length - a.length)
      .find((g) => nraw.includes(deps.norm(g))) || '';
    const canonical = rawTrim && !isNoTrimLabel(rawTrim)
      ? deps.canonMasterTrim(rawTrim.replace(/트랜디/g, '트렌디'), pool.length ? pool : null)
      : '';
    const picked0 = (!rawTrim || isNoTrimLabel(rawTrim)) ? ''
      : canonical || embedded() || knownInText()
      || (rawTrim.length <= 12 && !/\s/.test(rawTrim) ? rawTrim.replace(/트랜디/g, '트렌디') : '');
    // 「기본」이 「기본형」 앞부분으로 잘못 잡히면 긴 쪽으로 올린다.
    const picked = (() => {
      if (!picked0) return '';
      const longer = ['기본형', ...KNOWN_GRADES]
        .filter((g) => g !== picked0 && g.startsWith(picked0) && nraw.includes(deps.norm(g)))
        .sort((a, b) => b.length - a.length)[0];
      return longer || picked0;
    })();
    /**
     * ★이름에서 뺀 원문은 **버리지 말고 `trim_extra` 로 넘긴다.**
     * 여기서 그냥 지우면 세대를 가르는 글자가 통째로 사라져 매처가 헤맨다 —
     * 실측(2026-08-08): 트림 정리 직후 E-클래스가 W213 에서 1984년 W124 로 떨어졌다.
     * 이름에는 안 쓰지만 판정 근거로는 읽어야 한다(`vehicle-master-signals` 에 등록돼 있다).
     */
    if (rawTrim && rawTrim !== picked && !String(out.trim_extra ?? '').trim()) out.trim_extra = rawTrim;
    out.trim_name = picked;
  }

  if (hitModel) {
    const modelRaw = String(out.model ?? '').trim();
    const peeled = !!(
      out.trim_name
      && deps.norm(modelRaw).includes(deps.norm(String(out.trim_name)))
      && deps.norm(modelRaw).includes(deps.norm(hitModel))
      && deps.norm(modelRaw) !== deps.norm(hitModel)
    );
    /**
     * 공급사가 「아이오닉」만 주고고 문장에 「아이오닉6」이 있으면 findHit 는 이미
     * hitModel=아이오닉6 을 쥐고 있다. 그런데 modelRaw 가 빈칸·문장이 아니라서
     * 예전에 그 답을 버렸고, 2016년 「아이오닉 일렉트릭」으로 떨어졌다(2026-08-09).
     * hitModel 이 같은 계열의 **더 구체적인** 마스터 모델일 때만 올린다 —
     * startsWith 로 「아반떼」→「파사트」 도약을 구조적으로 막는다.
     */
    const nHit = deps.norm(hitModel);
    const nRaw = deps.norm(modelRaw);
    const moreSpecific = !!(
      modelRaw
      && nHit !== nRaw
      && nHit.startsWith(nRaw)
      && entries.some((entry) => entry.model === hitModel)
    );
    if (!modelRaw || deps.looksCompoundVehicleText(modelRaw) || peeled) {
      /**
       * ★문장을 모델명으로 갈아끼우기 전에 **원문을 남긴다.**
       *
       * 공급사가 한 칸에 다 적으면(「쏘나타 디 엣지 DN8 2.0 가솔린 인스퍼레이션」) 그 값은
       * model 로 들어온다. 여기서 그냥 덮으면 model=쏘나타 만 남고 «디 엣지 DN8» 이 증발해,
       * 세대코드 추출도 세부모델 유사도도 볼 것이 없어진다 —
       * 실측(2026-08-08) 결과 1990년대 「쏘나타 II Y3」로 붙었다.
       * 같은 문장을 trim_name·sub_model 로 주면 원문이 남아 제대로 붙는다. 그 차이를 없앤다.
       *
       * sub_model 이 비어 있을 때만 채운다 — 공급사가 따로 준 세부모델을 덮으면 안 된다.
       */
      if (modelRaw && !String(out.sub_model ?? '').trim()) out.sub_model = modelRaw;
      out.model = hitModel;
    } else if (moreSpecific) {
      // 짧은 공급 모델명(「아이오닉」)은 세부모델로 넣지 않는다 — 세대가 아니다.
      out.model = hitModel;
    }
    if (!String(out.maker ?? '').trim()) {
      const maker = entries.find((entry) => entry.model === hitModel)?.maker;
      if (maker) out.maker = maker;
    }
  }

  return out;
}
