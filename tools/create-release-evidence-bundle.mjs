import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname, resolve, relative } from 'node:path';

const outRoot = resolve('outputs/release-evidence-bundle');
const strictClean = process.argv.includes('--strict-clean');
const executeLocal = process.argv.includes('--execute-local');
const requestedPostgresVersions = [15, 16, 18].filter(version => process.argv.includes(`--execute-pg${version}`));
// PostgreSQL's TAP output is intentionally retained as a release receipt. The
// Node default (1 MiB) truncates a healthy full kernel gate and makes
// spawnSync report ENOBUFS / a false non-zero status. Keep a bounded but ample
// limit so the receipt stays auditable without accepting unbounded output.
const RELEASE_RECEIPT_MAX_BUFFER = 64 * 1024 * 1024;

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    shell: false,
    maxBuffer: RELEASE_RECEIPT_MAX_BUFFER,
    ...options,
  });
  return {
    command: [command, ...args].join(' '),
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    error: result.error ? result.error.message : '',
  };
};

// Long-running PostgreSQL gates must stream directly to their receipt files.
// Capturing TAP output in spawnSync memory is unreliable on Windows even with
// a large maxBuffer, and can turn a healthy gate into a false `-1` result.
const runToReceipt = (command, args, stdoutPath, stderrPath, options = {}) => {
  mkdirSync(dirname(stdoutPath), { recursive: true });
  const stdoutFd = openSync(stdoutPath, 'w');
  const stderrFd = openSync(stderrPath, 'w');
  try {
    const result = spawnSync(command, args, {
      shell: false,
      stdio: ['ignore', stdoutFd, stderrFd],
      ...options,
    });
    return {
      command: [command, ...args].join(' '),
      status: result.status,
      error: result.error ? result.error.message : '',
    };
  } finally {
    closeSync(stdoutFd);
    closeSync(stderrFd);
  }
};

const git = (...args) => run('git', args);
const writeText = (path, text) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, 'utf8');
};
const writeJson = (path, value) => writeText(path, `${JSON.stringify(value, null, 2)}\n`);
const readJson = path => JSON.parse(readFileSync(path, 'utf8'));
const rel = path => relative(process.cwd(), path).replaceAll('\\', '/');
const digest = text => `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`;

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
  { name: 'wbs-e2e-harness', command: 'npm.cmd run wbs:e2e', requiredExit: 0, scope: 'sanitized WBS contract fixture through raw/hash/version/scope, exceptions, balanced Suggested Draft, separated workflow, GL/TB/BS/IS and source return; never provider/live evidence' },
  { name: 'external-release-gate-local-sim', command: 'node tools/create-local-release-simulation.mjs; load outputs/local-release-simulation/env.json; npm.cmd run verify:external-release-gate', requiredExit: 0, scope: 'aggregate simulated provider evidence' },
  { name: 'server-test', command: 'npm.cmd --prefix server test', requiredExit: 0, scope: 'server unit/integration gate' },
  { name: 'server-pg15-fresh', command: 'POSTGRES_IMAGE=postgres:15-alpine npm.cmd --prefix server run test:postgres:fresh', requiredExit: 0, scope: 'fresh PostgreSQL 15 gate with cleanup evidence' },
  { name: 'server-pg16-fresh', command: 'POSTGRES_IMAGE=postgres:16-alpine npm.cmd --prefix server run test:postgres:fresh', requiredExit: 0, scope: 'fresh PostgreSQL 16 gate with cleanup evidence' },
  { name: 'server-attachments-containers', command: 'npm.cmd --prefix server run test:attachments:containers', requiredExit: 0, scope: 'versioned object storage and malware scanner container gate' },
  { name: 'live-ui-22-page', command: 'npm.cmd run verify:authoritative-runtime-evidence', requiredExit: 0, scope: 'real authenticated evidence for all 22 authoritative business pages, including AP/AR/JE/Bank/Reconciliation/WBS/real-estate reports; not satisfied by local simulation' },
  { name: 'provider-s3-scanner', command: 'npm.cmd run verify:release-s3-scanner', requiredExit: 0, scope: 'real provider S3/scanner lifecycle; not satisfied by local simulation' },
  { name: 'provider-wbs-receipt', command: 'npm.cmd run verify:release-wbs-receipt', requiredExit: 0, scope: 'real WBS signed nonempty receipt; not satisfied by local simulation' },
  { name: 'stage1-payable-live-chain', command: 'npm.cmd run verify:stage1-payable-live-acceptance -- --provider-trust <pinned-trust.json> --receipt <receipt.json> --request-raw <request.raw> --response-raw <response.raw> --package-raw <package.json> --chain <stage1-chain.json>', requiredExit: 0, scope: 'real signed Payable attachment → separated roles → same posted JE → GL/TB/AP Aging; not satisfied by local simulation' },
  { name: 'stage2-bank-live-chain', command: 'npm.cmd run verify:stage2-bank-live-chain', requiredExit: 0, scope: 'real signed-off Bank match to immutable snapshot to posted JE to GL/TB/BS/Cash Flow readback; read-only and not satisfied by local simulation' },
  { name: 'stage3-wbs-live-chain', command: 'npm.cmd run verify:stage3-wbs-live-chain -- --provider-trust <pinned-trust.json> --receipt <receipt.json> --request-raw <request.raw> --response-raw <response.raw> --package-raw <package.json> --ingress <ingress.json> --g11 <g11.json> --gl-report <gl-report.json>', requiredExit: 0, scope: 'real signed WBS multi-source ingress to reviewed staging to G11 posted journals to tied GL/report evidence; read-only and not satisfied by local simulation' },
  { name: 'stage3-g11-live-chain', command: 'npm.cmd run verify:stage3-g11-live-chain', requiredExit: 0, scope: 'same-release authenticated GET-only ACCEPTED review→released candidate→PAYABLE_INCUR/AUTOC events→two distinct AUTO POSTED JEs→raw line/ledger IDs→291001 member allocation/net zero→INCURRED; independently recomputed, not satisfied by offline downstream JSON or local simulation' },
  { name: 'stage3-cost-cwip-live-chain', command: 'npm.cmd run verify:stage3-cost-cwip-live-chain', requiredExit: 0, scope: 'same-release authenticated GET-only WBS_COST_CWIP source-document to POSTED JE to both GL legs to TB/BS/IS readback with exact IDs and MONEY4; must pair with the offline provider-signed gate and does not prove Review/SoD, Insurance/Prepaid, or Property Operations/Rent Pickup' },
  { name: 'stage4-report-live-chain', command: 'npm.cmd run verify:stage4-report-live-chain', requiredExit: 0, scope: 'real immutable financial-statement snapshot row to live statement to GL to posted JE to source-document readback; read-only and not satisfied by local simulation' },
];

