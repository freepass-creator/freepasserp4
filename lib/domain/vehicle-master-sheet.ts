/**
 * **「ERP4 차종마스터 원천대장」을 읽는 한 곳.**
 *
 * ★왜(사장님 2026-08-14 — 「그 차에 대해서 코드를 박아두면 절대 틀릴 일이 없음.
 *   차량번호에 코드 박아두면 되잖아」)
 *
 *   차종은 차번마다 한 번 정하면 안 바뀐다. 그런데 코드가 없으면 발행할 때마다 이름으로
 *   «알아맞혀야» 하고, 알아맞히는 한 언젠가는 틀린다. 실제로 하루에 세 번 틀렸다 —
 *   배터리 용량이 배기량으로(77400) · 파워트레인 44대 뒤집힘 · 세대 오판 27대.
 *   차번에 코드를 박으면 그 셋이 **생길 자리 자체가 없어진다.**
 *
 * ★코드는 **트림행키** — `mf-002.md-036.sm-ka4::v01::t01`
 *   (`마스터ID::파워트레인순번::트림순번`). 제조사부터 세부트림까지 한 줄로 정해진다.
 *
 * ⚠ **원천은 시트다.** `public/data/vehicle-master.json` 이 아니다 —
 *   그 파일에는 트림행키도 정확배기량도 없고, 같은 라벨(「디젤 2.2」)이 두 번 나와
 *   파워트레인을 구별할 방법이 없다. 시트에는 순번이 있어 구별된다.
 * ⚠ 관리상태 「제외」 줄은 **후보에서 뺀다.** 쓰지 않기로 한 줄인데 후보에 남겨 두면
 *   다섯 값이 같은 조합에서 그쪽이 뽑힐 수 있다.
 */

const S = (v: unknown) => String(v ?? '').trim();

/** 문서 — 사장님이 만든 원천대장. 탭 「차종마스터」가 트림 단위 표다. */
export const MASTER_SHEET_ID = '1T_RrErmGoj_yG9S1u7n--2NDolTOw8wA8ROQjPWuAlg';
export const MASTER_TAB = '차종마스터';

/** 한 줄이 곧 «한 차종»이다. 여기 있는 값이 상품시트 차종 칸의 정본이 된다. */
export type MasterRow = {
  code: string;          // 트림행키
  masterId: string;
  maker: string; model: string; subModel: string; powertrain: string; trim: string;
  fuel: string;
  /** 정확배기량(cc). 전기차는 빈 문자열이 정상이다 — 배터리 용량을 여기 넣지 마라. */
  cc: string;
  driveType: string; seat: string; batteryKwh: string;
  state: string;         // 관리상태 — 정상 / 검증중 / 제외
};

export type MasterBook = {
  byCode: Map<string, MasterRow>;
  /** 다섯 값 → 코드들. 하나면 그걸 쓰고, 여럿이면 **못 정한 것**이다. */
  byFive: Map<string, string[]>;
  /**
   * ★**연료·배기량·트림으로 잇는 열쇠.** 파워트레인 «라벨»은 표기가 갈린다 —
   *   시트는 「가솔린 2.5 FWD」, 우리 스냅은 「가솔린 2.5 2WD」다. 라벨로만 맞추면
   *   실측 2026-08-14 기준 476대 중 131대(27%)밖에 안 붙었다.
   *   **숫자는 표기가 안 흔들린다** — 2497cc 는 어디서나 2497이다.
   */
  bySpec: Map<string, string[]>;
  rows: MasterRow[];
};

/** 다섯 값을 하나의 열쇠로. 띄어쓰기·대소문자 차이로 안 갈리게 턴다. */
export const fiveKey = (maker: unknown, model: unknown, subModel: unknown, powertrain: unknown, trim: unknown) =>
  [maker, model, subModel, powertrain, trim].map((v) => S(v).replace(/\s+/g, ' ').toLowerCase()).join('|');

/** 연료·배기량·트림 열쇠. 구동방식은 **넣지 않는다** — 표기가 갈려서(2WD↔FWD) 뒤에서 가른다. */
/**
 * ★배기량은 **리터로 반올림해** 견준다.
 * ⚠ 시트는 «정확배기량»(2,999cc)이고 우리 스냅은 «표시배기량»(3,000cc)이다.
 *   숫자를 그대로 견주면 한 대도 안 맞는다 — 실측 2026-08-14. 둘 다 3.0L 로 보면 맞는다.
 */
