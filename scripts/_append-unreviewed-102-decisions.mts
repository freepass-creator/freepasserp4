/**
 * 오더1 — 잔여 102대 3축 결정을 data/product-vehicle-review-decisions.json 에 append.
 * 기존 decisions 수정 금지. --dry 면 파일 쓰지 않고 요약만.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import {
  loadProductVehicleReviewDecisions,
  type ProductVehicleReviewDecision,
  type ProductVehicleReviewMasterAction,
} from '../lib/domain/product-vehicle-review-decisions';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const plate = (v: unknown) => S(v).replace(/\s/g, '');
const dry = process.argv.includes('--dry');

const decisionsFile = JSON.parse(readFileSync('data/product-vehicle-review-decisions.json', 'utf8'));
const backlog = JSON.parse(readFileSync('tmp/product-master-vehicle-resolution-backlog.json', 'utf8'));
const coverage = JSON.parse(readFileSync('tmp/product-master-vehicle-coverage.json', 'utf8'));
const artifact = JSON.parse(readFileSync('public/data/vehicle-trim-master.json', 'utf8'));
const byKey = new Map<string, Rec>((artifact.records || []).map((r: Rec) => [r.trim_row_key, r]));
const covByRow = new Map<number, Rec>((coverage.rows || []).map((r: Rec) => [Number(r.row), r]));
const decided = new Set((decisionsFile.decisions || []).map((d: Rec) => plate(d.car_number)));

const unreviewed = (backlog.rows || []).filter((r: Rec) => !String(r.resolution_class || '').startsWith('REVIEWED_'));

function ax(key: string) {
  const m = byKey.get(key);
  if (!m) return null;
  return {
    maker: S(m.maker),
    model: S(m.model),
    sub: S(m.sub_model),
    trim: S(m.trim),
    tier: S(m.usage_tier),
    pt: S(m.powertrain),
    seats: m.seats,
  };
}

function fromKey(key: string, basis: string, extra: Partial<ProductVehicleReviewDecision> = {}): ProductVehicleReviewDecision {
  const a = ax(key);
  if (!a) throw new Error(`키 없음 ${key}`);
  return {
    car_number: '',
    provider: '',
    supplier_text: '',
    maker: a.maker,
    model: a.model,
    sub_model: a.sub,
    trim: a.trim,
    trim_row_key: key,
    decision: 'CODE',
    master_action: '',
    basis,
    ...extra,
  };
}

function supplierAligns(supplier: string, a: { model: string; sub: string; trim: string }) {
  const s = supplier.replace(/\s/g, '').toLowerCase();
  const modelHit = a.model && s.includes(a.model.replace(/\s/g, '').toLowerCase());
  const subCore = a.sub.replace(/^(더\s*뉴|디\s*올\s*뉴|올\s*뉴|뉴|the\s*new)\s*/i, '');
  const genCode = (a.sub.match(/\b([A-Z]{1,3}\d{1,3}[A-Z]?)\b/) || a.sub.match(/([A-Z]{2}\d)/) || [])[1];
  const subHit =
    (a.sub && supplier.includes(a.sub)) ||
    (subCore.length >= 2 && supplier.includes(subCore)) ||
    (!!genCode && genCode.length >= 2 && new RegExp(genCode, 'i').test(supplier));
  const trimNorm = a.trim.replace(/\s/g, '').toLowerCase()
    .replace(/premium/g, '프리미엄').replace(/luxury/g, '럭셔리').replace(/cvx/g, 'cvx');
  const supplierNorm = s
    .replace(/premium/g, '프리미엄').replace(/luxury/g, '럭셔리')
    .replace(/leblanc|르블랑/g, '르블랑');
  const trimHit = a.trim && (
    supplier.includes(a.trim) ||
    s.includes(a.trim.replace(/\s/g, '').toLowerCase()) ||
    (trimNorm.length >= 2 && supplierNorm.includes(trimNorm)) ||
    (/기본형/.test(a.trim) && /기본(?!형)/.test(supplier)) ||
    (/프리미엄\s*럭셔리|premium\s*luxury/i.test(a.trim) && /premium\s*luxury|프리미엄.*럭셔리/i.test(supplier))
  );
  const genClash =
    (/아반떼\s*AD|더\s*뉴\s*아반떼\s*AD/i.test(supplier) && /CN7/i.test(a.sub)) ||
    (/E클래스\s*\(6세대\)|E-클래스\s*W214|W214/i.test(supplier) && /W213/i.test(a.sub)) ||
    (/E클래스\s*\(5세대\)|W213/i.test(supplier) && /W214/i.test(a.sub) && !/6세대/.test(supplier));
  return { modelHit: !!modelHit, subHit: !!subHit, trimHit: !!trimHit, genClash };
}

