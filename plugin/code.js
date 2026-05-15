// =============================================================================
// Uchi DS Sync — Main thread (Figma sandbox)
// v3: live DS from Figma UI Kit, real token binding, smart walker,
//     illustration skip, drafts, structural checks.
// =============================================================================

const VERCEL_BASE = 'https://figma-plugin-uchi.vercel.app';
const VERCEL_ENDPOINT = VERCEL_BASE + '/api/ux-review';
const DS_ENDPOINT = VERCEL_BASE + '/api/design-system';

// =============================================================================
// ДИЗАЙН-СИСТЕМА (структура и hardcoded fallback)
// =============================================================================

// effects: [{ name, styleKey?, items: [{ type, color, offset:{x,y}, radius, spread }] }]
let DS_DIAGNOSTICS = null;
let DS = {
  effects: [],
  // primitiveColors: [{ name, hex, variableKey?, styleKey?, isAlias?, aliasOf? }]
  primitiveColors: [
    { name: 'white',            hex: '#FFFFFF' },
    { name: 'space-cadet',      hex: '#2F2F45' },
    { name: 'bright-pink',      hex: '#FF6170' },
    { name: 'majorelle-blue',   hex: '#634AD6' },
    { name: 'ultra-violet',     hex: '#746AA3' },
    { name: 'lime-green',       hex: '#5FD34C' },
    { name: 'chili-red',        hex: '#EA3117' },
    { name: 'celestial-blue',   hex: '#0D99F6' },
    { name: 'robin-egg-blue',   hex: '#4CC9C2' },
    { name: 'orange-bright',    hex: '#FF8811' },
    { name: 'anti-flash-white', hex: '#F2F3F7' },
    { name: 'rich-black',       hex: '#0C1821' },
    { name: 'lemonade',         hex: '#FFCC00' },
    { name: 'magenta',          hex: '#F550E0' },
    { name: 'depp-navy',        hex: '#020159' },
    { name: 'violet-promo',     hex: '#7B42FF' },
    { name: 'green-promo',      hex: '#7CE64F' },
    { name: 'black',            hex: '#000000' }
  ],
  // spacingScale: [{ value, name?, variableKey? }] — мигрировано с массива чисел.
  spacingScale: [0, 4, 8, 12, 16, 20, 24, 32, 40, 48, 56, 64].map(function (n) { return { value: n }; }),
  // typography: [{ name, size, lh, weight, styleKey?, variableKey? }]
  typography: [
    { name: 'typo-extra-h1',                 size: 56, lh: 64, weight: 800 },
    { name: 'typo-extra-h2',                 size: 40, lh: 56, weight: 800 },
    { name: 'typo-extra-h3',                 size: 32, lh: 40, weight: 800 },
    { name: 'typo-h1-bold',                  size: 28, lh: 32, weight: 700 },
    { name: 'typo-h2-bold',                  size: 24, lh: 28, weight: 700 },
    { name: 'typo-h3-bold',                  size: 20, lh: 24, weight: 700 },
    { name: 'typo-h4-bold',                  size: 17, lh: 24, weight: 700 },
    { name: 'typo-body-bold',                size: 17, lh: 24, weight: 700 },
    { name: 'typo-body-regular',             size: 17, lh: 24, weight: 400 },
    { name: 'typo-body-small-regular',       size: 15, lh: 18, weight: 400 },
    { name: 'typo-caption-regular',          size: 13, lh: 14, weight: 400 }
  ],
  components: [
    'ButtonLarge', 'ButtonMedium', 'ButtonSmall',
    'Checkbox', 'Chip', 'InputField', 'ProgressBar',
    'Button/Brand', 'Button/Primary', 'Button/Secondary', 'Button/Tertiary', 'Button/White',
    'Button', 'Input', 'Progress'
  ]
};

let DS_SOURCE = {
  kind: 'hardcoded', fileName: null, lastModified: null,
  colors: DS.primitiveColors.length,
  spacings: DS.spacingScale.length,
  typography: DS.typography.length,
  components: DS.components.length,
  tokensFromVariables: false
};
let DS_COMPONENT_KEYS = new Set();

// =============================================================================
// УТИЛИТЫ
// =============================================================================

function rgbToHex(r, g, b) {
  function toHex(v) {
    const n = Math.round(v * 255);
    return n.toString(16).padStart(2, '0').toUpperCase();
  }
  return '#' + toHex(r) + toHex(g) + toHex(b);
}
function hexToRgb(hex) {
  const cleaned = hex.replace('#', '');
  const r = parseInt(cleaned.substring(0, 2), 16) / 255;
  const g = parseInt(cleaned.substring(2, 4), 16) / 255;
  const b = parseInt(cleaned.substring(4, 6), 16) / 255;
  return { r: r, g: g, b: b };
}

function findNearestColor(hex) {
  const candidates = findColorCandidates(hex, 1);
  return candidates[0] || null;
}
function findColorCandidates(hex, topN) {
  if (!topN) topN = 3;
  const target = hexToRgb(hex);
  const all = [];
  for (const c of DS.primitiveColors) {
    const ref = hexToRgb(c.hex);
    const dist = Math.sqrt(
      Math.pow(target.r - ref.r, 2) +
      Math.pow(target.g - ref.g, 2) +
      Math.pow(target.b - ref.b, 2)
    );
    all.push({
      name: c.name,
      hex: c.hex,
      variableKey: c.variableKey || null,
      styleKey: c.styleKey || null,
      isAlias: !!c.isAlias,
      aliasOf: c.aliasOf || null,
      distance: dist,
      exact: dist < 0.005
    });
  }
  all.sort(function (a, b) { return a.distance - b.distance; });
  return all.slice(0, topN);
}

function findNearestSpacing(value) {
  let nearest = DS.spacingScale[0];
  let minDist = Math.abs(value - (nearest.value !== undefined ? nearest.value : nearest));
  for (const s of DS.spacingScale) {
    const sv = s.value !== undefined ? s.value : s;
    const d = Math.abs(value - sv);
    if (d < minDist) { minDist = d; nearest = s; }
  }
  return nearest;
}
function findNearestTypo(size, lineHeight, weight) {
  let nearest = null;
  let minDist = Infinity;
  for (const t of DS.typography) {
    const sizeDist = Math.abs(size - t.size);
    const lhDist = Math.abs(lineHeight - t.lh) * 0.5;
    const wDist = Math.abs(weight - t.weight) * 0.01;
    const dist = sizeDist + lhDist + wDist;
    if (dist < minDist) { minDist = dist; nearest = t; }
  }
  return nearest;
}

