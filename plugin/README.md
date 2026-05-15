# `plugin/` — обновлённые файлы Figma‑плагина

Эти файлы — обновлённая версия `code.js` / `ui.html` / `manifest.json`, синхронизированная с новым бэкендом (`/api/design-system`).

Они лежат здесь, потому что у cursor‑бота нет прав на пуш в репо
[`Artemiskandirov/plugin-files`](https://github.com/Artemiskandirov/plugin-files) — токен выдан только под этот репозиторий. После мёржа PR просто скопируйте их обратно в `plugin-files` или повесьте бот туда тоже.

## Что изменилось vs. текущая версия в `plugin-files`

### `code.js`

1. **DS теперь грузится из Figma UI Kit'а**, а не захардкоженная. На старте плагин дёргает:

   ```
   GET https://figma-plugin-uchi.vercel.app/api/design-system
   ```

   который через Figma REST API читает файл
   [`UI Kit Uchi.ru Mobile App`](https://www.figma.com/design/8SxJj1kLRNt9ljLQdRa1Ai/UI-Kit-Uchi.ru-Mobile-App?node-id=2544-2889) и возвращает токены (цвета / spacing / radii / typography / effects), стили и каталог компонентов с ключами.

2. **Local Variables текущего файла** (если у юзера подключена library Uchi) теперь не **перезаписывают** загруженную DS, а **дополняют** — это лучшее из двух источников.

3. **Hardcoded набор** остался как ultimate‑fallback на случай оффлайна.

4. **Outdated‑детектор** теперь использует точный список ключей компонентов из UI Kit'а (`DS_COMPONENT_KEYS`). Если у инстанса `mainComponent.key` отсутствует в этом списке — это **`foreign_library`**: компонент подключён из чужой/неправильной библиотеки, а не просто «неизвестный».

5. **UX‑ревью** теперь шлёт `useFigmaDS: true` — GPT на сервере получит ту же свежую DS, что и плагин в UI. Старая компактная клиентская DS остаётся в payload'е как резерв на случай, если бэкенду в моменте не удастся достучаться до Figma API.

6. Новый хэндлер `refresh-ds` для ручного перечитывания DS из Figma.

### `ui.html`

1. **DS‑статус под шапкой** теперь живой: показывает имя Figma‑файла (кликабельно), счётчики `N цветов · N typo · N компонентов`, дату последнего изменения и метку `+ local vars`, если в текущий файл подключена ещё и library.
2. Появилась кнопка **↻** для ручного обновления DS из Figma.
3. При первом запуске вместо «DS: захардкоженный набор» сначала пишется «Загружаю дизайн‑систему…», а потом подменяется реальным статусом.

### `manifest.json`

Не менялся. `networkAccess.allowedDomains` уже разрешает `https://figma-plugin-uchi.vercel.app`, чего достаточно — `/api/design-system` живёт на том же домене.

## Как обновить плагин у себя

1. Замените в `plugin-files`:
   - `code.js` → этот `plugin/code.js`
   - `ui.html` → этот `plugin/ui.html`
   - `manifest.json` менять не нужно (он не изменился).
2. В Figma → Plugins → Development → Import plugin from manifest → выберите `manifest.json` (если уже был импортирован — просто перезапустите плагин).
3. Откройте плагин. Под кнопкой Analyze должно появиться:

   > `🟢 UI Kit Uchi.ru Mobile App · 87 цв · 18 typo · 142 комп · 15.05.2026`

   Если красным/оранжевым — посмотрите `console.log`, как правило это либо отсутствие `FIGMA_TOKEN` в Vercel env, либо у токена нет доступа к файлу.

4. Запустите Analyze — серверу больше не нужно передавать DS, он сам её подтянет.

## Структура ответа `/api/design-system`

См. корневой `README.md`.