function hintSubFromSupplier(supplier: string): { maker: string; model: string; sub: string } | null {
  const hints: Array<{ re: RegExp; maker: string; model: string; sub: string }> = [
    { re: /더\s*뉴\s*그랜저\s*IG/, maker: '현대', model: '그랜저', sub: '더 뉴 그랜저 IG' },
    { re: /그랜저\s*IG(?!\s*F)/, maker: '현대', model: '그랜저', sub: '그랜저 IG' },
    { re: /G80\s*Black|2025\s*G80/i, maker: '제네시스', model: 'G80', sub: '2025 G80 Black RG3' },
    { re: /G80\s*부분변경|더\s*올\s*뉴\s*G80/, maker: '제네시스', model: 'G80', sub: 'G80 부분변경 RG3' },
    { re: /G80\s*RG3|G80\s*3세대/, maker: '제네시스', model: 'G80', sub: 'G80 3세대 초기형 RG3' },
    { re: /GV80\s*JX1|뉴\s*GV80|GV80\s*2\.5/, maker: '제네시스', model: 'GV80', sub: 'GV80 부분변경 JX1' },
    { re: /E250|E-?클래스.*E250/i, maker: '벤츠', model: 'E-클래스', sub: 'E-클래스 W213' },
    { re: /C200|C-?클래스.*C200/i, maker: '벤츠', model: 'C-클래스', sub: '' }, // 세대 미상
  ];
  for (const h of hints) {
    if (!h.re.test(supplier)) continue;
    if (!h.sub) return null;
    return { maker: h.maker, model: h.model, sub: h.sub };
  }
  return null;
}