function isColorInDS(hex) {
  return DS.primitiveColors.some(function (c) { return c.hex.toUpperCase() === hex.toUpperCase(); });
}
function isSpacingValid(value) {
  return DS.spacingScale.some(function (s) {
    const sv = s.value !== undefined ? s.value : s;
    return Math.round(sv) === Math.round(value);
  });
}
function isTypoValid(size, lineHeight, weight) {
  return DS.typography.some(function (t) {
    return Math.abs(t.size - size) < 0.5 &&
           Math.abs(t.lh - lineHeight) < 0.5 &&
           t.weight === weight;
  });
}

// =============================================================================
// ЭВРИСТИКИ "ЭТО ИЛЛЮСТРАЦИЯ"
// =============================================================================

const VECTOR_NODE_TYPES = new Set(['VECTOR', 'BOOLEAN_OPERATION', 'STAR', 'POLYGON', 'LINE']);
const ILLUSTRATION_NAME_RE = /(illustration|illustr|image|picture|hero|mascot|emoji|sticker|character|avatar|graphic|drawing)/i;
const ICON_NAME_RE = /(^|\/|\s)(icon|ic_|icn)/i;

// Узел "находится в иллюстрации", если кто-то из родителей называется как картинка.
function isInsideIllustration(node) {
  let p = node.parent;
  let depth = 0;
  while (p && depth < 20) {
    if (p.type === 'PAGE' || p.type === 'DOCUMENT') return false;
    if (p.name && ILLUSTRATION_NAME_RE.test(p.name)) return true;
    p = p.parent;
    depth++;
  }
  return false;
}
function isInsideIcon(node) {
  let p = node;
  let depth = 0;
  while (p && depth < 6) {
    if (p.name && ICON_NAME_RE.test(p.name)) return true;
    p = p.parent;
    depth++;
  }
  return false;
}

// =============================================================================
// СМАРТ-ХОДЬБА ПО ДЕРЕВУ
// — не заходим внутрь INSTANCE: их внутренности — ответственность мастер-компонента
// — не заходим внутрь иллюстраций
// =============================================================================
function walkNodes(node, callback, depth) {
  if (depth === undefined) depth = 0;
  if (depth > 50) return;
  callback(node);

  if (node.type === 'INSTANCE') return;
  if (node.name && ILLUSTRATION_NAME_RE.test(node.name)) return;

  if ('children' in node) {
    for (const child of node.children) {
      walkNodes(child, callback, depth + 1);
    }
  }
}

// =============================================================================
// ЗАГРУЗКА DS ИЗ FIGMA UI KIT ЧЕРЕЗ VERCEL
// =============================================================================

function normalizeLineHeight(lh, fontSize) {
  if (typeof lh === 'number') return lh;
  if (lh && typeof lh === 'object') {
    if (lh.unit === 'PIXELS' || lh.unit === 'px') return lh.value;
    if (lh.unit === 'PERCENT' && fontSize) return Math.round((fontSize * lh.value) / 100);
  }
  return null;
}

async function loadDSFromVercel() {
  try {
    const res = await fetch(DS_ENDPOINT);
    if (!res.ok) return { loaded: false, reason: 'DS endpoint вернул ' + res.status };
    const data = await res.json();
    if (!data || !data.tokens) return { loaded: false, reason: 'Пустой ответ от DS endpoint' };

    // === ЦВЕТА ===
    // Сначала из tokens.colors (variables после резолва алиасов).
    // Затем добавляем стили (styles.fills) — это тоже валидные DS-цвета.
    const colorsByName = {};
    function addColor(name, hex, extra) {
      if (!name || !hex || typeof hex !== 'string' || hex.charAt(0) !== '#') return;
      const hex6 = (hex.length > 7 ? hex.substring(0, 7) : hex).toUpperCase();
      if (!colorsByName[name]) {
        colorsByName[name] = Object.assign({ name: name, hex: hex6 }, extra || {});
      }
    }
    for (const c of (data.tokens.colors || [])) {
      addColor(c.name, c.value, {
        variableKey: c.variableKey,
        isAlias: !!c.isAlias,
        aliasOf: c.aliasOf || null,
        collection: c.collection,
        mode: c.mode
      });
    }
    // Fills как fallback (или дополнение) — у них есть styleKey
    for (const f of ((data.styles && data.styles.fills) || [])) {
      // У стилей цвет приходит уже разрешённым внутри tokens.colors, если был fallback
      // на стили. Здесь только добавляем styleKey к существующим цветам по имени.
      const existing = colorsByName[f.name];
      if (existing) { existing.styleKey = f.key; existing.styleId = f.nodeId; }
    }
    const loadedColors = Object.values(colorsByName);

    // === SPACING / RADII ===
    const spacingByName = {};
    for (const s of (data.tokens.spacing || [])) {
      if (typeof s.value === 'number') {
        spacingByName[s.name || ('s' + s.value)] = { value: s.value, name: s.name, variableKey: s.variableKey };
      }
    }
    for (const r of (data.tokens.radii || [])) {
      if (typeof r.value === 'number') {
        spacingByName[r.name || ('r' + r.value)] = { value: r.value, name: r.name, variableKey: r.variableKey };
      }
    }
    const loadedSpacings = Object.values(spacingByName);

    // === ЭФФЕКТЫ / ТЕНИ ===
    const loadedEffects = [];
    for (const e of (data.tokens.effects || [])) {
      if (!e || !e.name) continue;
      loadedEffects.push({
        name: e.name,
        styleKey: e.styleKey || null,
        items: e.items || []
      });
    }

    // === ТИПОГРАФИКА ===
    // Из ответа /api/design-system типографика приходит в tokens.typography (только из стилей).
    const loadedTypo = [];
    for (const t of (data.tokens.typography || [])) {
      if (!t || !t.fontSize) continue;
      const lh = normalizeLineHeight(t.lineHeight, t.fontSize);
      loadedTypo.push({
        name: t.name,
        size: t.fontSize,
        lh: lh || t.fontSize,
        weight: t.fontWeight || 400,
        styleKey: t.styleKey || null
      });
    }

    // === КОМПОНЕНТЫ ===
    const loadedComponents = [];
    DS_COMPONENT_KEYS = new Set();
    const componentKeyByName = {};
    for (const c of (data.components || [])) {
      if (c.name) {
        loadedComponents.push(c.name);
        if (c.key) {
          DS_COMPONENT_KEYS.add(c.key);
          componentKeyByName[c.name] = c.key;
        }
      }
    }
    for (const cs of (data.componentSets || [])) {
      if (cs.name && loadedComponents.indexOf(cs.name) === -1) loadedComponents.push(cs.name);
      if (cs.key) {
        DS_COMPONENT_KEYS.add(cs.key);
        componentKeyByName[cs.name] = cs.key;
      }
    }
    DS.componentKeyByName = componentKeyByName;

    if (loadedColors.length > 0) DS.primitiveColors = loadedColors;
    if (loadedSpacings.length > 0) {
      loadedSpacings.sort(function (a, b) { return a.value - b.value; });
      DS.spacingScale = loadedSpacings;
    }
    if (loadedTypo.length > 0) DS.typography = loadedTypo;
    if (loadedEffects.length > 0) DS.effects = loadedEffects;
    if (loadedComponents.length > 0) DS.components = loadedComponents;

    DS_DIAGNOSTICS = data.diagnostics || null;

    DS_SOURCE = {
      kind: 'figma',
      fileName: (data.source && data.source.fileName) || 'UI Kit Uchi.ru',
      lastModified: data.source && data.source.lastModified,
      tokensFromVariables: !!(data.source && data.source.tokensFromVariables),
      colors: loadedColors.length,
      spacings: loadedSpacings.length,
      typography: loadedTypo.length,
      components: loadedComponents.length,
      figmaUrl: data.source && data.source.figmaUrl,
      fileKey: data.source && data.source.fileKey
    };

    return { loaded: true, source: DS_SOURCE };
  } catch (e) {
    console.error('loadDSFromVercel error:', e);
    return { loaded: false, reason: e.message };
  }
}

