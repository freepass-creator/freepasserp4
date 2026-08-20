/**
 * **모델명 통일(엔카 기준)** — 공급사 시트 「모델명」을 «검색되는 모델 이름» 한 가지로 맞춘다. 기본 dry-run, --apply 로 반영. --who=이안카 한 곳만.
 *
 * ★사장님 2026-08-19 — 「벤츠 / 200 / E클래스(6세대) E200 아방가르드 … 이걸 E-클래스로 안 잡고 저렇게 잡았네. 모델명 엔카 기준으로 잡자 · 이건 세부모델이 아니고 그냥 모델명이잖아」.
 *   모델명 = 엔카 차량 목록에서 고르는 그 이름(벤츠 E-클래스 · BMW 5시리즈 · 아우디 A6 · 현대 그랜저). 세대·트림·배기량은 모델명이 아니다(그건 차명 칸).
 *   판정 순서:
 *     ① 차명·모델명 원문에서 제조사 말·연료 꼬리를 뗀다(splitMakerModel)
 *     ② 수입차 표기 규칙(ENCAR_MODEL_RULES): 벤츠 E200/E클래스/E 클래스 → E-클래스 · BMW 520d/5 시리즈 → 5시리즈 · X3 20d → X3 · 아우디 A6 40 TFSI → A6 · 미니 쿠퍼 → 쿠퍼
 *     ③ 차종마스터(vehicle-master) 모델 이름과 맞으면 그 이름(국산 대부분 — 「더 뉴 K8」 같은 세대 이름이 모델명 칸에 오면 「K8」로 내린다)
 *     ④ 그래도 못 정하면 그대로 둔다(지어내지 않는다).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { SHEET_NAME_MATCH, isOurNonInventoryTab, supplierSheetLabel } from '../lib/domain/supplier-template-sheet';
import { splitMakerModel } from '../lib/domain/mirror-sheet-mapping';
import { canonMakerDisplay } from '../lib/domain/maker-display';
import { snapToMaster, type MasterEntry } from '../lib/domain/vehicle-master-match';
import type { EntityRecord } from '../lib/intake/entities';
type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim(); const norm = (v: unknown) => S(v).replace(/\s+/g, '');
const key = (v: unknown) => S(v).toLowerCase().replace(/[\s\-_./()（）·,]/g, '');
const APPLY = process.argv.includes('--apply'); const WHO = (process.argv.find((a) => a.startsWith('--who=')) || '').slice(6);
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'], subject: 'pyh@teamjpk.com' });
const call = async (u: string, init?: RequestInit): Promise<Rec> => { for (let n = 0; ; n++) { const tok = (await jwt.getAccessToken()).token; const r = await fetch(u, { ...init, headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' } }); const t = await r.text(); if (r.ok) return t ? JSON.parse(t) : {}; if ((r.status === 429 || r.status >= 500) && n < 6) { await sleep(Math.min(60_000, 5_000 * 2 ** n)); continue; } throw new Error(`${r.status} ${t.slice(0, 300)}`); } };
const SH = 'https://sheets.googleapis.com/v4/spreadsheets';
const colA1 = (i: number) => { let t = '', n = i + 1; while (n > 0) { const r = (n - 1) % 26; t = String.fromCharCode(65 + r) + t; n = Math.floor((n - 1) / 26); } return t; };

const MASTER = ((): MasterEntry[] => { const raw = JSON.parse(readFileSync('public/data/vehicle-master.json', 'utf8')); return (Array.isArray(raw) ? raw : raw.entries) || []; })();
/** 차종마스터에 있는 모델 이름(제조사별) — 국산·수입 공통 사전. */
const MASTER_MODELS = new Map<string, Map<string, string>>();
for (const e of MASTER) { const mk = canonMakerDisplay((e as Rec).maker); if (!MASTER_MODELS.has(mk)) MASTER_MODELS.set(mk, new Map()); MASTER_MODELS.get(mk)!.set(key((e as Rec).model), S((e as Rec).model)); }

