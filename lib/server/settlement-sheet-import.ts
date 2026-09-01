/**
 * **시트에 적힌 정산을 파이어베이스로 올린다** — 화면 단추와 명령줄이 «같은 코드»를 쓴다.
 *
 * ★사장님 2026-08-28 「지금 직원들이 시트에 입력하고 있잖아 · 파이어베이스에 올려서
 *   처리하는걸 만들어야해」 · 「ERP 화면에 단추를 달자」.
 *
 * ⚠ **쌍둥이가 있다 — `scripts/import-settlement-from-sheet.mts`.**
 *   명령줄은 서버 env 없이 `sa.json` 으로 직접 붙어야 해서 부팅이 다르다. 그래서 파일은 둘이다.
 *   **규칙(세 갈래·이력 잠금·빈칸은 안 지움·되읽기)은 반드시 같이 고친다.** 한쪽만 고치면
 *   어느 쪽으로 올렸느냐에 따라 원장이 달라진다.
 *
 * ★★★**세 갈래로 가른다.**
 * ```
 * 새 줄        시트에 있고 ERP 에 없다     → 올린다
 * 다른 칸      양쪽에 있는데 값이 다르다   → 보여만 준다. overwrite 라야 덮는다
 * ERP 에만     ERP 에서 접수한 줄이다      → ★건드리지 않는다
 * ```
 * ★**ERP 에서 사람이 고친 줄은 overwrite 여도 안 덮는다.** 이력(`v4/settlement_events`)이
 *   있으면 비켜 간다 — 시트가 창구라고 해서 담당자가 ERP 에서 고친 값을 되돌리면
 *   아무도 ERP 에서 안 고치게 된다.
 * ⚠ **시트가 빈칸인 것은 «지우라»가 아니다.** 창구가 아직 안 적었을 수 있다.
 */
import { getDatabase } from 'firebase-admin/database';
import { firebaseAdminApp } from '@/lib/server/firebase-admin';
import { SETTLEMENT_LEDGER_ID } from '@/lib/domain/settlement-ledger';
import { recordFromSheet, normalizeRecord, type SettlementRecord } from '@/lib/domain/settlement-record';
import { LEDGER_TABS, sheetsToken } from '@/lib/server/settlement-ledger-read';

const S = (v: unknown) => String(v ?? '').trim();
const NODE = 'v4/settlement_rows';
const EVENTS = 'v4/settlement_events';

/** 견줄 칸 — 원자만. 코드·시각·출처는 «어디서 왔나»라 견주지 않는다. */
const SKIP = new Set(['code', 'createdAt', 'updatedAt', 'fromSheet']);