/** 차번별 수동 오버라이드 — 자동 규칙이 틀리거나 후보가 오염된 경우 */
const OVERRIDES: Record<string, (ctx: Ctx) => ProductVehicleReviewDecision> = {
  // 후보가 CN7로 오염 — 현재 AD 코드가 원문과 일치
  '104허2655': (ctx) => fromKey(ctx.current!, `현재 코드 유지 — 공급사「더 뉴 아반떼 AD … 스마트」= 현재 코드 3축. 후보 CN7은 세대 오염`),
  // 원문에 X 에디션·노블레스 동시 — X 에디션이 세부트림 정본
  '104허3046': (ctx) => fromKey(ctx.current!, `현재 코드 유지 — 공급사「GDI X 에디션」명시. 후보 GDI 노블레스는 상위 등급명만 맞음`),
  // PREMIUM ≠ 프리미엄 초이스
  '124하2114': () => fromKey('mf-001.md-004.sm-ig::v01::t01', `공급사「PREMIUM」= 더 뉴 그랜저 IG 프리미엄(가솔린 2.5). 현재 프리미엄 초이스는 원문에 없음 → 교체`),
  // 노블레스 스페셜 명시
  '23루2904': (ctx) => fromKey(ctx.current!, `현재 코드 유지 — 공급사「노블레스 스페셜」= 올 뉴 쏘렌토 UM 노블레스 스페셜. 후보 노블레스는 한 단계 아래`),
  // 현재 프레스티지, 원문 노블레스
  '273가2166': () => fromKey('mf-002.md-027.sm-mq4::v04::t02', `공급사「노블레스」HEV — 현재 프레스티지 코드 교체`),
  // 플래티넘 베스트셀렉션Ⅰ
  '396조2537': () => fromKey('mf-002.md-059.sm-rj::v03::t01', `공급사「플래티넘 베스트셀렉션Ⅰ」= K9 RJ 베스트 셀렉션 I. 현재 플래티넘만은 불완전`),
  '63버0257': (ctx) => fromKey(ctx.current!, `현재 코드 유지 — 공급사「익스클루시브 플러스」명시`),
  '133하4556': (ctx) => fromKey(ctx.current!, `현재 코드 유지 — 공급사「그랜저 GN7」. 후보 GN11은 다른 세부모델`),
  '142호1040': (ctx) => fromKey(ctx.current!, `현재 코드 유지 — 공급사「쏘나타 DN8」(디 엣지 표기 없음)`),
  // 2023-12 ≥ 더 뉴 카니발(2023-11) · 시그니처 9인승 3.5T
  '125호9035': () => fromKey('mf-002.md-036.sm-ka4::v03::t03', `등록 23-12·시그니처 = 더 뉴 카니발 KA4 시그니처(가솔린 3.5). 초기형 KA4 코드 교체`),
  // 카니발 9인승 HEV 시그니처
  '133하4537': () => fromKey('mf-002.md-036.sm-ka4::v06::t03', `공급사「9인승 HEV 1.6 시그니처」= 더 뉴 카니발 KA4 시그니처 하이브리드 1.6 9인승. 현재 프레스티지 교체`),
  '125하2544': () => ({
    car_number: '', provider: '', supplier_text: '',
    maker: '제네시스', model: 'G80', sub_model: 'G80 부분변경 RG3', trim: '',
    trim_row_key: '', decision: 'PARTIAL', master_action: '',
    basis: `공급사「G80 2.5 AWD」등록 25-04 — Black 미기입 → 부분변경 RG3까지. 기본형/스포츠/Black 트림 미확정`,
  }),
  '125하2545': () => ({
    car_number: '', provider: '', supplier_text: '',
    maker: '제네시스', model: 'G80', sub_model: 'G80 부분변경 RG3', trim: '',
    trim_row_key: '', decision: 'PARTIAL', master_action: '',
    basis: `공급사「G80 3.5 AWD」등록 25-04 — Black 미기입 → 부분변경 RG3까지. 세부트림 미확정`,
  }),
  '161하3805': () => ({
    car_number: '', provider: '', supplier_text: '',
    maker: '제네시스', model: 'GV80', sub_model: 'GV80 부분변경 JX1', trim: '',
    trim_row_key: '', decision: 'PARTIAL', master_action: '',
    basis: `공급사「GV80 JX1 가솔린 2.5 AWD (세부등급 없음)」— 세부모델 확정, 인승·Black 여부 미상`,
  }),
  // K8 3.5 4WD 노블레스 — 마스터에 3.5 4WD는 플래티넘만. 원문 노블레스 존중 → ADD_ROW
  '109호1870': (ctx) => ({
    car_number: '', provider: '', supplier_text: '',
    maker: '기아', model: 'K8', sub_model: 'K8 GL3', trim: '노블레스',
    trim_row_key: '', decision: 'TRIPLE', master_action: 'ADD_ROW',
    basis: `공급사「K8 3.5 가솔린 4WD 노블레스」— 마스터 3.5 4WD는 플래티넘만 있어 노블레스 행 없음. 현재 플래티넘 코드는 세부트림 불일치 → ADD_ROW`,
    candidate_key: ctx.current || undefined,
  }),
  '231라7599': (ctx) => ({
    car_number: '', provider: '', supplier_text: '',
    maker: '기아', model: 'K8', sub_model: 'K8 GL3', trim: '노블레스',
    trim_row_key: '', decision: 'TRIPLE', master_action: 'ADD_ROW',
    basis: `공급사「K8 3.5 GDI 4WD 노블레스」— 마스터에 가솔린 3.5 4WD 노블레스 행 없음(플래티넘만). ADD_ROW`,
    candidate_key: ctx.current || undefined,
  }),
  // 표기 충돌만(같은 차)
  '10하8210': (ctx) => fromKey(ctx.current!, `현재 코드 유지 — 「Premium/프리미엄」표기 충돌만(동일 New Model Y Premium Long Range AWD)`, { master_action: 'ALIAS' }),
  '133호5389': (ctx) => fromKey(ctx.current!, `현재 코드 유지 — 「Prestige/프레스트지」표기 충돌만(동일 골프 8세대 Prestige)`, { master_action: 'ALIAS' }),
  // 배기량 원천 충돌
  '161허1699': () => ({
    car_number: '', provider: '', supplier_text: '',
    maker: '현대', model: '아반떼', sub_model: '', trim: '',
    trim_row_key: '', decision: 'HOLD', master_action: '',
    basis: `원천 충돌 배기량 1598/1500 + 「아반떼 J2」표기 — 공급사 확인 전 미확정`,
  }),
  // 투싼 HEV 프리미엄(N라인 아님)
  '125하2506': () => fromKey('mf-001.md-032.sm-nx4::v05::t02', `공급사「투싼 HEV 프리미엄 2WD」= 더 뉴 투싼 NX4 프리미엄 하이브리드 1.6 2WD(N라인 아님)`),
  // GV80 5인승 명시
  '142호8434': () => fromKey('mf-007.md-005.sm-jx1-pe__gv80-facelift::v02::t01', `공급사「GV80 2.5T AWD 5인승」= GV80 부분변경 JX1 기본형 5인승 2.5T AWD`),
  '215거1381': () => ({
    car_number: '', provider: '', supplier_text: '',
    maker: '제네시스', model: 'GV80', sub_model: 'GV80 부분변경 JX1', trim: '',
    trim_row_key: '', decision: 'PARTIAL', master_action: '',
    basis: `공급사「뉴 GV80 2.5 가솔린 AWD 기본형」— 세부모델·기본형까지 보이나 인승(5/6/7) 미기입 → 트림 미확정`,
  }),
  // BMW 120i 스포츠
  '133라1401': () => fromKey('mf-012.md-001.sm-f40::v03::t02', `공급사「120i 스포츠」= 1시리즈 F40 120i Sport`),
  '192머7372': () => fromKey('mf-012.md-001.sm-f40::v03::t02', `공급사「120i 스포츠」= 1시리즈 F40 120i Sport`),
  // 모닝 트랜디=트렌디 승용
  '109호5380': () => fromKey('mf-002.md-013.sm-ja-morning-2027-korea__the-2027-morning::v01::t01', `공급사「모닝 가솔린 트랜디」= The 2027 Morning 가솔린 승용 트렌디(표기 트랜디→트렌디)`),
  '109호5381': () => fromKey('mf-002.md-013.sm-ja-morning-2027-korea__the-2027-morning::v01::t01', `공급사「모닝 가솔린 트랜디」= The 2027 Morning 가솔린 승용 트렌디(표기 트랜디→트렌디)`),
};

