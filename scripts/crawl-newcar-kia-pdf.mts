/**
 * 기아 신차 = 제조사 가격표 PDF 학습 → Firestore new_car_trim (사장님 2026-09-05 「제조사 PDF 받아 학습」).
 *   price_{model}.pdf 다운 → pymupdf 텍스트추출(python) → 트림·가격(세제혜택 전/후)·배타규칙 파싱 → Firestore.
 *   AEM 크롤이 막힌 기아·제네시스를 PDF로 푼다. 모델명은 인자로.
 * 예) npx tsx scripts/crawl-newcar-kia-pdf.mts seltos sorento sportage --apply
 */
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

const APPLY = process.argv.includes('--apply');
const models = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const H = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/128.0 Safari/537.36', 'Referer': 'https://www.kia.com/kr/shopping-tools/catalog-price.html' };
const S = (v: unknown) => String(v ?? '').trim();
const won = (s: string) => Number(S(s).replace(/[,만원]/g, '')) * (S(s).includes('만') ? 10000 : 1);
mkdirSync('tmp/newcar-pdf', { recursive: true });

let FS: FirebaseFirestore.Firestore | null = null;
if (APPLY) { const sa = JSON.parse(readFileSync('tmp/firebase-auth/sa.json', 'utf8')); if (!getApps().length) initializeApp({ credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey: sa.private_key.replace(/\\n/g, '\n') }) }); FS = getFirestore(); }

const FUEL = /(\d\.\d\s*(가솔린|디젤|LPG)( 터보)?|하이브리드|전기|EV)/;
const PRICE = /^[\d,]+만$/;
const TRIM = /^[가-힣A-Za-z][가-힣A-Za-z0-9\-· ]{1,14}$/;

