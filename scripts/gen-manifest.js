/**
 * Запустите этот скрипт в папке с модами:
 *   node scripts/gen-manifest.js ./mods
 *
 * Он выведет готовый manifest.json с MD5 хешами.
 */

const fs   = require('fs');
const path = require('path');
const crypto = require('crypto');

const GITHUB_OWNER = 'exxpion';
const GITHUB_REPO  = 'shiza-launcher';
const BASE_URL     = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/download/mods`;

const modsDir = process.argv[2] || './mods';

if (!fs.existsSync(modsDir)) {
  console.error('Папка не найдена:', modsDir);
  process.exit(1);
}

const files = fs.readdirSync(modsDir).filter(f => f.endsWith('.jar'));
const mods  = files.map(filename => {
  const data = fs.readFileSync(path.join(modsDir, filename));
  const md5  = crypto.createHash('md5').update(data).digest('hex');
  return { filename, url: `${BASE_URL}/${filename}`, md5 };
});

const manifest = {
  version:      '1.0.0',
  mcVersion:    '1.20.4',
  forgeVersion: '1.20.4-49.1.0',
  mods,
};

const out = JSON.stringify(manifest, null, 2);
fs.writeFileSync('manifest.json', out);
console.log('✅ manifest.json создан:');
console.log(out);