// =============================================================================
// ЛОКАЛЬНЫЕ VARIABLES — дополнение, не перезапись
// =============================================================================

async function tryLoadDSFromFile() {
  try {
    if (!figma.variables || !figma.variables.getLocalVariableCollectionsAsync) {
      return { loaded: false, reason: 'Variables API недоступен' };
    }
    const collections = await figma.variables.getLocalVariableCollectionsAsync();
    if (!collections || collections.length === 0) {
      return { loaded: false, reason: 'В файле нет local variables' };
    }
    const loadedColors = [];
    const loadedNumbers = [];
    for (const col of collections) {
      const varIds = col.variableIds || [];
      for (const varId of varIds) {
        const v = await figma.variables.getVariableByIdAsync(varId);
        if (!v) continue;
        const modeId = col.defaultModeId;
        const value = v.valuesByMode ? v.valuesByMode[modeId] : null;
        if (!value) continue;
        if (v.resolvedType === 'COLOR' && value.r !== undefined) {
          loadedColors.push({ name: v.name, hex: rgbToHex(value.r, value.g, value.b), variableId: v.id });
        } else if (v.resolvedType === 'FLOAT' && typeof value === 'number') {
          const lname = v.name.toLowerCase();
          if (lname.indexOf('space') !== -1 || lname.indexOf('gap') !== -1 || lname.indexOf('padding') !== -1) {
            loadedNumbers.push({ value: value, name: v.name, variableId: v.id });
          }
        }
      }
    }
    if (loadedColors.length > 0) {
      const existingHex = new Set(DS.primitiveColors.map(function (c) { return c.hex.toUpperCase(); }));
      for (const c of loadedColors) {
        if (!existingHex.has(c.hex.toUpperCase())) DS.primitiveColors.push(c);
      }
    }
    if (loadedNumbers.length > 0) {
      const existingVals = new Set(DS.spacingScale.map(function (s) { return s.value; }));
      for (const n of loadedNumbers) {
        if (!existingVals.has(n.value)) DS.spacingScale.push(n);
      }
      DS.spacingScale.sort(function (a, b) { return a.value - b.value; });
    }
    return {
      loaded: loadedColors.length > 0 || loadedNumbers.length > 0,
      colors: loadedColors.length,
      spacings: loadedNumbers.length
    };
  } catch (e) {
    console.error('tryLoadDSFromFile error:', e);
    return { loaded: false, reason: e.message };
  }
}

// =============================================================================
// АНАЛИЗ
// =============================================================================

// Эвристика: "это похоже на кнопку, но не компонент".
// Frame с auto-layout, прямоугольной формой, одним текстовым ребёнком,
// возможно иконкой — и тип FRAME (не INSTANCE / COMPONENT).
function looksLikeAdHocButton(node) {
  if (node.type !== 'FRAME') return false;
  if (!node.layoutMode || node.layoutMode === 'NONE') return false;
  if (!('children' in node) || node.children.length === 0 || node.children.length > 3) return false;
  const textChildren = node.children.filter(function (c) { return c.type === 'TEXT'; });
  if (textChildren.length !== 1) return false;
  const cornerOk = typeof node.cornerRadius === 'number' && node.cornerRadius > 4;
  const hasFill = Array.isArray(node.fills) && node.fills.some(function (f) { return f && f.visible !== false; });
  const sizeOk = node.width > 60 && node.width < 400 && node.height > 28 && node.height < 80;
  return cornerOk && hasFill && sizeOk;
}

// Сравнение эффекта-в-макете с эффектом-в-DS. Дешёво по 4 ключевым параметрам.
function effectsApproxEqual(a, b) {
  if (!a || !b || a.type !== b.type) return false;
  const cA = a.color || {};
  const cB = b.color || {};
  const rgbDist = Math.sqrt(
    Math.pow((cA.r || 0) - (cB.r || 0), 2) +
    Math.pow((cA.g || 0) - (cB.g || 0), 2) +
    Math.pow((cA.b || 0) - (cB.b || 0), 2)
  );
  const oxA = a.offset ? a.offset.x : 0;
  const oyA = a.offset ? a.offset.y : 0;
  const oxB = b.offset ? b.offset.x : 0;
  const oyB = b.offset ? b.offset.y : 0;
  return rgbDist < 0.05 &&
         Math.abs((a.radius || 0) - (b.radius || 0)) < 1.5 &&
         Math.abs(oxA - oxB) < 1.5 &&
         Math.abs(oyA - oyB) < 1.5;
}

