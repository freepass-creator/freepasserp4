import { parseDelimited } from '../lib/domain/sheet-import';

const SHEET_ID = '1TJBG4PABgly7EtGG6Os5GcY9La7kDR_yex56KHhXe2U';
const GID = '284963459';

(async () => {
  const csv = await (await fetch(
    `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=${GID}`,
  )).text();
  const raw = parseDelimited(csv);
  let hi = 0;
  for (let i = 0; i < raw.length; i++) {
    if ((raw[i] || []).some((c) => String(c).includes('차량번호'))) { hi = i; break; }
  }
  console.log('data rows after header', raw.length - hi - 1);
  // every row with any digit-hangul pattern loose
  const loose = /[0-9]{2,3}\s*[가-힣]\s*[0-9]{4}/;
  const strict = /^\d{2,3}[가-힣]\d{4}$/;
  let looseN = 0, strictN = 0;
  const weird: string[] = [];
  for (let i = hi + 1; i < raw.length; i++) {
    const cell = String(raw[i][1] || '').replace(/\s/g, '');
    if (!cell) continue;
    if (strict.test(cell)) strictN++;
    else if (loose.test(cell)) { looseN++; weird.push(`row${i}:${cell}`); }
    else if (/[가-힣0-9]/.test(cell) && cell.length > 3) weird.push(`row${i}:OTHER:${cell.slice(0, 40)}`);
  }
  console.log('strict plates', strictN, 'loose-only', looseN);
  console.log('weird', weird);
  console.log('100-97=3, 100-98=2, 100-strict=', 100 - strictN);
})().catch((e) => { console.error(e); process.exit(1); });
