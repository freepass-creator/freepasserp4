/**
 * **정책에 불변 UID(`pol_…`)를 발급하고 지금 코드는 「구코드」로 보존한다.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★사장님 2026-08-21 「uid만 안 바뀌면 되잖아 · 눈으로 보는 코드는 바꿀 수도 있는 거지」.
 *   규격 정본은 이미 있다 — `lib/domain/ids.ts`: 접두사 + 뜻 없는 랜덤 토큰(`pol_k7m2p9x4qz`).
 *   뜻이 없으니 재발급할 이유가 없고, 그래서 계약서·견적의 참조가 안 깨진다(v3 함정 제거).
 *
 * ★**코드에 공급사를 넣지 않는다.** 정책은 늘 그 공급사 시트 안에 있고 ERP 에도 partner_code 가 함께 실린다 —
 *   코드가 혼자 돌아다니는 경우가 없다. 오히려 넣으면 공급사코드가 바뀔 때 거짓말이 된다
 *   (실측 2026-08-21: 스타 정책코드가 `RP003_P05` 인데 스타의 공급사코드는 이미 `RP018` 이다).
 * ★사람은 「공급사 · 정책명」을 나란히 본다. 코드는 이름표일 뿐이다.
 *
 * ★**ERP 표준은 3층**이다(사장님 2026-08-21 「표준방식으로 하는 게 맞는 거 같은데」).
 *     대체키(surrogate)  pol_k7m2p9x4qz   절대 안 바뀜. 기계만 쓴다
 *     업무코드(business) POL-0035          사람이 읽고 말한다. **바뀌어도 된다**
 *     표시명(name)       빌린카 구독 표준     자주 바뀐다
 *   그래서 지금 코드(POL-…·RP021_S01)를 버리지 않는다 — 그건 정상적인 «업무코드» 층이다.
 *   빠져 있던 것은 대체키뿐이라, **「정책UID」 열 하나만 더한다.**
 *
 * 하는 일 — 정책 탭마다
 *   ① 「정책UID」 열이 없으면 「정책코드」 왼쪽에 만든다
 *   ② 빈 줄에 `pol_…` 를 발급한다. **이미 있으면 다시 뽑지 않는다**(대체키는 한 번 주면 끝이다)
 *   ③ 「(프리패스 기본)」은 21곳이 같이 쓰는 우리 표준값이라 **한 UID 를 공유**한다
 * ⚠ 정책코드·재고 탭·ERP 는 안 건드린다 — 지금 돌아가는 것을 멈추지 않는다(무중단).
 *
 *   npx tsx scripts/issue-policy-uid.mts
 *   npx tsx scripts/issue-policy-uid.mts --apply
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { SHEET_NAME_MATCH, supplierSheetLabel, POLICY_TAB_ALIASES } from '../lib/domain/supplier-template-sheet';
import { newId } from '../lib/domain/ids';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const norm = (v: unknown) => S(v).replace(/\s+/g, '');
const APPLY = process.argv.includes('--apply');
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
/** 프리패스 표준값은 21곳이 같이 쓴다 — 한 UID 를 공유한다(집집마다 다른 코드면 «표준»이 아니다). */
const STD_UID = 'pol_freepassstd';
const STD_NAMES = ['(프리패스 기본)', '프리패스 기본', '프리패스 표준'];

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, subject: 'pyh@teamjpk.com', scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'] });
const call = async (u: string, init?: RequestInit): Promise<Rec> => {
  for (let n = 0; ; n++) {
    const t = (await jwt.getAccessToken()).token;
    const r = await fetch(u, { ...init, headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' } });
    const x = await r.text();
    if (r.ok) return x ? JSON.parse(x) : {};
    if ((r.status === 429 || r.status >= 500) && n < 6) { await sleep(20_000 * (n + 1)); continue; }
    throw new Error(`${r.status} ${x.slice(0, 120)}`);
  }
};
const colA1 = (i: number) => { let t = '', n = i + 1; while (n > 0) { const r = (n - 1) % 26; t = String.fromCharCode(65 + r) + t; n = Math.floor((n - 1) / 26); } return t; };

type Row = { 공급사: string; 탭: string; 줄: number; 정책명: string; 구코드: string; UID: string; 상태: string };   // 구코드 = 지금 쓰는 업무코드(그대로 둔다)
const plan: Row[] = [];

const q = `name contains '${SHEET_NAME_MATCH}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`;
const books = (((await call(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=100&includeItemsFromAllDrives=true&supportsAllDrives=true`)).files || []) as Rec[])
  .map((f) => ({ id: S(f.id), label: supplierSheetLabel(S(f.name)) })).sort((a, b) => a.label.localeCompare(b.label));

for (const b of books) {
  const meta = await call(`https://sheets.googleapis.com/v4/spreadsheets/${b.id}?fields=sheets.properties(sheetId,title,hidden)`);
  for (const p of ((meta.sheets || []) as Rec[]).map((s) => s.properties as Rec)) {
    const tab = S(p.title); if (!POLICY_TAB_ALIASES.some((a: string) => tab.includes(a)) && !/정책/.test(tab)) continue;
    const gid = Number(p.sheetId);
    let rows: string[][]; try { rows = (((await call(`https://sheets.googleapis.com/v4/spreadsheets/${b.id}/values/${encodeURIComponent(`${tab}!A1:CZ60`)}`)).values || []) as string[][]); } catch { continue; }
    if (!rows.length) continue;
    let hdr = rows[0].map(S);
    const codeAt = hdr.findIndex((h) => norm(h) === '정책코드');
    if (codeAt < 0) continue;
    const hasUid = hdr.some((h) => norm(h) === '정책uid' || norm(h) === '정책UID'.toLowerCase() || S(h) === '정책UID');
    // ① 「구코드」 열 만들기
    if (!hasUid && APPLY) {
      await call(`https://sheets.googleapis.com/v4/spreadsheets/${b.id}:batchUpdate`, {
        method: 'POST',
        body: JSON.stringify({ requests: [{ insertDimension: { range: { sheetId: gid, dimension: 'COLUMNS', startIndex: codeAt, endIndex: codeAt + 1 }, inheritFromBefore: false } }] }),
      });
      await call(`https://sheets.googleapis.com/v4/spreadsheets/${b.id}/values/${encodeURIComponent(`${tab}!${colA1(codeAt)}1`)}?valueInputOption=RAW`, { method: 'PUT', body: JSON.stringify({ values: [['정책UID']] }) });
      rows = (((await call(`https://sheets.googleapis.com/v4/spreadsheets/${b.id}/values/${encodeURIComponent(`${tab}!A1:CZ60`)}`)).values || []) as string[][]);
      hdr = rows[0].map(S);
    }
    const uidAt = hdr.findIndex((h) => S(h) === '정책UID');
    const nowCodeAt = hdr.findIndex((h) => norm(h) === '정책코드');
    const nameAt = hdr.findIndex((h) => norm(h) === '정책명');
    const data: { range: string; values: string[][] }[] = [];
    for (let i = 1; i < rows.length; i++) {
      const code = S(rows[i][nowCodeAt]); if (!code) continue;
      const name = nameAt >= 0 ? S(rows[i][nameAt]) : '';
      const has = uidAt >= 0 ? S(rows[i][uidAt]) : '';
      if (has) { plan.push({ 공급사: b.label, 탭: tab, 줄: i + 1, 정책명: name, 구코드: code, UID: has, 상태: '이미 있음' }); continue; }
      const uid = STD_NAMES.some((x) => norm(x) === norm(code)) ? STD_UID : newId('policy');
      plan.push({ 공급사: b.label, 탭: tab, 줄: i + 1, 정책명: name, 구코드: code, UID: uid, 상태: uid === STD_UID ? '표준(공유)' : '새 UID' });
      if (uidAt >= 0) data.push({ range: `'${tab.replace(/'/g, "''")}'!${colA1(uidAt)}${i + 1}`, values: [[uid]] });
    }
    if (APPLY && data.length) await call(`https://sheets.googleapis.com/v4/spreadsheets/${b.id}/values:batchUpdate`, { method: 'POST', body: JSON.stringify({ valueInputOption: 'RAW', data }) });
  }
}
writeFileSync('tmp/policy-uid-plan.json', JSON.stringify(plan, null, 2));
const nu = plan.filter((x) => x.상태 === '새 UID');
console.log(`■ 정책 ${plan.length}줄 — 새 UID ${nu.length} · 표준(공유) ${plan.filter((x) => x.상태 === '표준(공유)').length} · 이미 UID ${plan.filter((x) => x.상태 === '이미 있음').length}\n`);
for (const x of nu) console.log(`   ${x.공급사.slice(0, 10).padEnd(12)} ${x.탭.slice(0, 10).padEnd(12)} ${x.구코드.padEnd(14)} + ${x.UID}   「${x.정책명.slice(0, 22)}」`);
console.log(`\n  치환표 tmp/policy-uid-plan.json ${APPLY ? '(반영됨)' : '(dry-run — 반영은 --apply)'}\n`);