function findEffectMatch(nodeEffect) {
  for (const e of DS.effects) {
    if (!e.items || !e.items.length) continue;
    // e.items[0] — у Effect Style может быть несколько слоёв,
    // но обычно тень/блюр в одном стиле — один слой.
    for (const item of e.items) {
      const styleEffectColor = item.color && typeof item.color === 'string' ?
        hexToRgb(item.color.length > 7 ? item.color.substring(0, 7) : item.color) :
        item.color;
      if (effectsApproxEqual(nodeEffect, { type: item.type, color: styleEffectColor, offset: item.offset, radius: item.radius })) {
        return e;
      }
    }
  }
  return null;
}

function analyzeFrame(rootNode) {
  const issues = {
    colors: [],
    colorsForeign: [],          // цвет не в DS — кандидат на черновик
    spacing: [],
    typography: [],
    effects: [],                // тени / эффекты не из DS
    components: [],             // foreign / not-in-DS
    componentsAdHoc: [],        // выглядит как кнопка, но не компонент
    componentDuplicates: [],    // один и тот же компонент дублируется внутри parent'а
    outdated: []
  };

  const layoutSummary = {
    name: rootNode.name,
    width: 'width' in rootNode ? rootNode.width : null,
    height: 'height' in rootNode ? rootNode.height : null,
    children: []
  };
  const instanceNodes = [];

  walkNodes(rootNode, function (node) {
    const inIllustration = isInsideIllustration(node);
    const inIcon = isInsideIcon(node);
    const isVector = VECTOR_NODE_TYPES.has(node.type);
    const skipColor = inIllustration || isVector;

    // === ЦВЕТА (skip illustrations & vectors) ===
    if (!skipColor) {
      if ('fills' in node && Array.isArray(node.fills)) {
        for (const fill of node.fills) {
          if (fill.type === 'SOLID' && fill.visible !== false) {
            const hex = rgbToHex(fill.color.r, fill.color.g, fill.color.b);
            const candidates = findColorCandidates(hex, 3);
            const nearest = candidates[0];
            const exact = nearest && nearest.exact;
            if (!exact) {
              // Если "очень похожий" токен есть (high confidence) — обычное исправление.
              // Если "далёкий" (low) — это чужой цвет, кандидат на черновик в DS.
              const conf = nearest && nearest.distance < 0.05 ? 'high' : nearest && nearest.distance < 0.18 ? 'medium' : 'low';
              if (conf === 'low') {
                issues.colorsForeign.push({
                  id: node.id + '-fill-foreign',
                  nodeId: node.id,
                  nodeName: node.name,
                  property: 'fill',
                  current: hex,
                  inIcon: inIcon
                });
              } else {
                issues.colors.push({
                  id: node.id + '-fill',
                  nodeId: node.id,
                  nodeName: node.name,
                  property: 'fill',
                  current: hex,
                  suggested: nearest.hex,
                  suggestedToken: nearest.name,
                  variableKey: nearest.variableKey,
                  styleKey: nearest.styleKey,
                  candidates: candidates,
                  confidence: conf
                });
              }
            }
          }
        }
      }
      if ('strokes' in node && Array.isArray(node.strokes)) {
        for (const stroke of node.strokes) {
          if (stroke.type === 'SOLID' && stroke.visible !== false) {
            const hex = rgbToHex(stroke.color.r, stroke.color.g, stroke.color.b);
            const candidates = findColorCandidates(hex, 3);
            const nearest = candidates[0];
            if (!nearest.exact) {
              const conf = nearest.distance < 0.05 ? 'high' : nearest.distance < 0.18 ? 'medium' : 'low';
              if (conf === 'low') {
                issues.colorsForeign.push({
                  id: node.id + '-stroke-foreign',
                  nodeId: node.id, nodeName: node.name, property: 'stroke',
                  current: hex, inIcon: inIcon
                });
              } else {
                issues.colors.push({
                  id: node.id + '-stroke',
                  nodeId: node.id, nodeName: node.name, property: 'stroke',
                  current: hex,
                  suggested: nearest.hex,
                  suggestedToken: nearest.name,
                  variableKey: nearest.variableKey,
                  styleKey: nearest.styleKey,
                  candidates: candidates,
                  confidence: conf
                });
              }
            }
          }
        }
      }
    }

    // === ОТСТУПЫ — только на frame'ах с auto-layout, без иллюстраций ===
    if ((node.type === 'FRAME' || node.type === 'COMPONENT') && !inIllustration) {
      if (node.layoutMode && node.layoutMode !== 'NONE') {
        const paddings = [
          { prop: 'paddingLeft', value: node.paddingLeft },
          { prop: 'paddingRight', value: node.paddingRight },
          { prop: 'paddingTop', value: node.paddingTop },
          { prop: 'paddingBottom', value: node.paddingBottom },
          { prop: 'itemSpacing', value: node.itemSpacing }
        ];
        for (const p of paddings) {
          if (typeof p.value === 'number' && !isSpacingValid(p.value)) {
            const nearest = findNearestSpacing(p.value);
            issues.spacing.push({
              id: node.id + '-' + p.prop,
              nodeId: node.id,
              nodeName: node.name,
              property: p.prop,
              current: Math.round(p.value),
              suggested: nearest.value,
              suggestedToken: nearest.name,
              variableKey: nearest.variableKey
            });
          }
        }
      }
    }

    // === ТИПОГРАФИКА ===
    if (node.type === 'TEXT' && !inIllustration) {
      const fontSize = typeof node.fontSize === 'number' ? node.fontSize : null;
      const lineHeight =
        node.lineHeight && typeof node.lineHeight === 'object' && node.lineHeight.unit === 'PIXELS'
          ? node.lineHeight.value
          : null;
      const fontName = node.fontName && typeof node.fontName === 'object' ? node.fontName : null;
      const styleName = fontName ? fontName.style : '';
      const weight = /black|extra\s*bold|heavy/i.test(styleName) ? 800
                   : /semibold|demi|600/i.test(styleName) ? 600
                   : /bold|700/i.test(styleName) ? 700
                   : /medium|500/i.test(styleName) ? 500
                   : 400;

      if (fontSize && lineHeight) {
        if (!isTypoValid(fontSize, lineHeight, weight)) {
          const nearest = findNearestTypo(fontSize, lineHeight, weight);
          if (nearest) {
            issues.typography.push({
              id: node.id + '-typo',
              nodeId: node.id,
              nodeName: node.name,
              current: fontSize + '/' + lineHeight + ' w' + weight,
              suggested: nearest.size + '/' + nearest.lh + ' w' + nearest.weight,
              suggestedToken: nearest.name,
              styleKey: nearest.styleKey,
              targetSize: nearest.size,
              targetLineHeight: nearest.lh,
              targetWeight: nearest.weight
            });
          }
        }
      }
    }

    // === ИНСТАНСЫ — собираем для async-проверки outdated ===
    if (node.type === 'INSTANCE') {
      instanceNodes.push(node);
    }

    // === ТЕНИ / ЭФФЕКТЫ ===
    if (!inIllustration && 'effects' in node && Array.isArray(node.effects) && node.effects.length > 0) {
      for (let i = 0; i < node.effects.length; i++) {
        const ef = node.effects[i];
        if (!ef || ef.visible === false) continue;
        if (ef.type !== 'DROP_SHADOW' && ef.type !== 'INNER_SHADOW' && ef.type !== 'LAYER_BLUR' && ef.type !== 'BACKGROUND_BLUR') continue;
        if (DS.effects.length === 0) continue; // нечего сравнивать
        const matched = findEffectMatch(ef);
        if (!matched) {
          const colorHex = ef.color ? rgbToHex(ef.color.r, ef.color.g, ef.color.b) : '—';
          issues.effects.push({
            id: node.id + '-effect-' + i,
            nodeId: node.id,
            nodeName: node.name,
            effectType: ef.type,
            current: ef.type + ' ' + colorHex + ' r' + (ef.radius || 0) + (ef.offset ? ' ↘' + ef.offset.x + '/' + ef.offset.y : ''),
            message: 'Тень не соответствует ни одному эффекту из DS'
          });
        }
      }
    }

    // === "Похоже на кнопку, но не компонент" ===
    if (looksLikeAdHocButton(node)) {
      issues.componentsAdHoc.push({
        id: node.id + '-adhoc-button',
        nodeId: node.id,
        nodeName: node.name,
        type: 'ad_hoc_button',
        message: '"' + node.name + '" выглядит как кнопка, но это обычный фрейм. Заверните в Button-компонент DS.',
        textSample: (node.children.find(function (c) { return c.type === 'TEXT'; }) || {}).characters || ''
      });
    }

    if ((node.type === 'FRAME' || node.type === 'TEXT' || node.type === 'INSTANCE' || node.type === 'COMPONENT') && node !== rootNode) {
      layoutSummary.children.push({
        type: node.type,
        name: node.name,
        text: node.type === 'TEXT' ? node.characters : undefined
      });
    }
  });

  return { issues: issues, layoutSummary: layoutSummary, instanceNodes: instanceNodes };
}