// These receipts are deliberately opt-in.  The default bundle records the
// required matrix without claiming that a local command was run.  A release
// operator can execute this exact frozen checkout and retain stdout/stderr
// hashes alongside the manifest with --execute-local (and, where Docker is
// available, one or more --execute-pg15/16/18 flags).
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npmExecutionOptions = process.platform === 'win32' ? { shell: true } : {};
const localExecutionCommands = [
  { name: 'root-test', executable: npmCommand, args: ['test'], options: npmExecutionOptions },
  { name: 'root-build', executable: npmCommand, args: ['run', 'build'], options: npmExecutionOptions },
  { name: 'diff-check', executable: 'git', args: ['diff', '--check'] },
  { name: 'release-harness', executable: npmCommand, args: ['run', 'test:release-harness'], options: npmExecutionOptions },
  { name: 'release-simulation', executable: npmCommand, args: ['run', 'test:release-simulation'], options: npmExecutionOptions },
  { name: 'wbs-e2e-harness', executable: npmCommand, args: ['run', 'wbs:e2e'], options: npmExecutionOptions },
  { name: 'server-test', executable: npmCommand, args: ['--prefix', 'server', 'test'], options: npmExecutionOptions },
  ...requestedPostgresVersions.map(version => ({
    name: `server-pg${version}-fresh`,
    executable: npmCommand,
    args: ['--prefix', 'server', 'run', 'test:postgres:fresh'],
    options: { ...npmExecutionOptions, env: { ...process.env, POSTGRES_IMAGE: `postgres:${version}-alpine` } },
  })),
];

const executionReceipts = [];
if (executeLocal) {
  const receiptRoot = resolve(outRoot, 'local-command-receipts');
  for (const command of localExecutionCommands) {
    const startedAt = new Date().toISOString();
    const stdoutPath = resolve(receiptRoot, `${command.name}.stdout.log`);
    const stderrPath = resolve(receiptRoot, `${command.name}.stderr.log`);
    const result = runToReceipt(command.executable, command.args, stdoutPath, stderrPath, command.options);
    const completedAt = new Date().toISOString();
    const stdout = readFileSync(stdoutPath, 'utf8');
    const stderr = readFileSync(stderrPath, 'utf8');
    executionReceipts.push({
      name: command.name,
      command: result.command,
      status: result.status,
      error: result.error || null,
      started_at: startedAt,
      completed_at: completedAt,
      stdout: rel(stdoutPath),
      stderr: rel(stderrPath),
      stdout_sha256: digest(stdout),
      stderr_sha256: digest(stderr),
    });
  }
}
const localExecutionPassed = executeLocal && executionReceipts.length === localExecutionCommands.length && executionReceipts.every(receipt => receipt.status === 0);

