/**
 * 외부 사진 OCR 불일치 묶음을 회사별 검증대기 스냅샷으로 복사한다.
 *
 * - `--prepare`(기본): Drive 읽기만 하며 원본 파일 ID·시점·OCR 판정을 manifest에 고정한다.
 * - `--apply --manifest=<file>`: 고정한 원본이 변하지 않았을 때만
 *   `freepasspics/<회사>/외부OCR_검증대기/OCR_검증_<snapshot>/…`에 복사한다.
 * - 원본 폴더·파일·시트·ERP·사진링크는 절대 변경하지 않는다.
 * - 모드렌터카 등 원본 차량번호 보유 외부 링크는 이 local OCR 묶음에 없으므로 대상이 아니다.
 */
import { createHash } from 'node:crypto';
import { closeSync, existsSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';

type Rec = Record<string, any>;
type AuditRow = { supplier?: string; folder?: string; want?: string; found?: string[]; verdict?: string };
type SourceFile = { id: string; name: string; mimeType: string; modifiedTime: string; size: string; md5Checksum: string };
type Finding = {
  id: string; supplier: string; companyFolderId: string; sourceFolderId: string; sourceFolderName: string;
  expectedPlate: string; observedPlates: string[]; destinationFolderName: string; files: SourceFile[];
  status: 'prepared' | 'source_changed' | 'copied' | 'skipped'; destinationFolderId?: string; copied?: Record<string, string>;
};
type Manifest = { version: 1; snapshot: string; rootId: string; auditPath: string; preparedAt: string; findings: Finding[]; applyStartedAt?: string; appliedAt?: string };

const S = (value: unknown) => String(value ?? '').trim();
const ROOT = '1X98iGOqEB7ZjGBdkrtesuFcQzvqIMClZ';
const AUDIT = 'tmp/photo-ocr-audit.json';
const QUARANTINE = '외부OCR_검증대기';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const COMPANIES: Record<string, string> = { 아이카: '아이카', 손오공: '손오공렌터카', 웰릭스: '웰릭스' };
const APPLY = process.argv.includes('--apply');
const manifestArg = (process.argv.find((arg) => arg.startsWith('--manifest=')) || '').slice('--manifest='.length);
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const hash = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 16);
const safeName = (value: string) => value.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 180);

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, subject: 'pyh@teamjpk.com', scopes: ['https://www.googleapis.com/auth/drive'] });
const DRIVE = 'https://www.googleapis.com/drive/v3/files';
const call = async (url: string, init?: RequestInit): Promise<Rec> => {
  const token = (await jwt.getAccessToken()).token;
  const response = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init?.headers || {}) } });
  const text = await response.text();
  if (!response.ok) throw new Error(`${response.status} ${text.slice(0, 240)}`);
  return text ? JSON.parse(text) : {};
};
const list = async (parent: string) => {
  const all: Rec[] = []; let pageToken = '';
  do {
    const page = pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '';
    const response = await call(`${DRIVE}?q=${encodeURIComponent(`'${parent}' in parents and trashed = false`)}&fields=nextPageToken,files(id,name,mimeType,modifiedTime,size,md5Checksum,appProperties)&pageSize=1000&includeItemsFromAllDrives=true&supportsAllDrives=true${page}`);
    all.push(...(response.files || [])); pageToken = S(response.nextPageToken);
  } while (pageToken);
  return all;
};
const exactChild = (items: Rec[], name: string, mimeType: string) => {
  const matches = items.filter((item) => S(item.name) === name && S(item.mimeType) === mimeType);
  if (matches.length > 1) throw new Error(`동일 이름 ${mimeType === FOLDER_MIME ? '폴더' : '파일'} 중복(${name})`);
  return matches[0];
};
const createFolder = async (name: string, parent: string, appProperties: Rec = {}) => call(`${DRIVE}?supportsAllDrives=true&ignoreDefaultVisibility=true`, {
  method: 'POST', body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parent], appProperties }),
});
const metadata = async (id: string) => call(`${DRIVE}/${encodeURIComponent(id)}?fields=id,name,mimeType,modifiedTime,size,md5Checksum,parents,trashed,appProperties,capabilities(canAddChildren),permissions(type,role,allowFileDiscovery,domain,emailAddress,deleted)&supportsAllDrives=true`);
const copy = async (file: SourceFile, parent: string, findingId: string) => call(`${DRIVE}/${encodeURIComponent(file.id)}/copy?supportsAllDrives=true&ignoreDefaultVisibility=true`, {
  method: 'POST',
  body: JSON.stringify({ name: `src_${file.id}__${safeName(file.name)}`, parents: [parent], appProperties: { fpOcrFinding: findingId, fpOcrSourceFile: file.id } }),
});
const sameSource = (actual: Rec, expected: SourceFile) => S(actual.id) === expected.id
  && S(actual.name) === expected.name && S(actual.mimeType) === expected.mimeType
  && S(actual.modifiedTime) === expected.modifiedTime && S(actual.size) === expected.size
  && S(actual.md5Checksum) === expected.md5Checksum && actual.trashed !== true;
