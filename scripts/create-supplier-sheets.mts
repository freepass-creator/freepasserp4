/**
 * 공급사 제공시트를 **새로 만들어** 표준양식을 찍고, 정리표를 낸다. 기본 dry-run, 반영은 `--apply`.
 *
 * ★왜 새로 만드나(2026-08-10)
 *   기존 13곳은 개인 지메일(`tbag4783`) 소유에 **링크만 알면 누구나 편집**이었다.
 *   그 계정이 막히면 13곳 유입이 한 번에 멈추고, 공급사 A 가 B 의 재고를 고칠 수 있다.
 *   새로 만들면 소유·공유·양식을 한 번에 바로잡는다.
 *
 * ★제외 4곳 — 공급사가 원래 쓰던 자기 시트다. 우리가 갈아엎을 자리가 아니다.
 *   오토플러스(RP023) · 아이카(RP004) · 아이언(RP006) · 이안카(RP031)
 *
 * ⚠ 서비스계정이 만들면 **소유자가 서비스계정**이 된다. 그래서 만든 즉시
 *   `OWNER` 를 편집자로 넣고 **소유권 이전을 요청**한다. 개인 계정 간 이전은
 *   사람이 「소유자로 지정」을 눌러야 끝난다 — 그 목록도 정리표에 낸다.
 *
 *   npx tsx scripts/create-supplier-sheets.mts
 *   npx tsx scripts/create-supplier-sheets.mts --apply
 *   npx tsx scripts/create-supplier-sheets.mts --apply --only=RP020,RP021
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { HANDLED_MAKER_OPTIONS } from '../lib/domain/handled-makers';
import {
  TEMPLATE_COLUMNS, buildNumberFormats, buildTableRequest,
  buildTemplateFormat, buildTemplateValues, yearOptions,
} from '../lib/domain/supplier-template-sheet';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const arg = (k: string) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').split('=')[1] || '';
const APPLY = process.argv.includes('--apply');
const OWNER = arg('owner') || 'pyh@teamjpk.com';
const ONLY = arg('only').split(',').map(S).filter(Boolean);
const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';

/** 공급사가 자기 시트를 쓰는 곳 — 새로 만들지 않는다. */
const KEEP_OWN = new Set(['RP023', 'RP004', 'RP006', 'RP031']);

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({
  email: sa.client_email, key: sa.private_key,
  scopes: [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive',
    'https://www.googleapis.com/auth/firebase.database',
    'https://www.googleapis.com/auth/userinfo.email',
  ],
});
const token = (await jwt.getAccessToken()).token;
const head = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

const [prods, t3, t4] = await Promise.all(['v4/products', 'partners', 'v4/partners'].map(async (n) =>
  JSON.parse(await (await fetch(`${DB}/${n}.json?access_token=${token}`)).text()) || {}));
const dead = (v: Rec) => v?._deleted === true || !!v?.deletedAt || S(v?.status) === 'deleted';

const partners: Record<string, Rec> = {};
for (const src of [t3, t4] as Rec[]) {
  for (const [k, v] of Object.entries(src)) if (v && typeof v === 'object') partners[k] = { ...(partners[k] || {}), ...v, _key: k };
}
/** 같은 코드가 v3·v4 두 벌인 곳이 있다 — 시트 주소가 있는 쪽을 남긴다. */
const folded = new Map<string, Rec>();
for (const p of Object.values(partners)) {
  if (dead(p)) continue;
  const code = S(p.partner_code) || S(p._key);
  const prev = folded.get(code);
  if (!prev || (!S(prev.sheet_url) && S(p.sheet_url))) folded.set(code, p);
}
const count = new Map<string, number>();
for (const v of Object.values(prods as Record<string, Rec>)) {
  if (!v || typeof v !== 'object' || dead(v)) continue;
  const c = S(v.provider_company_code);
  if (c) count.set(c, (count.get(c) || 0) + 1);
}

type Target = { code: string; name: string; oldUrl: string; n: number };
const targets: Target[] = [...folded.values()]
  .map((p) => ({
    code: S(p.partner_code) || S(p._key),
    name: S(p.partner_name || p.name || p.company_name),
    oldUrl: S(p.sheet_url),
    n: count.get(S(p.partner_code) || S(p._key)) || 0,
  }))
  .filter((t) => t.oldUrl && !KEEP_OWN.has(t.code))
  .filter((t) => !ONLY.length || ONLY.includes(t.code))
  .sort((a, b) => b.n - a.n);

