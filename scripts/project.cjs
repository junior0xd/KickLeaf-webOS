const fs = require('node:fs');
const path = require('node:path');

// webOS exige três inteiros de até nove dígitos, sem zeros à esquerda.
const VERSION = /^(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})$/;

function readProject(root, tag) {
  const readJSON = name => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
  const manifest = readJSON('app/appinfo.json');
  const pkg = readJSON('package.json');
  const lock = readJSON('package-lock.json');
  const { files, serviceFiles } = readJSON('packaging.json');
  if (!VERSION.test(manifest.version)) throw new Error('Versão inválida em app/appinfo.json: use X.Y.Z, sem sufixos ou zeros à esquerda.');
  if (pkg.version !== manifest.version || lock.version !== manifest.version || lock.packages?.['']?.version !== manifest.version) {
    throw new Error('As versões de appinfo.json, package.json e package-lock.json devem coincidir.');
  }
  if (tag !== undefined && tag !== `v${manifest.version}`) {
    throw new Error(`Tag inválida ou divergente: esperado v${manifest.version}, recebido ${JSON.stringify(tag)}.`);
  }
  if (!/^[a-z0-9][a-z0-9.-]+$/.test(manifest.id)) throw new Error('ID inválido em appinfo.json.');
  if (!Array.isArray(files) || files.length === 0 || new Set(files).size !== files.length ||
      files.some(name => typeof name !== 'string' || !/^(?:[a-zA-Z0-9_-]+\.(?:html|js|css|png|json|svg|txt)|badge-icons\/(?:[a-zA-Z0-9_-]+\.svg|LICENSE))$/.test(name))) {
    throw new Error('packaging.json deve listar arquivos de execução, sem diretórios ou caminhos relativos.');
  }
  if (manifest.type !== 'web' || !['appinfo.json', manifest.main, manifest.icon, manifest.largeIcon].every(name => files.includes(name))) {
    throw new Error('Manifesto web ou arquivos de entrada/ícones ausentes na lista de empacotamento.');
  }
  const appDir = path.join(root, 'app');
  if (!fs.lstatSync(appDir).isDirectory() || fs.lstatSync(appDir).isSymbolicLink()) throw new Error('app/ deve ser um diretório real.');
  for (const directory of new Set(files.map(name => path.dirname(name)))) {
    if (!fs.lstatSync(path.join(appDir, directory)).isDirectory()) throw new Error(`Diretório de execução inválido: ${directory}`);
  }
  for (const name of files) {
    if (!fs.lstatSync(path.join(appDir, name)).isFile()) throw new Error(`Arquivo de execução ausente ou não regular: ${name}`);
  }
  if (!Array.isArray(serviceFiles) || !serviceFiles.length || new Set(serviceFiles).size!==serviceFiles.length || serviceFiles.some(n=>typeof n!=='string'||!/^[a-zA-Z0-9_-]+\.(js|json)$/.test(n))) throw new Error('Lista do serviço inválida.');
  const service = readJSON('service/package.json'), serviceLock = readJSON('service/package-lock.json'), services = readJSON('service/services.json');
  if (service.name!==manifest.id+'.service' || service.version!==manifest.version || serviceLock.version!==service.version || serviceLock.packages[''].version!==service.version || serviceLock.name!==service.name || serviceLock.packages[''].name!==service.name || service.dependencies?.ws!=='8.22.2' || Object.keys(service.dependencies).length!==1 || services.id!==service.name || services.services.length!==1 || services.services[0].name!==service.name) throw new Error('Identidade, versão ou dependências do serviço inválidas.');
  for (const name of ['service.js','services.json','package.json','package-lock.json']) if (!serviceFiles.includes(name)) throw new Error('Arquivo obrigatório do serviço ausente.');
  if (fs.lstatSync(path.join(root,'service')).isSymbolicLink()) throw new Error('Diretório do serviço inválido.');
  for (const name of serviceFiles) if (!fs.lstatSync(path.join(root,'service',name)).isFile()) throw new Error('Arquivo do serviço não regular.');
  const filename = `${manifest.id}_${manifest.version}_all.ipk`;
  return { manifest, files, serviceFiles, filename, artifact: path.join(root, 'dist/releases', filename) };
}

function stageApp(root, project) {
  const staging = path.join(root, '.build/webos-app');
  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(staging, { recursive: true });
  for (const name of project.files) {
    fs.mkdirSync(path.dirname(path.join(staging,name)),{recursive:true});
    fs.copyFileSync(path.join(root, 'app', name), path.join(staging, name));
  }
  return staging;
}

function serviceRuntimeFiles(root, project) {
  const base=path.join(root,'service'), ws=path.join(base,'node_modules/ws');
  if (fs.lstatSync(path.join(base,'node_modules')).isSymbolicLink() || fs.lstatSync(ws).isSymbolicLink() || JSON.parse(fs.readFileSync(path.join(ws,'package.json'))).version!=='8.22.2') throw new Error('Dependência ws inválida: instale o lockfile do serviço.');
  const result=[...project.serviceFiles];
  function walk(dir) { for (const name of fs.readdirSync(path.join(base,dir))) { const rel=dir+'/'+name, st=fs.lstatSync(path.join(base,rel)); if(st.isSymbolicLink() || (!st.isDirectory()&&!st.isFile()) || name.endsWith('.node')) throw new Error('Conteúdo não permitido na dependência do serviço.'); if(st.isDirectory())walk(rel);else result.push(rel); } }
  walk('node_modules/ws');return result;
}
function stageService(root,project) {
  const staging=path.join(root,'.build/webos-service');fs.rmSync(staging,{recursive:true,force:true});
  for (const name of serviceRuntimeFiles(root,project)) {const dst=path.join(staging,name);fs.mkdirSync(path.dirname(dst),{recursive:true});fs.copyFileSync(path.join(root,'service',name),dst);}
  return staging;
}
module.exports = { readProject, stageApp, stageService, serviceRuntimeFiles };
