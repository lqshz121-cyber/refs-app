import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve, relative } from 'node:path';

const outRoot = resolve('outputs/release-evidence-bundle');
const strictClean = process.argv.includes('--strict-clean');

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    shell: false,
    ...options,
  });
  return {
    command: [command, ...args].join(' '),
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
};

const git = (...args) => run('git', args);
const writeText = (path, text) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, 'utf8');
};
const writeJson = (path, value) => writeText(path, `${JSON.stringify(value, null, 2)}\n`);
const readJson = path => JSON.parse(readFileSync(path, 'utf8'));
const rel = path => relative(process.cwd(), path).replaceAll('\\', '/');

const head = git('rev-parse', 'HEAD');
if (head.status !== 0) {
  console.error('RELEASE_EVIDENCE_GIT_UNAVAILABLE: cannot resolve HEAD');
  process.exit(2);
}

const branch = git('branch', '--show-current');
const status = git('status', '--short');
const dirtyPaths = status.stdout
  .split(/\r?\n/)
  .map(line => line.trim())
  .filter(Boolean);
const clean = dirtyPaths.length === 0;
if (strictClean && !clean) {
  console.error(`RELEASE_EVIDENCE_WORKTREE_DIRTY: ${dirtyPaths.join(',')}`);
  process.exit(2);
}

const changedFiles = git('diff-tree', '--no-commit-id', '--name-only', '-r', head.stdout.trim());
const simulation = run(process.execPath, [resolve('tools/create-local-release-simulation.mjs')]);
if (simulation.status !== 0) {
  console.error(`RELEASE_EVIDENCE_SIMULATION_FAILED: ${simulation.stderr || simulation.stdout}`);
  process.exit(2);
}

const envPath = resolve('outputs/local-release-simulation/env.json');
const envConfig = existsSync(envPath) ? readJson(envPath) : null;
if (!envConfig) {
  console.error('RELEASE_EVIDENCE_SIMULATION_ENV_MISSING: outputs/local-release-simulation/env.json');
  process.exit(2);
}

const packageJson = readJson(resolve('package.json'));
const requiredCommands = [
  { name: 'root-test', command: 'npm.cmd test', requiredExit: 0, scope: 'root static, SSR, workflow, visual, release harness and simulation' },
  { name: 'root-build', command: 'npm.cmd run build', requiredExit: 0, scope: 'frontend production bundle' },
  { name: 'diff-check', command: 'git diff --check', requiredExit: 0, scope: 'whitespace/conflict marker gate' },
  { name: 'release-harness', command: 'npm.cmd run test:release-harness', requiredExit: 0, scope: 'external gate fail-closed unit guard' },
  { name: 'release-simulation', command: 'npm.cmd run test:release-simulation', requiredExit: 0, scope: 'local UI/OIDC, S3/scanner, WBS signed-receipt simulation' },
  { name: 'external-release-gate-local-sim', command: 'node tools/create-local-release-simulation.mjs; load outputs/local-release-simulation/env.json; npm.cmd run verify:external-release-gate', requiredExit: 0, scope: 'aggregate simulated provider evidence' },
  { name: 'server-test', command: 'npm.cmd --prefix server test', requiredExit: 0, scope: 'server unit/integration gate' },
  { name: 'server-pg15-fresh', command: 'POSTGRES_IMAGE=postgres:15-alpine npm.cmd --prefix server run test:postgres:fresh', requiredExit: 0, scope: 'fresh PostgreSQL 15 gate with cleanup evidence' },
  { name: 'server-pg16-fresh', command: 'POSTGRES_IMAGE=postgres:16-alpine npm.cmd --prefix server run test:postgres:fresh', requiredExit: 0, scope: 'fresh PostgreSQL 16 gate with cleanup evidence' },
  { name: 'server-attachments-containers', command: 'npm.cmd --prefix server run test:attachments:containers', requiredExit: 0, scope: 'versioned object storage and malware scanner container gate' },
  { name: 'live-ui-7-page', command: 'npm.cmd run verify:authoritative-runtime-evidence', requiredExit: 0, scope: 'real authenticated Dashboard/AP/AR/JE/Bank/Reconciliation/Reports browser evidence; not satisfied by local simulation' },
  { name: 'provider-s3-scanner', command: 'npm.cmd run verify:release-s3-scanner', requiredExit: 0, scope: 'real provider S3/scanner lifecycle; not satisfied by local simulation' },
  { name: 'provider-wbs-receipt', command: 'npm.cmd run verify:release-wbs-receipt', requiredExit: 0, scope: 'real WBS signed nonempty receipt; not satisfied by local simulation' },
  { name: 'stage1-payable-live-chain', command: 'npm.cmd run verify:stage1-payable-live-acceptance -- --provider-trust <pinned-trust.json> --receipt <receipt.json> --request-raw <request.raw> --response-raw <response.raw> --package-raw <package.json> --chain <stage1-chain.json>', requiredExit: 0, scope: 'real signed Payable attachment → separated roles → same posted JE → GL/TB/AP Aging; not satisfied by local simulation' },
  { name: 'stage2-bank-live-chain', command: 'npm.cmd run verify:stage2-bank-live-chain', requiredExit: 0, scope: 'real signed-off Bank match to immutable snapshot to posted JE to GL/TB/BS/Cash Flow readback; read-only and not satisfied by local simulation' },
];

