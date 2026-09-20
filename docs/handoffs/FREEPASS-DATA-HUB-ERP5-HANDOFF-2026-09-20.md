# 프리패스 데이터 — GitHub Handoff

- official_name: **프리패스 데이터**
- technical_name: **ERP5 · Firebase/Firestore**
- aliases / historical_names: `ERP5 데이터 허브`, `프리패스 데이터 허브`, `ERP5 상품 SSOT`
- naming_decision: 사용자 공식 결정 — 화면·문서·대화의 프로젝트명은 `프리패스 데이터`; `ERP5 데이터 허브`는 기술 설명/과거 작업명으로만 사용
- firebase_project_id: `freepasserp5`
- current_owner_repo: `freepass-creator/freepasserp4`
- project_form: 화면 제품이 아닌 공통 데이터 기반 / SSOT
- observed_at: 2026-09-20T11:40:00Z
- naming_decision_recorded_at: 2026-09-20T11:50:00Z
- handoff_policy: decision + evidence revision + confirmed/unknown/conflict + next_start_here를 실제 소유 repo에 기록
- document_scope: 조사·판정·인계만 수행. 코드 수정, 배포, 실데이터 읽기/쓰기, 자격증명 확인은 수행하지 않음.

## 0. 명칭 결정

- 사용자 노출 공식 프로젝트명은 **프리패스 데이터**다.
- **ERP5 · Firebase/Firestore**는 기술 설명이다.
- **ERP5 데이터 허브**와 **프리패스 데이터 허브**는 과거 작업명·검색용 alias로만 유지한다.
- 저장소명, Firebase project ID(`freepasserp5`), 기존 파일명은 이번 명칭 결정만으로 변경하지 않는다.
- 이 채팅의 모든 후속 결과는 프리패스 프로젝트 내부 **프리패스 데이터** 범위로 GitHub handoff에 누적한다.

## 1. 고정 경계

프리패스 데이터는 상품·차량·정책·공급사 조건을 여러 제품에 공급하는 공통 데이터 기반이다.

다음 화면 제품과 동일한 프로젝트로 취급하지 않는다.

| 제품 | 책임 |
|---|---|
| 프리패스 어드민 | 관리자 UI와 접수·계약·정산 업무 처리 |
| 프리패스 세일즈 | CRM, 고객·통화·영업 진행 |
| 프리패스 견적기 | 상품 탐색과 견적 Domain/Engine/UX |
| 프리패스 데이터 | 공통 데이터 SSOT, schema, collection, index, rules, sync, freshness, backup/restore, consumer contract |

RTDB는 프리패스 데이터 전 범위에서 영구 폐기한다. RTDB fallback, adapter, listener, API 또는 mirror를 재활성화하지 않는다. 남아 있는 RTDB 코드는 신규 경로의 후보가 아니라 제거·격리 대상 레거시다.

## 2. 현재 판정 요약

| 항목 | 판정 | 근거 |
|---|---|---|
| 실제 Firebase 프로젝트 ID | **CONFIRMED** | server Firestore app과 production writer가 `freepasserp5`를 고정 |
| 별도 `freepasserp5` GitHub repo | **UNKNOWN / 없음으로 관측** | 연결된 GitHub에서 별도 repo 미발견 |
| 현재 소유 repo | **CONFIRMED** | writer, consumer, contracts, audit가 `freepasserp4`에 존재 |
| 상품 canonical owner | **CONFIRMED** | `freepasserp5/firestore/products` |
| production writer | **CONFIRMED** | `.github/workflows/erp5-ssot-refresh.yml` |
| fallback | **CONFIRMED: NONE** | Core source registry가 `fallback_policy.mode=NONE` |
| F01/F86/public catalog | **CONFIRMED consumer** | 고정 sales publish snapshot에서 파생 |
| ERP4 상품 API/public surface | **CONFIRMED consumer** | 서버가 ERP5를 직접 읽고 장애 시 503; ERP4/RTDB fallback 없음 |
| 차종마스터 canonical ownership | **CONFIRMED as policy** | ERP5 소유 원칙 문서 존재 |
| 차종마스터 현재 production physical writer/path | **UNKNOWN / HOLD** | versioned legacy publisher는 production writer가 아니라고 명시 |
| 계약·접수·정산의 ERP5 소유 | **NOT CONFIRMED / HOLD** | 현재 근거는 ERP4 업무 데이터로 분리 |
| ERP5 전용 Security Rules | **UNKNOWN / HOLD** | repo root Rules는 default Firebase project `freepasserp3` 배포 구도 |
| ERP5 전용 composite indexes | **UNKNOWN / HOLD** | canonical index manifest 미발견 |
| Firestore backup/restore | **UNKNOWN / HOLD** | export, retention, restore drill의 canonical runbook/receipt 미발견 |
| Admin direct consumer | **UNKNOWN / HOLD** | 운영 Product DB와 persistence adapter가 미검증 |
| Sales direct consumer | **UNKNOWN / HOLD** | CRM 정본은 별도 `welrixtable` Firestore; ERP5 product consumer 증거 없음 |
| Estimate direct consumer | **UNKNOWN / HOLD** | 견적 Domain/Provider SSOT는 확인되나 ERP5 adapter 연결 증거 없음 |
| native schedule cadence | **HOLD** | 최근 native success 1회는 있으나 안정적인 연속 정시성 증거 부족 |
| RTDB zero state | **CONFLICT / HOLD** | 레거시 RTDB config, scripts, imports가 repo에 남음 |

