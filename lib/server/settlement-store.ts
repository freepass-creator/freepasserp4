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
import { SETTLEMENT_LEDGER_ID } from '@/lib/domain/settlement-ledger';
import type { SettlementRow } from '@/lib/domain/settlement-stage';
import {
  LEDGER_TABS, iso, ledgerError, readLedger, sheetsToken, type LedgerExtra,
} from './settlement-ledger-read';

const S = (v: unknown) => String(v ?? '').trim();

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
  계약서: '체크', 인도완료: '체크', 계약취소: '체크', 환수: '체크',
  인도일: '날짜', 환수일: '날짜', 환수금액: '돈', 환수사유: '글',
  // 뼈대·조건 — 사람이 적는 칸이라 사람이 고칠 수 있어야 한다(오타·조건 변경)
  고객명: '글', 고객연락처: '글', 영업채널: '글', 영업담당자: '글', 영업자연락처: '글',
  영업자코드: '글', 상품구분: '글', 분납여부: '글', 비고: '글',
  계약기간: '수', 보증금: '돈', 렌탈료: '돈', 차량가액: '돈',
};

export type StoreResult = { ok: true } | { ok: false; reason: string; status: number };
const fail = (reason: string, status = 502): StoreResult => ({ ok: false, reason, status });

/** 접수할 때 받는 것. **모델명·공급사·수수료는 안 받는다** — 기계가 채운다. */
export type IntakeInput = {
  plate: string; customer?: string; phone?: string;
  channel?: string; agent?: string; agentCode?: string; agentPhone?: string;
  product?: string; term?: string; deposit?: string; rent?: string; price?: string; payKind?: string;
};

// ─────────────────────────────────────────────────────────── 읽기

export async function listRows(): Promise<{ row: SettlementRow; tab: string; extra: LedgerExtra }[] | null> {
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

  const today = iso(new Date());
  const put: Record<string, string> = {
    접수일: today, 차량번호: plate,
    고객명: S(input.customer), 고객연락처: S(input.phone),
    영업채널: S(input.channel), 영업담당자: S(input.agent), 영업자코드: S(input.agentCode),
    영업자연락처: S(input.agentPhone),
    상품구분: S(input.product), 계약기간: S(input.term),
    보증금: S(input.deposit), 렌탈료: S(input.rent), 차량가액: S(input.price),
    분납여부: S(input.payKind),
    계약서: 'FALSE', 인도완료: 'FALSE', 계약취소: 'FALSE', 환수: 'FALSE',
  };
  const data = Object.entries(put)
    .map(([k, v]) => ({ col: head.indexOf(k), v }))
    .filter((x) => x.col >= 0 && x.v !== '')
    .map((x) => ({ range: `'접수'!${colA1(x.col)}${rowIndex + 1}`, values: [[x.v]] }));

  const wrote = await writeCells(token, data);
  if (!wrote.ok) return wrote;
  return { ok: true, plate, receivedAt: today };
}

/**
 * **한 줄을 고친다.**
 * ★고칠 수 있는 칸은 `EDITABLE_FIELDS` 뿐이다. 그 밖은 어떤 경로로도 안 바뀐다.
 * ★★인도완료를 켜려면 **인도일이 있어야 한다.** 날짜 없이 켜면 청구월이 안 서고
 *   「인도는 됐는데 청구가 없는」 줄이 조용히 생긴다.
 * ★줄은 **차량번호+접수일**로 찾는다 — 차번만으로 찾으면 재계약 때 옛 줄을 고친다.
 * ⚠ 자리를 세지 않는다. 머리글에서 칸 이름을 찾아 쓴다 — 원장도 칸이 늘 수 있다.
 */
export async function patchRow(key: LedgerKey, patch: Record<string, string>): Promise<StoreResult> {
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

    const data = Object.entries(patch)
      .map(([k, v]) => ({
        col: head.indexOf(k), k,
        // 체크는 TRUE/FALSE 로 굳혀 쓴다 — '참'·'Y' 가 섞이면 읽는 쪽이 갈린다.
        v: EDITABLE_FIELDS[k] === '체크' ? (/^(TRUE|true)$/.test(S(v)) ? 'TRUE' : 'FALSE') : S(v),
      }))
      .filter((x) => x.col >= 0)
      .map((x) => ({ range: `'${tabName}'!${colA1(x.col)}${hi + 2 + at}`, values: [[x.v]] }));
    if (!data.length) return fail('고칠 칸을 원장에서 못 찾았습니다', 400);
    return writeCells(token, data);
  }
  return fail(`${plate}${received ? ` (접수 ${received})` : ''} 를 원장에서 못 찾았습니다`, 404);
}