/** ★엔카 표기 규칙 — 제조사별 [정규식, 모델명]. 위에서부터 먼저 맞는 것. */
const ENCAR_MODEL_RULES: Record<string, [RegExp, string][]> = {
  벤츠: [
    [/^(?:the\s*new\s*)?([abces])[\s-]?클래스/i, '$1-클래스'], [/^([abces])[\s-]?class/i, '$1-클래스'],
    [/^amg\s*([abces])\s?\d{2,3}/i, '$1-클래스'], [/^([abces])\s?\d{2,3}/i, '$1-클래스'],
    [/^(gl[abcses]{1,2})/i, '$1'], [/^(eqa|eqb|eqc|eqe|eqs|glb|glc|gle|gls|cla|cls|slk|sl|amg\s*gt|v[\s-]?클래스|스프린터|마이바흐)/i, '$1'],
  ],
  BMW: [
    [/^([1-8])\s?시리즈/i, '$1시리즈'], [/^([1-8])\d{2}[a-z]{0,3}/i, '$1시리즈'], [/^([1-8])\s?series/i, '$1시리즈'],
    [/^(x[1-7]m?|z4|i[3-7]|ix[1-3]?|m[2-8])\b/i, '$1'],
  ],
  아우디: [[/^(a[1-8]|q[2-8]|e-?tron|rs\s?\d|s[3-8]|tt|r8)/i, '$1']],
  르노: [[/^(qm[3-6]|sm[3-7]|xm3|아르카나|캡처|조에|마스터|그랑콜레오스|트위지)/i, '$1']],
  쉐보레: [[/^(트랙스|트레일블레이저|스파크|말리부|이쿼녹스|콜로라도|타호|볼트|카마로|임팔라|크루즈|올란도)/i, '$1']],
  KGM: [[/^(토레스|렉스턴|티볼리|코란도|액티언|무쏘)/i, '$1']],
  미니: [[/^(쿠퍼|컨트리맨|클럽맨|페이스맨|컨버터블)/i, '$1'], [/^(cooper)/i, '쿠퍼']],
  폭스바겐: [[/^(골프|티구안|파사트|제타|아테온|투아렉|폴로|아틀라스|ID\.?[3-7])/i, '$1']],
  볼보: [[/^([xsvc]c?\d{2})/i, '$1'], [/^(ex30|ex90|c40)/i, '$1']],
  포드: [[/^(익스플로러|머스탱|레인저|브롱코|이스케이프|토러스)/i, '$1']],
  지프: [[/^(랭글러|체로키|그랜드체로키|레니게이드|컴패스|글래디에이터)/i, '$1']],
  테슬라: [[/^모델\s?([3sxy])/i, '모델$1'], [/^model\s?([3sxy])/i, '모델$1']],
  포르쉐: [[/^(911|카이엔|마칸|파나메라|타이칸|박스터|카이맨)/i, '$1']],
  캐딜락: [[/^(에스컬레이드|xt[4-6]|ct[4-6]|리릭)/i, '$1']],
};

/** 모델명 한 칸을 엔카 기준 이름으로. 못 정하면 빈 문자열(=그대로 두기). */
export function encarModelName(maker: string, modelCell: string, vehicleName: string): string {
  const mk = canonMakerDisplay(maker);
  const src0 = S(modelCell) || S(vehicleName);
  const sp0 = splitMakerModel(src0);
  const cands = [sp0.model, splitMakerModel(S(vehicleName)).model].filter(Boolean);
  const rules = ENCAR_MODEL_RULES[mk] || [];
  for (const c of cands) {
    for (const [re, out] of rules) {
      const m = re.exec(c.trim());
      if (m) { const name = out.replace(/\$(\d)/g, (_, i) => S(m[Number(i)])); return mk === '벤츠' ? name.toUpperCase().replace('클래스'.toUpperCase(), '클래스').replace(/^([A-Z])-클래스$/i, (s) => s.toUpperCase()) : name; }
    }
  }
  // 차종마스터 모델 이름과 정확히 같으면 그대로 / 모델 이름을 품고 있으면 그 이름으로
  const dict = MASTER_MODELS.get(mk);
  if (dict) {
    for (const c of cands) { const hit = dict.get(key(c)); if (hit) return hit; }
    const hay = key(`${src0} ${vehicleName}`);
    const byLen = [...dict.entries()].sort((a, b) => b[0].length - a[0].length);
    for (const [k, name] of byLen) if (k.length >= 2 && hay.includes(k)) return name;
  }
  const snap = snapToMaster({ maker: mk, model: cands[0] || '', sub_model: S(vehicleName) } as EntityRecord, MASTER);
  if (snap && (snap.confidence === 'high' || snap.confidence === 'medium') && S(snap.model)) return S(snap.model);
  return '';
}