// =============================================================================
// ДУБЛИ — один и тот же компонент несколько раз внутри одного parent'а.
// Это может быть осознанным (список карточек), а может быть случайным
// (две одинаковых кнопки рядом). Сами не решаем — выдаём кнопкой к GPT.
// =============================================================================
async function detectComponentDuplicates(instanceNodes) {
  const byParentAndKey = {};
  const mainCache = {};

  for (const inst of instanceNodes) {
    if (!inst.parent) continue;
    let main;
    if (mainCache[inst.id]) main = mainCache[inst.id];
    else {
      try { main = await inst.getMainComponentAsync(); } catch (e) { main = null; }
      mainCache[inst.id] = main;
    }
    if (!main || !main.key) continue;
    const setKey = main.parent && main.parent.type === 'COMPONENT_SET' ? main.parent.key : null;
    const groupKey = (setKey || main.key);
    const bucketKey = inst.parent.id + '::' + groupKey;
    if (!byParentAndKey[bucketKey]) {
      byParentAndKey[bucketKey] = {
        parentId: inst.parent.id,
        parentName: inst.parent.name,
        parentLayout: inst.parent.layoutMode || 'NONE',
        componentKey: main.key,
        componentName: main.name,
        setKey: setKey,
        instances: []
      };
    }
    byParentAndKey[bucketKey].instances.push({
      nodeId: inst.id,
      nodeName: inst.name,
      // variant-properties помогут GPT понять, идентичные это карточки или разные стейты
      variantProps: inst.variantProperties || null,
      overrides: (inst.componentProperties && Object.keys(inst.componentProperties).length > 0) ? inst.componentProperties : null
    });
  }

  const dupes = [];
  for (const bucket of Object.values(byParentAndKey)) {
    if (bucket.instances.length < 2) continue;
    // Эвристика: если parent в auto-layout И все variants identical — скорее всего список (OK).
    const identicalVariants = bucket.instances.every(function (it) {
      return JSON.stringify(it.variantProps) === JSON.stringify(bucket.instances[0].variantProps);
    });
    const isListLike = (bucket.parentLayout === 'VERTICAL' || bucket.parentLayout === 'HORIZONTAL') && identicalVariants;
    dupes.push({
      id: bucket.parentId + '-dup-' + bucket.componentKey,
      parentId: bucket.parentId,
      parentName: bucket.parentName,
      componentName: bucket.componentName,
      count: bucket.instances.length,
      instances: bucket.instances,
      identicalVariants: identicalVariants,
      isListLike: isListLike,
      severity: isListLike ? 'info' : 'warning'
    });
  }
  return dupes;
}

