const fs = require('node:fs');
const path = require('node:path');

// webOS exige três inteiros de até nove dígitos, sem zeros à esquerda.
const VERSION = /^(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})$/;

function readProject(root, tag) {
  const readJSON = name => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
  const manifest = readJSON('app/appinfo.json');
  const pkg = readJSON('package.json');
  const lock = readJSON('package-lock.json');
  const { files } = readJSON('packaging.json');
  if (!VERSION.test(manifest.version)) throw new Error('Versão inválida em app/appinfo.json: use X.Y.Z, sem sufixos ou zeros à esquerda.');
  if (pkg.version !== manifest.version || lock.version !== manifest.version || lock.packages?.['']?.version !== manifest.version) {
    throw new Error('As versões de appinfo.json, package.json e package-lock.json devem coincidir.');
  }
  if (tag !== undefined && tag !== `v${manifest.version}`) {
    throw new Error(`Tag inválida ou divergente: esperado v${manifest.version}, recebido ${JSON.stringify(tag)}.`);
  }
  if (!/^[a-z0-9][a-z0-9.-]+$/.test(manifest.id)) throw new Error('ID inválido em appinfo.json.');
  if (!Array.isArray(files) || files.length === 0 || new Set(files).size !== files.length ||
      files.some(name => typeof name !== 'string' || !/^[a-zA-Z0-9_-]+\.(html|js|css|png|json)$/.test(name))) {
    throw new Error('packaging.json deve listar arquivos de execução, sem diretórios ou caminhos relativos.');
  }
  if (manifest.type !== 'web' || !['appinfo.json', manifest.main, manifest.icon, manifest.largeIcon].every(name => files.includes(name))) {
    throw new Error('Manifesto web ou arquivos de entrada/ícones ausentes na lista de empacotamento.');
  }
  const appDir = path.join(root, 'app');
  if (!fs.lstatSync(appDir).isDirectory() || fs.lstatSync(appDir).isSymbolicLink()) throw new Error('app/ deve ser um diretório real.');
  for (const name of files) {
    if (!fs.lstatSync(path.join(appDir, name)).isFile()) throw new Error(`Arquivo de execução ausente ou não regular: ${name}`);
  }
  const filename = `${manifest.id}_${manifest.version}_all.ipk`;
  return { manifest, files, filename, artifact: path.join(root, 'dist/releases', filename) };
}

function stageApp(root, project) {
  const staging = path.join(root, '.build/webos-app');
  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(staging, { recursive: true });
  for (const name of project.files) {
    fs.copyFileSync(path.join(root, 'app', name), path.join(staging, name));
  }
  return staging;
}

module.exports = { readProject, stageApp };