export const liters = (cc: unknown) => {
  const n = Number(S(cc).replace(/[^\d]/g, ''));
  return n > 0 ? (Math.round(n / 100) / 10).toFixed(1) : '';
};

export const specKey = (maker: unknown, model: unknown, subModel: unknown, fuel: unknown, cc: unknown, trim: unknown) =>
  [maker, model, subModel, fuel, liters(cc), trim]
    .map((v) => S(v).replace(/\s+/g, ' ').toLowerCase()).join('|');

/**
 * 구동방식을 세 갈래로만 본다 — 앞·뒤·네바퀴.
 * ⚠ 시트는 FWD/AWD/RWD, 스냅은 2WD/4WD/AWD/4MATIC 을 쓴다. 글자로 견주면 절대 안 맞는다.
 * ⚠ 「2WD」는 앞일 수도 뒤일 수도 있다. 그래서 **열쇠에 안 넣고** 후보를 가를 때만 쓴다.
 */
export const driveClass = (v: unknown): 'front' | 'rear' | 'all' | '' => {
  const s = S(v).toUpperCase();
  if (/AWD|4WD|4MATIC|4MOTION|XDRIVE|QUATTRO|사륜/.test(s)) return 'all';
  if (/FWD|전륜/.test(s)) return 'front';
  if (/RWD|후륜/.test(s)) return 'rear';
  if (/2WD/.test(s)) return '';     // 앞뒤를 모른다 — 모르는 것을 안다고 하지 않는다
  return '';
};

/** 「차종마스터」 탭 값 표 → 코드책. */
export function readMasterSheet(rows: string[][]): MasterBook {
  const book: MasterBook = { byCode: new Map(), byFive: new Map(), bySpec: new Map(), rows: [] };
  if (!rows.length) return book;
  const hdr = (rows[0] || []).map(S);
  const at = (n: string) => hdr.indexOf(n);
  const c = {
    code: at('트림행키'), mid: at('마스터ID'), maker: at('제조사'), model: at('모델'), sub: at('세부모델'),
    pt: at('파워트레인'), trim: at('세부트림'), fuel: at('연료'), cc: at('정확배기량(cc)'),
    drive: at('구동방식'), seat: at('인승'), kwh: at('배터리(kWh)'), state: at('관리상태'),
  };
  if (c.code < 0) return book;
  const pick = (r: string[], i: number) => (i >= 0 ? S(r[i]) : '');
  for (const r of rows.slice(1)) {
    const code = pick(r, c.code);
    if (!code) continue;
    const row: MasterRow = {
      code, masterId: pick(r, c.mid),
      maker: pick(r, c.maker), model: pick(r, c.model), subModel: pick(r, c.sub),
      powertrain: pick(r, c.pt), trim: pick(r, c.trim), fuel: pick(r, c.fuel),
      // ⚠ 숫자만 남긴다. 「1,999cc」처럼 적힌 줄이 섞여 있다.
      cc: pick(r, c.cc).replace(/[^\d]/g, ''),
      driveType: pick(r, c.drive), seat: pick(r, c.seat).replace(/[^\d]/g, ''),
      batteryKwh: pick(r, c.kwh), state: pick(r, c.state),
    };
    book.byCode.set(code, row);
    book.rows.push(row);
    // ⚠ 「제외」는 후보에서 뺀다 — 쓰지 않기로 한 줄이다. 조회(byCode)로는 여전히 보인다.
    if (row.state === '제외') continue;
    const k = fiveKey(row.maker, row.model, row.subModel, row.powertrain, row.trim);
    book.byFive.set(k, [...(book.byFive.get(k) || []), code]);
    const sk = specKey(row.maker, row.model, row.subModel, row.fuel, row.cc, row.trim);
    book.bySpec.set(sk, [...(book.bySpec.get(sk) || []), code]);
  }
  return book;
}

/** 어떻게 정했나 — 조용히 틀린 코드가 박히지 않게 밖에서 셀 수 있어야 한다. */
export type CodePick = {
  code: string;
  /**
   * 왜 못 정했는지까지 돌려준다. 「없음」 하나로 뭉뚱그리면 **마스터에 뭘 더 넣어야 하는지**를
   * 알 수 없다 — 세부모델이 통째로 없는 것과 트림 이름만 다른 것은 할 일이 전혀 다르다.
   */
  how: '하나' | '여럿' | '세부모델없음' | '트림없음' | '배기량안맞음' | '없음';
  candidates: string[];
};

