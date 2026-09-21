/**
 * **하허호 F86 감사(`scripts/audit-f86-vs-atom.mts`)의 판정 — 시트·API 없이 도는 순수 함수.**
 *
 * 감사기는 시트를 읽어 오기만 하고, «맞다/틀리다»는 전부 여기서 정한다. 그래서 반례 시험
 * (`scripts/sim-f86-audit-checks.mts`)이 운영 시트 없이 같은 판정을 그대로 두드린다.
 *
 * ★2026-09-18 — 신선도 검사가 확정 탭명 규격(2026-09-16(6) ㉢ · 9bef7bf0 「초를 뗀다」)을 못 따라가
 *   정시 회차가 매번 빨간불이었다(run 35235961510 · 35304903901 — 칸 44,462개 어긋남 0 인데
 *   회사 탭 18장 + 종합이 「탭 이름에 발행 시각이 없다」). 옛 검사는 «모든» 탭에 `MM.DD HH:MM:SS` 를 요구했다.
 *   확정 규격은 둘뿐이다:
 *     · 하허호 — 「종합 MM.DD HH:MM · N대」(시각은 종합 하나 · 초 없음) · 회사 탭은 「회사 · N대」(시각 없음)
 *     · 하허호 밖 채널 — 전 탭 「회사 MM.DD HH:MM · N대」
 *   어느 탭이 시각을 다는지는 발행기와 같은 규칙(`f86TabCarriesMark`)을 쓴다 — 두 벌로 적으면 또 어긋난다.
 */
import { F86_BASE_TABS, f86TabCarriesMark, type F86TabPlan } from './channel-f86-plan';

const S = (v: unknown) => String(v ?? '').trim();
const J = (v: unknown) => JSON.stringify(v);

/** 탭 이름 한 장 — 「회사 · N대」 또는 「회사 MM.DD HH:MM · N대」. 이 밖(초가 붙은 옛 꼴 포함)은 null. */
export type F86TabName = { company: string; mark: string | null; count: number };
const TAB_NAME_RE = /^(\S+) (?:(\d{2}\.\d{2} \d{2}:\d{2}) )?· (\d+)대$/;
export function parseF86TabName(title: string): F86TabName | null {
  const m = TAB_NAME_RE.exec(S(title));
  return m ? { company: m[1], mark: m[2] ?? null, count: Number(m[3]) } : null;
}

/** 시각 문패(`salesPublishTabMark` 꼴 `MM.DD HH:MM`, KST)를 epoch ms 로. 연도는 문패에 없어 `now` 기준 «미래가 아닌» 가장 가까운 해로 잡는다. */
const FUTURE_SKEW_MS = 5 * 60e3;
export function f86MarkEpochMs(mark: string, now: number): number | null {
  const m = /^(\d{2})\.(\d{2}) (\d{2}):(\d{2})$/.exec(mark);
  if (!m) return null;
  const [mo, d, h, mi] = [m[1], m[2], m[3], m[4]].map(Number);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  const yearNow = new Date(now + 9 * 3600e3).getUTCFullYear();
  for (const y of [yearNow, yearNow - 1]) {
    const at = Date.UTC(y, mo - 1, d, h - 9, mi);
    if (new Date(at + 9 * 3600e3).getUTCDate() !== d) continue; // 02.30 같은 없는 날
    if (at <= now + FUTURE_SKEW_MS) return at;
  }
  return null;
}

/** ① 탭 이름·차례가 계획과 같은가. */
export function compareF86TabTitles(titles: string[], expected: string[]): string[] {
  if (J(titles) === J(expected)) return [];
  const 없음 = expected.filter((t) => !titles.includes(t));
  const 남음 = titles.filter((t) => !expected.includes(t));
  return [`탭 이름·차례가 이번 회차 계획과 다르다 — 실제 ${titles.length}장 ↔ 기대 ${expected.length}장`
    + `${없음.length ? ` · 없는 탭 ${없음.slice(0, 3).join(' | ')}` : ''}${남음.length ? ` · 남은 탭 ${남음.slice(0, 3).join(' | ')}` : ''}`
    + `${!없음.length && !남음.length ? ' · 차례만 다름' : ''}`];
}

/**
 * ② 신선도 — 시각을 «다는» 탭만 시각을 읽고, 안 다는 탭은 시각이 «없어야» 한다.
 * 하허호는 「종합」 하나가 회차 시각이다. 그 시각이 `maxAgeMin` 보다 오래됐거나, 없거나, 규격(초 없음) 밖이면 실패.
 */
