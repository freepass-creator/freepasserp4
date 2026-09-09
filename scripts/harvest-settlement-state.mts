/**
 * **정산 «상태»를 시트에서 거둬 원자에 박는다.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★★★사장님 2026-09-08 「지금 정산에 있는 거 다 원자화해서 **상태값으로 관리**해야 해.
 *   **내가 시트 안 보고 너한테 물어봐도 니가 대답할 수 있어야지**」
 *
 * ★★**여태 상태는 «종이에만» 있었다.** 원자에 `billed`·`collected` 칸이 있었지만 아무도 안 켰다 —
 *   459줄이 전부 false 였다. 그래서 「이거 청구했나?」를 물으면 매번 시트를 열어야 했고,
 *   실측 2026-09-08 웰릭스 다섯 줄이 «기청구인지» 아무도 답을 못 했다.
 *
 * ★거두는 것 넷 — 다 «시트에 이미 있는» 사실이다. 지어내지 않는다.
 * ```
 * 청구함      그 달 탭에 그 줄이 실려 나갔다           → billedAt (마지막 발행 시각)
 * 확인함      상대가 「확인」을 켰다                    → supplierOk / channelOk
 * 정정요청    상대가 「정정」을 켰다(+금액·메모)         → supplierFix / channelFix
 * 지금 어디   위를 모아 한 낱말로                       → stage
 * ```
 *
 * ★★**`stage` 는 «한 낱말»이다** — 물으면 이걸 답한다.
 * ```
 * 보류    settleExclude — 당분간 안 센다
 * 취소    계약이 깨졌다
 * 접수    원장에는 있는데 아직 청구서에 안 실렸다
 * 청구    청구서가 나갔다. 상대는 아직 말이 없다
 * 정정    상대가 「정정」을 켰다 — 우리가 볼 차례다
 * 확인    상대가 「확인」을 켰다 — 서로 같은 값을 본다
 * ```
 *   ⚠ 「수금」·「지급완료」는 여기서 못 안다 — 시트에 그 사실이 없다. 통장을 봐야 한다.
 *     모르는 것을 아는 척하지 않는다. 그 칸은 사람이 켤 때까지 비워 둔다.
 *
 * ```
 * npx tsx scripts/harvest-settlement-state.mts 2026-08
 * npx tsx scripts/harvest-settlement-state.mts 2026-08 --apply
 * ```
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { getFirestore } from 'firebase-admin/firestore';
import { shapeAtom, stageOf } from '../lib/domain/settlement-atom';

const S = (v: unknown) => String(v ?? '').trim();
const P = (v: unknown) => S(v).replace(/\s/g, '');
const N = (v: unknown) => Number(S(v).replace(/[,\s원]/g, '')) || 0;
const won = (n: number) => Math.round(n).toLocaleString('ko-KR');
const pad = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - [...s].reduce((a, c) => a + (c.charCodeAt(0) > 0x2000 ? 2 : 1), 0)));
const APPLY = process.argv.includes('--apply');
const MONTH = (process.argv.find((a) => /^\d{4}-\d{2}$/.test(a)) || '').trim();
if (!MONTH) { console.log('\n  달을 적어 주세요 — npx tsx scripts/harvest-settlement-state.mts 2026-08 [--apply]\n'); process.exit(1); }
const TAB = `${MONTH.slice(2, 4)}년${MONTH.slice(5)}월 정산`;

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
if (!getApps().length) initializeApp({ credential: cert(sa), databaseURL: 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app' });
const db = getDatabase();
const fsdb = getFirestore();
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, subject: 'pyh@teamjpk.com',
  scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'] });
const tok = async () => (await jwt.getAccessToken()).token;
const nap = (ms: number) => new Promise((z) => setTimeout(z, ms));
const get = async (u: string): Promise<Record<string, unknown> | null> => {
  for (let t = 0; t < 6; t++) {
    const r = await fetch(u, { headers: { Authorization: `Bearer ${await tok()}` } });
    if (r.ok) return r.json() as Promise<Record<string, unknown>>;
    if (r.status === 429 || r.status >= 500) { await nap(15_000); continue; }
    return null;
  }
  return null;
};

/** 상대가 켠 체크 — 「TRUE」 꼴을 다 받는다. */
const on = (v: unknown) => /^(TRUE|true|1|Y|O|v|✓)$/.test(S(v));