/** 그 세부모델이 마스터에 있기는 한가 — 없으면 «마스터에 넣을 차»다. */
function hasSubModel(book: MasterBook, maker: unknown, model: unknown, subModel: unknown) {
  const k = [maker, model, subModel].map((v) => S(v).replace(/\s+/g, ' ').toLowerCase()).join('|');
  return book.rows.some((r) => r.state !== '제외'
    && [r.maker, r.model, r.subModel].map((v) => S(v).replace(/\s+/g, ' ').toLowerCase()).join('|') === k);
}

/**
 * 다섯 값으로 코드를 정한다.
 * ⚠ **여럿이면 안 고른다.** 실측 2026-08-14: 다섯 값이 같은데 코드가 갈리는 조합이 98개다
 *   (카니발 KA4 「디젤 2.2 노블레스」가 v01·v02 둘 다에 있다 — 연식·사양이 달라 갈린 것).
 *   아무거나 박으면 그게 곧 «절대 안 틀린다»는 약속을 깨는 자리다.
 */
export function pickMasterCode(
  book: MasterBook,
  maker: unknown, model: unknown, subModel: unknown, powertrain: unknown, trim: unknown,
  fuel?: unknown, cc?: unknown,
): CodePick {
  /** ① 라벨이 그대로 맞으면 그게 제일 확실하다. */
  const byLabel = book.byFive.get(fiveKey(maker, model, subModel, powertrain, trim)) || [];
  if (byLabel.length === 1) return { code: byLabel[0], how: '하나', candidates: byLabel };

  /**
   * ② 라벨이 안 맞으면 **연료·배기량·트림**으로 찾는다. 숫자는 표기가 안 흔들린다.
   *    후보가 여럿이면 구동방식으로 가른다 — 그래도 하나로 안 좁혀지면 **안 고른다.**
   */
  if (liters(cc) || S(fuel)) {
    const ks = book.bySpec.get(specKey(maker, model, subModel, fuel, cc, trim)) || [];
    if (ks.length === 1) return { code: ks[0], how: '하나', candidates: ks };
    if (ks.length > 1) {
      const want = driveClass(powertrain);
      const narrowed = want ? ks.filter((k) => driveClass(book.byCode.get(k)?.driveType) === want) : [];
      if (narrowed.length === 1) return { code: narrowed[0], how: '하나', candidates: ks };
      return { code: '', how: '여럿', candidates: ks };
    }
  }
  if (byLabel.length > 1) return { code: '', how: '여럿', candidates: byLabel };
  /** 못 찾았으면 **어디서 갈렸는지**까지 짚어 준다. 그게 곧 사람이 할 일 목록이다. */
  if (!hasSubModel(book, maker, model, subModel)) return { code: '', how: '세부모델없음', candidates: [] };
  const sameTrim = book.rows.some((r) => r.state !== '제외'
    && S(r.maker).toLowerCase() === S(maker).toLowerCase()
    && S(r.model).toLowerCase() === S(model).toLowerCase()
    && S(r.subModel).replace(/\s+/g, ' ').toLowerCase() === S(subModel).replace(/\s+/g, ' ').toLowerCase()
    && S(r.trim).replace(/\s+/g, ' ').toLowerCase() === S(trim).replace(/\s+/g, ' ').toLowerCase());
  return { code: '', how: sameTrim ? '배기량안맞음' : '트림없음', candidates: [] };
}

/**
 * 코드 → 상품시트 차종 칸.
 * ★**여기가 유일한 변환 자리다.** 배기량을 파워트레인 «글자»에서 긁는 짓을 다시 하지 마라 —
 *   시트에 「정확배기량(cc)」이 이미 있고, 전기차는 그 칸이 비어 있는 것이 정상이다.
 */
export function masterCells(row: MasterRow | undefined): Record<string, string> {
  if (!row) return {};
  return {
    '제조사(정제)': row.maker,
    '모델': row.model,
    '세부모델': row.subModel,
    '파워트레인': row.powertrain,
    '세부트림': row.trim,
    '배기량(정제)': row.cc,
    '연료(정제)': row.fuel,
  };
}
