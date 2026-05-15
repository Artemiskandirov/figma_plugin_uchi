// Vercel Serverless Function — диалоговый чат с GPT-5.5 в контексте текущего макета.
//
// POST /api/ux-chat
// Body: {
//   messages: [{ role: 'user'|'assistant', content: string }],
//   context: {
//     layoutJson,           // дерево фрейма
//     designSystem,         // DS (или пусто — сервер сам подтянет из Figma)
//     issues,               // найденные плагином проблемы (colors/spacing/typography/...)
//     screenshotBase64,     // опционально, прикрепляется только к первому юзер-сообщению
//     selectionNames        // имена выделенных фреймов
//   },
//   useFigmaDS              // boolean; true → сервер сам подтянет DS
// }

export const config = { maxDuration: 60 };

const DEFAULT_FILE_KEY = '8SxJj1kLRNt9ljLQdRa1Ai';
const DEFAULT_NODE_ID = '2544-2889';

const SYSTEM_PROMPT = `Ты — Uchi DS Assistant, дружелюбный и точный помощник дизайнера в Figma-плагине Uchi.ru.

Контекст: пользователь работает с мобильным приложением Uchi.ru для школьников 6-14 лет и их родителей. Тебе дают дерево фрейма, дизайн-систему (токены: цвета, типографика, spacing) и список уже найденных автоматическими чекерами проблем. Опционально — скриншот.

Твои правила:
1. **Всегда ссылайся на токены DS по именам**, а не на сырые hex/числа. Если пользователь говорит «этот красный плохой» — ответь «вместо #FF6171 используйте \`bright-pink\` (#FF6170)».
2. **Конкретно, по делу, коротко**. Без воды. Markdown короткими блоками: списки, **bold**, \`код\`.
3. Если просят «исправь / примени» — отвечай инструкцией, что плагин может сделать сам (Fix кнопки), и одновременно объясни почему.
4. Если уже есть авто-найденные issues — учитывай их, не дублируй. Можешь сказать «5 spacing-проблем уже видишь во вкладке Spacing, но вот что важнее...».
5. На вопросы про доступность, иерархию, читаемость — отвечай как UX-эксперт edtech для детей.
6. Если пользователь спрашивает не про макет (общий вопрос про DS, Figma, дизайн) — отвечай нормально, но кратко.
7. На русском, обращение на «вы», тон спокойный, без эмодзи кроме разделителей в списках.

Когда упоминаешь конкретный слой или компонент — обрамляй имя в обратные кавычки: \`Header/Title\`. Когда упоминаешь токен — тоже: \`color/primary/500\`. Это позволит UI плагина подсветить ссылки.`;

async function fetchFigmaDS() {
  const host = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000';
  const r = await fetch(`${host}/api/design-system?fileKey=${DEFAULT_FILE_KEY}&nodeId=${DEFAULT_NODE_ID}`);
  if (!r.ok) throw new Error(`design-system endpoint ${r.status}`);
  return await r.json();
}

