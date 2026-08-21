/**
 * **엔카 제원 채움 — T 가 박혀도 U 갈래(배기량·구동)를 차명·왼쪽 칸으로 좁힌다.**
 *
 * 161허1165 사고: 더 뉴 셀토스 시그니처(T-0620)는 1.6/2.0 · 2WD/AWD 가 한 트림에 섞여 있다.
 *   예전엔 T 만 보고 「제원이 갈린다」며 비웠고, 왼쪽 「1.6」은 점을 빼 16cc 로 읽었다.
 * ★여기서 막는 것
 *   ① 「1.6」을 16cc 로 읽지 않는다
 *   ② T 확정 뒤에도 차명·왼쪽 칸의 1.6·2WD·연료로 U 를 좁힌다
 *   ③ 힌트(1.6)와 안 맞으면 다른 갈래(2.0)를 넣지 않는다 — keepIf 로 되돌리지 않는다
 *   ④ 구동은 2WD/전륜, AWD/4WD/콰트로를 같은 키로 본다
 *   ⑤ 정확 cc(1598)를 표시리터(1.6)로 격하하지 않는다
 * 스탬프 시작·`npx tsx scripts/check-encar-spec-fill.mts` 가 `assertEncarSpecFillGuards` 로 잠근다.
 */
export const S = (v: unknown) => String(v ?? '').trim();
export const nk = (v: unknown) => S(v).toLowerCase().replace(/[\s_\-./·()（）]/g, '');

export const fuelKey = (v: unknown) => {
  const s = nk(v);
  if (!s) return '';
  if (/전기|ev|electric/.test(s) && !/하이브리드|hev|hybrid/.test(s)) return '전기';
  if (/수소|fcev/.test(s)) return '수소';
  if (/하이브리드|hev|hybrid|가솔린전기|디젤전기/.test(s)) return '하이브리드';
  if (/lpg|lpi/.test(s)) return 'lpg';
  if (/디젤|경유|diesel/.test(s)) return '디젤';
  if (/가솔린|휘발유|gasoline|petrol/.test(s)) return '가솔린';
  return '';
};

/**
 * 왼쪽 「연료」·차명이 정제칸 leftover 보다 이긴다.
 * 「가솔린」+「전기」를 한 문자열로 넣으면 fuelKey 가 전기를 고른다 — 섞지 않는다.
 */
export const fuelFromVehicle = (leftFuel: unknown, carName: unknown, refinedFuel: unknown = '') =>
  fuelKey(`${S(leftFuel)} ${S(carName)}`) || fuelKey(refinedFuel);

export type NameLockAtom = { model: string; modelName?: string; sub?: string; fuel: string };

/** 차명·연료와 안 맞는 원자(A6 TFSI → A6 e-트론)는 후보에서 뺀다. */
export const atomConflictsName = (a: NameLockAtom, nameHay: string, fuel: string, ctxModel = '') => {
  const blob = `${a.model}${nk(a.modelName || '')}${a.sub || ''}`;
  if (/e트론|etron/.test(blob) && !/e트론|etron/.test(nameHay)) return true;
  if (a.model && new RegExp(`${a.model}(ev|일렉트릭)`).test(nameHay) && a.fuel !== '전기') return true;
  if (fuel && fuel !== '전기' && a.fuel === '전기') return true;
  if (fuel === '전기' && a.fuel && a.fuel !== '전기') return true;
  if (ctxModel && a.model && a.model !== ctxModel && !nameHay.includes(a.model)
    && !ctxModel.includes(a.model) && !a.model.includes(ctxModel)) return true;
  return false;
};

