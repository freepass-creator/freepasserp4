/**
 * **공급사 시트 → ERP 원자 반영** — 「운영정책」 탭 ↔ ERP 정책 · 「회사정보」 탭 ↔ ERP 파트너.
 *
 * 기본은 읽기 전용 대조다. «무엇이 달라졌나»를 보여 주고, 반영은 사람이 보고 정한다(사장님 2026-08-19 원자 확보 — 시트가 채워지면 여기서 ERP 로 들여온다).
 *
 * ★규칙
 *   · 시트 빈칸은 «다름»이 아니다 — 공급사가 아직 안 적은 것. 빈칸으로 ERP 값을 지우지 않는다.
 *   · 값은 글자 그대로 비교하지 않는다(「50만원」/「500000」·「30%」/「0.3」·「만 26세 이상」/「26」) — foldPolicyValue 로 접어서 다른 것만 «다름».
 *   · `--apply`        : ERP 가 **비어 있는** 칸만 채운다(안전).
 *   · `--apply --overwrite` : 시트와 다른 칸도 시트 값으로 바꾼다(시트가 정본이라고 정한 뒤에만).
 *   · 규격 밖 값(검토)은 어느 모드에서도 안 쓴다 — normalize-policy-values 로 먼저 고친다.
 *   · 「(프리패스 기본)」 줄은 우리 기준값이라 대조·반영하지 않는다.
 *   · 정책이 ERP 에 없으면 만들지 않는다(★ 표시만) — 정책 신설은 정책관리에서.
 *
 *   npx tsx scripts/audit-policy-sheet-vs-erp.mts                 # 대조만
 *   npx tsx scripts/audit-policy-sheet-vs-erp.mts --code=RP013     # 한 공급사
 *   npx tsx scripts/audit-policy-sheet-vs-erp.mts --apply          # ERP 빈칸 채우기
 *   npx tsx scripts/audit-policy-sheet-vs-erp.mts --apply --overwrite
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { POLICY_TAB_ALIASES, POLICY_COLUMN_FIELDS, supplierSheetLabel } from '../lib/domain/supplier-template-sheet';
import { policyUsableBy } from '../lib/domain/policy-access';
import { COMPANY_INFO_TAB_TITLE } from '../lib/domain/company-info-sheet';
import { readPolicyTab } from '../lib/domain/supplier-policy-read';
import { companyInfoToPartner, foldPolicyValue, sheetPolicyToErp } from '../lib/domain/policy-sheet-to-erp';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const ONLY = (process.argv.find((a) => a.startsWith('--code=')) || '').slice('--code='.length).trim();
const APPLY = process.argv.includes('--apply');
const OVERWRITE = process.argv.includes('--overwrite');
const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const dbT = (await new JWT({ email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/firebase.database', 'https://www.googleapis.com/auth/userinfo.email'] }).getAccessToken()).token;
const gT = (await new JWT({ email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/drive', 'https://www.googleapis.com/auth/spreadsheets'],
  subject: 'pyh@teamjpk.com' }).getAccessToken()).token;
// ★429(분당 읽기 한도)·5xx 는 물러났다 다시 — 조용히 빈 표로 읽히면 「정책 0개」로 오판한다(2026-08-19 실측).
const api = async (url: string, init?: RequestInit): Promise<Rec> => {
  for (let n = 0; ; n++) {
    const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${gT}`, 'Content-Type': 'application/json', ...(init?.headers || {}) } });
    const body = await res.json().catch(() => ({})) as Rec;
    if (res.ok) return body;
    if ((res.status === 429 || res.status >= 500) && n < 6) { await new Promise((ok) => setTimeout(ok, Math.min(60_000, 5_000 * 2 ** n))); continue; }
    throw new Error(body?.error?.message || `HTTP ${res.status}`);
  }
};
const dbGet = async (path: string): Promise<Rec> => JSON.parse(await (await fetch(`${DB}/${path}.json?access_token=${dbT}`)).text()) || {};
const dbPatch = async (path: string, body: Rec): Promise<void> => {
  const res = await fetch(`${DB}/${path}.json?access_token=${dbT}`, { method: 'PATCH', body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status} ${await res.text()}`);
};

const [pol4, t4] = await Promise.all([dbGet('v4/policies'), dbGet('v4/partners')]);
const dead = (p: Rec) => p?._deleted === true || !!p?.deletedAt || S(p?.status) === 'deleted';
const withKey = (src: Rec): Record<string, Rec> => Object.fromEntries(Object.entries<Rec>(src).filter(([, v]) => v && typeof v === 'object').map(([k, v]) => [k, { ...v, _key: k }]));
const policies = withKey(pol4);
const partners = withKey(t4);

const q = encodeURIComponent("mimeType='application/vnd.google-apps.spreadsheet' and trashed=false and name contains '프리패스 재고'");
const found = await api(`https://www.googleapis.com/drive/v3/files?q=${q}&pageSize=100&fields=files(id,name)&orderBy=name&includeItemsFromAllDrives=true&supportsAllDrives=true`);

const nameToCode = new Map<string, string>();
for (const p of Object.values<Rec>(partners)) {
  if (dead(p)) continue;
  const code = S(p.partner_code) || S(p._key);
  for (const n of [p.partner_name, p.name, p.company_name, p.alias].map(S).filter(Boolean)) nameToCode.set(n.replace(/\s|\(주\)|주식회사|㈜/g, ''), code);
}
/** 시트 이름 → 파트너 코드. 똑같은 이름 → 그 이름으로 시작 → 품기(하나뿐일 때). 여럿이면 고르지 않는다(남의 회사 차가 실린다). */
const codeOf = (label: string): string => {
  const l = label.replace(/\s/g, '');
  if (nameToCode.has(l)) return nameToCode.get(l)!;
  const starts = [...nameToCode].filter(([n]) => n.startsWith(l));
  if (starts.length === 1) return starts[0][1];
  const holds = [...nameToCode].filter(([n]) => n.includes(l) || l.includes(n));
  if (holds.length === 1) return holds[0][1];
  return '';
};
const partnerByCode = (code: string) => Object.values<Rec>(partners).find((p) => !dead(p) && (S(p.partner_code) === code || S(p._key) === code));