const save = (path: string, manifest: Manifest) => writeFileSync(path, JSON.stringify(manifest, null, 2));
const isPublic = (item: Rec) => (item.permissions || []).some((permission: Rec) => S(permission.type) === 'anyone' && permission.deleted !== true);
const hasOnlyParent = (item: Rec, parent: string) => Array.isArray(item.parents) && item.parents.length === 1 && item.parents[0] === parent;
const assertPrivateFolder = (item: Rec, name: string, parent: string, requiredProperties: Rec = {}) => {
  if (item.trashed || S(item.name) !== name || S(item.mimeType) !== FOLDER_MIME || !hasOnlyParent(item, parent) || isPublic(item)) {
    throw new Error(`안전하지 않은 Drive 폴더 경로: ${name}`);
  }
  for (const [key, value] of Object.entries(requiredProperties)) {
    if (S(item.appProperties?.[key]) !== S(value)) throw new Error(`검증대기 폴더 provenance 불일치: ${name}/${key}`);
  }
};
const sameSourceSet = (actualItems: Rec[], expected: SourceFile[]) => {
  const actualImages = actualItems.filter((item) => /^image\//i.test(S(item.mimeType)));
  return actualImages.length === expected.length
    && actualImages.every((item) => sameSource(item, expected.find((file) => file.id === S(item.id)) || {} as SourceFile));
};
const copiedFileIsPrivate = async (id: string, destinationId: string, source: SourceFile, findingId: string) => {
  const file = await metadata(id);
  return !file.trashed && !isPublic(file) && hasOnlyParent(file, destinationId)
    && S(file.mimeType) === source.mimeType && S(file.md5Checksum) === source.md5Checksum
    && S(file.appProperties?.fpOcrFinding) === findingId && S(file.appProperties?.fpOcrSourceFile) === source.id;
};

if (!APPLY) {
  const audit = JSON.parse(readFileSync(AUDIT, 'utf8')) as { rows?: AuditRow[] };
  const rows = (audit.rows || []).filter((row) => row.verdict === '다름' && COMPANIES[S(row.supplier)] && S(row.folder) && S(row.want));
  const rootItems = await list(ROOT);
  const findings: Finding[] = [];
  for (const row of rows) {
    const supplier = S(row.supplier); const companyName = COMPANIES[supplier];
    const company = exactChild(rootItems, companyName, FOLDER_MIME);
    if (!company) { console.log(`⚠ ${supplier}/${row.folder}: 회사 폴더 없음`); continue; }
    const companyItems = await list(S(company.id));
    const source = exactChild(companyItems, S(row.folder), FOLDER_MIME);
    if (!source) { console.log(`⚠ ${supplier}/${row.folder}: 원본 폴더 없음`); continue; }
    const files = (await list(S(source.id))).filter((item) => /^image\//i.test(S(item.mimeType))).map((item): SourceFile => ({
      id: S(item.id), name: S(item.name), mimeType: S(item.mimeType), modifiedTime: S(item.modifiedTime), size: S(item.size), md5Checksum: S(item.md5Checksum),
    }));
    if (!files.length) { console.log(`⚠ ${supplier}/${row.folder}: 이미지 없음`); continue; }
    const observed = [...new Set((row.found || []).map(S).filter(Boolean))];
    const findingId = hash(`${supplier}|${S(row.folder)}|${S(row.want)}|${observed.join(',')}`);
    findings.push({
      id: findingId, supplier, companyFolderId: S(company.id), sourceFolderId: S(source.id), sourceFolderName: S(source.name),
      expectedPlate: S(row.want), observedPlates: observed,
      destinationFolderName: safeName(`OCR_${observed.length === 1 ? observed[0] : '판독복수'}__from_${S(row.want)}__src_${S(source.id)}`),
      files, status: 'prepared', copied: {},
    });
  }
  const manifest: Manifest = { version: 1, snapshot: `OCR_검증_${stamp}`, rootId: ROOT, auditPath: AUDIT, preparedAt: new Date().toISOString(), findings };
  const output = `tmp/ocr-photo-quarantine-manifest-${stamp}.json`;
  save(output, manifest);
  console.log(`■ 준비 완료 — OCR 불일치 ${rows.length}건 중 복사 가능 ${findings.length}건 · 이미지 ${findings.reduce((sum, finding) => sum + finding.files.length, 0)}장`);
  console.log(`  manifest ${output}`);
  console.log('  ※ Drive 변경 없음. 복사는 --apply --manifest=<위 파일>');
  process.exit(0);
}

