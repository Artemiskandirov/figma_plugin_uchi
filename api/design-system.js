// Vercel Serverless Function — выдаёт дизайн-систему Uchi.ru Mobile App
// напрямую из Figma-файла UI Kit, а не из захардкоженного GitHub-JSON.
//
// GET /api/design-system
//   ?fileKey=8SxJj1kLRNt9ljLQdRa1Ai   (по умолчанию — UI Kit Uchi.ru Mobile App)
//   &nodeId=2544-2889                  (optional: ограничить разбор поддеревом)
//   &refresh=1                         (optional: пропустить кэш на edge)
//
// Возвращает нормализованный JSON:
// {
//   source: { fileKey, fileName, lastModified, version, nodeId },
//   tokens: {
//     colors:    [{ name, value, alias, mode, collection }],
//     typography:[{ name, fontFamily, fontWeight, fontSize, lineHeight, letterSpacing, textCase, textDecoration }],
//     radii:     [{ name, value }],
//     spacing:   [{ name, value }],
//     effects:   [{ name, type, color, offset, radius, spread }]
//   },
//   styles: {
//     fills:    [{ key, name, description, nodeId }],
//     text:     [{ key, name, description, nodeId }],
//     effects:  [{ key, name, description, nodeId }],
//     grids:    [{ key, name, description, nodeId }]
//   },
//   components:    [{ key, name, description, nodeId, containingFrame }],
//   componentSets: [{ key, name, description, nodeId }]
// }

export const config = { maxDuration: 30 };

const FIGMA_API = 'https://api.figma.com/v1';

const DEFAULT_FILE_KEY = '8SxJj1kLRNt9ljLQdRa1Ai'; // UI Kit Uchi.ru Mobile App
const DEFAULT_NODE_ID = '2544-2889';

function bad(res, status, message, extra) {
  return res.status(status).json({ error: message, ...(extra || {}) });
}

async function figmaFetch(path, token) {
  const r = await fetch(`${FIGMA_API}${path}`, {
    headers: { 'X-Figma-Token': token }
  });
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  return { ok: r.ok, status: r.status, data };
}

