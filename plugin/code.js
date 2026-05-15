// =============================================================================
// Uchi DS Sync — Main thread (Figma sandbox)
// v2: selection workflow, outdated components, child/parent perspectives
// =============================================================================

const VERCEL_BASE = 'https://figma-plugin-uchi.vercel.app';
const VERCEL_ENDPOINT = VERCEL_BASE + '/api/ux-review';
const DS_ENDPOINT = VERCEL_BASE + '/api/design-system';

// =============================================================================
// ДИЗАЙН-СИСТЕМА
//
// Источники, в порядке приоритета:
//   1. /api/design-system на Vercel → читает Figma file UI Kit Uchi.ru
//      Mobile App (8SxJj1kLRNt9ljLQdRa1Ai) через Figma REST API.
//      Это первоисточник: токены, стили, компоненты — живые.
//   2. tryLoadDSFromFile() — local Variables текущего файла (если юзер
//      подключил library Uchi DS в файл).
//   3. Захардкоженный fallback ниже — на случай оффлайна.
// =============================================================================

let DS = {
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
  spacingScale: [0, 4, 8, 12, 16, 20, 24, 32, 40, 48, 56, 64],
  typography: [
    { name: 'typo-extra-h1',                 size: 56, lh: 64, weight: 800 },
    { name: 'typo-extra-h2',                 size: 40, lh: 56, weight: 800 },
    { name: 'typo-extra-h3',                 size: 32, lh: 40, weight: 800 },
    { name: 'typo-h1-bold',                  size: 28, lh: 32, weight: 700 },
    { name: 'typo-h2-bold',                  size: 24, lh: 28, weight: 700 },
    { name: 'typo-h3-bold',                  size: 20, lh: 24, weight: 700 },
    { name: 'typo-h4-bold',                  size: 17, lh: 24, weight: 700 },
    { name: 'typo-h4-bold-short',            size: 17, lh: 20, weight: 700 },
    { name: 'typo-body-bold',                size: 17, lh: 24, weight: 700 },
    { name: 'typo-body-regular',             size: 17, lh: 24, weight: 400 },
    { name: 'typo-body-short-bold',          size: 17, lh: 20, weight: 700 },
    { name: 'typo-body-short-regular',       size: 17, lh: 20, weight: 400 },
    { name: 'typo-body-small-bold',          size: 15, lh: 18, weight: 700 },
    { name: 'typo-body-small-regular',       size: 15, lh: 18, weight: 400 },
    { name: 'typo-caption-bold',             size: 13, lh: 14, weight: 700 },
    { name: 'typo-caption-regular',          size: 13, lh: 14, weight: 400 },
    { name: 'typo-caption-small-bold',       size: 11, lh: 14, weight: 700 },
    { name: 'typo-caption-small-regular',    size: 11, lh: 14, weight: 400 }
  ],
  components: [
    'ButtonLarge', 'ButtonMedium', 'ButtonSmall',
    'Checkbox', 'Chip', 'InputField', 'ProgressBar',
    'Button/Brand', 'Button/Primary', 'Button/Secondary', 'Button/Tertiary', 'Button/White',
    'Button', 'Input', 'Progress'
  ]
};

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
  const target = hexToRgb(hex);
  let nearest = null;
  let minDist = Infinity;
  for (const c of DS.primitiveColors) {
    const ref = hexToRgb(c.hex);
    const dist =
      Math.pow(target.r - ref.r, 2) +
      Math.pow(target.g - ref.g, 2) +
      Math.pow(target.b - ref.b, 2);
    if (dist < minDist) {
      minDist = dist;
      nearest = c;
    }
  }
  return Object.assign({}, nearest, { distance: Math.sqrt(minDist) });
}

function findNearestSpacing(value) {
  let nearest = DS.spacingScale[0];
  let minDist = Math.abs(value - nearest);
  for (const s of DS.spacingScale) {
    const d = Math.abs(value - s);
    if (d < minDist) {
      minDist = d;
      nearest = s;
    }
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
    if (dist < minDist) {
      minDist = dist;
      nearest = t;
    }
  }
  return nearest;
}

function isColorInDS(hex) {
  return DS.primitiveColors.some(function (c) {
    return c.hex.toUpperCase() === hex.toUpperCase();
  });
}

