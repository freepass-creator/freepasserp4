/**
 * **차량번호 대장 — 한 번 본 차는 잊지 않는다.**
 *
 * ★사장님 2026-08-26
 *   「상품리스트를 상품시트에 쌓아서 차량번호만 누르면 모델 공급사 나오게 해주자」
 *   「상품리스트 업데이트할때 누적으로 차량번호 모델명 공급사 정보만 인지해서
 *     차량번호 쓰면 공급사 모델명 끌고오게」
 *
 * ─────────────────────────────────────────────────────────────────────
 * ★★★**왜 «누적»이어야 하나 — 재고는 지워지기 때문이다.**
 *   재고(`v4/products`)는 «지금 팔 수 있는 차»만 담는다. 팔리면 빠진다.
 *   그런데 정산은 «팔린 뒤»에 일어난다 — 접수·인도·청구가 다 그 뒤다.
 *   실측 2026-08-26: **원장 406대 중 375대(92%)가 지금 재고에 없다.**
 *   그래서 「차량번호를 고르면 모델명·공급사가 따라온다」가 사실상 안 돌고 있었다.
 *
 * ★★**담는 것은 셋뿐이다** — 차량번호 · 모델명 · 공급사.
 *   대여료·상태·사진은 여기 담지 않는다. 그건 «지금»의 값이라 시간이 지나면 거짓이 된다.
 *   이 셋은 차에 붙박인 사실이라 시간이 지나도 안 변한다.
 *
 * ★★**한 번 담은 값은 «비어 있을 때만» 채운다.**
 *   같은 차가 다시 올라오면서 모델명이 빠져 있을 수 있다(공급사 시트가 그때그때 다르다).
 *   빈 값으로 덮으면 알던 것을 잃는다. ⇒ 채우기만 하고 지우지 않는다.
 *   ⚠ 값이 «달라졌을» 때는 새 값이 이긴다 — 차명이 정제되면 좋아지는 쪽이라서다.
 *
 * ⚠ 여기는 «이름을 아는» 곳이지 «팔 수 있는지»를 아는 곳이 아니다.
 *   출고가능·상태를 여기서 판단하지 마라. 그건 재고가 안다.
 */

const S = (v: unknown) => String(v ?? '').trim();

/**
 * 대장 한 줄.
 *
 * ★★**차명은 «세 축»으로 나눠 담는다** — 사장님 2026-08-26 「모델명 세부모델 세부트림 구조로」.
 *   집 규격이기도 하다(차명 = 세부모델 + 세부트림, 제조사·모델은 위 축).
 *   ⚠ 한 칸에 이어 붙여 담지 마라. 붙이면 다시 못 가른다 —
 *     실측: 「베뉴 · 베뉴 · 프리미엄」을 이으면 「베뉴 베뉴 프리미엄」이 된다.
 */
export type PlateEntry = {
  /** 차량번호 — 열쇠 */
  plate: string;
  /** 모델 (예: 싼타페) */
  model: string;
  /** 세부모델 (예: 싼타페 MX5) */
  subModel: string;
  /** 세부트림 (예: 익스클루시브) */
  trim: string;
  /** 공급사 — 이름(코드 아님). 정산원장이 이름으로 적기 때문이다 */
  supplier: string;
  /** 처음 본 날 · 마지막으로 본 날 (`YYYY-MM-DD`) */
  firstSeen: string;
  lastSeen: string;
};

/** 들어오는 값 — 어디서 왔든 이 모양으로 바꿔서 준다. */
export type PlateInput = { plate: unknown; model?: unknown; subModel?: unknown; trim?: unknown; supplier?: unknown };

/**
 * 화면·문서에 찍는 «차명» — 세부모델 + 세부트림.
 * ★집 규격이다. 제조사·모델은 위 축이라 여기 안 붙인다.
 *   세부모델이 비면 모델로 떨어진다 — 이름이 아예 없는 것보다 낫다.
 */
export const carName = (e: Pick<PlateEntry, 'model' | 'subModel' | 'trim'>): string =>
  [S(e.subModel) || S(e.model), S(e.trim)].filter(Boolean).join(' ');