export function checkF86TabFreshness(p: { titles: string[]; retro: boolean; now: number; maxAgeMin: number; modifiedAt?: string }): {
  fails: string[]; oldestMin: number | null; oldestTitle: string; markedTabs: number;
} {
  const fails: string[] = [];
  let oldestMin: number | null = null; let oldestTitle = ''; let markedTabs = 0;
  if (p.retro) {
    for (const fixed of F86_BASE_TABS) if (!p.titles.includes(fixed)) fails.push(`고정 기본 탭이 없다 — 「${fixed}」`);
    for (const t of p.titles) {
      if ((F86_BASE_TABS as readonly string[]).includes(t)) continue;
      const tab = parseF86TabName(t);
      if (!tab || tab.mark || (F86_BASE_TABS as readonly string[]).includes(tab.company)) {
        fails.push(`탭 이름이 F86 규격(고정 기본 탭 또는 「회사 · N대」) 밖이다 — 「${t}」`);
      }
    }
    const at = Date.parse(S(p.modifiedAt));
    if (!Number.isFinite(at)) fails.push('F86 문서 수정 시각을 읽을 수 없다');
    else {
      oldestMin = Math.max(0, Math.round((p.now - at) / 60000));
      oldestTitle = '문서 수정 시각';
      if (oldestMin > p.maxAgeMin) fails.push(`F86 이 ${oldestMin}분째 멈춰 있다(허용 ${p.maxAgeMin}분) — 문서 수정 시각`);
    }
    return { fails, oldestMin, oldestTitle, markedTabs };
  }
  /** 시각을 «달아야 하는» 탭(하허호=종합)이 시트에 서 있나 — 꼴이 틀려도 있기는 한 것과, 아예 없는 것을 가른다. */
  let carrierSeen = false;
  for (const t of p.titles) {
    const tab = parseF86TabName(t);
    if (!tab) {
      if (f86TabCarriesMark(S(t).split(' ')[0], p.retro)) carrierSeen = true;
      fails.push(`탭 이름이 F86 규격(「회사 · N대」 · 「종합 MM.DD HH:MM · N대」) 밖이다 — 「${t}」`);
      continue;
    }
    const carries = f86TabCarriesMark(tab.company, p.retro);
    if (!carries) {
      if (tab.mark) fails.push(`회사 탭에 발행 시각이 붙어 있다(옛 규격) — 「${t}」 · 확정 규격은 「${tab.company} · ${tab.count}대」`);
      continue;
    }
    carrierSeen = true;
    if (!tab.mark) { fails.push(`탭 이름에 발행 시각이 없다 — 「${t}」`); continue; }
    const at = f86MarkEpochMs(tab.mark, p.now);
    if (at == null) { fails.push(`탭 이름의 발행 시각을 읽을 수 없다(없는 날짜이거나 미래) — 「${t}」`); continue; }
    markedTabs++;
    const age = Math.round((p.now - at) / 60000);
    if (oldestMin == null || age > oldestMin) { oldestMin = age; oldestTitle = t; }
  }
  if (!carrierSeen) {
    fails.push(p.retro ? '「종합」 탭이 없다 — 하허호 F86 의 회차 시각은 종합 하나에만 있다' : '발행 시각이 달린 탭이 하나도 없다');
  }
  if (oldestMin != null && oldestMin > p.maxAgeMin) fails.push(`F86 이 ${oldestMin}분째 멈춰 있다(허용 ${p.maxAgeMin}분) — 「${oldestTitle}」`);
  return { fails, oldestMin, oldestTitle, markedTabs };
}

/** ③ 칸 단위 — 탭마다 머리글 · 줄 수 · 차번 차례 · «모든 칸 값». `grids[i]` 는 `tabs[i]` 의 시트 값(1행 = 머리글). */
export function compareF86Cells(tabs: Pick<F86TabPlan, 'company' | 'cols' | 'values'>[], grids: unknown[][][]): {
  fails: string[]; 칸수: number; 차수: number; 어긋난칸수: number; 칸어긋남: Map<string, { n: number; 표본: string[] }>;
} {
  const fails: string[] = [];
  let 칸수 = 0; let 차수 = 0;
  const 칸어긋남 = new Map<string, { n: number; 표본: string[] }>();
  tabs.forEach((tab, i) => {
    const grid: unknown[][] = grids[i] || [];
    const hdr = (grid[0] || []).map(S);
    if (J(hdr) !== J(tab.cols)) { fails.push(`「${tab.company}」 머리글이 계획과 다르다 — 실제 ${hdr.length}칸 ↔ 기대 ${tab.cols.length}칸`); return; }
    const rows = grid.slice(1).filter((r) => (r || []).some((v) => S(v)));
    if (rows.length !== tab.values.length) fails.push(`「${tab.company}」 줄 수 — 실제 ${rows.length} ↔ 기대 ${tab.values.length}`);
    const ci = tab.cols.indexOf('차량번호');
    const 실제차례 = rows.map((r) => S(r[ci]));
    const 기대차례 = tab.values.map((r) => S(r[ci]));
    if (J(실제차례) !== J(기대차례)) fails.push(`「${tab.company}」 줄 차례가 계획과 다르다`);
    const n = Math.min(rows.length, tab.values.length);
    for (let r = 0; r < n; r++) {
      차수++;
      for (let c = 0; c < tab.cols.length; c++) {
        칸수++;
        const want = S(tab.values[r][c]);
        const have = S((rows[r] || [])[c]);
        if (want === have) continue;
        const key = `${tab.company}·${tab.cols[c]}`;
        const e = 칸어긋남.get(key) || { n: 0, 표본: [] };
        e.n++; if (e.표본.length < 2) e.표본.push(`${S(tab.values[r][ci])} 시트「${have || '—'}」↔ 계획「${want || '—'}」`);
        칸어긋남.set(key, e);
      }
    }
  });
  const 어긋난칸수 = [...칸어긋남.values()].reduce((s, e) => s + e.n, 0);
  if (어긋난칸수) fails.push(`F86 칸 값이 원자 계획과 다르다 ${어긋난칸수}칸`);
  return { fails, 칸수, 차수, 어긋난칸수, 칸어긋남 };
}
