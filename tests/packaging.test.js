const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readProject, stageApp, stageService, serviceRuntimeFiles } = require('../scripts/project.cjs');

const source = path.resolve(__dirname, '..');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kicktv-packaging-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const name of ['app', 'service', 'package.json', 'package-lock.json', 'packaging.json']) {
    fs.cpSync(path.join(source, name), path.join(root, name), { recursive: true });
  }
  return root;
}
function edit(root, filename, callback) {
  const file = path.join(root, filename);
  const data = JSON.parse(fs.readFileSync(file));
  callback(data);
  fs.writeFileSync(file, JSON.stringify(data));
}
function differentVersion(root) {
  return JSON.parse(fs.readFileSync(path.join(root, 'app/appinfo.json'))).version === '0.0.0' ? '1.0.0' : '0.0.0';
}

test('valida a tag exata e calcula o nome do IPK pela versão do manifesto', t => {
  const root = fixture(t);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'app/appinfo.json')));
  const project = readProject(root, `v${manifest.version}`);
  assert.equal(manifest.main, 'native-hls.html');
  assert.ok(!project.files.includes('index.html'));
  assert.ok(!project.files.includes('app.js'));
  assert.equal(project.filename, `${manifest.id}_${manifest.version}_all.ipk`);
});

test('recusa tags divergentes, incompletas, prerelease e conteúdo de shell', t => {
  const root = fixture(t);
  for (const tag of ['', '0.1.0', `v${differentVersion(root)}`, 'v1', 'v0.1.0-beta.1', 'v0.1.0; echo injected']) {
    assert.throws(() => readProject(root, tag), /Tag inválida/);
  }
});

test('recusa versões não instaláveis no webOS', t => {
  const root = fixture(t);
  for (const version of ['00.1.0', '1.0', '1.0.0-beta', '1000000000.0.0', '1.0.-1']) {
    edit(root, 'app/appinfo.json', data => { data.version = version; });
    assert.throws(() => readProject(root), /Versão inválida/);
  }
});

test('recusa package.json e lockfile com versões divergentes', t => {
  const root = fixture(t);
  const version = differentVersion(root);
  edit(root, 'package.json', data => { data.version = version; });
  assert.throws(() => readProject(root), /devem coincidir/);
  fs.copyFileSync(path.join(source, 'package.json'), path.join(root, 'package.json'));
  edit(root, 'package-lock.json', data => { data.packages[''].version = version; });
  assert.throws(() => readProject(root), /devem coincidir/);
});

test('exclui credenciais, dependências, testes e arquivos temporários mesmo dentro de app/', t => {
  const root = fixture(t);
  for (const name of ['.env', 'credentials.json', 'scratch.tmp', 'app.js.map', 'README.md']) {
    fs.writeFileSync(path.join(root, 'app', name), 'arquivo que não pode ser empacotado');
  }
  for (const name of ['node_modules', 'tests', '.ssh']) {
    fs.mkdirSync(path.join(root, 'app', name));
    fs.writeFileSync(path.join(root, 'app', name, 'private.key'), 'segredo fictício de teste');
  }
  const project = readProject(root);
  const staging = stageApp(root, project);
  // Uma segunda preparação também elimina sobras do build anterior.
  fs.writeFileSync(path.join(staging, 'stale.env'), 'sobra');
  stageApp(root, project);
  assert.deepEqual(fs.readdirSync(staging,{recursive:true}).filter(n=>fs.statSync(path.join(staging,n)).isFile()).sort(), [...project.files].sort());
  for (const name of project.files) {
    assert.deepEqual(fs.readFileSync(path.join(staging, name)), fs.readFileSync(path.join(root, 'app', name)));
  }
});

test('recusa links simbólicos no lugar de um arquivo de execução', t => {
  const root = fixture(t);
  fs.unlinkSync(path.join(root, 'app', 'native-hls.js'));
  fs.symlinkSync(path.join(source, 'app/native-hls.js'), path.join(root, 'app', 'native-hls.js'));
  assert.throws(() => readProject(root), /não regular/);
});

test('recusa caminhos externos na lista e falha se um arquivo necessário faltar', t => {
  const root = fixture(t);
  edit(root, 'packaging.json', data => { data.files.push('../credentials.json'); });
  assert.throws(() => readProject(root), /sem diretórios/);
  fs.copyFileSync(path.join(source, 'packaging.json'), path.join(root, 'packaging.json'));
  fs.unlinkSync(path.join(root, 'app/native-hls.html'));
  assert.throws(() => readProject(root), /ENOENT/);
});


test('inclui somente o serviço listado e ws bloqueado no lockfile', t => {
  const root=fixture(t), project=readProject(root);
  fs.writeFileSync(path.join(root,'service','.env'),'segredo fictício');
  fs.mkdirSync(path.join(root,'service','node_modules','unlisted'));
  fs.writeFileSync(path.join(root,'service','node_modules','unlisted','extra.js'),'não empacotar');
  const staging=stageService(root,project);
  assert.deepEqual(fs.readdirSync(staging,{recursive:true}).filter(n=>fs.statSync(path.join(staging,n)).isFile()).sort(),serviceRuntimeFiles(root,project).sort());
  assert.equal(fs.existsSync(path.join(staging,'.env')),false);
  assert.equal(fs.existsSync(path.join(staging,'node_modules/unlisted')),false);
  fs.symlinkSync(path.join(root,'package.json'),path.join(root,'service/node_modules/ws/unsafe.json'));
  assert.throws(()=>stageService(root,project),/não permitido/);
});