/**
 * 차량번호를 대장 열쇠로. RTDB 키에 못 쓰는 글자를 뺀다.
 * ★차번은 한글이 섞여 있고(`60호1234`) 공백·하이픈이 붙어 오기도 한다.
 */
export const plateKey = (v: unknown) => S(v).replace(/[\s.$#[\]/-]/g, '');

/** 차번처럼 안 생긴 값 — 대장에 넣지 않는다. */
const NOT_A_PLATE = /^(미정|미배정|미상|없음|-|tbd|n\/a)$/i;
export const isPlate = (v: unknown): boolean => {
  const t = plateKey(v);
  // 「60호1234」 「12가3456」 「서울12가3456」 — 숫자로 끝나고 한글이 하나는 있어야 한다
  return t.length >= 5 && t.length <= 12 && !NOT_A_PLATE.test(S(v)) && /[가-힣]/.test(t) && /\d$/.test(t);
};

/**
 * **대장에 한 줄을 얹는다.** 이미 있으면 «비어 있는 칸만» 채운다.
 *
 * @param prev  대장에 있던 줄 (없으면 `null`)
 * @param next  새로 본 값
 * @param today `YYYY-MM-DD`
 * @returns 바뀐 줄. 바뀔 게 없으면 `null` — 쓰지 않아도 된다는 뜻이다
 */
export function mergeEntry(prev: PlateEntry | null, next: PlateInput, today: string): PlateEntry | null {
  const plate = S(next.plate);
  if (!isPlate(plate)) return null;

  const model = S(next.model);
  const subModel = S(next.subModel);
  const trim = S(next.trim);
  const supplier = S(next.supplier);

  if (!prev) {
    return { plate, model, subModel, trim, supplier, firstSeen: today, lastSeen: today };
  }

  // ★새 값이 있으면 이긴다. **없으면 옛 값을 지키다** — 빈 값으로 덮지 않는다.
  const merged: PlateEntry = {
    plate: prev.plate || plate,
    model: model || prev.model,
    subModel: subModel || prev.subModel,
    trim: trim || prev.trim,
    supplier: supplier || prev.supplier,
    firstSeen: prev.firstSeen || today,
    lastSeen: today,
  };
  const same = merged.model === prev.model && merged.subModel === prev.subModel
    && merged.trim === prev.trim && merged.supplier === prev.supplier
    && merged.lastSeen === prev.lastSeen && merged.plate === prev.plate;
  return same ? null : merged;
}

/**
 * 여러 줄을 한꺼번에 얹는다.
 * @returns 실제로 바뀐 줄만 — 그대로인 것은 안 돌려준다(쓰기를 줄인다)
 */
export function mergeAll(
  have: Record<string, PlateEntry>,
  rows: PlateInput[],
  today: string,
): { changed: Record<string, PlateEntry>; added: number; updated: number; skipped: number } {
  const changed: Record<string, PlateEntry> = {};
  let added = 0; let updated = 0; let skipped = 0;
  for (const r of rows) {
    const k = plateKey(r.plate);
    if (!isPlate(r.plate)) { skipped++; continue; }
    // ★같은 판(batch) 안에 같은 차가 또 나오면 방금 만든 값 위에 얹는다.
    const prev = changed[k] || have[k] || null;
    const out = mergeEntry(prev, r, today);
    if (!out) continue;
    changed[k] = out;
    if (have[k]) updated++; else if (!changed[k]) added++;
  }
  // added 를 다시 센다 — 위 반복문에서 changed 를 먼저 넣어 버려 세기가 어긋난다
  added = Object.keys(changed).filter((k) => !have[k]).length;
  updated = Object.keys(changed).length - added;
  return { changed, added, updated, skipped };
}

/** 대장에서 한 대를 찾는다. 못 찾으면 `null` — «모른다»고 말해야 사람이 직접 적는다. */
export const lookup = (have: Record<string, PlateEntry>, plate: unknown): PlateEntry | null =>
  have[plateKey(plate)] ?? null;
