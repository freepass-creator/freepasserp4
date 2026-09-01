/**
 * **정산원장 저장소 — 읽고 쓰는 문이 여기 하나다.**
 *
 * ★사장님 2026-08-26 「시트를 연동하는게 아니라 우리가 erp에서 직접 관리하는거로」.
 *   그래서 이 파일이 생겼다. **지금은 구글시트를 보지만, 곧 ERP 가 정본이 된다.**
 *   그때 갈아 끼우는 것은 이 파일 «하나»여야 한다 — 라우트도 화면도 안 건드린다.
 *
 * ```
 * 화면 ─▶ 라우트 ─▶ settlement-store  ─▶  (지금) 구글시트
 *                                    ─▶  (곧)  ERP 저장소
 * 규칙(자리·청구월·수수료·청구상태)은 lib/domain/* 순수 함수라 저장소와 무관하다
 * ```
 *
 * ★★**자리(접수·분납실적·완납실적·취소)를 저장하지 않는다.**
 *   시트는 탭으로 나뉘어 있어 «줄을 옮기는» 일이 있었지만, 그건 시트의 사정이지 업무가 아니다.
 *   자리는 `stageOf()` 가 인도일·분납회차로 «계산»하는 파생값이다 —
 *   저장하면 계산값과 저장값이 갈리고, 갈리면 어느 쪽이 맞는지 아무도 모른다.
 *   ⇒ ERP 로 옮기면 「완납실적으로 넘겨야 하는 4줄」 같은 일 자체가 사라진다.
 *
 * ★★**한 줄의 열쇠는 차량번호+접수일이다.** 지금은 시트에 불변 코드가 없어서다.
 *   ERP 로 옮길 때 `stl_` 대체키를 박고 열쇠를 그것으로 바꾼다(ERP5 코드 규격).
 *   그때까지는 이 열쇠 하나만 쓰고, 다른 데서 자리를 세지 않는다.
 *
 * ⚠ **금액·요율은 이 문으로 안 들어온다.** 수수료는 요율표에서 나오는 값이라
 *   화면에서 손대면 그날로 정본이 둘이 된다(`EDITABLE_FIELDS` 에 없다).
 */
import { getDatabase } from 'firebase-admin/database';
import { firebaseAdminApp } from '@/lib/server/firebase-admin';
import { SETTLEMENT_LEDGER_ID } from '@/lib/domain/settlement-ledger';
import type { SettlementRow } from '@/lib/domain/settlement-stage';
import {
  LEDGER_TABS, iso, ledgerError, readLedger, sheetsToken, type LedgerExtra,
} from './settlement-ledger-read';

import * as erp from './settlement-erp-store';

const S = (v: unknown) => String(v ?? '').trim();

/**
 * ★★★**어디에 담나 — 여기 한 줄이 정한다.**
 *
 * ★사장님 2026-08-26 「시트는 나중에 한번 데이터 가져갈때만 쓰고
 *   그 이후에는 파이어베이스에 기입해서 정산해야지」.
 *
 * ```
 * 'erp'    파이어베이스 v4/settlement_rows   ← 정본
 * 'sheet'  구글 정산원장 네 탭               ← 되돌릴 곳
 * ```
 *   ★부르는 쪽(화면·API)은 어느 쪽인지 «모른다». 모양이 같아서다.
 *   ⚠ 되돌리려면 `STORE = 'sheet'` 한 글자만 고친다. 그 밖은 아무것도 안 건드린다.
 *   ⚠ 옮긴 뒤 시트는 **지우지 않는다.** 되돌릴 곳이 있어야 갈아탈 수 있다.
 *
 * ★환경변수로도 갈 수 있다 — 배포에서 한 번 되돌려 보고 싶을 때.
 */
/**
 * 전환 기간의 운영 정본은 직원이 쓰는 시트다.
 *
 * ERP 반영본은 `settlement-sheet-import`가 시트에서 **한 방향으로** 올린다. 환경변수를
 * 빼먹었을 때 ERP 직접입력으로 조용히 바뀌면 정본이 둘이 되므로, ERP 직접 운영은 명시적으로
 * `SETTLEMENT_STORE=erp`를 지정한 경우에만 연다.
 */
