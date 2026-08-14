/**
 * **공급사 시트의 정제칸을 채운다 — 차번당 한 번.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★왜(사장님 2026-08-14 — 「매물을 접하면 우리식으로 바꿔서 상태값만 공급사거를 참고한다」)
 *   차종 정보는 **한 번 정하면 안 바뀐다.** 그 차가 그랜저 IG 가솔린 2.5 인 것은 이번 주에도
 *   다음 주에도 같다. 그런데 지금은 발행할 때마다 차종마스터를 **즉석에서 다시 돌려** 같은 차를
 *   매번 새로 판단한다. 마스터가 바뀌면 지난주와 다른 답이 나오고, 아무도 그걸 모른다.
 *   그래서 판단을 **시트에 눌러앉힌다.** 눌러앉은 뒤로는 발행기가 그 글자를 읽어 갈 뿐이다.
 *
 * ★**지금 발행기가 내는 답을 그대로 옮긴다.** 새 규칙을 만들지 않는다 —
 *   여기서 다른 답을 내면 채우는 순간 영업자 표의 차명이 «소리 없이» 바뀐다.
 *   그래서 입력도 `publish-origin-tab` 과 똑같이 «값이 든 첫 칸»으로 고른다.
 *
 * ⚠ **빈 칸에만 쓴다.** 이미 글자가 있으면 그게 사람이 고친 값이든 지난번에 채운 값이든
 *   손대지 않는다. 이 규칙 하나가 이 도구를 몇 번 돌려도 안전하게 만든다.
 * ⚠ **확신도가 낮으면 안 쓴다.** 차명 다섯 축은 high·medium 일 때만 채우고, 낮으면 비워 둔다.
 *   빈 칸은 «사람이 볼 목록»으로 남지만, 틀린 차명은 아무도 안 본다.
 * ⚠ 돈·상태·주행거리에는 손대지 않는다. 그건 공급사가 정하는 값이라 정제할 것이 없다.
 *
 *   npx tsx scripts/fill-supplier-ai-columns.mts                 # 미리보기(전 공급사)
 *   npx tsx scripts/fill-supplier-ai-columns.mts --who=아이카   # 한 곳만
 *   npx tsx scripts/fill-supplier-ai-columns.mts --apply
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { snapToMaster } from '../lib/domain/vehicle-master-match';
import { fuelDisplay, fuelEmbeddedCc } from '../lib/domain/vehicle-master-format';
import { snapColor } from '../lib/domain/color-master';
import { classifyVehicleClass } from '../lib/domain/vehicle-class';
import { SALES_ALIAS } from '../lib/domain/sales-sheet-mapping';
import { AI_TAIL_COLUMNS } from '../lib/domain/supplier-template-sheet';
import { companyAlias, supplierNameKeys } from '../lib/domain/identity';
import { MASTER_SHEET_ID, MASTER_TAB, masterCells, pickMasterCode, readMasterSheet } from '../lib/domain/vehicle-master-sheet';
import type { MasterEntry } from '../lib/domain/vehicle-master-types';
import type { EntityRecord } from '../lib/intake/entities';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const APPLY = process.argv.includes('--apply');
/**
 * ★**이미 잘못 써 놓은 「배기량(정제)」만 고친다** — 「빈 칸에만 쓴다」의 **유일한 예외**다.
 *   2026-08-14 에 파워트레인 «글자»에서 숫자를 긁어 배터리 용량(77400)·구동축 숫자(2000·4000)를
 *   배기량으로 찍었다. 빈 칸이 아니라 **틀린 값이 들어 있어** 평소 규칙으로는 못 고친다.
 * ⚠ 아무 값이나 덮지 않는다. **옛 방식으로 계산한 값과 똑같을 때만** 덮는다 —
 *   그래야 사람이 손으로 적은 값을 안 건드린다.
 *   npx tsx scripts/fill-supplier-ai-columns.mts --fix-cc --apply
 */