function isSpacingValid(value) {
  return DS.spacingScale.indexOf(Math.round(value)) !== -1;
}

function isTypoValid(size, lineHeight, weight) {
  return DS.typography.some(function (t) {
    return (
      Math.abs(t.size - size) < 0.5 &&
      Math.abs(t.lh - lineHeight) < 0.5 &&
      t.weight === weight
    );
  });
}

// Источник DS — для UI индикатора. Меняется в loadDSFromVercel/tryLoadDSFromFile.
let DS_SOURCE = { kind: 'hardcoded', fileName: null, lastModified: null, colors: DS.primitiveColors.length, spacings: DS.spacingScale.length, typography: DS.typography.length, components: DS.components.length, tokensFromVariables: false };

// Ключи компонентов UI Kit'а (заполняются после loadDSFromVercel).
// Используются для O(1)-проверки "этот instance — из библиотеки Uchi?".
let DS_COMPONENT_KEYS = new Set();

// =============================================================================
// ЗАГРУЗКА DS ИЗ FIGMA UI KIT ЧЕРЕЗ VERCEL (основной путь)
// =============================================================================

function normalizeLineHeight(lh, fontSize) {
  if (typeof lh === 'number') return lh;                          // уже px
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

    const loadedColors = [];
    for (const c of (data.tokens.colors || [])) {
      if (!c || !c.value || typeof c.value !== 'string' || c.value.charAt(0) !== '#') continue;
      const hex6 = c.value.length > 7 ? c.value.substring(0, 7) : c.value;
      loadedColors.push({ name: c.name, hex: hex6.toUpperCase() });
    }

    const loadedSpacings = [];
    for (const s of (data.tokens.spacing || [])) {
      if (typeof s.value === 'number' && loadedSpacings.indexOf(s.value) === -1) loadedSpacings.push(s.value);
    }
    for (const r of (data.tokens.radii || [])) {
      if (typeof r.value === 'number' && loadedSpacings.indexOf(r.value) === -1) loadedSpacings.push(r.value);
    }

    const loadedTypo = [];
    for (const t of (data.tokens.typography || [])) {
      if (!t || !t.fontSize) continue;
      const lh = normalizeLineHeight(t.lineHeight, t.fontSize);
      loadedTypo.push({
        name: t.name,
        size: t.fontSize,
        lh: lh || t.fontSize,
        weight: t.fontWeight || 400
      });
    }

    const loadedComponents = [];
    DS_COMPONENT_KEYS = new Set();
    for (const c of (data.components || [])) {
      if (c.name) loadedComponents.push(c.name);
      if (c.key) DS_COMPONENT_KEYS.add(c.key);
    }
    for (const cs of (data.componentSets || [])) {
      if (cs.name && loadedComponents.indexOf(cs.name) === -1) loadedComponents.push(cs.name);
      if (cs.key) DS_COMPONENT_KEYS.add(cs.key);
    }

    if (loadedColors.length > 0) DS.primitiveColors = loadedColors;
    if (loadedSpacings.length > 0) {
      loadedSpacings.sort(function (a, b) { return a - b; });
      DS.spacingScale = loadedSpacings;
    }
    if (loadedTypo.length > 0) DS.typography = loadedTypo;
    if (loadedComponents.length > 0) DS.components = loadedComponents;

    DS_SOURCE = {
      kind: 'figma',
      fileName: (data.source && data.source.fileName) || 'UI Kit Uchi.ru',
      lastModified: data.source && data.source.lastModified,
      tokensFromVariables: !!(data.source && data.source.tokensFromVariables),
      colors: loadedColors.length,
      spacings: loadedSpacings.length,
      typography: loadedTypo.length,
      components: loadedComponents.length,
      figmaUrl: data.source && data.source.figmaUrl
    };

    return { loaded: true, source: DS_SOURCE };
  } catch (e) {
    console.error('loadDSFromVercel error:', e);
    return { loaded: false, reason: e.message };
  }
}

// =============================================================================
// ПОПЫТКА ПОДГРУЗИТЬ DS ИЗ ЛОКАЛЬНЫХ VARIABLES (если в файле подключена library)
// =============================================================================

