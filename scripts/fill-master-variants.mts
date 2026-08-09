/**
 * 차종마스터 **파워트레인 축** 보강 — 배터리 사양·라인을 제자리에 넣는다.
 *
 * 사장님 지시(2026-08-09): 「배터리 사양이나 이런 건 파워트레인에 들어가야지 …
 * 애매한 건 엔카 학습하자 … 이거는 제대로 맞추고 가야 해.」
 *
 * 우리 variant 는 **용량(kWh)·구동**으로만 갈려 있었다. 공급사와 엔카는 **사양명**으로 적는다
 * (「스탠다드」「롱레인지」「RS」「ACTIV」). 그래서 원문의 그 말이 갈 곳이 없었다.
 *
 * ★엔카가 그 아래 트림까지 다르게 둔다 — EV6 스탠다드엔 「어스」가 없고 「에어·라이트」뿐이다.
 *   그래서 축만 늘리는 게 아니라 **트림도 그 축에 맞춰 배분**한다.
 *
 * 넣는 원칙
 *   · 이름을 바꾸는 것(rename)은 «같은 것을 제대로 부르는» 경우만. 트림은 그대로 물려받는다.
 *   · 새로 만드는 variant 의 트림은 **엔카 근거(2대 이상)**로만 채운다.
 *   · 기존 트림은 지우지 않는다. 물려받은 뒤 엔카 것을 덧붙인다.
 *
 *   npx tsx scripts/fill-master-variants.mts          (미리보기)
 *   APPLY=1 npx tsx scripts/fill-master-variants.mts  (반영)
 */
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const FILE = 'public/data/vehicle-master.json';

type Plan = {
  sub: string;
  /** 기존 라벨 → 새 라벨. «같은 것을 제대로 부르기»만 한다. */
  rename?: Record<string, string>;
  /** 새로 만들 variant. 트림은 엔카 근거. */
  add?: Array<{ label: string; fuel: string; drivetrain?: string | null; battery_kwh?: number | null; trims: string[]; why: string }>;
};

const PLANS: Plan[] = [
  {
    // 엔카: 롱레인지 1104 · 롱레인지 AWD 444 · 스탠다드 25
    sub: '아이오닉5 NE',
    rename: { '전기': '전기 롱레인지', '전기 AWD': '전기 롱레인지 AWD' },
    add: [{
      label: '전기 스탠다드', fuel: '전기', drivetrain: null, battery_kwh: null,
      trims: ['익스클루시브'], why: '엔카 badge「스탠다드」 25대 → 익스클루시브(16)',
    }],
  },
  {
    // 엔카: 롱레인지 30 · 롱레인지 AWD 23 (스탠다드 없음)
    sub: '더 뉴 아이오닉5 NE',
    rename: { '전기': '전기 롱레인지', '전기 84kWh AWD': '전기 롱레인지 84kWh AWD' },
  },
  {
    // 엔카: 롱레인지 404 · 롱레인지 4WD 208 · 스탠다드 17 · 스탠다드 4WD 9 · GT 4WD 14
    sub: 'EV6 CV1',
    rename: { '전기': '전기 롱레인지', '전기 77.4kWh 4WD': '전기 롱레인지 77.4kWh 4WD' },
    add: [
      {
        label: '전기 스탠다드', fuel: '전기', drivetrain: null, battery_kwh: null,
        trims: ['에어', '라이트'], why: '엔카 badge「스탠다드」 17대 → 에어(15)·라이트(2)',
      },
      {
        label: '전기 스탠다드 4WD', fuel: '전기', drivetrain: '4WD', battery_kwh: null,
        trims: ['라이트'], why: '엔카 badge「스탠다드 4WD」 9대 → 라이트(8)',
      },
      {
        label: '전기 GT 4WD', fuel: '전기', drivetrain: '4WD', battery_kwh: null,
        trims: [], why: '엔카 badge「GT 4WD」 14대 → 전부 (세부등급 없음). GT 는 그 자체가 최상위다',
      },
    ],
  },
  {
    // 엔카: 롱레인지 4WD 43 · 롱레인지 2WD 9
    sub: '더 뉴 EV6 CV1',
    rename: { '전기 2WD': '전기 롱레인지 2WD', '전기 84kWh 4WD': '전기 롱레인지 84kWh 4WD' },
  },
  {
    // 엔카: 롱레인지 150 · 롱레인지 AWD 121 · 스탠다드 32
    sub: '아이오닉6',
    rename: { '전기': '전기 롱레인지', '전기 77.4kWh AWD': '전기 롱레인지 77.4kWh AWD' },
    add: [{
      label: '전기 스탠다드', fuel: '전기', drivetrain: null, battery_kwh: null,
      trims: ['익스클루시브'], why: '엔카 badge「스탠다드」 32대 → 익스클루시브(32)',
    }],
  },
  {
    // 엔카: 롱레인지 4WD 136 · 롱레인지 2WD 24 (스탠다드 없음)
    sub: 'EV9',
    rename: { '전기 4WD': '전기 롱레인지 4WD', '전기 2WD': '전기 롱레인지 2WD' },
  },
  {
    // 엔카: 스탠다드 53 · 스탠다드 AWD 28 · 퍼포먼스 AWD 11 — GV60 은 롱레인지가 없다
    sub: 'GV60',
    rename: { '전기': '전기 스탠다드', '전기 AWD': '전기 스탠다드 AWD' },
    add: [{
      label: '전기 퍼포먼스 AWD', fuel: '전기', drivetrain: 'AWD', battery_kwh: null,
      trims: [], why: '엔카 badge「퍼포먼스 AWD」 11대 → 전부 (세부등급 없음)',
    }],
  },
  {
    // 쉐보레 RS·ACTIV 는 파워트레인+외장 라인이다. 트림도 배기량도 아니어서 갈 곳이 없었다.
    sub: '트랙스 크로스오버 9BQC',
    add: [
      {
        label: '가솔린 1.2 RS', fuel: '가솔린', drivetrain: null, battery_kwh: null,
        trims: ['플러스'], why: '엔카 badge「1.2 RS」 201대 → (세부등급 없음)154·플러스47',
      },
      {
        label: '가솔린 1.2 ACTIV', fuel: '가솔린', drivetrain: null, battery_kwh: null,
        trims: ['플러스'], why: '엔카 badge「1.2 ACTIV」 131대',
      },
    ],
  },
];