const scriptCoverage = Object.fromEntries(
  ['test', 'build', 'test:release-harness', 'test:release-simulation', 'verify:external-release-gate', 'verify:authoritative-runtime-evidence', 'verify:release-s3-scanner', 'verify:release-wbs-receipt', 'verify:stage1-payable-live-acceptance', 'verify:stage2-bank-live-chain']
    .map(name => [name, packageJson.scripts?.[name] || null]),
);

const localArtifacts = {
  uiManifest: rel(envConfig.REFS_UI_E2E_MANIFEST),
  s3ScannerReceipt: rel(envConfig.REFS_S3_SCANNER_LIFECYCLE_RECEIPT),
  wbsProviderTrust: rel(envConfig.REFS_WBS_PROVIDER_TRUST_FILE),
  wbsSignedReceipt: rel(envConfig.REFS_WBS_SIGNED_RECEIPT_FILE),
  wbsRequestRaw: rel(envConfig.REFS_WBS_REQUEST_RAW_FILE),
  wbsResponseRaw: rel(envConfig.REFS_WBS_RESPONSE_RAW_FILE),
  wbsPackageRaw: rel(envConfig.REFS_WBS_PACKAGE_RAW_FILE),
  envFile: rel(envPath),
};

const pr = run('gh', ['pr', 'view', '7', '--json', 'headRefOid,mergeStateStatus,statusCheckRollup']);
let prEvidence = { available: false, error: pr.stderr || pr.stdout || 'gh pr view unavailable' };
if (pr.status === 0) {
  try {
    prEvidence = { available: true, ...JSON.parse(pr.stdout) };
  } catch {
    prEvidence = { available: false, error: 'gh pr view returned invalid JSON' };
  }
}

const manifest = {
  mode: 'LOCAL_RELEASE_EVIDENCE_BUNDLE',
  warning: 'This bundle records local and CI evidence paths. It is not a production release claim and does not replace real provider/live evidence.',
  created_at: new Date().toISOString(),
  head_sha: head.stdout.trim(),
  branch: branch.stdout.trim(),
  clean,
  dirty_paths: dirtyPaths,
  changed_files_in_head: changedFiles.stdout.split(/\r?\n/).filter(Boolean),
  strict_clean: strictClean,
  scripts: scriptCoverage,
  local_simulation_artifacts: localArtifacts,
  required_commands: requiredCommands,
  release_acceptance: {
    local_candidate_gate: 'PASS only after required local commands exit 0 on a clean frozen SHA',
    global_release_gate: 'PARTIAL/FAIL until real HTTPS/OIDC, authenticated 7-page live E2E, provider S3/scanner lifecycle, signed WBS Payable attachment-to-GL/TB/AP Aging evidence, and the signed-off Bank-to-GL/TB/BS/Cash Flow chain exist',
  },
  pr_7: prEvidence,
};

writeJson(resolve(outRoot, 'manifest.json'), manifest);
writeText(resolve(outRoot, 'README.md'), [
  '# REFS Release Evidence Bundle',
  '',
  `SHA: ${manifest.head_sha}`,
  `Branch: ${manifest.branch || '(detached)'}`,
  `Clean worktree: ${manifest.clean}`,
  '',
  'This bundle is audit support only. It is not a production/global release PASS.',
  '',
  '## Local simulation artifacts',
  '',
  ...Object.entries(localArtifacts).map(([name, path]) => `- ${name}: ${path}`),
  '',
  '## Required commands',
  '',
  ...requiredCommands.map(row => `- ${row.name}: \`${row.command}\` -> exit ${row.requiredExit} (${row.scope})`),
  '',
  '## Release boundary',
  '',
  '- Local candidate gates can pass with deterministic local simulation.',
  '- Global release remains blocked until real HTTPS/OIDC, live authenticated browser evidence, provider S3/scanner, the signed WBS Payable attachment-to-GL/TB/AP Aging chain, and the signed-off Bank-to-GL/TB/BS/Cash Flow chain are present.',
  '',
].join('\n'));

console.log(`release-evidence-bundle: wrote ${outRoot}`);
console.log(`release-evidence-bundle: clean=${clean} sha=${manifest.head_sha}`);
