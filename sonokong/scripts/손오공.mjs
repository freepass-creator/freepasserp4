/** 손오공 저신용/픽업 차량 전량 덤프 (상세 포함) → lib/wonja/손오공차량.json (정본).
 *
 *  목록(list)엔 없는 saleAmt·옵션·사진·보증금·설명까지 상세(view)로 채운다.
 *  시트 대신 이 API 가 정본. 토큰 자동로그인이라 그냥 돌리면 된다.
 *
 *    node scripts/손오공.mjs            전량 갱신 + 요약
 *    node scripts/손오공.mjs --조용      파일만
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { 버킷, pullAll, view, viewAgent, lotteSpec, findTcarSaleByPlate, mapPool, 남은시간h } from '../lib/sonokong.mjs';
import { normalizePlate, tcarPaidOptionNames } from '../lib/option-normalizer.mjs';

const 루트 = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const 출력 = path.join(루트, 'lib', 'wonja', '손오공차량.json');
const 조용 = process.argv.includes('--조용');
const 캐시규격 = 'sonokong-route-bucket-v4-current-identity';
const N = (n) => (n == null ? '' : Number(n).toLocaleString('ko-KR'));
const 날 = (s) => (s ? String(s).slice(0, 10) : '');

function 보증금뽑기(estimates, 원천버킷) {
  const out = {};
  const 상품접두사 = 원천버킷 === 'LOW_SONOKONG_DAILY' ? 'RENT_' : 'SUBSCRIBE_';
  for (const e of estimates || []) {
    if (e.creditType !== 'LOW' || !String(e.estimateType || '').startsWith(상품접두사)) continue;
    if (e.securityDepositAmount != null) out[e.estimateType] = Number(e.securityDepositAmount);
  }
  return out; // 렌트={RENT_BUYOUT,RENT_RETURN}, 구독={SUBSCRIBE_BUYOUT,SUBSCRIBE_RETURN}
}

// 저신용 월납 — 상세 estimates(creditType LOW)에서. 목록보다 완전하다(인수형 12·24 포함).
function 월납뽑기(estimates, 원천버킷) {
  const out = {};
  const 상품접두사 = 원천버킷 === 'LOW_SONOKONG_DAILY' ? 'RENT_' : 'SUBSCRIBE_';
  for (const e of estimates || []) {
    if (e.creditType !== 'LOW' || !String(e.estimateType || '').startsWith(상품접두사)) continue;
    const m = {};
    for (const k of [12, 24, 36, 48, 60]) {
      const v = e['monthly' + k];
      if (v != null && v !== '') m[k] = Math.round(Number(v));
    }
    out[e.estimateType] = m;
  }
  return out; // { SUBSCRIBE_RETURN:{12..60}, SUBSCRIBE_BUYOUT:{12..60} }
}

function 정규화(r, d, 버킷값, 원천버킷) {
  const opts = (d?.options || []).filter((o) => o.isApplied).map((o) => o.optionName);
  const 티카직접원문 = d?.__lotte?.__paidOptList;
  const 티카직접확인 = Array.isArray(티카직접원문);
  const 손오공출고옵션원문 = 버킷값 === 'SON_NO_KONG' && typeof d?.carOptionNote === 'string'
    ? d.carOptionNote.trim()
    : '';
  // 표시값은 번호판까지 대조한 티카 상세 원문만. 손오공의 미러 필드는 원문으로만 보존한다.
  const 원문유료옵션 = 티카직접확인 ? 티카직접원문 : null;
  // 손오공 보유차가 티카에 현재 게시되지 않은 경우에만, 손오공 ERP가 화면에서
  // 「신차출고옵션」으로 표시하는 carOptionNote를 현재 선택옵션 원문으로 사용한다.
  // 티카 원문이 있으면 차량번호까지 검증된 paidOptList가 항상 우선한다.
  const 유료 = 티카직접확인 ? tcarPaidOptionNames(원문유료옵션) : 손오공출고옵션원문;
  const 정제 = d?.__lotte
    ? Object.fromEntries(Object.entries(d.__lotte).filter(([key]) => !key.startsWith('__')))
    : null;
  return {
    버킷: 버킷값,                     // SON_NO_KONG | TCAR_EXTERNAL
    원천버킷,                         // LOW_SONOKONG_DAILY | LOW_SONOKONG | LOW_TCAR
    id: r.id, hashId: r.hashId,
    차번: r.carNumber,
    차명: r.carName,                  // 제조사_모델_세부 원문
    제조사: r.groupName4,
    모델: r.groupName2,
    세부: r.groupName1,
    연식: 날(r.carManufactureDate),
    최초등록: 날(d?.firstRegistrationDate || d?.carManufactureDate),
    연료: r.carFuel,
    주행거리: r.mileage == null ? null : Number(r.mileage),
    외장: r.exColor,
    내장: d?.inColor ?? null,
    배기량: r.engineDisplacement,
    차량가격: d?.saleAmt ?? null,
    중고: r.isUsedCar === true,
    노출: r.webVisibility,
    계약가능: r.contractAvailable,
    계약중: r.hasActiveContract === true,
    옵션: opts.join(', '),
    유료옵션: 유료,
    유료옵션출처: 티카직접확인 ? 'tcarPaidOptions' : (손오공출고옵션원문 ? 'sonokongCarOptionNote' : null),
    유료옵션원문: 원문유료옵션 ?? null,
    손오공출고옵션원문: 손오공출고옵션원문 || null,
    손오공유료옵션원문: d?.tcarPaidOptions ?? null,
    유료옵션근거: 티카직접확인 ? {
      원천: 'tcar:jsonData.paidOptList',
      매칭: d?.__tcarMatchType || '원천상세URL',
      티카url: d?.__tcarOptionUrl || d?.carSourceUrl || null,
      티카차번: d?.__lotte?.__plateNumber || null,
      티카carId: d?.__lotte?.__carId || null,
    } : (손오공출고옵션원문 ? {
      원천: 'sokrc:homepageView.carOptionNote',
      매칭: '손오공ERP상품ID+차량번호',
      손오공상품id: r.id,
      손오공차번: r.carNumber,
    } : ((Array.isArray(d?.tcarPaidOptions) || d?.__sourceUrlRaw) ? {
      원천: Array.isArray(d?.tcarPaidOptions) ? 'sokrc:tcarPaidOptions' : null,
      상태: 'HOLD',
      사유: '동일 차량번호의 현재 티카 상세 원문 미확인',
      티카링크원문: d?.__sourceUrlRaw || null,
    } : null)),
    설명: d?.carDescription ?? null,
    사진들: (d?.images || []).sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)).map((im) => im.imageUrl).filter(Boolean),
    상세url: /^https?:\/\//.test(String(d?.carSourceUrl || '')) ? d.carSourceUrl : null, // 번호판까지 검증된 티카 상세만
    상세url원문: /^https?:\/\//.test(String(d?.__sourceUrlRaw || '')) ? d.__sourceUrlRaw : null,
    정제, // T카 롯데 정제값(차종·내장·구동·인승·변속·세부트림 등)
    썸네일: r.thumbnail || null,
    월납: r.monthlyPrice || null,
    저신용월납: (() => {
      const e = 월납뽑기(d?.estimates, 원천버킷);
      return Object.keys(e).length ? e : (r.lowCreditMonthlyPrices || null);
    })(), // 렌트는 RENT_*, 구독/픽업은 SUBSCRIBE_* 상세 estimates 우선
    보증금: 보증금뽑기(d?.estimates, 원천버킷),          // ERP LOW estimate의 securityDepositAmount 원문
  };
}

async function main() {
  const 차량 = [];
  const 집계 = {};
  // ★매시간 실행용 캐시 — 상세(saleAmt·옵션·사진·롯데제원·가격)는 20시간 캐시, 상태·계약·주행거리만 매시간 리스트에서 새로.
  //   그래야 롯데/손오공 상세를 매시간 두들기지 않는다. --full 은 전량 상세 재수집(하루 한 번 자동으로 이뤄짐 — 20h 넘으면 재수집).
  const 풀 = process.argv.includes('--full');
  const 신선 = 20 * 3600e3;
  const 지금 = Date.now();
  const 캐시 = new Map();
  try {
    const prev = JSON.parse(fs.readFileSync(출력, 'utf8'));
    if (prev.규격 === 캐시규격) for (const c of prev.차량 || []) if (c.id != null) 캐시.set(c.id, c);
  } catch {}
  for (const [탭, cs] of Object.entries(버킷)) {
    const { total, rows } = await pullAll(cs);
    const 값 = rows[0]?.carSource || cs;
    if (!조용) process.stdout.write(`  ${탭} (${cs} → ${값}): 목록 ${rows.length}/${total} · 상세…`);
    const details = await mapPool(rows, async (r) => {
      const c = 캐시.get(r.id);
      if (!풀 && c && c.상세시각 && (지금 - c.상세시각) < 신선) return { cached: c };
      const d = await view(r.id).catch(() => null);
      const a = await viewAgent(r.id).catch(() => null); // carSourceUrl(원본 상세페이지)
      const sourceUrlRaw = /lotterentacar/.test(String(a?.carSourceUrl || '')) ? a.carSourceUrl : null;
      let url = sourceUrlRaw;
      let spec = url ? await lotteSpec(url).catch(() => null) : null;
      let matchType = '원천상세URL';
      // URL은 carId만 같다고 믿지 않는다. 상세 원문의 번호판이 현재 손오공 차량번호와 같아야 한다.
      if (!spec || normalizePlate(spec.__plateNumber) !== normalizePlate(r.carNumber)) {
        const match = await findTcarSaleByPlate(r.carNumber).catch(() => null);
        if (match) {
          url = match.url;
          spec = await lotteSpec(url).catch(() => null);
          matchType = '차량번호';
        } else {
          url = null;
          spec = null;
        }
      }
      // 재검색 결과도 번호판이 정확히 같을 때만 옵션·링크를 채택한다.
      if (spec && normalizePlate(spec.__plateNumber) !== normalizePlate(r.carNumber)) { url = null; spec = null; }
      if (d) d.__sourceUrlRaw = sourceUrlRaw;
      if (d && url && spec) {
        d.carSourceUrl = url;
        d.__lotte = spec; // T카 정제값 + jsonData.paidOptList 원문
        d.__tcarOptionUrl = url;
        d.__tcarMatchType = matchType;
      }
      return { d };
    }, 8);
    let 신규 = 0, 재사용 = 0;
    rows.forEach((r, i) => {
      const x = details[i];
      if (x?.cached) {
        재사용 += 1;
        const rec = { ...x.cached, 버킷: 값, 원천버킷: cs };
        // 리스트에서 오는 실시간 변동값만 갱신(계약이 실시간이므로)
        rec.노출 = r.webVisibility; rec.계약중 = r.hasActiveContract === true; rec.계약가능 = r.contractAvailable;
        rec.주행거리 = r.mileage == null ? null : Number(r.mileage); rec.차번 = r.carNumber; rec.차명 = r.carName;
        차량.push(rec);
      } else {
        if (x?.d) 신규 += 1;
        const rec = 정규화(r, x?.d, 값, cs);
        rec.상세시각 = 지금;
        차량.push(rec);
      }
    });
    집계[값] = { 탭, carSource: cs, total, fetched: rows.length, 상세신규: 신규, 캐시재사용: 재사용 };
    if (!조용) console.log(` 완료(신규상세 ${신규}·캐시 ${재사용})`);
  }

  const out = {
    갱신: new Date(Date.now() + 9 * 36e5).toISOString().slice(0, 19).replace('T', ' '),
    출처: 'sokrc.com /api/product/homepage/{list,view}',
    규격: 캐시규격,
    집계: { ...집계, 계: 차량.length },
    차량,
  };
  fs.writeFileSync(출력, JSON.stringify(out, null, 2));

  if (!조용) {
    console.log(`\n✅ 총 ${차량.length}대 → ${출력}`);
    console.log(`   토큰 남은 약 ${남은시간h().toFixed(1)}h`);
    const 기본옵션있음 = 차량.filter((c) => c.옵션).length;
    const 유료옵션있음 = 차량.filter((c) => c.유료옵션).length;
    const 사진있음 = 차량.filter((c) => c.사진들?.length).length;
    const 가격있음 = 차량.filter((c) => c.차량가격).length;
    console.log(`   기본옵션(미사용) ${기본옵션있음} · 티카 유료옵션 ${유료옵션있음} · 사진 ${사진있음} · 차량가격 ${가격있음}`);
    console.log('\n   샘플:');
    for (const c of 차량.slice(0, 2)) {
      console.log(`   - ${c.차번} ${c.차명} | ${N(c.차량가격)}원 | 사진 ${c.사진들?.length || 0}장 | 유료옵션 ${c.유료옵션 ? c.유료옵션.slice(0, 40) + '…' : '없음/미확인'}`);
    }
  }
}

main().catch((e) => { console.error('실패:', e.message); process.exit(1); });