console.log(`■ 공급사 시트 → ERP 원자 ${APPLY ? (OVERWRITE ? '반영(빈칸 채움 + 다른 값 덮어씀)' : '반영(ERP 빈칸만 채움)') : '대조(읽기 전용)'}\n`);
type Diff = { who: string; code: string; policy: string; field: string; label: string; sheet: string; erp: string; kind: '빈칸채움' | '다름' };
const diffs: Diff[] = [];
const reviews: string[] = [];
let same = 0, blanks = 0, missingInErp = 0, writes = 0;
const backup: Rec = { at: new Date().toISOString(), policies: {}, partners: {} };
const labelOf = new Map(POLICY_COLUMN_FIELDS.map((c) => [c.field, c.name]));

/**
 * 한 문서를 «법인 여럿»이 나눠 쓴다(2026-08-20) — 스타/스카이 · 경진카/경진렌트 · 빌린카/엘씨.
 * 파일 이름으로 공급사를 하나만 고르면 둘째 법인 정책이 통째로 안 들어온다.
 * 그래서 그 문서를 가리키는 파트너를 «모두» 찾고, 각자 `policy_tab`(gid) 탭만 읽는다.
 */
const ownersOf = (fileId: string, fallbackCode: string): { code: string; policyTab: string }[] => {
  const list = Object.values<Rec>(partners)
    .filter((p) => !dead(p) && S(p.sheet_url).includes(fileId))
    .map((p) => ({ code: S(p.partner_code) || S(p._key), policyTab: S(p.policy_tab) }));
  if (list.length) return list;
  return fallbackCode ? [{ code: fallbackCode, policyTab: '' }] : [];
};

