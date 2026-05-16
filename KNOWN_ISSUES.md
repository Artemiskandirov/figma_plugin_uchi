# Известные проблемы и TODO Uchi DS Sync

Файл‑правда. Здесь по пунктам — что обещано, что работает, что нет, почему, и что я делаю / собираюсь сделать. Обновляется живьём.

Легенда:
- ✅ работает
- 🟡 работает частично / с ограничениями
- ❌ не работает
- 🛠️ в работе сейчас
- 🧭 запланировано

---

## Changelog: переход на figma.teamLibrary (16 мая 2026)

Главный прорыв турне. Идея — `figma.teamLibrary` Plugin API даёт доступ к переменным подключённой library **на всех планах Figma**, не только Enterprise. REST `/variables/local` оставлен как параллельный канал.

| Шаг | Что сделано |
| --- | --- |
| `plugin/manifest.json` | Добавлено `"permissions": ["teamlibrary"]`. Без этого `figma.teamLibrary` в плагине `undefined`. |
| `tryLoadDSFromTeamLibrary()` | Новая функция. Берёт `getAvailableLibraryVariableCollectionsAsync` → фильтр по имени `uchi` → для каждой коллекции `getVariablesInLibraryCollectionAsync` → для каждой переменной `importVariableByKeyAsync` (даёт доступ к `valuesByMode`). Одношаговый алиас‑resolver. Bucketing: цвета / spacing (по имени matches `space|gap|padding|margin|size`) / radii (`radius|corner`). |
| Throttling | Каждые 20 импортов — пауза 120 мс. На больших DS защищает от лагов. |
| Кэш в `figma.clientStorage` | Ключ `uchi-ds-teamlib-cache-v1`, TTL 1 час. В Library → Диагностика отображается возраст кэша и кнопка «Обновить из Figma (без кэша)». |
| Merge | `mergeTeamLibraryData` — team library wins по имени над hardcoded и над spacing‑числами без variableKey. |
| `bootstrapDS()` | Теперь параллельно: REST через Vercel + tryLoadDSFromFile + tryLoadDSFromTeamLibrary. Источник DS_SOURCE.kind = `'figma-teamlib'` если teamLibrary дал данные. |
| UI | DS pill в шапке показывает имя library и «· live». Library → Диагностика — отдельная цветная плашка с состоянием teamLibrary (✓/⚠), счётчиками, librariesScanned, ageMin, кнопкой ручного обновления. |

## Changelog по техническому аудиту (май 2026)

Аудит против официальных Figma Plugin API docs и OpenAI Responses API. Что найдено и исправлено:

| Находка аудита | Реальность | Что сделано |
| --- | --- | --- |
| **Крит‑баг:** `figma.importPaintStyleByKeyAsync` / `figma.importTextStyleByKeyAsync` не существуют в Plugin API | Подтверждено по `figma/plugin-typings/plugin-api.d.ts`. Существует только унифицированный `figma.importStyleByKeyAsync(key) → BaseStyle`, тип проверяется через `.type === 'PAINT' / 'TEXT'`. | ✅ Исправлено в `plugin/code.js` — `fixColor` и `fixTypography` теперь идут через `importStyleByKeyAsync` + type guard. Без этого фикса все попытки забиндить paint/text стили из team library просто молча падали в `catch`, и срабатывал raw‑fallback. |
| `text.format.name` в JSON‑schema обязателен | Подтверждено по примерам OpenAI Responses API | ✅ Уже было: `name: 'ux_review'` в `api/ux-review.js`. `ux-chat.js` не использует structured outputs (free‑form). |
| `setBoundVariableForPaint` возвращает новый Paint, нужен clone → mutate copy → reassign | Подтверждено | ✅ Уже было: `current.map(...)` создаёт новый массив, метод возвращает новый объект, потом `node[key] = newPaints`. |
| `setFillStyleIdAsync` / `setStrokeStyleIdAsync` / `setTextStyleIdAsync` — стабильное GA API | Подтверждено (v1 Update 87, Feb 21 2024) | ✅ Используются. Плюс legacy‑fallback на property assignment для не‑dynamic‑page файлов. |
| `instance.getMainComponentAsync()` обязателен в dynamic‑page | Подтверждено | ✅ Используется в `detectOutdatedAndDetached` и `detectComponentDuplicates`. |
| Утверждение «нельзя переключить mode переменной для preview» — **неверно** | `node.setExplicitVariableModeForCollection(collection, modeId)` именно это и делает. Ограничение касается только публикации/subscribe из плагина и default‑mode коллекции (а не explicit mode на ноде). | ✅ Исправил формулировку ниже. 🧭 Добавлю UI mode‑switcher в одном из ближайших турнов. |
| `/variables/local` возвращает не только локальные, но и subscribed (remote, использованные в файле) с полем `subscribed_id` | Подтверждено | 🧭 Сейчас `flattenVariables` это не учитывает явно. На практике большинство subscribed‑переменных приходят без полного value, нужен повторный запрос `/variables/published` к library‑файлу. Запланировано. |
| Pin модели на snapshot `gpt-5.5-2026-04-23` для prod | Рекомендация | 🧭 Сейчас стоит bare `gpt-5.5`. Перейду на snapshot, когда будет понятен профиль использования. |
| Manifest без `documentAccess: 'dynamic-page'` — допустимо для development‑плагина, требуется только при публикации | Подтверждено | 🧭 При публикации добавлю `documentAccess: 'dynamic-page'` и финально пройдусь по всем sync‑API. Пока всё, что должно быть async, уже async. |

---

## Источник дизайн‑системы

| Что | Статус | Подробности |
| --- | --- | --- |
| **Plugin API `figma.teamLibrary` — главный канал, работает на всех планах** | ✅ | `tryLoadDSFromTeamLibrary` в `plugin/code.js`: `getAvailableLibraryVariableCollectionsAsync` → фильтр по имени Uchi → `getVariablesInLibraryCollectionAsync` → `importVariableByKeyAsync` для каждой. Throttling каждые 20 импортов, кэш на 1 час в `figma.clientStorage`, кнопка «Обновить из Figma (без кэша)» в Диагностике. Требует `"permissions": ["teamlibrary"]` в manifest.json — добавлено. |
| Бэкенд читает UI Kit Uchi.ru Mobile App через Figma REST API | ✅ | `/api/design-system` тянет `8SxJj1kLRNt9ljLQdRa1Ai`. Variables эндпоинт работает только на Enterprise. На остальных планах источник переменных — `figma.teamLibrary` в плагине. |
| Резолв variable‑алиасов (`color/text/primary` → `color/primitive/violet-500`) | ✅ | Реализовано в двух местах: на бэкенде — `resolveAliasChain` (только для Enterprise); в плагине через teamLibrary — одношаговый алиас‑resolver через `getVariableByIdAsync` + повторный `importVariableByKeyAsync`. |
| Если variables через REST возвращают 403 — fallback: teamLibrary + стили | ✅ | На не‑Enterprise REST возвращает только Styles. Variables подтягиваются параллельно через Plugin API. Если у юзера UI Kit не подключён к файлу — единственный fallback это Styles. |
| Загрузка эффектов / теней в плагин | ✅ | `tokens.effects` мерджатся в `DS.effects`, анализатор сверяет тени узлов через `effectsApproxEqual`. Bind effect‑стиля на Apply пока нет — 🧭 запланировано. |
| Видимость, почему НЕ загрузились конкретные токены | ✅ | Library → «Диагностика загрузки DS»: блок teamLibrary вверху (цвет/spacing/radii/libraries scanned/imported/cache age), статусы всех REST‑эндпоинтов, причина каждой неудачи. |
| Известный баг Figma: `scopes` после `importVariableByKeyAsync` всегда `['ALL_SCOPES']` | 🟡 | Мы scopes не используем для bind‑логики, так что не блокирует. Если когда‑то нужно будет ограничивать «куда токен можно биндить» — нужно читать scope из исходного дескриптора, не из импортированной переменной. |