const FIX_CC = process.argv.includes('--fix-cc');
const arg = (k: string, d = '') => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3) || d;
/** 한 곳만 손볼 때 — 공급사 «이름»으로 거른다(문서를 이름으로 찾으므로 코드가 없다). */
const ONLY = new Set(arg('who').split(/[,\s]+/).map(S).filter(Boolean));
/** 제공시트 이름 표식 — `add-supplier-ai-columns` 와 같은 값을 써야 같은 문서를 본다. */
const DOC_NAME = arg('name', '프리패스 재고');
/** 판매시트 — 「AI 정제」 치환 사전이 여기 있다. 발행기와 같은 사전을 써야 답이 같다. */
const SALES_SHEET = arg('sales', '1Y1Mx1EcEpAuNer0y50Dq4eK92CpVjThO_suZLmo2vVs');

const masterRaw = JSON.parse(readFileSync('public/data/vehicle-master.json', 'utf8')) as Rec;
const MASTER = ((Array.isArray(masterRaw) ? masterRaw : masterRaw.entries) || []) as MasterEntry[];

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const gT = (await new JWT({ email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'], subject: 'pyh@teamjpk.com' }).getAccessToken()).token;

/** ⚠ 18곳을 연달아 읽으면 429 가 난다. 재시도가 없으면 그 집이 «안 채워진 채» 조용히 넘어간다. */
const api = async (url: string, init?: RequestInit): Promise<Rec> => {
  for (let n = 0; ; n++) {
    const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${gT}`, 'Content-Type': 'application/json', ...(init?.headers || {}) } });
    const body = await res.json().catch(() => ({})) as Rec;
    if (res.ok) return body;
    if ((res.status === 429 || res.status >= 500) && n < 6) {
      const wait = Math.min(60_000, 5_000 * 2 ** n);
      console.log(`  … ${res.status} — ${Math.round(wait / 1000)}초 쉬고 다시`);
      await new Promise((ok) => setTimeout(ok, wait));
      continue;
    }
    throw new Error(body?.error?.message || `HTTP ${res.status}`);
  }
};

/** 열 번호를 A1 글자로. 정제칸은 45열 뒤라 **두 글자**가 나온다 — 한 글자만 만들면 엉뚱한 칸에 쓴다. */
const colA1 = (i: number) => { let s = ''; for (let n = i + 1; n > 0;) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; };
/** 탭 이름에 작은따옴표가 들어가면 A1 표기가 깨진다 — 두 번 겹쳐 쓰는 것이 규격이다. */
const a1Tab = (t: string) => `'${t.replace(/'/g, "''")}'`;

/** 「AI 정제」 치환 사전 — 발행기와 **같은 것**을 쓴다. 사전이 다르면 채운 값과 표시 값이 갈린다. */
const SUBST = new Map<string, string>();
try {
  const v = await api(`https://sheets.googleapis.com/v4/spreadsheets/${SALES_SHEET}/values/${encodeURIComponent("'AI 정제'!A1:C2000")}`) as { values?: string[][] };
  for (const r of ((v.values || []) as string[][])) {
    const kind = S(r[0]), from = S(r[1]), to = S(r[2]);
    if (!kind.startsWith('@') || kind === '@설명' || !from || !to) continue;
    SUBST.set(`${kind.slice(1)}|${from}`, to);
  }
  console.log(`  치환 사전 「AI 정제」 ${SUBST.size}줄`);
} catch (e) { console.log(`  ⚠ 「AI 정제」를 못 읽어 치환 없이 돈다 — ${String((e as Error).message).slice(0, 60)}`); }
const clean = (col: string, val: string) => SUBST.get(`${col}|${S(val)}`) ?? S(val);

/**
 * ★**차종코드 책** — 「ERP4 차종마스터 원천대장」에서 읽는다.
 *   차번에 코드를 박으면 다시 알아맞힐 일이 없어진다(사장님 2026-08-14).
 * ⚠ 못 읽으면 코드 칸만 비우고 나머지는 예전대로 돈다 — 조용히 멈추지 않는다.
 */
let BOOK = readMasterSheet([]);
try {
  const v = await api(`https://sheets.googleapis.com/v4/spreadsheets/${MASTER_SHEET_ID}/values/${encodeURIComponent(`'${MASTER_TAB}'`)}`) as { values?: string[][] };
  BOOK = readMasterSheet((v.values || []) as string[][]);
  console.log(`  차종마스터 ${BOOK.byCode.size}줄 · 다섯값으로 하나로 정해지는 조합 ${[...BOOK.byFive.values()].filter((x) => x.length === 1).length}`);
} catch (e) { console.log(`  ⚠ 차종마스터를 못 읽어 «차종코드»는 못 채운다 — ${String((e as Error).message).slice(0, 60)}`); }

/**
 * ★**채우는 곳은 「프리패스 재고」 제공시트다** — 문패가 가리키는 곳이 아니다.
 *   정제칸은 우리가 만든 제공시트에 있다. 문패는 아직 열여섯 곳이 «공급사 자체 시트»를
 *   가리키고 있어서, 문패를 따라가면 정제칸이 없는 문서를 열게 된다(실측 2026-08-14 —
 *   그래서 「정제칸이 없는 시트 16」이 떴다).
 *   ⚠ 그러니 여기서 채운 값이 영업자 표에 보이려면 **그 집 문패를 우리 시트로 넘겨야** 한다.
 *     넘기기 전까지는 채워 놓고 기다리는 것이 맞다 — 넘기는 날 한꺼번에 살아난다.
 * ★찾는 법은 `add-supplier-ai-columns` 와 **같다**(드라이브에서 이름으로). 두 도구가 다른 문서를
 *   보면 「칸은 만들었는데 안 채워지는」 일이 생긴다.
 */
const targets: { code: string; name: string; id: string }[] = [];
{
  const q = `name contains '${DOC_NAME}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`;
  const r = await api(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=100&includeItemsFromAllDrives=true&supportsAllDrives=true`);
  for (const f of ((r.files || []) as Rec[])) {
    const nm = S(f.name);
    const who = companyAlias(nm.replace(DOC_NAME, '').trim()) || nm.replace(DOC_NAME, '').trim();
    if (ONLY.size && ![...supplierNameKeys(who)].some((k) => ONLY.has(k))) continue;
    targets.push({ code: '', name: who, id: S(f.id) });
  }
  targets.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
}

/** 정제칸 이름 — 이 목록이 곧 «우리가 채우는 칸»의 정본이다. */
const TAIL = AI_TAIL_COLUMNS.map((c) => c.name);

console.log(`\n■ 공급사 시트 정제칸 채우기 ${APPLY ? '(반영)' : '(dry-run — 아직 안 쓴다)'} · 대상 ${targets.length}곳\n`);

let totFilled = 0, totKept = 0, totCars = 0, totLow = 0;
/** 확신도가 낮아 못 채운 차 — 사람이 손볼 목록이다. 화면 밖에 두면 잊힌다. */
const lowList: string[] = [];
/** 정제칸이 아예 없는 시트 — `add-supplier-ai-columns` 를 먼저 돌려야 한다. */
const noTail: string[] = [];
/** 공급사 배기량과 마스터 배기량이 어긋난 차 — 세대를 잘못 잡았다는 신호다. */
let badCc = 0;
const ccList: string[] = [];
/** 차명 글자를 아예 못 읽은 차 — 그 시트 열 이름이 매핑에 없다는 뜻이다. */
let noName = 0;
const nameList: string[] = [];
/** 옛 방식이 잘못 찍어 둔 배기량 — 되돌린 수. */
let badCcWritten = 0;
const ccFixList: string[] = [];
/** 차종코드를 박은 차 / 못 박은 차 — 「절대 안 틀린다」가 실제로 몇 대에 걸렸나. */
let codeSet = 0, codeUnset = 0;
/** 코드를 따라 표시칸을 고친 수 — 코드가 정본임이 실제로 지켜진 자리다. */
let codeFixed = 0;
const codeFixList: string[] = [];
/** 왜 못 박았나 — 갈래별로 세야 «마스터에 뭘 넣어야 하는지»가 보인다. */
const codeWhy = new Map<string, number>();
const codeByWhy = new Map<string, string[]>();

for (const t of targets) {
  let meta: Rec;
  try {
    meta = await api(`https://sheets.googleapis.com/v4/spreadsheets/${t.id}?fields=${encodeURIComponent('sheets.properties(sheetId,title)')}`);
  } catch (e) { console.log(`  ✗ ${t.name}(${t.code}) — 시트를 못 열었다: ${String((e as Error).message).slice(0, 50)}`); continue; }
  const tabTitles = ((meta.sheets || []) as Rec[]).map((s) => S(s.properties?.title)).filter(Boolean);
  if (!tabTitles.length) continue;

  /** 탭을 한 번에 읽는다 — 탭마다 따로 부르면 쿼터가 금방 마른다. */
  let got: Rec;
  try {
    const qs = tabTitles.map((x) => `ranges=${encodeURIComponent(a1Tab(x))}`).join('&');
    got = await api(`https://sheets.googleapis.com/v4/spreadsheets/${t.id}/values:batchGet?${qs}&majorDimension=ROWS`);
  } catch (e) { console.log(`  ✗ ${t.name}(${t.code}) — 값을 못 읽었다: ${String((e as Error).message).slice(0, 50)}`); continue; }

  const updates: { range: string; values: string[][] }[] = [];
  let cars = 0, filled = 0, kept = 0, low = 0, sawTail = false;

  ((got.valueRanges || []) as Rec[]).forEach((vr, ti) => {
    const title = tabTitles[ti];
    const grid = ((vr.values || []) as string[][]);
    if (grid.length < 2) return;
    /**
     * 헤더 줄을 «차량번호가 있는 첫 줄»로 찾는다. 제공시트는 1행이지만 안내문이 위에 붙은
     * 시트가 있어 자리를 고정하면 엉뚱한 줄을 헤더로 잡는다.
     */
    const hRow = grid.findIndex((r) => r.some((c) => S(c) === '차량번호'));
    if (hRow < 0) return;                    // 재고표가 아닌 탭(정책·AI 인계 …)
    const hdr = (grid[hRow] || []).map(S);
    const at = new Map<string, number>();
    hdr.forEach((h, i) => { if (h && !at.has(h)) at.set(h, i); });
    const tailAt = new Map(TAIL.map((c) => [c, at.has(c) ? at.get(c)! : -1]));
    if ([...tailAt.values()].every((i) => i < 0)) return;   // 이 탭엔 정제칸이 없다
    sawTail = true;

    /** 발행기와 **같은 방식** — 후보를 차례로 보고 «값이 든 첫 칸»을 쓴다. */
    const pickAll = (name: string) => (SALES_ALIAS[name] || [name]).map((c) => (at.has(c) ? at.get(c)! : -1)).filter((i) => i >= 0);
    const idx = new Map<string, number[]>();
    for (const n of ['제조사', '모델', '세부모델', '세부트림', '연료', '외장', '내장', '옵션', '배기량']) idx.set(n, pickAll(n));
    const plateAt = at.get('차량번호') ?? -1;
    if (plateAt < 0) return;

    for (let r = hRow + 1; r < grid.length; r++) {
      const row = grid[r] || [];
      const plate = S(row[plateAt]);
      if (!plate) continue;
      cars++;
      const cell = (c: string) => { for (const i of (idx.get(c) || [])) { const v = S(row[i]); if (v) return v; } return ''; };
      /** 열 이름 그대로 그 칸만 — 별칭을 안 쓴다. 정제칸을 «있는 그대로» 볼 때 쓴다. */
      const exactCell = (name: string) => { const i = at.get(name); return i === undefined ? '' : S(row[i]); };

      const rawName = [cell('모델'), cell('세부모델'), cell('세부트림')].filter(Boolean).join(' ').trim();
      /**
       * ⚠ **차명을 한 글자도 못 읽은 차를 따로 센다.** 이건 «못 알아본 차»와 다르다 —
       *   마스터가 못 맞힌 게 아니라 **읽을 글자가 없는** 것이고, 원인은 그 시트의 열 이름이
       *   우리 매핑에 없다는 뜻이다. 안 세면 「채움 0칸」으로만 보여 원인을 못 찾는다.
       */
      if (!rawName) { noName++; if (nameList.length < 20) nameList.push(`${t.name} 「${title}」 ${plate}`); }
      const snap = rawName ? snapToMaster({
        maker: cell('제조사'), model: cell('모델'), sub_model: [cell('세부모델'), cell('세부트림')].filter(Boolean).join(' '),
        fuel_type: cell('연료'),
      } as EntityRecord, MASTER) : null;
      let ok = !!snap && (snap.confidence === 'high' || snap.confidence === 'medium');

      /**
       * ★**공급사 배기량으로 스냅을 되짚는다**(실측 2026-08-14).
       *   아이카 109호4080 은 공급사가 배기량 2,151 이라 적었는데 마스터가 「카니발 II KV-II 디젤 2.9」로
       *   잡았다 — 1990년대 세대에 붙은 것이다. 확신도는 medium 이라 그냥 통과했다.
       *   배기량은 **공급사가 등록증 보고 적는 값**이라 세대를 가리는 가장 단단한 증거다.
       *   둘이 어긋나면 «세대를 잘못 잡았다»는 뜻이므로 세부모델·파워트레인도 같이 틀렸다고 본다.
       * ⚠ 그래서 이런 차는 **한 칸도 안 채운다.** 틀린 채로 눌러앉으면 그게 제일 나쁘다.
       *   대신 목록에 올려 사람이 보게 한다.
       * ⚠ 7% 는 표기 반올림을 봐준 폭이다(1,999 ↔ 2.0 처럼). 세대가 다르면 이 폭을 훌쩍 넘는다.
       */
      /**
       * ⚠ **공급사가 적은 칸만 본다** — 「배기량(정제)」는 우리가 채우는 칸이다.
       *   그걸 같이 보면 한 번 채운 뒤로는 «우리 값 ↔ 우리 값»을 견주게 되어
       *   이 안전장치가 소리 없이 꺼진다.
       */
      const rawCc = Number(S(row[at.get('배기량') ?? -1]).replace(/[^\d]/g, '')) || 0;
      const snapCc = ok ? Number(S(snap!.engine_cc)) || 0 : 0;
      let ccMismatch = false;
      if (ok && rawCc > 300 && snapCc > 300 && Math.abs(rawCc - snapCc) / rawCc > 0.07) {
        ok = false;
        badCc++;
        if (ccList.length < 40) ccList.push(`${t.name} ${plate} 공급사 ${rawCc}cc ↔ 마스터 「${S(snap!.sub_model)} ${S(snap!.variant)}」 ${snapCc}cc`);
        ccMismatch = true;
      }
      if (!ok && !ccMismatch && rawName) { low++; if (lowList.length < 40) lowList.push(`${t.name} ${plate} 「${rawName.slice(0, 40)}」`); }

      const variant = ok ? S(snap!.variant) : '';

      /**
       * ★★**차종코드를 정한다 — 이게 이 도구의 진짜 일이다**(사장님 2026-08-14 —
       *   「그 차에 대해서 코드를 박아두면 절대 틀릴 일이 없음」).
       *
       *   ① 이미 코드가 박혀 있으면 **그걸 믿는다.** 다시 알아맞히지 않는다.
       *   ② 없으면 스냅이 낸 다섯 값으로 마스터에서 찾는다.
       *   ③ 후보가 여럿이거나 없으면 **안 박는다.** 목록으로 남겨 사람이 정한다 —
       *      아무거나 박으면 「절대 안 틀린다」는 약속이 그 자리에서 깨진다.
       *
       * ★코드가 정해지면 **뒤 칸들은 코드에서 나온다.** 스냅 결과를 안 쓴다 —
       *   그래야 시트에 적힌 값과 코드가 영원히 같다.
       */
      const already = exactCell('차종코드');
      const pick = already
        ? { code: already, how: '하나' as const, candidates: [already] }
        : (ok ? pickMasterCode(BOOK, S(snap!.maker), S(snap!.model), S(snap!.sub_model), variant, S(snap!.trim_name),
                               fuelDisplay(variant), S(snap!.engine_cc))
              : { code: '', how: '없음' as const, candidates: [] as string[] });
      const mrow = pick.code ? BOOK.byCode.get(pick.code) : undefined;
      if (BOOK.byCode.size && ok && !pick.code) {
        codeUnset++;
        codeWhy.set(pick.how, (codeWhy.get(pick.how) || 0) + 1);
        const line = `${t.name} ${plate} — ${S(snap!.maker)} ${S(snap!.model)} ${S(snap!.sub_model)} · ${variant} · ${S(snap!.trim_name) || '(트림없음)'}`.replace(/\s+/g, ' ');
        const bucket = codeByWhy.get(pick.how) || [];
        if (bucket.length < 8) { bucket.push(line); codeByWhy.set(pick.how, bucket); }
        else codeByWhy.set(pick.how, bucket);
      }
      if (pick.code && mrow) codeSet++;

      /** 코드가 정해진 차는 **마스터 값**을, 아니면 예전처럼 스냅 값을 쓴다. */
      const fromCode = masterCells(mrow);
      /**
       * 채울 값. **빈 문자열은 «채울 것이 없다»는 뜻**이고 그 칸은 건드리지 않는다.
       * ⚠ 세부트림은 없는 차가 정상이다 — 비어 있다고 사고가 아니다.
       */
      const want: Record<string, string> = {
        '차종코드': pick.code,
        '제조사(정제)': ok ? clean('제조사', S(snap!.maker)) : '',
        '모델': ok ? clean('모델', S(snap!.model)) : '',
        '세부모델': ok ? clean('세부모델', S(snap!.sub_model)) : '',
        '파워트레인': ok ? clean('파워트레인', variant) : '',
        '세부트림': ok ? clean('세부트림', S(snap!.trim_name)) : '',
        /**
         * ★배기량은 **마스터가 돌려준 `engine_cc` 를 그대로** 쓴다.
         * ⚠ 파워트레인 «글자»에서 숫자를 긁지 마라. 그렇게 했다가 배터리 용량과 구동축 숫자를
         *   배기량으로 찍어 넣었다(실측 2026-08-14 · 살아 있는 매물 49대) —
         *     「전기 77.4kWh AWD」(아이오닉6) → 77400
         *     「전기 2WD」(EV3·EV9·포터II 전기) → 2000     ← 2.0 엔진차로 보인다
         *     「전기 4MATIC」(벤츠 EQE) → 4000
         *     「하이브리드 2WD 6인승」(싼타페 MX5) → 2000  ← 실제 1,598cc
         *   마스터는 전기차에 `engine_cc` 를 안 준다(undefined) — 그래야 빈칸이 된다.
         *   「전기차는 빈칸이 정상」이라는 규격(supplier-template-sheet)이 그 뜻이다.
         */
        '배기량(정제)': ok ? S(snap!.engine_cc) : '',
        '연료(정제)': ok ? fuelDisplay(variant) : '',
        // 색은 마스터와 무관하다 — 차명을 못 알아봐도 색은 정제된다.
        '외장색상': snapColor(cell('외장'), 'ext'),
        '내장색상': snapColor(cell('내장'), 'int'),
        '선택옵션': clean('옵션', cell('옵션')),
        // 차종분류는 모델 이름으로 정한다 — 차명이 확실할 때만.
        '차종분류': ok ? classifyVehicleClass({ maker: S(snap!.maker), model: S(snap!.model), sub_model: S(snap!.sub_model) } as EntityRecord) : '',
        /**
         * ★★**코드가 이긴다.** 코드가 정해진 차는 위의 스냅 값 대신 **마스터 값**을 쓴다.
         *   맨 마지막에 덮어써서 순서 때문에 뒤집히지 않게 한다 —
         *   그래야 시트에 적힌 표시값과 코드가 영원히 같은 것을 가리킨다.
         */
        ...fromCode,
      };

      for (const [name, ci] of tailAt) {
        if (ci < 0) continue;
        const now = S(row[ci]);
        const v = S(want[name]);
        /**
         * ⚠ 예외 하나 — **엔진이 없는 차에 배기량이 적혀 있으면 지운다.**
         *   옛 방식이 파워트레인 «글자»에서 숫자를 긁어 배터리 용량을 배기량으로 찍었다
         *   (레이 EV 16400 · 볼트 EUV 66000 · EV6 77400 — 실측 2026-08-14).
         * ★판정을 **시트에 적힌 파워트레인**으로 한다. 다시 스냅을 돌려 견주면,
         *   그 사이 마스터나 입력이 바뀐 차는 계산이 안 맞아 **못 고치고 지나간다.**
         *   「전기·수소인데 배기량이 있다」는 다시 볼 것 없이 틀린 것이다.
         */
        if (FIX_CC && name === '배기량(정제)' && now && /전기|수소/.test(exactCell('파워트레인'))) {
          badCcWritten++;
          if (ccFixList.length < 25) ccFixList.push(`${t.name} ${plate} 「${exactCell('파워트레인')}」 ${now} → (빈칸)`);
          updates.push({ range: `${a1Tab(title)}!${colA1(ci)}${r + 1}`, values: [['']] });
          continue;
        }
        /**
         * ★★**코드가 이긴다 — 표시칸은 코드를 따라간다.**
         *   차종코드가 박힌 차는 뒤 칸들이 «코드에서 나온 표시값»이다(규격 4장).
         *   그런데 「빈 칸에만 쓴다」만 지키면 **옛 값이 그대로 남아 코드와 어긋난다** —
         *   실측 2026-08-15: 코드를 박았는데 G80 DH 가 「가솔린 3.3T」로 남아 있었다
         *   (코드는 2.5T 를 가리킨다). 그러면 코드를 박은 값어치가 없다.
         * ⚠ 코드가 있는 차의 **마스터에서 나온 칸만** 덮는다. 색·옵션·차종분류는
         *   코드에서 나오는 값이 아니라 그대로 둔다.
         * ⚠ 사람이 값을 고치고 싶으면 **코드를 고쳐야** 한다. 표시칸을 고치면 다시 덮인다 —
         *   그게 「코드가 정본」의 뜻이다.
         */
        if (pick.code && mrow && name in fromCode) {
          const target = S(fromCode[name]);
          if (now !== target) {
            if (now) { codeFixed++; if (codeFixList.length < 20) codeFixList.push(`${t.name} ${plate} ${name} 「${now}」 → 「${target || '(빈칸)'}」`); }
            else filled++;
            updates.push({ range: `${a1Tab(title)}!${colA1(ci)}${r + 1}`, values: [[target]] });
          } else if (now) kept++;
          continue;
        }
        if (!v) continue;                 // 채울 것이 없다
        if (now) { kept++; continue; }    // ⚠ 이미 있는 값은 절대 안 덮는다
        filled++;
        updates.push({ range: `${a1Tab(title)}!${colA1(ci)}${r + 1}`, values: [[v]] });
      }
    }
  });

  if (!sawTail) { noTail.push(`${t.name}(${t.code})`); continue; }
  totCars += cars; totFilled += filled; totKept += kept; totLow += low;
  const pad = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - [...s].reduce((a, c) => a + (c.charCodeAt(0) > 127 ? 2 : 1), 0)));
  console.log(`  ${pad(t.name, 14)}${String(cars).padStart(4)}대   채움 ${String(filled).padStart(5)}칸   그대로 둠 ${String(kept).padStart(5)}칸${low ? `   못 알아봄 ${low}대` : ''}`);

  if (APPLY && updates.length) {
    /** 칸 단위로 쓴다 — 열을 통째로 덮으면 사람이 고친 값이 같이 날아간다. */
    for (let i = 0; i < updates.length; i += 500) {
      await api(`https://sheets.googleapis.com/v4/spreadsheets/${t.id}/values:batchUpdate`, {
        method: 'POST',
        body: JSON.stringify({ valueInputOption: 'RAW', data: updates.slice(i, i + 500) }),
      });
    }
  }
}

console.log(`\n  ${'─'.repeat(58)}`);
console.log(`  모두 ${totCars}대 · 채울 칸 ${totFilled} · 이미 있어 그대로 둔 칸 ${totKept}`);
if (codeSet || codeUnset) {
  console.log(`  차종코드   박음 ${codeSet}대 · 못 박음 ${codeUnset}대`);
}
if (codeFixed) {
  console.log(`
  ▲ 코드를 따라 표시칸을 고친 칸 ${codeFixed} — 코드와 어긋나 있던 값이다`);
  for (const l of codeFixList) console.log(`     ${l}`);
  if (codeFixed > codeFixList.length) console.log(`     … 그 밖 ${codeFixed - codeFixList.length}칸`);
}
if (badCcWritten) {
  console.log(`\n  ▲ 옛 방식이 잘못 찍어 둔 배기량 ${badCcWritten}칸을 되돌린다 (배터리 용량·구동축 숫자였다)`);
  for (const l of ccFixList) console.log(`     ${l}`);
  if (badCcWritten > ccFixList.length) console.log(`     … 그 밖 ${badCcWritten - ccFixList.length}칸`);
}
if (noTail.length) console.log(`\n  ▲ 정제칸이 없는 시트 ${noTail.length} — 먼저 add-supplier-ai-columns 를 돌려야 한다\n     ${noTail.join(' · ')}`);
if (totLow) {
  console.log(`\n  ▲ 차종마스터가 못 알아본 차 ${totLow}대 — 비워 둔다. 마스터에 넣거나 사람이 직접 적어야 한다`);
  for (const l of lowList) console.log(`     ${l}`);
  if (totLow > lowList.length) console.log(`     … 그 밖 ${totLow - lowList.length}대`);
}
if (noName) {
  console.log(`
  ▲ 차명을 한 글자도 못 읽은 차 ${noName}대 — 그 시트의 열 이름이 매핑에 없다`);
  for (const l of nameList) console.log(`     ${l}`);
  if (noName > nameList.length) console.log(`     … 그 밖 ${noName - nameList.length}대`);
}
if (codeUnset) {
  const WHY: Record<string, string> = {
    세부모델없음: '그 세부모델이 마스터에 통째로 없다 — **마스터에 넣어야 할 차**',
    트림없음: '세부모델은 있는데 그 트림이 없다 — 트림을 넣거나 이름을 맞춰야 한다',
    배기량안맞음: '세부모델·트림은 맞는데 연료/배기량이 안 맞는다 — 파워트레인 줄이 없다',
    여럿: '후보가 여럿이라 못 고른다 — 사람이 하나를 정해야 한다',
    없음: '못 찾았다',
  };
  console.log(`
  ▲ 차종코드를 못 박은 차 ${codeUnset}대 — 갈래별로 할 일이 다르다`);
  for (const [why, n] of [...codeWhy].sort((a, b) => b[1] - a[1])) {
    console.log(`
     ■ ${why} ${n}대 — ${WHY[why] || ''}`);
    for (const l of (codeByWhy.get(why) || [])) console.log(`        ${l}`);
    const shown = (codeByWhy.get(why) || []).length;
    if (n > shown) console.log(`        … 그 밖 ${n - shown}대`);
  }
}
if (badCc) {
  console.log(`\n  ▲ 공급사 배기량과 마스터가 어긋난 차 ${badCc}대 — 세대를 잘못 잡은 것이다. 한 칸도 안 채웠다`);
  for (const l of ccList) console.log(`     ${l}`);
  if (badCc > ccList.length) console.log(`     … 그 밖 ${badCc - ccList.length}대`);
}
console.log(APPLY ? '\n  반영 완료 — 이제 발행기는 즉석 판단 대신 이 글자를 읽는다.\n' : '\n  미리보기였다. 실제로 쓰려면 --apply\n');