for (const f of ((found.files || []) as Rec[])) {
  // 폐기 표시된 옛 시트는 안 읽는다 — 이름에 「프리패스 재고」가 남아 있어 그냥 두면 옛 정책이 다시 들어온다
  if (/\[구버전[·・]?폐기\]/.test(S(f.name))) continue;
  const who = supplierSheetLabel(f.name);
  const owners = ownersOf(S(f.id), codeOf(who));
  if (!owners.length) { console.log(`  △ ${who.padEnd(12)} 파트너를 못 찾음 — 건너뜀`); continue; }
  let titleByGid = new Map<string, string>();
  if (owners.some((o) => o.policyTab)) {
    const meta = await api(`https://sheets.googleapis.com/v4/spreadsheets/${S(f.id)}?fields=sheets(properties(title,sheetId))`);
    titleByGid = new Map(((meta.sheets || []) as Rec[]).map((sh) => [String(sh.properties?.sheetId), S(sh.properties?.title)]));
  }

 for (const owner of owners) {
  const code = owner.code;
  if (ONLY && code !== ONLY) continue;

  // ── 운영정책 — 그 법인의 탭만(gid). 없으면 옛 이름들로 찾는다.
  let rows: string[][] = [];
  const tabs = [titleByGid.get(owner.policyTab), ...POLICY_TAB_ALIASES].filter(Boolean) as string[];
  for (const tab of tabs) {
    try { const v = await api(`https://sheets.googleapis.com/v4/spreadsheets/${S(f.id)}/values/${encodeURIComponent(`'${tab}'`)}`); if (v?.values?.length) { rows = v.values; break; } } catch { /* 다음 별칭 */ }
  }
  const book = readPolicyTab(rows);
  let n = 0, b = 0, d = 0, fill = 0;
  for (const [pc, row] of book) {
    if (!pc) continue;   // (프리패스 기본)
    const erp = Object.values<Rec>(policies).find((x) => !dead(x) && (S(x.policy_code) === pc || S(x._key) === pc));
    if (!erp) { missingInErp++; console.log(`  ★ ${who.padEnd(12)} 정책 「${pc}」 가 ERP 에 없다 — 정책관리에서 먼저 만든다`); continue; }
    // 관계사라 같이 쓰는 정책(`shared_with`)은 통과시킨다 — 아니면 남의 회사 정책이라 건너뛴다
    if (S(erp.provider_company_code) && !policyUsableBy(erp, code)) { console.log(`  ⛔ ${who.padEnd(12)} 정책 「${pc}」 는 다른 회사(${erp.provider_company_code}) 것 — 건너뜀`); continue; }
    const { patch, review, blank } = sheetPolicyToErp(row);
    b += blank; blanks += blank;
    review.forEach((r) => reviews.push(`${who} · ${pc} · ${r.name}: 「${r.raw}」 — ${r.note}`));
    const write: Rec = {};
    for (const [field, value] of Object.entries(patch)) {
      n++;
      const erpV = erp[field];
      const erpFilled = erpV !== undefined && erpV !== null && S(erpV) !== '';
      if (erpFilled && foldPolicyValue(erpV) === foldPolicyValue(value)) { same++; continue; }
      const kind: Diff['kind'] = erpFilled ? '다름' : '빈칸채움';
      if (kind === '다름') d++; else fill++;
      diffs.push({ who, code, policy: pc, field, label: labelOf.get(field) || field, sheet: S(value).slice(0, 60), erp: S(erpV).slice(0, 60), kind });
      if (kind === '빈칸채움' || OVERWRITE) write[field] = value;
    }
    if (APPLY && Object.keys(write).length) {
      backup.policies[erp._key] = Object.fromEntries(Object.keys(write).map((k) => [k, erp[k] ?? null]));
      await dbPatch(`v4/policies/${erp._key}`, { ...write, sheet_synced_at: Date.now(), updated_at: Date.now() });
      writes += Object.keys(write).length;
    }
  }
  const pcs = [...book.keys()].filter(Boolean);
  // 한 문서에 법인이 둘이면 파일 이름만으론 어느 쪽인지 모른다 — 코드를 같이 찍는다
  const tag = owners.length > 1 ? `${who}(${code})` : who;
  console.log(`  ${tag.padEnd(16)}정책 ${pcs.length}개 · 칸 ${n} — 같음 ${n - d - fill} · 다름 ${d} · ERP 빈칸 ${fill} · 시트 빈칸 ${b}`);

  // ── 회사정보 → 파트너
  try {
    const cv = await api(`https://sheets.googleapis.com/v4/spreadsheets/${S(f.id)}/values/${encodeURIComponent(`'${COMPANY_INFO_TAB_TITLE}'!A1:C60`)}`);
    const partner = partnerByCode(code);
    if (partner && cv?.values?.length) {
      const { patch } = companyInfoToPartner(cv.values as string[][]);
      const write: Rec = {};
      let pd = 0, pf = 0;
      for (const [field, value] of Object.entries(patch)) {
        const erpV = S(partner[field]);
        const norm = (v: string) => v.replace(/[\s-]/g, '');
        if (erpV && norm(erpV) === norm(value)) continue;
        const kind: Diff['kind'] = erpV ? '다름' : '빈칸채움';
        if (kind === '다름') pd++; else pf++;
        diffs.push({ who, code, policy: '(회사정보)', field, label: field, sheet: value.slice(0, 60), erp: erpV.slice(0, 60), kind });
        if (kind === '빈칸채움' || OVERWRITE) write[field] = value;
      }
      if (pd || pf) console.log(`  ${''.padEnd(12)}회사정보 — 다름 ${pd} · ERP 빈칸 ${pf}`);
      if (APPLY && Object.keys(write).length) {
        backup.partners[partner._key] = Object.fromEntries(Object.keys(write).map((k) => [k, partner[k] ?? null]));
        await dbPatch(`v4/partners/${partner._key}`, { ...write, company_info_synced_at: Date.now(), updated_at: Date.now() });
        writes += Object.keys(write).length;
      }
    }
  } catch { /* 회사정보 탭 없음 */ }
 }
}

