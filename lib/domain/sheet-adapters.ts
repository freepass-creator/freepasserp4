/**
 * 공급사별 시트 어댑터 레지스트리.
 * 기본 = generic(헤더 학습). 병적 양식만 코드 어댑터 추가.
 * v3 공용 source(autoplus|general) enum 금지 — partner.adapter_id 로 지정.
 */
import { type EntityRecord } from '@/lib/intake/entities';
import { parseDepositRule, type DepositRule } from '@/lib/domain/sheet-import';
import { isExactRealPlate } from '@/lib/domain/product';

export type SheetAdapterId = 'generic' | 'autoplus' | 'ianka' | 'sonogong';

export type SheetAdapter = {
  id: SheetAdapterId;
  label: string;
  /** 원본 표 → import용 표(헤더행 선택·상단 스킵). */
  prepareTable: (table: string[][], opts?: { headerRow?: number }) => string[][];
};

/** headerRow = 0-based. 그 위 행은 버림. */
function sliceFromHeader(table: string[][], headerRow = 0): string[][] {
  const i = Math.max(0, Math.min(headerRow, Math.max(0, table.length - 1)));
  return table.slice(i);
}

/**
 * 헤더 아래 안내·여백을 건너뛰고 첫 실차 데이터 블록만 남긴다.
 * 블록이 시작된 뒤 비데이터 행은 하단 과거 이력과의 경계로 취급한다.
 */
export function firstPlateBlockAfterHeader(table: string[][], maxLeadingRows = 20): string[][] {
  if (!table.length) return table;
  const header = table[0] || [];
  const plateColumn = header.findIndex((cell) => /^(차량번호|차번|차번호|등록번호)$/.test(
    String(cell ?? '').replace(/\s/g, ''),
  ));
  if (plateColumn < 0) throw new Error('차량번호 열 없음');
  const body: string[][] = [];
  let leading = 0;
  for (const row of table.slice(1)) {
    if (isExactRealPlate(String(row?.[plateColumn] ?? '').replace(/\s/g, ''))) {
      body.push(row);
      continue;
    }
    const shiftedColumn = (row || []).findIndex((cell, column) =>
      column !== plateColumn && isExactRealPlate(String(cell ?? '').replace(/\s/g, '')));
    if (!body.length && shiftedColumn >= 0) throw new Error('차량번호 열 이동 감지');
    if (!body.length) {
      leading++;
      if (leading > maxLeadingRows) throw new Error(`헤더 아래 ${maxLeadingRows}행 안에 차량 데이터 없음`);
      continue;
    }
    break;
  }
  if (!body.length) throw new Error('차량 데이터 없음');
  return [header, ...body];
}

/**
 * 그 행이 진짜 헤더인가.
 *
 * ⚠ "차량번호를 **포함**하는 행"으로 보면 안 된다 — 오토플러스 시트는 진짜 헤더(7행) 위에
 *   `★★★ 차량번호 클릭 후 차량이미지 다운로드 가능합니다. ★★★` 배너(5행)가 있어서
 *   그 배너가 헤더로 잡히고 본탭 94대가 통째로 유실됐다.
 * 판정: 칸 하나가 **차량번호/차번 그 자체**여야 하고, 그 행에 라벨이 3칸 이상 있어야 한다
 *   (배너는 보통 한 칸짜리 문장이다). 두 조건을 같이 걸어 '차량 번호'(공백)·'차번호' 변형도 살린다.
 */
function looksLikeHeader(row: string[] | undefined): boolean {
  const cells = (row || []).map((c) => String(c ?? '').trim());
  const labeled = cells.filter(Boolean).length;
  if (labeled < 3) return false;
  return cells.some((c) => /^(차량번호|차번|차번호|등록번호)$/.test(c.replace(/\s/g, '')));
}

export function findPlateHeaderRow(table: string[][]): number {
  // 공급사가 공지·요율표를 위에 추가해도 행 번호 설정에 의존하지 않는다.
  // 전체 1,000행을 훑어 본문의 반복 라벨을 헤더로 오인하지 않도록 상단 200행까지만 본다.
  for (let i = 0; i < Math.min(200, table.length); i++) {
    if (looksLikeHeader(table[i])) return i;
  }
  return -1;
}

