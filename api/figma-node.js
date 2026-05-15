// Vercel Serverless Function — получение дерева конкретного узла/компонента
// из Figma UI Kit Uchi.ru Mobile App.
//
// GET /api/figma-node?nodeId=2544-2889
//   ?fileKey=8SxJj1kLRNt9ljLQdRa1Ai   (по умолчанию — UI Kit Uchi.ru)
//   &nodeId=2544-2889                  (обязательно; либо CSV списком)
//   &depth=2                           (optional: глубина обхода)
//   &geometry=paths                    (optional: вернуть векторы)
//   &image=1                           (optional: дополнительно вернуть PNG-превью)
//   &scale=2                           (optional: масштаб превью, 0.01-4)
//
// Используется плагином, когда нужен «эталон» — например, чтобы сравнить
// макет пользователя с настоящим компонентом UI Kit'а.

export const config = { maxDuration: 30 };

const FIGMA_API = 'https://api.figma.com/v1';
const DEFAULT_FILE_KEY = '8SxJj1kLRNt9ljLQdRa1Ai';

async function figmaFetch(path, token) {
  const r = await fetch(`${FIGMA_API}${path}`, { headers: { 'X-Figma-Token': token } });
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  return { ok: r.ok, status: r.status, data };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const token = process.env.FIGMA_TOKEN;
  if (!token) return res.status(500).json({ error: 'FIGMA_TOKEN не задан в Vercel env' });

  const url = new URL(req.url, `https://${req.headers.host || 'localhost'}`);
  const fileKey = url.searchParams.get('fileKey') || DEFAULT_FILE_KEY;
  const nodeIds = (url.searchParams.get('nodeId') || '').trim();
  if (!nodeIds) return res.status(400).json({ error: 'nodeId обязателен' });

  const depth = url.searchParams.get('depth');
  const geometry = url.searchParams.get('geometry');
  const wantImage = url.searchParams.get('image');
  const scale = url.searchParams.get('scale');

  try {
    const qs = new URLSearchParams({ ids: nodeIds });
    if (depth) qs.set('depth', depth);
    if (geometry) qs.set('geometry', geometry);

    const node = await figmaFetch(`/files/${fileKey}/nodes?${qs.toString()}`, token);
    if (!node.ok) return res.status(node.status).json({ error: 'Figma /nodes failed', details: node.data });

    let images = null;
    if (wantImage) {
      const iqs = new URLSearchParams({ ids: nodeIds, format: 'png' });
      if (scale) iqs.set('scale', scale);
      const imgResp = await figmaFetch(`/images/${fileKey}?${iqs.toString()}`, token);
      if (imgResp.ok) images = imgResp.data.images || null;
    }

    res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=600');
    return res.status(200).json({
      source: {
        fileKey,
        nodeIds: nodeIds.split(','),
        figmaUrl: `https://www.figma.com/design/${fileKey}/?node-id=${nodeIds.split(',')[0]}`
      },
      nodes: node.data.nodes,
      images
    });
  } catch (e) {
    console.error('figma-node error:', e);
    return res.status(500).json({ error: e.message });
  }
}