// =============================================================================
// OUTDATED / FOREIGN COMPONENTS DETECTION (без захода во внутренности инстансов)
// =============================================================================
async function detectOutdatedAndDetached(instanceNodes) {
  const outdated = [];
  const components = [];

  for (const instance of instanceNodes) {
    try {
      const main = await instance.getMainComponentAsync();

      if (!main) {
        outdated.push({
          id: instance.id + '-detached',
          nodeId: instance.id, nodeName: instance.name,
          type: 'detached',
          message: 'Мастер-компонент удалён или недоступен',
          updatable: false
        });
        continue;
      }

      if (main.remote === true && main.key) {
        const fromUchiKit = DS_COMPONENT_KEYS.size > 0 ? DS_COMPONENT_KEYS.has(main.key) : null;
        const setKey = main.parent && main.parent.type === 'COMPONENT_SET' ? main.parent.key : null;
        const fromUchiViaSet = setKey && DS_COMPONENT_KEYS.has(setKey);

        try {
          const latest = await figma.importComponentByKeyAsync(main.key);
          if (latest && latest.id !== main.id) {
            outdated.push({
              id: instance.id + '-outdated',
              nodeId: instance.id, nodeName: instance.name,
              type: 'outdated',
              message: 'Доступно обновление компонента "' + main.name + '"',
              componentKey: main.key,
              updatable: true,
              fromUchiKit: fromUchiKit || fromUchiViaSet
            });
            continue;
          }
        } catch (e) {
          // Импорт упал — но это не значит, что компонент broken: возможно нет
          // прав или сети. Не пишем "MISSING", если ключ есть в нашем UI Kit'е.
          if (!(fromUchiKit || fromUchiViaSet)) {
            outdated.push({
              id: instance.id + '-unknown',
              nodeId: instance.id, nodeName: instance.name,
              type: 'unknown_library',
              message: '"' + main.name + '" не найден в актуальной library',
              updatable: false
            });
          }
          continue;
        }

        if (fromUchiKit === false && fromUchiViaSet === false) {
          components.push({
            id: instance.id + '-foreign-kit',
            nodeId: instance.id, nodeName: instance.name,
            type: 'foreign_library',
            componentName: main.name,
            message: '"' + main.name + '" подключён из другой библиотеки, не из UI Kit Uchi.ru'
          });
        }
      } else if (!main.remote) {
        // Локальный компонент в текущем файле, не из библиотеки.
        components.push({
          id: instance.id + '-local-component',
          nodeId: instance.id, nodeName: instance.name,
          type: 'local_component',
          componentName: main.name,
          componentNodeId: main.id,
          message: '"' + main.name + '" — локальный компонент, его нет в UI Kit Uchi.ru. Перенести в DS как черновик?'
        });
      }
    } catch (e) {
      console.error('outdated check failed for', instance.id, e);
    }
  }
  return { outdated: outdated, components: components };
}

// =============================================================================
// ФИКСЫ — теперь биндим переменные/стили, а не просто меняем сырое значение
// =============================================================================

async function fixColor(nodeId, property, suggestedHex, variableKey, styleKey) {
  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) return false;
  const key = property === 'fill' ? 'fills' : 'strokes';
  if (!(key in node)) return false;
  const current = node[key];
  if (!Array.isArray(current) || current.length === 0) return false;

  // 1. Пытаемся забиндить ПЕРЕМЕННУЮ (это правильно работает с темами/модами).
  if (variableKey && figma.variables && figma.variables.importVariableByKeyAsync) {
    try {
      const variable = await figma.variables.importVariableByKeyAsync(variableKey);
      const newPaints = current.map(function (p) {
        if (p.type !== 'SOLID') return p;
        return figma.variables.setBoundVariableForPaint(p, 'color', variable);
      });
      node[key] = newPaints;
      return true;
    } catch (e) {
      console.warn('bind variable failed, fallback to style/raw:', e);
    }
  }

  // 2. Если нет variableKey, но есть styleKey — биндим Paint Style.
  // Используем унифицированный figma.importStyleByKeyAsync(key) → BaseStyle
  // и сверяем style.type. Отдельных importPaintStyleByKeyAsync / importTextStyleByKeyAsync
  // в Plugin API не существует (см. plugin-api.d.ts).
  if (styleKey && figma.importStyleByKeyAsync) {
    try {
      const style = await figma.importStyleByKeyAsync(styleKey);
      if (style && style.type === 'PAINT') {
        if (property === 'fill' && node.setFillStyleIdAsync) {
          await node.setFillStyleIdAsync(style.id);
          return true;
        }
        if (property === 'stroke' && node.setStrokeStyleIdAsync) {
          await node.setStrokeStyleIdAsync(style.id);
          return true;
        }
        // Fallback на legacy property (не dynamic-page).
        if (property === 'fill' && 'fillStyleId' in node) { node.fillStyleId = style.id; return true; }
        if (property === 'stroke' && 'strokeStyleId' in node) { node.strokeStyleId = style.id; return true; }
      }
    } catch (e) {
      console.warn('bind paint style failed, fallback to raw:', e);
    }
  }

  // 3. Финальный fallback — просто меняем цвет (как раньше).
  const newColor = hexToRgb(suggestedHex);
  const newArr = current.map(function (f) {
    return f.type === 'SOLID' ? Object.assign({}, f, { color: newColor }) : f;
  });
  node[key] = newArr;
  return true;
}

async function fixSpacing(nodeId, property, value, variableKey) {
  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) return false;
  if (!(property in node)) return false;

  // Пытаемся забиндить переменную spacing.
  if (variableKey && figma.variables && figma.variables.importVariableByKeyAsync) {
    try {
      const variable = await figma.variables.importVariableByKeyAsync(variableKey);
      if (node.setBoundVariable) {
        node.setBoundVariable(property, variable);
        return true;
      }
    } catch (e) {
      console.warn('bind spacing variable failed, fallback to raw:', e);
    }
  }

  try {
    node[property] = value;
    return true;
  } catch (e) { return false; }
}

async function fixTypography(nodeId, targetSize, targetLineHeight, targetWeight, styleKey) {
  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node || node.type !== 'TEXT') return false;

  // Если есть styleKey — биндим Text Style целиком.
  // figma.importStyleByKeyAsync — единственный правильный путь, отдельного
  // importTextStyleByKeyAsync в API нет.
  if (styleKey && figma.importStyleByKeyAsync) {
    try {
      const style = await figma.importStyleByKeyAsync(styleKey);
      if (style && style.type === 'TEXT') {
        const fonts = node.fontName ? [node.fontName] : [];
        for (const f of fonts) { try { await figma.loadFontAsync(f); } catch (e) {} }
        if (node.setTextStyleIdAsync) {
          await node.setTextStyleIdAsync(style.id);
        } else if ('textStyleId' in node) {
          node.textStyleId = style.id;
        }
        return true;
      }
    } catch (e) {
      console.warn('bind text style failed, fallback to raw:', e);
    }
  }

  // Fallback: меняем сырые значения.
  try {
    const currentFont = node.fontName;
    if (typeof currentFont === 'object') {
      const newStyle = targetWeight >= 700 ? 'Bold' : targetWeight >= 500 ? 'Medium' : 'Regular';
      const newFont = { family: currentFont.family, style: newStyle };
      try { await figma.loadFontAsync(newFont); node.fontName = newFont; } catch (e) {}
    }
    node.fontSize = targetSize;
    node.lineHeight = { value: targetLineHeight, unit: 'PIXELS' };
    return true;
  } catch (e) { return false; }
}

async function updateOutdatedInstance(nodeId, componentKey) {
  try {
    const node = await figma.getNodeByIdAsync(nodeId);
    if (!node || node.type !== 'INSTANCE') return false;
    const latest = await figma.importComponentByKeyAsync(componentKey);
    if (!latest) return false;
    if (typeof node.swapComponent === 'function') node.swapComponent(latest);
    else node.mainComponent = latest;
    return true;
  } catch (e) {
    console.error('update outdated failed:', e);
    return false;
  }
}

