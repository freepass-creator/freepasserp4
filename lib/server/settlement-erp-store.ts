/**
 * **정산 저장소 — 파이어베이스 쪽.** 시트를 대신한다.
 *
 * ★사장님 2026-08-26
 *   「구글시트를 대체할수 있게끔 만들어줘 / 시트를 연동하는게 아니라 우리가 erp에서 직접 관리하는거로」
 *   「시트는 나중에 한번 데이터 가져갈때만 쓰고 그 이후에는 파이어베이스에 기입해서 정산해야지」
 *
 * ─────────────────────────────────────────────────────────────────────
 * ★★★**부르는 쪽이 «시트인지 ERP인지» 몰라야 한다.**
 *   그래서 `listRows`·`appendIntake`·`patchRow` 가 시트 쪽과 **똑같은 모양**을 내고 받는다.
 *   화면·API 는 한 글자도 안 고친다. 갈아타는 자리는 `settlement-store.ts` 한 곳뿐이다.
 *
 * ★★**담는 것은 원자뿐.** 자리(탭)·청구월·청구액은 안 담고 계산한다(`settlement-record.ts`).
 *   ⇒ 시트의 탭 넷은 여기서 사라진다. `tab` 은 «계산해서» 돌려준다 — 부르는 쪽이 쓰던 값이라서다.
 *
 * ★★**열쇠는 둘이다.**
 * ```
 * 저장 열쇠   stl_… 대체키   — RTDB 의 자리. 절대 안 바뀐다
 * 찾는 열쇠   차번 + 접수일   — 사람이 부르는 이름. 화면·API 가 이걸로 온다
 * ```
 *   ⚠ 접수일을 고치면 «찾는 열쇠»는 바뀌지만 «저장 열쇠»는 안 바뀐다. 그래서 줄을 안 잃는다.
 *     시트에서는 이게 안 됐다 — 접수일을 고치면 그 줄을 다시 못 찾았다.
 *
 * ⚠ **v4 만 쓴다.** v3 노드는 건드리지 않는다.
 * ⚠ RTDB 는 `undefined`·빈 배열을 조용히 버린다. 읽을 때 `normalizeRecord` 를 꼭 거친다 —
 *   안 거치면 `false`·`0` 이 사라져 판정이 갈린다(2026-08-26 `disputed` 로 한 번 당했다).
 */
import { getDatabase } from 'firebase-admin/database';
import { firebaseAdminApp } from '@/lib/server/firebase-admin';
import { newId } from '@/lib/domain/ids';
import {
  dayOf, normalizeRecord, type SettlementRecord,
} from '@/lib/domain/settlement-record';
import { bucketOf, type SettlementRow } from '@/lib/domain/settlement-stage';
import type { LedgerExtra } from './settlement-ledger-read';

const S = (v: unknown) => String(v ?? '').trim();
const N = (v: unknown) => { const n = Number(S(v).replace(/[,\s원]/g, '')); return Number.isFinite(n) ? n : 0; };
const ON = (v: unknown) => v === true || /^(TRUE|true|참|Y|예|1)$/i.test(S(v));

/** 정산 줄이 사는 곳. */
export const ROWS_NODE = 'v4/settlement_rows';

const db = () => getDatabase(firebaseAdminApp());

/**
 * 글자 날짜(`YYYY-MM-DD`)를 `Date` 로. **그 자리 날짜 그대로** 만든다.
 * ⚠ `new Date('2026-08-02')` 는 UTC 자정이라 한국에서 보면 오전 9시다 — 날짜 비교가 어긋난다.
 *   그래서 조각을 갈라 그 지역 자정으로 세운다.
 */
export const toDate = (v: unknown): Date | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(S(v));
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
};

/** 저장 기록 → 규칙이 먹는 줄. */
export const rowOf = (r: SettlementRecord): SettlementRow => ({
  plate: r.plate, supplier: r.supplier, agent: r.agent, product: r.product, model: r.model,
  customer: r.customer, term: r.term, rent: r.rent, price: r.price, payKind: r.payKind,
  receivedAt: toDate(r.receivedAt), deliveredAt: toDate(r.deliveredAt), clawbackAt: toDate(r.clawbackAt),
  clawbackAmount: r.clawbackAmount, paper: r.paper, delivered: r.delivered,
  cancelled: r.cancelled, clawback: r.clawback,
  claimWritten: r.claimWritten, payWritten: r.payWritten,
  supplierRate: r.supplierRate, agentRate: r.agentRate,
  deposit: r.deposit, channel: r.channel, agentCode: r.agentCode, agentPhone: r.agentPhone,
  paidRounds: r.paidRounds,
} as SettlementRow);

/** 저장 기록 → 화면이 쓰던 곁값. */
const extraOf = (r: SettlementRecord): LedgerExtra => ({
  phone: S(r.phone), clawbackReason: S(r.clawbackReason),
  channel: S(r.channel), channelCode: S(r.channelCode),
  contractNo: S(r.contractNo), note: S(r.note),
});

