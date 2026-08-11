/**
 * **공급사 시트의 「정책」 탭 ↔ ERP 정책**을 맞대 본다. 읽기 전용.
 *
 * 정책탭은 지금 **한 방향**이다 — ERP 값을 채워 내보내기만 하고 되읽지 않는다.
 * 그래서 공급사가 고쳐도 ERP 는 모른다. 이 도구는 «무엇이 달라졌나»를 먼저 보여 준다.
 * 반영은 사람이 보고 정한다(`--csv` 로 표를 받아 정책관리에서 고친다).
 *
 * ★값을 글자 그대로 비교하지 않는다. 같은 뜻을 다르게 적어 놓은 게 많다 —
 *   「50만원」/「500000」 · 「차량가액」/「차량가 기준」 · 「연간 2만Km」/「연 20,000km」.
 *   접어서 비교하고, **접어도 다른 것만** 어긋남으로 센다.
 *
 * ★시트가 비어 있는 칸은 «다름»이 아니다. 공급사가 아직 안 적은 것이다 —
 *   빈칸으로 ERP 값을 지우면 안 된다. 따로 「아직 안 적음」으로 센다.
 *
 *   npx tsx scripts/audit-policy-sheet-vs-erp.mts
 *   npx tsx scripts/audit-policy-sheet-vs-erp.mts --code=RP013
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { POLICY_COLUMN_FIELDS, POLICY_TAB_NAME } from '../lib/domain/supplier-template-sheet';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const ONLY = (process.argv.find((a) => a.startsWith('--code=')) || '').slice('--code='.length).trim();
const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const dbT = (await new JWT({ email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/firebase.database', 'https://www.googleapis.com/auth/userinfo.email'] }).getAccessToken()).token;
const gT = (await new JWT({ email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/drive', 'https://www.googleapis.com/auth/spreadsheets'],
  subject: 'pyh@teamjpk.com' }).getAccessToken()).token;
const api = async (url: string, init?: RequestInit): Promise<Rec> => {
  const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${gT}`, 'Content-Type': 'application/json', ...(init?.headers || {}) } });
  const body = await res.json().catch(() => ({})) as Rec;
  if (!res.ok) throw new Error(body?.error?.message || `HTTP ${res.status}`);
  return body;
};

const [pol3, pol4, t3, t4] = await Promise.all(['policies', 'v4/policies', 'partners', 'v4/partners'].map(async (n) =>
  JSON.parse(await (await fetch(`${DB}/${n}.json?access_token=${dbT}`)).text()) || {}));
const dead = (p: Rec) => p?._deleted === true || !!p?.deletedAt || S(p?.status) === 'deleted';
const merge = (...srcs: Rec[]) => {
  const out: Record<string, Rec> = {};
  for (const s of srcs) for (const [k, v] of Object.entries<Rec>(s)) if (v && typeof v === 'object') out[k] = { ...(out[k] || {}), ...v, _key: k };
  return out;
};
const policies = merge(pol3, pol4);
const partners = merge(t3, t4);

/**
 * 값 접기 — 같은 뜻이면 같은 글자가 되게.
 * 이걸 안 하면 «다름»이 수백 건 나와 진짜 다른 것이 묻힌다.
 */
function fold(v: unknown): string {
  let t = S(v).replace(/\s+/g, '');
  if (!t) return '';
  if (/^차량가(액|기준)$/.test(t)) return '차량가액';
  if (/^(없음|불가|해당없음|-)$/.test(t)) return '없음';
  if (/^(가능|가능함|o|O)$/.test(t)) return '가능';
  // 금액 — 「50만원」·「500000」·「50만」 을 한 꼴로
  const man = t.match(/^([\d.]+)만원?$/);
  if (man) return `${Math.round(Number(man[1]) * 10000)}`;
  const eok = t.match(/^([\d.]+)억원?$/);
  if (eok) return `${Math.round(Number(eok[1]) * 100000000)}`;
  const num = t.replace(/[,원]/g, '');
  if (/^\d+$/.test(num)) return String(Number(num));
  // 주행 — 「연간 2만Km」·「연 20,000km」·「2만km」
  const km = t.match(/(\d[\d,.]*)(만)?k?m/i);
  if (km) {
    const base = Number(km[1].replace(/,/g, ''));
    return `주행${km[2] ? base * 10000 : base}`;
  }
  return t.toLowerCase();
}

const q = encodeURIComponent("mimeType='application/vnd.google-apps.spreadsheet' and 'me' in owners and trashed=false and name contains '프리패스 재고'");
const found = await api(`https://www.googleapis.com/drive/v3/files?q=${q}&pageSize=100&fields=files(id,name)&orderBy=name`);

