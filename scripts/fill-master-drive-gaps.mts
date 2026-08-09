/**
 * 구동 축이 있는 세대인데 variant.drivetrain 이 빈 조합 — 재고·라인업 근거로 채움.
 * (값을 발명하는 게 아니라 마스터 조합 노드를 완성)
 *
 *   npx tsx scripts/fill-master-drive-gaps.mts
 *   APPLY=1 npx tsx scripts/fill-master-drive-gaps.mts
 *
 * 근거:
 *   · 그랜저 GN7 하이브리드 — 재고 2WD · 국내 HEV 전륜만
 *   · K8 / 더 뉴 K8 GL3 하이브리드 — 동일(가솔린만 2WD/4WD 갈림)
 *   · 디 올 뉴 코나 SX2 전기·HEV — 가솔린만 2WD/4WD · EV/HEV 전륜
 *   · 스타리아 US4 「디젤 2.2」(빈) vs 「디젤 2.2 4WD」 — 빈 칸=2WD 조합
 *
 * 범위: 공급 재고 우선 = 최근 7년(≈2019~). 마스터 보강 바닥은 PLAN 10년 걸침과 별개.
 * 로체 등 단종 구형은 손대지 않음.
 */
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const FILE = 'public/data/vehicle-master.json';
const apply = S(process.env.APPLY) === '1';