/** 이력 키 — `settlement-store.eventKey` 와 같은 규칙이라야 같은 줄을 가리킨다. */
const eventKey = (plate: string, receivedAt: string) => `${plate}|${receivedAt}`.replace(/[.$#[\]/\s]/g, '_');

export type SheetImportDiff = { plate: string; field: string; sheet: string; erp: string; locked: boolean };
export type SheetImportPlan = {
  sheetRows: number;
  erpRows: number;
  /** 올릴 새 줄. */
  fresh: SettlementRecord[];
  /** 값이 다른 칸 — 기본은 안 덮는다. */
  diffs: SheetImportDiff[];
  /** ERP 에만 있는 줄 수. 건드리지 않는다. */
  onlyErp: number;
  /** 탭을 못 읽었으면 여기 남는다. 하나라도 있으면 «반쯤» 올리지 않는다. */
  unread: string[];
};

async function readSheetRecords(codeOf: Map<string, string>): Promise<{ made: Record<string, SettlementRecord>; unread: string[] }> {
  const token = await sheetsToken();
  const made: Record<string, SettlementRecord> = {};
  const unread: string[] = [];
  for (const tab of LEDGER_TABS) {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${SETTLEMENT_LEDGER_ID}/values/${encodeURIComponent(`'${tab}'!A1:BZ3000`)}?valueRenderOption=UNFORMATTED_VALUE`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
    if (!res.ok) { unread.push(`${tab} ${res.status}`); continue; }
    const body = await res.json() as { values?: unknown[][] };
    const all = (body.values || []).map((r) => (r || []).map(S));
    const hi = all.findIndex((r) => r.includes('차량번호'));
    if (hi < 0) { unread.push(`${tab} 머리글 없음`); continue; }
    const head = all[hi];
    for (const row of all.slice(hi + 1)) {
      const cell = (name: string) => { const i = head.indexOf(name); return i >= 0 ? S(row[i]) : ''; };
      if (!cell('차량번호')) continue;
      const rec = recordFromSheet(cell, { fromSheet: tab });
      const kept = codeOf.get(`${rec.plate}|${rec.receivedAt}`);
      made[kept || rec.code] = normalizeRecord({ ...rec, code: kept || rec.code });
    }
  }
  return { made, unread };
}

async function loadState(): Promise<{ have: Record<string, SettlementRecord>; touched: Map<string, number> }> {
  const db = getDatabase(firebaseAdminApp());
  const [rowsSnap, evSnap] = await Promise.all([
    db.ref(NODE).get().catch(() => null),
    db.ref(EVENTS).get().catch(() => null),
  ]);
  const have = (rowsSnap?.val() || {}) as Record<string, SettlementRecord>;
  const events = (evSnap?.val() || {}) as Record<string, Record<string, unknown>>;
  const touched = new Map<string, number>();
  for (const [k, byPush] of Object.entries(events)) {
    const n = Object.keys(byPush || {}).length;
    if (n) touched.set(k, n);
  }
  return { have, touched };
}

/** 무엇이 올라갈지 «세어만» 본다. 아무것도 안 쓴다. */
export async function planSheetImport(): Promise<SheetImportPlan> {
  const { have, touched } = await loadState();
  const codeOf = new Map(Object.values(have).map((r) => [`${S(r.plate)}|${S(r.receivedAt)}`, S(r.code)]));
  const { made, unread } = await readSheetRecords(codeOf);

  const fresh: SettlementRecord[] = [];
  const diffs: SheetImportDiff[] = [];
  for (const [code, want] of Object.entries(made)) {
    const got = have[code];
    if (!got) { fresh.push(want); continue; }
    const locked = touched.has(eventKey(S(want.plate), S(want.receivedAt)));
    for (const k of Object.keys(want) as (keyof SettlementRecord)[]) {
      if (SKIP.has(k as string)) continue;
      const a = S(want[k]);
      if (!a || a === S(got[k])) continue;
      diffs.push({ plate: S(want.plate), field: k as string, sheet: a, erp: S(got[k]), locked });
    }
  }
  return {
    sheetRows: Object.keys(made).length,
    erpRows: Object.keys(have).length,
    fresh,
    diffs,
    onlyErp: Object.keys(have).filter((c) => !made[c]).length,
    unread,
  };
}

export type SheetImportResult = {
  ok: boolean;
  reason?: string;
  added: number;
  overwritten: number;
  /** ERP 에서 고친 줄이라 비켜 간 수. */
  refused: number;
  diffs: number;
};

/** 실제로 올린다. `overwrite` 면 «다른 칸»도 시트 값으로 — 단 ERP 에서 고친 줄은 비켜 간다. */
export async function applySheetImport(opts?: { overwrite?: boolean }): Promise<SheetImportResult> {
  const { have, touched } = await loadState();
  const codeOf = new Map(Object.values(have).map((r) => [`${S(r.plate)}|${S(r.receivedAt)}`, S(r.code)]));
  const { made, unread } = await readSheetRecords(codeOf);
  // ★한 탭이라도 못 읽었으면 «반쯤» 올리지 않는다 — 안 읽힌 탭의 줄이 «없는 줄»로 보인다.
  if (unread.length) return { ok: false, reason: `시트를 못 읽었습니다 — ${unread.join(' · ')}`, added: 0, overwritten: 0, refused: 0, diffs: 0 };

  const patch: Record<string, SettlementRecord> = {};
  let added = 0; let overwritten = 0; let refused = 0; let diffs = 0;
  for (const [code, want] of Object.entries(made)) {
    const got = have[code];
    if (!got) { patch[code] = want; added += 1; continue; }
    const locked = touched.has(eventKey(S(want.plate), S(want.receivedAt)));
    const next: Record<string, unknown> = { ...got };
    let changed = false;
    for (const k of Object.keys(want) as (keyof SettlementRecord)[]) {
      if (SKIP.has(k as string)) continue;
      const a = S(want[k]);
      if (!a || a === S(got[k])) continue;
      diffs += 1;
      if (!opts?.overwrite || locked) continue;
      next[k as string] = want[k]; changed = true;
    }
    if (locked && opts?.overwrite) refused += 1;
    if (changed) { patch[code] = normalizeRecord({ ...(next as Partial<SettlementRecord>), code, updatedAt: Date.now() }); overwritten += 1; }
  }
  if (!Object.keys(patch).length) return { ok: true, added: 0, overwritten: 0, refused, diffs };

  const db = getDatabase(firebaseAdminApp());
  await db.ref(NODE).update(patch);

  // ★되읽어 대조 — 쓰기 성공 응답과 «값이 맞다»는 다른 말이다.
  const back = ((await db.ref(NODE).get()).val() || {}) as Record<string, SettlementRecord>;
  for (const [code, want] of Object.entries(patch)) {
    const got = back[code];
    if (!got) return { ok: false, reason: `${want.plate} 이(가) 안 올라갔습니다 — 되읽기 실패`, added, overwritten, refused, diffs };
  }
  return { ok: true, added, overwritten, refused, diffs };
}
