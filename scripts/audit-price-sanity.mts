/**
 * 시트에 나가는 409대 **대여료 최종 검수**. 읽기 전용.
 *
 * 오늘부터 영업자가 이 표를 보고 손님에게 금액을 말한다.
 * 틀린 금액 하나가 계약으로 이어지면 그 차이는 우리가 문다.
 *
 * 묻는 것
 *   ① 값이 아예 없나 · 한 기간뿐인가
 *   ② 기간이 길수록 싸야 하는데 뒤집혔나 (36개월이 12개월보다 비싸면 오입력)
 *   ③ 보증금이 대여료에 비해 말이 되나 (배수 이상치)
 *   ④ 자릿수 오타로 보이는 값 (만원 단위 혼입 · 억대)
 *   ⑤ 같은 차종·같은 기간인데 값이 통째로 동떨어졌나
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { isListableProduct, priceList, priceVariants } from '../lib/domain/product';
import { dedupeForSales } from '../lib/domain/inventory-sheet-export';
import type { EntityRecord } from '../lib/intake/entities';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';
const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({
  email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/firebase.database', 'https://www.googleapis.com/auth/userinfo.email'],
});
const token = (await jwt.getAccessToken()).token;
const prods = JSON.parse(await (await fetch(`${DB}/v4/products.json?access_token=${token}`)).text()) || {};
const dead = (p: Rec) => p?._deleted === true || !!p?.deletedAt || S(p?.status) === 'deleted';

const all = Object.entries(prods as Record<string, Rec>)
  .filter(([, p]) => p && typeof p === 'object' && !dead(p))
  .map(([k, p]) => ({ ...p, _key: k, product_code: p.product_code || k } as EntityRecord));
const sheet = dedupeForSales(all.filter(isListableProduct));

type Flag = { level: '★' | '△'; kind: string; plate: string; car: string; detail: string };
const flags: Flag[] = [];
const add = (level: Flag['level'], kind: string, p: EntityRecord, detail: string) => {
  flags.push({
    level, kind,
    plate: S((p as Rec).car_number) || '(무번호)',
    car: `${S((p as Rec).maker)} ${S((p as Rec).sub_model) || S((p as Rec).model)}`.trim(),
    detail,
  });
};

const won = (n: number) => n.toLocaleString('ko-KR');
/** 차종별 기간별 값 — 같은 차가 얼마에 나가는지 견줄 기준. */
const bench = new Map<string, number[]>();
for (const p of sheet) {
  for (const e of priceList(p)) {
    const key = `${S((p as Rec).sub_model)}|${e.m}`;
    if (!bench.has(key)) bench.set(key, []);
    bench.get(key)!.push(e.rent);
  }
}
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

for (const p of sheet) {
  const list = priceList(p);
  // ① 값 자체
  if (!list.length) { add('★', '대여료 없음', p, '목록에 섰는데 가격이 하나도 없다'); continue; }
  if (list.length === 1) add('△', '기간 하나뿐', p, `${list[0].m}개월 ${won(list[0].rent)}원만 있다`);

  // ② 기간 역전 — 길수록 싸야 한다
  for (let i = 0; i < list.length - 1; i++) {
    const a = list[i]; const b = list[i + 1];
    if (b.rent > a.rent * 1.02) {
      add('★', '기간 역전', p, `${a.m}개월 ${won(a.rent)} < ${b.m}개월 ${won(b.rent)} — 긴 기간이 더 비싸다`);
    }
  }

  // ③ 보증금 — 대여료 대비 배수
  for (const e of list) {
    if (!e.deposit) continue;
    const x = e.deposit / e.rent;
    if (x > 12) add('★', '보증금 과다', p, `${e.m}개월 대여 ${won(e.rent)} · 보증 ${won(e.deposit)} (${x.toFixed(1)}배)`);
    else if (x < 0.5) add('△', '보증금 과소', p, `${e.m}개월 대여 ${won(e.rent)} · 보증 ${won(e.deposit)} (${x.toFixed(1)}배)`);
  }

  // ④ 자릿수 — 파서가 이미 10만~2천만으로 거르지만 경계값을 다시 본다
  for (const e of list) {
    if (e.rent < 150_000) add('△', '대여료 낮음', p, `${e.m}개월 ${won(e.rent)}원 — 자릿수 확인`);
    if (e.rent > 5_000_000) add('△', '대여료 높음', p, `${e.m}개월 ${won(e.rent)}원 — 자릿수 확인`);
  }

  // ⑤ 같은 차종·기간의 중앙값과 견준다(3대 이상 있을 때만 — 표본이 적으면 판단 못 한다)
  for (const e of list) {
    const peers = bench.get(`${S((p as Rec).sub_model)}|${e.m}`) || [];
    if (peers.length < 3) continue;
    const mid = median(peers);
    if (!mid) continue;
    const r = e.rent / mid;
    if (r >= 2 || r <= 0.5) {
      add('★', '같은 차종과 동떨어짐', p,
        `${e.m}개월 ${won(e.rent)}원 · 같은 세대 ${peers.length}대 중앙값 ${won(mid)}원 (${r.toFixed(2)}배)`);
    }
  }
}

const star = flags.filter((f) => f.level === '★');
const warn = flags.filter((f) => f.level === '△');
console.log('■ 대여료 최종 검수 — 시트에 나가는 409대\n');
console.log(`  검수 ${sheet.length}대 · ★확인 필요 ${star.length}건 · △살펴볼 것 ${warn.length}건\n`);

const byKind = new Map<string, number>();
for (const f of flags) byKind.set(`${f.level} ${f.kind}`, (byKind.get(`${f.level} ${f.kind}`) || 0) + 1);
for (const [k, n] of [...byKind.entries()].sort((a, b) => b[1] - a[1])) console.log(`   ${String(n).padStart(4)}  ${k}`);

for (const f of star.slice(0, 20)) {
  console.log(`\n★ ${f.plate.padEnd(11)} ${f.car.slice(0, 24).padEnd(26)} ${f.kind}`);
  console.log(`     ${f.detail}`);
}

const out = S(process.env.OUT);
if (out) {
  mkdirSync(out.replace(/[^/\\]+$/, '') || '.', { recursive: true });
  const esc = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
  writeFileSync(out, `﻿${[
    ['등급', '항목', '차량번호', '차종', '내용'].join(','),
    ...flags.map((f) => [f.level, f.kind, f.plate, f.car, f.detail].map(esc).join(',')),
  ].join('\r\n')}`, 'utf8');
  console.log(`\nCSV: ${out} (${flags.length}행)`);
}
