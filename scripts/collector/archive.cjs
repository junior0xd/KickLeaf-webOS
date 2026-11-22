'use strict';

const { link, readFile, readdir, rename, unlink, writeFile } = require('node:fs/promises');
const path = require('node:path');

const sampleName = /^(player|chat|metadados|amostra)-\d+\.json$/;

async function readRows(folder, files) {
  if (files.includes('samples.jsonl')) {
    const input = await readFile(path.join(folder, 'samples.jsonl'), 'utf8');
    return input.split('\n').filter(Boolean).map(line => JSON.parse(line));
  }
  const rows = [];
  for (const name of files.filter(name => sampleName.test(name)).sort()) {
    const row = JSON.parse(await readFile(path.join(folder, name), 'utf8'));
    rows.push({ ...row, type: name.match(sampleName)[1] });
  }
  return rows;
}

async function archive(folder, keepFiles) {
  const files = await readdir(folder);
  if (files.includes('eventos.jsonl') && !files.includes('events.jsonl')) {
    // Both names refer to the same data.
    await link(path.join(folder, 'eventos.jsonl'), path.join(folder, 'events.jsonl'));
  }
  if (files.includes('samples.jsonl')) return;
  const rows = (await readRows(folder, files)).sort((a, b) => a.scheduled_ms - b.scheduled_ms);
  const content = rows.map(row => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : '');
  const file = path.join(folder, 'samples.jsonl');
  await writeFile(file + '.tmp', content, { flag: 'wx' });
  const check = await readFile(file + '.tmp', 'utf8');
  if (check !== content || check.split('\n').filter(Boolean).map(line => JSON.parse(line)).length !== rows.length) {
    throw new Error('A verificação de samples.jsonl falhou.');
  }
  await rename(file + '.tmp', file);
  if (!keepFiles) {
    for (const name of files.filter(name => sampleName.test(name))) await unlink(path.join(folder, name));
  }
}

module.exports = { readRows, archive };