console.log(`■ 공급사 제공시트 새로 만들기 — ${targets.length}곳 ${APPLY ? '(반영)' : '(dry-run)'}\n`);
console.log(`  소유권 이전 대상: ${OWNER}`);
console.log(`  제외(공급사 자기 시트): 오토플러스 · 아이카 · 아이언 · 이안카\n`);
for (const t of targets) console.log(`   ${t.code.padEnd(9)} ${t.name.slice(0, 18).padEnd(20)} 재고 ${String(t.n).padStart(4)}대`);

if (!APPLY) { console.log('\n※ dry-run. 실제 생성은 --apply\n'); process.exit(0); }

const makers = [...HANDLED_MAKER_OPTIONS];
const dropdownExtras = { 제조사: makers, 연식: yearOptions(new Date().getFullYear()) };
const values = buildTemplateValues();
const call = async (url: string, init?: RequestInit) => {
  const res = await fetch(url, { ...init, headers: head });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
};

type Made = Target & { newId: string; newUrl: string; note: string };
const made: Made[] = [];
for (const t of targets) {
  const title = `프리패스 재고 · ${t.name}`;
  try {
    const doc = await call('https://sheets.googleapis.com/v4/spreadsheets', {
      method: 'POST',
      body: JSON.stringify({ properties: { title }, sheets: [{ properties: { title: '재고', sheetId: 0 } }] }),
    }) as { spreadsheetId: string };
    const id = doc.spreadsheetId;
    const api = `https://sheets.googleapis.com/v4/spreadsheets/${id}`;

    await call(`${api}/values/${encodeURIComponent('재고')}!A1?valueInputOption=USER_ENTERED`, {
      method: 'PUT', body: JSON.stringify({ values }),
    });
    await call(`${api}:batchUpdate`, {
      method: 'POST',
      body: JSON.stringify({
        requests: [
          ...buildTemplateFormat(0, TEMPLATE_COLUMNS, dropdownExtras, { asTable: true }),
          ...buildNumberFormats(0, TEMPLATE_COLUMNS),
          buildTableRequest(0, TEMPLATE_COLUMNS),
        ].filter(Boolean),
      }),
    });
    // ★소유자를 사장님으로 — 서비스계정이 만든 문서라 그대로 두면 회사 자산이 아니다.
    await call(`https://www.googleapis.com/drive/v3/files/${id}/permissions?transferOwnership=true&sendNotificationEmail=true`, {
      method: 'POST', body: JSON.stringify({ role: 'owner', type: 'user', emailAddress: OWNER }),
    }).catch(async () => {
      // 개인 계정 간 이전은 상대가 수락해야 한다 — 우선 편집자로 넣고 사람이 마무리한다.
      await call(`https://www.googleapis.com/drive/v3/files/${id}/permissions?sendNotificationEmail=true`, {
        method: 'POST', body: JSON.stringify({ role: 'writer', type: 'user', emailAddress: OWNER }),
      });
      throw new Error('소유권 이전 보류 — 편집자로 초대함(수동 「소유자로 지정」 필요)');
    });
    made.push({ ...t, newId: id, newUrl: `https://docs.google.com/spreadsheets/d/${id}/edit`, note: '소유권 이전 완료' });
    console.log(`  ✓ ${t.name} — ${id}`);
  } catch (e) {
    const msg = String((e as Error)?.message || e);
    const last = made[made.length - 1];
    if (last && last.code === t.code) last.note = msg;
    else made.push({ ...t, newId: '', newUrl: '', note: msg });
    console.log(`  △ ${t.name} — ${msg.slice(0, 90)}`);
  }
}

const out = 'tmp/supplier-sheets-new.csv';
mkdirSync('tmp', { recursive: true });
const esc = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
writeFileSync(out, `﻿${[
  ['공급사', '코드', '재고', '새 시트', '옛 시트', '상태', '할 일'].join(','),
  ...made.map((m) => [
    m.name, m.code, String(m.n), m.newUrl, m.oldUrl, m.note,
    '① 소유자 지정 ② 서비스계정 편집자 추가 ③ 공급사 계정만 초대 ④ 링크공개 끄기',
  ].map(esc).join(',')),
].join('\r\n')}`, 'utf8');
console.log(`\n정리표: ${out} (${made.length}행)`);
console.log('⚠ RTDB sheet_url 은 아직 바꾸지 않았다 — 공급사가 새 시트를 채운 뒤에 바꾼다.');