/**
 * **모든 줄.** 시트 쪽 `listRows` 와 «똑같은 모양»을 낸다.
 * ★`tab` 은 저장된 값이 아니라 **계산값**이다 — 자리는 파생이라 담지 않는다.
 */
export async function listRows(now = new Date()): Promise<{ row: SettlementRow; tab: string; extra: LedgerExtra }[]> {
  const snap = await db().ref(ROWS_NODE).get();
  const all = (snap.val() || {}) as Record<string, SettlementRecord>;
  return Object.values(all).map((raw) => {
    const r = normalizeRecord(raw);
    const row = rowOf(r);
    return { row, tab: bucketOf(row, now), extra: extraOf(r) };
  });
}

/** 차번+접수일로 그 줄의 «저장 열쇠»를 찾는다. 못 찾으면 `null`. */
async function findCode(plate: string, receivedAt: string): Promise<{ code: string; rec: SettlementRecord } | null> {
  const snap = await db().ref(ROWS_NODE).get();
  const all = (snap.val() || {}) as Record<string, SettlementRecord>;
  const want = `${S(plate)}|${dayOf(receivedAt)}`;
  for (const [code, raw] of Object.entries(all)) {
    const r = normalizeRecord(raw);
    // ★접수일을 안 주면 차번만으로 찾는다 — 화면이 접수일 없이 부르는 길이 있다.
    const hit = S(receivedAt)
      ? `${S(r.plate)}|${S(r.receivedAt)}` === want
      : S(r.plate) === S(plate);
    if (hit) return { code, rec: r };
  }
  return null;
}

export type IntakeInput = {
  receivedAt?: string;
  plate: string; model?: string; supplier?: string;
  customer?: string; phone?: string;
  channel?: string; agent?: string; agentCode?: string; agentPhone?: string;
  product?: string; term?: string; deposit?: string; rent?: string; price?: string; payKind?: string;
  paper?: boolean | string; delivered?: boolean | string; deliveredAt?: string;
};

/**
 * ★결과 모양은 **경계(`settlement-store.ts`)가 정본**이다. 여기서 새로 만들지 않는다.
 *   두 개를 두면 언젠가 갈리고, 갈리면 부르는 쪽이 어느 쪽을 믿을지 모른다.
 */
export type StoreResult = { ok: true } | { ok: false; reason: string; status: number };
const fail = (reason: string, status = 500): StoreResult => ({ ok: false, reason, status });

/**
 * **계약 접수 — 한 줄을 더한다.**
 * ★시트 쪽과 같은 규칙을 그대로 지킨다(접수일 미래 금지 · 인도완료면 인도일 필수 · 차번 중복 금지).
 */
export async function appendIntake(input: IntakeInput): Promise<StoreResult & { plate?: string; receivedAt?: string }> {
  const plate = S(input.plate);
  if (!plate) return fail('차량번호가 없습니다', 400);

  const today = dayOf(new Date());
  const asked = dayOf(S(input.receivedAt));
  if (S(input.receivedAt) && (!asked || asked > today)) {
    return fail(`접수일 「${S(input.receivedAt)}」 은 못 씁니다 — 오늘(${today}) 이후일 수 없습니다`, 400);
  }
  const receivedAt = asked || today;

  const delivOn = ON(input.delivered);
  const deliveredAt = dayOf(S(input.deliveredAt));
  if (delivOn && !deliveredAt) {
    return fail('인도완료를 켜려면 인도일을 같이 넣어야 합니다 — 날짜가 없으면 청구월이 안 섭니다', 400);
  }

  // ★같은 차가 «아직 안 끝난 채» 또 들어오면 막는다. 재계약은 접수일이 달라 통과한다.
  const dup = await findCode(plate, '');
  if (dup && !dup.rec.cancelled && S(dup.rec.receivedAt) === receivedAt) {
    return fail(`${plate} 는 ${receivedAt} 접수로 이미 있습니다`, 409);
  }

  // ★코드 갈래는 lib/domain/ids.ts 가 정본이다 — 'stl' 을 손으로 적지 않는다(→ stl_…).
  const code = newId('settlement');
  const rec = normalizeRecord({
    code, plate,
    model: S(input.model), supplier: S(input.supplier),
    customer: S(input.customer), phone: S(input.phone),
    channel: S(input.channel), agent: S(input.agent),
    agentCode: S(input.agentCode), agentPhone: S(input.agentPhone),
    product: S(input.product), term: N(input.term), deposit: N(input.deposit),
    rent: N(input.rent), price: N(input.price), payKind: S(input.payKind),
    receivedAt, deliveredAt,
    paper: ON(input.paper), delivered: delivOn,
    cancelled: false, clawback: false,
  });
  await db().ref(`${ROWS_NODE}/${code}`).set(rec);
  return { ok: true, plate, receivedAt };
}