/**
 * 지정 헤더행을 쓰되, 거기에 차량번호가 없으면 **찾아서 쓴다.**
 *
 * 실측(2026-07-31): 손오공·웰릭스 시트는 1행이 안내배너("구독 보증금 : 개월수 X 대여료"),
 * 2행이 빈 줄, **3행이 진짜 헤더**다. header_row 가 0이라 1행을 헤더로 읽어 매핑이 전멸했고
 * 손오공 37대·웰릭스 20대가 통째로 0대가 됐다. erp3 는 '차량번호'가 있는 행을 찾아 쓴다
 * (external-sheet.js syncFromSheet). 공급사가 상단에 안내문을 한 줄 더 넣어도 안 깨져야 한다.
 */
function resolveHeaderRow(table: string[][], headerRow?: number): number {
  const want = Math.max(0, headerRow ?? 0);
  if (looksLikeHeader(table[want])) return want;
  const detected = findPlateHeaderRow(table);
  if (detected >= 0) return detected;
  throw new Error('차량번호 헤더 행 없음 — 원본 시트의 헤더 이름을 확인하세요');
}

/** 무라벨 데이터 col11~14 → 개월 헤더 */
export const AUTOPLUS_PRICE_HEADERS = ['12개월', '24개월', '36개월', '48개월'] as const;

/**
 * 오토플러스 헤더는 **두 줄**이다 — 윗줄이 기간, 아랫줄이 약정주행.
 *
 *   열 11      12       13       14       15       16       17
 *   12개월    18개월   24개월   36개월   18개월   24개월   36개월
 *   3만km     2만km    2만km    2만km    3만km    3만km    3만km
 *
 * 예전에는 아랫줄을 «안내행»으로 보고 버린 뒤 열 11~14 를 12/24/36/48개월로 **못 박았다.**
 * 그래서 기간도 주행도 어긋났다 — 열 12(18개월 2만)가 24개월로 읽혀
 * 손님에게 「24개월 81만원」이 떴는데 실제 24개월은 72만원이었다(실측 2026-08-08 · 53나4472).
 * 두 줄을 합쳐 「18개월2만」 꼴로 만든다. 그러면 파서의 기간·주행 규칙이 그대로 먹는다.
 */
export function mergeAutoplusHeaderRows(top: string[], sub: string[]): string[] {
  const out = top.map((c) => String(c ?? '').trim());
  while (out.length < 15) out.push('');
  /*
   * ★★**이름이 «없는» 칸에만 붙인다.**
   *
   * ⚠⚠ 2026-09-05 실측 사고. 여기가 헤더가 무엇이든 6·7 번 칸을 「최초등록」·「주행거리」로
   *   **덮어쓰고** 있었다. 오토플러스 «제공시트»의 그 두 칸이 이름 없이 오기 때문에 붙인 규칙인데,
   *   같은 함수가 **판매시트 「오플구독」 탭**에도 걸리면서 그 탭의 6=세부트림 · 7=**외장**을 덮었다.
   *   그러면 자동매핑이 7번(외장) 칸을 주행거리로 «선점»하고 진짜 Km(10번)은 무시한다
   *   (`sheet-import.autoMapHeaders` — 먼저 만난 필드를 지킨다).
   *   ⇒ ERP 에 **주행거리 「블랙」·외장 빈칸**이 들어갔다. RP023 72대 · RP004 4대,
   *     전체 판매가능 721대의 10.5%다. 손님 화면에서는 주행거리가 통째로 안 떴다.
   *   ★코덱스가 2026-09-05 검토에서 이 줄을 짚었다(요청서: docs/crosscheck/REQUEST-codex-가게-일체감).
   * ⇒ **시트가 이름을 줬으면 그 이름을 믿는다.** 비어 있을 때만 우리가 붙인다 —
   *   원래 이 규칙이 필요했던 «이름 없는 칸»에서는 그대로 동작한다.
   */
  if (!out[6]) out[6] = '최초등록';
  if (!out[7]) out[7] = '주행거리';
  for (let i = 0; i < out.length; i++) {
    // 한 칸 안에 줄바꿈으로 들어온 경우 — 실제 오플 시트가 이 모양이다(「12개월 / 3만km」 한 셀).
    const cell = out[i].replace(/\s+/g, ' ').trim();
    const inCell = /^(\d+)\s*개월\s*(\d+)\s*만\s*km$/i.exec(cell);
    if (inCell) { out[i] = `${inCell[1]}개월${inCell[2]}만`; continue; }
    const period = /^(\d+)\s*개월$/.exec(cell);
    if (!period) continue;
    // 두 행으로 갈려 온 경우 — 아랫줄에서 주행을 가져온다.
    const km = /(\d+)\s*만\s*km/i.exec(String(sub?.[i] ?? ''));
    out[i] = km ? `${period[1]}개월${km[1]}만` : `${period[1]}개월`;
  }
  return out;
}

