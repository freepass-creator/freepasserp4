import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizePlate } from '../lib/option-normalizer.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const input = String(process.env.SONOGONG_RAW_DUMP_PATH || '').trim()
  || path.join(root, 'lib', 'wonja', '손오공차량.json');
const dump = JSON.parse(fs.readFileSync(input, 'utf8'));
const cars = Array.isArray(dump?.차량) ? dump.차량 : [];
const violations = [];

for (const car of cars) {
  const evidence = car?.유료옵션근거 || {};
  const hasPublishedOption = !!String(car?.유료옵션 || '').trim();
  const claimsTcarEvidence = car?.유료옵션출처 === 'tcarPaidOptions';
  const claimsSonokongEvidence = car?.유료옵션출처 === 'sonokongCarOptionNote';
  const exactPlate = normalizePlate(evidence?.티카차번) === normalizePlate(car?.차번);
  const direct = evidence?.원천 === 'tcar:jsonData.paidOptList';
  const rawArray = Array.isArray(car?.유료옵션원문);
  const sonokongDirect = car?.버킷 === 'SON_NO_KONG'
    && evidence?.원천 === 'sokrc:homepageView.carOptionNote'
    && String(evidence?.손오공상품id ?? '') === String(car?.id ?? '')
    && normalizePlate(evidence?.손오공차번) === normalizePlate(car?.차번)
    && !!String(car?.손오공출고옵션원문 || '').trim()
    && String(car?.유료옵션 || '').trim() === String(car?.손오공출고옵션원문 || '').trim();
  if ((hasPublishedOption || claimsTcarEvidence || claimsSonokongEvidence || car?.상세url)
      && !((direct && exactPlate && rawArray) || sonokongDirect)) {
    violations.push({ 차번: car?.차번, 사유: '표시 옵션에 허용된 현재 원문·차량 식별 근거 없음' });
  }
}

const son = cars.filter((car) => car?.버킷 === 'SON_NO_KONG');
const tcar = cars.filter((car) => car?.버킷 === 'TCAR_EXTERNAL');
const verified = cars.filter((car) => car?.유료옵션근거?.원천 === 'tcar:jsonData.paidOptList');
const paid = cars.filter((car) => String(car?.유료옵션 || '').trim());
const sonokongNotes = cars.filter((car) => car?.유료옵션출처 === 'sonokongCarOptionNote');
const holds = cars.filter((car) => car?.유료옵션근거?.상태 === 'HOLD');

if (!cars.length) violations.push({ 사유: '손오공 원문 차량 0대' });
if (tcar.length && !verified.length) violations.push({ 사유: 'TCAR_EXTERNAL은 있으나 번호판 검증된 티카 상세 0대' });

console.log(`선택옵션 원문 감사 — 전체 ${cars.length} · SON ${son.length} · TCAR ${tcar.length} · 티카번호판검증 ${verified.length} · 손오공출고옵션 ${sonokongNotes.length} · 유료옵션 ${paid.length} · HOLD ${holds.length}`);
if (violations.length) {
  console.error(JSON.stringify(violations.slice(0, 30), null, 2));
  process.exit(1);
}
console.log('티카 유료옵션 원문 감사: PASS');
