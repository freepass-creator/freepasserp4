/**
 * **판매시트에서 오플 탭(오플구독·오플프로모션·옛 이름)을 지운다.** 기본 dry-run, 반영은 `--apply`.
 * ★사장님 2026-08-18 — 「오플 구독 탭 없애고 상품리스트에 흡수, 손오공 구독만 별도 탭」. 손오공구독 탭은 건드리지 않는다.
 *   npx tsx scripts/remove-partner-tabs.mts --apply
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const APPLY = process.argv.includes('--apply');
const SHEET = '1Y1Mx1EcEpAuNer0y50Dq4eK92CpVjThO_suZLmo2vVs';
const GONE = ['오플구독', '오플프로모션', '오토플러스', '오플 프로모션'];
const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, scopes: ['https://www.googleapis.com/auth/spreadsheets'], subject: 'pyh@teamjpk.com' });
const call = async (u: string, init?: RequestInit): Promise<Rec> => { const tok = (await jwt.getAccessToken()).token; const r = await fetch(u, { ...init, headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' } }); const t = await r.text(); if (!r.ok) throw new Error(`${r.status} ${t.slice(0, 300)}`); return t ? JSON.parse(t) : {}; };
const meta = await call(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET}?fields=sheets.properties(sheetId,title)`);
const targets = ((meta.sheets || []) as Rec[]).map((s) => s.properties).filter((p) => GONE.some((g) => S(p.title) === g || S(p.title).startsWith(g + ' ')));
console.log(`■ 판매시트 오플 탭 ${APPLY ? '삭제' : '미리보기'} — ${targets.map((p: Rec) => `「${p.title}」`).join(' · ') || '없음'} (전체 탭: ${(meta.sheets || []).map((s: Rec) => s.properties.title).join(' · ')})`);
if (!APPLY || !targets.length) process.exit(0);
await call(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: targets.map((p: Rec) => ({ deleteSheet: { sheetId: p.sheetId } })) }) });
console.log(`  ✓ 지움 ${targets.length}개`);
