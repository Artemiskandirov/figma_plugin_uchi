# Uchi.ru Figma Plugin — Vercel backend

Бэкенд Figma‑плагина **figma_plugin_uchi** для UX‑ревью макетов мобильного приложения Uchi.ru.

## Что делает

| Эндпоинт | Что делает |
| --- | --- |
| `GET /api/design-system` | Достаёт **живую** дизайн‑систему из Figma‑файла **UI Kit Uchi.ru Mobile App** через Figma REST API: токены (variables / styles), цвета, типографику, эффекты, список компонентов и компонент‑сетов. |
| `GET /api/figma-node` | Возвращает дерево любого узла / компонента (плюс опциональный PNG‑превью) из того же UI Kit'а — нужно, когда плагин хочет сравнить макет с эталонным компонентом. |
| `POST /api/ux-review` | UX‑ревью макета через GPT‑5.5. Может **сам** подтянуть свежую DS из Figma, если плагин не прислал её. |

## Зачем это вообще

Раньше плагин подтягивал DS из захардкоженного JSON в GitHub‑репо — это копия, которая устаревает в ту же секунду, как только в Figma меняют токен или компонент. Теперь плагин ходит за дизайн‑системой напрямую в первоисточник — Figma‑файл UI Kit Uchi.ru Mobile App, и работает с актуальными данными.

UI Kit, который читается по умолчанию:

> https://www.figma.com/design/8SxJj1kLRNt9ljLQdRa1Ai/UI-Kit-Uchi.ru-Mobile-App?node-id=2544-2889

- `fileKey` по умолчанию: `8SxJj1kLRNt9ljLQdRa1Ai`
- `nodeId` по умолчанию: `2544-2889`

Любой из них можно переопределить query‑параметром.

## Setup (один раз)

### 1. Создать Figma Personal Access Token