// Tesla RWD Premium 묶음
for (let i = 471; i <= 480; i++) {
  const p = `33허0${i}`;
  OVERRIDES[p] = (ctx) => fromKey(ctx.current!, `현재 코드 유지 — 「RWD Premium/Premium」표기 충돌만(동일 New Model Y Premium RWD)`, { master_action: 'ALIAS' });
}

type Ctx = {
  plate: string;
  provider: string;
  supplier: string;
  current: string;
  currentAx: ReturnType<typeof ax>;
  keys: string[];
  profiles: { key: string; a: NonNullable<ReturnType<typeof ax>> }[];
  conflicts: string[];
  category: string;
  clues: Rec;
};

function decide(ctx: Ctx): ProductVehicleReviewDecision {
  const ov = OVERRIDES[ctx.plate];
  if (ov) return ov(ctx);

  // E-클래스 6세대 → W214 (현재 W213 교체)
  if (/E클래스\s*\(6세대\)|E-클래스\s*\(6세대\)/i.test(ctx.supplier) && /E200/.test(ctx.supplier)) {
    const hit = ctx.profiles.find((p) => /W214/.test(p.a.sub) && /E200 아방가르드/.test(p.a.trim) && !/리미티드|AMG/.test(p.a.trim));
    if (hit && hit.a.tier === 'automatic') {
      return fromKey(hit.key, `공급사「E클래스(6세대) E200 아방가르드」= W214. 현재 W213이면 세대 교체`);
    }
    if (ctx.currentAx && /W214/.test(ctx.currentAx.sub)) {
      return fromKey(ctx.current, `현재 코드 유지 — W214 E200 아방가르드`);
    }
  }

  // 원천 충돌 — 남은 건 HOLD
  if (ctx.conflicts.length) {
    return {
      car_number: '', provider: '', supplier_text: '',
      maker: S(ctx.clues.maker) || ctx.currentAx?.maker || '',
      model: ctx.currentAx?.model || '',
      sub_model: ctx.currentAx?.sub || '',
      trim: '',
      trim_row_key: '', decision: 'HOLD', master_action: '',
      basis: `원천 충돌: ${JSON.stringify(ctx.conflicts).slice(0, 180)} — 공급사 확인`,
    };
  }

  // 후보 동일 3축
  if (ctx.profiles.length >= 1) {
    const tk = (a: NonNullable<ReturnType<typeof ax>>) => `${a.maker}|${a.model}|${a.sub}|${a.trim}`;
    const groups = new Map<string, typeof ctx.profiles>();
    for (const p of ctx.profiles) {
      const k = tk(p.a);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(p);
    }
    if (groups.size === 1) {
      const a = ctx.profiles[0].a;
      // 현재 코드가 있고 공급사와 더 잘 맞으면 현재 유지
      if (ctx.current && ctx.currentAx && ctx.currentAx.tier === 'automatic') {
        const curA = supplierAligns(ctx.supplier, ctx.currentAx);
        const candA = supplierAligns(ctx.supplier, a);
        if (curA.genClash) {
          /* fall through to candidate */
        } else if (curA.trimHit && !candA.trimHit) {
          return fromKey(ctx.current, `현재 코드 유지 — 공급사 원문이 현재 세부트림「${ctx.currentAx.trim}」과 일치(후보 동일 3축보다 현재가 원문 정합)`);
        } else if (curA.subHit && curA.trimHit && (ctx.currentAx.sub !== a.sub || ctx.currentAx.trim !== a.trim)) {
          return fromKey(ctx.current, `현재 코드 유지 — 공급사 원문이 현재 3축(${ctx.currentAx.sub} › ${ctx.currentAx.trim})과 일치`);
        }
      }
      const autos = [...new Set(ctx.profiles.filter((p) => p.a.tier === 'automatic').map((p) => p.key))];
      const align = supplierAligns(ctx.supplier, a);
      if (ctx.current && ctx.currentAx && !align.subHit && supplierAligns(ctx.supplier, ctx.currentAx).subHit) {
        return fromKey(ctx.current, `현재 코드 유지 — 후보 3축이 공급사 세대와 어긋남`);
      }
      if (autos.length === 1 && !align.genClash) {
        return fromKey(autos[0], `[자동합의] 후보 ${ctx.profiles.length}개가 동일 3축(${a.model} › ${a.sub} › ${a.trim})이고 automatic 유일`);
      }
      const keys = autos.length ? autos : ctx.profiles.map((p) => p.key);
      return {
        car_number: '', provider: '', supplier_text: '',
        maker: a.maker, model: a.model, sub_model: a.sub, trim: a.trim,
        trim_row_key: '', candidate_keys: keys,
        decision: 'TRIPLE', master_action: '',
        basis: `[자동합의] 후보 ${ctx.profiles.length}개가 동일 3축(${a.model} › ${a.sub} › ${a.trim}). 인승·구동 등 비식별 축만 다름`,
      };
    }
  }

  // 확정 코드 유지 — 원문이 같은 차
  if (ctx.current && ctx.currentAx && ctx.currentAx.tier === 'automatic') {
    const al = supplierAligns(ctx.supplier, ctx.currentAx);
    if (!al.genClash && (al.modelHit || al.subHit) && (al.trimHit || !/\S/.test(S(ctx.clues.trim)))) {
      // 원문 트림이 다른데 현재 트림만 다른 경우 제외
      const clueTrim = S(ctx.clues.trim) || '';
      const supplierTrimClash =
        (/노블레스/.test(ctx.supplier) && /플래티넘/.test(ctx.currentAx.trim) && !/노블레스/.test(ctx.currentAx.trim)) ||
        (/시그니처/.test(ctx.supplier) && /프레스티지/.test(ctx.currentAx.trim) && !/시그니처/.test(ctx.currentAx.trim));
      if (!supplierTrimClash && (al.trimHit || al.subHit || al.modelHit)) {
        return fromKey(ctx.current, `현재 코드 유지 — 공급사 원문「${ctx.supplier.slice(0, 80)}」이 코드 3축(${ctx.currentAx.model} › ${ctx.currentAx.sub} › ${ctx.currentAx.trim})과 같은 차`);
      }
    }
  }

  // 트림 단서로 유일 automatic
  const clueTrim = S(ctx.clues.trim);
  if (clueTrim) {
    const hit = ctx.profiles.filter((p) => p.a.trim.includes(clueTrim) || clueTrim.includes(p.a.trim));
    const autos = hit.filter((p) => p.a.tier === 'automatic');
    if (autos.length === 1) {
      return fromKey(autos[0].key, `공급사 트림 단서「${clueTrim}」로 automatic 후보 유일`);
    }
  }

  // 공급사에 트림 단어가 있고 후보 trim 유일
  const trimWords = ['시그니처', '노블레스', '프레스티지', '트렌디', '인스퍼레이션', '익스클루시브', '캘리그래피', '아너스', '스포츠', '프리미엄', '모던', '스마트', 'Business', '런칭', '기본형', '플래티넘', '그래비티'];
  for (const w of trimWords) {
    if (!ctx.supplier.includes(w) && !(w === 'Business' && /비즈니스/.test(ctx.supplier))) continue;
    const hit = ctx.profiles.filter((p) => p.a.trim.includes(w) || (w === 'Business' && /Business|비즈니스/.test(p.a.trim)));
    const autos = hit.filter((p) => p.a.tier === 'automatic');
    const tripleSet = new Set(autos.map((p) => `${p.a.model}|${p.a.sub}|${p.a.trim}`));
    if (autos.length >= 1 && tripleSet.size === 1) {
      if (autos.length === 1) return fromKey(autos[0].key, `공급사 트림「${w}」로 3축 유일 automatic`);
      return {
        car_number: '', provider: '', supplier_text: '',
        maker: autos[0].a.maker, model: autos[0].a.model, sub_model: autos[0].a.sub, trim: autos[0].a.trim,
        trim_row_key: '', candidate_keys: autos.map((p) => p.key),
        decision: 'TRIPLE', master_action: '',
        basis: `[자동합의] 공급사 트림「${w}」로 동일 3축 후보 ${autos.length}개`,
      };
    }
  }

  // 세부모델만 유일 → PARTIAL
  if (ctx.profiles.length) {
    const subs = new Set(ctx.profiles.map((p) => `${p.a.model}|${p.a.sub}`));
    if (subs.size === 1) {
      const a = ctx.profiles[0].a;
      return {
        car_number: '', provider: '', supplier_text: '',
        maker: a.maker, model: a.model, sub_model: a.sub, trim: '',
        trim_row_key: '', decision: 'PARTIAL', master_action: '',
        basis: `세부모델「${a.sub}」까지 확정. 세부트림은 후보 ${ctx.profiles.length}개 갈림 — 공급사/가격표 확인`,
      };
    }
    // 모델만 유일
    const models = new Set(ctx.profiles.map((p) => p.a.model));
    if (models.size === 1) {
      const a = ctx.profiles[0].a;
      const subHits = ctx.profiles.filter((p) => supplierAligns(ctx.supplier, p.a).subHit);
      const subSet = new Set(subHits.map((p) => p.a.sub));
      if (subSet.size === 1) {
        return {
          car_number: '', provider: '', supplier_text: '',
          maker: a.maker, model: a.model, sub_model: [...subSet][0], trim: '',
          trim_row_key: '', decision: 'PARTIAL', master_action: '',
          basis: `모델·세부모델 확정(「${[...subSet][0]}」). 세부트림 미상`,
        };
      }
      // 공급사 문자열에서 세부모델 직접 추출
      const hinted = hintSubFromSupplier(ctx.supplier);
      if (hinted && hinted.model === a.model) {
        return {
          car_number: '', provider: '', supplier_text: '',
          maker: hinted.maker, model: hinted.model, sub_model: hinted.sub, trim: '',
          trim_row_key: '', decision: 'PARTIAL', master_action: '',
          basis: `공급사 원문으로 세부모델「${hinted.sub}」확정. 세부트림 미상(후보 ${ctx.profiles.length})`,
        };
      }
      return {
        car_number: '', provider: '', supplier_text: '',
        maker: a.maker, model: a.model, sub_model: '', trim: '',
        trim_row_key: '', decision: 'HOLD', master_action: '',
        basis: `모델「${a.model}」만 확정. 세부모델·트림 단서 부족(후보 ${ctx.profiles.length})`,
      };
    }
  }

  const hinted = hintSubFromSupplier(ctx.supplier);
  if (hinted) {
    return {
      car_number: '', provider: '', supplier_text: '',
      maker: hinted.maker, model: hinted.model, sub_model: hinted.sub, trim: '',
      trim_row_key: '', decision: 'PARTIAL', master_action: '',
      basis: `공급사 원문으로 세부모델「${hinted.sub}」확정. 세부트림 미상`,
    };
  }

  return {
    car_number: '', provider: '', supplier_text: '',
    maker: '', model: '', sub_model: '', trim: '',
    trim_row_key: '', decision: 'HOLD', master_action: '',
    basis: `3축 단서 부족 — 공급사「${ctx.supplier.slice(0, 100)}」`,
  };
}

