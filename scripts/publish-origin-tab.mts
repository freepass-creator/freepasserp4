/**
 * **공급사 시트를 ERP 안 거치고 영업자 표로 그대로 찍는다.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★왜(사장님 2026-08-12 — 「erp 의존하지말고 일단 니가 ai로 작업해서 올리자고」)
 *   영업자가 ERP 를 안 믿는다. 오늘 하루에 오플 요금 92대 밀림·유령 48개월 72대·아이카 37대가
 *   나왔고, 전부 **우리가 옮기다 생긴 오류**였다. 공급사 시트에는 맞게 적혀 있었다.
 *   그래서 옮기는 단계를 뺀다 — 공급사가 쓴 글자를 그대로 싣는다.
 *
 * ★**돈은 해석하지 않는다.** 요금·보증금·상태는 시트 칸에 있는 글자를 그 자리에 옮길 뿐이다.
 *   보증금을 규칙으로 계산하지 않고, 기간을 자리로 짐작하지 않는다 — 오늘 틀린 게 전부 그거였다.
 * ★**차명만 차종마스터로 올린다**(사장님 2026-08-12 — 「니가 학습해서 차종마스터 값으로 옮겨줄수 있어?」).
 *   공급사마다 「G70」·「제네시스 G70 2.0T」처럼 제각각이라 그대로 두면 정렬도 검색도 안 된다.
 *   ★이건 오늘 틀린 것과 **다른 일**이다. 차종 스냅은 실측 98.5% 맞았고, 틀린 건 요금 매핑이었다.
 *   ⚠ 확신도가 낮으면(low) **안 올린다** — 공급사 원문을 그대로 둔다. 틀린 차명이 붙느니 낫다.
 *   ⚠ 원문은 「공급사표기」 칸에 그대로 남긴다. 무엇을 무엇으로 바꿨는지 눈으로 확인할 수 있어야 한다.
 *   ⚠ 그래서 공급사 시트가 틀리면 여기도 틀린다. 그건 «공급사에 물어볼 일»이 되고,
 *     영업자가 우리를 의심할 일은 없어진다 — 이 표의 값어치는 정확히 거기에 있다.
 * ★읽는 법만 `readSupplierSheet` 를 쓴다(숨긴 행·숨긴 탭·어댑터 헤더). 그건 «해석»이 아니라
 *   «어디가 표인지» 찾는 일이라 빼면 엉뚱한 줄을 싣는다.
 * ★열 배치는 영업자가 보던 것과 같게 둔다 — 공급사마다 열이 다르다고 표를 들쭉날쭉하게 두면
 *   그게 또 «못 믿을 표»가 된다. 시트에 없는 칸은 **비운다**(지어내지 않는다).
 *
 *   npx tsx scripts/publish-origin-tab.mts
 *   npx tsx scripts/publish-origin-tab.mts --apply
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { NOT_SHEET_BACKED, SHEET_GRID_FIELDS, readSupplierSheet } from '../lib/domain/supplier-sheet-read';
import { companyAlias } from '../lib/domain/identity';
import { snapToMaster } from '../lib/domain/vehicle-master-match';
import type { MasterEntry } from '../lib/domain/vehicle-master-types';
import type { EntityRecord } from '../lib/intake/entities';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const norm = (v: unknown) => S(v).replace(/\s+/g, '');
const APPLY = process.argv.includes('--apply');
const arg = (k: string, d = '') => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3) || d;
const SHEET = arg('sheet', '1Y1Mx1EcEpAuNer0y50Dq4eK92CpVjThO_suZLmo2vVs');
const TAB = arg('tab', '상품리스트(공급사원문)');
const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';

/** 영업자가 보던 배치. 시트에 없는 칸은 빈칸으로 둔다. */
const COLUMNS = [
  '상태', '구분', '차량번호', '차종', '세부모델', '외장', '내장', '연식', '연료', 'Km',
  '단기보증', '1개월', '12개월', '장기보증', '24개월', '36개월', '48개월', '60개월',
  '옵션', '최초등록', '소비자가격', '제조사', '배기량', '연주행',
  // 무엇을 무엇으로 바꿨는지 보이게 — 마스터로 올린 차명 옆에 공급사 원문을 남긴다.
  '공급사표기', '차종매칭',
  '대인', '대물', '자차', '자손', '무보험', '비고',
  '공급사', '시트탭',
] as const;

/**
 * 영업자 열 ← 공급사 시트 열 이름 후보. **먼저 맞는 것**을 쓴다.
 * ⚠ 여기 없는 이름은 안 옮긴다 — 짐작해서 붙이면 그게 곧 «우리가 만든 오류»다.
 */
