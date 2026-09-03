/**
 * **지금 뭐가 잘못됐나 — 한 장짜리 상태판.** 읽기 전용 · 구글 API 안 씀 · 1초.
 *
 * ★사장님 2026-09-01 「로직을 짜 놓은 게 있고 연동지도도 있고, 그거를 네가 만지진 않지만
 *   **모니터링은 네가 실시간 해야 되고** … 그 모니터링만큼은 하자는 거야. **어 뭐가 잘못됐다** 이런 거를.」
 *
 * 그래서 이 자는 «고치지 않는다». 무엇이 잘못됐는지 **누가 고칠 것인지로 갈라서** 보여만 준다.
 *   내 몫    — 정제칸이 판매 4탭·ERP 로 «있는 그대로» 갔나 (매뉴얼 §0)
 *   남의 몫  — 차종마스터에 이름이 없다 / 정책이 안 붙었다 (내가 채우지 않는다. 다만 «말은 해 준다»)
 *   공급사 몫 — 원문에 트림·요금이 없다
 *
 * 회차마다 갱신되는 기록만 읽는다 — 회차와 API 를 다투지 않는다.
 *   tmp/자동동기-상태.json · tmp/sheet-erp-parity.json · tmp/status-drift.json · sonokong/tmp/손오공정제.json
 *
 *   npx tsx scripts/monitor-pipeline.mts
 */
import { readFileSync, existsSync, statSync } from 'node:fs';

const read = <T>(path: string): { data: T | null; age: string } => {
  if (!existsSync(path)) return { data: null, age: '(없음)' };
  const min = Math.round((Date.now() - statSync(path).mtimeMs) / 60_000);
  const age = min < 60 ? `${min}분 전` : `${Math.round(min / 60)}시간 전`;
  try { return { data: JSON.parse(readFileSync(path, 'utf8')) as T, age }; } catch { return { data: null, age }; }
};

const 상태 = read<{ 시각: string; 초: number; ok: boolean; 단계?: { 단계: string; ok: boolean; 초?: number; 요약?: string }[]; 요약?: string[]; 커버리지?: { 총: number; 매칭: number } }>('tmp/자동동기-상태.json');
const 대조 = read<{
  counts?: Record<string, number>; missing?: unknown[];
  extra?: { plate?: string; provider?: string; erpStatus?: string }[];
  erpOnly?: { plate?: string; provider?: string; erpStatus?: string; finderVisible?: boolean }[];
  valueDiffs?: { fields?: { field: string }[] }[];
}>('tmp/sheet-erp-parity.json');
const 갈림 = read<{ drift_rows?: number; review_rows?: number; unknown_plates?: number; incomplete?: number }>('tmp/status-drift.json');
const 정제 = read<{ 결과?: unknown[]; 미스?: { 모델없음?: unknown[]; 트림연식없음?: unknown[] } }>('sonokong/tmp/손오공정제.json');

const 내몫: string[] = [];
const 남의몫: string[] = [];
const 공급사몫: string[] = [];
const 좋음: string[] = [];