/** @deprecated 두 줄 헤더를 합치는 `mergeAutoplusHeaderRows` 를 쓴다. */
export function labelAutoplusHeaderRow(header: string[]): string[] {
  const out = mergeAutoplusHeaderRows(header, []);
  // 구형 오플 표는 가격 4칸의 머리글이 완전히 비어 있다. 이미 기간명이 있는 최신 2단
  // 헤더는 그대로 두고, 빈 11~14열에만 과거 확정 규격을 붙인다.
  while (out.length < 15) out.push('');
  AUTOPLUS_PRICE_HEADERS.forEach((name, offset) => {
    const index = 11 + offset;
    if (!String(out[index] || '').trim()) out[index] = name;
  });
  return out;
}

export const SHEET_ADAPTERS: Record<SheetAdapterId, SheetAdapter> = {
  generic: {
    id: 'generic',
    label: '일반(헤더 학습)',
    prepareTable: (table, opts) => sliceFromHeader(table, resolveHeaderRow(table, opts?.headerRow)),
  },
  /**
   * 오토플러스식 — 판매차량리스트: 헤더 자동탐지(또는 headerRow>0).
   * 무라벨 col6/7/11~14 → 최초등록·주행·12/24/36/48개월.
   * 헤더 다음 안내/배너 1행 스킵.
   */
  autoplus: {
    id: 'autoplus',
    label: '오토플러스식',
    prepareTable: (table, opts) => {
      const headerRow = resolveHeaderRow(table, opts?.headerRow);
      const sliced = sliceFromHeader(table, headerRow);
      if (!sliced.length) return sliced;
      let body = sliced.slice(1);
      /**
       * 헤더 다음 줄이 «약정주행»이면 그건 안내행이 아니라 **헤더의 두 번째 줄**이다.
       * 버리면 「18개월 2만/3만」을 가를 근거가 사라진다.
       */
      const second = body[0] || [];
      const isKmRow = second.some((c) => /\d+\s*만\s*km/i.test(String(c ?? '')));
      const header = mergeAutoplusHeaderRows(sliced[0] || [], isKmRow ? second : []);
      if (isKmRow) body = body.slice(1);
      else if (body.length >= 1) {
        const maybeGuide = body[0] || [];
        const guideBlank = !maybeGuide.some((c) => String(c || '').trim());
        // ★차량번호 열 위치는 표마다 다르다 — 옛 오플 원본은 2번째, 우리 「오플구독」 발행표는 3번째다.
        //   위치를 1로 못 박아 두면 우리 표의 **첫 차가 안내행으로 오인돼 통째로 빠진다**(실측 2026-08-20 48나2076).
        const plateIdx = header.findIndex((cell) => /차량번호|차번/.test(String(cell ?? '')));
        const plateCell = String(maybeGuide[plateIdx >= 0 ? plateIdx : 1] || '').replace(/\s/g, '');
        const pendingPlate = /^(?:-|–|—|0|미정|번호미정|차량미정|신차|미등록|미발급)$/i.test(plateCell)
          || (!plateCell && maybeGuide.slice(2, 9).some((cell) => String(cell || '').trim()));
        const guideNoPlate = !/차량번호|차번/.test(String(maybeGuide[plateIdx >= 0 ? plateIdx : 0] || ''))
          && !isExactRealPlate(plateCell)
          && !pendingPlate;
        if (guideBlank || guideNoPlate) body = body.slice(1);
      }
      return [header, ...body];
    },
  },
  /**
   * 손오공 구독식 — 한 행에 요금표가 **두 벌 나란히** 있는 탭.
   *
   *   행1   …            11:인수형 ─────────┐   17:반납형 ─────────┐
   *   행2   배차상태 차번 … 11:보증금 12 24 36 48 60 │ 17:보증금 12 24 …
   *
   * 그룹 머리(행1)를 아래 열 이름에 붙여 두 블록을 가른다.
   *   반납형 → 「12개월」 그대로       → price 키 `12`        ← 시트·표에 나가는 기본값
   *   인수형 → 「12개월 인수형」        → price 키 `12_인수형`  ← 상세페이지에서만
   *
   * ★반납형이 기본이다(사장님 2026-08-10). 인수형 블록이 시트에서 **앞에** 있어서
   *   그대로 두면 파서가 인수형을 기본값으로 읽는다 — 실측 22대가 그 상태였고
   *   카니발 36개월이 1,050,000(인수형) / 907,000(반납형)으로 14만원 틀렸다.
   *
   * ⚠ 그룹 머리가 없으면(=한 벌짜리 표) 손대지 않는다 — 렌트 탭은 generic 과 같게 동작한다.
   */
  sonogong: {
    id: 'sonogong',
    label: '손오공식(두 벌 요금표)',
    prepareTable: (table, opts) => {
      const headerRow = resolveHeaderRow(table, opts?.headerRow);
      const sliced = sliceFromHeader(table, headerRow);
      if (!sliced.length) return sliced;
      // 그룹 머리는 진짜 헤더 «바로 위» 행이다. 없으면 평범한 표다.
      const group = headerRow > 0 ? (table[headerRow - 1] || []) : [];
      const flat = (v: unknown) => String(v ?? '').replace(/\s/g, '');
      if (!group.some((c) => /^(인수형|반납형)$/.test(flat(c)))) return sliced;

      const header = [...(sliced[0] || [])];
      let form = '';
      for (let i = 0; i < header.length; i++) {
        const g = flat(group[i]);
        if (g === '인수형' || g === '반납형') form = g;
        if (!form) continue;
        const name = flat(header[i]);
        // 요금·보증금 칸만 이름을 바꾼다. 그 밖(소비자가격·연주행 …)은 그대로 둔다.
        if (/^\d+개월$/.test(name)) header[i] = form === '반납형' ? name : `${name} ${form}`;
        else if (name === '보증금') header[i] = form === '반납형' ? '장기보증' : `장기보증 ${form}`;
        else form = '';   // 요금 블록이 끝났다
      }
      return [header, ...sliced.slice(1)];
    },
  },
  /**
   * 이안카 — 같은 탭 중간부터 상태·입고일자 칸이 빠져 행이 왼쪽으로 밀리는 원본 보정.
   * 실제 `구분` 헤더 위치를 찾아 행 첫 칸이 상품구분일 때만 앞 빈 칸을 복원한다.
   */
  ianka: {
    id: 'ianka',
    label: '이안카식',
    prepareTable: (table, opts) => {
      const headerRow = resolveHeaderRow(table, opts?.headerRow);
      const sliced = sliceFromHeader(table, headerRow);
      if (!sliced.length) return sliced;
      const header = sliced[0] || [];
      const productTypeColumn = header.findIndex((cell) => /^(구분|상품구분|렌트구분)$/.test(String(cell || '').replace(/\s/g, '')));
      if (productTypeColumn < 0) throw new Error('이안카 구분 헤더 열 없음');
      const isProductType = (value: unknown) => /^(?:신차(?:\(선출고\))?|신차렌트|신차구독|재렌트|재구독|중고렌트|중고구독)$/i.test(
        String(value ?? '').replace(/\s/g, ''),
      );
      const body = sliced.slice(1).map((row) => {
        if (productTypeColumn > 0 && isProductType(row[0]) && !isProductType(row[productTypeColumn])) {
          return [...Array.from({ length: productTypeColumn }, () => ''), ...row];
        }
        return row;
      });
      return [header, ...body];
    },
  },
};