## 3. Confirmed architecture

```text
supplier sources
  -> parser / adapter / normalizer
  -> freepasserp5 Firestore canonical atoms
  -> fixed/versioned publish snapshot
  -> F01 / F86 / public catalog / ERP4 product API
```

역방향 게시를 금지한다.

- ERP4 Firestore, RTDB, local JSON, sales sheet, public catalog를 ERP5의 상위 원천으로 승격하지 않는다.
- consumer 장애 시 ERP4/RTDB/판매시트로 자동 fallback하지 않는다.
- canonical 수정이 필요하면 승인된 ERP5 write boundary를 통과해야 한다.
- `/inventory`는 ERP5 write API·권한·감사로그가 준비되기 전 read-only 반쪽 전환을 금지하고 HOLD한다.

## 4. Writer와 consumer

| 구분 | 주체 | 현재 계약 | 상태 |
|---|---|---|---|
| canonical writer | GitHub Actions in `freepasserp4` | OIDC, explicit project `freepasserp5`, pinned production engine | CONFIRMED |
| product import | `freepasserp5.product.refresh` | RAW_SNAPSHOT → PARSE → NORMALIZE → VALIDATE → IDENTITY_RESOLVE → COMMIT | SHADOW contract confirmed |
| publish export | `freepasserp5.sales-publish` | PROJECT → PRIVACY_FILTER → SERIALIZE → DELIVER | SHADOW contract confirmed |
| ERP4 server consumer | `GET /api/products` and catalog server helper | direct ERP5 Firestore read, cache, no data fallback | CONFIRMED |
| F01/F86 | fixed snapshot publication | same canonical snapshot per cycle | CONFIRMED |
| public/white-label catalog | ERP4 server surface | ERP5 direct read; server cache max 60s | CONFIRMED |
| Admin | independent app | canonical Product model only; production persistence absent | HOLD |
| Sales | independent CRM | `welrixtable` Firestore is CRM truth | ERP5 product link UNKNOWN |
| Estimate | independent estimator | quote domain/provider truth | ERP5 product link UNKNOWN |

## 5. Collections and schema status

### 5.1 Confirmed runtime read collections

The ERP4 server helper currently names these top-level ERP5 collections:

- `products`
- `policy`
- `partner`
- `user` — optional internal read path; public product API evidence only confirms products + partners use.

No document values or customer records were read during this audit.

### 5.2 Confirmed contracts

- canonical source: `freepasserp5/firestore/products`
- canonical owner: `freepasserp5`
- canonical writer: `.github/workflows/erp5-ssot-refresh.yml`
- stale behavior: `HOLD`
- fallback mode: `NONE`
- receipt required: true
- publication target: F01 / F86 / public catalog

### 5.3 Reference-only / non-production paths

The following paths are present in Rules or legacy publisher tooling, but must not be treated as the current production writer without new proof:

- `ssotState/products`
- `productMasterVersions/{versionId}/products/{productId}`
- `ssotState/vehicleMaster`
- `vehicleMasterVersions/{versionId}/entries/{entryId}`

The repository explicitly labels the product/vehicle versioned publisher scripts as migration/reference tools, not production writers.

### 5.4 Business data boundary

Current canonical documents separate ERP5 product atoms from ERP4 business data.