---

## Анализатор

| Что | Статус | Подробности |
| --- | --- | --- |
| Не лезет внутрь INSTANCE — variants и overrides не дают ложных срабатываний типа «Active=Yes не найден» | ✅ | Исправлено `walkNodes` (v3). |
| Скип иллюстраций (`VECTOR`, `BOOLEAN_OPERATION` и т.п. + parent‑регекс) | ✅ | Иконки внутри `icon`/`ic_` тоже помечаются. |
| Цвета: близкие к токену → секция Bind | ✅ | `confidence: high/medium`. |
| Цвета: совсем не из DS → отдельная секция «Цвета не из DS» + draft | ✅ | `confidence: low`. |
| **Тени / эффекты: проверка на соответствие DS** | ❌ → 🛠️ | Делаю — будет секция «Тени». |
| Отступы (padding / itemSpacing) | 🟡 | Работает, но **только если DS отдала spacing‑variables**. На не‑Enterprise список spacing'ов = захардкоженный fallback. |
| Типографика — bind text style | ✅ | Через `importTextStyleByKeyAsync`. |
| Outdated‑компоненты | ✅ | `figma.importComponentByKeyAsync` + проверка по ключу. |
| Foreign‑library и local‑component detection | ✅ | Помечаются разными бейджами; есть draft‑кнопка. |
| Heuristic: «выглядит как кнопка, но фрейм» | ✅ | `looksLikeAdHocButton`. |
| **GPT‑проверка структуры (не‑очевидные блоки которые должны быть компонентами)** | ❌ → 🧭 | Эвристика ловит явные кнопки, но не сложные блоки (карточки, чипы, поля). Нужно сходить в GPT с layoutJson. |
| **Детект дублей одного компонента в одном фрейме + GPT «это специально?»** | ❌ → 🛠️ | Делаю сейчас. |
| Mode awareness (light/dark/mobile/web) | 🟡 | Когда bind идёт через variable, Figma сама резолвит активный mode на ноде. Переключить mode для preview **можно** через `node.setExplicitVariableModeForCollection(collection, modeId)` — UI для этого 🧭 запланирован. Нельзя из плагина: менять default‑mode коллекции (только UI/REST) и переключать mode у remote‑коллекции с не‑загруженными значениями. |

---

## Token binding на Apply

| Что | Статус | Подробности |
| --- | --- | --- |
| Цвет → variable (через `setBoundVariableForPaint`) | ✅ | Если в DS пришёл `variableKey`. Индикатор `● variable` зелёный. |
| Цвет → style (через `importStyleByKeyAsync` + type guard + `setFillStyleIdAsync`) | ✅ | Если variableKey нет, но есть styleKey. Индикатор `● style` синий. До коммита от 15.05.2026 здесь был баг — вызывался несуществующий `importPaintStyleByKeyAsync`, и связка тихо падала в raw‑fallback. Исправлено. |
| Цвет → raw (только меняем hex) | ✅ | Последний fallback. Индикатор `○ raw` серый. |
| Spacing → variable | ✅ | Если `variableKey` есть в spacing‑токене. |
| Typography → text style | ✅ | Через унифицированный `importStyleByKeyAsync` + проверку `style.type === 'TEXT'` + `setTextStyleIdAsync`. До 15.05.2026 был тот же баг, что с paint‑стилями (несуществующий метод). Исправлено. |
| **Effect / shadow → effect style binding** | ❌ → 🛠️ | Будет добавлено вместе с проверкой эффектов. |

---

## Drafts (черновики в DS)

