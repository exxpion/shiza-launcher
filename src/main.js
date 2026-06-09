const { app, BrowserWindow, ipcMain } = require('electron');
const { autoUpdater } = require('electron-updater');
const { Client, Authenticator } = require('minecraft-launcher-core');
const path = require('path');
const fs = require('fs');
const https = require('https');
const os = require('os');
const crypto = require('crypto');

// ─── КОНФИГУРАЦИЯ ────────────────────────────────────────────────────────────
const CONFIG = {
  githubOwner:  'exxpion',
  githubRepo:   'shiza-launcher',
  mcVersion:    '1.20.4',
  forgeVersion: '1.20.4-49.1.0',
  gameDir:      path.join(os.homedir(), 'AppData', 'Roaming', '.shiza-mc'),
  serverHost:   '203.16.163.171',
  serverPort:   28145,
};

CONFIG.modsDir     = path.join(CONFIG.gameDir, 'mods');
CONFIG.manifestUrl = `https://raw.githubusercontent.com/${CONFIG.githubOwner}/${CONFIG.githubRepo}/main/manifest.json`;
CONFIG.newsUrl     = `https://raw.githubusercontent.com/${CONFIG.githubOwner}/${CONFIG.githubRepo}/main/news.json`;

let mainWindow;

process.on('uncaughtException', (err) => {
  console.error('Uncaught:', err.message);
  send('log', '⚠️ ' + err.message);
});

// ─── ОКНО ────────────────────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900, height: 580,
    minWidth: 900, minHeight: 580,
    maxWidth: 900, maxHeight: 580,
    frame: false, resizable: false,
    backgroundColor: '#0d0d0d',
    webPreferences: { nodeIntegration: true, contextIsolation: false },
    icon: path.join(__dirname, '..', 'assets', 'icon.ico'),
  });
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  mainWindow.webContents.on('did-finish-load', () => {
    setTimeout(() => startServerPing(), 1000);
  });
  if (!process.argv.includes('--dev')) {
  autoUpdater.autoDownload = false;
  autoUpdater.allowDowngrade = false;
  autoUpdater.checkForUpdates().then(result => {
    if (result && result.updateInfo) {
      send('launcher-update-ready', true);
    }
  }).catch(err => {
    console.error('Update check failed:', err.message);
  });
}
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function send(event, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(event, data);
  }
}

function log(msg) { console.log(msg); send('log', msg); }

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'ShizaLauncher/1.0' } }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return fetchJson(res.headers.location).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { reject(e); } });
    }).on('error', reject);
  });
}

function downloadFile(url, dest, onProgress) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : require('http');
    if (fs.existsSync(dest)) { try { fs.unlinkSync(dest); } catch(e) {} }
    const file = fs.createWriteStream(dest);
    proto.get(url, { headers: { 'User-Agent': 'ShizaLauncher/1.0' } }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close();
        return downloadFile(res.headers.location, dest, onProgress).then(resolve).catch(reject);
      }
      const total = parseInt(res.headers['content-length'] || '0', 10);
      let downloaded = 0;
      res.on('data', chunk => {
        downloaded += chunk.length;
        if (total && onProgress) onProgress(downloaded / total);
      });
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
    }).on('error', err => { try { fs.unlinkSync(dest); } catch(e) {} reject(err); });
  });
}

// ─── SERVERS.DAT ─────────────────────────────────────────────────────────────
function createServersDat() {
  const serversDat = path.join(CONFIG.gameDir, 'servers.dat');
  if (fs.existsSync(serversDat)) return;
  const buf = Buffer.from([10,0,0,9,0,7,115,101,114,118,101,114,115,10,0,0,0,1,8,0,4,105,99,111,110,0,0,8,0,2,105,112,0,20,50,48,51,46,49,54,46,49,54,51,46,49,55,49,58,50,56,49,52,53,8,0,4,110,97,109,101,0,12,83,104,105,122,97,32,83,101,114,118,101,114,1,0,14,97,99,99,101,112,116,84,101,120,116,117,114,101,115,1,0,0]);
  fs.writeFileSync(serversDat, buf);
  log('✅ Сервер добавлен в список серверов');
}

