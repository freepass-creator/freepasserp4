# Claude 구현 메모 — 프리패스 전자계약 발송센터

> 작성일: 2026-08-10  
> 근거: 사용자가 제공한 `프리패스 전자계약 발송센터 설계서 v0.1`과 이후 대화에서 확정한 우선순위  
> 목적: Claude가 설계·위험영역 게이트를 잡을 때 현재 코드와 사용자 결정을 다시 추측하지 않도록 한다.

## 1. 사용자 결정 — 이 문서의 최우선 기준

1. 착한거래 화면/API 연동을 전자계약의 필수조건으로 두지 않는다.
2. 프리패스 자체 전자계약 발송센터로 간다.
3. ERP 계약을 먼저 만들어야 전자계약을 보낼 수 있는 구조는 금지한다.
4. 계약 생성 입구는 세 개다.
   - 기존 Excel 계약서 불러오기 — 최종 UX의 Primary Action
   - 직접 계약 작성
   - 기존 ERP 계약 불러오기
5. 세 입구는 모두 동일한 `Contract Atom → 검증 → Contract Snapshot → 발송` 파이프라인으로 합류한다.
6. 업체별 고정값은 한 번만 저장하고, 직원은 계약마다 변경되는 값만 입력한다.
7. 외부 전자계약 서비스가 없어도 프리패스 자체 링크 발급·모바일 확인·동의·서명·PDF 보관이 가능해야 한다.
8. 차량 인수증과 CMS 신청은 본계약에서 분리한다.

## 2. 가장 중요한 개념 분리

다음 세 가지를 하나의 `template`로 합치지 않는다.

| 구분 | 역할 | 예시 |
|---|---|---|
| Excel 입력 Adapter | 셀을 Contract Atom으로 변환 | 손오공 개인 v1의 `GB3 → customer.name` |
| 출력 계약서 Template | 모바일 확인·A4/PDF 표현 | 표준 렌트, 구독 보험포함, 구독 보험별도 |
| 약관/정책 Version | 계약 당시 법률·업무 규칙을 동결 | `SOGONG_STANDARD / 1.3` |

손오공 Excel은 입력 형식일 뿐 출력 계약서나 약관 정본이 아니다.

## 3. 고정값과 변경값

### 3.1 업체별 고정값 — `SupplierContractProfile`

업체 선택 시 자동 적용하며 업체 설정에서 명시적으로 저장한다.

- 상호·대표자·사업자등록번호·주소·대표번호
- 입금은행·계좌번호·예금주
- 기본 운전자 연령·주행거리
- 보험 한도·면책금
- 정비·대차·긴급출동 기본조건
- 계약 장소·결제주기 등 반복 문구
- 출력 계약서 기준판
- 약관 ID·약관 버전

업체 고정값을 수정해도 이미 발송한 Snapshot은 절대 바뀌면 안 된다.

### 3.2 계약별 변경값 — `ContractDraft.atoms`

- 고객 정보
- 차량·세부트림·연식·유종·차량번호
- 계약기간·월 대여료·보증금
- 약정주행거리·초과주행 요율
- 인수/반납·만기인수가
- 운전자 범위·추가운전자
- 건별 특약·예외 승인

Excel Import와 직접 작성은 이 동일한 Atom을 만든다. UI 필드명과 Excel 셀 주소가 저장 스키마가 되면 안 된다.

### 3.3 조립 및 동결 순서

```text
표준계약서/약관 기준판
  + 발송 시점의 업체 고정값 Snapshot
  + Excel 또는 직접 입력 Contract Atom
  + 관리자가 명시적으로 확인한 건별 수정값
  + 최종값에서 다시 계산한 파생값
  = 발송용 Contract Snapshot (이후 불변)
```

고정값 변경 버튼과 이번 계약만 수정하는 버튼을 분리한다. 계약에서 값을 수정했다고 업체 기본값이 같이 바뀌면 안 된다.

## 4. 권장 데이터 경계

정확한 노드명은 Claude가 기존 v4 구조와 Rules 후보를 검토해 확정하되 책임은 아래처럼 분리한다.

```ts
type SupplierContractProfile = {
  supplierId: string;
  fixedAtoms: Record<string, unknown>;
  outputTemplateIds: string[];
  termsId: string;
  termsVersion: string;
  updatedAt: number;
};

type ExcelTemplateProfile = {
  templateId: string;
  supplierId: string;
  customerType: '개인' | '개인사업자' | '법인';
  adapterId: string;
  fingerprintVersion: string;
  requiredAtoms: string[];
};

type ContractDraft = {
  source: 'excel' | 'direct' | 'erp';
  sourceTemplateId?: string;
  supplierId: string;
  atoms: Record<string, unknown>;
  validation: { pass: string[]; warning: string[]; block: string[] };
};

type ContractSnapshot = {
  contractCode: string;
  revision: number;
  supplier: Record<string, unknown>;
  customer: Record<string, unknown>;
  vehicle: Record<string, unknown>;
  rentTerms: Record<string, unknown>;
  driverTerms: Record<string, unknown>;
  insuranceTerms: Record<string, unknown>;
  maintenanceTerms: Record<string, unknown>;
  specialTerms: unknown[];
  terms: { id: string; version: string; contentHash: string };
  audit: { createdAt: number; sentAt?: number; openedAt?: number; signedAt?: number };
};
```

