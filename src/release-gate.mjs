import { createHash, randomBytes } from 'node:crypto';

export const POLICY = Object.freeze({
  maxFiles: 100,
  maxTotalContentBytes: 1_000_000,
  requiredChecks: Object.freeze(['format', 'theme-check-synthetic']),
});

const ROOTS = new Set(['assets', 'config', 'layout', 'locales', 'sections', 'snippets', 'templates']);
const EXTENSIONS = new Set(['css', 'gif', 'json', 'js', 'jpg', 'jpeg', 'liquid', 'png', 'svg', 'webp']);
const HASH = /^[a-f0-9]{64}$/;

function fail(message) { throw new Error(message); }
function validVersion(value) { return Number.isSafeInteger(value) && value >= 0; }
function cloneFiles(files) { return files.map(({ path, content }) => ({ path, content })); }
function comparePaths(a, b) { return a.path < b.path ? -1 : a.path > b.path ? 1 : 0; }
function requireIncrementableVersion(version) { if (version === Number.MAX_SAFE_INTEGER) fail('target version overflow'); }

function validatePath(path) {
  if (typeof path !== 'string' || path.length === 0 || path.startsWith('/') || path.includes('\\') || /[\x00-\x1f\x7f]/.test(path)) fail('invalid path');
  const parts = path.split('/');
  if (parts.some((part) => part === '' || part === '.' || part === '..' || part === '.git')) fail('invalid path');
  if (!ROOTS.has(parts[0])) fail('unsupported theme root');
  if (/secret|credential|\.env/i.test(path)) fail('invalid secret-like path');
  const extension = parts.at(-1).includes('.') ? parts.at(-1).split('.').at(-1).toLowerCase() : '';
  if (!EXTENSIONS.has(extension)) fail('unsupported file extension');
}

function validateFiles(files) {
  if (!Array.isArray(files) || files.length === 0) fail('files must be a non-empty array');
  if (files.length > POLICY.maxFiles) fail('file limit exceeded');
  for (let index = 0; index < files.length; index += 1) if (!(index in files)) fail('sparse file array');
  const paths = new Set();
  let totalBytes = 0;
  for (const file of files) {
    if (!file || typeof file !== 'object' || Array.isArray(file) || Object.keys(file).sort().join(',') !== 'content,path') fail('invalid file shape');
    validatePath(file.path);
    if (typeof file.content !== 'string') fail('file content must be a string');
    if (paths.has(file.path)) fail('duplicate path');
    paths.add(file.path);
    totalBytes += Buffer.byteLength(file.content);
  }
  if (totalBytes > POLICY.maxTotalContentBytes) fail('content byte limit exceeded');
}

