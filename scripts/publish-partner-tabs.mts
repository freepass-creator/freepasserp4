/**
 * **공급사 원본 탭을 영업자 시트로 통째로 복사한다.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★**탭을 그대로 갖고 온다**(사장님 2026-08-13 — 「오플은 그냥 오플 탭을 갖고오자니까 그대로」).
 *   값만 베끼지 않는다. Sheets 의 `sheets.copyTo` 로 **탭 자체를 복사**하므로
 *   열너비·색·글꼴·병합·조건부서식·셀 링크가 공급사가 만든 그대로 온다.
 *   ⚠ 우리 서식을 씌우지 마라. 씌우다가 머리글 개행이 뭉개지고 안내줄이 잘려
 *     「간격이 하나도 안 맞는」 표가 됐다(2026-08-13, 두 번).
 *   ⚠ 값을 고치지도 마라. 옮기다 생긴 오류가 8/12 사고의 전부였다
 *     (오플 요금 92대 자리밀림 · 유령 48개월 72대).
 *
 * ★어느 탭을 가져오나 — `SOURCES` 참고. 오플은 재고·프로모션 두 장, 손오공은 구독 한 장이다.
 *   ⚠ 공급사가 **숨겨 둔** 탭은 안 가져온다. 감춘 건 지금 파는 물건이 아니라는 뜻이다.
 *   ⚠ 이 갈래는 「상품리스트」 탭에서 **뺀다**(`publish-jonghap-tab.mts` 가 같은 규칙으로 제외).
 *     한쪽만 고치면 차가 두 탭에 서거나 어느 탭에도 없게 된다.
 *
 * ⚠ **탭 주소(gid)가 발행할 때마다 바뀐다.** 복사본을 새로 만들고 옛 탭을 지우기 때문이다.
 *   영업자에게는 파일 주소만 주고 탭은 이름으로 찾게 해야 한다.
 *
 *   npx tsx scripts/publish-partner-tabs.mts
 *   npx tsx scripts/publish-partner-tabs.mts --apply
 */
/**
 * ⛔ 2026-08-18 사장님 — 「오플 구독 탭 없애고 상품리스트에 흡수, 손오공 구독만 별도 탭」.
 *   오플은 정제시트 → 상품리스트로 간다(publish-origin-tab). 이 스크립트는 더 쓰지 않는다 — 돌리면 탭이 두 벌이 된다.
 *   탭 삭제는 `scripts/remove-partner-tabs.mts` 가 했다.
 */
throw new Error('publish-partner-tabs 는 폐기됐다(2026-08-18) — 오플은 상품리스트에 흡수. 손오공구독은 publish-sonogong-tab.');
// eslint-disable-next-line no-unreachable
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const norm = (v: unknown) => S(v).replace(/\s+/g, '');
const arg = (k: string, d = '') => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3) || d;
const APPLY = process.argv.includes('--apply');
const SHEET = arg('sheet', S(process.env.INVENTORY_EXPORT_SHEET_ID) || '1Y1Mx1EcEpAuNer0y50Dq4eK92CpVjThO_suZLmo2vVs');
const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';

/**
 * 어느 공급사의 어느 탭을 어느 이름으로 가져오나.
 * ★손오공은 **구독 탭만** 가져온다 — 렌트는 「상품리스트」에 남는다.
 * ★오플 프로모션은 전기차(EV6·니로EV 등, 수수료 150만원) 한 장이다. 나머지 프로모션 탭
 *   (전기차 특가·스포티지·말리부·저상냉동탑차)은 오플이 숨겨 둬서 안 온다.
 */
