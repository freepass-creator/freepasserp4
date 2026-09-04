/**
 * 유지 게이트 — 손오공 정제에서 «세대(세부모델)가 다시 비면» 잡는다. 읽기전용.
 *
 * 왜: 정제칸 빈칸은 «원문 부재(어쩔 수 없음)»와 «영/한·연료표기·띄어쓰기로 매칭실패(버그)»가 섞인다.
 *   버그로 비는 건 «모델은 마스터에 있는데 세대만 못 붙은» 것 = 트림/연식없음 + 세부모델빈.
 *   엔진이 회귀하거나 새 표기가 들어오면 이 수가 튄다 → 여기서 멈추면(경고) 조용히 안 샌다.
 *
 * 기준선(2026-09-03 연료버그 수정 후): 세부모델빈 2 · 트림/연식없음 14. 여유를 두고 게이트한다.
 *
 *   GOOGLE_APPLICATION_CREDENTIALS=tmp/firebase-auth/sa.json npx tsx scripts/audit-refine-recoverable.mts
 *   ... --max-sub=6 --max-trim=20   (임계 조정)  |  --json  (파이프라인용)
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
// @ts-ignore — .mjs 공용 엔진
import { 정제 } from '../sonokong/lib/vehicle-refine.mjs';

const S = (v: unknown) => String(v ?? '').trim();
const argN = (k: string, d: number) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? Number(a.slice(k.length + 3)) : d; };
const MAX_SUB = argN('max-sub', 6);
const MAX_TRIM = argN('max-trim', 20);
const JSON_OUT = process.argv.includes('--json');

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, subject: 'pyh@teamjpk.com', scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
const MASTER = '1T_RrErmGoj_yG9S1u7n--2NDolTOw8wA8ROQjPWuAlg';
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
async function call(u: string): Promise<any> {
  for (let n = 1; ; n++) {
    const t = (await jwt.getAccessToken()).token;
    const r = await fetch(u, { headers: { Authorization: `Bearer ${t}` } });
    const x = await r.text();
    if (r.ok) return JSON.parse(x);
    if ((r.status === 429 || r.status >= 500) && n <= 6) { await sleep(8000 * n); continue; }
    throw new Error(`${r.status} ${x.slice(0, 120)}`);
  }
}

const cm = (await call(`https://sheets.googleapis.com/v4/spreadsheets/${MASTER}/values/${encodeURIComponent('차종마스터!A1:AE4000')}`)).values;
const 차량 = JSON.parse(readFileSync('sonokong/lib/wonja/손오공차량.json', 'utf8')).차량;
const { 결과, 미스 } = 정제(차량, cm) as { 결과: any[]; 미스: { 모델없음: string[]; 트림연식없음: string[] } };
const subBlank = 결과.filter((r) => !S(r.세부모델)).map((r) => `${r.차번} ${r.제조사} ${r.모델}`);

const nSub = subBlank.length;
const nTrim = 미스.트림연식없음.length;
const nModel = 미스.모델없음.length;
const ok = nSub <= MAX_SUB && nTrim <= MAX_TRIM;

if (JSON_OUT) {
  console.log(JSON.stringify({ ok, 세부모델빈: nSub, 트림연식없음: nTrim, 모델없음: nModel, 임계: { sub: MAX_SUB, trim: MAX_TRIM } }));
} else {
  console.log(`손오공 ${차량.length}대 · 세부모델빈 ${nSub}(≤${MAX_SUB}) · 트림/연식없음 ${nTrim}(≤${MAX_TRIM}) · 모델없음 ${nModel}`);
  if (subBlank.length) { console.log('\n세부모델빈:'); subBlank.slice(0, 20).forEach((x) => console.log('  ' + x)); }
  console.log(ok ? '\n✓ 유지 게이트 PASS — 세대빈이 기준선 안' : `\n✗ 유지 게이트 FAIL — 세대빈이 기준선 초과(회귀·새 표기 의심). 원문 확인 후 엔진/마스터 보강.`);
}
process.exit(ok ? 0 : 1);