type Mark = { ok: boolean; fix: boolean; amt: number | ''; memo: string; at: string };
/** 차번 → 그 축의 표시. 축은 «공급» 과 «영업» 둘. */
const bySup = new Map<string, Mark>();
const byCh = new Map<string, Mark>();

const books = ((await get(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent("(name contains '프리패스 재고' or name contains '프리패스 정산') and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false")}&fields=files(id,name)&pageSize=100&supportsAllDrives=true&includeItemsFromAllDrives=true`)) as { files?: { id: string; name: string }[] } | null)?.files || [];
const used = books.filter((f) => /사용중/.test(f.name));
console.log(`\n■ ${MONTH} 상태 거두기 — 시트 ${used.length}권 ${APPLY ? '(반영)' : '(대조만)'}\n`);

for (const f of used) {
  const meta = await get(`https://sheets.googleapis.com/v4/spreadsheets/${f.id}?fields=sheets.properties(title,index)`) as { sheets?: { properties: { title: string; index: number } }[] } | null;
  /** ⚠ 「(예시)」 탭은 «보여주려고» 만든 것이라 상태를 거두면 안 된다 — 실측 YS모빌리티. */
  const tabs = (meta?.sheets || []).map((s) => s.properties.title)
    .filter((t) => t.startsWith(TAB) && !/예시|샘플|견본/.test(t));
  if (!tabs.length) continue;
  /** 정산 시트면 «영업채널 축», 재고 시트면 «공급사 축». 이름이 그 사실을 말한다. */
  const axis = /정산$|프리패스 정산/.test(f.name.replace(/^\[[^\]]+\]\s*/, '')) ? byCh : bySup;
  for (const t of tabs) {
    const g = ((await get(`https://sheets.googleapis.com/v4/spreadsheets/${f.id}/values/${encodeURIComponent(`'${t}'!A1:AZ300`)}`)) as { values?: unknown[][] } | null)?.values || [];
    const hi = g.findIndex((r) => (r || []).some((c) => S(c) === '차량번호'));
    if (hi < 0) continue;
    const h = (g[hi] || []).map(S); const ix = (n: string) => h.indexOf(n);
    let n = 0;
    for (let i = hi + 1; i < g.length; i++) {
      const r = g[i] || [];
      if (S(r[1]).replace(/\s/g, '') === '합계') break;      // ★표는 합계에서 끝난다
      const plate = P(r[ix('차량번호')]); if (!plate) continue;
      const raw = ix('정정금액') >= 0 ? S(r[ix('정정금액')]) : '';
      axis.set(plate, {
        ok: on(r[ix('확인')]), fix: on(r[ix('정정')]),
        amt: raw && /\d/.test(raw) ? N(raw) : '',
        memo: ix('메모(정정사유)') >= 0 ? S(r[ix('메모(정정사유)')]) : '',
        at: new Date().toISOString(),
      });
      n++;
    }
    console.log(`   ${pad(f.name.replace(/^\[[^\]]+\]\s*/, ''), 26)} 「${t}」 ${String(n).padStart(3)}줄  ${axis === byCh ? '영업채널 축' : '공급사 축'}`);
  }
}