/**
 * **한 줄을 고친다.** 시트 쪽 칸 이름(「인도일」…)을 그대로 받는다 —
 * 화면이 쓰던 말을 안 바꾸려고 여기서 번역한다.
 *
 * ⚠ 고칠 수 있는 칸은 부르는 쪽(`settlement-store`)이 이미 흰 목록으로 걸렀다.
 *   여기서 또 거르지 않는다 — 두 곳에서 거르면 어느 쪽이 정본인지 흐려진다.
 */
const FIELD: Record<string, { key: keyof SettlementRecord; kind: '글' | '수' | '돈' | '날짜' | '체크' }> = {
  공급사: { key: 'supplier', kind: '글' }, 모델명: { key: 'model', kind: '글' },
  고객명: { key: 'customer', kind: '글' }, 고객연락처: { key: 'phone', kind: '글' },
  영업채널: { key: 'channel', kind: '글' }, 영업담당자: { key: 'agent', kind: '글' },
  영업자연락처: { key: 'agentPhone', kind: '글' }, 영업자코드: { key: 'agentCode', kind: '글' },
  상품구분: { key: 'product', kind: '글' }, 분납여부: { key: 'payKind', kind: '글' },
  비고: { key: 'note', kind: '글' }, 환수사유: { key: 'clawbackReason', kind: '글' },
  계약기간: { key: 'term', kind: '수' }, 납입회차: { key: 'paidRounds', kind: '수' },
  보증금: { key: 'deposit', kind: '돈' }, 렌탈료: { key: 'rent', kind: '돈' },
  차량가액: { key: 'price', kind: '돈' }, 환수금액: { key: 'clawbackAmount', kind: '돈' },
  인도일: { key: 'deliveredAt', kind: '날짜' }, 환수일: { key: 'clawbackAt', kind: '날짜' },
  계약서: { key: 'paper', kind: '체크' }, 인도완료: { key: 'delivered', kind: '체크' },
  계약취소: { key: 'cancelled', kind: '체크' }, 환수: { key: 'clawback', kind: '체크' },
};

export type LedgerKey = { plate: string; receivedAt: string };
export type LedgerEvent = { at: number; by: string; field: string; from: string; to: string };
const EVENT_NODE = 'v4/settlement_events';
const eventKey = (k: LedgerKey) => `${S(k.plate)}_${S(k.receivedAt)}`.replace(/[.$#[\]/\s]/g, '');

export async function patchRow(key: LedgerKey, patch: Record<string, string>, by = ''): Promise<StoreResult> {
  const plate = S(key.plate);
  if (!plate) return fail('차량번호가 없습니다', 400);

  const found = await findCode(plate, S(key.receivedAt));
  if (!found) return fail(`${plate}${S(key.receivedAt) ? ` (접수 ${S(key.receivedAt)})` : ''} 를 못 찾았습니다`, 404);

  // ★인도완료를 켜려면 인도일이 있어야 한다 — 지금 값이든 같이 온 값이든.
  if (ON(patch['인도완료'])) {
    const day = '인도일' in patch ? dayOf(patch['인도일']) : S(found.rec.deliveredAt);
    if (!day) return fail('인도일을 같이 넣어야 합니다 — 날짜가 없으면 청구월이 안 섭니다', 400);
  }

  const next: Partial<SettlementRecord> = {};
  const events: LedgerEvent[] = [];
  for (const [name, raw] of Object.entries(patch)) {
    const f = FIELD[name];
    if (!f) return fail(`여기서 못 고치는 칸입니다 — ${name}`, 400);
    const before = found.rec[f.key];
    const after = f.kind === '체크' ? ON(raw)
      : f.kind === '날짜' ? dayOf(raw)
        : f.kind === '수' || f.kind === '돈' ? N(raw)
          : S(raw);
    if (String(before ?? '') === String(after ?? '')) continue;
    (next as Record<string, unknown>)[f.key] = after;
    events.push({ at: Date.now(), by, field: name, from: String(before ?? ''), to: String(after ?? '') });
  }
  if (!Object.keys(next).length) return { ok: true };

  // ★인도일이 비면 인도완료도 꺼진다. 날짜 없는 인도는 청구월을 못 세운다.
  if ('deliveredAt' in next && !S(next.deliveredAt)) next.delivered = false;

  await db().ref(`${ROWS_NODE}/${found.code}`).update(next);
  // ★쓴 «다음»에 남긴다. 안 써졌는데 남기면 이력이 거짓말을 한다.
  await db().ref(`${EVENT_NODE}/${eventKey(key)}`).update(
    Object.fromEntries(events.map((e) => [newId('audit'), e])),
  ).catch(() => { /* 이력이 안 남아도 저장은 살린다 */ });
  return { ok: true };
}

/** 그 줄에 무슨 일이 있었나. */
export async function listEvents(key: LedgerKey): Promise<LedgerEvent[]> {
  const snap = await db().ref(`${EVENT_NODE}/${eventKey(key)}`).get().catch(() => null);
  return Object.values((snap?.val() || {}) as Record<string, LedgerEvent>).sort((a, b) => b.at - a.at);
}
