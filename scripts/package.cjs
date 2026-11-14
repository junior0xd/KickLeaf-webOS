const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { readProject, stageApp, stageService } = require('./project.cjs');

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${path.basename(command)} falhou (saída ${result.status}).`);
}

try {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 1 || args[0] !== '--info')) throw new Error('Uso: npm run package ou npm run package:info');
  const root = path.resolve(__dirname, '..');
  const project = readProject(root);
  const cliRoot = path.dirname(require.resolve('@webos-tools/cli/package.json'));
  const cli = (name, options) => run(process.execPath, [path.join(cliRoot, 'bin', `${name}.js`), ...options]);
  cli('ares-config', ['--profile', 'tv']);
  if (!args.length) {
    const staging = stageApp(root, project), serviceStaging = stageService(root,project);
    fs.mkdirSync(path.dirname(project.artifact), { recursive: true });
    // Evita que uma saída antiga seja aceita se a CLI não gerar o arquivo esperado.
    fs.rmSync(project.artifact, { force: true });
    cli('ares-package', ['--no-minify', staging, serviceStaging, '--outdir', path.dirname(project.artifact)]);
  } else {
    cli('ares-package', ['--info-detail', project.artifact]);
  }
  run('python3', [path.join(root, 'scripts/verify-package.py'), project.artifact]);
  console.log(`Pacote validado: ${project.artifact}`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
