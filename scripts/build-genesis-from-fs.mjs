#!/usr/bin/env node
/**
 * 제네시스 조합지도 = new_car_trim(Firestore, 공식 PDF 추출·2026-09-05·audit통과)에서 재생성.
 *   (사장님 2026-09-06 「PDF 다 받아놨고 전수검사 오케이 했는데」 — stale mtops 대신 현재판 정본을 쓴다.)
 *
 * 제네시스는 «기본모델(basePrices 변형) + 필수/선택 옵션» 구조. new_car_trim 이 현재가를 담는다.
 *   min = min(basePrices)  (표준 최저)
 *   maxBaseVariant = max(basePrices)  (최고 변형 — 엔진·라인업(블랙급)까지 포함, 라벨 미분해)
 *   maxPrecise(잠정) = maxBaseVariant + 선택옵션 양수합(명백한 번들/중복 제외)
 *   → mtops(구가) 대체. 옵션명 일부는 PDF 추출조각(가격은 정확). 배타그룹 세분·블랙 라벨은 후속 정밀.
 */
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync, writeFileSync } from 'node:fs';

const sa = JSON.parse(readFileSync('tmp/firebase-auth/sa.json', 'utf8'));
if (!getApps().length) initializeApp({ credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey: sa.private_key.replace(/\n/g, '\n') }) });
const FS = getFirestore();
const num = (v) => typeof v === 'number' && Number.isFinite(v);

const all = (await FS.collection('new_car_trim').get()).docs.map((d) => ({ id: d.id, ...d.data() }));
const gen = all.filter((t) => t.maker === '제네시스').sort((a, b) => a.sub_model.localeCompare(b.sub_model));

const models = gen.map((t) => {
  const bp = (t.basePrices || []).filter(num).sort((a, b) => a - b);
  const min = bp.length ? bp[0] : t.priceBefore;
  const maxBase = bp.length ? bp[bp.length - 1] : t.priceBefore;
  const opts = (t.options || []).filter((o) => num(o.price));
  const mustGroups = {};
  const free = [];
  for (const o of opts) {
    if (o.group === '필수') (mustGroups[o.name] = o.price);
    else if (o.price > 0) free.push({ name: o.name, price: o.price });
  }
  // 선택 양수합 — 명백한 번들(파퓰러/컬렉션) 이름은 제외해 개별합으로(할인번들 대신 개별이 max)
  const isBundle = (n) => /파퓰러|컬렉션|프리미엄 패키지|프레스티지/.test(n);
  const freeSum = free.filter((f) => !isBundle(f.name)).reduce((s, f) => s + f.price, 0);
  return {
    model: t.sub_model, fuel: t.fuel, source: t.brandSource, crawledAt: t.crawledAt,
    basePrices: bp,
    mandatoryOptions: mustGroups,   // 구동·인승·디자인 등 필수(배타) 추가금
    freeOptions: free,
    minMax: {
      min, minConfig: '표준 최저 basePrice(현재가·개소세 기준은 PDF)',
      maxBaseVariant: maxBase, maxBaseNote: '최고 basePrice 변형(엔진·라인업 블랙급까지 포함, 라벨 미분해)',
      maxPrecise: maxBase + freeSum,
      maxPreciseNote: `최고 변형 ${maxBase.toLocaleString()} + 선택옵션 개별합 ${freeSum.toLocaleString()}(번들 제외). 잠정 — basePrices 라벨분해·배타조합 정밀은 후속.`,
    },
  };
});

const out = {
  _meta: {
    source: 'new_car_trim(제네시스 8모델) = 공식 PDF(genesis) 추출·2026-09-05·audit통과. mtops(구가) 대체.',
    note: 'min=최저 basePrice(현재가) · maxBaseVariant=최고 basePrice(블랙급 포함) · maxPrecise=최고변형+선택 개별합(번들 제외, 잠정). basePrices 라벨(엔진/표준/블랙) 분해와 배타 세분은 후속 정밀(공식 PDF 재파싱).',
    updatedAt: '2026-09-06',
    modelCount: models.length,
  },
  models,
};
writeFileSync('data/new-car/genesis-config-fs.json', JSON.stringify(out, null, 1));
console.log(`genesis-config-fs: ${models.length}모델 (new_car_trim 현재가)`);
for (const m of models) console.log(`  ${m.model}: min ${m.minMax.min.toLocaleString()} ~ 최고변형 ${m.minMax.maxBaseVariant.toLocaleString()} · maxPrecise ${m.minMax.maxPrecise.toLocaleString()} (선택 ${m.freeOptions.length})`);