export const STORE: 'erp' | 'sheet' = S(process.env.SETTLEMENT_STORE) === 'erp' ? 'erp' : 'sheet';

/** 한 줄을 가리키는 열쇠. ⚠ ERP 이관 때 `stl_` 로 바뀐다 — 그때 여기만 고친다. */
export type LedgerKey = { plate: string; receivedAt: string };
export const keyOf = (k: LedgerKey) => `${S(k.plate)}|${S(k.receivedAt)}`;

/**
 * **사람이 고칠 수 있는 칸.** 흰 목록이라 여기 없는 칸은 어떤 경로로도 안 바뀐다.
 * ★없는 것에 뜻이 있다 — 판매수수료·출고수수료·수수료율·청구금액·지급액이 없다.
 *   그건 요율표에서 나온다. 고쳐야 할 일이 생기면 요율표를 고친다.
 */
export const EDITABLE_FIELDS: Record<string, '체크' | '날짜' | '돈' | '수' | '글'> = {
  // 진행 — 실적의 관문
  // ★2026-09-01 「계약취소」 → 「취소」(사장님 「계약취소 아니고 그냥 취소만」).
  //   옛 이름도 열어 둔다 — 옛 화면·백업이 그 이름으로 보낼 수 있다.
  계약서: '체크', 인도완료: '체크', 취소: '체크', 계약취소: '체크', 환수: '체크',
  청구: '체크', 수금: '체크',
  인도일: '날짜', 환수일: '날짜', 환수금액: '돈', 환수사유: '글',
  /**
   * 뼈대·조건 — 사람이 적는 칸이라 사람이 고칠 수 있어야 한다(오타·조건 변경).
   *
   * ★사장님 2026-08-26 「정산시트에 모델명 넣을수 있게 해주고 / 공급사 다음에 모델명 쓰면 되겄다」.
   *   접수 때는 차를 고르면 모델명이 따라오지만, «차량번호를 직접 입력»한 건은 따라올 데가 없고
   *   따라온 값이 틀렸을 때도 고칠 자리가 없었다. 그래서 둘 다 연다.
   * ★★**순서가 뜻이다** — 공급사 다음이 모델명이다. 화면 입력 칸도 이 차례로 세운다.
   * ⚠ **공급사를 고치면 돈의 상대가 바뀐다.** 청구서가 서는 축이 공급사라,
   *   고치는 순간 그 줄의 청구가 다른 회사로 옮겨 간다. 이력(`v4/settlement_events`)에
   *   남으니 되짚을 수는 있지만, 발행된 청구서가 있으면 그 문서와 어긋나게 된다.
   */
  공급사: '글', 모델명: '글',
  고객명: '글', 고객연락처: '글', 영업채널: '글', 영업담당자: '글', 영업자연락처: '글',
  영업자코드: '글', 상품구분: '글', 분납여부: '글', 비고: '글',
  계약기간: '수', 보증금: '돈', 렌탈료: '돈', 차량가액: '돈',
  // ★부러졌을 때 «그 회차에서 멈춰 세우는» 칸. 비면 기간 비례로 계산된다.
  //   1회차는 인도 때 보증금과 같이 내므로, 인도됐으면 최소 1이다(사장님 2026-08-26).
  납입회차: '수',
};

/**
 * **한 줄이 지나온 길을 남긴다.**
 * ★사장님 2026-08-26 「접수된거를 계속 물고 가야지」 —
 *   상태만 있고 «언제 그렇게 됐는지»가 없으면, 청구가 틀렸을 때 되짚을 근거가 없다.
 *   실측: 원장에는 접수일·인도일·환수일뿐이라 「계약서를 언제 켰나」를 아무도 모른다.
 * ★★**시트가 아니라 ERP 에 남긴다.** 시트는 곧 안 쓴다 — 이력은 처음부터 ERP 것이다.
 * ⚠ v4 overlay 에만 쓴다. v3 노드는 안 건드린다.
 */