export const ADAPTER_OPTIONS: { value: SheetAdapterId; label: string }[] = (
  Object.values(SHEET_ADAPTERS).map((a) => ({ value: a.id, label: a.label }))
);

/** 명시 설정을 최우선하고, 레거시 미설정 AutoPlus만 코드·이름으로 보정한다. */
export function effectiveSheetAdapterId(partner: EntityRecord): SheetAdapterId {
  const explicit = String(partner.adapter_id || '').trim();
  if (explicit === 'generic' || explicit === 'autoplus' || explicit === 'ianka' || explicit === 'sonogong') return explicit;
  if (explicit) throw new Error(`시트 어댑터 설정 오류 — ${explicit}`);
  return /autoplus|오토플러스|RP023/i.test(
    `${partner.partner_code || partner._key || ''} ${partner.name || ''} ${partner.partner_name || ''}`,
  ) ? 'autoplus' : 'generic';
}

export function resolveAdapter(partnerOrId?: EntityRecord | string | null): SheetAdapter {
  const id = typeof partnerOrId === 'string'
    ? partnerOrId.trim()
    : effectiveSheetAdapterId(partnerOrId || {});
  if (id !== 'generic' && id !== 'autoplus' && id !== 'ianka' && id !== 'sonogong') throw new Error(`시트 어댑터 설정 오류 — ${id}`);
  return SHEET_ADAPTERS[id];
}

