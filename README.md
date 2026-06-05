# 🎮 MC Launcher — Инструкция по настройке

## Структура проекта
```
mc-launcher/
├── src/
│   ├── main.js       ← Главный процесс Electron (логика)
│   └── index.html    ← UI лаунчера
├── assets/
│   └── icon.ico      ← Иконка лаунчера (добавьте сами)
├── scripts/
│   └── gen-manifest.js  ← Генератор manifest.json
├── manifest.json     ← Список модов (загружается на GitHub)
└── package.json
```

---

## Шаг 1 — Настройте конфиг

Откройте `src/main.js` и заполните CONFIG в начале файла:

```js
const CONFIG = {
  githubOwner: 'ВАШ_USERNAME',   // ← ваш GitHub логин
  githubRepo:  'ВАШ_РЕПОЗИТОРИЙ', // ← название репо
  ...
};
```

Также замените все `yourserver` на название вашего сервера в `index.html`.

---

## Шаг 2 — Создайте GitHub репозиторий

1. Создайте публичный репозиторий на GitHub
2. В репозитории создайте Release с тегом `mods`
3. Загрузите туда все `.jar` файлы модов

---

## Шаг 3 — Сгенерируйте manifest.json

Положите моды в папку `./mods`, затем:

```bash
node scripts/gen-manifest.js ./mods
```

Получите `manifest.json` с MD5 хешами — загрузите его в корень репозитория.

---

## Шаг 4 — Установка и запуск

```bash
npm install
npm start          # запустить для теста
npm run build      # собрать .exe
```

Готовый `.exe` будет в папке `dist/`.

---

## Шаг 5 — Добавление нового мода

1. Добавьте `.jar` файл в Release на GitHub (тег `mods`)
2. Запустите `node scripts/gen-manifest.js ./mods`
3. Закоммитьте обновлённый `manifest.json`

**Всё.** При следующем запуске лаунчера игроки автоматически получат новый мод.

---

## Шаг 6 — Обновление самого лаунчера

Для автообновления лаунчера:
1. Измените версию в `package.json`
2. Запустите `npm run build`
3. Создайте новый GitHub Release с тегом `v1.x.x`
4. Загрузите `.exe` из `dist/`

`electron-updater` сам найдёт обновление и предложит установить.

---

## Иконка

Положите файл `icon.ico` в папку `assets/`.
Минимальный размер — 256x256px.
