import test from 'node:test';
import assert from 'node:assert/strict';

import {
  InMemoryThemeTarget,
  ReleaseGate,
  artifactDigest,
  checkEvidence,
} from '../src/release-gate.mjs';

const files = () => [
  { path: 'assets/theme.css', content: '.hero { display: grid; }\n' },
  { path: 'sections/hero.liquid', content: '<section>{{ section.settings.heading }}</section>\n' },
  { path: 'templates/index.json', content: '{"sections":{},"order":[]}\n' },
];

const candidate = (overrides = {}) => {
  const manifest = files();
  const digest = artifactDigest(manifest);
  return {
    files: manifest,
    checks: [
      checkEvidence({ name: 'format', artifactHash: digest, passed: true }),
      checkEvidence({ name: 'theme-check-synthetic', artifactHash: digest, passed: true }),
    ],
    ...overrides,
  };
};

const setup = (targetOptions = {}) => {
  const target = new InMemoryThemeTarget({
    id: 'theme-staging-7',
    role: 'unpublished',
    version: 4,
    files: [{ path: 'assets/old.css', content: 'old\n' }],
    ...targetOptions,
  });
  return { target, gate: new ReleaseGate({ target }) };
};

test('prepares, applies, and verifies an exact unpublished target release', () => {
  const { target, gate } = setup();
  const prepared = gate.prepare({ targetId: target.id, expectedTargetVersion: 4, candidate: candidate() });
  const applied = gate.apply({ planToken: prepared.planToken, targetId: target.id, expectedTargetVersion: 4 });

  assert.equal(applied.version, 5);
  assert.equal(applied.artifactHash, prepared.artifactHash);
  assert.equal(gate.verify({ targetId: target.id, artifactHash: prepared.artifactHash }).verified, true);
  assert.deepEqual(target.read().files, files().sort((a, b) => a.path.localeCompare(b.path)));
});

test('rejects failed or missing required check evidence', () => {
  const { gate, target } = setup();
  const failed = candidate();
  failed.checks[1] = checkEvidence({ name: 'theme-check-synthetic', artifactHash: artifactDigest(failed.files), passed: false });

  assert.throws(() => gate.prepare({ targetId: target.id, expectedTargetVersion: 4, candidate: failed }), /required check failed/);
  assert.throws(() => gate.prepare({ targetId: target.id, expectedTargetVersion: 4, candidate: { ...candidate(), checks: [candidate().checks[0]] } }), /missing required check/);
});

test('rejects stale check evidence after candidate content changes', () => {
  const { gate, target } = setup();
  const original = candidate();
  const changed = { ...original, files: files().map((file, index) => index === 0 ? { ...file, content: 'changed\n' } : file) };
  assert.throws(() => gate.prepare({ targetId: target.id, expectedTargetVersion: 4, candidate: changed }), /check evidence does not match artifact/);
});

test('rejects unsafe, unsupported, duplicate, and sparse file manifests', () => {
  const { gate, target } = setup();
  for (const badPath of ['../secret', '/absolute.liquid', '.git/config', 'assets\\bad.css', 'config/secrets.json', 'assets/run.exe']) {
    assert.throws(() => gate.prepare({ targetId: target.id, expectedTargetVersion: 4, candidate: candidate({ files: [{ path: badPath, content: 'x' }], checks: [] }) }), /invalid|unsupported|required check/);
  }

  const duplicate = files(); duplicate.push({ ...duplicate[0] });
  assert.throws(() => artifactDigest(duplicate), /duplicate path/);
  const sparse = new Array(2); sparse[0] = files()[0];
  assert.throws(() => artifactDigest(sparse), /sparse/);
});

test('rejects malformed versions and hashes', () => {
  const { gate, target } = setup();
  assert.throws(() => gate.prepare({ targetId: target.id, expectedTargetVersion: -1, candidate: candidate() }), /version/);
  const bad = candidate(); bad.checks[0] = { ...bad.checks[0], artifactHash: 'not-a-hash' };
  assert.throws(() => gate.prepare({ targetId: target.id, expectedTargetVersion: 4, candidate: bad }), /hash/);
});