Snapshot을 만든 뒤 원 계약이나 업체 설정이 바뀌어도 자동 갱신하지 않는다. 변경 발송은 `R1`, `R2` Revision을 새로 만든다.

## 5. `/esign` 화면 목표

기존 4패널 전체를 첫 화면에 강제로 노출하지 않는다. 첫 화면은 업무 중심 발송센터다.

```text
전자계약 발송센터

[ + 엑셀 계약서 불러오기 ]  // Primary
[ + 직접 계약 작성 ]
[ ERP 계약 불러오기 ]

발송대기 | 서명중 | 완료 | 확인필요
```

목록 한 행은 고객·차량·렌터카사·월대여료·기간·업무상태만 보여준다. 상세 데이터·발송·진행 검토는 행을 선택한 다음 연다.

기술 구현 순서는 직접 작성 E2E를 먼저 완성해 공통 파이프라인을 검증해도 되지만, 최종 사용자 화면의 Primary Action은 Excel 불러오기다.

## 6. 현재 코드에서 재사용할 것

갈아엎지 말고 아래 코드를 공통 파이프라인의 재료로 사용한다.

| 현재 코드 | 재사용 목적 |
|---|---|
| `app/esign/page.tsx` | 현 계약서관리 진입점. 발송센터 shell로 재구성 |
| `lib/domain/esign-field-map.ts` | 출력 계약서 field ↔ Contract Atom 매핑 |
| `lib/domain/esign-template-fields.ts` | 계약·정책·파트너·직접입력 조립 |
| `lib/domain/esign-templates.ts` | 표준계약서 3종 |
| `lib/domain/esign-contract-kind.ts` | 인수/반납 조합 |
| `lib/domain/esign-consent-doc.ts` | 모바일 섹션·동의·약관 표시 |
| `lib/server/freepass-esign.ts` | 토큰·Snapshot·이벤트·서버 권한 기반 |
| `app/api/freepass-esign/**` | 프리패스 자체 발송·검토 API 기반 |
| `app/sign/[token]/page.tsx` | 고객 모바일 확인·동의·서명 |
| `lib/server/freepass-esign-document.ts` | Snapshot 기반 HTML/PDF 생성 |
| `public/contract-template/rental-contract.html` | 현재 A4 정본 후보. 본계약과 부속문서 분리가 필요 |
| `lib/domain/deal.ts`의 `createDirectEsignContract` | 직접 작성이 내부 Contract draft로 축적되는 경로 참고 |

기존 착한거래 발행분은 읽기 호환이 필요할 수 있지만 신규 발행의 기본 경로로 다시 세우지 않는다.

## 7. 현재 결합을 풀어야 하는 지점

1. `app/esign/page.tsx` 목록이 `hasTermFrozen()` 계약만 발송대상으로 삼는다.
2. 자체 발행 API가 `provider_agreement_done === 'yes'`를 요구한다.
3. 직접/Excel 사용자는 이 기존 ERP 단계를 거치지 않으므로, 값을 가짜로 `yes` 처리하면 안 된다.
4. 대신 `source=excel|direct` draft에 대해 공통 검증기가 BLOCK 0을 확인하고 Snapshot 발송을 허용해야 한다.
5. 내부 ERP Contract는 발송센터가 자동 생성하되 UI 선행조건으로 노출하지 않는다.

필수 BLOCK의 최소 기준은 사용자 설계서대로 렌터카사·고객명·연락처·월대여료·계약기간이다. 차량/보험/운전자 조건의 필수 범위는 계약 유형별 검증표로 분리한다.

## 8. Excel Adapter 구현 원칙

```text
adapters/
  sogong/
    personal-v1.ts
    business-v1.ts
```

- 셀 주소는 Adapter 내부에서만 관리한다.
- 렌터카사명만으로 양식을 판정하지 않는다. 시트명·고정 라벨·병합구조·버전 지문을 함께 본다.
- 자동 인식 실패 시 업체/계약형태를 고르게 하고 직접 작성으로 빠질 수 있게 한다.
- 첫 지원 범위는 실제 원본을 대조한 손오공 개인/개인사업자다. 샘플을 보지 않고 셀 주소를 추정하지 않는다.
- 원본 Excel에는 주민번호·면허·계좌 같은 민감정보가 있을 수 있다. 원본 보관은 기본값으로 삼지 말고, 보관이 필요하면 별도 동의·접근제어·보존기간을 먼저 설계한다.
- Adapter 결과도 서버 공통 검증을 다시 통과해야 한다. 브라우저 파싱 결과를 신뢰하지 않는다.

