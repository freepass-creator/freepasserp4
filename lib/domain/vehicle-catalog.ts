/**
 * **차종사전 — 재고관리 상품등록의 드롭다운. 뿌리는 «차종마스터»다.**
 *
 * ★사장님이 그린 구조(2026-08-23)
 *   「공급사가 편하게 입력 → 그걸 **차종마스터와 연동해서 정제칸에 반영**하고 →
 *    ERP 는 정제칸과 공급사가 올린 것을 **보여주기로 그대로 활용**한다 →
 *    **정제칸은 차종마스터를 그대로 가져온 것**이고 → **ERP 직접입력도 차종마스터 기준으로 설계**한다」
 *
 *   기준이 하나이므로 정제칸과 ERP 입력이 **저절로 같아진다.** 그게 「오류를 없게 하는 것이 관건」의 답이다.
 *
 * ★걷어낸 것은 «마스터»가 아니라 «맞히기»다
 *   옛 구조는 유입 때마다 차종마스터에 **스냅**해서 이름을 갈아끼웠다. 그게 사고를 냈다 —
 *   트림을 못 찾으면 빈칸으로 만들었고(세부트림 19%), 한 번 확정된 값은 시트가 못 덮었다(219대 영구 빈칸).
 *   그래서 **추측기로 쓰던 것을 끊었다.** 마스터는 여전히 «기준»이다 — 사람이 고르는 목록.
 *
 * ⚠ 사전은 **닫힌 목록이 아니다.** 재고관리에서 목록에 없는 이름도 손으로 적을 수 있어야 한다 —
 *   새 차가 들어오는 길을 막으면 안 되고, 그 값은 다음 갱신 때 사전이 흡수한다.
 */

export type CatalogRow = {
  maker: string;
  model: string;
  sub_model: string;
  trim_name: string;
  /** 이 조합으로 지금 굴러가는 대수(정제칸 실적). 많이 쓰는 이름이 목록 위로 온다. */
  n: number;
  /**
   * 어디서 왔나.
   * · `마스터`  — 차종마스터에 있는 줄. **기준이다.**
   * · `정제칸`  — 마스터엔 아직 없는데 공급사 정제칸에서 굴러가는 조합. 빠뜨리면 그 차를 못 고른다.
   * · `손추가`  — 사람이 시트 「차종사전」에 적은 줄(사장님 2026-08-23 「필요하면 정제시트랑 차종마스터를 추가해서 반영할 거야」).
   *              재고에 아직 없는 차를 미리 넣어 두는 자리 — 갱신해도 안 지워진다.
   */
  from: '마스터' | '정제칸' | '손추가';
};

export type VehicleCatalog = {
  /** 만든 때(YYYY-MM-DD). 사전이 언제 것인지 화면이 밝힐 수 있게. */
  built: string;
  rows: CatalogRow[];
};

export const EMPTY_CATALOG: VehicleCatalog = { built: '', rows: [] };

const S = (v: unknown) => String(v ?? '').trim();

/** 축의 앞자리들. 「모델」을 고르려면 「제조사」가, 「세부모델」을 고르려면 그 앞 둘이 정해져야 좁혀진다. */
const BEFORE: Record<string, ('maker' | 'model' | 'sub_model')[]> = {
  maker: [],
  model: ['maker'],
  sub_model: ['maker', 'model'],
  trim_name: ['maker', 'model', 'sub_model'],
};

/**
 * 한 축의 선택지를 낸다 — **앞 축이 정해진 만큼만 좁힌다.**
 * 앞 축이 비어 있으면 좁히지 않고 전부 준다(제조사를 안 고르고 모델부터 뒤지는 사람도 있다).
 * 많이 쓰는 이름이 위로 온다 — 목록을 훑는 시간이 곧 등록 시간이다.
 */