1. Откройте Figma → **Settings** → **Security** → **Personal access tokens** → **Generate new token**.
2. Дайте ему scope'ы:
   - `File content` → **Read**
   - `Library content` → **Read**
   - `File variables` → **Read** (нужно для извлечения токенов; на не‑Enterprise планах вернётся 403 — мы graceful‑fallback'ним на стили).
   - `Dev resources` → **Read** (опционально).
3. Скопируйте токен — он покажется один раз.

### 2. Добавить токены в Vercel

В **Project Settings → Environment Variables**:

| Имя | Значение | Окружения |
| --- | --- | --- |
| `FIGMA_TOKEN` | ваш PAT из шага 1 | Production, Preview, Development |
| `OPENAI_API_KEY` | ключ OpenAI (нужен только для `/api/ux-review`) | Production, Preview, Development |

После добавления — Redeploy.

### 3. Проверить, что всё работает

```bash
curl "https://figma-plugin-uchi.vercel.app/api/design-system" | jq .stats
# {
#   "totalColors": ...,
#   "totalTypography": ...,
#   "totalComponents": ...,
#   "totalComponentSets": ...,
#   "totalStyles": ...
# }
```

Если `tokensFromVariables: false` в `source` — значит план файла не Enterprise и переменные через API недоступны, токены извлечены из стилей. Это нормально и работает.

## Как подключить в код плагина

В вашем `code.ts` Figma‑плагина (он живёт у вас локально, не в этом репо) **выкиньте** старую загрузку DS с GitHub и поставьте на её место запрос к бэкенду.

### Минимальный пример

```typescript
const API = 'https://figma-plugin-uchi.vercel.app';

async function loadDesignSystem() {
  const r = await fetch(`${API}/api/design-system`);
  if (!r.ok) throw new Error(`DS load failed: ${r.status}`);
  return await r.json();
}

async function reviewSelection(perspective: 'designer' | 'child' | 'parent' = 'designer') {
  const node = figma.currentPage.selection[0];
  if (!node) {
    figma.notify('Выделите фрейм для ревью');
    return;
  }

  const layoutJson = await serializeNode(node);              // ваша функция
  const screenshotBytes = await node.exportAsync({ format: 'PNG', constraint: { type: 'SCALE', value: 2 } });
  const screenshotBase64 = figma.base64Encode(screenshotBytes);

  const r = await fetch(`${API}/api/ux-review`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      layoutJson,
      screenshotBase64,
      perspective,
      useFigmaDS: true        // <-- ключевая строка: пусть сервер сам возьмёт DS из Figma
    })
  });
  return await r.json();
}
```

> Не забудьте добавить `figma-plugin-uchi.vercel.app` в `networkAccess.allowedDomains` в `manifest.json`.

### Если плагин должен подтянуть конкретный компонент UI Kit'а

```typescript
async function fetchUIKitComponent(nodeId: string) {
  const r = await fetch(`${API}/api/figma-node?nodeId=${encodeURIComponent(nodeId)}&image=1&scale=2`);
  const { nodes, images } = await r.json();
  return { tree: nodes[nodeId].document, previewUrl: images[nodeId] };
}
```

### Manifest

```json
{
  "name": "Uchi DS Review",
  "id": "...",
  "api": "1.0.0",
  "main": "code.js",
  "ui": "ui.html",
  "networkAccess": {
    "allowedDomains": [
      "https://figma-plugin-uchi.vercel.app"
    ]
  }
}
```

## Формат ответа `/api/design-system`

```jsonc
{
  "source": {
    "fileKey": "8SxJj1kLRNt9ljLQdRa1Ai",
    "fileName": "UI Kit Uchi.ru Mobile App",
    "lastModified": "2026-...",
    "version": "...",
    "figmaUrl": "https://www.figma.com/design/.../?node-id=2544-2889",
    "tokensFromVariables": true            // false = на этом плане нет API переменных
  },
  "tokens": {
    "colors": [
      { "name": "color/primary/500", "value": "#5B5BD6", "collection": "Primitives", "mode": "Light" }
    ],
    "typography": [
      { "name": "heading/h1", "fontFamily": "Onest", "fontWeight": 700, "fontSize": 32, "lineHeight": 40 }
    ],
    "radii":   [ { "name": "radius/md", "value": 12 } ],
    "spacing": [ { "name": "space/4",   "value": 16 } ],
    "effects": [ { "name": "shadow/card", "items": [{ "type": "DROP_SHADOW", "color": "#0000001A", "radius": 12 }] } ]
  },
  "styles": {
    "fills":   [ { "key": "...", "name": "Brand/Primary", "nodeId": "..." } ],
    "text":    [ ... ],
    "effects": [ ... ],
    "grids":   [ ... ]
  },
  "components":    [ { "key": "...", "name": "Button/Primary/Large", "nodeId": "...", "containingFrame": { ... } } ],
  "componentSets": [ { "key": "...", "name": "Button", "nodeId": "..." } ],
  "stats": { "totalColors": 87, "totalTypography": 18, "totalComponents": 142, "totalComponentSets": 24, "totalStyles": 96 }
}
```

## Параметры эндпоинтов

### `GET /api/design-system`

| Query | По умолчанию | Описание |
| --- | --- | --- |
| `fileKey` | `8SxJj1kLRNt9ljLQdRa1Ai` | Ключ Figma‑файла. |
| `nodeId` | `2544-2889` | Узел, который считается «корнем» DS (метаинформационно). |
| `refresh` | — | `1` — пропустить in‑memory кэш (5 мин). |

Ответ кэшируется на CDN Vercel: `s-maxage=300, stale-while-revalidate=3600`.

### `GET /api/figma-node`

| Query | По умолчанию | Описание |
| --- | --- | --- |
| `fileKey` | `8SxJj1kLRNt9ljLQdRa1Ai` | |
| `nodeId` | **(required)** | id одного или нескольких узлов через запятую. |
| `depth` | — | Глубина обхода. |
| `geometry` | — | `paths` — вернуть векторы. |
| `image` | — | `1` — также вернуть PNG‑превью. |
| `scale` | — | Масштаб превью, 0.01–4. |

### `POST /api/ux-review`

| Поле | Описание |
| --- | --- |
| `layoutJson` | **(required)** дерево фрейма из плагина |
| `designSystem` | (optional) если не передан и `useFigmaDS=true` — сервер сам подтянет |
| `useFigmaDS` | `true` → принудительно взять DS из Figma |
| `figmaFileKey`, `figmaNodeId` | override источника DS |
| `screenshotBase64` | (optional) PNG скрина, мультимодальный анализ |
| `perspective` | `designer` \| `child` \| `parent` |

## Локальная разработка

```bash
npm i -g vercel
vercel link
vercel env pull .env.local       # вытянет FIGMA_TOKEN и OPENAI_API_KEY
vercel dev
```

## Troubleshooting

- **`403` от Figma на `/variables/local`** — у файла нет Enterprise. Это ок, токены извлекутся из стилей. Поле `tokensFromVariables` будет `false`.
- **`404`** — проверьте, что `FIGMA_TOKEN` принадлежит юзеру, у которого есть доступ к файлу `8SxJj1kLRNt9ljLQdRa1Ai`. Если файл лежит в чужой команде, пригласите этого юзера или используйте сервисный аккаунт.
- **`429`** — Figma API rate limit. Мы кэшируем 5 мин в памяти + CDN; если поток с плагина слишком частый, увеличьте `s-maxage`.
- **GPT отвечает «не вижу DS»** — проверьте, что плагин шлёт `useFigmaDS: true` ИЛИ передаёт уже полученный `designSystem` из `/api/design-system`.
