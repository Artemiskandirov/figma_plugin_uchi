// Vercel Serverless Function — UX-анализ макета через GPT-5.5
// POST /api/ux-review
// Body: {
//   layoutJson,              // обязателен: JSON-дерево фрейма из плагина
//   designSystem,            // опционально: если не передан и useFigmaDS=true,
//                            // сервер сам подтянет DS из UI Kit Uchi (Figma REST)
//   useFigmaDS,              // boolean: true → сервер берёт DS из Figma file
//   figmaFileKey,            // optional override (default: UI Kit Uchi.ru)
//   figmaNodeId,             // optional
//   screenshotBase64,
//   perspective              // 'designer' | 'child' | 'parent'
// }

export const config = {
  maxDuration: 60
};

const DEFAULT_FILE_KEY = '8SxJj1kLRNt9ljLQdRa1Ai';
const DEFAULT_NODE_ID = '2544-2889';

async function fetchFigmaDesignSystem(fileKey, nodeId) {
  if (!process.env.FIGMA_TOKEN) {
    throw new Error('FIGMA_TOKEN не задан, не могу подтянуть DS из Figma');
  }
  const host = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000';
  const url = `${host}/api/design-system?fileKey=${encodeURIComponent(fileKey)}&nodeId=${encodeURIComponent(nodeId)}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`design-system endpoint ${r.status}`);
  return await r.json();
}

const PROMPTS = {
  designer: `Ты senior product designer и UX-эксперт edtech-платформы Uchi.ru — лидера в детском онлайн-образовании.

Твоя задача — провести UX-ревью макета мобильного приложения. Целевая аудитория продукта: школьники 6–14 лет и их родители.

Анализируй по направлениям:
1. ИЕРАРХИЯ — что важнее всего, виден ли CTA с первого взгляда
2. ЧИТАЕМОСТЬ — комфортна ли типографика для детей, не перегружен ли экран
3. КОНТРАСТ И ДОСТУПНОСТЬ — соответствие WCAG, читаемость текста
4. КОНСИСТЕНТНОСТЬ — соответствие переданной дизайн-системе
5. ВЗАИМОДЕЙСТВИЕ — понятность интерактивных элементов, размер touch-зон
6. ТОН — дружелюбность, мотивирующие формулировки, отсутствие сложной лексики
7. EDTECH-ПАТТЕРНЫ — прогресс, награды, обратная связь, геймификация

ПРАВИЛА:
- Не более 5 рекомендаций — только самые важные
- Конкретно, со ссылками на элементы (target_layer = имя слоя)
- Если есть скриншот — анализируй и ВИЗУАЛ
- Severity: critical / warning / suggestion
- Категории: hierarchy | contrast | spacing | copy | interaction | accessibility | consistency
- Отвечай на русском

Score 0-100: 90+ почти идеально, 70-89 рабочее с проблемами, 50-69 много проблем, <50 критика`,

  child: `Ты — Миша, обычный школьник 9 лет, учишься в 3 классе. Тебе показывают экран приложения для учёбы — реагируй так, как реально реагирует ребёнок твоего возраста.

ТЫ — ЭТО:
- Любишь Roblox, Minecraft, Brawl Stars
- Ценишь яркие цвета, анимации, награды, прогресс-бары, маскотов, звуки
- Раздражают: длинные тексты, серьёзные взрослые слова, скучные серые экраны, кнопки без подписей
- Не любишь когда непонятно что нажать
- Хочешь чтобы быстро было видно: что я уже сделал, что осталось, какая у меня награда
- Любишь когда персонаж или животное "разговаривает" с тобой
- Не читаешь длинные инструкции — нажимаешь и пробуешь

КАК ОТВЕЧАТЬ:
- Простым языком, как реальный ребёнок
- Слова: "круто", "скучно", "непонятно", "прикольно", "не хочу читать", "а где...", "почему..."
- Можешь использовать восклицания: "Ого!", "Фу", "Ну вот"
- Без сложных терминов типа "иерархия", "контраст", "UX"
- Severity: critical = "вообще не понял что делать", warning = "не нравится но играть буду", suggestion = "было бы круто если..."
- Категории: hierarchy | contrast | spacing | copy | interaction | accessibility | consistency

5 наблюдений максимум. target_layer = имя слоя.

Score 0-100: 100 = "офигенно интересно, хочу играть каждый день", 70 = "норм, поиграю", 40 = "скучно", <30 = "не буду этим пользоваться".

Тон: живой, простой, по-детски. summary — одно предложение от первого лица: "Мне тут нравится..." или "Мне скучно, потому что..."`,

  parent: `Ты — Анна, 38 лет, мама школьника 9 лет. Работаешь менеджером в офисе. Тебе показывают экран приложения для учёбы твоего ребёнка — реагируй как реальная мама.

ТЫ — ЭТО:
- Ценишь своё время, не хочешь разбираться в сложных интерфейсах
- Беспокоишься о безопасности ребёнка в интернете (тратит ли он деньги, видит ли рекламу, общается ли с незнакомцами)
- Хочешь понимать: что именно ребёнок изучает, как у него успехи, сколько времени он тратит
- Готова платить за подписку если виден реальный прогресс ребёнка
- Не любишь агрессивные продажи, скрытые платежи, манипулятивный дизайн (тёмные паттерны)
- Цитируешь подругам "это приложение реально помогло моему сыну с математикой" — если так и есть
- Не любишь когда ребёнка перегружают развлечениями вместо учёбы

КАК ОТВЕЧАТЬ:
- Тон практичный, спокойный, реалистичный
- Слова: "не понимаю", "мне важно", "это удобно", "вызывает доверие", "выглядит подозрительно", "не хватает"
- Думай о связке "учёба ↔ контроль ↔ безопасность ↔ цена"
- Severity: critical = "из-за этого не буду пользоваться", warning = "напрягает", suggestion = "хорошо бы добавить"
- Категории: hierarchy | contrast | spacing | copy | interaction | accessibility | consistency

5 наблюдений максимум. target_layer = имя слоя.

Score 0-100: 100 = "куплю подписку прямо сейчас, расскажу подругам", 70 = "попробую бесплатную версию", 40 = "не вызывает доверия", <30 = "удалю".

Тон: трезвый, материнский. summary — одно предложение от первого лица: "Я бы доверила это своему ребёнку, потому что..." или "Мне не нравится, что..."`
};

const JSON_SCHEMA = {
  type: 'object',
  properties: {
    overall_score: { type: 'integer' },
    summary: { type: 'string' },
    recommendations: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['critical', 'warning', 'suggestion'] },
          category: { type: 'string', enum: ['hierarchy', 'contrast', 'spacing', 'copy', 'interaction', 'accessibility', 'consistency'] },
          title: { type: 'string' },
          description: { type: 'string' },
          suggestion: { type: 'string' },
          target_layer: { type: 'string' }
        },
        required: ['severity', 'category', 'title', 'description', 'suggestion', 'target_layer'],
        additionalProperties: false
      }
    }
  },
  required: ['overall_score', 'summary', 'recommendations'],
  additionalProperties: false
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    return res.status(200).json({
      ok: true,
      message: 'UX review endpoint работает. Шли POST.',
      hasApiKey: !!process.env.OPENAI_API_KEY,
      supportedPerspectives: ['designer', 'child', 'parent']
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: 'OPENAI_API_KEY не задан в Vercel env' });
  }

  try {
    let { layoutJson, designSystem, screenshotBase64, perspective, useFigmaDS, figmaFileKey, figmaNodeId } = req.body || {};

    if (!layoutJson) {
      return res.status(400).json({ error: 'layoutJson обязателен' });
    }

    // Если плагин не прислал DS или явно попросил «возьми из Figma» —
    // тянем актуальную DS из UI Kit Uchi.ru через Figma REST API.
    let dsSource = 'client';
    if (!designSystem || useFigmaDS) {
      try {
        designSystem = await fetchFigmaDesignSystem(
          figmaFileKey || DEFAULT_FILE_KEY,
          figmaNodeId || DEFAULT_NODE_ID
        );
        dsSource = 'figma';
      } catch (err) {
        if (!designSystem) {
          return res.status(500).json({
            error: 'Не удалось получить дизайн-систему из Figma',
            details: err.message
          });
        }
        dsSource = 'client-fallback';
      }
    }

    const persp = perspective && PROMPTS[perspective] ? perspective : 'designer';
    const systemPrompt = PROMPTS[persp];

    const userContent = [
      {
        type: 'input_text',
        text: `ДИЗАЙН-СИСТЕМА:\n${JSON.stringify(designSystem, null, 2)}\n\nМАКЕТ:\n${JSON.stringify(layoutJson, null, 2)}`
      }
    ];

    if (screenshotBase64) {
      userContent.push({
        type: 'input_image',
        image_url: `data:image/png;base64,${screenshotBase64}`
      });
    }

    const openaiResponse = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-5.5',
        reasoning: { effort: 'medium' },
        input: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent }
        ],
        text: {
          format: {
            type: 'json_schema',
            name: 'ux_review',
            strict: true,
            schema: JSON_SCHEMA
          }
        }
      })
    });

    const data = await openaiResponse.json();

    if (!openaiResponse.ok) {
      console.error('OpenAI error:', JSON.stringify(data));
      return res.status(openaiResponse.status).json({
        error: 'OpenAI API error',
        details: data
      });
    }

    let text = data.output_text;
    if (!text && Array.isArray(data.output)) {
      const messageBlock = data.output.find((o) => o.type === 'message');
      const textPart = messageBlock?.content?.find((c) => c.type === 'output_text');
      text = textPart?.text;
    }

    if (!text) {
      return res.status(500).json({ error: 'Не удалось извлечь output', raw: data });
    }

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      return res.status(500).json({ error: 'Output не JSON', raw: text });
    }

    parsed.perspective = persp;
    parsed.designSystemSource = dsSource;
    if (designSystem?.source?.fileKey) {
      parsed.designSystemMeta = {
        fileKey: designSystem.source.fileKey,
        fileName: designSystem.source.fileName,
        lastModified: designSystem.source.lastModified,
        tokensFromVariables: designSystem.source.tokensFromVariables,
        stats: designSystem.stats
      };
    }
    return res.status(200).json(parsed);
  } catch (error) {
    console.error('Handler error:', error);
    return res.status(500).json({ error: error.message });
  }
}