const SOURCES = [
  /**
   * ★탭 이름은 영업자가 부르던 말이다(사장님 2026-08-13 — 「손오공구독 / 오플구독 / 오플프로모션
   *   이렇게」). 오플 재고 탭을 그 시트에서 「오플구독」이라 불렀다 — 원본 탭 이름
   *   (「판매차량리스트」)으로 바꿔 달지 마라.
   * ★`legacy` 는 예전에 우리가 붙였던 이름이다. 이름을 갈면 옛 탭이 지워지지 않고 남아
   *   **두 벌**이 된다 — 그러면 한쪽만 갱신돼 영업자가 옛 값을 본다.
   *
   * ⚠ **손오공구독은 여기서 찍지 않는다**(사장님 2026-08-13 — 「손오공 구독 시트도 상품리스트
   *   시트랑 규격 같게 해야지」). `publish-jonghap-tab.mts --sonogong` 이 상품리스트와 같은
   *   열·같은 글자색으로 만든다. 여기로 되돌리면 규격이 다시 갈린다.
   */
  { title: '오플구독', code: 'RP023', tab: /판매차량리스트/, color: '059669', legacy: ['오토플러스'] },
  { title: '오플프로모션', code: 'RP023', tab: /프로모션/, color: 'EA580C', legacy: ['오플 프로모션'] },
];
/**
 * 탭 자리와 색 — 사장님 2026-08-13 「상품리스트가 맨 앞 · 그다음 손오공 구독 · 그담에 오플꺼
 * 오플프로모션 · 탭색을 좀 바꿔주면 좋고」. 순서는 위 `SOURCES` 차례가 곧 탭 차례다.
 *   상품리스트   남색   우리가 만든 표
 *   손오공 구독   보라   구독
 *   오토플러스    초록   공급사 원본
 *   오플 프로모션 주황   같은 오플이지만 «지금 미는 것»이라 눈에 띄어야 한다
 */
const HOME_TAB = '상품리스트';
const HOME_COLOR = '1D4ED8';

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const dbT = (await new JWT({
  email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/firebase.database', 'https://www.googleapis.com/auth/userinfo.email'],
}).getAccessToken()).token;
const shT = (await new JWT({
  email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'], subject: 'pyh@teamjpk.com',
}).getAccessToken()).token;

const head = { Authorization: `Bearer ${shT}`, 'Content-Type': 'application/json' };
const call = async (url: string, init?: RequestInit) => {
  const res = await fetch(url, { ...init, headers: head });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
};
const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets';

/**
 * ★**시트 주소의 정본은 문패다** — RTDB 파트너 레코드가 아니다.
 * ⚠ 예전엔 `partners.sheet_url` 을 봤다. 파이프라인이 문패로 옮겨 간 뒤 그 값이 비어
 *   이 도구가 **「RP023 sheet_url 이 없다」로 죽어 있었다**(실측 2026-08-14).
 *   죽은 줄 아무도 몰랐고, 그래서 오플 탭 114대가 이틀째 안 갱신됐다 —
 *   영업자는 그게 옛 값인 줄 모르고 봤다. 이 구조의 «조용한 실패»가 정확히 이 자리다.
 */
const INDEX_SHEET = arg('index', '1TVeVXyJJRx0SzD2vxqy3eEjSojmMIWXSu7AdsKmpfmY');
const partnerByCode = new Map<string, Rec>();
{
  const v = await call(`${SHEETS}/${INDEX_SHEET}/values/A1:Z300`) as { values?: string[][] };
  for (const r of ((v.values || []) as string[][])) {
    const code = S(r[1]);
    const url = S(r[2]);
    if (!code || !/\/spreadsheets\/d\//.test(url)) continue;
    if (!partnerByCode.has(code)) partnerByCode.set(code, { partner_code: code, partner_name: S(r[0]), sheet_url: url });
  }
  console.log(`  문패에서 ${partnerByCode.size}곳을 읽었다`);
}

const PLATE_RE = /^\d{2,3}[가-힣]\d{4}$/;

type Job = { title: string; legacy: string[]; srcId: string; srcGid: number; srcTitle: string; plates: Set<string> };

async function resolve(src: typeof SOURCES[number]): Promise<Job> {
  const p = partnerByCode.get(src.code);
  const srcId = S(p?.sheet_url).match(/\/spreadsheets\/d\/([\w-]+)/)?.[1];
  if (!srcId) throw new Error(`${src.code} sheet_url 이 없다`);
  const meta = await call(`${SHEETS}/${srcId}?fields=sheets.properties(sheetId,title,hidden)`) as
    { sheets: { properties: { sheetId: number; title: string; hidden?: boolean } }[] };
  const hit = meta.sheets.find((s) => !s.properties.hidden && src.tab.test(s.properties.title));
  if (!hit) throw new Error(`${src.code} 에서 「${src.tab}」에 맞는 보이는 탭을 못 찾음`);
  // 대수는 «세어 보여주기» 용이다. 표에는 손대지 않는다.
  const vals = await call(`${SHEETS}/${srcId}/values/${encodeURIComponent(`'${hit.properties.title.replace(/'/g, "''")}'`)}`) as { values?: string[][] };
  const plates = new Set((vals.values || []).flat().map(norm).filter((v) => PLATE_RE.test(v)));
  console.log(`  ${src.code} 「${hit.properties.title}」 gid=${hit.properties.sheetId} · 차 ${plates.size}대`);
  return { title: src.title, legacy: src.legacy || [], srcId, srcGid: hit.properties.sheetId, srcTitle: hit.properties.title, plates };
}