// ─── МОДЫ ────────────────────────────────────────────────────────────────────
async function syncMods() {
  log('🔍 Проверяю моды с GitHub...');
  if (!fs.existsSync(CONFIG.modsDir)) fs.mkdirSync(CONFIG.modsDir, { recursive: true });

  let assets;
  try {
    const release = await fetchJson(
      `https://api.github.com/repos/${CONFIG.githubOwner}/${CONFIG.githubRepo}/releases/tags/mods`
    );
    assets = release.assets.filter(a => a.name.endsWith('.jar'));
    log(`📦 Найдено модов на GitHub: ${assets.length}`);
  } catch(e) {
    log('⚠️ Не удалось получить список модов: ' + e.message);
    return;
  }

  for (let i = 0; i < assets.length; i++) {
    const asset = assets[i];
    const dest = path.join(CONFIG.modsDir, asset.name);
    send('progress', { label: `Проверка модов (${i+1}/${assets.length})...`, value: (i+1)/assets.length });
    if (fs.existsSync(dest) && fs.statSync(dest).size === asset.size) continue;
    log(`⬇️ Скачиваю ${asset.name}...`);
    await downloadFile(asset.browser_download_url, dest, p => {
      send('progress', { label: `Скачиваю ${asset.name}...`, value: p });
    });
  }

  const allowed = new Set(assets.map(a => a.name));
  for (const file of fs.readdirSync(CONFIG.modsDir)) {
    if (file.endsWith('.jar') && !allowed.has(file)) {
      fs.unlinkSync(path.join(CONFIG.modsDir, file));
      log(`🗑️ Удалён устаревший мод: ${file}`);
    }
  }
  log('✅ Все моды актуальны');
}

// ─── JAVA 17 ─────────────────────────────────────────────────────────────────
async function getJava17() {
  const localJava = path.join(CONFIG.gameDir, 'java17', 'bin', 'java.exe');
  if (fs.existsSync(localJava)) return localJava;

  const { execSync } = require('child_process');
  const javaPaths = [
    'C:\\Program Files\\Java\\jre-17\\bin\\java.exe',
    'C:\\Program Files\\Java\\jdk-17\\bin\\java.exe',
    'C:\\Program Files\\Eclipse Adoptium\\jre-17\\bin\\java.exe',
    'C:\\Program Files\\Microsoft\\jdk-17\\bin\\java.exe',
  ];
  for (const p of javaPaths) {
    if (fs.existsSync(p)) { log('✅ Найдена системная Java 17'); return p; }
  }

  try {
    const javaHome = process.env.JAVA_HOME;
    if (javaHome) {
      const javaExe = path.join(javaHome, 'bin', 'java.exe');
      if (fs.existsSync(javaExe)) {
        const version = execSync(`"${javaExe}" -version 2>&1`).toString();
        if (version.includes('17') || version.includes('21')) {
          log('✅ Найдена Java через JAVA_HOME'); return javaExe;
        }
      }
    }
  } catch(e) {}

  log('☕ Скачиваю Java 17...');
  const api = await fetchJson('https://api.adoptium.net/v3/assets/latest/17/hotspot?os=windows&architecture=x64&image_type=jre');
  const asset = api[0]?.binary?.package;
  if (!asset) throw new Error('Не удалось найти Java 17');

  const zipPath = path.join(CONFIG.gameDir, 'java17.zip');
  await downloadFile(asset.link, zipPath, p => {
    send('progress', { label: 'Скачиваю Java 17...', value: p });
  });

  log('📦 Распаковываю Java 17...');
  const extractZip = require('extract-zip');
  const javaDir = path.join(CONFIG.gameDir, 'java17');
  fs.mkdirSync(javaDir, { recursive: true });
  await new Promise(r => setTimeout(r, 500));
  await extractZip(zipPath, { dir: javaDir });
  fs.unlinkSync(zipPath);

  const entries = fs.readdirSync(javaDir);
  const inner = entries.find(e => fs.statSync(path.join(javaDir, e)).isDirectory());
  if (inner) {
    const innerPath = path.join(javaDir, inner);
    for (const item of fs.readdirSync(innerPath)) {
      fs.renameSync(path.join(innerPath, item), path.join(javaDir, item));
    }
    fs.rmdirSync(innerPath);
  }

  log('✅ Java 17 готова');
  return localJava;
}