/** sub + variant label → drivetrain */
const PLANS: Array<{ sub: string; label: string; drive: string; why: string }> = [
  { sub: '그랜저 GN7', label: '하이브리드 1.6', drive: '2WD', why: '재고 2WD · HEV 전륜' },
  { sub: '더 뉴 K8 GL3', label: '하이브리드 1.6', drive: '2WD', why: '가솔린만 4WD 갈림 · HEV 전륜' },
  { sub: 'K8 GL3', label: '하이브리드 1.6', drive: '2WD', why: '가솔린만 4WD 갈림 · HEV 전륜' },
  { sub: '디 올 뉴 코나 SX2', label: '전기', drive: '2WD', why: '가솔린만 4WD · EV 전륜' },
  { sub: '디 올 뉴 코나 SX2', label: '하이브리드 1.6', drive: '2WD', why: '가솔린만 4WD · HEV 전륜' },
  { sub: '디 올 뉴 코나 SX2', label: '하이브리드', drive: '2WD', why: '가솔린만 4WD · HEV 전륜' },
  // 같은 연료에 「… 4WD」 라벨이 따로 있음 → 구동 없는 「디젤 2.2」= 2WD
  { sub: '스타리아 US4', label: '디젤 2.2', drive: '2WD', why: '형제 라벨 디젤 2.2 4WD 대비' },
  // 디젤만 4WD 옵션 · HEV/LPG 라인은 전륜만 (K8 HEV와 동일 패턴)
  { sub: '스타리아 US4', label: '하이브리드 1.6', drive: '2WD', why: '디젤만 4WD · HEV 전륜' },
  { sub: '스타리아 US4', label: 'LPG 3.5', drive: '2WD', why: '디젤만 4WD · LPG 전륜' },

  // EV: AWD/4WD 형제 있음 → 빈 칸 = RWD(=2WD). 재고 더뉴아이오닉5 drive=2WD 실측.
  { sub: 'EV6 CV1', label: '전기 롱레인지', drive: '2WD', why: '형제 전기 롱레인지 … 4WD 대비' },
  { sub: 'EV6 CV1', label: '전기 스탠다드', drive: '2WD', why: '형제 전기 스탠다드 4WD 대비' },
  { sub: '아이오닉5 NE', label: '전기 롱레인지', drive: '2WD', why: '형제 전기 롱레인지 AWD 대비' },
  { sub: '아이오닉5 NE', label: '전기 스탠다드', drive: '2WD', why: 'AWD 형제 있는 세대 · RWD' },
  { sub: '더 뉴 아이오닉5 NE', label: '전기 롱레인지', drive: '2WD', why: '형제 …AWD 대비 · 재고 2WD' },
  { sub: '아이오닉6', label: '전기 롱레인지', drive: '2WD', why: '형제 …AWD 대비' },
  { sub: '아이오닉6', label: '전기 스탠다드', drive: '2WD', why: 'AWD 형제 있는 세대 · RWD' },
  { sub: '더 뉴 아이오닉6', label: '전기', drive: '2WD', why: '형제 전기 …AWD 대비' },
  { sub: 'GV60', label: '전기 스탠다드', drive: '2WD', why: '형제 전기 스탠다드 AWD 대비' },

  // 코나 OS: 가솔린 2WD/4WD · HEV/EV 전륜만
  { sub: '코나 OS', label: '하이브리드 1.6', drive: '2WD', why: '가솔린만 4WD · HEV 전륜' },
  { sub: '코나 OS', label: '전기', drive: '2WD', why: '가솔린만 4WD · EV 전륜' },
  { sub: '더 뉴 코나 OS', label: '하이브리드 1.6', drive: '2WD', why: '가솔린만 4WD · HEV 전륜' },

  // 더 뉴 스타리아: 구형 US4와 동일 라인(디젤만 4WD) · HEV/LPG 전륜
  { sub: '더 뉴 스타리아 US4', label: '하이브리드 1.6', drive: '2WD', why: 'US4 디젤만 4WD · HEV 전륜' },
  { sub: '더 뉴 스타리아 US4', label: 'LPG 3.5', drive: '2WD', why: 'US4 디젤만 4WD · LPG 전륜' },
  { sub: '더 뉴 스타리아 US4', label: 'LPG 1.6', drive: '2WD', why: 'US4 디젤만 4WD · LPG 전륜' },
  { sub: '더 뉴 스타리아 US4', label: '가솔린+LPG 3.5', drive: '2WD', why: 'US4 디젤만 4WD · LPG 전륜' },

  // 수입 세단: xDrive/4MATIC 형제 대비 → RWD(=2WD). X5 등 상시 AWD SUV는 넣지 않음.
  { sub: '5시리즈 G60', label: '가솔린 2.0', drive: '2WD', why: '형제 가솔린 2.0 xDrive 대비' },
  { sub: '5시리즈 G60', label: '하이브리드 2.0', drive: '2WD', why: '형제 하이브리드 2.0 xDrive 대비' },
  { sub: '5시리즈 G60', label: '디젤 2.0', drive: '2WD', why: '형제 디젤 2.0 xDrive 대비' },
  { sub: '5시리즈 G30', label: '가솔린 2.0', drive: '2WD', why: '형제 가솔린 2.0 xDrive 대비' },
  { sub: '5시리즈 G30', label: '디젤 2.0', drive: '2WD', why: '형제 디젤 2.0 xDrive 대비' },
  { sub: '5시리즈 G30', label: '디젤 3.0', drive: '2WD', why: '형제 디젤 3.0 xDrive 대비' },
  { sub: '5시리즈 G30', label: '하이브리드 2.0', drive: '2WD', why: 'xDrive 형제 있는 세대 · RWD' },
  { sub: '3시리즈 G20', label: '가솔린 2.0', drive: '2WD', why: '형제 가솔린 2.0 xDrive 대비' },
  { sub: '3시리즈 G20', label: '디젤 2.0', drive: '2WD', why: '형제 디젤 2.0 xDrive 대비' },
  { sub: '3시리즈 G20', label: '가솔린 3.0', drive: '2WD', why: '형제 가솔린 3.0 xDrive 대비' },
  { sub: '3시리즈 G20', label: '하이브리드 2.0', drive: '2WD', why: 'xDrive 형제 있는 세대 · RWD' },
  { sub: 'E-클래스 W213', label: '가솔린 2.0', drive: '2WD', why: '형제 가솔린 2.0 4MATIC 대비' },
  { sub: 'E-클래스 W213', label: '디젤 1.9', drive: '2WD', why: '형제 디젤 1.9 4MATIC 대비' },
  { sub: 'E-클래스 W213', label: '디젤 3.0', drive: '2WD', why: '4MATIC 형제 있는 세대 · RWD' },
  { sub: 'E-클래스 W214', label: '가솔린 2.0', drive: '2WD', why: '형제 가솔린 2.0 4MATIC 대비' },
  { sub: 'C-클래스 W206', label: '가솔린 2.0', drive: '2WD', why: '형제 가솔린 2.0 4MATIC 대비' },

  // 테슬라: AWD 형제 대비 → RWD (이름 축도 RWD)
  { sub: '모델 3', label: '전기', drive: 'RWD', why: '형제 전기 AWD 대비' },
  { sub: '모델 Y', label: '전기', drive: 'RWD', why: '형제 전기 AWD 대비' },
  { sub: '모델 X', label: '전기', drive: 'RWD', why: '형제 전기 AWD 대비' },
];

const doc = JSON.parse(readFileSync(FILE, 'utf8')) as { entries: Rec[] };
let filled = 0;
const samples: string[] = [];

for (const plan of PLANS) {
  for (const e of doc.entries || []) {
    if (S(e.sub_model) !== plan.sub) continue;
    for (const v of (e.variants || []) as Rec[]) {
      if (S(v.label) !== plan.label) continue;
      if (S(v.drivetrain)) continue;
      v.drivetrain = plan.drive;
      // 형제 라벨이 「가솔린 2.5 2WD」꼴이므로 조합 표기도 맞춘다.
      if (!S(v.label).includes(plan.drive)) v.label = `${S(v.label)} ${plan.drive}`;
      filled++;
      samples.push(`${plan.sub} · ${plan.label} → drivetrain=${plan.drive} label=${v.label} (${plan.why})`);
    }
  }
}

console.log(`채움 ${filled}칸`);
for (const s of samples) console.log(' ', s);
if (!apply) {
  console.log('\n(미리보기 — APPLY=1 반영)');
  process.exit(0);
}
copyFileSync(FILE, `${FILE}.bak`);
writeFileSync(FILE, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
console.log(`\n반영 · 백업 ${FILE}.bak`);
