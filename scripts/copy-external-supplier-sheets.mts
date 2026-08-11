/**
 * **공급사 자기 시트를 우리 드라이브에 복사해 둔다.** 기본 dry-run, 실제 복사는 `--apply`.
 *
 * 아이카·이안카·오토플러스는 자기 양식으로 재고를 준다. 그 시트는 **그쪽 소유**라
 * 언제든 지워지거나 바뀔 수 있고, 실제로 아이카는 하루 만에 파일을 갈아탔다(2026-08-10).
 * 그때 그때의 사본을 우리 드라이브에 남겨야 «그날 무엇을 받았는가»를 나중에 댈 수 있다.
 *
 * ★사본은 **읽기 전용 참고**다. 여기 손대도 ERP 는 안 본다 — 정본은 공급사 원본이다.
 *   이름에 날짜를 박아 두는 것도 그래서다. 사본을 정본으로 쓰면 재고가 조용히 멈춘다.
 *
 * ★우리가 만들어 준 시트(「프리패스 재고 · …」)는 대상이 아니다. 그건 이미 우리 것이다.
 *
 *   npx tsx scripts/copy-external-supplier-sheets.mts
 *   npx tsx scripts/copy-external-supplier-sheets.mts --apply
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { NOT_SHEET_BACKED } from '../lib/domain/supplier-sheet-read';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const APPLY = process.argv.includes('--apply');
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').slice('--only='.length).split(',').map(S).filter(Boolean);
const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const dbT = (await new JWT({ email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/firebase.database', 'https://www.googleapis.com/auth/userinfo.email'] }).getAccessToken()).token;
const gT = (await new JWT({ email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/drive'], subject: 'pyh@teamjpk.com' }).getAccessToken()).token;
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

/** 우리가 이미 소유한 시트 — 그건 «공급사 자기 시트»가 아니다. */
const ourIds = new Set<string>();
const q = encodeURIComponent("mimeType='application/vnd.google-apps.spreadsheet' and 'me' in owners and trashed=false");
const mine = await api(`https://www.googleapis.com/drive/v3/files?q=${q}&pageSize=200&fields=files(id,name)`);
for (const f of ((mine.files || []) as Rec[])) ourIds.add(S(f.id));

const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);

type Job = { code: string; name: string; id: string; title: string; skip: string };
const jobs: Job[] = [];
const seen = new Set<string>();
for (const p of Object.values<Rec>(partners)) {
  if (dead(p)) continue;
  const code = S(p.partner_code) || S(p._key);
  const id = (S(p.sheet_url).match(/\/spreadsheets\/d\/([\w-]+)/) || [])[1];
  if (!code || !id || seen.has(id)) continue;
  seen.add(id);
  const name = S(p.partner_name || p.name || p.company_name) || code;
  const job: Job = { code, name, id, title: '', skip: '' };
  if (ONLY.length && !ONLY.includes(code)) job.skip = '--only 대상 아님';
  else if (NOT_SHEET_BACKED.has(code)) job.skip = '홈페이지가 정본 — 시트 없음';
  else if (ourIds.has(id)) job.skip = '우리 시트 — 복사할 필요 없음';
  jobs.push(job);
}

console.log(`■ 공급사 자기 시트 사본 뜨기 ${APPLY ? '(반영)' : '(dry-run)'}\n`);
for (const j of jobs) {
  if (j.skip) { console.log(`  · ${j.name.slice(0, 16).padEnd(18)}${j.code.padEnd(10)}${j.skip}`); continue; }
  try {
    const meta = await api(`https://www.googleapis.com/drive/v3/files/${j.id}?fields=name,modifiedTime,owners(emailAddress)&supportsAllDrives=true`);
    j.title = `${j.name.replace(/\(주\)|주식회사|㈜/g, '').trim()}(${j.code}) 원본 ${today}`;
    console.log(`  ★ ${j.name.slice(0, 16).padEnd(18)}${j.code.padEnd(10)}「${S(meta.name).slice(0, 30)}」 수정 ${S(meta.modifiedTime).slice(0, 10)} · 소유 ${S((meta.owners || [])[0]?.emailAddress).slice(0, 24)}`);
    console.log(`       → 사본 이름 「${j.title}」`);
  } catch (e) {
    j.skip = `원본을 못 읽음 — ${String((e as Error).message).slice(0, 50)}`;
    console.log(`  △ ${j.name.slice(0, 16).padEnd(18)}${j.code.padEnd(10)}${j.skip}`);
  }
}

const todo = jobs.filter((j) => !j.skip);
console.log(`\n  복사할 시트 ${todo.length}개`);
if (!APPLY) { console.log('\n※ dry-run. 실제 복사는 --apply\n'); process.exit(0); }

let done = 0;
for (const j of todo) {
  try {
    const copy = await api(`https://www.googleapis.com/drive/v3/files/${j.id}/copy?supportsAllDrives=true&fields=id,name`, {
      method: 'POST', body: JSON.stringify({ name: j.title }),
    });
    done++;
    console.log(`  ✓ ${j.title}  https://docs.google.com/spreadsheets/d/${S(copy.id)}/edit`);
  } catch (e) {
    console.log(`  △ ${j.name} 복사 실패 — ${String((e as Error).message).slice(0, 70)}`);
  }
}
console.log(`\n  사본 ${done}개\n`);