const nameToCode = new Map<string, string>();
for (const p of Object.values<Rec>(partners)) {
  if (dead(p)) continue;
  const code = S(p.partner_code) || S(p._key);
  for (const n of [p.partner_name, p.name, p.company_name].map(S).filter(Boolean)) nameToCode.set(n.replace(/\s|\(주\)|주식회사|㈜/g, ''), code);
}
const codeOf = (label: string): string => {
  const l = label.replace(/\s/g, '');
  if (nameToCode.has(l)) return nameToCode.get(l)!;
  for (const [n, c] of nameToCode) if (n.includes(l) || l.includes(n)) return c;
  return '';
};

console.log('■ 공급사 정책탭 ↔ ERP 정책\n');
type Diff = { code: string; name: string; policy: string; field: string; label: string; sheet: string; erp: string };
const diffs: Diff[] = [];
let blanks = 0; let same = 0; let missingInErp = 0;

for (const f of ((found.files || []) as Rec[])) {
  const label = S(f.name).replace('프리패스 재고 · ', '');
  const code = codeOf(label);
  if (!code || (ONLY && code !== ONLY)) continue;

  const vals = await api(`https://sheets.googleapis.com/v4/spreadsheets/${S(f.id)}/values/${encodeURIComponent(`${POLICY_TAB_NAME}!A1:Z60`)}`);
  const rows = ((vals.values || []) as string[][]);
  if (!rows.length) { console.log(`  △ ${label.padEnd(12)} 정책탭이 비어 있다`); continue; }

  // 0행이 정책코드 줄. 1열부터 정책 하나씩.
  const codes = (rows[0] || []).slice(1).map(S);
  const rowByName = new Map<string, string[]>();
  for (const r of rows.slice(1)) rowByName.set(S(r[0]), r.slice(1).map(S));

  let n = 0; let b = 0; let d = 0;
  codes.forEach((pc, col) => {
    if (!pc) return;
    // 「(프리패스 기본)」 은 우리가 보여 주는 기준 열이다 — ERP 정책이 아니므로 대조하지 않는다.
    if (pc === '(프리패스 기본)') return;
    const erp = Object.values<Rec>(policies).find((x) => !dead(x) && (S(x.policy_code) === pc || S(x._key) === pc));
    if (!erp) { missingInErp++; console.log(`  ★ ${label.padEnd(12)} 정책 「${pc}」 가 ERP 에 없다`); return; }
    for (const { name: rowName, field } of POLICY_COLUMN_FIELDS) {
      const sheetV = S((rowByName.get(rowName) || [])[col]);
      const erpV = S(erp[field]);
      n++;
      if (!sheetV) { b++; blanks++; continue; }
      if (fold(sheetV) === fold(erpV)) { same++; continue; }
      d++;
      diffs.push({ code, name: label, policy: pc, field, label: rowName, sheet: sheetV, erp: erpV });
    }
  });
  console.log(`  ${label.padEnd(12)}정책 ${codes.filter(Boolean).length}개 · 칸 ${n} — 같음 ${n - b - d} · 다름 ${d} · 시트 빈칸 ${b}`);
}

console.log(`\n  ─────────────────────────────────────────`);
console.log(`  같음 ${same} · 다름 ${diffs.length} · 시트에 아직 안 적음 ${blanks}${missingInErp ? ` · ERP 에 없는 정책 ${missingInErp}` : ''}`);

if (diffs.length) {
  console.log('\n  다른 칸 — 시트 값을 쓰려면 정책관리에서 그대로 고친다');
  for (const x of diffs.slice(0, 30)) {
    console.log(`   ${x.name.slice(0, 10).padEnd(12)}${x.policy.padEnd(12)}${x.label.padEnd(18)}시트「${x.sheet.slice(0, 18)}」  ERP「${x.erp.slice(0, 18) || '(빈칸)'}」`);
  }
  if (diffs.length > 30) console.log(`   … 외 ${diffs.length - 30}건`);
}

mkdirSync('tmp', { recursive: true });
const esc = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
writeFileSync('tmp/policy-sheet-vs-erp.csv', `﻿${[
  ['공급사', '코드', '정책코드', '항목', 'ERP 필드', '시트 값', 'ERP 값'].join(','),
  ...diffs.map((x) => [x.name, x.code, x.policy, x.label, x.field, x.sheet, x.erp].map(esc).join(',')),
].join('\r\n')}`, 'utf8');
console.log(`\n  CSV: tmp/policy-sheet-vs-erp.csv (${diffs.length}행)\n`);