const ALIAS: Record<string, string[]> = {
  상태: ['배차상태', '판매상태', '상태', '차량상태'],
  구분: ['구분', '분류', '상품구분'],
  차량번호: ['차량번호', '차번'],
  차종: ['차종', '차종분류', '모델'],
  세부모델: ['모델명(트림)', '차명(트림)', '세부모델', '트림', '모델명'],
  외장: ['외장색', '외부색상', '외장', '색상'],
  내장: ['내장색', '내부색상', '내장'],
  연식: ['연식'],
  연료: ['유종', '연료'],
  Km: ['주행거리', 'Km', 'km'],
  단기보증: ['단기보증'],
  '1개월': ['1개월', '월렌트', '월세'],
  '12개월': ['12개월'],
  장기보증: ['장기보증', '보증금'],
  '24개월': ['24개월'],
  '36개월': ['36개월'],
  '48개월': ['48개월'],
  '60개월': ['60개월'],
  옵션: ['옵션'],
  최초등록: ['최초등록', '최초등록일'],
  소비자가격: ['소비자가격', '차량가격', '소비자가'],
  제조사: ['제조사', '메이커'],
  배기량: ['배기량'],
  연주행: ['연주행', '약정주행'],
  대인: ['대인'], 대물: ['대물'], 자차: ['자차'], 자손: ['자손'], 무보험: ['무보험'],
  비고: ['비고', '메모', '특이사항'],
};