const fills = diffs.filter((x) => x.kind === '빈칸채움').length;
const others = diffs.filter((x) => x.kind === '다름').length;
console.log(`\n  ─────────────────────────────────────────`);
console.log(`  같음 ${same} · 다름 ${others} · ERP 빈칸(채울 수 있음) ${fills} · 시트에 아직 안 적음 ${blanks}${missingInErp ? ` · ERP 에 없는 정책 ${missingInErp}` : ''}${reviews.length ? ` · 규격 밖(검토) ${reviews.length}` : ''}`);
if (APPLY) console.log(`  ✓ 반영 ${writes}칸${OVERWRITE ? '(덮어씀 포함)' : '(빈칸만)'}`);
else if (fills || others) console.log(`  → 반영하려면 --apply(빈칸만) · --apply --overwrite(다른 값도)`);

if (others) {
  console.log('\n  다른 칸 — 시트와 ERP 가 서로 다르다');
  for (const x of diffs.filter((y) => y.kind === '다름').slice(0, 40)) {
    console.log(`   ${x.who.slice(0, 10).padEnd(12)}${x.policy.padEnd(12)}${x.label.padEnd(16)}시트「${x.sheet.slice(0, 22)}」  ERP「${x.erp.slice(0, 22) || '(빈칸)'}」`);
  }
  if (others > 40) console.log(`   … 외 ${others - 40}건`);
}
if (fills) {
  console.log('\n  ERP 빈칸 — 시트 값으로 채울 수 있다(--apply)');
  for (const x of diffs.filter((y) => y.kind === '빈칸채움').slice(0, 40)) console.log(`   ${x.who.slice(0, 10).padEnd(12)}${x.policy.padEnd(12)}${x.label.padEnd(16)}시트「${x.sheet.slice(0, 40)}」`);
  if (fills > 40) console.log(`   … 외 ${fills - 40}건`);
}
if (reviews.length) { console.log('\n  규격 밖(검토) — normalize-policy-values 로 먼저 고친다'); reviews.slice(0, 20).forEach((r) => console.log(`   ${r}`)); }

mkdirSync('tmp', { recursive: true });
const esc = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
writeFileSync('tmp/policy-sheet-vs-erp.csv', `﻿${[
  ['공급사', '코드', '정책코드', '항목', 'ERP 필드', '종류', '시트 값', 'ERP 값'].join(','),
  ...diffs.map((x) => [x.who, x.code, x.policy, x.label, x.field, x.kind, x.sheet, x.erp].map(esc).join(',')),
].join('\r\n')}`, 'utf8');
if (APPLY) { const bp = `tmp/policy-sheet-apply-backup-${Date.now()}.json`; writeFileSync(bp, JSON.stringify(backup, null, 1), 'utf8'); console.log(`  백업: ${bp}`); }
console.log(`\n  CSV: tmp/policy-sheet-vs-erp.csv (${diffs.length}행)\n`);