function compactDS(ds) {
  if (!ds) return null;
  // Если это полный ответ /api/design-system — ужмём до текстовой выжимки.
  if (ds.tokens) {
    const colors = (ds.tokens.colors || []).slice(0, 80).map((c) => `${c.name}=${c.value || c.alias || ''}`).join('; ');
    const typo = (ds.tokens.typography || []).slice(0, 40).map((t) => `${t.name}: ${t.fontFamily} ${t.fontSize}/${t.lineHeight} w${t.fontWeight}`).join(' | ');
    const spacing = [...(ds.tokens.spacing || []), ...(ds.tokens.radii || [])].map((s) => `${s.name}=${s.value}`).join(', ');
    const components = (ds.components || []).slice(0, 60).map((c) => c.name).join(', ');
    return { colors, typography: typo, spacing, components, source: ds.source };
  }
  return ds;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: 'OPENAI_API_KEY не задан в Vercel env' });
  }

  try {
    const { messages, context = {}, useFigmaDS } = req.body || {};
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'messages обязателен (массив с {role, content})' });
    }

    let designSystem = context.designSystem;
    if (!designSystem || useFigmaDS) {
      try { designSystem = await fetchFigmaDS(); } catch { /* keep client-supplied */ }
    }
    const dsCompact = compactDS(designSystem);

    // Собираем контекстный системный блок
    const contextBlock = [
      dsCompact ? `ДИЗАЙН-СИСТЕМА:\n  colors: ${dsCompact.colors || '—'}\n  typography: ${dsCompact.typography || '—'}\n  spacing/radii: ${dsCompact.spacing || '—'}\n  components: ${dsCompact.components || '—'}` : null,
      context.selectionNames ? `ВЫДЕЛЕНО: ${context.selectionNames.join(', ')}` : null,
      context.layoutJson ? `МАКЕТ (JSON):\n${JSON.stringify(context.layoutJson).slice(0, 8000)}` : null,
      context.issues ? `АВТО-НАЙДЕННЫЕ ПРОБЛЕМЫ:\n${JSON.stringify({
        colors: (context.issues.colors || []).slice(0, 20).map((i) => ({ node: i.nodeName, current: i.current, suggested: i.suggested, token: i.suggestedToken })),
        spacing: (context.issues.spacing || []).slice(0, 20).map((i) => ({ node: i.nodeName, property: i.property, current: i.current, suggested: i.suggested })),
        typography: (context.issues.typography || []).slice(0, 10).map((i) => ({ node: i.nodeName, current: i.current, suggested: i.suggested, token: i.suggestedToken })),
        outdated: (context.issues.outdated || []).slice(0, 10).map((i) => ({ node: i.nodeName, type: i.type, message: i.message })),
        components: (context.issues.components || []).slice(0, 10).map((i) => ({ node: i.nodeName, type: i.type, message: i.message }))
      })}` : null
    ].filter(Boolean).join('\n\n');

    // Преобразуем messages в формат Responses API.
    // Первый user-блок получает скриншот, если есть.
    const input = [
      { role: 'system', content: SYSTEM_PROMPT + (contextBlock ? `\n\n---\n${contextBlock}` : '') }
    ];

    let firstUserAdded = false;
    for (const m of messages) {
      if (m.role !== 'user' && m.role !== 'assistant') continue;
      const text = typeof m.content === 'string' ? m.content : '';
      if (m.role === 'user' && !firstUserAdded && context.screenshotBase64) {
        input.push({
          role: 'user',
          content: [
            { type: 'input_text', text },
            { type: 'input_image', image_url: `data:image/png;base64,${context.screenshotBase64}` }
          ]
        });
        firstUserAdded = true;
      } else {
        input.push({ role: m.role, content: [{ type: m.role === 'assistant' ? 'output_text' : 'input_text', text }] });
        if (m.role === 'user') firstUserAdded = true;
      }
    }

    const openaiResponse = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-5.5',
        reasoning: { effort: 'low' },
        input
      })
    });

    const data = await openaiResponse.json();
    if (!openaiResponse.ok) {
      console.error('OpenAI error:', JSON.stringify(data));
      return res.status(openaiResponse.status).json({ error: 'OpenAI API error', details: data });
    }

    let text = data.output_text;
    if (!text && Array.isArray(data.output)) {
      const messageBlock = data.output.find((o) => o.type === 'message');
      const textPart = messageBlock?.content?.find((c) => c.type === 'output_text');
      text = textPart?.text;
    }
    if (!text) return res.status(500).json({ error: 'Пустой ответ от GPT', raw: data });

    return res.status(200).json({
      reply: text,
      designSystemSource: dsCompact?.source ? {
        fileKey: dsCompact.source.fileKey,
        fileName: dsCompact.source.fileName,
        lastModified: dsCompact.source.lastModified
      } : null
    });
  } catch (e) {
    console.error('ux-chat error:', e);
    return res.status(500).json({ error: e.message });
  }
}