if (!manifestArg || !existsSync(manifestArg)) throw new Error('--apply 에는 준비된 --manifest=<file> 이 필요합니다');
const manifest = JSON.parse(readFileSync(manifestArg, 'utf8')) as Manifest;
if (manifest.version !== 1 || manifest.rootId !== ROOT) throw new Error('지원하지 않는 manifest 또는 대상 root 불일치');
manifest.applyStartedAt ||= new Date().toISOString();
save(manifestArg, manifest);
const lockPath = `${manifestArg}.apply.lock`;
let lockFd: number | undefined;
try { lockFd = openSync(lockPath, 'wx'); } catch { throw new Error(`이미 적용 중이거나 정리되지 않은 lock이 있습니다: ${lockPath}`); }
process.on('exit', () => { if (lockFd !== undefined) { try { closeSync(lockFd); unlinkSync(lockPath); } catch { /* fail closed on next run */ } } });
const root = await metadata(ROOT);
if (root.trashed || root.capabilities?.canAddChildren !== true) throw new Error('대상 root에 폴더 생성 권한이 없습니다');
if (isPublic(root)) throw new Error('공개 링크(anyone) 대상 root에는 OCR 복사본을 만들지 않습니다');

for (const finding of manifest.findings) {
  if (finding.status === 'copied') {
    const destination = finding.destinationFolderId ? await metadata(finding.destinationFolderId) : null;
    if (destination && !destination.trashed && !isPublic(destination)) {
      const copiedFiles = await list(S(destination.id));
      const idsMatch = finding.files.every((sourceFile) => copiedFiles.some((file) => S(file.id) === S(finding.copied?.[sourceFile.id])
        && S(file.appProperties?.fpOcrFinding) === finding.id && S(file.appProperties?.fpOcrSourceFile) === sourceFile.id
        && S(file.md5Checksum) === sourceFile.md5Checksum));
      const intact = idsMatch && (await Promise.all(finding.files.map((sourceFile) => copiedFileIsPrivate(S(finding.copied?.[sourceFile.id]), S(destination.id), sourceFile, finding.id)))).every(Boolean);
      if (intact) continue;
    }
    finding.status = 'prepared'; finding.copied = {}; save(manifestArg, manifest);
  }
  const company = await metadata(finding.companyFolderId);
  const sourceFolder = await metadata(finding.sourceFolderId);
  try { assertPrivateFolder(company, COMPANIES[finding.supplier], ROOT); } catch {
    finding.status = 'source_changed'; save(manifestArg, manifest); continue;
  }
  if (sourceFolder.trashed || S(sourceFolder.mimeType) !== FOLDER_MIME || S(sourceFolder.name) !== finding.sourceFolderName || !hasOnlyParent(sourceFolder, finding.companyFolderId) || isPublic(sourceFolder)) {
    finding.status = 'source_changed'; save(manifestArg, manifest); continue;
  }
  const sourceItems = await list(finding.sourceFolderId);
  const actualFiles = new Map(sourceItems.map((file) => [S(file.id), file]));
  if (finding.files.some((file) => !sameSource(actualFiles.get(file.id) || {}, file)) || !sameSourceSet(sourceItems, finding.files)) {
    finding.status = 'source_changed'; save(manifestArg, manifest); continue;
  }
  let quarantine = exactChild(await list(finding.companyFolderId), QUARANTINE, FOLDER_MIME);
  if (!quarantine) quarantine = await createFolder(QUARANTINE, finding.companyFolderId, { fpOcrQuarantine: 'true' });
  quarantine = await metadata(S(quarantine.id));
  assertPrivateFolder(quarantine, QUARANTINE, finding.companyFolderId, { fpOcrQuarantine: 'true' });
  let snapshot = exactChild(await list(S(quarantine.id)), manifest.snapshot, FOLDER_MIME);
  if (!snapshot) snapshot = await createFolder(manifest.snapshot, S(quarantine.id), { fpOcrSnapshot: manifest.snapshot });
  snapshot = await metadata(S(snapshot.id));
  assertPrivateFolder(snapshot, manifest.snapshot, S(quarantine.id), { fpOcrSnapshot: manifest.snapshot });
  let destination = exactChild(await list(S(snapshot.id)), finding.destinationFolderName, FOLDER_MIME);
  if (!destination) destination = await createFolder(finding.destinationFolderName, S(snapshot.id), { fpOcrFinding: finding.id, fpOcrSourceFolder: finding.sourceFolderId });
  destination = await metadata(S(destination.id));
  assertPrivateFolder(destination, finding.destinationFolderName, S(snapshot.id), { fpOcrFinding: finding.id, fpOcrSourceFolder: finding.sourceFolderId });
  finding.destinationFolderId = S(destination.id);
  const destinationFiles = await list(S(destination.id));
  for (const sourceFile of finding.files) {
    const existing = destinationFiles.find((file) => S(file.appProperties?.fpOcrFinding) === finding.id && S(file.appProperties?.fpOcrSourceFile) === sourceFile.id);
    if (existing) { finding.copied![sourceFile.id] = S(existing.id); continue; }
    const copied = await copy(sourceFile, S(destination.id), finding.id);
    finding.copied![sourceFile.id] = S(copied.id);
    save(manifestArg, manifest);
  }
  const afterCopy = await list(S(destination.id));
  const idsMatch = finding.files.every((sourceFile) => afterCopy.some((file) => S(file.id) === S(finding.copied?.[sourceFile.id])
    && S(file.appProperties?.fpOcrFinding) === finding.id && S(file.appProperties?.fpOcrSourceFile) === sourceFile.id
    && S(file.md5Checksum) === sourceFile.md5Checksum));
  const verified = idsMatch && (await Promise.all(finding.files.map((sourceFile) => copiedFileIsPrivate(S(finding.copied?.[sourceFile.id]), S(destination.id), sourceFile, finding.id)))).every(Boolean);
  if (!verified) throw new Error(`복사 후 권한·무결성 검증 실패: ${finding.sourceFolderName}`);
  finding.status = 'copied'; save(manifestArg, manifest);
}
manifest.appliedAt = new Date().toISOString();
save(manifestArg, manifest);
const done = manifest.findings.filter((finding) => finding.status === 'copied').length;
const held = manifest.findings.filter((finding) => finding.status !== 'copied').length;
console.log(`■ 외부OCR 검증대기 복사 완료 — 복사 ${done}건 · 보류 ${held}건 · manifest ${manifestArg}`);