const EVENT_NODE = 'v4/settlement_events';

export type LedgerEvent = { at: number; by: string; field: string; from: string; to: string };

/** RTDB 키에 못 쓰는 글자(`. $ # [ ] /`)를 뺀다. */
const eventKey = (k: LedgerKey) => keyOf(k).replace(/[.$#[\]/\s]/g, '_');

async function recordEvents(key: LedgerKey, changes: LedgerEvent[]): Promise<void> {
  if (!changes.length) return;
  const db = getDatabase(firebaseAdminApp());
  const base = db.ref(`${EVENT_NODE}/${eventKey(key)}`);
  // 한 번에 여러 칸이 바뀌어도 각각 한 줄로 남긴다 — 뭉치면 무엇이 바뀌었는지 못 읽는다.
  await Promise.all(changes.map((c) => base.push(c)));
}

/** 한 줄이 지나온 길을 읽는다. 없으면 빈 배열 — 「없다」가 아니라 「아직 안 남겼다」. */
export async function listEvents(key: LedgerKey): Promise<LedgerEvent[]> {
  const snap = await getDatabase(firebaseAdminApp()).ref(`${EVENT_NODE}/${eventKey(key)}`).get().catch(() => null);
  const all = (snap?.val() || {}) as Record<string, LedgerEvent>;
  return Object.values(all).sort((a, b) => a.at - b.at);
}

export type StoreResult = { ok: true } | { ok: false; reason: string; status: number };
const fail = (reason: string, status = 502): StoreResult => ({ ok: false, reason, status });

/**
 * 접수할 때 받는 것.
 * ★★**모델명·공급사는 «고른 차»에서 따라온다**(사장님 2026-08-26 「차량번호 선택해서」).
 *   지어내는 게 아니라 재고에서 끌어오는 것이라 넣는 게 맞다 —
 *   비워 두면 수수료율을 못 찾아 「청구액이 안 잡힌다」가 된다(실측: 원장에 그런 줄이 있다).
 * ⚠ 수수료·청구월은 여전히 안 받는다. 그건 요율표에서 나온다.
 */
/**
 * 접수 한 건에 사람이 넘기는 것.
 *
 * ★사장님 2026-08-26 「담당자가 취급하는 정보가
 *   **언제 · 어떤 차를 · 누가(영업자가) · 누구한테 · 어떤 조건 · 어떤 방식 · 어떤 상태**인지」.
 *   그 문장이 이 타입의 차례이자 화면의 차례다.
 */
export type IntakeInput = {
  /**
   * 언제 — 접수일. 비우면 오늘.
   * ⚠ **줄 열쇠의 절반이다**(차량번호 + 접수일). 오타가 나면 그 줄이 딴 줄이 된다.
   *   ★그래서 «미래 날짜»는 받지 않는다 — 손이 미끄러진 것이지 접수가 아니다.
   */
  receivedAt?: string;
  plate: string; model?: string; supplier?: string;
  customer?: string; phone?: string;
  channel?: string; agent?: string; agentCode?: string; agentPhone?: string;
  product?: string; term?: string; deposit?: string; rent?: string; price?: string; payKind?: string;
  /**
   * 어떤 상태 — 접수 시점에 이미 켜져 있는 것.
   *
   * ★★실측 2026-08-26: 접수 42줄 중 **계약서 95%(40) · 인도완료 76%(32)** 가 이미 켜져 있었다.
   *   전에는 넷을 다 FALSE 로 박아서, 접수하자마자 상세로 다시 들어가 켜야 했다 — 두 번 일했다.
   * ⚠ **인도완료를 켜려면 인도일이 있어야 한다.** 날짜가 없으면 청구월이 안 서고
   *   「인도는 됐는데 청구가 없는」 줄이 조용히 생긴다. 아래에서 막는다.
   */
  paper?: boolean | string; delivered?: boolean | string; deliveredAt?: string;
};

// ─────────────────────────────────────────────────────────── 읽기

export async function listRows(): Promise<{ row: SettlementRow; tab: string; extra: LedgerExtra }[] | null> {
  if (STORE === 'erp') return erp.listRows();
  const token = await sheetsToken();
  if (!token) return null;
  return readLedger(token);
}

export const storeError = ledgerError;

// ─────────────────────────────────────────────── 시트 쪽 사정(이관하면 통째로 없어진다)

const colA1 = (i: number) => {
  let t = ''; let n = i + 1;
  while (n > 0) { const r = (n - 1) % 26; t = String.fromCharCode(65 + r) + t; n = Math.floor((n - 1) / 26); }
  return t;
};
const sheetUrl = (path: string) => `https://sheets.googleapis.com/v4/spreadsheets/${SETTLEMENT_LEDGER_ID}${path}`;

/** ★머리글은 1행이 아니라 «「차량번호」가 있는 줄»이다 — 1행에는 탭 설명이 붙어 있다. */
async function readTab(token: string, tab: string) {
  const res = await fetch(sheetUrl(`/values/${encodeURIComponent(`'${tab}'!A1:BZ3000`)}?valueRenderOption=UNFORMATTED_VALUE`), {
    headers: { Authorization: `Bearer ${token}` }, cache: 'no-store',
  });
  if (!res.ok) return null;
  const body = await res.json() as { values?: unknown[][] };
  const all = (body.values || []).map((r) => (r || []).map(S));
  const hi = all.findIndex((r) => r.includes('차량번호'));
  return hi < 0 ? null : { all, hi, head: all[hi] };
}

async function writeCells(token: string, data: { range: string; values: string[][] }[]): Promise<StoreResult> {
  if (!data.length) return { ok: true };
  const res = await fetch(sheetUrl('/values:batchUpdate'), {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    // ★USER_ENTERED — 날짜·숫자를 시트가 알아보게. ⚠ 「2026-08」 같은 값은 날짜로 바뀐다(실측).
    body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data }),
  });
  return res.ok ? { ok: true } : fail(`쓰지 못했습니다 ${res.status} ${(await res.text()).slice(0, 160)}`);
}