async function focusNode(nodeId) {
  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) return;
  figma.currentPage.selection = [node];
  figma.viewport.scrollAndZoomIntoView([node]);
}

// =============================================================================
// DRAFTS — locally в clientStorage; материализуются на странице "🔴 Drafts"
// =============================================================================

const DRAFTS_KEY = 'uchi-ds-drafts-v1';

async function getDrafts() {
  try { return (await figma.clientStorage.getAsync(DRAFTS_KEY)) || []; }
  catch (e) { return []; }
}
async function setDrafts(list) {
  try { await figma.clientStorage.setAsync(DRAFTS_KEY, list); } catch (e) {}
}
async function addDraft(item) {
  const drafts = await getDrafts();
  item.id = 'draft-' + Date.now() + '-' + Math.random().toString(36).substring(2, 8);
  item.createdAt = Date.now();
  drafts.unshift(item);
  await setDrafts(drafts);
  return drafts;
}
async function removeDraft(id) {
  let drafts = await getDrafts();
  drafts = drafts.filter(function (d) { return d.id !== id; });
  await setDrafts(drafts);
  return drafts;
}

// Создаёт (или находит) страницу "🔴 Drafts" и кладёт туда содержимое черновиков:
// - цвета как rectangle + подпись
// - локальные компоненты как ссылочные плейсхолдеры с текстом-маркером
async function materializeDrafts() {
  await figma.loadAllPagesAsync().catch(function () {});
  const PAGE_NAME = '🔴 Drafts';
  let page = figma.root.children.find(function (p) { return p.name === PAGE_NAME; });
  if (!page) {
    page = figma.createPage();
    page.name = PAGE_NAME;
  }
  const drafts = await getDrafts();
  if (drafts.length === 0) return { ok: false, reason: 'Нет черновиков' };

  await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
  await figma.loadFontAsync({ family: 'Inter', style: 'Bold' });

  // Раскладываем колонками: слева цвета, справа компоненты.
  let colorY = 80;
  let compY = 80;
  const COL_COLOR_X = 80;
  const COL_COMP_X = 600;

  for (const d of drafts) {
    if (d.type === 'color') {
      const rect = figma.createRectangle();
      rect.x = COL_COLOR_X; rect.y = colorY;
      rect.resize(120, 80);
      const rgb = hexToRgb(d.hex);
      rect.fills = [{ type: 'SOLID', color: rgb }];
      rect.cornerRadius = 12;
      rect.name = d.proposedName || d.hex;
      page.appendChild(rect);

      const txt = figma.createText();
      txt.fontName = { family: 'Inter', style: 'Bold' };
      txt.characters = (d.proposedName || 'new color') + '\n' + d.hex;
      txt.fontSize = 12;
      txt.x = COL_COLOR_X + 140; txt.y = colorY + 16;
      page.appendChild(txt);

      colorY += 110;
    } else if (d.type === 'component') {
      const frame = figma.createFrame();
      frame.x = COL_COMP_X; frame.y = compY;
      frame.resize(280, 100);
      frame.cornerRadius = 16;
      frame.fills = [{ type: 'SOLID', color: { r: 0.98, g: 0.95, b: 0.95 } }];
      frame.strokes = [{ type: 'SOLID', color: { r: 0.9, g: 0.2, b: 0.2 } }];
      frame.strokeWeight = 1;
      frame.name = '🔴 ' + (d.proposedName || d.sourceName);
      frame.layoutMode = 'VERTICAL';
      frame.paddingLeft = frame.paddingRight = frame.paddingTop = frame.paddingBottom = 14;
      frame.itemSpacing = 6;

      const t1 = figma.createText();
      t1.fontName = { family: 'Inter', style: 'Bold' };
      t1.characters = d.proposedName || d.sourceName || 'New component';
      t1.fontSize = 14;
      frame.appendChild(t1);

      const t2 = figma.createText();
      t2.fontName = { family: 'Inter', style: 'Regular' };
      t2.characters = 'Источник: ' + (d.sourceName || d.sourceNodeId || '') + (d.sourceFile ? '\nFile: ' + d.sourceFile : '');
      t2.fontSize = 11;
      frame.appendChild(t2);

      page.appendChild(frame);
      compY += 130;
    }
  }

  figma.currentPage = page;
  figma.viewport.scrollAndZoomIntoView(page.children.slice(0, 10));
  return { ok: true, count: drafts.length, pageName: PAGE_NAME };
}

// =============================================================================
// СКРИНШОТ
// =============================================================================
async function makeScreenshot(node) {
  try {
    const bytes = await node.exportAsync({ format: 'PNG', constraint: { type: 'SCALE', value: 1 } });
    return figma.base64Encode(bytes);
  } catch (e) { console.error('Screenshot failed:', e); return null; }
}

// =============================================================================
// SELECTION
// =============================================================================
function sendSelectionState() {
  const sel = figma.currentPage.selection;
  const validFrames = sel.filter(function (n) {
    return n.type === 'FRAME' || n.type === 'COMPONENT' || n.type === 'INSTANCE' || n.type === 'SECTION';
  });
  figma.ui.postMessage({
    type: 'selection-changed',
    count: validFrames.length,
    names: validFrames.map(function (n) { return n.name; })
  });
}

// =============================================================================
// MAIN
// =============================================================================

figma.showUI(__html__, { width: 400, height: 720, themeColors: true });

function sendDSLibrary() {
  figma.ui.postMessage({
    type: 'ds-library',
    library: {
      colors: DS.primitiveColors,
      typography: DS.typography,
      spacing: DS.spacingScale,
      effects: DS.effects,
      components: DS.components,
      source: DS_SOURCE,
      diagnostics: DS_DIAGNOSTICS
    }
  });
}

async function sendDrafts() {
  const drafts = await getDrafts();
  figma.ui.postMessage({ type: 'drafts', drafts: drafts, fileKey: figma.fileKey || null });
}

async function bootstrapDS() {
  const vercelResult = await loadDSFromVercel();
  let localResult = null;
  try { localResult = await tryLoadDSFromFile(); } catch (e) { /* ignore */ }

  figma.ui.postMessage({
    type: 'ds-status',
    loaded: vercelResult.loaded || (localResult && localResult.loaded),
    source: DS_SOURCE,
    localAttached: !!(localResult && localResult.loaded),
    reason: vercelResult.loaded ? null : (vercelResult.reason || (localResult && localResult.reason))
  });
  sendDSLibrary();
  sendDrafts();
}
bootstrapDS();