const appended: ProductVehicleReviewDecision[] = [];
const skipped: string[] = [];

for (const row of unreviewed) {
  const cov = covByRow.get(Number(row.row));
  if (!cov) { skipped.push(`row ${row.row} no coverage`); continue; }
  const p = plate(cov.car_number);
  if (!p || decided.has(p)) { skipped.push(p || `row ${row.row}`); continue; }
  const keys: string[] = [...(cov.candidate_keys || [])].filter(Boolean);
  const profiles = keys.map((k) => ({ key: k, a: ax(k)! })).filter((x) => x.a);
  const current = S(cov.current_code);
  const ctx: Ctx = {
    plate: p,
    provider: S(cov.provider),
    supplier: S(cov.supplier_vehicle_name),
    current,
    currentAx: current ? ax(current) : null,
    keys,
    profiles,
    conflicts: cov.signal_conflicts || [],
    category: S(cov.category),
    clues: cov.source_clues || {},
  };
  const d = decide(ctx);
  d.car_number = p;
  d.provider = ctx.provider;
  d.supplier_text = ctx.supplier;
  if (!d.master_action) d.master_action = '' as ProductVehicleReviewMasterAction;
  appended.push(d);
  decided.add(p);
}

const summary = { total: appended.length, by_decision: {} as Rec, by_action: {} as Rec };
for (const d of appended) {
  summary.by_decision[d.decision] = (summary.by_decision[d.decision] || 0) + 1;
  const a = d.master_action || '(none)';
  summary.by_action[a] = (summary.by_action[a] || 0) + 1;
}

writeFileSync('tmp/unreviewed-102-append-preview.json', JSON.stringify({ summary, skipped, decisions: appended }, null, 2));
console.log(JSON.stringify(summary, null, 2));
console.log('skipped', skipped.length);

if (!dry) {
  decisionsFile.decisions = [...decisionsFile.decisions, ...appended];
  decisionsFile.reviewed_by = `${decisionsFile.reviewed_by} · Cursor 잔여102 2026-08-18`;
  writeFileSync('data/product-vehicle-review-decisions.json', JSON.stringify(decisionsFile, null, 2) + '\n');
  // 로더 검증
  loadProductVehicleReviewDecisions();
  console.log('appended', appended.length, '→ decisions total', decisionsFile.decisions.length);
} else {
  console.log('dry-run only');
}
