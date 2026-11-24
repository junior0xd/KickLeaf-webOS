'use strict';

const {execFileSync} = require('node:child_process');
const {existsSync, readFileSync, writeFileSync} = require('node:fs');

function readNotes(tag) {
  const override = `release-notes/${tag}.md`;
  if (existsSync(override)) return readFileSync(override, 'utf8');
  const versions = readFileSync('CHANGELOG.md', 'utf8').split(/^## /m);
  const version = versions.find(section => section.split(/\r?\n/, 1)[0].split(/\s+/, 1)[0] === tag);
  const section = version?.split(/^### /m).find(part => part.split(/\r?\n/, 1)[0].trim() === 'Release Notes');
  return section?.slice(section.indexOf('\n') + 1) ?? '';
}

function main([tag, repository, output]) {
  if (!/^v\d+\.\d+\.\d+$/.test(tag ?? '') ||
      !/^https:\/\/github\.com\/[a-z\d_.-]+\/[a-z\d_.-]+$/i.test(repository ?? '') || !output) {
    throw new Error('Usage: node scripts/release-notes.cjs <tag> <GitHub repository URL> <output>');
  }
  const notes = readNotes(tag).trim();
  const bullets = notes.split(/\r?\n/).filter(line => line.trim());
  if (!notes || bullets.some(line => !/^- [A-Za-z\d`*][^\r\n]*$/.test(line) || /full changelog/i.test(line))) {
    throw new Error(`Add English release bullets under "### Release Notes" for ${tag} in CHANGELOG.md, or in release-notes/${tag}.md.`);
  }
  execFileSync('git', ['rev-parse', '--verify', `refs/tags/${tag}^{commit}`], {stdio:'ignore'});
  const candidates = execFileSync('git', ['tag', '--merged', tag, '--sort=-version:refname'], {encoding:'utf8'})
    .trim().split('\n');
  const version = value => value.slice(1).split('.').map(Number);
  const precedes = candidate => {
    const current = version(tag);
    const other = version(candidate);
    const index = current.findIndex((part, i) => part !== other[i]);
    return index !== -1 && other[index] < current[index];
  };
  const previous = candidates.find(candidate => /^v\d+\.\d+\.\d+$/.test(candidate) && precedes(candidate));
  const changelog = previous ? `compare/${previous}...${tag}` : `commits/${tag}`;
  writeFileSync(output, `## What's Changed\n\n${bullets.join('\n')}\n\n**Full Changelog:** ${repository}/${changelog}\n`);
}

try {
  main(process.argv.slice(2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
