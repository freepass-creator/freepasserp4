import { NextResponse } from 'next/server';
import type { EntityRecord } from '@/lib/intake/entities';
import { displayNumber, newId } from '@/lib/domain/ids';
import { canIssueContract } from '@/lib/domain/policy-tier';
import { policyUsableBy } from '@/lib/domain/policy-access';
import {
  contractDriverAgeOptions,
  contractMileageOptions,
  contractRentForTerms,
  contractVehicleSnapshot,
  isContractAvailableVehicle,
  productContractKind,
} from '@/lib/domain/esign-vehicle-selection';
import { isStockedProduct } from '@/lib/domain/product';
import {
  contractKindFor,
  insuranceSideFromPolicy,
  isEsignTemplateAllowed,
  standardTemplateSelectionError,
  templateForKindAndInsurance,
} from '@/lib/domain/esign-templates';
import { depositInstallmentOptions } from '@/lib/domain/esign-center';
import {
  canonicalFreepassDirectManualTerms,
  canonicalFreepassDirectManualTermsDraft,
} from '@/lib/domain/freepass-direct-manual-terms';
import { firebaseAdminDatabase, verifyActiveBearer } from '@/lib/server/firebase-admin';
import {
  canManageFreepassEsign,
  freepassDirectSealMatchesContract,
  freepassEsignEventUpdates,
  loadFreepassDirectSource,
  readFreepassDirectContractSeal,
  resolveFreepassSettlementRateBasis,
  sha256,
  validContractCode,
  type EsignRecord,
  type FreepassDirectContractSeal,
} from '@/lib/server/freepass-esign';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

const PRIVATE_HEADERS = {
  'Cache-Control': 'private, no-store',
  Vary: 'Authorization',
  'X-Content-Type-Options': 'nosniff',
  'X-Robots-Tag': 'noindex, nofollow, noarchive',
};
const S = (value: unknown) => String(value ?? '').trim();

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: PRIVATE_HEADERS });
}

class CreateInputError extends Error {}

function requiredText(value: unknown, label: string, max = 120): string {
  const text = S(value);
  if (!text) throw new CreateInputError(`${label}을(를) 확인해 주세요.`);
  if (text.length > max || /[\u0000-\u001f\u007f]/.test(text)) throw new CreateInputError(`${label} 형식이 올바르지 않습니다.`);
  return text;
}

function optionalText(value: unknown, label: string, max = 300, multiline = false): string {
  const text = String(value ?? '').replace(/\r\n?/g, '\n').trim();
  if (!text) return '';
  if (text.length > max || /\u0000|\u007f/.test(text) || (!multiline && /[\n\t]/.test(text))) {
    throw new CreateInputError(`${label} 형식이 올바르지 않습니다.`);
  }
  return text;
}

function dateOnly(value: unknown): string {
  const date = requiredText(value, '계약일', 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new CreateInputError('계약일은 YYYY-MM-DD 형식으로 입력해 주세요.');
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new CreateInputError('계약일이 실제 달력 날짜인지 확인해 주세요.');
  }
  return date;
}

function integer(value: unknown, label: string, min: number, max: number): number {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new CreateInputError(`${label}을(를) 확인해 주세요.`);
  }
  return number;
}

function won(value: unknown, label: string, required = false): number | null {
  const raw = S(value);
  if (!raw) {
    if (required) throw new CreateInputError(`${label}을(를) 입력해 주세요.`);
    return null;
  }
  if (!/^\d[\d,]*$/.test(raw)) throw new CreateInputError(`${label}은 숫자로 입력해 주세요.`);
  const amount = Number(raw.replace(/,/g, ''));
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 1_000_000_000) {
    throw new CreateInputError(`${label} 금액을 확인해 주세요.`);
  }
  return amount;
}

function requestId(value: unknown): string {
  const id = requiredText(value, '요청 식별값', 100);
  if (!/^[A-Za-z0-9_-]{12,100}$/.test(id)) throw new CreateInputError('요청 식별값 형식이 올바르지 않습니다.');
  return id;
}

