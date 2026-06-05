const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const { execFile, spawn } = require('child_process');
const crypto = require('crypto');
const os = require('os');

// ─── КОНФИГУРАЦИЯ ────────────────────────────────────────────────────────────
const CONFIG = {
  // Замените на ваш GitHub username/repo
  githubOwner: 'exxpion',
  githubRepo: 'shiza-launcher',

  // Версии
  mcVersion: '1.20.4',
  forgeVersion: '1.20.4-49.1.0',

  // Папка установки (.minecraft в AppData)
  gameDir: path.join(os.homedir(), 'AppData', 'Roaming', '.yourserver'),
};

CONFIG.modsDir     = path.join(CONFIG.gameDir, 'mods');
CONFIG.configsDir  = path.join(CONFIG.gameDir, 'config');
CONFIG.manifestUrl = `https://raw.githubusercontent.com/${CONFIG.githubOwner}/${CONFIG.githubRepo}/main/manifest.json`;
CONFIG.forgeUrl    = `https://maven.minecraftforge.net/net/minecraftforge/forge/${CONFIG.forgeVersion}/forge-${CONFIG.forgeVersion}-installer.jar`;
CONFIG.javaApiUrl  = 'https://api.adoptium.net/v3/assets/latest/21/hotspot?os=windows&architecture=x64&image_type=jre';

let mainWindow;

// ─── СОЗДАНИЕ ОКНА ───────────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 580,
    minWidth: 900,
    minHeight: 580,
    maxWidth: 900,
    maxHeight: 580,
    frame: false,         // Без стандартного заголовка Windows — свой дизайн
    resizable: false,
    backgroundColor: '#0a0e1a',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
    icon: path.join(__dirname, '..', 'assets', 'icon.ico'),
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  // Автообновление лаунчера
  if (!process.argv.includes('--dev')) {
    autoUpdater.checkForUpdatesAndNotify();
  }
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());

// ─── ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ─────────────────────────────────────────────────

function send(event, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(event, data);
  }
}

function log(msg) {
  console.log(msg);
  send('log', msg);
}

function downloadFile(url, dest, onProgress) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(dest);

    proto.get(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close();
        fs.unlinkSync(dest);
        return downloadFile(res.headers.location, dest, onProgress)
          .then(resolve).catch(reject);
      }
      const total = parseInt(res.headers['content-length'] || '0', 10);
      let downloaded = 0;
      res.on('data', chunk => {
        downloaded += chunk.length;
        if (total && onProgress) onProgress(downloaded / total);
      });
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
    }).on('error', err => {
      fs.unlink(dest, () => {});
      reject(err);
    });
  });
}