/* ── 내 몫 — 「있는 그대로 옮겨졌나」 ─────────────────────────────── */
if (!상태.data) 내몫.push('상태로그가 없다 — 자동동기가 한 번도 안 돌았거나 기록을 못 썼다');
else {
  const s = 상태.data;
  const 실패 = (s.단계 ?? []).filter((x) => !x.ok);
  if (!s.ok || 실패.length) 내몫.push(`마지막 회차가 실패로 끝났다 — ${실패.map((x) => x.단계).join(' · ') || '단계 미상'}`);
  else 좋음.push(`마지막 회차 정상 (${s.시각} · ${s.초}초)`);
  if (s.초 > 1800) 내몫.push(`회차가 ${Math.round(s.초 / 60)}분 걸렸다 — 한 시간에 한 번인데 30분을 넘었다`);
  const 느린 = (s.단계 ?? []).filter((x) => (x.초 ?? 0) >= 300).map((x) => `${x.단계} ${Math.round((x.초 ?? 0) / 60)}분`);
  if (느린.length) 남의몫.push(`오래 걸린 단계: ${느린.join(' · ')}`);
}
if (대조.data) {
  const c = 대조.data;
  const 누락 = c.missing?.length ?? 0;
  const 초과 = (c.extra ?? []).filter((x) => x.erpStatus !== '계약중').length;   // 계약중은 규격상 정상
  if (누락) 내몫.push(`★판매시트에 있는데 상품찾기에 없는 차 ${누락}대 — 나르다 빠뜨렸다`);
  else 좋음.push('판매시트 → 상품찾기 누락 0대');
  if (초과) 내몫.push(`상품찾기에 있는데 판매시트에 없는 차 ${초과}대(계약중 제외)`);

  const erpOnly = c.erpOnly ?? [];
  if (erpOnly.length) {
    const 이미출고불가 = erpOnly.filter((x) => x.erpStatus === '출고불가').length;
    /**
     * ★「계약중」은 **뜨는 게 맞다** — CLAUDE.md:155 「계약금 입금(확인) 선점 = 계약중(목록 노출·마크)」.
     *   판매시트가 그 차를 뺀 것(source_contract_status)도 맞다. 둘 다 규격대로 동작한 것이다.
     *   전에는 이걸 「판매시트에 없는데 팔리고 있다」고 경보로 올렸다 — 6대 중 4대가 그것이었다.
     *   규격대로 도는 것을 빨간불로 올리면, 진짜 빨간불을 아무도 안 믿게 된다.
     */
    const 팔리는데없다 = erpOnly.filter((x) => x.finderVisible && x.erpStatus !== '계약중');
    const 계약중노출 = erpOnly.filter((x) => x.finderVisible && x.erpStatus === '계약중').length;
    const line = `ERP 에만 있는 차 ${erpOnly.length}대 (이미 출고불가 ${이미출고불가}`
      + `${계약중노출 ? ` · 계약중이라 뜨는 게 맞는 차 ${계약중노출}` : ''})`;
    if (팔리는데없다.length) {
      내몫.push(`★«팔 수 있는 차»인데 판매시트에 없다 ${팔리는데없다.length}대 — `
        + 팔리는데없다.map((x) => `${x.plate ?? ''}(${x.provider ?? ''})`).join(' · '));
    }
    남의몫.push(`${line} — ⑦′ 비추기를 켜면 정리된다`);
  }
  /* 값 불일치는 «어느 칸»이냐로 몫이 갈린다 — 정책·이름은 남의 몫, 그 밖은 나르기 문제다 */
  const 칸: Record<string, number> = {};
  for (const d of c.valueDiffs ?? []) for (const f of d.fields ?? []) 칸[f.field] = (칸[f.field] ?? 0) + 1;
  const 남의칸 = new Set(['정책코드', '세부모델', '세부트림', '모델', '제조사']);
  const 내칸 = Object.entries(칸).filter(([k]) => !남의칸.has(k) && !k.startsWith('소스'));
  const 남칸 = Object.entries(칸).filter(([k]) => 남의칸.has(k));
  if (내칸.length) 내몫.push(`★판매시트와 ERP 값이 다르다 — ${내칸.map(([k, v]) => `${k} ${v}대`).join(' · ')}`);
  if (남칸.length) 남의몫.push(`이름·정책이 ERP 와 다르다 — ${남칸.map(([k, v]) => `${k} ${v}대`).join(' · ')}`);
}
if (갈림.data) {
  const g = 갈림.data;
  if (g.unknown_plates) 남의몫.push(`상태를 판정 못 한 차 ${g.unknown_plates}대 (감사가 불완전하다)`);
  if (g.drift_rows) 남의몫.push(`원본과 정제시트의 상태가 다른 차 ${g.drift_rows}대`);
  if (!g.unknown_plates && !g.drift_rows) 좋음.push('상태 갈림 0대');
}

/* ── 요금 — 새면 돈이 샌다. 내 몫이다 ───────────────────────────── */
const 요금 = (상태.data?.요약 ?? []).join(' ').match(/요금검수 (\d+)대/);
if (요금) {
  const n = Number(요금[1]);
  if (n > 7) 내몫.push(`★판매엔 요금이 있는데 ERP 는 0인 차 ${n}대 (기준선 7대를 넘었다 — 요금이 샌다)`);
  else 좋음.push(`요금검수 ${n}대 (기준선 안)`);
}

/* ── 남의 몫 · 공급사 몫 ────────────────────────────────────────── */
if (정제.data?.미스) {
  const 트림 = 정제.data.미스.트림연식없음?.length ?? 0;
  const 모델 = 정제.data.미스.모델없음?.length ?? 0;
  const 물음표 = (정제.data.미스.트림연식없음 ?? []).filter((x) => /\[트림\s+\?\s+·/.test(String(x))).length;
  if (모델) 남의몫.push(`차종마스터에 모델이 없는 차 ${모델}대`);
  if (트림 - 물음표 > 0) 남의몫.push(`차종마스터에 트림 행이 없는 차 ${트림 - 물음표}대 — 채우면 이름이 붙는다`);
  if (물음표) 공급사몫.push(`원문에 트림이 「?」인 차 ${물음표}대 — 공급사에 물어야 한다`);
}

/* ── 찍기 ───────────────────────────────────────────────────────── */
const 시각 = 상태.data?.시각 ?? '(모름)';
console.log(`■ 파이프라인 상태판 — 마지막 회차 ${시각} (${상태.age})`);
console.log('   정제시트 → 판매 4탭 → ERP 를 «있는 그대로» 날랐나만 본다 (매뉴얼 §0)');

const 찍기 = (제목: string, 줄: string[], 없을때: string) => {
  console.log(`\n■ ${제목}`);
  if (!줄.length) console.log(`   ${없을때}`);
  for (const x of 줄) console.log(`   · ${x}`);
};
찍기('★내가 고칠 것 — 나르다 틀어진 것', 내몫, '없다. 있는 그대로 갔다');
찍기('남이 고칠 것 — 차종마스터·정책 (내가 채우지 않는다. 말만 한다)', 남의몫, '없다');
찍기('공급사가 채울 것 — 원문에 값이 없는 것', 공급사몫, '없다');
if (좋음.length) { console.log('\n■ 멀쩡한 것'); for (const x of 좋음) console.log(`   ✓ ${x}`); }

console.log(`\n${내몫.length ? `✗ 내 몫 ${내몫.length}건 — 여기부터 본다` : '✓ 내 몫은 깨끗하다'}`);
process.exit(내몫.length ? 1 : 0);