/** Firebase RTDB path segment은 계약번호와 같은 금지문자를 절대 받을 수 없다. */
function rtdbKey(value: unknown, label: string): string {
  const key = requiredText(value, label, 100);
  if (/[.#$\[\]/\u0000-\u001f\u007f]/.test(key)) throw new CreateInputError(`${label} 식별값 형식이 올바르지 않습니다.`);
  return key;
}

function clientBody(value: unknown): EsignRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CreateInputError('요청 형식이 올바르지 않습니다.');
  return value as EsignRecord;
}

function forbiddenInput(body: EsignRecord) {
  const forbidden = [
    'providerCompanyCode', 'productType', 'rentAmount', 'depositAmount', 'mileageSurcharge', 'ageSurcharge',
    'standardTemplateId', 'contractKind', 'templateFields', 'contractDraft', 'contract_code', 'agent_uid',
    'signStatus', 'sign_status', 'customerName', 'customerPhone', 'customerAddress', 'insurerName',
    'vehicleName', 'carNumber', 'modelYear', 'fuel', 'feeRate', 'payoutRate',
  ];
  const key = forbidden.find((candidate) => Object.hasOwn(body, candidate));
  if (key) throw new CreateInputError('계약서 생성 요청에는 차량·금액·보험·당사자 기준값을 직접 넣을 수 없습니다.');
}

function manualTerms(body: EsignRecord, depositInstallment: string, specialTerms: string): EsignRecord {
  const terms: EsignRecord = {
    deposit_installment: depositInstallment,
    special_terms_choice: S(body.specialTermsChoice),
    special_terms: specialTerms || '없음',
  };
  const driverScope = optionalText(body.driverScope, '운전자 범위', 120);
  const maintenanceProduct = optionalText(body.maintenanceProduct, '정비상품', 120);
  if (driverScope) terms.driver_scope = driverScope;
  if (maintenanceProduct) terms.maintenance_product = maintenanceProduct;
  return terms;
}

/** 서버가 만든 직접계약만 이 node에 seal을 갖는다. client create/legacy unsealed record는 issue에서 닫힌다. */
export async function POST(request: Request) {
  let actor;
  try { actor = await verifyActiveBearer(request); }
  catch { return json({ error: '계약서 생성 서버 인증을 사용할 수 없습니다.' }, 503); }
  if (!actor) return json({ error: '로그인이 필요합니다.' }, 401);
  if (!canManageFreepassEsign(actor)) return json({ error: '전자계약은 프리패스 관리자·영업 담당자만 만들 수 있습니다.' }, 403);

  let body: EsignRecord;
  try { body = clientBody(await request.json()); }
  catch (error) { return json({ error: error instanceof Error ? error.message : '요청 형식이 올바르지 않습니다.' }, 400); }

  try {
    forbiddenInput(body);
    const id = requestId(body.requestId);
    const productCode = rtdbKey(body.productCode, '차량');
    const policyCode = rtdbKey(body.policyCode, '계약정책');
    const contractDate = dateOnly(body.contractDate);
    const rentMonths = integer(body.rentMonths, '대여기간', 1, 120);
    const annualMileage = requiredText(body.annualMileage, '약정주행거리', 100);
    const priceVariantKey = optionalText(body.priceVariantKey, '가격근거', 100);
    const driverAge = integer(body.driverAge, '운전자 연령', 21, 80);
    const maturity = S(body.maturity);
    if (maturity !== '반납형' && maturity !== '인수형') throw new CreateInputError('만기 조건을 확인해 주세요.');
    const paymentTiming = S(body.paymentTiming);
    if (paymentTiming !== '선불' && paymentTiming !== '후불') throw new CreateInputError('대여료 납부 조건을 선택해 주세요.');
    const specialTermsChoice = S(body.specialTermsChoice);
    if (specialTermsChoice !== '없음' && specialTermsChoice !== '있음') throw new CreateInputError('특약사항 없음 또는 있음 여부를 확인해 주세요.');
    const specialTerms = specialTermsChoice === '있음'
      ? optionalText(body.specialTerms, '특약사항', 2_000, true)
      : '';
    if (specialTermsChoice === '있음' && !specialTerms) throw new CreateInputError('특약이 있으면 내용을 입력해 주세요.');

    const depositInstallment = S(body.depositInstallment);
    const buyoutPrice = won(body.buyoutPrice, '만기 인수가');
    const terms = manualTerms(body, depositInstallment, specialTerms);
    if (buyoutPrice != null) terms.buyback_price = String(buyoutPrice);
    const canonicalTerms = canonicalFreepassDirectManualTerms(terms);
    const canonicalDraft = canonicalFreepassDirectManualTermsDraft(canonicalTerms);
    if (!canonicalTerms || !canonicalDraft) throw new CreateInputError('계약서 입력값을 동결하지 못했습니다. 다시 작성해 주세요.');
    const requestHash = sha256(JSON.stringify({
      actorUid: actor.uid, productCode, policyCode, contractDate, rentMonths, annualMileage, priceVariantKey,
      driverAge, maturity, depositInstallment, paymentTiming, specialTermsChoice, specialTerms, buyoutPrice,
      driverScope: terms.driver_scope || '', maintenanceProduct: terms.maintenance_product || '',
    }));
    const db = firebaseAdminDatabase();
    const now = Date.now();
    const requestRef = db.ref(`v4/esign_create_requests/${actor.uid}/${id}`);
    // 요청 node는 계약번호를 한 번만 배정한다. 실제 정본은 아래 seal transaction이므로
    // 응답 유실·재시도는 기존 seal을 재사용할 뿐 계약 기준값을 다시 계산해 덮지 못한다.
    const allocation = await requestRef.transaction((current) => {
      const row = current && typeof current === 'object' && !Array.isArray(current) ? current as EsignRecord : null;
      if (!row) return {
        status: 'preparing', requestHash, contractCode: newId('contract'), createdAt: now, updatedAt: now,
      };
      if (S(row.requestHash) !== requestHash) return;
    }, undefined, false);
    const claimed = allocation.snapshot.val() as EsignRecord | null;
    if (S(claimed?.requestHash) !== requestHash) throw new CreateInputError('같은 요청 식별값이 다른 계약 생성에 사용되었습니다. 다시 시도해 주세요.');
    const contractCode = validContractCode(claimed?.contractCode);
    if (!contractCode) throw new CreateInputError('계약 생성 식별값을 만들지 못했습니다. 다시 시도해 주세요.');
    const contractRef = db.ref(`v4/contracts/${contractCode}`);
    const sealRef = db.ref(`v4/esign_contract_seals/${contractCode}`);
    const [storedContract, storedSeal] = await Promise.all([contractRef.get(), sealRef.get()]);
    const sealedFromStore = storedSeal.exists() ? readFreepassDirectContractSeal(storedSeal.val()) : null;
    if (storedSeal.exists() && (!sealedFromStore
      || sealedFromStore.contractCode !== contractCode
      || sealedFromStore.createdByUid !== actor.uid
      || sealedFromStore.requestHash !== requestHash)) {
      throw new CreateInputError('같은 생성 요청의 계약 기준값이 일치하지 않습니다. 관리자 확인이 필요합니다.');
    }
    if (storedContract.exists()) {
      const current = storedContract.val() as EsignRecord | null;
      if (!sealedFromStore || !current || !freepassDirectSealMatchesContract(current, sealedFromStore.contract)) {
        throw new CreateInputError('기존 계약과 서버 기준값이 일치하지 않습니다. 관리자 확인이 필요합니다.');
      }
      await requestRef.update({ status: 'created', completedAt: Date.now(), updatedAt: Date.now() });
      return json({ ok: true, reused: true, contractCode });
    }
    if (S(claimed?.status) === 'created' && !sealedFromStore) {
      throw new CreateInputError('완료로 표시된 생성 요청의 계약 기준값이 없습니다. 관리자 확인이 필요합니다.');
    }

    let sealed = sealedFromStore;
    if (!sealed) {
      const source = await loadFreepassDirectSource(productCode, policyCode);
      const product = source.product as EntityRecord | null;
      const policy = source.policy as EntityRecord | null;
      const partner = source.partner as EntityRecord | null;
      if (!product || !policy || !partner) throw new CreateInputError('차량·정책·공급사 기준정보를 다시 찾지 못했습니다. 화면을 새로고침해 주세요.');
      const providerCode = S(product.provider_company_code);
      if (!providerCode || !policyUsableBy(policy, providerCode)) throw new CreateInputError('선택한 공급사의 계약정책이 아닙니다.');
      if (!isStockedProduct(product) || !isContractAvailableVehicle(product)) throw new CreateInputError('선택한 차량은 더 이상 계약 가능한 재고가 아닙니다.');
      const policyGate = canIssueContract(policy, partner);
      if (!policyGate.ok) {
        const missing = policyGate.missing.map((field) => field.label).join(' · ');
        throw new CreateInputError(missing ? `계약정책에 필요한 값이 없습니다: ${missing}` : policyGate.reason);
      }

      const template = templateForKindAndInsurance(productContractKind(product), insuranceSideFromPolicy(policy));
      const kind = contractKindFor(template, maturity);
      const templateError = standardTemplateSelectionError(template, kind, policy);
      if (templateError) throw new CreateInputError(templateError);
      if (!isEsignTemplateAllowed(process.env.VERCEL_ENV, template.id)) {
        throw new CreateInputError('선택한 표준계약서는 운영 최종 승인 전이라 생성할 수 없습니다.');
      }
      if (kind.buyoutPriceRequired && buyoutPrice == null) throw new CreateInputError('만기 인수가를 입력해 주세요.');

      const mileage = contractMileageOptions(product, rentMonths, policy)
        .find((option) => option.label === annualMileage && option.priceVariantKey === priceVariantKey);
      const age = contractDriverAgeOptions(policy).find((option) => option.age === driverAge);
      if (!mileage || !age) throw new CreateInputError('기간에 맞는 약정주행거리 또는 운전자 연령을 다시 선택해 주세요.');
      const price = contractRentForTerms(product, rentMonths, policy, driverAge, mileage);
      if (!price) throw new CreateInputError('선택한 기간의 계약 금액을 계산하지 못했습니다.');
      const depositChoices = depositInstallmentOptions(policy, price.deposit);
      if (!depositChoices.includes(depositInstallment)) throw new CreateInputError('보증금 납부 방식을 다시 선택해 주세요.');

      const userProfile = (await db.ref(`users/${actor.uid}`).get()).val() as EsignRecord | null;
      const agentChannelCode = S(actor.agentChannelCode || userProfile?.agent_channel_code || actor.uid);
      if (!agentChannelCode) throw new CreateInputError('담당 영업 채널을 확인할 수 없습니다.');
      const settlementRateBasis = await resolveFreepassSettlementRateBasis({
        db,
        contract: { agent_uid: actor.uid, provider_company_code: providerCode },
        product,
      });
      const createdAt = Number(claimed?.createdAt) || now;
      const vehicle = contractVehicleSnapshot(product);
      const contract: EsignRecord = {
        contract_code: contractCode,
        contract_number: displayNumber('contract', contractCode, contractDate),
        contract_status: '계약요청',
        contract_date: contractDate,
        created_at: createdAt,
        contract_origin: '계약서직접등록',
        contract_source: 'direct',
        product_code: productCode,
        product_type_snapshot: settlementRateBasis.productType,
        policy_code: policyCode,
        standard_template_id: template.id,
        contract_kind: kind.key,
        esign_contract_kind: kind.key,
        esign_maturity: kind.maturity,
        esign_insurance_side: template.insuranceSide,
        car_number_snapshot: vehicle.carNumber,
        vehicle_name_snapshot: vehicle.vehicleName,
        year_snapshot: vehicle.modelYear,
        fuel_type_snapshot: vehicle.fuel,
        rent_month_snapshot: rentMonths,
        rent_amount_snapshot: price.rent,
        deposit_amount_snapshot: price.deposit,
        deposit_payment_type: depositInstallment,
        payment_timing_snapshot: paymentTiming,
        driver_age_snapshot: age.label,
        annual_mileage_snapshot: mileage.label,
        price_variant_snapshot: mileage.priceVariantKey,
        mileage_surcharge_snapshot: price.mileageSurcharge,
        age_surcharge_snapshot: price.ageSurcharge,
        pricing_snapshot_version: 'v1',
        special_terms_choice_snapshot: specialTermsChoice,
        special_terms_snapshot: specialTerms || '없음',
        ...(buyoutPrice != null ? { buyout_price: buyoutPrice } : {}),
        ...(terms.driver_scope ? { driver_scope: terms.driver_scope } : {}),
        contract_draft: canonicalDraft,
        agent_uid: actor.uid,
        agent_code: S(userProfile?.user_code || actor.uid),
        agent_name: S(userProfile?.name || userProfile?.agent_name || '담당 영업자'),
        agent_channel_code: agentChannelCode,
        provider_company_code: providerCode,
        sign_status: '미발송',
        is_draft: '예',
        settlement_rate_status: settlementRateBasis.status,
      };
      const proposedSeal: FreepassDirectContractSeal = {
        version: 'v1', contractCode, createdAt, createdByUid: actor.uid, requestHash,
        contract, product: source.product!, policy: source.policy!, partner: source.partner!,
        templateId: template.id, contractKind: kind.key, manualTerms: canonicalTerms, settlementRateBasis,
      };
      const sealClaim = await sealRef.transaction((current) => (current == null ? proposedSeal : undefined), undefined, false);
      sealed = readFreepassDirectContractSeal(sealClaim.snapshot.val());
      if (!sealed || sealed.contractCode !== contractCode || sealed.createdByUid !== actor.uid || sealed.requestHash !== requestHash) {
        throw new CreateInputError('동시 생성된 계약 기준값이 일치하지 않습니다. 관리자 확인이 필요합니다.');
      }
    }

    // seal은 먼저 한 번만 기록하고 공개 projection은 그 값으로만 생성한다. 응답이 유실돼도
    // 이후 요청은 동일 seal에서 contract를 복구하므로 값·요율·작성일을 다시 덮어쓰지 않는다.
    const contractClaim = await contractRef.transaction((current) => (current == null ? sealed.contract : undefined), undefined, false);
    const persisted = contractClaim.snapshot.val() as EsignRecord | null;
    if (!persisted || !freepassDirectSealMatchesContract(persisted, sealed.contract)) {
      throw new CreateInputError('계약 공개 정보와 서버 기준값이 일치하지 않습니다. 관리자 확인이 필요합니다.');
    }
    if (contractClaim.committed) {
      await db.ref('v4').update(freepassEsignEventUpdates(contractCode, 'direct_created', { actorUid: actor.uid, sealed: true }));
    }
    await requestRef.transaction((current) => {
      const row = current && typeof current === 'object' && !Array.isArray(current) ? current as EsignRecord : null;
      if (!row || S(row.requestHash) !== requestHash || validContractCode(row.contractCode) !== contractCode) return;
      return { ...row, status: 'created', completedAt: Date.now(), updatedAt: Date.now() };
    }, undefined, false);
    return json({ ok: true, reused: !contractClaim.committed, contractCode });
  } catch (error) {
    if (error instanceof CreateInputError) return json({ error: error.message }, 409);
    console.error('[freepass-esign] direct contract creation failed', error instanceof Error ? error.message : 'unknown');
    return json({ error: '계약서를 안전하게 만들지 못했습니다. 잠시 후 다시 시도해 주세요.' }, 503);
  }
}