for (const model of models) {
  const pdf = `tmp/newcar-pdf/price_${model}.pdf`;
  const r = await fetch(`https://www.kia.com/content/dam/kwp/kr/ko/vehicles/pdf/price/price_${model}.pdf`, { headers: H });
  if (!r.ok) { console.log(`✗ ${model} PDF ${r.status}`); continue; }
  writeFileSync(pdf, Buffer.from(await r.arrayBuffer()));
  // pymupdf 텍스트 추출
  const txt = `tmp/newcar-pdf/${model}.txt`;
  execSync(`python -c "import fitz;d=fitz.open(r'${pdf}');open(r'${txt}','w',encoding='utf-8').write(chr(10).join(p.get_text() for p in d))"`);
  const lines = readFileSync(txt, 'utf8').split('\n').map(S);

  // ★구역 인식: 연료헤더/판매가격 이후 = 트림구역, 선택품목/패키지옵션/구분 이후 = 옵션구역(트림 아님).
  //   트림명은 «여러 줄»일 수 있어 가격줄 직전 이름줄들을 모은다(에어\n스탠다드). 세제혜택 후 = priceAfter.
  const trims: any[] = [];
  const rules: string[] = [];
  let fuel = ''; let inTrimRegion = false; let nameBuf: string[] = []; let lastGroup = ''; let sectionTrim = ''; let dispBuf = '';
  const SECT_END = /선택 ?품목|패키지 옵션|세 ?부 ?사 ?양|^구분$|온라인 페이지|주 요 옵 션/;
  const NOTNAME = /^[•▶※]|친환경|세제혜택|판매가격|공급가액|기본 품목|^기본$|^\(|원$|km|kWh|인승|타이어|엔진|모터/;
  // 하위등급어(그룹 접두를 잃으면 상속): 에어\n스탠다드\n[가격]\n롱레인지 → 「에어 롱레인지」(Codex #1)
  const SUFFIX = /^(스탠다드|스탠더드|롱레인지|롱 ?레인지|2WD|4WD|E-4WD|프리미엄|익스클루시브)$/i;
  const FUELWORD = /^(가솔린|디젤|LPG|터보|하이브리드|전기)( 터보)?$/; // 연료어 단독 — 트림명 아님(Codex #5 쏘렌토)
  for (let i = 0; i < lines.length; i++) {
    const L = lines[i];
    // ★섹션 헤더 「…(N인승)」 — 이름이 연료면 fuel, 아니면 트림명(블랙 에디션 등)으로 잡는다(Codex #5).
    const sh = L.match(/^(.{1,18}?)\s*\(\s*\d\s*인승\s*\)/);
    if (sh) { const nm = S(sh[1]).replace(/\s+/g, ' '); const fmh = nm.match(FUEL);
      if (fmh) { fuel = fmh[1].replace(/\s+/g, ' '); sectionTrim = ''; }
      else if (!/판매가격|파워|트레인|공급|구분/.test(nm)) { sectionTrim = nm; }
      inTrimRegion = true; nameBuf = []; lastGroup = ''; dispBuf = ''; continue; }
    // 다줄 배기량 조각 「2.5」·「1.6 터보」 — 연료 조립용, 이름 아님
    if (/^\d\.\d( ?터보)?$/.test(L)) { dispBuf = L.replace(/\s+/g, ' '); continue; }
    // 연료어 단독 「가솔린」·「하이브리드」 — dispBuf·다음줄 「터보」와 합쳐 이 구역 연료로(이름 버퍼엔 안 넣음)
    if (FUELWORD.test(L) && L.length < 12) {
      let cand = (dispBuf ? dispBuf + ' ' : '') + L;
      if (/^(가솔린|디젤|LPG|하이브리드|전기)$/.test(L) && /^터보$/.test(S(lines[i + 1]))) { cand += ' 터보'; i++; }
      const fmr = cand.match(FUEL); fuel = fmr ? fmr[1].replace(/\s+/g, ' ') : (cand.replace(/\s+/g, ' ').trim() || fuel);
      dispBuf = ''; inTrimRegion = true; continue;
    }
    const fm = L.match(FUEL); if (fm && L.length < 20 && !/파워트레인|파워일렉/.test(L)) { fuel = fm[1].replace(/\s+/g, ' '); inTrimRegion = true; nameBuf = []; lastGroup = ''; continue; }
    if (/판매가격|주 요 기 본/.test(L)) { inTrimRegion = true; nameBuf = []; continue; }
    if (SECT_END.test(L)) { inTrimRegion = false; nameBuf = []; }
    // ★규칙(배타·종속) — 줄바꿈된 「적용 시 / 선택 가능」·중간에 대상이 낀 「적용 시 듀얼모터 4WD 선택 가능」까지(Codex #3).
    //   현재줄 + 다음줄을 합쳐 판정하고, ※·• 머리표만 떼서 담는다(중복은 아래서 제거).
    { const j = (L + ' ' + S(lines[i + 1])).replace(/\s+/g, ' ').trim();
      const R2 = /적용 ?시.{0,24}(선택 ?가능|선택 ?불가)|중복 ?선택.{0,4}(불가|불가능)|동시 ?선택.{0,6}(불가|불가능)|선택 ?시.{0,24}(가능|불가)|(선택|장착) ?불가(함|합니다|능)?/;
      // ★앞 «가격조각(NNN만/원)»만 뗀다 — 만/원 없는 숫자는 안 건드린다(「12.3인치」가 「.3인치」로 깨지던 것 방지·Codex #6).
      const norm = (x: string) => x.replace(/^[\s※•▶]+/, '').replace(/^[\d,]+\s*(?:만원?|원)\s*[※•▶]?\s*/, '').replace(/^[\s※•▶]+/, '').trim();
      for (const cand of [L.replace(/\s+/g, ' ').trim(), j]) if (R2.test(cand)) { rules.push(norm(cand)); break; } }
    if (/중복 선택 불가|적용 시 선택 가능|동시 선택 불가|선택 시.*가능/.test(L)) continue;
    if (!inTrimRegion) continue;
    if (PRICE.test(L) && won(L) > 10_000_000) {
      // 연료어 토큰(가솔린·터보 등)은 이름에서 뺀다 — 남은 것이 트림명(Codex #5 쏘렌토 「가솔린 터보」 유령 방지)
      const tokens = nameBuf.filter((t) => !FUELWORD.test(t));
      let trim = tokens.join(' ').trim();
      if (!trim && sectionTrim) trim = sectionTrim; // 「블랙 에디션(5인승)」처럼 섹션헤더가 트림명인 경우
      if (trim) {
        // 그룹 접두 상속: nameBuf 가 하위등급어뿐이면 직전 그룹을 앞에 붙인다
        const pureSuffix = tokens.length > 0 && tokens.every((t) => SUFFIX.test(t));
        if (pureSuffix && lastGroup) trim = `${lastGroup} ${trim}`;
        else { const grp = tokens.filter((t) => !SUFFIX.test(t)).join(' '); if (grp) lastGroup = grp; }
        const w = lines.slice(i + 1, i + 6);
        const ai = w.findIndex((x) => /세제혜택 후/.test(x));
        const after = ai >= 0 ? w.slice(ai + 1).find((x) => PRICE.test(x)) : '';
        trims.push({ trim, fuel, priceBefore: won(L), priceAfter: after ? won(after) : won(L) });
      }
      nameBuf = [];
    } else if (NOTNAME.test(L) || L.length > 24) { nameBuf = []; }
    else if (TRIM.test(L)) { nameBuf.push(L); }
  }
  // 같은 (연료·트림·가격)만 중복 제거 — 이름 다르면 별도 트림으로 보존(EV 6개 안 뭉개짐)
  const uniq = new Map<string, any>();
  for (const t of trims) uniq.set(`${t.fuel}|${t.trim}|${t.priceBefore}`, t);
  const rows = [...uniq.values()];
  // 규칙 중복 제거(쏘렌토 「12.3인치 클러스터 적용 시 선택 가능」이 열마다 3중복 → 1건)
  const ruleSet = [...new Set(rules.map((r) => r.trim()))];
  rules.length = 0; rules.push(...ruleSet);

  // ★옵션×트림 가격 매트릭스(Codex #2) — 좌표기반 추출기로 트림마다 옵션가를 붙인다.
  //   null(−)=해당없음(제외) · 0(기본)=기본포함 · 숫자=추가금. 연료+트림명으로 표를 맞춘다.
  const optJson = `tmp/newcar-pdf/${model}.opt.json`;
  try { execSync(`python scripts/extract-option-matrix.py "${pdf}" ${model} "${optJson}"`, { stdio: 'ignore' }); } catch { /* 옵션표 없으면 건너뜀 */ }
  const optTables: any[] = existsSync(optJson) ? (JSON.parse(readFileSync(optJson, 'utf8')).tables || []) : [];
  const Nf = (s: unknown) => S(s).toLowerCase().replace(/[\s()·]/g, '');
  // EV 옵션표는 그룹(에어/어스/GT-Line)으로 묶으므로 「에어 스탠다드」가 「에어」로 시작하면 그 그룹 표를 쓴다.
  const trimMatch = (tb: any, t: any) => (tb.trims || []).find((x: string) => { const a = Nf(t.trim), b = Nf(x); return a === b || a.startsWith(b) || a.endsWith(b) || b.startsWith(a) || b.endsWith(a); });
  // trimLabel = 실제 부착 대상 트림명(「에어 스탠다드」) · tn = 옵션표의 (그룹)키(「에어」)
  const extractOpts = (tb: any, tn: string, trimLabel: string) => {
    // ★이름이 조각(opt@N)이어도 «가격은 살린다»(Codex #4). null(−)=해당없음 제외·0(기본)=포함.
    let opts = (tb.options || []).map((o: any, idx: number) => ({ name: /^opt@/.test(S(o.name)) ? `옵션${idx + 1}` : S(o.name), price: o.byTrim?.[tn] })).filter((o: any) => o.price != null);
    // ★롱레인지 전용 옵션 게이트(Codex #2): EV 옵션표는 그룹단위라 스탠다드/롱레인지가 같은 행을 공유.
    //   「롱레인지 … 4WD 선택 가능」 규칙이 있으면 «스탠다드 트림»에서 그 4WD류를 걷어낸다(판정은 실제 트림명으로).
    const isStd = /스탠다드|스탠더드/.test(S(trimLabel)) && !/롱레인지/.test(S(trimLabel));
    const lrOnly4wd = rules.some((r) => /롱레인지/.test(r) && /4wd|듀얼\s*모터/i.test(r));
    if (isStd && lrOnly4wd) opts = opts.filter((o) => !/4wd|듀얼\s*모터/i.test(o.name));
    return opts;
  };
  const optionsFor = (t: any) => {
    // 트림명이 맞는 표들 중 연료가 맞는 것 우선.
    const cands = optTables.map((tb) => ({ tb, tn: trimMatch(tb, t) })).filter((c) => c.tn);
    const fuelC = cands.filter((c) => Nf(c.tb.fuel) && Nf(c.tb.fuel) === Nf(t.fuel));
    const pool = fuelC.length ? fuelC : cands; // 연료라벨 없는 표(블랙에디션 등)는 트림명만으로
    if (!pool.length) return [];
    const results = pool.map((c) => extractOpts(c.tb, c.tn, t.trim));
    // 후보가 여럿이라도 «결과가 동일»하면 씀(같은 표의 페이지 재판). «다르면»(승용≠밴) 비운다(확정값만·Codex #1).
    const uniq = [...new Set(results.map((r) => JSON.stringify(r)))];
    return uniq.length === 1 ? results[0] : [];
  };
  for (const t of rows) t.options = optionsFor(t);
  const optCount = rows.reduce((s, t) => s + (t.options?.length || 0), 0);
  console.log(`\n■ ${model} — 트림 ${rows.length} · 규칙 ${rules.length} · 옵션셀 ${optCount}`);
  rows.forEach((t) => console.log(`   ${t.fuel} ${t.trim} ${t.priceBefore.toLocaleString()}${t.priceAfter !== t.priceBefore ? ` (세제후 ${t.priceAfter.toLocaleString()})` : ''}`));
  rules.slice(0, 6).forEach((r) => console.log(`   규칙: ${r}`));

  if (FS) {
    // ★이 모델의 «기존 문서를 먼저 지운다»(Codex stale-doc): ID 에 가격이 들어가 있어, 가격이 바뀌면
    //   새 ID 문서가 생기고 옛 가격 문서가 남는다. 모델 단위로 싹 지우고 다시 써 stale 을 없앤다.
    const rowsFresh = rows; // 검증된 rows 확보 뒤에만 지운다(빈 추출이면 안 지움)
    if (rowsFresh.length) {
      const old = await FS.collection('new_car_trim').where('brandSource', '==', 'kia PDF').where('carType', '==', model).get();
      const del = FS.batch(); old.docs.forEach((d) => del.delete(d.ref)); await del.commit();
    }
    const batch = FS.batch(); const day = new Date().toISOString().slice(0, 10);
    for (const t of rowsFresh) {
      // ★가격을 ID에 포함(Codex 저장키 충돌): 롱레인지 3행·모닝 승용/밴 트렌디가 같은 문서로 덮이던 것 방지
      const id = `kia_${model}_${t.fuel}_${t.trim}_${t.priceBefore}`.replace(/[/#.$\[\] ]/g, '_');
      batch.set(FS.collection('new_car_trim').doc(id), { maker: '기아', carType: model, sub_model: model, fuel: t.fuel, trim: t.trim, priceBefore: t.priceBefore, priceAfter: t.priceAfter, options: t.options || [], rules, brandSource: 'kia PDF', crawledAt: day });
    }
    await batch.commit();
    console.log(`   ✓FS ${rowsFresh.length}트림`);
  }
}
process.exit(0);