test('private prepared state ignores caller mutation and forged display fields', () => {
  const { gate, target } = setup();
  const input = candidate();
  const prepared = gate.prepare({ targetId: target.id, expectedTargetVersion: 4, candidate: input });
  input.files[0].content = 'mutated';
  prepared.artifactHash = '0'.repeat(64);
  prepared.targetId = 'forged';

  const applied = gate.apply({ planToken: prepared.planToken, targetId: target.id, expectedTargetVersion: 4 });
  assert.equal(applied.artifactHash, artifactDigest(files()));
});

test('wrong target, role, or version refuses without consuming a valid plan', () => {
  const { gate, target } = setup();
  const prepared = gate.prepare({ targetId: target.id, expectedTargetVersion: 4, candidate: candidate() });

  assert.throws(() => gate.apply({ planToken: prepared.planToken, targetId: 'other', expectedTargetVersion: 4 }), /target mismatch/);
  assert.throws(() => gate.apply({ planToken: prepared.planToken, targetId: target.id, expectedTargetVersion: 3 }), /version mismatch/);
  target.setRoleForTest('live');
  assert.throws(() => gate.apply({ planToken: prepared.planToken, targetId: target.id, expectedTargetVersion: 4 }), /unpublished/);
  target.setRoleForTest('unpublished');
  assert.equal(gate.apply({ planToken: prepared.planToken, targetId: target.id, expectedTargetVersion: 4 }).version, 5);
});

test('revision CAS detects ABA even when content returns to the same bytes', () => {
  const { gate, target } = setup();
  const prepared = gate.prepare({ targetId: target.id, expectedTargetVersion: 4, candidate: candidate() });
  const original = target.read().files;
  target.replaceForTest([{ path: 'assets/transient.css', content: 'x' }]);
  target.replaceForTest(original);
  assert.throws(() => gate.apply({ planToken: prepared.planToken, targetId: target.id, expectedTargetVersion: 4 }), /version mismatch/);
});

test('successful application consumes the plan and replay fails', () => {
  const { gate, target } = setup();
  const prepared = gate.prepare({ targetId: target.id, expectedTargetVersion: 4, candidate: candidate() });
  gate.apply({ planToken: prepared.planToken, targetId: target.id, expectedTargetVersion: 4 });
  assert.throws(() => gate.apply({ planToken: prepared.planToken, targetId: target.id, expectedTargetVersion: 5 }), /unknown or consumed plan/);
});

test('failed write leaves target unchanged but consumes the attempted plan', () => {
  const { gate, target } = setup({ failNextWrite: true });
  const before = target.read();
  const prepared = gate.prepare({ targetId: target.id, expectedTargetVersion: 4, candidate: candidate() });
  assert.throws(() => gate.apply({ planToken: prepared.planToken, targetId: target.id, expectedTargetVersion: 4 }), /simulated write failure/);
  assert.deepEqual(target.read(), before);
  assert.throws(() => gate.apply({ planToken: prepared.planToken, targetId: target.id, expectedTargetVersion: 4 }), /unknown or consumed plan/);
  const retry = gate.prepare({ targetId: target.id, expectedTargetVersion: 4, candidate: candidate() });
  assert.equal(gate.apply({ planToken: retry.planToken, targetId: target.id, expectedTargetVersion: 4 }).version, 5);
});

test('adapter commit-then-throw consumes the plan and prevents replay', () => {
  const base = new InMemoryThemeTarget({
    id: 'theme-staging-7', role: 'unpublished', version: 4,
    files: [{ path: 'assets/old.css', content: 'old\n' }],
  });
  const target = {
    get id() { return base.id; },
    read() { return base.read(); },
    compareAndSwap(operation) {
      base.compareAndSwap(operation);
      throw new Error('simulated ambiguous write outcome');
    },
  };
  const gate = new ReleaseGate({ target });
  const prepared = gate.prepare({ targetId: target.id, expectedTargetVersion: 4, candidate: candidate() });

  assert.throws(() => gate.apply({ planToken: prepared.planToken, targetId: target.id, expectedTargetVersion: 4 }), /simulated ambiguous write outcome/);
  assert.equal(target.read().version, 5);
  assert.equal(artifactDigest(target.read().files), prepared.artifactHash);
  assert.throws(() => gate.apply({ planToken: prepared.planToken, targetId: target.id, expectedTargetVersion: 5 }), /unknown or consumed plan/);
});

test('readback mismatch reports failure honestly after the adapter mutates committed bytes', () => {
  const { gate, target } = setup({ corruptReadbackOnce: true });
  const prepared = gate.prepare({ targetId: target.id, expectedTargetVersion: 4, candidate: candidate() });
  assert.throws(() => gate.apply({ planToken: prepared.planToken, targetId: target.id, expectedTargetVersion: 4 }), /readback verification failed/);
});

