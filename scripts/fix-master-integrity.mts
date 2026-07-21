/**
 * 마스터 전수 정합 — 공백 trim, 동일 세부명 중복 해소, 쉐보레 mf-038 중복 제거.
 */
import fs from 'fs';

const path = 'public/data/vehicle-master.json';
const root = JSON.parse(fs.readFileSync(path, 'utf8')) as { entries: Array<Record<string, unknown>> };
const entries = root.entries;

const t = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();

let trimmed = 0;
for (const e of entries) {
  for (const k of ['maker', 'model', 'sub_model', 'title', 'gen_code'] as const) {
    if (e[k] == null || e[k] === 'null') {
      if (k === 'gen_code') e[k] = '';
      continue;
    }
    const before = String(e[k]);
    const after = t(before);
    if (before !== after) {
      e[k] = after;
      trimmed++;
    }
  }
  // gen_code 문자열 "null" 정리
  if (e.gen_code === 'null') e.gen_code = '';
}

// 동일 maker+model+sub → 연식으로 이름 구분
type E = { id: string; maker: string; model: string; sub_model: string; year_start?: string; year_end?: string; variants?: unknown[] };
const byMMS = new Map<string, E[]>();
for (const e of entries as unknown as E[]) {
  const k = `${e.maker}|${e.model}|${e.sub_model}`;
  const a = byMMS.get(k) || [];
  a.push(e);
  byMMS.set(k, a);
}

const rename: Array<[string, string, string]> = [];
for (const [, group] of byMMS) {
  if (group.length < 2) continue;
  // 연식 시작 빠른 쪽 = 구형. 신형에 "더 뉴 " 접두(이미 있으면 구형 이름 유지·신형만 구분)
  const sorted = [...group].sort((a, b) => (Number(a.year_start) || 0) - (Number(b.year_start) || 0));
  const newest = sorted[sorted.length - 1];
  const older = sorted.slice(0, -1);
  // 쉐보레 mf-038 vs mf-003 완전중복 → variants 많은 쪽 남기고 삭제 표시
  const chevroletDup = group.every((e) => e.maker === '쉐보레') && group.some((e) => e.id.startsWith('mf-038')) && group.some((e) => e.id.startsWith('mf-003'));
  if (chevroletDup) {
    for (const e of group) {
      if (e.id.startsWith('mf-038')) (e as unknown as { _drop?: boolean })._drop = true;
    }
    continue;
  }
  for (const e of older) {
    const base = e.sub_model;
    // 이미 더 뉴인 구형 복제 → 접두 제거 시도, 안 되면 연식 접미
    let next = base.replace(/^더\s*뉴\s*/, '').trim() || base;
    if (next === base || group.some((g) => g !== e && g.sub_model === next) || byMMS.has(`${e.maker}|${e.model}|${next}`)) {
      next = `${base} (${e.year_start || '?'}~${e.year_end || '?'})`;
    }
    // 신형이 더 뉴가 아니면 신형에 더 뉴 부여 우선
    if (!newest.sub_model.startsWith('더 뉴') && !newest.sub_model.startsWith('올 뉴')) {
      const denew = `더 뉴 ${base}`.replace(/더 뉴 더 뉴/, '더 뉴');
      if (![...byMMS.keys()].some((k) => k === `${newest.maker}|${newest.model}|${denew}`)) {
        rename.push([newest.id, newest.sub_model, denew]);
        newest.sub_model = denew;
        if (newest.title) newest.title = String(newest.title).replace(base, denew);
      }
    }
    if (e.sub_model !== next) {
      rename.push([e.id, e.sub_model, next]);
      if (e.title) e.title = String(e.title).replace(e.sub_model, next);
      e.sub_model = next;
    }
  }
}

const kept = (entries as unknown as Array<E & { _drop?: boolean }>).filter((e) => !e._drop);
for (const e of kept) delete (e as { _drop?: boolean })._drop;

// title 공백 정리 후 저장
root.entries = kept as unknown as typeof root.entries;
fs.writeFileSync(path, JSON.stringify(root, null, 2) + '\n');

console.log('trimmed fields', trimmed);
console.log('renames', rename.length);
rename.forEach((r) => console.log(' ', r[0], ':', r[1], '→', r[2]));
console.log('dropped', entries.length - kept.length, 'kept', kept.length);