const SERIAL0 = Date.UTC(1899, 11, 30);
/** 시트가 날짜를 숫자로 돌려준다 — `45301` 을 그냥 `new Date` 에 넣으면 45301년이 된다. */
const dayOf = (v: string) => {
  const n = Number(v);
  if (Number.isFinite(n) && n > 20000 && n < 80000) {
    const u = new Date(SERIAL0 + Math.round(n) * 86_400_000);
    return iso(new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate()));
  }
  const d = new Date(v);
  return Number.isNaN(+d) ? '' : iso(d);
};

// ─────────────────────────────────────────────────────────── 쓰기

/**
 * **접수 — 한 줄을 새로 만든다.**
 * ★접수일은 **오늘**이다. 한 번 박히면 안 바뀐다 — 실적을 세는 축이라 흔들리면 돈이 흔들린다.
 * ★같은 차가 아직 진행 중이면 막는다 — 한 줄은 한 계약이고, 재렌트는 앞 건이 끝난 뒤다.
 * ⚠ 청구월·모델명·공급사·수수료는 비워 둔다. 여기서 지어내면 그게 그대로 청구액이 된다.
 */
export async function appendIntake(input: IntakeInput): Promise<StoreResult & { plate?: string; receivedAt?: string }> {
  if (STORE === 'erp') return erp.appendIntake(input);
  const token = await sheetsToken();
  if (!token) return fail(ledgerError() || '저장소를 열지 못했습니다', 503);
  const plate = S(input.plate);
  if (!plate) return fail('차량번호가 없습니다', 400);

  const tab = await readTab(token, '접수');
  if (!tab) return fail('접수 탭 머리글을 못 찾았습니다');
  const { all, hi, head } = tab;
  const iPlate = head.indexOf('차량번호');

  if (all.slice(hi + 1).some((r) => S(r[iPlate]) === plate)) {
    return fail(`${plate} 는 접수에 이미 있습니다`, 409);
  }

  // 빈 줄 찾기 — 차량번호가 빈 첫 줄이 이어 적을 자리다.
  let at = all.slice(hi + 1).findIndex((r) => !S(r[iPlate]));
  if (at < 0) at = all.length - hi - 1;
  const rowIndex = hi + 1 + at;

  /**
   * ★접수일은 사람이 준 값이 이긴다 — 밀려서 적는 일이 있다.
   *   ⚠ 못 읽는 값이나 «미래»면 오늘로 되돌린다. 조용히 이상한 날짜를 박지 않는다.
   */
  const today = iso(new Date());
  const asked = dayOf(S(input.receivedAt));
  const received = asked && asked <= today ? asked : today;
  if (S(input.receivedAt) && received !== dayOf(S(input.receivedAt))) {
    return fail(`접수일 「${S(input.receivedAt)}」 은 못 씁니다 — 오늘(${today}) 이후일 수 없습니다`, 400);
  }

  /**
    * ★★**「예/아니오」가 «문자»로 온다.** 화면 select 가 그렇게 보낸다.
    *   ⚠ `if (input.paper)` 로 받으면 **「아니오」도 참**이다 — 빈 문자열이 아니니까.
    *     그러면 계약서가 늘 켜진 채 접수된다(2026-08-26 확인).
    *   ★그래서 «참으로 볼 말»을 정해 두고 그것만 참으로 읽는다.
    */
  const YES = (v: unknown) => v === true || /^(예|TRUE|true|Y|1|참)$/i.test(S(v));
  const paperOn = YES(input.paper);
  const delivOn = YES(input.delivered);

  // ★인도완료는 인도일과 «같이» 온다. 날짜 없이 켜면 청구월이 안 선다.
  const delivDay = dayOf(S(input.deliveredAt));
  if (delivOn && !delivDay) {
    return fail('인도완료를 켜려면 인도일을 같이 넣어야 합니다 — 날짜가 없으면 청구월이 안 섭니다', 400);
  }

  const put: Record<string, string> = {
    접수일: received, 차량번호: plate,
    // 고른 차에서 따라온 것 — 비면 요율을 못 찾는다
    모델명: S(input.model), 공급사: S(input.supplier),
    고객명: S(input.customer), 고객연락처: S(input.phone),
    영업채널: S(input.channel), 영업담당자: S(input.agent), 영업자코드: S(input.agentCode),
    영업자연락처: S(input.agentPhone),
    상품구분: S(input.product), 계약기간: S(input.term),
    보증금: S(input.deposit), 렌탈료: S(input.rent), 차량가액: S(input.price),
    분납여부: S(input.payKind),
    // 어떤 상태 — 접수 때 이미 켜져 있는 것을 그대로 받는다. 취소·환수는 늘 꺼진 채 시작한다.
    계약서: paperOn ? 'TRUE' : 'FALSE',
    인도완료: delivOn ? 'TRUE' : 'FALSE',
    인도일: delivDay,
    취소: 'FALSE', 환수: 'FALSE',
  };
  const data = Object.entries(put)
    .map(([k, v]) => ({ col: head.indexOf(k), v }))
    .filter((x) => x.col >= 0 && x.v !== '')
    .map((x) => ({ range: `'접수'!${colA1(x.col)}${rowIndex + 1}`, values: [[x.v]] }));

  const wrote = await writeCells(token, data);
  if (!wrote.ok) return wrote;
  return { ok: true, plate, receivedAt: received };
}