test('prepare rejects malformed file containers without creating a usable plan', () => {
  const { gate, target } = setup();
  for (const malformedFiles of [null, {}, [null], [{ path: 'assets/x.css', content: 'x', extra: true }]]) {
    assert.throws(() => gate.prepare({
      targetId: target.id,
      expectedTargetVersion: 4,
      candidate: { files: malformedFiles, checks: [] },
    }), /files|file shape/);
  }
  assert.deepEqual(target.read().files, [{ path: 'assets/old.css', content: 'old\n' }]);
});

test('canonical digest is independent of input order for Unicode-distinct paths', () => {
  const manifest = [
    { path: 'assets/é.css', content: 'composed' },
    { path: 'assets/é.css', content: 'decomposed' },
  ];
  assert.equal(artifactDigest(manifest), artifactDigest([...manifest].reverse()));
});

test('rejects ASCII control characters and nested .git path segments', () => {
  for (const badPath of ['assets/bad\n.css', 'assets/bad\x1f.css', 'assets/.git/config.json']) {
    assert.throws(() => artifactDigest([{ path: badPath, content: 'x' }]), /invalid path/);
  }
});

test('rejects revision increments beyond the safe integer range without mutation', () => {
  const { target, gate } = setup({ version: Number.MAX_SAFE_INTEGER });
  const before = target.read();
  assert.throws(() => target.replaceForTest(files()), /version overflow/);
  assert.deepEqual(target.read(), before);

  const prepared = gate.prepare({
    targetId: target.id,
    expectedTargetVersion: Number.MAX_SAFE_INTEGER,
    candidate: candidate(),
  });
  assert.throws(() => gate.apply({
    planToken: prepared.planToken,
    targetId: target.id,
    expectedTargetVersion: Number.MAX_SAFE_INTEGER,
  }), /version overflow/);
  assert.deepEqual(target.read(), before);
});

test('a committed plan is consumed when post-write readback throws', () => {
  const base = new InMemoryThemeTarget({
    id: 'theme-staging-7', role: 'unpublished', version: 4,
    files: [{ path: 'assets/old.css', content: 'old\n' }],
  });
  let throwReadback = false;
  const target = {
    get id() { return base.id; },
    read() {
      if (throwReadback) throw new Error('simulated readback failure');
      return base.read();
    },
    compareAndSwap(operation) {
      const result = base.compareAndSwap(operation);
      throwReadback = true;
      return result;
    },
  };
  const gate = new ReleaseGate({ target });
  const prepared = gate.prepare({ targetId: target.id, expectedTargetVersion: 4, candidate: candidate() });
  assert.throws(() => gate.apply({ planToken: prepared.planToken, targetId: target.id, expectedTargetVersion: 4 }), /post-write verification failed/);
  throwReadback = false;
  assert.throws(() => gate.apply({ planToken: prepared.planToken, targetId: target.id, expectedTargetVersion: 4 }), /unknown or consumed plan/);
});

test('apply verifies readback identity, unpublished role, version, and artifact', () => {
  const base = new InMemoryThemeTarget({
    id: 'theme-staging-7', role: 'unpublished', version: 4,
    files: [{ path: 'assets/old.css', content: 'old\n' }],
  });
  let committed = false;
  const target = {
    get id() { return base.id; },
    read() {
      const snapshot = base.read();
      return committed ? { ...snapshot, id: 'wrong-id', role: 'live', version: 99 } : snapshot;
    },
    compareAndSwap(operation) {
      const result = base.compareAndSwap(operation);
      committed = true;
      return result;
    },
  };
  const gate = new ReleaseGate({ target });
  const prepared = gate.prepare({ targetId: target.id, expectedTargetVersion: 4, candidate: candidate() });
  assert.throws(() => gate.apply({ planToken: prepared.planToken, targetId: target.id, expectedTargetVersion: 4 }), /readback verification failed/);
});

test('standalone verify requires target identity and unpublished role as well as content', () => {
  const { gate, target } = setup();
  const hash = artifactDigest(target.read().files);
  target.setRoleForTest('live');
  assert.deepEqual(gate.verify({ targetId: target.id, artifactHash: hash }).verified, false);
});