if (process.argv.includes('--test')) {
  const cases: [string, string, string][] = [
    ['벤츠', '200', 'E클래스(6세대) E200 아방가르드'], ['벤츠', 'C-클래스', 'C클래스(4세대) C220 d 4MATIC'], ['벤츠', 'S클래스', 'S350 d 4Matic'],
    ['BMW', '1시리즈', '1시리즈(3세대) 120i 스포츠'], ['BMW', 'X1', 'X1(2세대) 20i xDrive'], ['BMW', '520', '5시리즈(7세대) 520i'],
    ['아우디', 'A6', 'A6(4세대) 40 TFSI Premium'], ['볼보', 'V60', 'V60 크로스컨트리(2세대) 2.0 B5 AWD 프로'],
    ['기아', '니로', '디 올뉴니로EV 에어'], ['기아', '더 뉴 K8', '더 뉴K8 2.5 GDI 노블레스'], ['현대', '그랜저', '더 뉴 그랜저 IG 하이브리드 르블랑'],
    ['미니', '쿠퍼', '쿠퍼 c 5도어'], ['테슬라', '모델Y', '모델Y 주니퍼 RWD'], ['포드', '익스플로러', '익스플로러(6세대) 2.3'],
  ];
  for (const [mk, model, name] of cases) console.log(`${mk} | ${model.padEnd(10)} | ${name.slice(0, 34).padEnd(34)} → ${encarModelName(mk, model, name) || '(그대로)'}`);
  process.exit(0);
}

const q = `name contains '${SHEET_NAME_MATCH}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`;
const found = await call(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=100&includeItemsFromAllDrives=true&supportsAllDrives=true`);
let books = ((found.files || []) as Rec[]).map((f) => ({ id: S(f.id), label: supplierSheetLabel(S(f.name)) })).sort((a, b) => a.label.localeCompare(b.label));
if (WHO) books = books.filter((b) => b.label.includes(WHO));
const log: Rec[] = []; let total = 0, kept = 0;
for (const b of books) {
  const meta = await call(`${SH}/${b.id}?fields=sheets.properties(sheetId,title,hidden)`);
  const tabs = ((meta.sheets || []) as Rec[]).map((s) => s.properties as Rec).filter((p) => !p.hidden && !isOurNonInventoryTab(S(p.title)));
  const data: { range: string; values: string[][] }[] = []; const lines: string[] = [];
  for (const p of tabs) {
    const title = S(p.title);
    const v = await call(`${SH}/${b.id}/values/${encodeURIComponent(`'${title.replace(/'/g, "''")}'!A1:BZ700`)}`) as { values?: string[][] };
    const rows = ((v.values || []) as string[][]).map((r) => r.map(S));
    const hi = rows.findIndex((r) => r.includes('차량번호') && r.some((c) => norm(c) === '차명(세부모델+트림)')); if (hi < 0) continue;
    const hdr = rows[hi]; const pi = hdr.findIndex((h) => norm(h) === '차량번호'); const ki = hdr.findIndex((h) => norm(h) === '제조사'); const mi = hdr.findIndex((h) => norm(h) === '모델명'); const ni = hdr.findIndex((h) => norm(h) === '차명(세부모델+트림)');
    if (mi < 0) continue;
    rows.slice(hi + 1).forEach((r, k) => {
      const plate = S(r[pi]); if (!plate) return; const cur = S(r[mi]);
      const next = encarModelName(S(r[ki]), cur, S(r[ni]));
      if (!next || next === cur) { kept++; return; }
      data.push({ range: `'${title.replace(/'/g, "''")}'!${colA1(mi)}${hi + 2 + k}`, values: [[next]] });
      lines.push(`   ${plate.padEnd(10)} ${S(r[ki]).padEnd(5)} 「${cur}」 → 「${next}」   (차명: ${S(r[ni]).slice(0, 40)})`);
      log.push({ sheet: b.label, tab: title, plate, maker: S(r[ki]), before: cur, after: next, name: S(r[ni]) });
    });
  }
  if (lines.length) { console.log(`■ ${b.label} ${lines.length}건`); console.log(lines.slice(0, 10).join('\n')); if (lines.length > 10) console.log(`   … 외 ${lines.length - 10}`); }
  total += data.length;
  if (APPLY && data.length) { for (let i = 0; i < data.length; i += 400) await call(`${SH}/${b.id}/values:batchUpdate`, { method: 'POST', body: JSON.stringify({ valueInputOption: 'RAW', data: data.slice(i, i + 400) }) }); console.log(`   ✓ 반영 ${data.length}`); }
}
writeFileSync('tmp/normalize-model-names-log.json', JSON.stringify({ at: new Date().toISOString(), apply: APPLY, changes: log }, null, 1));
console.log(`■ 합계 ${total}건 ${APPLY ? '반영' : '(dry-run — --apply 로 반영)'} · 그대로 둔 칸 ${kept}`);