console.log(`■ 공급사 원본 탭 통째 복사 ${APPLY ? '반영' : '미리보기(dry-run)'}\n`);
console.log(`  대상 시트 ${SHEET}`);
const jobs: Job[] = [];
for (const src of SOURCES) jobs.push(await resolve(src));
{
  // 같은 차가 두 탭에 서면 사고다.
  for (let i = 0; i < jobs.length; i++) for (let j = i + 1; j < jobs.length; j++) {
    const dup = [...jobs[i].plates].filter((v) => jobs[j].plates.has(v));
    if (dup.length) console.log(`  ⚠ 「${jobs[i].title}」·「${jobs[j].title}」에 겹친 차 ${dup.length}대 — ${dup.slice(0, 5).join(' · ')}`);
  }
}

if (!APPLY) { console.log('\n※ dry-run. 실제 쓰기는 --apply\n'); process.exit(0); }

const kst = new Date(Date.now() + 9 * 3600 * 1000).toISOString();
const stamp = `${kst.slice(5, 10).replace('-', '.')} ${kst.slice(11, 16)}`;

const madeGid = new Map<string, number>();
for (const job of jobs) {
  // ① 원본 탭을 우리 파일로 통째 복사 — 서식·너비·링크가 그대로 온다.
  const copied = await call(`${SHEETS}/${job.srcId}/sheets/${job.srcGid}:copyTo`, {
    method: 'POST', body: JSON.stringify({ destinationSpreadsheetId: SHEET }),
  }) as { sheetId: number; index: number };

  // ② 옛 탭(같은 이름으로 시작하는 것)을 지운다. 두 벌이 남으면 영업자가 옛 값을 본다.
  const meta = await call(`${SHEETS}/${SHEET}?fields=sheets.properties(sheetId,title,index)`) as
    { sheets: { properties: { sheetId: number; title: string; index: number } }[] };
  // 지금 이름과 «예전에 쓰던 이름» 둘 다 훑는다. 이름을 갈면 옛 탭이 남아 두 벌이 된다.
  const names = [job.title, ...job.legacy];
  const stale = meta.sheets.filter((s) =>
    s.properties.sheetId !== copied.sheetId
    && names.some((n) => s.properties.title === n || s.properties.title.startsWith(`${n} `)));

  // ③ 이름을 우리 것으로 — 원본 이름은 ★★★ 가 섞여 있어 탭 목록에서 안 읽힌다.
  const title = `${job.title} ${stamp} · ${job.plates.size}대`;
  await call(`${SHEETS}/${SHEET}:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({ requests: [
      ...stale.map((s) => ({ deleteSheet: { sheetId: s.properties.sheetId } })),
      { updateSheetProperties: { properties: { sheetId: copied.sheetId, title }, fields: 'title' } },
    ] }),
  });
  madeGid.set(job.title, copied.sheetId);
  console.log(`  「${title}」 ← ${job.srcTitle} · gid=${copied.sheetId}${stale.length ? ` (옛 탭 ${stale.length}장 지움)` : ''}`);

  /**
   * ★**수수료는 지운다**(사장님 2026-08-13 — 「그리고 수수료는 지워주고」).
   *   공급사 탭에는 「프로모션(수수료 150만원)」처럼 우리가 받는 몫이 적혀 있다.
   *   영업자 표는 손님에게 보여 주며 쓰는 자리라 그 숫자가 거기 있으면 안 된다.
   *
   *   괄호 안에 든 것 「…(수수료 150만원)」 → **괄호만** 뗀다. 프로모션 안내는 살려야 한다.
   *   괄호 밖에 있는 것 「12개월 수수료 100만원」 → **칸을 통째로 비운다.**
   *     조각만 지우면 「12개월」 같은 뜻 모를 말이 남는다.
   * ⚠ 원본 시트는 건드리지 않는다. 복사본에서만 지운다.
   */
  const scrubbed: { row: number; col: number; text: string }[] = [];
  {
    const vals = await call(`${SHEETS}/${SHEET}/values/${encodeURIComponent(`'${title.replace(/'/g, "''")}'`)}`) as { values?: string[][] };
    (vals.values || []).forEach((line, ri) => line.forEach((cell, ci) => {
      const raw = S(cell);
      if (!/수수료/.test(raw)) return;
      const withoutParen = raw.replace(/[（(][^)）]*수수료[^)）]*[)）]/g, '').replace(/[ \t]{2,}/g, ' ').trim();
      // 괄호를 떼고도 수수료가 남았다 = 그 칸은 수수료 얘기다. 비운다.
      const next = /수수료/.test(withoutParen) ? '' : withoutParen;
      scrubbed.push({ row: ri, col: ci, text: next });
    }));
    if (scrubbed.length) {
      await call(`${SHEETS}/${SHEET}:batchUpdate`, {
        method: 'POST',
        body: JSON.stringify({ requests: scrubbed.map((x) => ({
          updateCells: {
            range: { sheetId: copied.sheetId, startRowIndex: x.row, endRowIndex: x.row + 1, startColumnIndex: x.col, endColumnIndex: x.col + 1 },
            rows: [{ values: [{ userEnteredValue: x.text ? { stringValue: x.text } : {} }] }],
            fields: 'userEnteredValue',
          },
        })) }),
      });
      console.log(`     수수료 지움 ${scrubbed.length}칸 (${scrubbed.filter((x) => !x.text).length}칸은 통째로 비움)`);
    }
  }
}

/**
 * ④ 탭 순서 — 「상품리스트」 **바로 뒤에** `SOURCES` 순으로 세운다
 *    (사장님 2026-08-13 — 「오플 프로모션을 오플탭 옆에 붙여야지」).
 *    복사본은 맨 뒤에 붙기 때문에 그냥 두면 순서가 뒤죽박죽이 된다.
 * ⚠ 자리 옮기기는 **한 번에 하나씩** 보낸다. 한 배치에 몰아 넣으면 앞 요청이 옮긴 만큼
 *   뒤 요청의 번호가 밀려 엉뚱한 자리에 선다.
 */
{
  const meta = await call(`${SHEETS}/${SHEET}?fields=sheets.properties(sheetId,title,index)`) as
    { sheets: { properties: { sheetId: number; title: string; index: number } }[] };
  const rgb = (hex: string) => ({
    red: parseInt(hex.slice(0, 2), 16) / 255,
    green: parseInt(hex.slice(2, 4), 16) / 255,
    blue: parseInt(hex.slice(4, 6), 16) / 255,
  });
  const move = async (gid: number, index: number, color: string) => {
    await call(`${SHEETS}/${SHEET}:batchUpdate`, {
      method: 'POST',
      body: JSON.stringify({ requests: [{ updateSheetProperties: {
        properties: { sheetId: gid, index, tabColorStyle: { rgbColor: rgb(color) } },
        fields: 'index,tabColorStyle',
      } }] }),
    });
  };
  // 상품리스트가 맨 앞이다. 숨겨 둔 옛 탭이 0번에 있어 그냥 두면 뒤로 밀린다.
  const home = meta.sheets.find((s) => s.properties.title.startsWith(HOME_TAB));
  if (home) await move(home.properties.sheetId, 0, HOME_COLOR);
  let at = 1;
  for (const src of SOURCES) {
    const gid = madeGid.get(src.title);
    if (gid == null) continue;
    await move(gid, at, src.color);
    at++;
  }
  console.log(`  탭 순서: ${HOME_TAB} → ${SOURCES.map((s) => s.title).join(' → ')}`);
}
console.log(`\n  https://docs.google.com/spreadsheets/d/${SHEET}/edit\n`);