const doc = JSON.parse(readFileSync(FILE, 'utf8')) as { entries: Rec[] };
const apply = S(process.env.APPLY) === '1';
let renamed = 0; let added = 0;

for (const plan of PLANS) {
  const targets = doc.entries.filter((e) => S(e.sub_model) === plan.sub);
  if (!targets.length) { console.log(`✗ 세대 없음: ${plan.sub}`); continue; }
  console.log(`\n═══ ${plan.sub}`);
  for (const e of targets) {
    e.variants = Array.isArray(e.variants) ? e.variants : [];
    for (const [from, to] of Object.entries(plan.rename || {})) {
      const v = (e.variants as Rec[]).find((x) => S(x.label) === from);
      if (!v) { console.log(`   · rename 대상 없음: 「${from}」`); continue; }
      if ((e.variants as Rec[]).some((x) => S(x.label) === to)) { console.log(`   · 「${to}」 이미 있음`); continue; }
      v.label = to;
      renamed++;
      console.log(`   · 「${from}」 → 「${to}」  (트림 ${(v.trims || []).length}개 그대로)`);
    }
    for (const a of plan.add || []) {
      if ((e.variants as Rec[]).some((x) => S(x.label) === a.label)) { console.log(`   · 「${a.label}」 이미 있음`); continue; }
      (e.variants as Rec[]).push({
        label: a.label, fuel: a.fuel, displacement_l: null, turbo: false,
        drivetrain: a.drivetrain ?? null, seat: null, battery_kwh: a.battery_kwh ?? null,
        trims: [...a.trims],
      });
      added++;
      console.log(`   + 「${a.label}」 trims=[${a.trims.join(', ') || '(없음)'}]`);
      console.log(`       ${a.why}`);
    }
    // 세대 전체 트림 목록(rollup)에 새 트림을 덧붙인다 — 지우지 않는다.
    if (!Array.isArray(e.trims)) e.trims = [];
    for (const a of plan.add || []) {
      for (const t of a.trims) if (!(e.trims as string[]).includes(t)) (e.trims as string[]).push(t);
    }
  }
}

console.log(`\n이름 바로잡음 ${renamed}곳 · 새 파워트레인 ${added}곳`);
if (!apply) { console.log('\n(미리보기만 — 반영하려면 APPLY=1)'); process.exit(0); }
copyFileSync(FILE, `${FILE}.bak`);
writeFileSync(FILE, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
console.log(`\n반영 완료 · 백업 ${FILE}.bak`);