figma.on('selectionchange', sendSelectionState);
setTimeout(sendSelectionState, 50);

figma.ui.onmessage = async function (msg) {
  if (msg.type === 'analyze') {
    const sel = figma.currentPage.selection;
    const targets = sel.filter(function (n) {
      return n.type === 'FRAME' || n.type === 'COMPONENT' || n.type === 'INSTANCE' || n.type === 'SECTION';
    });
    if (targets.length === 0) {
      figma.ui.postMessage({ type: 'error', message: 'Выдели фрейм для анализа' });
      return;
    }
    figma.ui.postMessage({ type: 'analyze-start', frameCount: targets.length });

    const allIssues = {
      colors: [], colorsForeign: [], spacing: [], typography: [], effects: [],
      components: [], componentsAdHoc: [], componentDuplicates: [], outdated: []
    };
    const allInstances = [];
    const layoutSummaries = [];

    for (const target of targets) {
      const result = analyzeFrame(target);
      Array.prototype.push.apply(allIssues.colors, result.issues.colors);
      Array.prototype.push.apply(allIssues.colorsForeign, result.issues.colorsForeign);
      Array.prototype.push.apply(allIssues.spacing, result.issues.spacing);
      Array.prototype.push.apply(allIssues.typography, result.issues.typography);
      Array.prototype.push.apply(allIssues.effects, result.issues.effects);
      Array.prototype.push.apply(allIssues.components, result.issues.components);
      Array.prototype.push.apply(allIssues.componentsAdHoc, result.issues.componentsAdHoc);
      Array.prototype.push.apply(allInstances, result.instanceNodes);
      layoutSummaries.push(result.layoutSummary);
    }

    try {
      const compResult = await detectOutdatedAndDetached(allInstances);
      Array.prototype.push.apply(allIssues.outdated, compResult.outdated);
      Array.prototype.push.apply(allIssues.components, compResult.components);
    } catch (e) { console.error('outdated detection failed:', e); }

    try {
      const dupes = await detectComponentDuplicates(allInstances);
      Array.prototype.push.apply(allIssues.componentDuplicates, dupes);
    } catch (e) { console.error('duplicates detection failed:', e); }

    figma.ui.postMessage({ type: 'analyze-result', issues: allIssues, frameNames: targets.map(function (t) { return t.name; }) });

    const screenshot = await makeScreenshot(targets[0]);
    const dsCompact = {
      colors: DS.primitiveColors.map(function (c) { return c.name + '=' + c.hex; }).join(', '),
      spacing: DS.spacingScale.map(function (s) { return s.value; }),
      typography: DS.typography.slice(0, 12).map(function (t) { return t.name + '=' + t.size + '/' + t.lh + '/' + t.weight; }).join('; '),
      components: DS.components.slice(0, 12)
    };

    const reviewContext = {
      layoutJson: layoutSummaries.length === 1 ? layoutSummaries[0] : layoutSummaries,
      issues: allIssues,
      selectionNames: targets.map(function (t) { return t.name; }),
      screenshotBase64: screenshot
    };

    figma.ui.postMessage({
      type: 'analyze-context',
      context: reviewContext,
      dsCompact: dsCompact
    });
  }

  if (msg.type === 'focus-node') {
    await focusNode(msg.nodeId);
  }
  if (msg.type === 'fix-color') {
    const ok = await fixColor(msg.nodeId, msg.property, msg.suggested, msg.variableKey, msg.styleKey);
    figma.ui.postMessage({ type: 'fix-result', id: msg.id, ok: ok });
  }
  if (msg.type === 'fix-spacing') {
    const ok = await fixSpacing(msg.nodeId, msg.property, msg.suggested, msg.variableKey);
    figma.ui.postMessage({ type: 'fix-result', id: msg.id, ok: ok });
  }
  if (msg.type === 'fix-typography') {
    const ok = await fixTypography(msg.nodeId, msg.targetSize, msg.targetLineHeight, msg.targetWeight, msg.styleKey);
    figma.ui.postMessage({ type: 'fix-result', id: msg.id, ok: ok });
  }
  if (msg.type === 'update-outdated') {
    const ok = await updateOutdatedInstance(msg.nodeId, msg.componentKey);
    figma.ui.postMessage({ type: 'fix-result', id: msg.id, ok: ok });
  }
  if (msg.type === 'fix-all') {
    const results = [];
    for (const fix of msg.fixes) {
      let ok = false;
      if (fix.category === 'color') ok = await fixColor(fix.nodeId, fix.property, fix.suggested, fix.variableKey, fix.styleKey);
      else if (fix.category === 'spacing') ok = await fixSpacing(fix.nodeId, fix.property, fix.suggested, fix.variableKey);
      else if (fix.category === 'typography') ok = await fixTypography(fix.nodeId, fix.targetSize, fix.targetLineHeight, fix.targetWeight, fix.styleKey);
      else if (fix.category === 'outdated') ok = await updateOutdatedInstance(fix.nodeId, fix.componentKey);
      results.push({ id: fix.id, ok: ok });
    }
    figma.ui.postMessage({ type: 'fix-all-result', results: results });
  }
  if (msg.type === 'refresh-ds') {
    const v = await loadDSFromVercel();
    let l = null; try { l = await tryLoadDSFromFile(); } catch (e) {}
    figma.ui.postMessage({
      type: 'ds-status',
      loaded: v.loaded || (l && l.loaded),
      source: DS_SOURCE,
      localAttached: !!(l && l.loaded),
      reason: v.loaded ? null : (v.reason || (l && l.reason))
    });
    sendDSLibrary();
  }
  if (msg.type === 'request-library') sendDSLibrary();
  if (msg.type === 'request-drafts') sendDrafts();
  if (msg.type === 'add-draft') {
    await addDraft(msg.item);
    await sendDrafts();
    figma.ui.postMessage({ type: 'draft-added' });
  }
  if (msg.type === 'remove-draft') {
    await removeDraft(msg.id);
    await sendDrafts();
  }
  if (msg.type === 'materialize-drafts') {
    const r = await materializeDrafts();
    figma.ui.postMessage({ type: 'materialize-result', ok: r.ok, count: r.count, reason: r.reason });
  }
  if (msg.type === 'close') figma.closePlugin();
};
