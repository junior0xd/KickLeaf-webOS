const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const { readProject } = require('./project.cjs');

try {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--tag' || !args[1])) {
    throw new Error('Uso: npm run validate [-- --tag vX.Y.Z]');
  }
  const root = path.resolve(__dirname, '..');
  const project = readProject(root, args.length ? args[1] : undefined);
  for (const name of project.files.filter(name => name.endsWith('.js'))) {
    const result = spawnSync(process.execPath, ['--check', path.join(root, 'app', name)], { stdio: 'inherit' });
    if (result.error || result.status !== 0) throw new Error(`JavaScript inválido: ${name}`);
  }
  // Caminho calculado somente de metadados validados, nunca de glob sobre dist/.
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `ipk=dist/releases/${project.filename}\n`);
  }
  console.log(`Projeto válido: ${project.manifest.id} ${project.manifest.version}${args.length ? ` (tag ${args[1]})` : ''}`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