/**
 * **한 줄을 고친다.**
 * ★고칠 수 있는 칸은 `EDITABLE_FIELDS` 뿐이다. 그 밖은 어떤 경로로도 안 바뀐다.
 * ★★인도완료를 켜려면 **인도일이 있어야 한다.** 날짜 없이 켜면 청구월이 안 서고
 *   「인도는 됐는데 청구가 없는」 줄이 조용히 생긴다.
 * ★줄은 **차량번호+접수일**로 찾는다 — 차번만으로 찾으면 재계약 때 옛 줄을 고친다.
 * ⚠ 자리를 세지 않는다. 머리글에서 칸 이름을 찾아 쓴다 — 원장도 칸이 늘 수 있다.
 */
export async function patchRow(key: LedgerKey, patch: Record<string, string>, by = ''): Promise<StoreResult> {
  // ★고칠 수 있는 칸은 «여기»가 흰 목록으로 거른다 — 저장소가 어디든 같은 규칙이다.
  const notAllowed = Object.keys(patch).filter((k) => !EDITABLE_FIELDS[k]);
  if (notAllowed.length) return fail(`여기서 못 고치는 칸입니다 — ${notAllowed.join(', ')}`, 400);
  if (STORE === 'erp') return erp.patchRow(key, patch, by);
  const token = await sheetsToken();
  if (!token) return fail(ledgerError() || '저장소를 열지 못했습니다', 503);
  const plate = S(key.plate);
  if (!plate) return fail('차량번호가 없습니다', 400);

  const bad = Object.keys(patch).filter((k) => !EDITABLE_FIELDS[k]);
  if (bad.length) return fail(`여기서 못 고치는 칸입니다 — ${bad.join(', ')}`, 400);
  if (/^(TRUE|true)$/.test(S(patch['인도완료'])) && !S(patch['인도일'])) {
    return fail('인도일을 같이 넣어야 합니다 — 날짜가 없으면 청구월이 안 섭니다', 400);
  }

  const received = S(key.receivedAt);
  for (const tabName of LEDGER_TABS) {
    const tab = await readTab(token, tabName);
    if (!tab) continue;
    const { all, hi, head } = tab;
    const iPlate = head.indexOf('차량번호');
    const iRecv = head.indexOf('접수일');
    const at = all.slice(hi + 1).findIndex((r) => S(r[iPlate]) === plate
      && (!received || dayOf(S(r[iRecv])) === received));
    if (at < 0) continue;

    // ★칸 이름(`k`)을 끝까지 들고 간다 — 이력이 무슨 칸을 고쳤는지 알아야 한다.
    const cells = Object.entries(patch)
      .map(([k, v]) => ({
        col: head.indexOf(k), k,
        // 체크는 TRUE/FALSE 로 굳혀 쓴다 — '참'·'Y' 가 섞이면 읽는 쪽이 갈린다.
        v: EDITABLE_FIELDS[k] === '체크' ? (/^(TRUE|true)$/.test(S(v)) ? 'TRUE' : 'FALSE') : S(v),
      }))
      .filter((x) => x.col >= 0);
    const data = cells.map((x) => ({ range: `'${tabName}'!${colA1(x.col)}${hi + 2 + at}`, values: [[x.v]] }));
    if (!data.length) return fail('고칠 칸을 원장에서 못 찾았습니다', 400);
    const before = all[hi + 1 + at];
    const wrote = await writeCells(token, data);
    if (!wrote.ok) return wrote;
    // ★쓴 «다음»에 남긴다. 안 써졌는데 남기면 이력이 거짓말을 한다.
    /**
     * ★★이력은 **실제로 쓴 칸**만 남긴다.
     *   ⚠ 예전엔 `Object.keys(patch)[i]` 로 이름을 붙였는데, 바로 위에서
     *     `.filter((x) => x.col >= 0)` 로 «원장에 없는 칸»을 걸러 낸 뒤라 번호가 밀린다.
     *     원장에 없는 칸이 하나라도 섞이면 이력에 **엉뚱한 칸 이름과 값**이 남았다.
     *     `data` 가 자기 칸 이름(`k`)을 이미 들고 있으니 그것을 쓴다.
     */
    await recordEvents(key, cells
      .map((x) => ({
        at: Date.now(), by, field: x.k,
        from: S(before[head.indexOf(x.k)]), to: S(patch[x.k]),
      }))
      .filter((e) => e.from !== e.to)).catch(() => { /* 이력이 안 남아도 저장은 살린다 */ });
    return wrote;
  }
  return fail(`${plate}${received ? ` (접수 ${received})` : ''} 를 원장에서 못 찾았습니다`, 404);
}
