/** 제네시스 신차 = 가격표 PDF 학습 → Firestore new_car_trim (기아 PDF 파서와 동일 로직·URL만 다름). */
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';

const APPLY = process.argv.includes('--apply');
const models = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const H = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/128.0 Safari/537.36', 'Referer': 'https://www.genesis.com/kr/ko/support/download-center/genesis-models.html' };
const S = (v: unknown) => String(v ?? '').trim();
const won = (s: string) => Number(S(s).replace(/[,만원]/g, '')) * (S(s).includes('만') ? 10000 : 1);
mkdirSync('tmp/newcar-pdf', { recursive: true });

let FS: FirebaseFirestore.Firestore | null = null;
if (APPLY) { const sa = JSON.parse(readFileSync('tmp/firebase-auth/sa.json', 'utf8')); if (!getApps().length) initializeApp({ credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey: sa.private_key.replace(/\\n/g, '\n') }) }); FS = getFirestore(); }

const FUEL = /(\d\.\d\s*(가솔린|디젤|LPG)( 터보)?|하이브리드|전기|EV|파워트레인)/;
const PRICE = /^[\d,]+만?원?$/;
const TRIM = /^[가-힣A-Za-z][가-힣A-Za-z0-9\-· ]{1,18}$/;

// 모델 → pricelist docId (다운로드센터 viewPdf file_key)
const DOC: Record<string, string> = {
  g70: '1185760DEE9FE748C8', 'g70-sb': '1189E1935270683756', g80: '1185760DEF092FC162', 'g80-ev': '1187ADA2F86C9652E4',
  g90: '1187CA750AB5DCF580', gv60: '1187BE6677965542F3', 'gv60-magma': '1192A6183E7454FD15', gv70: '118591BBD31A9EA72C',
  'gv70-ev': '1189CFE583F51B93FD', gv80: '118C2FD65FAB0B6FF4',
};
for (const model of models) {
  const pdf = `tmp/newcar-pdf/gen_${model}.pdf`;
  const docId = DOC[model]; if (!docId) { console.log(`✗ ${model} docId 없음`); continue; }
  const r = await fetch('https://www.genesis.com/wsvc/kr/api/v2/download-center/pdfview', { method: 'POST', headers: { ...H, 'content-type': 'application/x-www-form-urlencoded' }, body: `file_key=${docId}` });
  const ct = r.headers.get('content-type') || '';
  if (!r.ok || !/pdf/i.test(ct)) { console.log(`✗ ${model} ${r.status} ${ct}`); continue; }
  writeFileSync(pdf, Buffer.from(await r.arrayBuffer()));
  const txt = `tmp/newcar-pdf/gen_${model}.txt`;
  execSync(`python -c "import fitz;d=fitz.open(r'${pdf}');open(r'${txt}','w',encoding='utf-8').write(chr(10).join(p.get_text() for p in d))"`);
  const lines = readFileSync(txt, 'utf8').split('\n').map(S);

  const trims: any[] = []; const rules: string[] = []; let fuel = '';
  for (let i = 0; i < lines.length; i++) {
    const L = lines[i];
    const fm = L.match(FUEL); if (fm && L.length < 22 && !/파워트레인/.test(L)) { fuel = fm[1].replace(/\s+/g, ' '); continue; }
    if (/중복 선택 불가|적용 시 선택 가능|선택 불가|동시 선택/.test(L)) { rules.push(L); continue; }
    if (TRIM.test(L) && !/판매가격|기본 품목|세부|온라인|구분|패키지|주 요|세제혜택|친환경|^기본$/.test(L)) {
      const nxt = lines.slice(i + 1, i + 3).find((x) => x);
      if (nxt && PRICE.test(nxt) && won(nxt) > 30_000_000) {
        const window = lines.slice(i + 1, i + 8);
        const ai = window.findIndex((x) => /세제혜택 후/.test(x));
        const after = ai >= 0 ? window.slice(ai + 1).find((x) => PRICE.test(x)) : '';
        trims.push({ trim: L, fuel, priceBefore: won(nxt), priceAfter: after ? won(after) : won(nxt) });
      }
    }
  }
  const uniq = new Map<string, any>(); for (const t of trims) uniq.set(`${t.fuel}|${t.trim}`, t);
  const rows = [...uniq.values()];
  console.log(`\n■ ${model} — 트림 ${rows.length} · 규칙 ${rules.length}`);
  rows.forEach((t) => console.log(`   ${t.fuel} ${t.trim} ${t.priceBefore.toLocaleString()}${t.priceAfter !== t.priceBefore ? ` (세제후 ${t.priceAfter.toLocaleString()})` : ''}`));

  if (FS) {
    const batch = FS.batch(); const day = new Date().toISOString().slice(0, 10);
    for (const t of rows) { const id = `genesis_${model}_${t.fuel}_${t.trim}`.replace(/[/#.$\[\] ]/g, '_'); batch.set(FS.collection('new_car_trim').doc(id), { maker: '제네시스', carType: model.toUpperCase(), sub_model: model.toUpperCase(), fuel: t.fuel, trim: t.trim, priceBefore: t.priceBefore, priceAfter: t.priceAfter, rules, brandSource: 'genesis PDF', crawledAt: day }); }
    await batch.commit();
    console.log(`   ✓FS ${rows.length}트림`);
  }
}
process.exit(0);
