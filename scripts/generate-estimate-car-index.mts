/**
 * 견적 «차 고르기» 인덱스 생성기 — 트림마스터에서 **고르는 데 필요한 것만** 추린다.
 *
 *   npm run build:estimate-cars   → public/data/estimate-cars.json
 *
 * ★왜 따로 만드나. 정본(`public/data/vehicle-trim-master.json`)은 2.5MB 다. 폰이 차 하나 고르자고
 *   그걸 통째로 받으면 안 된다. 고르는 데 쓰는 칸만 남기면 **103KB(gzip 15KB)** 로 준다 —
 *   한 번 받아 두고 «즉시» 검색된다(왕복 없이). 검색은 기다리면 안 쓰인다.
 *
 * ★정본은 그대로다. 여기서 **값을 만들지 않는다** — 추리고 묶기만 한다.
 *   트림마스터가 바뀌면 이 명령을 다시 돌린다(`npm run check:estimate-cars` 가 어긋나면 잡는다).
 *
 * ★묶는 단위 = **세부모델(master_id)**. 그 아래 파워트레인(연료·배기량·구동·시트) → 트림.
 *   사장님 2026-09-06 「중고차를 **세부 모델까지** 특정할 수 있어야」 — 그 「세부 모델」이 이 단위다.
 *
 * ⚠ `usage_tier: 'blocked'` 는 뺀다(쓰지 말라고 표시된 행). automatic·manual 은 둘 다 담되
 *   manual 은 `mn:true` 로 표시해 화면이 「손으로 확인한 값」임을 알 수 있게 둔다.
 */
import fs from 'node:fs';
import path from 'node:path';

const SRC = path.join(process.cwd(), 'public/data/vehicle-trim-master.json');
const ALIAS = path.join(process.cwd(), 'data/model-aliases.json');
const OUT = path.join(process.cwd(), 'public/data/estimate-cars.json');

type Rec = {
  master_id: string; usage_tier: string; market_status: string; origin: string;
  maker: string; model: string; sub_model: string;
  powertrain: string; trim: string; generation_name: string; development_code: string;
  model_year_start: string; model_year_end: string;
  fuel: string; engine_cc: number | null; displacement_l: number | null;
  turbo: boolean | null; drivetrain: string | null; seats: number | null; battery_kwh: number | null;
};

/** 파워트레인 한 갈래 — 연료·배기량·구동·시트. 견적 엔진이 요구하는 cc·연료가 여기서 온다. */
export type CarPt = {
  pt: string; f: string; cc: number | null; dl: number | null;
  dr: string | null; st: number | null; t: string[];
};
/** 세부모델 한 대 — 화면이 한 줄로 보여 주는 단위. */
export type CarEntry = {
  i: string; mk: string; md: string; sm: string;
  g: string; dc: string; ys: string; ye: string;
  o: string; ms: string; mn?: true; p: CarPt[];
};

const artifact = JSON.parse(fs.readFileSync(SRC, 'utf8')) as { schema_version: number; data_as_of?: string; records: Rec[] };
if (artifact.schema_version !== 1) throw new Error(`트림마스터 schema_version=${artifact.schema_version} — 생성기를 먼저 맞춰라`);

const by = new Map<string, CarEntry>();
let blocked = 0;
for (const r of artifact.records) {
  if (r.usage_tier === 'blocked') { blocked += 1; continue; }
  let e = by.get(r.master_id);
  if (!e) {
    e = {
      i: r.master_id, mk: r.maker, md: r.model, sm: r.sub_model,
      g: r.generation_name || '', dc: r.development_code || '',
      ys: r.model_year_start || '', ye: r.model_year_end || '',
      o: r.origin, ms: r.market_status, p: [],
    };
    by.set(r.master_id, e);
  }
  if (r.usage_tier === 'manual') e.mn = true;
  let p = e.p.find((x) => x.pt === r.powertrain);
  if (!p) {
    p = { pt: r.powertrain, f: r.fuel, cc: r.engine_cc ?? null, dl: r.displacement_l ?? null, dr: r.drivetrain ?? null, st: r.seats ?? null, t: [] };
    e.p.push(p);
  }
  if (r.trim && !p.t.includes(r.trim)) p.t.push(r.trim);
}

// 최신 연식이 위로 — 영업자가 찾는 차는 대개 최근 것이다.
const yr = (e: CarEntry) => (e.ye === '현재' ? 9999 : Number(e.ye) || Number(e.ys) || 0);
const cars = [...by.values()].sort((a, b) => (a.mk === b.mk ? (a.md === b.md ? yr(b) - yr(a) : a.md.localeCompare(b.md, 'ko')) : a.mk.localeCompare(b.mk, 'ko')));

/**
 * 영문 슬러그 → 한글 모델명.
 * ★신차 피드(`/api/newcar`)의 기아 모델명은 **영문 슬러그**다(`sorento`·`carnival`). 제조사 PDF 파일명에서
 *   왔고, 그 피드는 외부 견적기(welrix)도 쓰는 공개 규격이라 **피드를 바꾸지 않는다.**
 *   대신 화면이 한글로 «보여 준다» — 영업자에게 「기아 sorento」는 못 읽는 이름이다.
 * ★원천은 이미 있다 — `data/model-aliases.json`(한글 → 별칭들). 여기서 뒤집어 담기만 한다.
 *   ⚠ 여기서 이름을 새로 «짓지» 않는다. 없으면 원문 그대로 보여 준다.
 */
let al: Record<string, string> = {};
try {
  const raw = JSON.parse(fs.readFileSync(ALIAS, 'utf8')) as Record<string, string[]>;
  for (const [ko, list] of Object.entries(raw)) {
    for (const a of list ?? []) {
      const k = String(a).toLowerCase().replace(/[\s()·\-_.]/g, '');
      if (k && !/[가-힣]/.test(a)) al[k] = ko;   // 한글 별칭은 담지 않는다(뒤집을 이유가 없다)
    }
  }
} catch { al = {}; }

const out = {
  v: 1,
  al,
  source: 'public/data/vehicle-trim-master.json',
  data_as_of: artifact.data_as_of ?? null,
  carCount: cars.length,
  trimCount: cars.reduce((n, c) => n + c.p.reduce((m, p) => m + p.t.length, 0), 0),
  cars,
};
fs.writeFileSync(OUT, JSON.stringify(out));
const kb = (fs.statSync(OUT).size / 1024).toFixed(0);
console.log(`생성 ${OUT}`);
console.log(`  세부모델 ${out.carCount} · 트림 ${out.trimCount} · 슬러그별칭 ${Object.keys(al).length} · ${kb}KB · blocked 제외 ${blocked}행`);
