/**
 * 원본 문장에서 **트림을 규격값으로 뽑아내는가** — 전 차량 기준.
 *
 * 트림은 대부분의 공급사 시트에 «열이 없다». 차명 칸에 문장으로 섞여 온다.
 * 그 문장에서 마스터 트림을 못 뽑으면 두 가지로 샌다 —
 * 통째로 버리거나(트림 없음), 문장이 그대로 트림 이름이 되거나.
 * 둘 다 손님 화면에 그대로 나가므로 여기서 지킨다.
 *
 *   npx tsx scripts/sim-trim-extract.mts
 *   OUT=tmp/trim-x.json npx tsx scripts/sim-trim-extract.mts   (A/B 비교용 결과 저장)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { unpackVehicleSignals } from '../lib/domain/vehicle-master-match';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, scopes: [
  'https://www.googleapis.com/auth/firebase.database', 'https://www.googleapis.com/auth/userinfo.email',
]});
const token = (await jwt.getAccessToken()).token;
const prods = JSON.parse(await (await fetch(`${DB}/v4/products.json?access_token=${token}`)).text()) || {};
const masterRaw = JSON.parse(readFileSync('public/data/vehicle-master.json', 'utf8'));
const entries = (Array.isArray(masterRaw) ? masterRaw : masterRaw.entries) || [];
const dead = (p: Rec) => p?._deleted === true || !!p?.deletedAt || S(p?.status) === 'deleted';

/** 트림으로 볼 수 없는 값 — 문장이거나 제원 표기면 이름이 아니다. */
const looksSentence = (t: string) => t.length > 14 || /\d{3,}|개월|인승|\bcc\b/i.test(t);

let n = 0, got = 0, sentence = 0;
const out: Record<string, string> = {};
const bad: string[] = [];
for (const p of Object.values(prods) as Rec[]) {
  if (!p || typeof p !== 'object' || dead(p) || !p._raw_vehicle) continue;
  n++;
  const u = unpackVehicleSignals({ ...(p._raw_vehicle as Rec) }, entries);
  const trim = S(u.trim_name);
  out[S(p.product_code) || S(p.car_number) || `#${n}`] = trim;
  if (!trim) continue;
  got++;
  if (looksSentence(trim)) {
    sentence++;
    if (bad.length < 10) bad.push(`${S(p.car_number) || '(무번호)'}  「${S((p._raw_vehicle as Rec)?.trim_name) || S((p._raw_vehicle as Rec)?.model)}」 → ${trim}`);
  }
}

console.log(`\n══ 원본에서 트림 뽑기 — 매물 ${n}대 ══\n`);
console.log(`  트림 확보        ${got}/${n} (${(got / n * 100).toFixed(0)}%)`);
console.log(`  문장이 트림이 된 것 ${sentence}${sentence ? '   ← 이름이 아니다' : ''}`);
if (bad.length) { console.log('\n  예'); for (const b of bad) console.log('    ' + b); }
if (process.env.OUT) writeFileSync(process.env.OUT, JSON.stringify(out, null, 2));
process.exit(sentence > n * 0.05 ? 1 : 0);