| Что | Статус | Подробности |
| --- | --- | --- |
| Добавить цвет / компонент в черновики | ✅ | `+ В DS как черновик`, живёт в `figma.clientStorage`. |
| Просмотр и удаление черновиков | ✅ | Library → секция «🔴 Черновики в DS». |
| «Создать страницу 🔴 Drafts» материализует их в текущий файл | ✅ | Цвета — прямоугольники, компоненты — outlined‑фреймы с заметкой. |
| **Дедупликация при добавлении в drafts** | ❌ → 🧭 | Если кликнуть «В DS как черновик» на одинаковом цвете два раза — будет дубль. |
| **Реальный перенос локального компонента в DS файл (а не плейсхолдер)** | ❌ | Figma plugin API не поддерживает копирование инстанса/компонента между файлами напрямую. Нужно: либо ручной copy/paste, либо плагин должен запускаться в DS‑файле и пользователь руками вставит. |

---

## GPT / Chat

| Что | Статус | Подробности |
| --- | --- | --- |
| Авто‑карточка score/recommendations убрана из Review | ✅ | Только по запросу в чате. |
| Чат с историей (`/api/ux-chat`) | ✅ | Контекст: layoutJson, issues, DS, скриншот первого user‑сообщения. |
| Персоны (designer / child / parent) | ✅ | Переключатель сверху чата. |
| Быстрые подсказки | ✅ | «Что критично?», «Нарушения DS», и т.п. |
| **GPT в роли анализатора структуры (а не комментатора)** | ❌ → 🧭 | GPT сейчас комментирует — но не возвращает структурированные `structure_issues`, которые плагин мог бы вынести в Review. Если нужно — отдельной командой `/api/ux-structure-check` с JSON‑схемой. |
| **GPT‑верификация «дублей»** | ❌ → 🛠️ | Делаю сейчас как кнопка «Спросить GPT: это специально?» на каждом дубле. |

---

## UI

| Что | Статус | Подробности |
| --- | --- | --- |
| Apple‑style редизайн | ✅ | SF, мягкие тени, segmented control. |
| Library tab — что плагин знает из DS | ✅ | Цвета, typography, spacing, components. |
| **Диагностика — что НЕ получилось загрузить и почему** | ❌ → 🛠️ | Добавляю прямо сейчас. |
| Token‑binding indicator dot (variable/style/raw) | ✅ | На каждой карточке Review. |
| Тёмная тема | ✅ | Через `--figma-color-*`, наследуем тему Figma. |

---

## Что я делаю в этом турне

1. ✅ Этот файл с честным статусом.
2. 🛠️ Diagnostics‑блок в ответе API + видимая секция в Library tab.
3. 🛠️ Загрузка `tokens.effects` (теней) в плагин + проверка эффектов в анализаторе.
4. 🛠️ Детект дублей одного компонента в одном parent'е + кнопка «Спросить у GPT — это специально?».
5. 🛠️ Хэндлинг effectStyleId / `setEffectStyleIdAsync` на Apply для теней.

## Что НЕ делаю в этом турне (и почему)

- ~~**Reverse alias loading (получение variables из подключённой library)**~~ — ✅ **решено в этом турне через `figma.teamLibrary` (Plugin API), работает на всех планах**. REST путь оставлен для Enterprise как параллельный канал.
- **GPT‑structure‑check с JSON‑schemes** — большая отдельная фича. Сейчас GPT в чате отвечает текстом; для перечня структурных issues (что должно быть компонентом, какие блоки сломаны) нужен отдельный эндпоинт с json_schema. 🧭 Запланировано.
- **Кросс‑файловое создание компонентов в DS файле** — упирается в ограничение Figma Plugin API («can only access styles, components, and instances that are currently in the file, or have been imported»). Workaround — материализация черновиков на странице 🔴 Drafts в текущем файле, потом дизайнер вручную копирует в UI Kit.
- **Mode picker (выбрать light/dark/web/mobile прямо в UI плагина)** — `setExplicitVariableModeForCollection` существует и работает; нужно лишь дочитать список модусов с variables и сделать переключалку в Library tab. 🧭 Запланировано.
- **Pin модели OpenAI на snapshot `gpt-5.5-2026-04-23`** — для production стабильности правильно, но пока bare `gpt-5.5` ок. Перейду одной строкой, когда буду готовить плагин к публикации.