/** 차종마스터 — 차명을 올릴 때만 쓴다. 돈에는 손대지 않는다. */
const masterRaw = JSON.parse(readFileSync('public/data/vehicle-master.json', 'utf8')) as Rec;
const MASTER = ((Array.isArray(masterRaw) ? masterRaw : masterRaw.entries) || []) as MasterEntry[];

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const dbT = (await new JWT({ email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/firebase.database', 'https://www.googleapis.com/auth/userinfo.email'] }).getAccessToken()).token;
const gT = (await new JWT({ email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'], subject: 'pyh@teamjpk.com' }).getAccessToken()).token;
const api = async (url: string, init?: RequestInit): Promise<Rec> => {
  const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${gT}`, 'Content-Type': 'application/json', ...(init?.headers || {}) } });
  const body = await res.json().catch(() => ({})) as Rec;
  if (!res.ok) throw new Error(body?.error?.message || `HTTP ${res.status}`);
  return body;
};

const [t3, t4] = await Promise.all(['partners', 'v4/partners'].map(async (n) =>
  JSON.parse(await (await fetch(`${DB}/${n}.json?access_token=${dbT}`)).text()) || {}));
const dead = (p: Rec) => p?._deleted === true || !!p?.deletedAt || S(p?.status) === 'deleted';
const partners: Record<string, Rec> = {};
for (const src of [t3, t4] as Rec[]) for (const [k, v] of Object.entries<Rec>(src)) if (v && typeof v === 'object') partners[k] = { ...(partners[k] || {}), ...v, _key: k };
/**
 * 한 공급사에 시트 주소가 **두 벌**일 수 있다(v3·v4 파트너가 같은 코드를 쓴다).
 * 하나는 옛 시트라 읽으면 표가 안 나온다 — 실측 2026-08-12: 아이카가 그래서 0대로 나왔다.
 * 그래서 주소를 **후보로 모아 두고**, 아래에서 «읽어서 표가 나오는 쪽»을 쓴다.
 * 이름만 보고 고르면 또 틀린다.
 */
const byCode = new Map<string, Rec & { sheet_urls: string[] }>();
for (const p of Object.values<Rec>(partners)) {
  if (dead(p)) continue;
  const c = S(p.partner_code);
  if (!c) continue;
  const cur = byCode.get(c);
  const urls = [...(cur?.sheet_urls || []), S(p.sheet_url)].filter(Boolean);
  byCode.set(c, { ...(cur || {}), ...p, sheet_urls: [...new Set(urls)] });
}

console.log(`■ 공급사 시트를 그대로 영업자 표로 ${APPLY ? '(반영)' : '(dry-run)'}\n`);
const rows: string[][] = [];
const failures: string[] = [];
const seenPlate = new Set<string>();
let dupes = 0;
for (const [code, p] of [...byCode].sort()) {
  if (NOT_SHEET_BACKED.has(code)) { failures.push(`${S(p.partner_name || p.name)}(${code}) — 홈페이지 수집이라 시트가 없다`); continue; }
  // 후보 주소를 차례로 열어 **표가 나오는 첫 번째**를 쓴다. 하나도 안 나오면 그 공급사는 «모름»이다.
  let read: ReturnType<typeof readSupplierSheet> | null = null;
  let lastErr = '';
  for (const url of (p.sheet_urls || [])) {
    const id = (S(url).match(/\/d\/([\w-]+)/) || [])[1];
    if (!id) continue;
    try {
      const grid = await api(`https://sheets.googleapis.com/v4/spreadsheets/${id}?includeGridData=true&fields=${encodeURIComponent(SHEET_GRID_FIELDS)}`);
      const got = readSupplierSheet(grid as never, p as EntityRecord);
      if (got.tabs.length) { read = got; break; }
      lastErr = '표가 있는 탭이 없다';
    } catch (e) { lastErr = String((e as Error).message).slice(0, 50); }
  }
  if (!read) {
    if (p.sheet_urls?.length) failures.push(`${S(p.partner_name || p.name)}(${code}) — 시트를 못 읽었다: ${lastErr}`);
    continue;
  }
  for (const f of read.failures) failures.push(`${S(p.partner_name || p.name)}(${code}) 「${S((f as Rec).title)}」 — ${S((f as Rec).reason)}`);
  const who = companyAlias(S(p.partner_name || p.name)) || S(p.partner_name || p.name) || code;
  let n = 0;
  for (const t of read.tabs) {
    const hdr = (t.table[0] || []).map(S);
    const pick = (name: string) => {
      for (const cand of ALIAS[name] || []) { const i = hdr.indexOf(cand); if (i >= 0) return i; }
      return -1;
    };
    const idx = new Map(COLUMNS.map((c) => [c, pick(c)]));
    if ((idx.get('차량번호') ?? -1) < 0) continue;
    for (const r of t.table.slice(1)) {
      const plate = norm(r[idx.get('차량번호')!]);
      if (!plate) continue;
      // 같은 차가 두 탭에 있으면 먼저 나온 쪽만 싣는다 — 영업자 표에 같은 차가 두 줄이면 안 된다.
      if (seenPlate.has(plate)) { dupes++; continue; }
      seenPlate.add(plate);
      const cell = (c: string) => { const i = idx.get(c) ?? -1; return i >= 0 ? S(r[i]) : ''; };
      /**
       * 차명을 마스터에 올린다. 공급사 원문은 「차종 + 세부모델」을 이어 붙인 문장을 쓴다 —
       * 트림까지 한 문장으로 줘야 세대·사양이 잡힌다(짧은 이름은 엉뚱한 세대로 붙는다).
       */
      const raw = [cell('차종'), cell('세부모델')].filter(Boolean).join(' ').trim();
      const snap = raw ? snapToMaster({
        maker: cell('제조사'), model: cell('차종'), sub_model: cell('세부모델'),
        year: cell('연식'), fuel_type: cell('연료'),
      } as EntityRecord, MASTER) : null;
      // ⚠ 낮은 확신도는 안 쓴다 — 틀린 차명이 붙느니 공급사 원문이 낫다.
      const ok = snap && (snap.confidence === 'high' || snap.confidence === 'medium');
      rows.push(COLUMNS.map((c) => {
        if (c === '공급사') return who;
        if (c === '시트탭') return t.title;
        if (c === '공급사표기') return raw;
        if (c === '차종매칭') return ok ? S(snap!.confidence) : (snap ? '확인필요' : '');
        if (ok && c === '제조사') return S(snap!.maker) || cell(c);
        if (ok && c === '차종') return S(snap!.model) || cell(c);
        if (ok && c === '세부모델') return S(snap!.sub_model) || cell(c);
        return cell(c);
      }));
      n++;
    }
  }
  console.log(`  ${who.padEnd(14)}${String(n).padStart(4)}대`);
}
console.log(`\n  모두 ${rows.length}대${dupes ? ` · 같은 차가 두 번 나와 건너뛴 줄 ${dupes}` : ''}`);
if (failures.length) {
  console.log(`\n  ✗ 못 읽은 것 ${failures.length}건 — 이만큼은 «모름»이다`);
  for (const f of failures) console.log(`     ${f}`);
}
if (!APPLY) { console.log('\n※ dry-run. 실제 반영은 --apply\n'); process.exit(0); }

const meta = await api(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET}?fields=sheets.properties(sheetId,title)`);
let gid = ((meta.sheets || []) as Rec[]).find((s) => S(s.properties?.title).startsWith(TAB))?.properties?.sheetId as number | undefined;
if (gid == null) {
  const made = await api(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET}:batchUpdate`, {
    method: 'POST', body: JSON.stringify({ requests: [{ addSheet: { properties: { title: TAB, index: 0 } } }] }),
  });
  gid = Number(((made.replies || []) as Rec[])[0]?.addSheet?.properties?.sheetId ?? 0);
}
const stamp = new Date(Date.now() + 9 * 3600_000).toISOString();
const title = `${TAB} ${stamp.slice(5, 10).replace('-', '.')} ${stamp.slice(11, 16)} · ${rows.length}대`;
await api(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET}:batchUpdate`, {
  method: 'POST',
  body: JSON.stringify({ requests: [
    { updateSheetProperties: { properties: { sheetId: gid, title }, fields: 'title' } },
    // 옛 내용을 지우고 새로 쓴다. 값만 지운다 — 서식은 아래에서 다시 입힌다.
    { updateCells: { range: { sheetId: gid }, fields: 'userEnteredValue' } },
  ] }),
});
await api(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET}/values/${encodeURIComponent(`${title}!A1`)}?valueInputOption=RAW`, {
  method: 'PUT', body: JSON.stringify({ values: [[...COLUMNS], ...rows] }),
});
console.log(`\n  반영 완료 — 탭 「${title}」\n  https://docs.google.com/spreadsheets/d/${SHEET}/edit#gid=${gid}\n`);