async function tryLoadDSFromFile() {
  try {
    if (!figma.variables || !figma.variables.getLocalVariableCollectionsAsync) {
      return { loaded: false, reason: 'Variables API недоступен' };
    }

    const collections = await figma.variables.getLocalVariableCollectionsAsync();
    if (!collections || collections.length === 0) {
      return { loaded: false, reason: 'В файле нет переменных. Подключи library Uchi UI Kit.' };
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
          loadedColors.push({
            name: v.name,
            hex: rgbToHex(value.r, value.g, value.b)
          });
        } else if (v.resolvedType === 'FLOAT' && typeof value === 'number') {
          // Если имя варинга похоже на spacing — добавляем в scale
          const lname = v.name.toLowerCase();
          if (lname.indexOf('space') !== -1 || lname.indexOf('gap') !== -1 || lname.indexOf('padding') !== -1) {
            loadedNumbers.push(value);
          }
        }
      }
    }

    // Мерджим с уже загруженным (например, из Vercel) — не перезаписываем.
    if (loadedColors.length > 0) {
      const existingHex = new Set(DS.primitiveColors.map(function (c) { return c.hex.toUpperCase(); }));
      for (const c of loadedColors) {
        if (!existingHex.has(c.hex.toUpperCase())) DS.primitiveColors.push(c);
      }
    }
    if (loadedNumbers.length > 0) {
      const merged = DS.spacingScale.concat(loadedNumbers);
      const unique = [];
      for (const v of merged) {
        if (unique.indexOf(v) === -1) unique.push(v);
      }
      unique.sort(function (a, b) { return a - b; });
      DS.spacingScale = unique;
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
// ОБХОД ДЕРЕВА И СБОР ПРОБЛЕМ
// =============================================================================

function walkNodes(node, callback, depth) {
  if (depth === undefined) depth = 0;
  if (depth > 50) return;
  callback(node);
  if ('children' in node) {
    for (const child of node.children) {
      walkNodes(child, callback, depth + 1);
    }
  }
}

function analyzeFrame(rootNode) {
  const issues = {
    colors: [],
    spacing: [],
    typography: [],
    components: [],
    outdated: []
  };

  const layoutSummary = {
    name: rootNode.name,
    width: 'width' in rootNode ? rootNode.width : null,
    height: 'height' in rootNode ? rootNode.height : null,
    children: []
  };

  // Список INSTANCE нод для последующей async-проверки outdated
  const instanceNodes = [];

  walkNodes(rootNode, function (node) {
    // === ЦВЕТА ===
    if ('fills' in node && Array.isArray(node.fills)) {
      for (const fill of node.fills) {
        if (fill.type === 'SOLID' && fill.visible !== false) {
          const hex = rgbToHex(fill.color.r, fill.color.g, fill.color.b);
          if (!isColorInDS(hex)) {
            const nearest = findNearestColor(hex);
            issues.colors.push({
              id: node.id + '-fill',
              nodeId: node.id,
              nodeName: node.name,
              property: 'fill',
              current: hex,
              suggested: nearest.hex,
              suggestedToken: nearest.name
            });
          }
        }
      }
    }

    if ('strokes' in node && Array.isArray(node.strokes)) {
      for (const stroke of node.strokes) {
        if (stroke.type === 'SOLID' && stroke.visible !== false) {
          const hex = rgbToHex(stroke.color.r, stroke.color.g, stroke.color.b);
          if (!isColorInDS(hex)) {
            const nearest = findNearestColor(hex);
            issues.colors.push({
              id: node.id + '-stroke',
              nodeId: node.id,
              nodeName: node.name,
              property: 'stroke',
              current: hex,
              suggested: nearest.hex,
              suggestedToken: nearest.name
            });
          }
        }
      }
    }

    // === ОТСТУПЫ ===
    if (node.type === 'FRAME' || node.type === 'COMPONENT' || node.type === 'INSTANCE') {
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
              suggested: nearest
            });
          }
        }
      }
    }

    // === ТИПОГРАФИКА ===
    if (node.type === 'TEXT') {
      const fontSize = typeof node.fontSize === 'number' ? node.fontSize : null;
      const lineHeight =
        node.lineHeight && typeof node.lineHeight === 'object' && node.lineHeight.unit === 'PIXELS'
          ? node.lineHeight.value
          : null;
      const fontName = node.fontName && typeof node.fontName === 'object' ? node.fontName : null;
      const styleName = fontName ? fontName.style : '';
      const weight = /black|extra\s*bold|heavy/i.test(styleName)
        ? 800
        : /semibold|demi|600/i.test(styleName)
        ? 600
        : /bold|700/i.test(styleName)
        ? 700
        : /medium|500/i.test(styleName)
        ? 500
        : 400;

      if (fontSize && lineHeight) {
        if (!isTypoValid(fontSize, lineHeight, weight)) {
          const nearest = findNearestTypo(fontSize, lineHeight, weight);
          issues.typography.push({
            id: node.id + '-typo',
            nodeId: node.id,
            nodeName: node.name,
            current: fontSize + '/' + lineHeight + ' ' + weight,
            suggested: nearest.size + '/' + nearest.lh + ' ' + nearest.weight,
            suggestedToken: nearest.name,
            targetSize: nearest.size,
            targetLineHeight: nearest.lh,
            targetWeight: nearest.weight
          });
        }
      }
    }

    // === КОМПОНЕНТЫ — собираем инстансы для последующей async проверки ===
    if (node.type === 'INSTANCE') {
      instanceNodes.push(node);
    }

    if (node.type === 'FRAME' || node.type === 'GROUP') {
      const nodeName = node.name || '';
      const looksLikeComponent = DS.components.some(function (c) {
        return nodeName.toLowerCase().indexOf(c.toLowerCase()) !== -1;
      });
      if (looksLikeComponent) {
        issues.components.push({
          id: node.id + '-frame-as-component',
          nodeId: node.id,
          nodeName: node.name,
          type: 'frame_as_component',
          message: '"' + nodeName + '" выглядит как компонент, но это обычный фрейм'
        });
      }
    }

    if (
      (node.type === 'FRAME' || node.type === 'TEXT' || node.type === 'INSTANCE' || node.type === 'COMPONENT') &&
      node !== rootNode
    ) {
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
// OUTDATED COMPONENTS DETECTION
// =============================================================================

async function detectOutdatedAndDetached(instanceNodes) {
  const outdated = [];
  const components = [];

  for (const instance of instanceNodes) {
    try {
      const main = await instance.getMainComponentAsync();

      if (!main) {
        // detached / удалённый мастер
        outdated.push({
          id: instance.id + '-detached',
          nodeId: instance.id,
          nodeName: instance.name,
          type: 'detached',
          message: 'Мастер-компонент удалён или недоступен',
          updatable: false
        });
        continue;
      }

      // Если remote (из library) — пробуем получить актуальную версию по key
      if (main.remote === true && main.key) {
        // Если у нас есть свежий список ключей из UI Kit Uchi — сразу скажем,
        // принадлежит ли компонент к нашей библиотеке.
        const fromUchiKit = DS_COMPONENT_KEYS.size > 0 ? DS_COMPONENT_KEYS.has(main.key) : null;

        try {
          const latest = await figma.importComponentByKeyAsync(main.key);
          if (latest && latest.id !== main.id) {
            outdated.push({
              id: instance.id + '-outdated',
              nodeId: instance.id,
              nodeName: instance.name,
              type: 'outdated',
              message: 'Доступно обновление компонента "' + main.name + '"',
              componentKey: main.key,
              updatable: true,
              fromUchiKit: fromUchiKit
            });
            continue;
          }
        } catch (e) {
          outdated.push({
            id: instance.id + '-unknown',
            nodeId: instance.id,
            nodeName: instance.name,
            type: 'unknown_library',
            message: '"' + main.name + '" не найден в актуальной library',
            updatable: false,
            fromUchiKit: fromUchiKit
          });
          continue;
        }

        // Компонент актуальный, но не из UI Kit Uchi.ru.
        if (fromUchiKit === false) {
          components.push({
            id: instance.id + '-foreign-kit',
            nodeId: instance.id,
            nodeName: instance.name,
            type: 'foreign_library',
            message: '"' + main.name + '" — не из UI Kit Uchi.ru Mobile App'
          });
          continue;
        }
      }

      // Если local или non-remote — проверим что имя в нашем списке
      const componentName = main.name || '';
      const parentName = main.parent && main.parent.name ? main.parent.name : '';
      const fullName = parentName ? parentName + '/' + componentName : componentName;
      const isKnown = DS.components.some(function (c) {
        return fullName.toLowerCase().indexOf(c.toLowerCase()) !== -1 ||
               componentName.toLowerCase().indexOf(c.toLowerCase()) !== -1;
      });
      if (!isKnown && !main.remote) {
        components.push({
          id: instance.id + '-instance',
          nodeId: instance.id,
          nodeName: instance.name,
          type: 'unknown_local',
          message: 'Компонент "' + fullName + '" не из библиотеки Uchi DS'
        });
      }
    } catch (e) {
      console.error('outdated check failed for', instance.id, e);
    }
  }

  return { outdated: outdated, components: components };
}

// =============================================================================
// ФИКСЫ
// =============================================================================

async function fixColor(nodeId, property, suggestedHex) {
  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) return false;
  const newColor = hexToRgb(suggestedHex);
  const key = property === 'fill' ? 'fills' : 'strokes';
  if (!(key in node)) return false;
  const current = node[key];
  if (!Array.isArray(current) || current.length === 0) return false;
  const newArr = current.map(function (f) {
    if (f.type === 'SOLID') {
      return Object.assign({}, f, { color: newColor });
    }
    return f;
  });
  node[key] = newArr;
  return true;
}