/** 그 달 탭이 «언제» 나갔나 — 우리가 지난번에 찍은 시각이 곧 청구한 시각이다. */
const pub = (await db.ref('v4/sheet_published').get()).val() || {} as Record<string, { at?: string }>;
const publishedAt = (who: string) => S((pub as Record<string, { at?: string }>)[`${who}_${MONTH}`.replace(/[.#$/[\]\s]/g, '_')]?.at);

/** ★**읽는 곳도 파이어스토어다** — 정본이 하나여야 거둔 상태가 어긋나지 않는다(2026-09-09). */
const rows = (await fsdb.collection('settlement_rows').get()).docs.map((d) => [d.id, d.data()]) as [string, Record<string, unknown>][];
const mine = rows.filter(([, r]) => S(r.billMonth) === MONTH);
console.log(`\n■ ${MONTH} 원자 ${mine.length}줄 — 상태를 박는다\n`);

const patch: Record<string, unknown> = {};
const fsWrites: [string, Record<string, unknown>][] = [];
const tally = new Map<string, number>();
for (const [code, r] of mine) {
  const plate = P(r.plate);
  const sup = plate ? bySup.get(plate) : undefined;
  const ch = plate ? byCh.get(plate) : undefined;
  const billedAt = publishedAt(S(r.channel)) || (sup || ch ? new Date().toISOString() : '');
  const billed = !!(sup || ch);
  /**
   * ★★**두 축을 따로 센다** — 우리는 공급사에게 «받고» 영업채널에 «준다».
   *   공급사가 아직 안 냈는데 채널에는 이미 줬을 수 있다. 한 낱말로 뭉치면 그 어긋남이 안 보인다.
   * ⚠ 수금·지급은 여기서 «모른다» — 시트에 그 사실이 없다. 이미 서 있는 값을 지키고 덮지 않는다.
   */
  const off = r.settleExclude === true ? '보류' : r.cancelled === true ? '취소' : '';
  const claimStage = r.collected === true ? '수금'
    : sup?.fix ? '정정' : sup?.ok ? '확인' : billed ? '청구' : '접수';
  const payStage = r.paid === true ? '지급'
    : ch?.fix ? '정정' : ch?.ok ? '확인' : billed ? '통보' : '접수';
  const stage = stageOf(claimStage, payStage, off as '보류' | '취소' | '');
  tally.set(stage, (tally.get(stage) || 0) + 1);
  const state = {
    billed, billedAt: billed ? billedAt : S(r.billedAt),
    supplierOk: !!sup?.ok, supplierFix: !!sup?.fix, supplierFixAmt: sup?.amt || 0, supplierMemo: sup?.memo || '',
    channelOk: !!ch?.ok, channelFix: !!ch?.fix, channelFixAmt: ch?.amt || 0, channelMemo: ch?.memo || '',
    claimStage, payStage, stage, stateAt: new Date().toISOString(),
  };
  /** ★규격을 거쳐 담는다 — 모든 줄이 모든 밭을 갖는다. */
  const shaped = shapeAtom({ ...r, ...state });
  patch[`settlement_rows/${code}`] = shaped;
  fsWrites.push([code, shaped]);
}
for (const [k, v] of [...tally].sort((a, b) => b[1] - a[1])) console.log(`   ${pad(k, 6)} ${String(v).padStart(3)}줄`);

const fixes = mine.filter(([, r]) => { const p = P(r.plate); return bySup.get(p)?.fix || byCh.get(p)?.fix; });
if (fixes.length) {
  console.log(`\n   ★「정정」이 켜진 줄 ${fixes.length}개 — 우리가 볼 차례다`);
  for (const [, r] of fixes) {
    const p = P(r.plate); const m = byCh.get(p) || bySup.get(p);
    console.log(`      ${pad(S(r.plate) || '(차번없음)', 11)} ${pad(S(r.customer), 8)} ${pad(S(r.channel), 7)} 정정금액 ${m?.amt === '' ? '(안 적음)' : won(Number(m?.amt))}  ${m?.memo || ''}`);
  }
}

if (!APPLY) { console.log('\n※ dry-run — 아무것도 안 썼습니다. --apply 로 박습니다.\n'); process.exit(0); }
await db.ref().update(patch);
for (let i = 0; i < fsWrites.length; i += 400) {
  const b = fsdb.batch();
  for (const [id, data] of fsWrites.slice(i, i + 400)) b.set(fsdb.collection('settlement_rows').doc(id), data);
  await b.commit();
}
console.log(`\n  ✓ ${mine.length}줄에 상태를 박았습니다 — RTDB·파이어스토어 둘 다.`);
console.log('  ※ 이어서 — npm run check:parity\n');
process.exit(0);