function md5File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('md5');
    const stream = fs.createReadStream(filePath);
    stream.on('data', d => hash.update(d));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http;
    proto.get(url, { headers: { 'User-Agent': 'MCLauncher/1.0' } }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return fetchJson(res.headers.location).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

// ─── ПОИСК JAVA ──────────────────────────────────────────────────────────────

async function findJava() {
  const javaInGame = path.join(CONFIG.gameDir, 'java', 'bin', 'java.exe');
  if (fs.existsSync(javaInGame)) return javaInGame;

  // Проверить системную Java
  return new Promise(resolve => {
    execFile('java', ['-version'], (err) => {
      resolve(err ? null : 'java');
    });
  });
}

async function installJava() {
  log('☕ Скачиваю Java 21...');
  const javaDir = path.join(CONFIG.gameDir, 'java');
  const zipPath  = path.join(CONFIG.gameDir, 'java.zip');

  const api = await fetchJson(CONFIG.javaApiUrl);
  const asset = api[0]?.binary?.package;
  if (!asset) throw new Error('Не удалось получить ссылку на Java');

  await downloadFile(asset.link, zipPath, p => {
    send('progress', { label: 'Загрузка Java...', value: p });
  });

  log('📦 Распаковываю Java...');
  const extractZip = require('extract-zip');
  await extractZip(zipPath, { dir: javaDir });
  fs.unlinkSync(zipPath);

  // Найти java.exe внутри распакованной папки
  const entries = fs.readdirSync(javaDir);
  const jreFolder = entries.find(e => e.startsWith('jdk') || e.startsWith('jre'));
  if (jreFolder) {
    const src = path.join(javaDir, jreFolder);
    const items = fs.readdirSync(src);
    items.forEach(item => {
      fs.renameSync(path.join(src, item), path.join(javaDir, item));
    });
    fs.rmdirSync(src);
  }

  log('✅ Java установлена');
  return path.join(javaDir, 'bin', 'java.exe');
}

// ─── ПРОВЕРКА И УСТАНОВКА FORGE ──────────────────────────────────────────────

async function ensureForge(javaPath) {
  const versionDir = path.join(CONFIG.gameDir, 'versions', `${CONFIG.forgeVersion}`);
  const versionJson = path.join(versionDir, `${CONFIG.forgeVersion}.json`);

  if (fs.existsSync(versionJson)) {
    log('✅ Forge уже установлен');
    return;
  }

  log('⚙️ Скачиваю Forge installer...');
  const installerPath = path.join(CONFIG.gameDir, 'forge-installer.jar');
  await downloadFile(CONFIG.forgeUrl, installerPath, p => {
    send('progress', { label: 'Загрузка Forge...', value: p });
  });

  log('⚙️ Устанавливаю Forge (это займёт минуту)...');
  send('progress', { label: 'Установка Forge...', value: -1 }); // indeterminate

  await new Promise((resolve, reject) => {
    const proc = execFile(javaPath, [
      '-jar', installerPath,
      '--installClient', CONFIG.gameDir
    ], (err) => {
      if (err) reject(err); else resolve();
    });
    proc.stdout?.on('data', d => log(d.toString().trim()));
    proc.stderr?.on('data', d => log(d.toString().trim()));
  });

  fs.unlinkSync(installerPath);
  log('✅ Forge установлен');
}

// ─── СИНХРОНИЗАЦИЯ МОДОВ ─────────────────────────────────────────────────────

async function syncMods() {
  log('🔍 Проверяю моды...');
  if (!fs.existsSync(CONFIG.modsDir)) fs.mkdirSync(CONFIG.modsDir, { recursive: true });

  let manifest;
  try {
    manifest = await fetchJson(CONFIG.manifestUrl);
  } catch (e) {
    log('⚠️ Не удалось загрузить манифест. Проверьте соединение.');
    return;
  }

  const { mods } = manifest;
  let i = 0;

  for (const mod of mods) {
    i++;
    const dest = path.join(CONFIG.modsDir, mod.filename);
    send('progress', { label: `Проверка модов (${i}/${mods.length})...`, value: i / mods.length });

    // Проверить MD5
    if (fs.existsSync(dest)) {
      const hash = await md5File(dest);
      if (hash === mod.md5) continue; // файл актуален
    }

    log(`⬇️ Скачиваю ${mod.filename}...`);
    await downloadFile(mod.url, dest, p => {
      send('progress', { label: `Скачиваю ${mod.filename}...`, value: p });
    });
  }

  // Удалить моды которых нет в манифесте
  const allowed = new Set(mods.map(m => m.filename));
  for (const file of fs.readdirSync(CONFIG.modsDir)) {
    if (file.endsWith('.jar') && !allowed.has(file)) {
      fs.unlinkSync(path.join(CONFIG.modsDir, file));
      log(`🗑️ Удалён устаревший мод: ${file}`);
    }
  }

  log('✅ Все моды актуальны');
}

// ─── ЗАПУСК ИГРЫ ─────────────────────────────────────────────────────────────

async function launchGame(username, isLicensed) {
  log('🚀 Запускаю игру...');

  const javaExe = await findJava() || await installJava();

  await ensureForge(javaExe);
  await syncMods();

  // Читаем launch-параметры из forge version json
  const versionId = `forge-${CONFIG.forgeVersion}`;
  const versionJsonPath = path.join(CONFIG.gameDir, 'versions', versionId, `${versionId}.json`);

  let mainClass = 'cpw.mods.bootstraplauncher.BootstrapLauncher';
  let gameArgs = [];

  if (fs.existsSync(versionJsonPath)) {
    const vJson = JSON.parse(fs.readFileSync(versionJsonPath, 'utf8'));
    mainClass = vJson.mainClass || mainClass;
  }

  const uuid = isLicensed
    ? '00000000-0000-0000-0000-000000000000' // заменить на реальный OAuth
    : '00000000-0000-0000-0000-' + Buffer.from(username).toString('hex').padEnd(12, '0').slice(0, 12);

  const jvmArgs = [
    '-Xmx4G', '-Xms1G',
    `-Djava.library.path=${path.join(CONFIG.gameDir, 'natives')}`,
    '-cp', buildClasspath(),
    mainClass,
  ];

  gameArgs = [
    '--username', username,
    '--version', CONFIG.mcVersion,
    '--gameDir', CONFIG.gameDir,
    '--assetsDir', path.join(CONFIG.gameDir, 'assets'),
    '--assetIndex', CONFIG.mcVersion,
    '--uuid', uuid,
    '--accessToken', isLicensed ? 'REAL_TOKEN' : 'offline',
    '--userType', isLicensed ? 'msa' : 'legacy',
  ];

  const proc = spawn(javaExe, [...jvmArgs, ...gameArgs], {
    cwd: CONFIG.gameDir,
    detached: true,
    stdio: 'ignore',
  });

  proc.unref();
  send('game-launched', true);
  log('✅ Игра запущена!');
}

function buildClasspath() {
  const libDir = path.join(CONFIG.gameDir, 'libraries');
  const jars = [];

  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const f of fs.readdirSync(dir)) {
      const full = path.join(dir, f);
      if (fs.statSync(full).isDirectory()) walk(full);
      else if (f.endsWith('.jar')) jars.push(full);
    }
  }

  walk(libDir);

  const versionJar = path.join(CONFIG.gameDir, 'versions', CONFIG.mcVersion, `${CONFIG.mcVersion}.jar`);
  if (fs.existsSync(versionJar)) jars.push(versionJar);

  return jars.join(path.delimiter);
}

// ─── IPC СОБЫТИЯ ─────────────────────────────────────────────────────────────

ipcMain.on('launch', async (_, { username, isLicensed }) => {
  try {
    await launchGame(username, isLicensed);
  } catch (err) {
    log('❌ Ошибка: ' + err.message);
    send('error', err.message);
  }
});

ipcMain.on('minimize', () => mainWindow.minimize());
ipcMain.on('close', () => app.quit());

// Автообновление лаунчера
autoUpdater.on('update-downloaded', () => {
  send('launcher-update-ready', true);
});
ipcMain.on('install-update', () => {
  autoUpdater.quitAndInstall();
});