function rgbaToHex({ r, g, b, a }) {
  const toHex = (n) => Math.round(n * 255).toString(16).padStart(2, '0');
  const hex = `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  return a === undefined || a >= 1 ? hex : `${hex}${toHex(a)}`;
}

// Преобразуем variables/local в плоский список colors / numbers / strings / booleans.
function flattenVariables(varsPayload) {
  const out = { colors: [], radii: [], spacing: [], numbers: [], strings: [], booleans: [] };
  if (!varsPayload || !varsPayload.meta) return out;
  const { variables = {}, variableCollections = {} } = varsPayload.meta;

  const collectionName = (id) => variableCollections[id]?.name || 'default';
  const modeName = (collectionId, modeId) => {
    const c = variableCollections[collectionId];
    if (!c) return modeId;
    const m = (c.modes || []).find((mm) => mm.modeId === modeId);
    return m?.name || modeId;
  };

  for (const v of Object.values(variables)) {
    const collection = collectionName(v.variableCollectionId);
    const modes = v.valuesByMode || {};
    for (const [modeId, value] of Object.entries(modes)) {
      const mode = modeName(v.variableCollectionId, modeId);
      const base = { name: v.name, collection, mode, scopes: v.scopes };

      if (v.resolvedType === 'COLOR' && value && typeof value === 'object' && 'r' in value) {
        out.colors.push({ ...base, value: rgbaToHex(value), raw: value });
      } else if (v.resolvedType === 'COLOR' && value && value.type === 'VARIABLE_ALIAS') {
        out.colors.push({ ...base, alias: value.id });
      } else if (v.resolvedType === 'FLOAT') {
        const bucket = /radius|corner/i.test(v.name) ? out.radii
                     : /spac|gap|padding|margin|size/i.test(v.name) ? out.spacing
                     : out.numbers;
        bucket.push({ ...base, value });
      } else if (v.resolvedType === 'STRING') {
        out.strings.push({ ...base, value });
      } else if (v.resolvedType === 'BOOLEAN') {
        out.booleans.push({ ...base, value });
      }
    }
  }
  return out;
}

// Собираем токены из стилей файла, если variables/local недоступны (не-Enterprise).
async function tokensFromStyles(fileKey, styles, token) {
  const ids = styles.map((s) => s.node_id).filter(Boolean);
  if (ids.length === 0) return { colors: [], typography: [], effects: [] };

  // Figma ограничивает запрос ~500 ids на вызов — но 99% UI Kit'ов меньше.
  const chunks = [];
  for (let i = 0; i < ids.length; i += 200) chunks.push(ids.slice(i, i + 200));

  const nodes = {};
  for (const chunk of chunks) {
    const { ok, data } = await figmaFetch(`/files/${fileKey}/nodes?ids=${encodeURIComponent(chunk.join(','))}`, token);
    if (ok && data.nodes) Object.assign(nodes, data.nodes);
  }

  const colors = [];
  const typography = [];
  const effects = [];

  for (const s of styles) {
    const node = nodes[s.node_id]?.document;
    if (!node) continue;
    if (s.style_type === 'FILL') {
      const fill = (node.fills || [])[0];
      if (fill?.type === 'SOLID') {
        colors.push({ name: s.name, description: s.description, value: rgbaToHex({ ...fill.color, a: fill.opacity ?? fill.color.a }), styleKey: s.key });
      } else if (fill?.type?.startsWith('GRADIENT')) {
        colors.push({ name: s.name, description: s.description, value: fill.type, stops: fill.gradientStops, styleKey: s.key });
      }
    } else if (s.style_type === 'TEXT') {
      const t = node.style || {};
      typography.push({
        name: s.name,
        description: s.description,
        fontFamily: t.fontFamily,
        fontWeight: t.fontWeight,
        fontSize: t.fontSize,
        lineHeight: t.lineHeightPx ?? t.lineHeightPercent,
        letterSpacing: t.letterSpacing,
        textCase: t.textCase,
        textDecoration: t.textDecoration,
        styleKey: s.key
      });
    } else if (s.style_type === 'EFFECT') {
      effects.push({
        name: s.name,
        description: s.description,
        items: (node.effects || []).map((e) => ({
          type: e.type,
          color: e.color && rgbaToHex(e.color),
          offset: e.offset,
          radius: e.radius,
          spread: e.spread
        })),
        styleKey: s.key
      });
    }
  }
  return { colors, typography, effects };
}

// Простой in-memory кэш на холодный старт (на edge между инвоками не сохраняется,
// но Cache-Control ниже добавит s-maxage на CDN Vercel).
const memCache = new Map();
const TTL_MS = 5 * 60 * 1000;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return bad(res, 405, 'Method not allowed');

  const token = process.env.FIGMA_TOKEN;
  if (!token) {
    return bad(res, 500, 'FIGMA_TOKEN не задан в Vercel env. Создайте Personal Access Token в Figma (Settings → Security → Personal access tokens) и добавьте его в Project Settings → Environment Variables.');
  }

  const url = new URL(req.url, `https://${req.headers.host || 'localhost'}`);
  const fileKey = url.searchParams.get('fileKey') || DEFAULT_FILE_KEY;
  const nodeId  = url.searchParams.get('nodeId')  || DEFAULT_NODE_ID;
  const refresh = url.searchParams.get('refresh');

  const cacheKey = `${fileKey}::${nodeId}`;
  const cached = memCache.get(cacheKey);
  if (!refresh && cached && Date.now() - cached.at < TTL_MS) {
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=3600');
    res.setHeader('X-Cache', 'HIT');
    return res.status(200).json(cached.value);
  }

  try {
    // 1. Метаданные файла
    const meta = await figmaFetch(`/files/${fileKey}?depth=1`, token);
    if (!meta.ok) return bad(res, meta.status, 'Figma /files (meta) failed', meta.data);

    // 2. Стили — работает на любом плане
    const stylesResp = await figmaFetch(`/files/${fileKey}/styles`, token);
    if (!stylesResp.ok) return bad(res, stylesResp.status, 'Figma /styles failed', stylesResp.data);
    const stylesList = stylesResp.data?.meta?.styles || [];

    // 3. Компоненты и сеты
    const compResp = await figmaFetch(`/files/${fileKey}/components`, token);
    const setResp  = await figmaFetch(`/files/${fileKey}/component_sets`, token);
    const components = (compResp.data?.meta?.components || []).map((c) => ({
      key: c.key,
      name: c.name,
      description: c.description,
      nodeId: c.node_id,
      containingFrame: c.containing_frame
    }));
    const componentSets = (setResp.data?.meta?.component_sets || []).map((c) => ({
      key: c.key,
      name: c.name,
      description: c.description,
      nodeId: c.node_id
    }));

    // 4. Variables — best case (Enterprise / есть scope file_variables:read)
    let tokens = { colors: [], typography: [], radii: [], spacing: [], effects: [] };
    let tokensFromVariables = false;
    const varsResp = await figmaFetch(`/files/${fileKey}/variables/local`, token);
    if (varsResp.ok) {
      const flat = flattenVariables(varsResp.data);
      tokens.colors = flat.colors;
      tokens.radii = flat.radii;
      tokens.spacing = flat.spacing;
      tokensFromVariables = true;
    }

    // 5. Если переменных нет — собираем из стилей файла
    if (!tokensFromVariables) {
      const fromStyles = await tokensFromStyles(fileKey, stylesList, token);
      tokens.colors = fromStyles.colors;
      tokens.typography = fromStyles.typography;
      tokens.effects = fromStyles.effects;
    } else {
      // typography всё равно лежит в TEXT-стилях, не в variables
      const fromStyles = await tokensFromStyles(fileKey, stylesList.filter((s) => s.style_type === 'TEXT' || s.style_type === 'EFFECT'), token);
      tokens.typography = fromStyles.typography;
      tokens.effects = fromStyles.effects;
    }

    const grouped = {
      fills:    stylesList.filter((s) => s.style_type === 'FILL').map((s) => ({ key: s.key, name: s.name, description: s.description, nodeId: s.node_id })),
      text:     stylesList.filter((s) => s.style_type === 'TEXT').map((s) => ({ key: s.key, name: s.name, description: s.description, nodeId: s.node_id })),
      effects:  stylesList.filter((s) => s.style_type === 'EFFECT').map((s) => ({ key: s.key, name: s.name, description: s.description, nodeId: s.node_id })),
      grids:    stylesList.filter((s) => s.style_type === 'GRID').map((s) => ({ key: s.key, name: s.name, description: s.description, nodeId: s.node_id }))
    };

    const result = {
      source: {
        fileKey,
        nodeId,
        fileName: meta.data.name,
        lastModified: meta.data.lastModified,
        version: meta.data.version,
        thumbnailUrl: meta.data.thumbnailUrl,
        editorType: meta.data.editorType,
        figmaUrl: `https://www.figma.com/design/${fileKey}/?node-id=${nodeId}`,
        tokensFromVariables
      },
      tokens,
      styles: grouped,
      components,
      componentSets,
      stats: {
        totalColors: tokens.colors.length,
        totalTypography: tokens.typography.length,
        totalComponents: components.length,
        totalComponentSets: componentSets.length,
        totalStyles: stylesList.length
      }
    };

    memCache.set(cacheKey, { at: Date.now(), value: result });
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=3600');
    res.setHeader('X-Cache', 'MISS');
    return res.status(200).json(result);
  } catch (e) {
    console.error('design-system error:', e);
    return bad(res, 500, e.message);
  }
}
