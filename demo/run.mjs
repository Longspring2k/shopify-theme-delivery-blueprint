import { InMemoryThemeTarget, ReleaseGate, artifactDigest, checkEvidence } from '../src/release-gate.mjs';

const files = [
  { path: 'assets/theme.css', content: '.release-demo { display: grid; }\n' },
  { path: 'sections/release-demo.liquid', content: '<section>Fresh synthetic fixture</section>\n' },
  { path: 'templates/index.json', content: '{"sections":{},"order":[]}\n' },
];
const artifactHash = artifactDigest(files);
const target = new InMemoryThemeTarget({
  id: 'unpublished-demo-theme', role: 'unpublished', version: 12,
  files: [{ path: 'assets/previous.css', content: 'previous\n' }],
});
const gate = new ReleaseGate({ target });
const candidate = {
  files,
  checks: [
    checkEvidence({ name: 'format', artifactHash, passed: true }),
    checkEvidence({ name: 'theme-check-synthetic', artifactHash, passed: true }),
  ],
};

const short = (hash) => `${hash.slice(0, 12)}…`;
const prepared = gate.prepare({ targetId: target.id, expectedTargetVersion: 12, candidate });
console.log(`PREPARED  target=${prepared.targetId} version=${prepared.expectedTargetVersion} files=${prepared.fileCount} artifact=${short(prepared.artifactHash)}`);
console.log('           evidence=format:pass, theme-check-synthetic:pass (fixture evidence, not Shopify Theme Check)');
const applied = gate.apply({ planToken: prepared.planToken, targetId: target.id, expectedTargetVersion: 12 });
console.log(`APPLIED   target=${applied.targetId} version=${applied.version} artifact=${short(applied.artifactHash)}`);
const verified = gate.verify({ targetId: target.id, artifactHash: prepared.artifactHash });
console.log(`VERIFIED  exact_manifest=${verified.verified} version=${verified.version} artifact=${short(verified.artifactHash)}`);
console.log('NOT PUBLISHED: this demo has no live-target or network adapter.');