async function fixSpacing(nodeId, property, value) {
  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) return false;
  if (!(property in node)) return false;
  try {
    node[property] = value;
    return true;
  } catch (e) {
    return false;
  }
}

async function fixTypography(nodeId, targetSize, targetLineHeight, targetWeight) {
  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node || node.type !== 'TEXT') return false;
  try {
    const currentFont = node.fontName;
    if (typeof currentFont === 'object') {
      const newStyle = targetWeight >= 700 ? 'Bold' : 'Regular';
      const newFont = { family: currentFont.family, style: newStyle };
      try {
        await figma.loadFontAsync(newFont);
        node.fontName = newFont;
      } catch (e) {
        // ignore
      }
    }
    node.fontSize = targetSize;
    node.lineHeight = { value: targetLineHeight, unit: 'PIXELS' };
    return true;
  } catch (e) {
    return false;
  }
}

async function updateOutdatedInstance(nodeId, componentKey) {
  try {
    const node = await figma.getNodeByIdAsync(nodeId);
    if (!node || node.type !== 'INSTANCE') return false;
    const latest = await figma.importComponentByKeyAsync(componentKey);
    if (!latest) return false;
    if (typeof node.swapComponent === 'function') {
      node.swapComponent(latest);
    } else {
      node.mainComponent = latest;
    }
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
// СКРИНШОТ
// =============================================================================

async function makeScreenshot(node) {
  try {
    const bytes = await node.exportAsync({
      format: 'PNG',
      constraint: { type: 'SCALE', value: 1 }
    });
    return figma.base64Encode(bytes);
  } catch (e) {
    console.error('Screenshot failed:', e);
    return null;
  }
}

// =============================================================================
// SELECTION TRACKING
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

figma.showUI(__html__, {
  width: 380,
  height: 680,
  themeColors: true
});

// На старте грузим DS из первоисточника (Figma UI Kit через Vercel),
// потом, как бонус, мерджим local variables текущего файла, если они есть.
async function bootstrapDS() {
  const vercelResult = await loadDSFromVercel();

  // Local variables как дополнение (не перезаписывает то, что пришло из Vercel)
  let localResult = null;
  try { localResult = await tryLoadDSFromFile(); } catch (e) { /* ignore */ }

  figma.ui.postMessage({
    type: 'ds-status',
    loaded: vercelResult.loaded || (localResult && localResult.loaded),
    source: DS_SOURCE,
    localAttached: !!(localResult && localResult.loaded),
    reason: vercelResult.loaded ? null : (vercelResult.reason || (localResult && localResult.reason))
  });
}

bootstrapDS();

// Слушаем смену выделения
figma.on('selectionchange', sendSelectionState);
// И инициальный state
setTimeout(sendSelectionState, 50);

figma.ui.onmessage = async function (msg) {
  if (msg.type === 'analyze') {
    const sel = figma.currentPage.selection;
    const targets = sel.filter(function (n) {
      return n.type === 'FRAME' || n.type === 'COMPONENT' || n.type === 'INSTANCE' || n.type === 'SECTION';
    });

    if (targets.length === 0) {
      figma.ui.postMessage({ type: 'error', message: 'Выдели хотя бы один фрейм' });
      return;
    }

    figma.ui.postMessage({ type: 'analyze-start', frameCount: targets.length });

    // Агрегируем issues со всех выбранных фреймов
    const allIssues = { colors: [], spacing: [], typography: [], components: [], outdated: [] };
    const allInstances = [];
    const layoutSummaries = [];

    for (const target of targets) {
      const result = analyzeFrame(target);
      Array.prototype.push.apply(allIssues.colors, result.issues.colors);
      Array.prototype.push.apply(allIssues.spacing, result.issues.spacing);
      Array.prototype.push.apply(allIssues.typography, result.issues.typography);
      Array.prototype.push.apply(allIssues.components, result.issues.components);
      Array.prototype.push.apply(allInstances, result.instanceNodes);
      layoutSummaries.push(result.layoutSummary);
    }

    // Async проверка outdated/detached
    try {
      const compResult = await detectOutdatedAndDetached(allInstances);
      Array.prototype.push.apply(allIssues.outdated, compResult.outdated);
      Array.prototype.push.apply(allIssues.components, compResult.components);
    } catch (e) {
      console.error('outdated detection failed:', e);
    }

    figma.ui.postMessage({
      type: 'analyze-result',
      issues: allIssues,
      frameNames: targets.map(function (t) { return t.name; })
    });

    // Скриншот первого фрейма для GPT
    const screenshot = await makeScreenshot(targets[0]);

    const dsCompact = {
      colors: DS.primitiveColors.map(function (c) { return c.name + '=' + c.hex; }).join(', '),
      spacing: DS.spacingScale,
      typography: DS.typography.slice(0, 12).map(function (t) {
        return t.name + '=' + t.size + '/' + t.lh + '/' + t.weight;
      }).join('; '),
      components: DS.components.slice(0, 10)
    };

    figma.ui.postMessage({
      type: 'request-ux-review',
      payload: {
        layoutJson: layoutSummaries.length === 1 ? layoutSummaries[0] : layoutSummaries,
        // Просим сервер взять DS из Figma UI Kit (первоисточник),
        // компактную клиентскую DS шлём как резерв на случай, если бэкенду
        // не удастся достучаться до Figma API.
        useFigmaDS: true,
        designSystem: dsCompact,
        screenshotBase64: screenshot
        // perspective добавляется в ui.html перед отправкой
      }
    });
  }

  if (msg.type === 'focus-node') {
    await focusNode(msg.nodeId);
  }

  if (msg.type === 'fix-color') {
    const ok = await fixColor(msg.nodeId, msg.property, msg.suggested);
    figma.ui.postMessage({ type: 'fix-result', id: msg.id, ok: ok });
  }

  if (msg.type === 'fix-spacing') {
    const ok = await fixSpacing(msg.nodeId, msg.property, msg.suggested);
    figma.ui.postMessage({ type: 'fix-result', id: msg.id, ok: ok });
  }

  if (msg.type === 'fix-typography') {
    const ok = await fixTypography(msg.nodeId, msg.targetSize, msg.targetLineHeight, msg.targetWeight);
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
      if (fix.category === 'color') {
        ok = await fixColor(fix.nodeId, fix.property, fix.suggested);
      } else if (fix.category === 'spacing') {
        ok = await fixSpacing(fix.nodeId, fix.property, fix.suggested);
      } else if (fix.category === 'typography') {
        ok = await fixTypography(fix.nodeId, fix.targetSize, fix.targetLineHeight, fix.targetWeight);
      } else if (fix.category === 'outdated') {
        ok = await updateOutdatedInstance(fix.nodeId, fix.componentKey);
      }
      results.push({ id: fix.id, ok: ok });
    }
    figma.ui.postMessage({ type: 'fix-all-result', results: results });
  }

  if (msg.type === 'refresh-ds') {
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
  }

  if (msg.type === 'close') {
    figma.closePlugin();
  }
};