/** 정제칸 leftover. `kind=sub` 는 세대코드(G80 RG3)를 독으로 보지 않는다. */
export const leftoverConflicts = (nowModel: unknown, nameHay: string, fuel: string, ctxModel: string, kind: 'model' | 'sub' = 'model') => {
  const nm = nk(nowModel);
  if (!nm) return false;
  if (/e트론|etron/.test(nm) && !/e트론|etron/.test(nameHay)) return true;
  if (fuel && fuel !== '전기' && /전기|e트론|etron/.test(nm) && !/전기|ev\d|ev$/.test(nameHay)) return true;
  if (kind === 'model' && fuel === '전기' && /ev|일렉트릭/.test(nameHay) && !/ev|일렉트릭|전기|e트론|etron/.test(nm)) return true;
  if (kind === 'model' && ctxModel && nm !== ctxModel && nm.startsWith(ctxModel) && nm.length > ctxModel.length && !nameHay.includes(nm)) return true;
  return false;
};

export const driveKey = (v: unknown) => {
  const s = nk(v);
  if (!s) return '';
  if (/awd|4wd|4matic|xdrive|quattro|콰트로|사륜|네바퀴|4륜/.test(s)) return 'awd';
  if (/2wd|fwd|rwd|전륜|후륜/.test(s)) return '2wd';
  return '';
};

export const turboIn = (h: string) => /[0-9]t|터보|turbo/.test(h);

const ccDigits = (v: unknown) => Number(String(v ?? '').replace(/[^\d]/g, '')) || 0;

/** 「1.6」·「2.0T」처럼 점이 있으면 리터다. 점을 빼고 16cc 로 읽지 않는다. */
export const litersCc = (text: string) => {
  const m = String(text).match(/(\d+\.\d)/);
  if (!m) return 0;
  const n = Number(m[1]);
  return n >= 0.6 && n <= 8 ? Math.round(n * 1000) : 0;
};

export const parseOneCc = (v: unknown) => {
  const s = S(v);
  if (!s) return 0;
  if (/\d+\.\d/.test(s)) return litersCc(s);
  if (/^[1-6](?:\.0)?(?:\s*(?:l|L|ℓ|리터))?$/.test(s)) return Number(s) * 1000;
  const n = ccDigits(s);
  if (n >= 600 && n <= 8000) return n;
  return 0;
};

export const parseCc = (...vals: unknown[]) => {
  for (const v of vals) {
    const n = parseOneCc(v);
    if (n) return n;
  }
  return 0;
};

export const ccClose = (a: number, b: number) => a > 300 && b > 300 && Math.abs(a - b) / Math.max(a, b) <= 0.08;

const formatLiter = (n: number) => {
  const t = Math.round(n * 10) / 10;
  return Number.isInteger(t) ? String(t) : t.toFixed(1);
};

export type SpecAtom = {
  fuel: string;
  fuelName: string;
  cc: number;
  liters: number;
  seats: number;
  drive: string;
  driveName: string;
  turbo: boolean;
  trimName: string;
  encarTrim: string;
  yearStart: number;
  yearEnd: number;
};

export type SpecHint = {
  nameHay: string;
  fuel: string;
  cc: number;
  seats: number;
  drive: string;
  year: number;
};

export const keepIf = <T,>(hit: T[], pred: (a: T) => boolean) => {
  const next = hit.filter(pred);
  return next.length ? next : hit;
};