| Domain | Current owner judgment |
|---|---|
| product / price / deposit / stock / sale status | ERP5 canonical |
| vehicle master | ERP5 policy owner; current production physical path needs proof |
| application/intake | ERP4/Admin business workflow; ERP5 ownership not confirmed |
| contract | ERP4/Admin business workflow; ERP5 ownership not confirmed |
| settlement | ERP4/Admin business workflow; ERP5 ownership not confirmed |

Expanding ERP5 to applications, contracts, or settlements is an architecture decision, not an inferred current fact.

## 6. Security Rules and indexes

### Confirmed

- writer uses short-lived GitHub OIDC rather than a repository-stored service-account key.
- ERP4 server consumer initializes a dedicated Firebase Admin app and rejects a project ID other than `freepasserp5`.
- root `.firebaserc` default is `freepasserp3`, not `freepasserp5`.
- generic root Firebase deploy is intentionally not the ERP5 canonical writer deployment path.

### Unknown / HOLD

- canonical location and deployment owner for **ERP5-specific Firestore Rules**
- ERP5 rules deployment receipt and rollback procedure
- canonical **Firestore composite index** manifest
- index deployment owner, revision, and rollback proof
- consumer-specific service-account least-privilege matrix
- App Check/IAM enforcement proof for each consumer

The root `firestore.rules` contains product, SSOT version, vehicle version, contract, settlement, and audit paths, but it is not evidence that those Rules are deployed to `freepasserp5`.

## 7. Sync and freshness

### Confirmed

- production writer workflow: `.github/workflows/erp5-ssot-refresh.yml`
- scheduled window: Monday–Saturday, KST 09:17–19:17
- additional workflow-chain and heartbeat entry points exist.
- production engine remains pinned to `cf940df642edf315adbc6da2b4134fbad53da160`.
- downstream cache/polling contracts:
  - public catalog: server cache up to 60s, open list polling 45s
  - Finder: polling 30s plus focus/tab refresh
  - internal product detail: refresh 60s plus focus/tab refresh
- stale source behavior is HOLD, not fallback.

### Current HOLD

Latest documented native scheduled success:

- run: `35447185563`
- event: `schedule`
- conclusion: `success`
- created: 2026-09-19T13:55:32Z
- finished: 2026-09-19T14:05:39Z
- head: `e1f196ff93e4ecc2c570b58fa6296c2346062455`

This proves one resumed native delivery, not healthy cadence. Consecutive on-time native runs and end-to-end freshness receipts remain required.

## 8. Backup and restore

No canonical Firestore backup/restore policy was confirmed for `freepasserp5`.

Missing evidence:

- scheduled Firestore export target
- retention and immutability policy
- restore target isolation
- point-in-time recovery decision
- collection/document scope
- encryption/access owner
- restore rehearsal receipt
- RPO/RTO
- post-restore parity/freshness validation
- rollback of active snapshot/pointer

Versioned snapshots and publish receipts improve traceability but are not substitutes for an independently recoverable database backup.

Existing RTDB backup scripts are legacy evidence only and are prohibited from becoming ERP5 fallback or recovery mechanisms.

## 9. RTDB conflict register

The permanent RTDB retirement decision conflicts with repository residue:

- root `firebase.json` still includes Realtime Database configuration.
- package scripts still expose RTDB rules/backup/restore commands.
- RTDB backup, migration, parity and mirror tooling remains.
- product API still imports a helper from an RTDB-named module, even though the canonical product read is ERP5 Firestore.
- older AGENTS guidance preserves RTDB dual-read tolerance for ERP4 legacy screens.
- audit documents say mirror/RTDB paths are retired and non-canonical, but code residue is not zero.

Required interpretation:

1. None of these paths may be reactivated for Data Hub.
2. Existing references must be classified as delete, archive/reference, or ERP4-only temporary dependency.
3. Any removal affecting live ERP4 behavior requires a separate local Codex work packet, tests, approval and deployment plan.
4. A checker must eventually fail on new RTDB Data Hub imports, listeners, APIs, adapters, fallback or writer code.

## 10. Repository and registry conflicts

- The actual implementation owner is currently `freepasserp4`; no separate `freepasserp5` repo was found.
- AI Core registry has no independent 프리패스 데이터 capsule and still describes ERP5 as a “candidate pending source reconciliation”.
- Current ERP4 canonical documentation already declares `freepasserp5` the unique canonical owner.
- Therefore AI Core registry wording is stale relative to the owner repo and must be corrected in a separate documentation/registry packet.
- A separate repository should not be created until ownership, rules/index deployment and operating commands justify the split.