## 9. 본계약에서 분리할 것

현재 `rental-contract.html`에는 본계약 외 부속문서가 같이 들어 있다. 사용자 설계상 다음은 별도 흐름이다.

- 차량 인수증: 계약완료 후 출고/인수확인 단계
- CMS 자동이체: 계약완료 후 결제정보·별도 동의 단계
- 연대보증: 해당 계약에만 추가되는 조건부 별도 문서/단계

모바일 고객 화면에 A4를 축소해 보여주지 않는다. 모바일은 Atom 섹션으로 렌더하고 PDF는 같은 Snapshot에서 별도로 만든다.

## 10. 구현 순서 제안

### Slice 1 — 공통 파이프라인을 실제로 끝낸다

1. 발송센터 shell과 상태 4분류
2. 직접 계약 작성
3. 업체 선택 → 고정값 적용
4. 변경값 입력 → PASS/WARNING/BLOCK
5. Snapshot 생성·동결
6. 자체 랜덤 링크 발급
7. 모바일 확인·동의·서명
8. 완료 PDF 생성·보관

### Slice 2 — Excel을 Primary Action으로 연다

1. 업로드 UX
2. 손오공 개인/개인사업자 실제 양식 Adapter
3. 양식 자동 인식·수동 fallback
4. Import 결과 요약·확인필요 수정
5. Slice 1의 동일 Snapshot/발송으로 합류

### Slice 3 — ERP 계약 불러오기

- 기존 ERP 계약을 새로 복제하지 않고 같은 Snapshot builder의 입력으로 투영한다.

## 11. 완료조건과 검증

최소 E2E 완료조건:

```text
업체 선택
→ 고정값 자동 적용
→ 계약별 변경값 입력 또는 Excel Import
→ BLOCK/WARNING 확인
→ Snapshot 생성
→ 링크 복사
→ 비로그인 모바일 열람
→ 단계별 동의
→ 서명 제출
→ 관리자 확인
→ 동일 Snapshot 기반 PDF 생성
```

필수 적대 검증:

- 다른 토큰으로 계약 추측 불가
- 만료·취소·완료 토큰 재사용 불가
- 발송 후 원 ERP 계약/업체 고정값 수정이 Snapshot을 바꾸지 않음
- 수정 계약은 기존 Snapshot 덮어쓰기 없이 Revision 생성
- Excel Adapter가 잘못된 양식을 정상으로 오인하지 않음
- BLOCK가 하나라도 있으면 발송 불가
- 모바일 표시값과 PDF 핵심값 해시/필드 대조
- 원본 Excel 및 신분/서명 자료가 공개 RTDB/응답에 노출되지 않음

저장소 공통 게이트:

```text
npx tsc --noEmit
npm run check:fonts
npx tsx scripts/sim-freepass-esign.mts
# 새 Adapter·Snapshot·validation sim 추가
```

## 12. 위험영역과 금지사항

- `database.rules.json`은 사람 실데이터 검증 전 게시 금지.
- 쓰기는 `v4/` 오버레이만 사용하고 v3 운영 노드에 쓰지 않는다.
- 기존 RTDB v3+v4 이중읽기 tolerance를 throw로 바꾸지 않는다.
- 표준계약서/약관의 `sample-v1`을 법률 검토 완료본처럼 Production 발송하지 않는다.
- 기존 착한거래 호환 코드와 프리패스 자체 신규 발행 코드를 상태명만 보고 섞지 않는다.
- `PDF = 원본` 구조로 만들지 않는다. Snapshot이 원본이다.
- 외부 서비스 연동을 다시 화면 선행조건으로 만들지 않는다.
- 계약·발송·Snapshot·Rules는 위험영역이므로 구현 후 사람 또는 Claude 최종 게이트가 필요하다.

## 13. Claude에게 요청할 산출물

Claude는 이 메모와 사용자 원문 설계서를 기준으로 `PLAN.md`에 다음을 확정해야 한다.

1. 공통 Contract Atom/검증/상태 전이
2. SupplierContractProfile·TemplateProfile·Draft·Snapshot의 실제 저장 경계
3. 기존 자체 전자계약 엔진 재사용 범위와 제거할 결합
4. Slice 1~3의 파일별 구현 오더
5. 약관/출력 정본과 본계약·부속문서 분리 계획
6. 보안·개인정보·Revision·감사로그 게이트
7. 각 Slice의 자동 sim 및 사람 확인 완료조건

이 문서는 구현 완료 선언이 아니라, 사용자의 최신 결정과 현재 코드 사이의 인수인계 메모다.
