/**
 * 차량번호별 세부트림 검수표.
 *
 * 지금 저장값과 **현재 코드로 다시 매칭한 값**을 나란히 놓고, 무엇이 근거였는지까지 적는다.
 * 사람이 눈으로 훑어 «이건 아닌데» 를 잡으라고 만든 것이다 — 쓰기 없음.
 *
 *   npx tsx scripts/audit-trim-by-plate.mts              (요약 + 검수 필요분)
 *   npx tsx scripts/audit-trim-by-plate.mts --all        (전체)
 *   OUT=tmp/trim-audit.csv npx tsx scripts/audit-trim-by-plate.mts   (엑셀용 CSV)
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { snapToMaster, type MasterEntry } from '../lib/domain/vehicle-master-match';
import { realMasterTrims } from '../lib/domain/vehicle-master-options';
import { resolveTrim } from '../lib/domain/vehicle-trim-resolve';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({
  email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/firebase.database', 'https://www.googleapis.com/auth/userinfo.email'],
});
const token = (await jwt.getAccessToken()).token;
const [prods, p4, p3] = await Promise.all(['v4/products', 'v4/partners', 'partners'].map(async (n) =>
  JSON.parse(await (await fetch(`${DB}/${n}.json?access_token=${token}`)).text()) || {}));
const masterRaw = JSON.parse(readFileSync('public/data/vehicle-master.json', 'utf8'));
const entries: MasterEntry[] = (Array.isArray(masterRaw) ? masterRaw : masterRaw.entries) || [];

const merged: Record<string, Rec> = {};
for (const src of [p3, p4] as Rec[]) {
  for (const [k, v] of Object.entries(src)) if (v && typeof v === 'object') merged[k] = { ...(merged[k] || {}), ...(v as Rec), _key: k };
}
const nameOf = (c: string) => {
  const hit = Object.values(merged).find((x) => S(x.partner_code) === c || S(x._key) === c);
  return S(hit?.partner_name || hit?.name) || c || '(공급사없음)';
};
const dead = (p: Rec) => p?._deleted === true || !!p?.deletedAt || S(p?.status) === 'deleted';

const trimsOf = (sub: string): string[] => {
  const out = new Set<string>();
  for (const e of entries as unknown as Rec[]) {
    if (S(e.sub_model) !== sub) continue;
    for (const t of realMasterTrims((e.trims || []) as never)) out.add(S(t));
    for (const v of (e.variants || []) as Rec[]) for (const t of realMasterTrims((v.trims || []) as never)) out.add(S(t));
  }
  return [...out].filter(Boolean);
};

/** 판정 — 사람이 무엇을 봐야 하는지. */
type Verdict = '유지' | '새로채움' | '바뀜' | '사라짐' | '못채움';
type Row = {
  plate: string; prov: string; sub: string; variant: string;
  raw: string; now: string; next: string; how: string; verdict: Verdict; note: string;
};

const rows: Row[] = [];
for (const p of Object.values(prods) as Rec[]) {
  if (!p || typeof p !== 'object' || dead(p)) continue;
  const raw = p._raw_vehicle as Rec | undefined;
  const r = raw ? snapToMaster({ ...(p as never) }, entries) as unknown as Rec | null : null;
  const now = S(p.trim_name);
  const next = S(r?.trim_name);
  const sub = S(r?.sub_model) || S(p.sub_model);
  const rawText = [raw?.trim_name, raw?.model, raw?.sub_model, p.trim_extra].map(S).filter(Boolean).join(' ');
  const cands = sub ? trimsOf(sub) : [];
  const hit = rawText && cands.length ? resolveTrim(rawText, cands) : null;

  let verdict: Verdict;
  let note = '';
  if (!now && next) verdict = '새로채움';
  else if (now && !next && raw) { verdict = '사라짐'; note = '재매칭이 기존 값을 지운다 — 반영 전 확인'; }
  else if (now && next && now !== next) { verdict = '바뀜'; note = `${now} → ${next}`; }
  else if (now) verdict = '유지';
  else {
    verdict = '못채움';
    if (!raw) note = '원문 없음 — 시트 재동기화 필요';
    else if (!sub) note = '세부모델도 못 잡음';
    else if (!cands.length) note = '마스터에 그 세대 트림 목록 없음(제네시스 등 정상)';
    else note = `원문에 트림 글자 없음 · 마스터 후보: ${cands.slice(0, 4).join(', ')}`;
  }

  rows.push({
    plate: S(p.car_number) || '(무번호)', prov: nameOf(S(p.provider_company_code)),
    sub, variant: S(r?.variant) || S(p.variant),
    raw: rawText, now, next: next || now, how: hit?.how || '', verdict, note,
  });
}

const order: Verdict[] = ['바뀜', '사라짐', '새로채움', '못채움', '유지'];
rows.sort((a, b) => order.indexOf(a.verdict) - order.indexOf(b.verdict) || a.prov.localeCompare(b.prov, 'ko'));

const count = (v: Verdict) => rows.filter((x) => x.verdict === v).length;
console.log(`전체 ${rows.length}대`);
for (const v of order) console.log(`  ${v.padEnd(6)} ${String(count(v)).padStart(4)}대`);

// ★사람이 꼭 봐야 하는 것 = 바뀜·사라짐. 나머지는 훑어만 봐도 된다.
const review = rows.filter((x) => x.verdict === '바뀜' || x.verdict === '사라짐');
console.log(`\n══ 검수 필요 ${review.length}대 (기존 값을 건드리는 것) ══`);
for (const x of review) {
  console.log(`${x.plate.padEnd(11)} ${x.prov.slice(0, 10).padEnd(12)} ${x.sub.slice(0, 16).padEnd(18)} ${x.note}`);
  console.log(`   원문 「${x.raw.slice(0, 70)}」`);
}

const showAll = process.argv.includes('--all');
if (showAll) {
  console.log(`\n══ 새로 채움 ══`);
  for (const x of rows.filter((y) => y.verdict === '새로채움')) {
    console.log(`${x.plate.padEnd(11)} ${x.prov.slice(0, 10).padEnd(12)} ${x.sub.slice(0, 16).padEnd(18)} ${x.variant.slice(0, 14).padEnd(16)} 「${x.next}」 (${x.how})`);
    console.log(`   원문 「${x.raw.slice(0, 70)}」`);
  }
}

const out = S(process.env.OUT);
if (out) {
  mkdirSync(out.replace(/[^/\\]+$/, '') || '.', { recursive: true });
  const esc = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
  const csv = [
    ['차량번호', '공급사', '세부모델', '파워트레인', '원문', '지금트림', '재매칭트림', '근거', '판정', '비고'].join(','),
    ...rows.map((x) => [x.plate, x.prov, x.sub, x.variant, x.raw, x.now, x.next, x.how, x.verdict, x.note].map(esc).join(',')),
  ].join('\r\n');
  writeFileSync(out, '﻿' + csv, 'utf8');
  console.log(`\nCSV 저장: ${out}`);
}