const scriptCoverage = Object.fromEntries(
  ['test', 'build', 'test:release-harness', 'test:release-simulation', 'verify:external-release-gate', 'verify:authoritative-runtime-evidence', 'verify:release-s3-scanner', 'verify:release-wbs-receipt', 'verify:stage1-payable-live-acceptance', 'verify:stage2-bank-live-chain', 'verify:stage3-wbs-live-chain', 'verify:stage3-cost-cwip-live-chain', 'verify:stage3-g11-live-chain', 'verify:stage4-report-live-chain']
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

const origin = git('config', '--get', 'remote.origin.url');
const repositoryMatch = origin.stdout.trim().match(/github\.com[/:]([^/\s]+)\/([^/\s]+?)(?:\.git)?$/);
const repository = repositoryMatch ? `${repositoryMatch[1]}/${repositoryMatch[2]}` : null;
let headCi = { available: false, head_sha: head.stdout.trim(), error: 'GitHub repository unavailable from remote.origin.url' };
if (repository) {
  const checks = run('gh', ['api', `repos/${repository}/commits/${head.stdout.trim()}/check-runs`]);
  if (checks.status === 0) {
    try {
      const payload = JSON.parse(checks.stdout);
      headCi = {
        available: true,
        repository,
        head_sha: head.stdout.trim(),
        total_count: payload.total_count,
        check_runs: (payload.check_runs || []).map(row => ({ name: row.name, status: row.status, conclusion: row.conclusion, details_url: row.details_url })),
      };
    } catch {
      headCi = { available: false, repository, head_sha: head.stdout.trim(), error: 'GitHub check-runs response was invalid JSON' };
    }
  } else {
    headCi = { available: false, repository, head_sha: head.stdout.trim(), error: checks.stderr || checks.stdout || 'GitHub check-runs unavailable' };
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
  local_execution: {
    requested: executeLocal,
    requested_postgres_versions: requestedPostgresVersions,
    status: executeLocal ? (localExecutionPassed ? 'PASS' : 'FAIL') : 'NOT_RUN',
    receipts: executionReceipts,
  },
  required_commands: requiredCommands,
  release_acceptance: {
    local_candidate_gate: 'PASS only after recorded required local commands exit 0 on a clean frozen SHA',
    global_release_gate: 'PARTIAL/FAIL until real HTTPS/OIDC, authenticated 22-page authoritative live E2E, provider S3/scanner lifecycle, signed WBS Payable attachment-to-GL/TB/AP Aging evidence, the signed-off Bank-to-GL/TB/BS/Cash Flow chain, signed WBS multi-source ingress-to-GL/report evidence, and immutable report-snapshot-to-source evidence exist',
  },
  head_ci: headCi,
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
  '## Recorded local execution',
  '',
  `- Status: ${manifest.local_execution.status}`,
  ...(manifest.local_execution.receipts.length ? manifest.local_execution.receipts.map(row => `- ${row.name}: exit ${row.status}; stdout ${row.stdout_sha256}; stderr ${row.stderr_sha256}`) : ['- No commands were executed by this bundle invocation. Use --execute-local to record local evidence.']),
  '',
  '## Release boundary',
  '',
  '- Local candidate gates can pass with deterministic local simulation.',
  '- Global release remains blocked until real HTTPS/OIDC, live authenticated browser evidence, provider S3/scanner, the signed WBS Payable attachment-to-GL/TB/AP Aging chain, the signed-off Bank-to-GL/TB/BS/Cash Flow chain, signed WBS multi-source ingress-to-GL/report evidence, and immutable report-snapshot-to-source evidence are present.',
  '',
].join('\n'));

console.log(`release-evidence-bundle: wrote ${outRoot}`);
console.log(`release-evidence-bundle: clean=${clean} sha=${manifest.head_sha}`);
if (executeLocal && !localExecutionPassed) {
  console.error('RELEASE_EVIDENCE_LOCAL_COMMAND_FAILED: inspect local-command-receipts in the generated bundle');
  process.exitCode = 2;
}