// ─── ЗАПУСК ──────────────────────────────────────────────────────────────────
async function launchGame(username, ram = 2) {
  log('🚀 Запускаю игру...');

  if (!fs.existsSync(CONFIG.gameDir)) fs.mkdirSync(CONFIG.gameDir, { recursive: true });
  if (!fs.existsSync(CONFIG.modsDir)) fs.mkdirSync(CONFIG.modsDir, { recursive: true });

  const java17Dir = path.join(CONFIG.gameDir, 'java17');
  if (!fs.existsSync(java17Dir)) fs.mkdirSync(java17Dir, { recursive: true });

  const profilesPath = path.join(CONFIG.gameDir, 'launcher_profiles.json');
  if (!fs.existsSync(profilesPath)) {
    fs.writeFileSync(profilesPath, JSON.stringify({
      profiles: { default: { name: 'Default', type: 'latest-release' } },
      selectedProfile: 'default',
      clientToken: crypto.randomUUID(),
    }, null, 2));
  }

  createServersDat();
  await syncMods();

  const javaPath = await getJava17();

  const forgeInstallerPath = path.join(CONFIG.gameDir, 'forge-installer.jar');
  const forgeInstallerUrl = `https://maven.minecraftforge.net/net/minecraftforge/forge/${CONFIG.forgeVersion}/forge-${CONFIG.forgeVersion}-installer.jar`;
  if (!fs.existsSync(forgeInstallerPath)) {
    log('⬇️ Скачиваю Forge installer...');
    send('progress', { label: 'Скачиваю Forge...', value: -1 });
    await downloadFile(forgeInstallerUrl, forgeInstallerPath, p => {
      send('progress', { label: 'Скачиваю Forge...', value: p });
    });
  }

  const launcher = new Client();

  launcher.on('debug', (e) => log(String(e)));
  launcher.on('data',  (e) => log(String(e)));
  launcher.on('progress', (e) => {
    if (e.type && e.task !== undefined && e.total !== undefined) {
      send('progress', { label: `${e.type} (${e.task}/${e.total})`, value: e.task / e.total });
    }
  });

  let opts = {
    authorization: Authenticator.getAuth(username),
    root: CONFIG.gameDir,
    version: { number: CONFIG.mcVersion, type: 'release' },
    forge: forgeInstallerPath,
    javaPath: javaPath,
    memory: { max: `${ram}G`, min: '1G' },
    overrides: { gameDirectory: CONFIG.gameDir, detached: true, windowsHide: true },
  };

  launcher.on('close', async (code) => {
    if (code === 1) {
      log('⚙️ Forge установлен, перезапускаю игру...');
      send('progress', { label: 'Перезапуск...', value: -1 });
      await new Promise(r => setTimeout(r, 2000));
      try { await launcher.launch(opts); } catch(e) {
        log('❌ Ошибка перезапуска: ' + e.message);
        send('game-launched', false);
      }
      return;
    }
    log(code === 0 ? '✅ Игра закрыта' : `⚠️ Игра закрыта с кодом ${code}`);
    send('game-launched', false);
  });

  log('⬇️ MCLC скачивает и проверяет файлы...');
  send('progress', { label: 'Подготовка к запуску...', value: -1 });
  await launcher.launch(opts);
  log('✅ Игра запущена!');
  send('game-launched', true);
}

// ─── IPC ─────────────────────────────────────────────────────────────────────
ipcMain.on('launch', async (_, { username, ram }) => {
  try { await launchGame(username, ram); }
  catch(err) {
    log('❌ Ошибка: ' + err.message);
    send('error', err.message);
    send('game-launched', false);
  }
});

ipcMain.on('minimize', () => mainWindow.minimize());
ipcMain.on('close',    () => app.quit());

autoUpdater.on('update-downloaded', () => send('launcher-update-ready', true));
ipcMain.on('install-update', () => autoUpdater.quitAndInstall());

// ─── ПИНГ СЕРВЕРА ────────────────────────────────────────────────────────────
function pingServer(host, port = 25565) {
  return new Promise((resolve) => {
    const net = require('net');
    const socket = net.createConnection({ host, port, timeout: 5000 });
    let buffer = Buffer.alloc(0);

    socket.on('connect', () => {
      function writeVarInt(val) {
        const buf = [];
        while (true) {
          if ((val & ~0x7F) === 0) { buf.push(val); break; }
          buf.push((val & 0x7F) | 0x80);
          val >>>= 7;
        }
        return Buffer.from(buf);
      }
      function makePacket(id, data) {
        const idBuf   = writeVarInt(id);
        const content = Buffer.concat([idBuf, data]);
        const lenBuf  = writeVarInt(content.length);
        return Buffer.concat([lenBuf, content]);
      }
      const hostBuf   = Buffer.from(host, 'utf8');
      const hostLen   = writeVarInt(hostBuf.length);
      const portBuf   = Buffer.alloc(2); portBuf.writeUInt16BE(port);
      const nextState = writeVarInt(1);
      const protoVer  = writeVarInt(765);
      const handshakeData = Buffer.concat([protoVer, hostLen, hostBuf, portBuf, nextState]);
      socket.write(Buffer.concat([makePacket(0x00, handshakeData), makePacket(0x00, Buffer.alloc(0))]));

      setTimeout(() => {
        if (!socket.destroyed) { socket.destroy(); resolve({ online: false }); }
      }, 4000);
    });

    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      try {
        const str = buffer.toString('utf8');
        const start = str.indexOf('{');
        const end   = str.lastIndexOf('}');
        if (start !== -1 && end !== -1) {
          const json = JSON.parse(str.substring(start, end + 1));
          socket.destroy();
          resolve({ online: true, current: json.players?.online ?? 0, max: json.players?.max ?? 0 });
        }
      } catch(e) {}
    });

    socket.on('error', () => resolve({ online: false }));
    socket.on('timeout', () => { socket.destroy(); resolve({ online: false }); });
  });
}

async function startServerPing() {
  async function check() {
    const result = await pingServer(CONFIG.serverHost, CONFIG.serverPort);
    send('server-status', result);
  }
  check();
  setInterval(check, 30000);
}