/** 차명 「X1(2세대)」·「E클래스(6세대)」에서 세대 순번. 엔카 세부모델이 F48 이어도 공급사는 이렇게 적는다. */
export const ordinalGen = (text: unknown) => {
  const m = /[(（]?\s*([1-9])\s*세대/.exec(String(text ?? ''));
  return m ? Number(m[1]) : 0;
};

export const inYear = (a: SpecAtom, y: number) => {
  if (!y) return true;
  if (!a.yearStart && !a.yearEnd) return true;
  const lo = a.yearStart || 1990;
  const hi = a.yearEnd || 2099;
  return y >= lo && y <= hi;
};

const hard = <T,>(hit: T[], pred: (a: T) => boolean) => hit.filter(pred);

/**
 * T(또는 후보) 안에서 차명·왼쪽 칸이 아는 제원으로 U 갈래를 좁힌다.
 * 연료·배기량·구동 힌트가 있으면 **안 맞으면 빈 풀** — 다른 갈래 값으로 되돌리지 않는다.
 */
export const specPool = (atoms: SpecAtom[], ctx: SpecHint): SpecAtom[] => {
  let p = atoms;
  if (ctx.fuel) p = hard(p, (a) => !a.fuel || a.fuel === ctx.fuel);
  if (ctx.cc > 300) p = hard(p, (a) => !a.cc || ccClose(a.cc, ctx.cc));
  if (ctx.drive) p = hard(p, (a) => !a.drive || a.drive === ctx.drive);
  if (turboIn(ctx.nameHay)) p = keepIf(p, (a) => a.turbo || /터보/.test(a.trimName) || /터보/.test(a.encarTrim));
  if (ctx.seats) p = keepIf(p, (a) => !a.seats || a.seats === ctx.seats);
  if (ctx.year) p = keepIf(p, (a) => inYear(a, ctx.year));
  return p;
};

const agree = (xs: (string | number)[]) => {
  const u = [...new Set(xs.map((x) => S(x)).filter(Boolean))];
  return u.length === 1 ? u[0] : '';
};

export const ccLabel = (pool: SpecAtom[]) => {
  const exact = [...new Set(pool.map((a) => a.cc).filter((c) => c > 0))];
  if (exact.length === 1) return String(exact[0]);
  const liters = [...new Set(pool.map((a) => a.liters).filter((n) => n > 0))];
  if (liters.length === 1) return formatLiter(liters[0]);
  return '';
};

export const canonDriveName = (pool: SpecAtom[]) => {
  const keys = [...new Set(pool.map((a) => a.drive).filter(Boolean))];
  if (keys.length === 1) return keys[0] === 'awd' ? 'AWD' : keys[0] === '2wd' ? '2WD' : agree(pool.map((a) => a.driveName));
  return '';
};

const FUEL_SHOW: Record<string, string> = {
  가솔린: '가솔린', 디젤: '디젤', 하이브리드: '하이브리드', 전기: '전기', 수소: '수소', lpg: 'LPG',
};

export const canonFuelName = (pool: SpecAtom[]) => {
  const keys = [...new Set(pool.map((a) => a.fuel).filter(Boolean))];
  if (keys.length === 1) return FUEL_SHOW[keys[0]] || agree(pool.map((a) => a.fuelName));
  return '';
};

export const fillSpecFields = (pool: SpecAtom[]) => {
  if (!pool.length) return { fuelName: '', driveName: '', ccVal: '' };
  return { fuelName: canonFuelName(pool), driveName: canonDriveName(pool), ccVal: ccLabel(pool) };
};

/** 이미 정확 cc 가 있으면 표시리터로 덮지 않는다. 리터만 있으면 정확 cc 로 올린다. */
export const nextCcWrite = (now: string, next: string) => {
  if (!next) return '';
  if (!now || now === next) return next;
  const nowN = parseOneCc(now);
  const nextN = parseOneCc(next);
  const nowExact = nowN >= 600 && !/\d+\.\d/.test(now);
  const nextLiters = /\d+\.\d/.test(next);
  if (nowExact && nextLiters && ccClose(nowN, nextN)) return now;
  return next;
};

export type GuardAtom = SpecAtom & { t: string };

const hintOf = (name: string, extra: Partial<SpecHint> = {}): SpecHint => ({
  nameHay: nk(name),
  fuel: fuelKey(name),
  cc: parseCc(name),
  seats: Number((name.match(/(\d+)\s*인승/) || [])[1] || 0),
  drive: driveKey(name),
  year: 0,
  ...extra,
});

const fail = (msg: string): never => {
  throw new Error(`encar-spec-fill 가드: ${msg}`);
};

const eq = (got: unknown, want: unknown, msg: string) => {
  if (got !== want) fail(`${msg} (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`);
};

/** A6 TFSI → A6 e-트론 leftover. 원자 JSON 없이 돌아간다. */
export function assertNameLockGuards() {
  eq(fuelKey('가솔린 전기'), '전기', '섞으면 전기가 이긴다 — 그래서 왼쪽·정제를 한 문자열로 안 넣는다');
  eq(fuelFromVehicle('가솔린', '아우디 A6(4세대) 40 TFSI', '전기'), '가솔린', '왼쪽 가솔린이 정제 leftover 전기보다 이긴다');
  eq(atomConflictsName({ model: 'a6e트론', modelName: 'A6 e-트론', sub: 'a6e트론', fuel: '전기' }, nk('아우디 A6(4세대) 40 TFSI Premium Milano'), '가솔린'), true, 'A6 TFSI ≠ A6 e-트론');
  eq(atomConflictsName({ model: 'ev6', modelName: 'EV6', sub: 'ev6', fuel: '전기' }, nk('EV6 롱 레인지 2WD 에어'), '전기'), false, 'EV6 에어는 EV6');
  eq(leftoverConflicts('A6 e-트론', nk('아우디 A6(4세대) 40 TFSI'), '가솔린', 'a6'), true, '정제 A6 e-트론 leftover');
  eq(leftoverConflicts('e-트론', nk('아우디 A6(5세대) 45 TFSI quattro Premium'), '가솔린', 'a6'), true, '정제 e-트론 leftover');
  eq(leftoverConflicts('EV6', nk('EV6 롱 레인지 2WD 에어'), '전기', 'ev6'), false, 'EV6 정제는 leftover 아님');
  eq(leftoverConflicts('니로', nk('디 올뉴니로EV 에어'), '전기', '니로'), true, '니로 ≠ 니로EV');
  eq(leftoverConflicts('G80 RG3', nk('더 올뉴G80 가솔린 2.5'), '가솔린', 'g80', 'sub'), false, '세부모델 세대코드는 leftover 아님');
  eq(atomConflictsName({ model: '니로', modelName: '니로', fuel: '가솔린' }, nk('디 올뉴니로EV 에어'), '전기'), true, '니로 가솔린 ≠ 니로EV');
  eq(atomConflictsName({ model: '리릭', modelName: '리릭', fuel: '전기' }, nk('XT6 가솔린 3.6 스포츠'), '가솔린', 'xt6'), true, '리릭 ≠ XT6');
  eq(atomConflictsName({ model: 'a6e트론', modelName: 'A6 e-트론', fuel: '전기' }, nk('A6 C8 가솔린 2.0 45 TFSI'), '가솔린', 'a6'), true, 'A6 C8 ≠ A6 e-트론 행키');
  eq(atomConflictsName({ model: '5시리즈', modelName: '5시리즈', fuel: '가솔린' }, nk('530i xDrive Luxury'), '가솔린', '5시리즈'), false, '5시리즈 T 는 차명 530i 만으로 지우지 않는다');
}

/** 스탬프·check 스크립트가 시작 때 돌린다. 깨지면 시트를 안 쓴다. */
export function assertEncarSpecFillGuards(atoms: GuardAtom[]) {
  assertNameLockGuards();

  eq(parseCc('1.6'), 1600, '1.6 은 1600cc');
  eq(parseCc('1.6L'), 1600, '1.6L');
  eq(parseCc('1.6리터'), 1600, '1.6리터');
  eq(parseCc('2.0'), 2000, '2.0 은 2000cc');
  eq(parseCc('2.5T'), 2500, '2.5T');
  eq(parseCc('3.5 T-GDi'), 3500, '3.5 T-GDi');
  eq(parseCc('1598'), 1598, '1598');
  eq(parseCc('1,598'), 1598, '1,598');
  eq(parseCc('1,600cc'), 1600, '1,600cc');
  eq(parseCc('2'), 2000, '칸 값 2 는 2.0L');
  eq(parseCc('16'), 0, '16 을 배기량으로 쓰지 않는다');
  eq(parseCc('20'), 0, '20 을 2.0L 로 읽지 않는다(점 없는 두 자리)');
  eq(parseCc('더 뉴 셀토스 1.6 터보 2WD 시그니처'), 1600, '차명 1.6');
  eq(parseCc('', '1.6', '더 뉴 셀토스 시그니처'), 1600, '왼쪽 1.6 이 차명보다 먼저');
  eq(fuelKey('더 뉴 셀토스 1.6 터보 2WD 시그니처'), '', '차명만 있으면 연료 키를 만들지 않는다');
  eq(fuelKey('가솔린'), '가솔린', '가솔린');
  eq(fuelKey('가솔린 더 뉴 셀토스 1.6'), '가솔린', '연료+차명');
  eq(driveKey('전륜'), '2wd', '전륜=2WD');
  eq(driveKey('AWD'), 'awd', 'AWD');
  eq(driveKey('4WD'), 'awd', '4WD=AWD');
  eq(driveKey('콰트로'), 'awd', '콰트로=AWD');
  eq(driveKey('4MATIC'), 'awd', '4MATIC');
  eq(nextCcWrite('1598', '1.6'), '1598', '정확 cc 를 리터로 격하하지 않는다');
  eq(nextCcWrite('1.6', '1598'), '1598', '리터는 정확 cc 로 올린다');
  eq(nextCcWrite('', '1.6'), '1.6', '빈 칸은 리터라도 채운다');

  const mixed: SpecAtom[] = [
    { fuel: '가솔린', fuelName: '가솔린', cc: 1598, liters: 1.6, seats: 0, drive: '2wd', driveName: '2WD', turbo: true, trimName: '시그니처', encarTrim: '시그니처', yearStart: 2023, yearEnd: 0 },
    { fuel: '가솔린', fuelName: '가솔린', cc: 1999, liters: 2, seats: 0, drive: 'awd', driveName: 'AWD', turbo: false, trimName: '시그니처', encarTrim: '시그니처', yearStart: 2023, yearEnd: 0 },
    { fuel: '가솔린', fuelName: '가솔린', cc: 0, liters: 0, seats: 0, drive: '', driveName: '', turbo: true, trimName: '시그니처', encarTrim: '시그니처', yearStart: 2023, yearEnd: 0 },
  ];
  const name16 = '더 뉴 셀토스 1.6 터보 2WD 시그니처';
  const filled = fillSpecFields(specPool(mixed, hintOf(name16, { year: 2023 })));
  eq(filled.ccVal, '1598', '1.6+2WD 힌트면 2.0/AWD/빈cc 를 버리고 1598');
  eq(filled.driveName, '2WD', '1.6+2WD 힌트면 2WD');
  eq(filled.fuelName, '가솔린', '연료');

  const only20 = mixed.filter((a) => a.cc > 1800);
  const contra = fillSpecFields(specPool(only20, hintOf(name16)));
  if (contra.ccVal && parseOneCc(contra.ccVal) > 1800) fail('힌트가 1.6 인데 2.0 만 있는 풀에 2.0 을 넣으면 안 된다');
  eq(contra.ccVal, '', '힌트와 안 맞으면 배기량을 비운다');

  const aliasDrive: SpecAtom[] = [
    { ...mixed[0], drive: '2wd', driveName: '전륜' },
    { ...mixed[0], drive: '2wd', driveName: '2WD', cc: 1591, liters: 1.6 },
  ];
  eq(fillSpecFields(aliasDrive).driveName, '2WD', '전륜+2WD 는 2WD 로 통일');
  eq(fillSpecFields(aliasDrive).ccVal, '1.6', '1598/1591 은 표시배기량 1.6');

  const t0620 = atoms.filter((a) => a.t === 'T-0620');
  if (t0620.length < 3) fail('원자 JSON 에 T-0620(더 뉴 셀토스 시그니처)이 없다');
  const live = fillSpecFields(specPool(t0620, hintOf(name16, { fuel: '가솔린', year: 2023 })));
  if (!live.ccVal) fail('실원자 T-0620 + 1.6 터보 2WD 는 배기량을 채워야 한다');
  if (driveKey(live.driveName) !== '2wd') fail(`실원자 T-0620 구동은 2WD 여야 한다 (got ${live.driveName})`);
  if (parseOneCc(live.ccVal) < 1500 || parseOneCc(live.ccVal) > 1700) fail(`실원자 T-0620 배기량은 1.6대여야 한다 (got ${live.ccVal})`);
}