export function artifactDigest(files) {
  validateFiles(files);
  const canonical = cloneFiles(files).sort(comparePaths).map(({ path, content }) => {
    const contentHash = createHash('sha256').update(content, 'utf8').digest('hex');
    return `${path}\0${contentHash}\n`;
  }).join('');
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

export function checkEvidence({ name, artifactHash, passed }) {
  if (typeof name !== 'string' || name.length === 0) fail('invalid check name');
  if (!HASH.test(artifactHash)) fail('malformed artifact hash');
  if (typeof passed !== 'boolean') fail('invalid check result');
  return Object.freeze({ name, artifactHash, passed });
}

function validateChecks(checks, artifactHash) {
  if (!Array.isArray(checks)) fail('checks must be an array');
  const byName = new Map();
  for (const check of checks) {
    if (!check || typeof check !== 'object' || Array.isArray(check)) fail('invalid check evidence');
    if (!HASH.test(check.artifactHash ?? '')) fail('malformed artifact hash');
    if (check.artifactHash !== artifactHash) fail('check evidence does not match artifact');
    if (typeof check.passed !== 'boolean' || typeof check.name !== 'string') fail('invalid check evidence');
    if (byName.has(check.name)) fail('duplicate check evidence');
    byName.set(check.name, check);
  }
  for (const name of POLICY.requiredChecks) {
    const check = byName.get(name);
    if (!check) fail(`missing required check: ${name}`);
    if (!check.passed) fail(`required check failed: ${name}`);
  }
}

export class InMemoryThemeTarget {
  #id; #role; #version; #files; #failNextWrite; #corruptReadbackOnce;

  constructor({ id, role, version, files, failNextWrite = false, corruptReadbackOnce = false }) {
    if (typeof id !== 'string' || id.length === 0) fail('invalid target id');
    if (!validVersion(version)) fail('invalid target version');
    validateFiles(files);
    this.#id = id; this.#role = role; this.#version = version; this.#files = cloneFiles(files);
    this.#failNextWrite = failNextWrite; this.#corruptReadbackOnce = corruptReadbackOnce;
  }

  get id() { return this.#id; }
  read() { return { id: this.#id, role: this.#role, version: this.#version, files: cloneFiles(this.#files).sort(comparePaths) }; }
  setRoleForTest(role) { this.#role = role; }
  replaceForTest(files) { validateFiles(files); requireIncrementableVersion(this.#version); this.#files = cloneFiles(files); this.#version += 1; }

  compareAndSwap({ expectedVersion, files }) {
    if (this.#role !== 'unpublished') fail('target must remain unpublished');
    if (this.#version !== expectedVersion) fail('target version mismatch');
    validateFiles(files);
    requireIncrementableVersion(this.#version);
    if (this.#failNextWrite) { this.#failNextWrite = false; fail('simulated write failure'); }
    this.#files = cloneFiles(files);
    this.#version += 1;
    if (this.#corruptReadbackOnce) {
      this.#corruptReadbackOnce = false;
      this.#files[0] = { ...this.#files[0], content: `${this.#files[0].content}corrupt` };
    }
    return this.read();
  }
}

export class ReleaseGate {
  #target; #plans = new Map();

  constructor({ target }) { this.#target = target; }

  prepare({ targetId, expectedTargetVersion, candidate }) {
    if (targetId !== this.#target.id) fail('target mismatch');
    if (!validVersion(expectedTargetVersion)) fail('invalid target version');
    const snapshot = this.#target.read();
    if (snapshot.role !== 'unpublished') fail('target must be unpublished');
    if (snapshot.version !== expectedTargetVersion) fail('target version mismatch');
    if (!candidate || typeof candidate !== 'object') fail('invalid candidate');
    validateFiles(candidate.files);
    const artifactHash = artifactDigest(candidate.files);
    validateChecks(candidate.checks, artifactHash);
    const files = cloneFiles(candidate.files);
    const planToken = randomBytes(24).toString('hex');
    this.#plans.set(planToken, Object.freeze({ targetId, expectedTargetVersion, artifactHash, files: Object.freeze(cloneFiles(files).map(Object.freeze)) }));
    return { planToken, targetId, expectedTargetVersion, artifactHash, fileCount: files.length };
  }

  apply({ planToken, targetId, expectedTargetVersion }) {
    const plan = this.#plans.get(planToken);
    if (!plan) fail('unknown or consumed plan');
    if (targetId !== plan.targetId) fail('target mismatch');
    if (expectedTargetVersion !== plan.expectedTargetVersion) fail('target version mismatch');
    const before = this.#target.read();
    if (before.role !== 'unpublished') fail('target must remain unpublished');
    if (before.version !== plan.expectedTargetVersion) fail('target version mismatch');
    this.#plans.delete(planToken);
    this.#target.compareAndSwap({ expectedVersion: plan.expectedTargetVersion, files: cloneFiles(plan.files) });
    let readback;
    try { readback = this.#target.read(); } catch { fail('post-write verification failed'); }
    let readbackHash;
    try { readbackHash = artifactDigest(readback.files); } catch { fail('post-write verification failed'); }
    const expectedVersion = plan.expectedTargetVersion + 1;
    if (readback.id !== plan.targetId || readback.role !== 'unpublished' || readback.version !== expectedVersion || readbackHash !== plan.artifactHash) fail('readback verification failed');
    return { targetId: readback.id, version: readback.version, artifactHash: readbackHash, verified: true };
  }

  verify({ targetId, artifactHash }) {
    if (targetId !== this.#target.id) fail('target mismatch');
    if (!HASH.test(artifactHash)) fail('malformed artifact hash');
    const snapshot = this.#target.read();
    const actualHash = artifactDigest(snapshot.files);
    const verified = snapshot.id === targetId && snapshot.role === 'unpublished' && actualHash === artifactHash;
    return { targetId, version: snapshot.version, artifactHash: actualHash, verified };
  }
}
