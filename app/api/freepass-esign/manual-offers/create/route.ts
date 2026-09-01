import { NextResponse } from 'next/server';
import { displayNumber, newId } from '@/lib/domain/ids';
import { approvedFreepassManualOffer } from '@/lib/domain/freepass-manual-offer';
import { isManualOfferTemplateAllowed, contractKindFor, findTemplate, standardTemplateSelectionError } from '@/lib/domain/esign-templates';
import { policyUsableBy } from '@/lib/domain/policy-access';
import { canIssueContract } from '@/lib/domain/policy-tier';
import { contractVehicleSnapshot, isContractAvailableVehicle, productMatchesTemplate } from '@/lib/domain/esign-vehicle-selection';
import { isStockedProduct, priceList } from '@/lib/domain/product';
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
  loadFreepassManualOfferSource,
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

const HEADERS = { 'Cache-Control': 'private, no-store', Vary: 'Authorization', 'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex, nofollow, noarchive' };
const S = (value: unknown) => String(value ?? '').trim();
const json = (body: Record<string, unknown>, status = 200) => NextResponse.json(body, { status, headers: HEADERS });
class InputError extends Error {}

function record(value: unknown): EsignRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new InputError('요청 형식이 올바르지 않습니다.');
  return value as EsignRecord;
}
function id(value: unknown, label: string) {
  const text = S(value);
  if (!/^[A-Za-z0-9_-]{3,100}$/.test(text)) throw new InputError(`${label} 형식이 올바르지 않습니다.`);
  return text;
}
function text(value: unknown, label: string, max = 120) {
  const result = S(value);
  if (!result || result.length > max || /[\u0000-\u001f\u007f]/.test(result)) throw new InputError(`${label}을(를) 확인해 주세요.`);
  return result;
}
function date(value: unknown) {
  const result = text(value, '계약일', 10);
  const parsed = new Date(`${result}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== result) throw new InputError('계약일은 YYYY-MM-DD 형식의 실제 날짜여야 합니다.');
  return result;
}
function canUseOffer(actor: NonNullable<Awaited<ReturnType<typeof verifyActiveBearer>>>, offer: ReturnType<typeof approvedFreepassManualOffer>) {
  if (!offer) return false;
  if (actor.rawRole === 'admin') return true;
  if ((actor.rawRole === 'provider' || actor.rawRole === 'provider_admin') && actor.companyCode === offer.providerCompanyCode) return true;
  return !!offer.agentChannelCode && actor.agentChannelCode === offer.agentChannelCode;
}

/**
 * 수기 실차와 ERP 재고 차량 모두 승인 오퍼의 정책·보험·서식만 사용한다. ERP 차량의
 * 기간별 금액은 브라우저가 아닌 v4/products 가격표에서 다시 읽어 seal에 복사한다.
 */
export async function POST(request: Request) {
  let actor;
  try { actor = await verifyActiveBearer(request); }
  catch { return json({ error: '계약서 생성 서버 인증을 사용할 수 없습니다.' }, 503); }
  if (!actor) return json({ error: '로그인이 필요합니다.' }, 401);
  // 링크 발행·검토 경계와 같은 역할만 새 수기 계약을 만들 수 있다. provider 역할을
  // 여기만 열면 이후 기존 issue/access 경로와 권한이 어긋나므로 fail-closed 한다.
  if (!canManageFreepassEsign(actor)) return json({ error: '전자계약 권한이 없습니다.' }, 403);
  try {
    const body = record(await request.json());
    const forbidden = ['providerCompanyCode', 'policyCode', 'standardTemplateId', 'rentAmount', 'depositAmount', 'annualMileage', 'maturity', 'insuranceSide'];
    if (forbidden.some((key) => Object.hasOwn(body, key))) throw new InputError('수기 계약에는 승인 오퍼 밖의 금액·정책·서식 값을 넣을 수 없습니다.');
    const requestId = id(body.requestId, '요청 식별값');
    const expectedTemplateId = id(body.expectedTemplateId, '계약서 양식');
    const contractDate = date(body.contractDate);
    const productCode = S(body.productCode);
    const rentMonths = productCode ? Number(body.rentMonths) : 0;
    if (productCode && !/^[A-Za-z0-9_-]{3,100}$/.test(productCode)) throw new InputError('차량 식별값 형식이 올바르지 않습니다.');
    if (productCode && (!Number.isInteger(rentMonths) || rentMonths < 1 || rentMonths > 120)) throw new InputError('계약 기간을 확인해 주세요.');
    if (productCode && ['carNumber', 'vehicleName', 'modelYear', 'fuel'].some((key) => Object.hasOwn(body, key))) {
      throw new InputError('ERP 차량 계약에는 차량 정보를 직접 넣을 수 없습니다.');
    }
    const carNumber = productCode ? '' : text(body.carNumber, '차량번호', 40);
    const vehicleName = productCode ? '' : text(body.vehicleName, '차종', 160);
    const modelYear = productCode ? '' : S(body.modelYear);
    const fuel = productCode ? '' : S(body.fuel);
    const db = firebaseAdminDatabase();
    const offersSnap = await db.ref('v4/esign_manual_offers').get();
    const rows = offersSnap.val() && typeof offersSnap.val() === 'object' ? offersSnap.val() as Record<string, unknown> : {};
    // 오퍼 ID는 직원에게 노출하지 않는다. 선택한 문서 양식과 현재 계정 범위로 정확히 하나일
    // 때만 서버가 정하고, 누락/중복은 관리자 설정 문제로 닫는다.
    const offers = Object.entries(rows)
      .map(([offerId, row]) => approvedFreepassManualOffer(offerId, row))
      .filter((offer): offer is NonNullable<typeof offer> => !!offer)
      .filter((offer) => offer.templateId === expectedTemplateId && canUseOffer(actor, offer));
    if (offers.length !== 1) throw new InputError(offers.length
      ? '선택한 계약서의 승인 계약조건이 여러 개입니다. 관리자에게 수기 계약조건을 하나로 설정해 달라고 요청하세요.'
      : '선택한 계약서의 승인 계약조건이 없습니다. 관리자 설정 후 다시 시도하세요.');
    const offer = offers[0]!;
    const manualOfferId = offer.id;
    if (!isManualOfferTemplateAllowed(process.env.VERCEL_ENV, offer.templateId)) throw new InputError('선택한 수기 계약서 양식은 운영 발행 승인이 없습니다.');
    // 픽업 확인서는 인도·상태 확인용 문서다. UI를 우회해 승인 오퍼를 넣어도 고객
    // 서명 세션을 만들면 안 된다.
    if (offer.templateId === 'sonogong-pickup-confirmation') throw new InputError('차량 픽업 확인서는 고객 서명 링크를 만들 수 없습니다.');

    const source = productCode
      ? await loadFreepassDirectSource(productCode, offer.policyCode)
      : await loadFreepassManualOfferSource(offer.providerCompanyCode, offer.policyCode);
    const policy = source.policy;
    const partner = source.partner;
    const product = productCode
      ? (source as Awaited<ReturnType<typeof loadFreepassDirectSource>>).product
      : null;
    if (!policy || !partner || !policyUsableBy(policy, offer.providerCompanyCode)) throw new InputError('수기 오퍼의 공급사·계약정책 기준을 확인할 수 없습니다.');
    const templateRow = findTemplate(offer.templateId);
    if (!templateRow || !productMatchesTemplate({ product_type: offer.productType } as never, templateRow)) throw new InputError('수기 오퍼의 차량 상품구분과 계약서 양식이 맞지 않습니다.');
    if (product) {
      if (S(product.provider_company_code) !== offer.providerCompanyCode) throw new InputError('선택한 차량과 계약서 기본조건의 공급사가 일치하지 않습니다.');
      if (!isStockedProduct(product) || !isContractAvailableVehicle(product)) throw new InputError('선택한 차량은 더 이상 계약 가능한 재고가 아닙니다.');
      if (!productMatchesTemplate(product as never, templateRow)) throw new InputError('선택한 차량 상품구분과 계약서 종류가 맞지 않습니다.');
    }
    const kind = contractKindFor(templateRow, offer.maturity);
    const templateError = standardTemplateSelectionError(templateRow, kind, policy);
    if (templateError) throw new InputError(templateError);
    const policyGate = canIssueContract(policy, partner);
    if (!policyGate.ok) throw new InputError(`계약정책에 필요한 값이 없습니다: ${policyGate.missing.map((field) => field.label).join(' · ')}`);
    const manualTerms = canonicalFreepassDirectManualTerms({
      deposit_installment: offer.depositInstallment,
      special_terms_choice: offer.specialTerms === '없음' ? '없음' : '있음',
      special_terms: offer.specialTerms,
      // 손오공 빠른계약은 기본 양식의 「만기 협의」 조항을 서버가만 정한다. 브라우저의
      // 인수/반납 선택값이나 가격은 이 경계로 들어오지 못한다.
      ...(templateRow.id.startsWith('sonogong-') && templateRow.id !== 'sonogong-pickup-confirmation' ? { buyback_option: '만기 협의' } : {}),
      ...(offer.buyoutPrice != null ? { buyback_price: String(offer.buyoutPrice) } : {}),
    });
    const contractDraft = canonicalFreepassDirectManualTermsDraft(manualTerms);
    if (!manualTerms || !contractDraft) throw new InputError('수기 오퍼 조건을 동결하지 못했습니다.');
    const productPrice = product ? priceList(product as never).find((price) => price.m === rentMonths) : null;
    if (product && (!productPrice || !Number.isFinite(productPrice.rent) || productPrice.rent <= 0 || !Number.isFinite(productPrice.deposit) || productPrice.deposit < 0)) {
      throw new InputError('선택한 기간의 차량 가격표를 확인할 수 없습니다.');
    }
    const productVehicle = product ? contractVehicleSnapshot(product as never) : null;
    const sealedCarNumber = productVehicle?.carNumber || carNumber;
    const sealedVehicleName = productVehicle?.vehicleName || vehicleName;
    const sealedModelYear = productVehicle?.modelYear || modelYear;
    const sealedFuel = productVehicle?.fuel || fuel;
    const sealedMonths = productPrice?.m || offer.rentMonths;
    const sealedRent = productPrice?.rent || offer.rentAmount;
    const sealedDeposit = productPrice?.deposit ?? offer.depositAmount;
    const sealedMileage = product ? (S(product.annual_mileage) || offer.annualMileage) : offer.annualMileage;
    const requestHash = sha256(JSON.stringify({ actorUid: actor.uid, manualOfferId, contractDate, productCode, rentMonths, carNumber: sealedCarNumber, vehicleName: sealedVehicleName, modelYear: sealedModelYear, fuel: sealedFuel }));
    const requestRef = db.ref(`v4/esign_create_requests/${actor.uid}/${requestId}`);
    const now = Date.now();
    const allocation = await requestRef.transaction((current) => {
      const row = current && typeof current === 'object' && !Array.isArray(current) ? current as EsignRecord : null;
      if (!row) return { status: 'preparing', requestHash, contractCode: newId('contract'), createdAt: now, updatedAt: now };
      if (S(row.requestHash) !== requestHash) return;
    }, undefined, false);
    const claimed = allocation.snapshot.val() as EsignRecord | null;
    const contractCode = validContractCode(claimed?.contractCode);
    if (S(claimed?.requestHash) !== requestHash || !contractCode) throw new InputError('같은 요청 식별값을 다른 계약에 사용할 수 없습니다.');
    const [contractSnap, sealSnap] = await Promise.all([db.ref(`v4/contracts/${contractCode}`).get(), db.ref(`v4/esign_contract_seals/${contractCode}`).get()]);
    const savedSeal = sealSnap.exists() ? readFreepassDirectContractSeal(sealSnap.val()) : null;
    if (contractSnap.exists()) {
      const savedContract = contractSnap.val() as EsignRecord;
      if (!savedSeal || savedSeal.createdByUid !== actor.uid || savedSeal.requestHash !== requestHash || !freepassDirectSealMatchesContract(savedContract, savedSeal.contract)) throw new InputError('기존 수기 계약 seal을 확인하지 못했습니다.');
      return json({ ok: true, reused: true, contractCode });
    }
    if (savedSeal) throw new InputError('수기 계약 seal이 이미 존재하지만 공개 계약을 확인할 수 없습니다. 관리자 확인이 필요합니다.');
    const user = (await db.ref(`users/${actor.uid}`).get()).val() as EsignRecord | null;
    const agentChannelCode = S(actor.agentChannelCode || user?.agent_channel_code || actor.uid);
    if (!agentChannelCode) throw new InputError('담당 영업 채널을 확인할 수 없습니다.');
    const sealedProduct: EsignRecord = product ? product as EsignRecord : { provider_company_code: offer.providerCompanyCode, product_type: offer.productType, car_number: sealedCarNumber, vehicle_name: sealedVehicleName, year: sealedModelYear, fuel_type: sealedFuel };
    const settlementRateBasis = await resolveFreepassSettlementRateBasis({ db, contract: { agent_uid: actor.uid, provider_company_code: offer.providerCompanyCode }, product: sealedProduct });
    const createdAt = Number(claimed?.createdAt) || now;
    const contract: EsignRecord = {
      contract_code: contractCode, contract_number: displayNumber('contract', contractCode, contractDate), contract_status: '계약요청', contract_date: contractDate, created_at: createdAt,
      contract_origin: product ? '전자계약상품오퍼' : '전자계약수기오퍼', contract_source: 'direct', manual_offer_id: manualOfferId,
      product_code: productCode, product_type_snapshot: settlementRateBasis.productType, policy_code: offer.policyCode,
      customer_type: offer.customerType, customer_type_snapshot: offer.customerType,
      standard_template_id: templateRow.id, contract_kind: kind.key, esign_contract_kind: kind.key, esign_maturity: kind.maturity, esign_insurance_side: templateRow.insuranceSide,
      car_number_snapshot: sealedCarNumber, vehicle_name_snapshot: sealedVehicleName, year_snapshot: sealedModelYear, fuel_type_snapshot: sealedFuel,
      rent_month_snapshot: sealedMonths, rent_amount_snapshot: sealedRent, deposit_amount_snapshot: sealedDeposit,
      deposit_payment_type: offer.depositInstallment, payment_timing_snapshot: offer.paymentTiming, driver_age_snapshot: offer.driverAge, annual_mileage_snapshot: sealedMileage,
      price_variant_snapshot: product ? `product:${productCode}:${sealedMonths}` : `manual-offer:${manualOfferId}`, mileage_surcharge_snapshot: 0, age_surcharge_snapshot: 0, pricing_snapshot_version: product ? 'product-offer-v1' : 'manual-offer-v1',
      special_terms_choice_snapshot: offer.specialTerms === '없음' ? '없음' : '있음', special_terms_snapshot: offer.specialTerms,
      ...(offer.buyoutPrice != null ? { buyout_price: offer.buyoutPrice } : {}), contract_draft: contractDraft,
      agent_uid: actor.uid, agent_code: S(user?.user_code || actor.uid), agent_name: S(user?.name || user?.agent_name || '담당 영업자'), agent_channel_code: agentChannelCode,
      provider_company_code: offer.providerCompanyCode, sign_status: '미발송', is_draft: '예', settlement_rate_status: settlementRateBasis.status,
    };
    const seal: FreepassDirectContractSeal = { version: 'v1', contractCode, createdAt, createdByUid: actor.uid, requestHash, contract, product: sealedProduct, policy, partner, templateId: templateRow.id, contractKind: kind.key, manualTerms, settlementRateBasis };
    const sealClaim = await db.ref(`v4/esign_contract_seals/${contractCode}`).transaction((current) => current == null ? seal : undefined, undefined, false);
    const frozen = readFreepassDirectContractSeal(sealClaim.snapshot.val());
    if (!frozen || frozen.createdByUid !== actor.uid || frozen.requestHash !== requestHash) throw new InputError('동시 생성된 수기 계약 기준값이 일치하지 않습니다.');
    const contractClaim = await db.ref(`v4/contracts/${contractCode}`).transaction((current) => current == null ? frozen.contract : undefined, undefined, false);
    if (!freepassDirectSealMatchesContract(contractClaim.snapshot.val() as EsignRecord, frozen.contract)) throw new InputError('수기 계약 공개값과 서버 seal이 일치하지 않습니다.');
    if (contractClaim.committed) await db.ref('v4').update(freepassEsignEventUpdates(contractCode, product ? 'product_offer_created' : 'manual_offer_created', { actorUid: actor.uid, manualOfferId, sealed: true }));
    await requestRef.update({ status: 'created', completedAt: Date.now(), updatedAt: Date.now() });
    return json({ ok: true, reused: !contractClaim.committed, contractCode });
  } catch (error) {
    if (error instanceof InputError) return json({ error: error.message }, 409);
    console.error('[freepass-esign] manual offer contract creation failed', error instanceof Error ? error.message : 'unknown');
    return json({ error: '수기 계약서를 안전하게 만들지 못했습니다. 잠시 후 다시 시도해 주세요.' }, 503);
  }
}
