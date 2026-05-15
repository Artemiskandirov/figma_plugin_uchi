// Vercel Serverless Function — UX-анализ макета через GPT-5.5
// POST /api/ux-review
// Body: { layoutJson, designSystem, screenshotBase64 }

// Указываем maxDuration через config — это работает без vercel.json
export const config = {
  maxDuration: 60
};

const SYSTEM_PROMPT = `Ты senior product designer и UX-эксперт edtech-платформы Uchi.ru — лидера в детском онлайн-образовании.

Твоя задача — провести UX-ревью макета мобильного приложения. Целевая аудитория: школьники 6–14 лет и их родители.

Анализируй по следующим направлениям:
1. ИЕРАРХИЯ — что важнее всего, видно ли это с первого взгляда, не теряется ли CTA
2. ЧИТАЕМОСТЬ — комфортна ли типографика для детей, не перегружен ли экран
3. КОНТРАСТ И ДОСТУПНОСТЬ — соответствие WCAG, читаемость текста
4. КОНСИСТЕНТНОСТЬ — соответствие переданной дизайн-системе, использование токенов
5. ВЗАИМОДЕЙСТВИЕ — понятность интерактивных элементов, размер touch-зон
6. ТОН — дружелюбность, мотивирующие формулировки, отсутствие сложной лексики
7. EDTECH-ПАТТЕРНЫ — прогресс, награды, обратная связь, геймификация где уместно

ПРАВИЛА:
- Не более 5 рекомендаций — только самые важные
- Каждая рекомендация должна быть конкретной и actionable
- Используй точные ссылки на элементы из переданного layoutJson (по имени слоя)
- Если есть скриншот — анализируй ВИЗУАЛ, не только структуру
- Severity:
  * "critical" — мешает использовать продукт
  * "warning" — заметно ухудшает UX
  * "suggestion" — потенциальное улучшение
- Категории: hierarchy | contrast | spacing | copy | interaction | accessibility | consistency
- Не пиши очевидное и общие фразы. Конкретика, основанная на этом макете
- Отвечай на русском языке

Overall score (0–100):
- 90+ — почти идеально, мелкие улучшения
- 70–89 — рабочий макет с заметными проблемами
- 50–69 — много проблем, нужна доработка
- <50 — критические проблемы UX`;

export default async function handler(req, res) {
  // CORS — плагин будет дёргать с null origin
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // GET — просто пинг для проверки что endpoint работает
  if (req.method === 'GET') {
    return res.status(200).json({
      ok: true,
      message: 'UX review endpoint работает. Шли POST с layoutJson.',
      hasApiKey: !!process.env.OPENAI_API_KEY
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({
      error: 'OPENAI_API_KEY не задан в переменных окружения Vercel'
    });
  }

  try {
    const { layoutJson, designSystem, screenshotBase64 } = req.body || {};

    if (!layoutJson) {
      return res.status(400).json({ error: 'layoutJson обязателен' });
    }

    // Собираем user content. Если есть скриншот — добавляем как image
    const userContent = [
      {
        type: 'input_text',
        text: `ДИЗАЙН-СИСТЕМА (для контекста):\n${JSON.stringify(designSystem, null, 2)}\n\nМАКЕТ:\n${JSON.stringify(layoutJson, null, 2)}`
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
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userContent }
        ],
        text: {
          format: {
            type: 'json_schema',
            name: 'ux_review',
            strict: true,
            schema: {
              type: 'object',
              properties: {
                overall_score: {
                  type: 'integer',
                  description: 'Общая оценка UX, 0-100'
                },
                summary: {
                  type: 'string',
                  description: '1-2 предложения общего впечатления'
                },
                recommendations: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      severity: {
                        type: 'string',
                        enum: ['critical', 'warning', 'suggestion']
                      },
                      category: {
                        type: 'string',
                        enum: [
                          'hierarchy',
                          'contrast',
                          'spacing',
                          'copy',
                          'interaction',
                          'accessibility',
                          'consistency'
                        ]
                      },
                      title: { type: 'string' },
                      description: { type: 'string' },
                      suggestion: { type: 'string' },
                      target_layer: {
                        type: 'string',
                        description: 'Имя слоя или элемента из макета, к которому относится'
                      }
                    },
                    required: [
                      'severity',
                      'category',
                      'title',
                      'description',
                      'suggestion',
                      'target_layer'
                    ],
                    additionalProperties: false
                  }
                }
              },
              required: ['overall_score', 'summary', 'recommendations'],
              additionalProperties: false
            }
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

    // Достаём structured output. У Responses API два пути:
    // 1) data.output_text — удобный shortcut
    // 2) обход data.output[] и поиск блока type: 'message'
    let text = data.output_text;

    if (!text && Array.isArray(data.output)) {
      const messageBlock = data.output.find((o) => o.type === 'message');
      const textPart = messageBlock?.content?.find((c) => c.type === 'output_text');
      text = textPart?.text;
    }

    if (!text) {
      return res.status(500).json({
        error: 'Не удалось извлечь output из ответа OpenAI',
        raw: data
      });
    }

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      return res.status(500).json({
        error: 'Output не является валидным JSON',
        raw: text
      });
    }

    return res.status(200).json(parsed);
  } catch (error) {
    console.error('Handler error:', error);
    return res.status(500).json({ error: error.message });
  }
}