## 11. Source revisions

| Source | Revision / blob | Use |
|---|---|---|
| `freepass-creator/freepasserp4@main` | `8e4bcb7a484f1ae024f05297923be100d8a21628` | observed owner repo head |
| `docs/ERP5-FIRESTORE-SSOT.md` | `d73524304da8d35095d9699ca1713e9cb5a9875e` | canonical ownership and consumer boundary |
| `.github/workflows/erp5-ssot-refresh.yml` | `cc7075337b37e8c791a7e9a996818a0a37facb0a` | production writer |
| `lib/server/erp5-firestore-app.ts` | `2bf155fc576222d7fe82c60191772c81696c1467` | project ID and server credential boundary |
| `lib/server/whitelabel-erp5-catalog.ts` | `b93e71f37a098a1f1110d116aa4f6c0a5b7d0b8d` | live collection reads/cache |
| `contracts/ai-core/erp5-products.source-registry.json` | `2d047c3c664fcc995708dd29408067937ae834f8` | canonical source/fallback policy |
| `contracts/ai-core/erp5-product-refresh.pipeline.json` | `23e44ca4c44af45aed4872af0390153c1be0d1f1` | import pipeline shadow |
| `contracts/ai-core/erp5-sales-publish.pipeline.json` | `ca53cd1ea5f1826dc73d958e8c615e01ed57fbb9` | publish pipeline shadow |
| `freepass-creator/ai-core@main` | `9b520f3e1f79b54813159b4deb0f020d8ca64bde` | registry comparison |
| `freepass-creator/freepass-admin@main` | `2747ef32e96c550d7dea05c58ee012880cb42dd3` | Admin consumer status |
| `freepass-creator/freepass-sales@main` | `e98e3e9854012b9043f7fbe7b4168ce772047e39` | Sales data owner comparison |
| `freepass-creator/freepass-estimate@main` | `57a75aaeaa8b91f14c6bc22faa01e745daaa3112` | Estimate consumer status |
| SSOT Source Contract run | `35507383468`, success | main-push shadow guard proof |

## 12. next_start_here

Do not start with UI work.

Create a separate local Codex work packet with these ordered lanes:

1. **ERP5 Project Capsule**
   - add official name “프리패스 데이터”
   - technical name “ERP5 · Firebase/Firestore”
   - correct AI Core stale “candidate” wording
   - pin owner repo and revisions

2. **Rules / Index Ownership**
   - locate actual deployed ERP5 Rules and indexes read-only
   - if absent, design dedicated files and explicit deploy target
   - add emulator tests and deployment receipt requirements
   - do not deploy in the investigation packet

3. **RTDB Zero Ratchet**
   - inventory every RTDB import, API, adapter, listener, workflow and script
   - classify delete / archive-reference / ERP4 temporary dependency
   - add a fail-closed checker prohibiting new Data Hub RTDB paths
   - never restore fallback behavior

4. **Schema Registry**
   - document product, policy, partner, vehicle-master schemas
   - mark PII, mutability, nullability, timestamps, money, enums, source evidence
   - decide whether application/contract/settlement stay outside ERP5

5. **Consumer Contracts**
   - Admin: product read adapter and application snapshot boundary
   - Sales: product lookup/read-only boundary without mixing CRM truth
   - Estimate: quote input adapter without moving quote-engine truth
   - every consumer must fail closed; no RTDB/local JSON/Sheet fallback

6. **Freshness and Receipts**
   - prove three consecutive native scheduled successes
   - bind source revision, snapshot revision, row count/hash and consumer observation
   - distinguish upstream collection cadence from downstream cache propagation

7. **Backup / Restore**
   - define RPO/RTO, export cadence, retention, isolated restore rehearsal
   - prove restore into a non-production target
   - verify schema, counts/hashes, active pointer and consumer read after restore
   - no production restore or live write without separate approval

## 13. Hard stops

- Do not read or copy secrets, service-account JSON, API keys, customer documents, vehicle records or raw supplier rows.
- Do not run production queries merely to fill documentation gaps.
- Do not alter Firestore Rules, indexes, IAM, schedules, writers, consumers or deployments in a documentation task.
- Do not write to live Firestore.
- Do not infer ACTIVE from CI success alone.
- Do not reactivate RTDB under any name.