/**
 * 멀티탭 공급사의 정본 우선순위.
 *
 * 이안카는 같은 차량이 메인 탭(신차 선출고 조건)과 재렌트 탭(실차 주행거리·재렌트 요금)에
 * 함께 존재할 수 있다. 이 경우 재렌트 탭이 더 구체적인 현재값이므로 설정에 적힌 순서와
 * 무관하게 먼저 읽는다. 그 밖의 공급사는 관리자가 지정한 탭 순서를 그대로 보존한다.
 */
export function orderSheetGids(adapter: SheetAdapter, gids: string[]): string[] {
  if (adapter.id !== 'ianka') return [...gids];
  const priority = new Map([
    ['126495265', 0], // 이안카 재렌트
    ['2008897223', 1], // 이안카 메인
  ]);
  return gids
    .map((gid, index) => ({ gid, index, priority: priority.get(gid) ?? 100 }))
    .sort((a, b) => a.priority - b.priority || a.index - b.index)
    .map(({ gid }) => gid);
}

/**
 * partner 레코드에서 시트 연동 옵션 추출.
 *
 * `sheet_tab` 은 **탭을 여러 개 적을 수 있다**(`0,1718488412,1505082236`).
 * 재고를 탭으로 쪼개 두는 공급사가 실제로 있다 — 빌린카는 3탭에 45대가 나뉘어 있는데
 * 한 탭만 읽으면 21대만 올라가고 나머지 24대는 "시트에 없음" → 출고불가로 내려간다.
 */
export function partnerSheetOpts(p: EntityRecord): {
  url: string;
  gid: string;
  gids: string[];
  headerRow: number;
  adapter: SheetAdapter;
  providerCode: string;
  profileRaw: unknown;
  depositRule: DepositRule;
} {
  const url = String(p.sheet_url || '').trim();
  const raw = String(p.sheet_gid || p.sheet_tab || '').trim();
  const gidTokens = raw ? raw.split(/[,\s|]+/).filter(Boolean) : [];
  const invalidGid = gidTokens.find((token) => !/^\d+$/.test(token));
  if (invalidGid) throw new Error(`시트 gid 설정 오류 — ${invalidGid}`);
  const adapter = resolveAdapter(p);
  const gids = orderSheetGids(adapter, gidTokens);
  const gid = gids[0] || '';
  const headerRow = Math.max(0, Number(p.header_row) || 0);
  return {
    url,
    gid,
    gids,
    headerRow,
    adapter,
    providerCode: String(p.partner_code || p._key || ''),
    profileRaw: p.mapping_profile,
    // 시트 보증금 칸이 빌 때 채우는 공급사 규칙(손오공 구독 = N개월치). 미설정이면 안 채운다.
    depositRule: parseDepositRule(p.deposit_rule),
  };
}