export function catalogOptions(
  catalog: VehicleCatalog,
  axis: 'maker' | 'model' | 'sub_model' | 'trim_name',
  picked: Partial<Record<'maker' | 'model' | 'sub_model', string>>,
): string[] {
  const count = new Map<string, number>();
  for (const row of catalog.rows) {
    let fits = true;
    for (const before of BEFORE[axis]) {
      const want = S(picked[before]);
      if (want && S(row[before]) !== want) { fits = false; break; }
    }
    if (!fits) continue;
    const value = S(row[axis]);
    if (!value) continue;
    count.set(value, (count.get(value) || 0) + row.n);
  }
  return [...count].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ko')).map(([v]) => v);
}

/**
 * 고른 조합에 딸린 제원을 돌려준다 — 같은 조합이 하나로 정해질 때만.
 * ⚠ 두 갈래 이상이면 **아무것도 돌려주지 않는다.** 반쯤 맞는 값을 채우는 것이 옛 마스터가 낸 사고였다.
 */
export function catalogRowFor(
  catalog: VehicleCatalog,
  picked: Partial<Record<'maker' | 'model' | 'sub_model' | 'trim_name', string>>,
): CatalogRow | null {
  const hits = catalog.rows.filter((row) => (
    (['maker', 'model', 'sub_model', 'trim_name'] as const).every((axis) => {
      const want = S(picked[axis]);
      return !want || S(row[axis]) === want;
    })
  ));
  return hits.length === 1 ? hits[0] : null;
}

type RawRow = { maker?: unknown; model?: unknown; sub_model?: unknown; trim_name?: unknown };

/**
 * 사전을 만든다 — **차종마스터(기준) + 정제칸 실적 + 손추가**.
 *
 * · `master` = 차종마스터. **뿌리다.** 사장님이 여기 차종을 더하면 드롭다운에 바로 뜬다.
 * · `live`   = 공급사 정제칸에 지금 적혀 있는 조합. 두 가지 일을 한다 —
 *              ① 마스터에 아직 없는 조합을 담는다(굴러가는 차가 목록에서 빠지면 안 된다).
 *              ② 대수를 세어 **많이 쓰는 이름을 목록 위로** 올린다.
 * · `byHand` = 시트 「차종사전」에 사람이 적은 줄. 재고에 없는 차를 미리 넣어 두는 자리.
 *
 * ⚠ 세 갈래가 같은 조합을 가리키면 **출처는 마스터가 이긴다** — 기준이 어디인지 표에서 흐려지면 안 된다.
 *   대수는 어느 출처든 정제칸 실적에서만 센다(마스터에 있다고 굴러가는 건 아니다).
 */
export function buildCatalog(master: RawRow[], live: RawRow[], built: string, byHand: RawRow[] = []): VehicleCatalog {
  const acc = new Map<string, CatalogRow>();
  const RANK: Record<CatalogRow['from'], number> = { 마스터: 3, 정제칸: 2, 손추가: 1 };
  const put = (row: RawRow, from: CatalogRow['from'], counts: boolean) => {
    const maker = S(row.maker); const model = S(row.model);
    const sub = S(row.sub_model); const trim = S(row.trim_name);
    // 제조사·모델이 없으면 사전에 세울 수 없다 — 뒤 축을 좁히는 뿌리다.
    if (!maker || !model) return;
    const key = [maker, model, sub, trim].join(' ');
    const cur = acc.get(key);
    if (!cur) { acc.set(key, { maker, model, sub_model: sub, trim_name: trim, n: counts ? 1 : 0, from }); return; }
    if (counts) cur.n += 1;
    if (RANK[from] > RANK[cur.from]) cur.from = from;
  };
  for (const row of master) put(row, '마스터', false);
  for (const row of live) put(row, '정제칸', true);
  for (const row of byHand) put(row, '손추가', false);
  return {
    built,
    rows: [...acc.values()].sort((a, b) => (
      a.maker.localeCompare(b.maker, 'ko')
      || a.model.localeCompare(b.model, 'ko')
      || a.sub_model.localeCompare(b.sub_model, 'ko')
      || a.trim_name.localeCompare(b.trim_name, 'ko')
    )),
  };
}
