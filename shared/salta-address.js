/**
 * Normalización de direcciones de Salta Capital — compartido entre passenger-app y dashboard.
 * Misma lógica que profesional-dashboard/app/api/Agente_IA/route.js (normalizeAddressPhrase, catálogo, variantes).
 */

const { SALTA_STREETS_FALLBACK } = require('./salta-streets-fallback');
const { resolveSaltaKnownPoi, getKnownPoiSearchQueries, looksLikeSaltaKnownPoi } = require('./salta-known-pois');

function sanitizeAddressInput(address) {
  if (!address || typeof address !== 'string') return '';
  return address.replace(/[<>{}[\]\\]/g, '').replace(/\s+/g, ' ').trim().slice(0, 200);
}

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function normalizeForMatch(value) {
  return normalizeText(value)
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenizeAddress(value) {
  return normalizeForMatch(value)
    .split(' ')
    .filter((token) => token.length > 1 && !['de', 'del', 'la', 'el', 'en', 'y', 'al', 'a'].includes(token));
}

function extractNumbers(value) {
  const matches = String(value || '').match(/\b\d{1,5}\b/g);
  return new Set((matches || []).map((n) => Number(n)));
}

function normalizeAddressKey(value) {
  return normalizeForMatch(value)
    .replace(/\b(avda|av\.|avenida)\b/g, 'avenida')
    .replace(/\bgral\b/g, 'general')
    .replace(/\bc\/?\b/g, 'calle')
    .replace(/\s+/g, ' ')
    .trim();
}

const GENERIC_ADDRESS_TOKENS = new Set([
  'calle',
  'avenida',
  'av',
  'avda',
  'pasaje',
  'pje',
  'ruta',
  'esquina',
  'altura',
  'salta',
  'capital',
  'argentina',
]);

const STREET_TYPE_LABELS = {
  calle: 'Calle',
  avenida: 'Avenida',
  pasaje: 'Pasaje',
  diagonal: 'Diagonal',
  ruta: 'Ruta',
  camino: 'Camino',
  paseo: 'Paseo',
};

function stripEmbeddedPhoneNumbers(text) {
  return String(text || '')
    .replace(/\b(?:cel(?:ular)?|tel(?:efono)?|mob(?:il)?|whatsapp|wpp)\s*:?\s*[\d\s\-+().]{7,}/gi, '')
    .replace(/\b(\d{1,5})-\d{5,}\b/g, '$1')
    .replace(/\b\d{8,}\b/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

const SPANISH_HUNDREDS = {
  'doscient[ao]s': 200, 'trescient[ao]s': 300, 'cuatrocient[ao]s': 400,
  'quinient[ao]s': 500, 'seiscient[ao]s': 600, 'setecient[ao]s': 700,
  'ochocient[ao]s': 800, 'novecient[ao]s': 900, 'ciento?': 100,
};
const SPANISH_TENS = {
  veinte: 20, treinta: 30, cuarenta: 40, cincuenta: 50,
  sesenta: 60, setenta: 70, ochenta: 80, noventa: 90,
};

function convertSpanishNumbersInText(text) {
  let result = String(text || '');
  const tensAlternation = Object.keys(SPANISH_TENS).join('|');
  for (const [hPat, hVal] of Object.entries(SPANISH_HUNDREDS)) {
    const combinedPattern = new RegExp(
      `\\b${hPat}(?:\\s+(?:y\\s+)?(${tensAlternation}))?\\b`, 'gi'
    );
    result = result.replace(combinedPattern, (m, tens) => {
      const tVal = tens ? (SPANISH_TENS[tens.toLowerCase()] ?? 0) : 0;
      const total = hVal + tVal;
      return total > 0 ? String(total) : m;
    });
  }
  return result;
}

const SALTA_PHONETIC_CORRECTIONS = [
  [/\birig[uo]g[io]en\b/gi, 'Yrigoyen'],
  [/\birig[ou]ien\b/gi, 'Yrigoyen'],
  [/\byrigoy[ie]n\b/gi, 'Yrigoyen'],
  [/\burquis[ao]\b/gi, 'Urquiza'],
  [/\burguis[ao]\b/gi, 'Urquiza'],
  [/\burkisa\b/gi, 'Urquiza'],
  [/\b(?:geme[sz]?|gueme[sz]?|g[üu]eme[sz]?)\b/gi, 'Güemes'],
  [/\bespana\b/gi, 'España'],
  [/\bvalgrano\b/gi, 'Belgrano'],
  [/\bbalgrano\b/gi, 'Belgrano'],
  [/\bvelgrano\b/gi, 'Belgrano'],
  [/\bmitra\b/gi, 'Mitre'],
  [/\bmitr[ée]\b/gi, 'Mitre'],
  [/\balverdi\b/gi, 'Alberdi'],
  [/\balverdy\b/gi, 'Alberdi'],
  [/\balverd[ií]\b/gi, 'Alberdi'],
  [/\brivadabia\b/gi, 'Rivadavia'],
  [/\bribadavia\b/gi, 'Rivadavia'],
  [/\brivadab[ií]a\b/gi, 'Rivadavia'],
  [/\bpelegrini\b/gi, 'Pellegrini'],
  [/\bpelegr[ií]ni\b/gi, 'Pellegrini'],
  [/\bpeyegrini\b/gi, 'Pellegrini'],
  [/\bcaseiro[s]?\b/gi, 'Caseros'],
  [/\bkaseros\b/gi, 'Caseros'],
  [/\bcasero(?!s)\b/gi, 'Caseros'],
  [/\bnecochia\b/gi, 'Necochea'],
  [/\bnecochea\b/gi, 'Necochea'],
  [/\bsanmartin\b/gi, 'San Martín'],
  [/\bsan\s+mart[ií]n\b/gi, 'San Martín'],
  [/\bpuerred[oó]n\b/gi, 'Pueyrredón'],
  [/\bpueyred[oó]n\b/gi, 'Pueyrredón'],
  [/\bpueired[oó]n\b/gi, 'Pueyrredón'],
  [/\bsarmient[ou]\b/gi, 'Sarmiento'],
  [/\bsarmento\b/gi, 'Sarmiento'],
  [/\bjujuy\b/gi, 'Jujuy'],
  [/\bjujui\b/gi, 'Jujuy'],
  [/\bcastan[ae]r[ao]s\b/gi, 'Castañares'],
  [/\bcastaniares\b/gi, 'Castañares'],
  [/\bleguisam[oó]n\b/gi, 'Leguizamón'],
  [/\bleguisamon\b/gi, 'Leguizamón'],
  [/\bleguizamon\b/gi, 'Leguizamón'],
  [/\bzub[i]r[ia][ao]?\b/gi, 'Zuviría'],
  [/\bzuviria\b/gi, 'Zuviría'],
  [/\bbuenos\s+aire(?!s)\b/gi, 'Buenos Aires'],
  [/\bsantiag[ou]\s+del?\s+ester[ou]\b/gi, 'Santiago del Estero'],
  [/\bdean\s+funez\b/gi, 'Dean Funes'],
  [/\bde[aá]n\s+funes\b/gi, 'Dean Funes'],
  [/\bguardias\s+nacionales\b/gi, 'Guardias Nacionales'],
  [/\bbalcarce\b/gi, 'Balcarce'],
  [/\bbalcarse\b/gi, 'Balcarce'],
  [/\bvalcarce\b/gi, 'Balcarce'],
  [/\barenale[sz]?\b/gi, 'Arenales'],
  [/\barenale\b/gi, 'Arenales'],
  [/\blavaye\b/gi, 'Lavalle'],
  [/\blaval[l]?e\b/gi, 'Lavalle'],
  [/\bituzaing[oó]\b/gi, 'Ituzaingó'],
  [/\bitusaingo\b/gi, 'Ituzaingó'],
  [/\bmendos[ao]\b/gi, 'Mendoza'],
  [/\bmendosa\b/gi, 'Mendoza'],
  [/\bcordoba\b/gi, 'Córdoba'],
  [/\bcordova\b/gi, 'Córdoba'],
  [/\btucuman\b/gi, 'Tucumán'],
  [/\btukuman\b/gi, 'Tucumán'],
  [/\bcatamarca\b/gi, 'Catamarca'],
  [/\bkatamarca\b/gi, 'Catamarca'],
  [/\bentre\s+r[ií]os\b/gi, 'Entre Ríos'],
  [/\bsanta\s+f[eé]\b/gi, 'Santa Fe'],
  [/\bcorriente[sz]?\b/gi, 'Corrientes'],
  [/\bkorientes\b/gi, 'Corrientes'],
  [/\bpasan?\b/gi, 'Paseo'],
  [/\b(?:bern?ardo\s+)?[iy]rigoyen\b/gi, 'Yrigoyen'],
  [/\bavellaneda\b/gi, 'Avellaneda'],
  [/\baveyaneda\b/gi, 'Avellaneda'],
  [/\bmoreno\b/gi, 'Moreno'],
  [/\b[sz]u[aá]re[sz]\b/gi, 'Suárez'],
  [/\bsuares\b/gi, 'Suárez'],
  [/\bb[ao]livian?a?\b/gi, 'Bolivia'],
  [/\bboli[bv]ia\b/gi, 'Bolivia'],
  [/\bvirrey\s+toled[ou]\b/gi, 'Virrey Toledo'],
  [/\b[bv]irrey\s+toled[ou]\b/gi, 'Virrey Toledo'],
  [/\b20\s*de\s*feb?rero\b/gi, '20 de Febrero'],
  [/\bveinte\s+de\s+feb?rero\b/gi, '20 de Febrero'],
  [/\bjuan\s+gal[bv]e[sz]\b/gi, 'Juan Gálvez'],
  [/\bgalvez\b/gi, 'Gálvez'],
  [/\bosv?aldo\s+del+aqua\b/gi, 'Osvaldo Dellaqua'],
  [/\basunci[oó]n\b/gi, 'Asunción'],
  [/\basuncion\b/gi, 'Asunción'],
  [/\bdelgadiy?o\b/gi, 'Delgadillo'],
  [/\bdelgadillo\b/gi, 'Delgadillo'],
  [/\breyes\s+catol[ií]cos\b/gi, 'Reyes Católicos'],
  [/\bparag[uw]ay\b/gi, 'Paraguay'],
  [/\bparaguai\b/gi, 'Paraguay'],
  [/\buruguay\b/gi, 'Uruguay'],
  [/\buruguai\b/gi, 'Uruguay'],
  [/\bchile\b/gi, 'Chile'],
  [/\btres\s+cerrit[ou]s\b/gi, 'Tres Cerritos'],
  [/\bgrand?\s+bou?rg\b/gi, 'Grand Bourg'],
  [/\bgran\s+bou?rg\b/gi, 'Grand Bourg'],
  [/\bcastan[ae]res\b/gi, 'Castañares'],
  [/\blimache\b/gi, 'Limache'],
  [/\bsan\s+[bv]ernardo\b/gi, 'San Bernardo'],
  [/\bportal\s+de\s+les+er\b/gi, 'Portal de Lesser'],
  [/\bsirolli\b/gi, 'Sirolli'],
  [/\briganti\b/gi, 'Riganti'],
  [/\blo[bv]ald[ou]\b/gi, 'Lobaldo'],
  [/\bblanco\b/gi, 'Blanco'],
  [/\bmansi[iy]a\b/gi, 'Mansilla'],
  [/\beusebio\s+mansi[ly]a\b/gi, 'Eusebio Mansilla'],
  [/\bavda\.?\b/gi, 'Avenida'],
  [/\bbvar\.?\b/gi, 'Boulevard'],
  [/\bpje\.?\b/gi, 'Pasaje'],
];

const SALTA_STREET_EXPANSIONS = [
  [/\bmitre\b/gi, 'Bartolomé Mitre'],
  [/\balberdi\b/gi, 'Juan Bautista Alberdi'],
  [/\brivadavia\b/gi, 'Bernardino Rivadavia'],
  [/\bpellegrini\b/gi, 'Carlos Pellegrini'],
  [/\bpueyrred[oó]n\b/gi, 'Mariano Pueyrredón'],
  [/\bsarmiento\b/gi, 'Domingo F. Sarmiento'],
  [/\byrigoyen\b/gi, 'Hipólito Yrigoyen'],
];

function applyPhoneticCorrections(text) {
  let result = String(text || '');
  for (const [pattern, replacement] of SALTA_PHONETIC_CORRECTIONS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

function applyStreetNameExpansions(text) {
  let result = String(text || '');
  const fold = (value) => String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  for (const [pattern, replacement] of SALTA_STREET_EXPANSIONS) {
    // Evitar duplicar nombres ya completos (ej. "Bartolomé Mitre" → "Bartolomé Bartolomé Mitre").
    if (fold(result).includes(fold(replacement))) continue;
    result = result.replace(pattern, replacement);
  }
  return result;
}

function normalizeStreetType(value) {
  const type = normalizeForMatch(value || '').replace(/\./g, '');
  if (type === 'av' || type === 'avda') return 'avenida';
  if (type === 'pje') return 'pasaje';
  return type;
}

function parseSaltaStreetCatalogEntry(label) {
  const cleanLabel = sanitizeAddressInput(label);
  if (!cleanLabel) return null;

  const match = cleanLabel.match(/^(calle|avenida|avda|av\.?|pasaje|pje\.?|diagonal|ruta|camino|paseo)\s+(.+)$/i);
  if (!match) return null;

  const type = normalizeStreetType(match[1]);
  const name = sanitizeAddressInput(match[2]);
  if (!name) return null;

  const nameKey = normalizeAddressKey(name);
  if (!nameKey) return null;
  if (nameKey === 's c' || nameKey === 'sc') return null;
  if (/^[a-z]$/.test(nameKey)) return null;

  const tokens = tokenizeAddress(nameKey)
    .filter((token) => token && token.length >= 2 && !GENERIC_ADDRESS_TOKENS.has(token));
  if (tokens.length === 0) return null;

  const normalizedType = STREET_TYPE_LABELS[type] ? type : 'calle';
  const fullLabel = `${STREET_TYPE_LABELS[normalizedType]} ${name}`;

  return {
    type: normalizedType,
    name,
    nameKey,
    tokens,
    fullLabel,
  };
}

function buildSaltaStreetTokenIndex(streets) {
  const tokenIndex = new Map();
  for (const street of streets || []) {
    const seenTokens = new Set();
    for (const token of street.tokens || []) {
      if (!token || token.length < 3 || seenTokens.has(token)) continue;
      seenTokens.add(token);
      if (!tokenIndex.has(token)) tokenIndex.set(token, []);
      tokenIndex.get(token).push(street);
    }
  }
  return tokenIndex;
}

function getFallbackSaltaStreetEntries() {
  const parsed = SALTA_STREETS_FALLBACK
    .map((item) => parseSaltaStreetCatalogEntry(item))
    .filter(Boolean);
  const seen = new Set();
  return parsed.filter((item) => {
    const key = `${item.type}|${item.nameKey}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

let saltaStreetCatalogCache = null;

function ensureStreetCatalog() {
  if (saltaStreetCatalogCache) return saltaStreetCatalogCache;
  const streets = getFallbackSaltaStreetEntries();
  saltaStreetCatalogCache = {
    streets,
    tokenIndex: buildSaltaStreetTokenIndex(streets),
  };
  return saltaStreetCatalogCache;
}

function getCatalogAddressVariants(address, maxResults = 4) {
  const input = sanitizeAddressInput(address || '');
  if (!input) return [];

  const catalog = ensureStreetCatalog();
  if (!catalog.streets.length) return [];

  const normalizedInput = normalizeForMatch(input)
    .replace(/\b(?:salta|capital|argentina)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalizedInput) return [];

  const houseNumber = (normalizedInput.match(/\b\d{1,5}[a-z]?\b/i) || [null])[0];
  const streetSegment = normalizedInput
    .replace(/\bal\s+\d{1,5}[a-z]?\b/gi, ' ')
    .replace(/\b(?:altura|nro|numero|n)\s*\d{1,5}[a-z]?\b/gi, ' ')
    .replace(/\b\d{1,5}[a-z]?\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const queryTokens = tokenizeAddress(streetSegment)
    .filter((token) => token && token.length >= 3 && !GENERIC_ADDRESS_TOKENS.has(token));
  if (queryTokens.length === 0) return [];

  const candidateMap = new Map();
  for (const token of queryTokens) {
    const tokenMatches = catalog.tokenIndex.get(token) || [];
    for (const street of tokenMatches) {
      const key = `${street.type}|${street.nameKey}`;
      if (!candidateMap.has(key)) {
        candidateMap.set(key, { street, overlap: 0 });
      }
      candidateMap.get(key).overlap += 1;
    }
  }

  const ranked = [...candidateMap.values()]
    .map(({ street, overlap }) => {
      const overlapScore = overlap / queryTokens.length;
      const fullTokenMatch = overlap >= queryTokens.length;
      let score = overlapScore;
      if (/\b(?:pasaje|pje)\b/i.test(normalizedInput) && street.type === 'pasaje') score += 0.2;
      if (/\b(?:avenida|avda|av)\b/i.test(normalizedInput) && street.type === 'avenida') score += 0.2;
      if (houseNumber) score += 0.05;
      if (street.type === 'avenida' && fullTokenMatch) score += 0.10;
      const nameTokenCount = (street.nameKey || '').split(/\s+/).length;
      if (nameTokenCount <= 3) score += 0.05;
      return { street, score, overlap };
    })
    .filter((item) => {
      if (queryTokens.length >= 2 && item.overlap < queryTokens.length) return false;
      return item.score >= 0.6;
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults);

  const variants = [];
  const seenVariants = new Set();
  for (const item of ranked) {
    const withType = houseNumber
      ? `${item.street.fullLabel} ${houseNumber}, Salta`
      : `${item.street.fullLabel}, Salta`;
    const withoutType = houseNumber
      ? `${item.street.name} ${houseNumber}, Salta`
      : `${item.street.name}, Salta`;

    for (const candidate of [withType, withoutType]) {
      const key = normalizeAddressKey(candidate);
      if (!key || seenVariants.has(key)) continue;
      seenVariants.add(key);
      variants.push(candidate);
    }
  }

  return variants;
}

function normalizeAddressPhrase(value) {
  const input = sanitizeAddressInput(value || '');
  if (!input) return '';

  if (/^(?:ac[aá](?:\s*nom[aá]s)?|aqu[ií]|donde\s+estoy|en\s+mi\s+cas[ao]|ac[aá]\s+estoy)$/i.test(input.trim())) return '';

  let work = stripEmbeddedPhoneNumbers(input);
  work = convertSpanishNumbersInText(work);
  work = applyPhoneticCorrections(work);

  const knownPoi = resolveSaltaKnownPoi(work);
  if (knownPoi?.geocodeQuery) {
    return sanitizeAddressInput(knownPoi.geocodeQuery);
  }

  return sanitizeAddressInput(
    work
      .replace(/\bavda\.?\b/gi, 'Avenida')
      .replace(/\bav\.?\b/gi, 'Avenida')
      .replace(/\bgral\.?\b/gi, 'General')
      .replace(/\bcnel\.?\b/gi, 'Coronel')
      .replace(/\btte\.?\b/gi, 'Teniente')
      .replace(/\bbvd\.?\b/gi, 'Boulevard')
      .replace(/\bbv\.?\b/gi, 'Boulevard')
      .replace(/\besq(?:uina)?\.?\s*/gi, 'y ')
      .replace(/\s+c\/\s*/gi, ' y ')
      .replace(/\bcasi\b/gi, 'y')
      .replace(/\bx\s+favor\b/gi, 'por favor')
      .replace(/\s+x\s+/gi, ' y ')
      .replace(/\bal\s+(\d{1,5})\b/gi, '$1')
      .replace(/\b(?:altura|nro\.?|numero|n[uú]mero)\s*(\d{1,5})\b/gi, '$1')
      .replace(/(^|[\s,.-])n\s*[°o]?\s*(\d{1,5})\b/gi, '$1$2')
      .replace(/\b(\d{1,5})\s+(?:dto\.?|depto\.?|departamento|dpto\.?|piso|of\.?|oficina|dep\.?|torre|bloque|block)?\s*[a-z]?\d{1,3}[a-z]?\b/gi, '$1')
      .replace(/^(?:en|por|desde|hasta|hacia|a)\s+/i, '')
      .trim()
  );
}

function buildAddressSearchQueries(address) {
  const raw = sanitizeAddressInput(address);
  if (!raw) return [];

  const normalizedPhrase = normalizeAddressPhrase(raw) || raw;
  const base = sanitizeAddressInput(normalizedPhrase);
  if (!base) return [];

  const variants = [];
  const pushVariant = (item) => {
    const cleaned = sanitizeAddressInput(item);
    if (cleaned) variants.push(cleaned);
  };

  const knownPoi = resolveSaltaKnownPoi(raw) || resolveSaltaKnownPoi(base);
  if (knownPoi) {
    for (const q of getKnownPoiSearchQueries(knownPoi)) {
      pushVariant(q);
    }
  }

  const withSalta = /salta/i.test(base) ? base : `${base}, Salta`;
  const expandedBase = applyStreetNameExpansions(withSalta);
  if (expandedBase !== withSalta) {
    pushVariant(expandedBase);
  }
  pushVariant(withSalta);
  pushVariant(raw);
  if (raw !== base) pushVariant(`${raw}, Salta`);

  const noBarrioPrefix = withSalta.replace(/^barrio\s+/i, '').trim();
  if (noBarrioPrefix !== withSalta) pushVariant(noBarrioPrefix);
  pushVariant(withSalta.replace(/\besquina\s+con\b/gi, 'y'));

  const catalogVariants = getCatalogAddressVariants(withSalta, 6);
  for (const variant of catalogVariants) {
    pushVariant(variant);
  }

  const unique = new Set();
  const result = [];
  for (const variant of variants) {
    const key = normalizeForMatch(variant);
    if (!key || unique.has(key)) continue;
    unique.add(key);
    result.push(variant);
  }

  if (!result.some((item) => normalizeForMatch(item).includes('salta'))) {
    result.push(`${base}, Salta`);
  }

  return result.slice(0, 12);
}

const GREATER_SALTA_LOCALITY_PATTERNS = [
  /\bvilla san lorenzo\b/i,
  /\bcerrillos\b/i,
  /\bvaqueros\b/i,
  /\bchicoana\b/i,
  /\bcafayate\b/i,
  /\bmet[aá]n\b/i,
  /\brosario de lerma\b/i,
  /\b(?:^|,\s*)lerma\b/i,
  /\btartagal\b/i,
  /\boran\b/i,
  /\bembarcacion\b/i,
];

function pickPrimaryHouseNumber(query) {
  const nums = [...extractNumbers(query)].filter((n) => n >= 1 && n <= 9999);
  return nums.length > 0 ? nums[0] : null;
}

function scoreStreetNumberProximity(query, formattedAddress) {
  const primaryQueryNum = pickPrimaryHouseNumber(query);
  if (primaryQueryNum == null) return 0;

  const addressStr = String(formattedAddress || '');
  const addrNums = [...extractNumbers(formattedAddress)];

  const rangeRe = /\b(\d{1,5})\s*[-–]\s*(\d{1,5})\b/g;
  let rangeMatch;
  while ((rangeMatch = rangeRe.exec(addressStr)) !== null) {
    const low = Number(rangeMatch[1]);
    const high = Number(rangeMatch[2]);
    const min = Math.min(low, high);
    const max = Math.max(low, high);
    if (primaryQueryNum >= min && primaryQueryNum <= max) {
      return 0.42;
    }
  }

  if (addrNums.length === 0) return -0.12;

  let best = -0.28;
  for (const n of addrNums) {
    if (n === primaryQueryNum) {
      return 0.48;
    }
    const diff = Math.abs(n - primaryQueryNum);
    if (diff <= 2) best = Math.max(best, 0.38);
    else if (diff <= 25) best = Math.max(best, 0.22);
    else if (diff <= 98) best = Math.max(best, 0.1);
    else if (
      diff >= 400
      || (primaryQueryNum < 1000 && n >= primaryQueryNum * 8)
      || String(n).startsWith(String(primaryQueryNum)) && n !== primaryQueryNum
    ) {
      best = Math.min(best, -0.42);
    }
  }
  return best;
}

function scoreSaltaCapitalLocality(formattedAddress) {
  const addr = String(formattedAddress || '');
  for (const pattern of GREATER_SALTA_LOCALITY_PATTERNS) {
    if (pattern.test(addr)) return -0.38;
  }
  if (/\ba4400\b/i.test(addr)) return 0.24;
  if (/\bsalta\b/i.test(addr)) return 0.2;
  return 0;
}

function scoreCandidateAgainstQuery(formattedAddress, query) {
  const queryTokens = new Set(tokenizeAddress(query));
  const addressTokens = new Set(tokenizeAddress(formattedAddress || ''));
  const normalizedFormatted = normalizeForMatch(formattedAddress || '');
  const normalizedQuery = normalizeForMatch(query || '');

  let tokenOverlap = 0;
  queryTokens.forEach((token) => {
    if (addressTokens.has(token)) tokenOverlap += 1;
  });

  let score = queryTokens.size > 0 ? tokenOverlap / queryTokens.size : 0;

  const queryNumbers = extractNumbers(query);
  const addressNumbers = extractNumbers(formattedAddress);
  if (queryNumbers.size > 0) {
    let matchedNumbers = 0;
    queryNumbers.forEach((num) => {
      if (addressNumbers.has(num)) matchedNumbers += 1;
    });
    score += matchedNumbers > 0 ? 0.2 : -0.2;
    score += scoreStreetNumberProximity(query, formattedAddress);
  }

  const CITY_STOPWORDS = new Set(['salta', 'argentina', 'capital', 'a4400']);
  const contentQueryTokens = [...queryTokens].filter((t) => !CITY_STOPWORDS.has(t) && !/^\d+$/.test(t));
  if (contentQueryTokens.length > 0) {
    const matchedContent = contentQueryTokens.filter((t) => addressTokens.has(t)).length;
    if (matchedContent < contentQueryTokens.length) {
      score -= 0.45 * (contentQueryTokens.length - matchedContent) / contentQueryTokens.length;
    }
    if (normalizedFormatted.includes(normalizedQuery.replace(/\bsalta\b/g, '').trim())) {
      score += 0.15;
    }
  }

  score += scoreSaltaCapitalLocality(formattedAddress);

  return score;
}

function formatAutocompleteInput(query) {
  const safeQuery = sanitizeAddressInput(query);
  if (!safeQuery) return '';
  return /salta/i.test(safeQuery) ? safeQuery : `${safeQuery}, Salta`;
}

function formatAddressSuggestion(fullAddress) {
  const raw = sanitizeAddressInput(fullAddress);
  if (!raw) return { title: '', subtitle: '' };

  const parts = raw.split(',').map((part) => part.trim()).filter(Boolean);
  const title = parts[0] || raw;
  const subtitle = parts.slice(1).join(', ');

  return { title, subtitle };
}

function parseStreetHouseFromQuery(query) {
  const normalized = normalizeAddressPhrase(query) || sanitizeAddressInput(query);
  if (!normalized) return { street: '', houseNumber: null };

  const trailingNumber = normalized.match(/^(.+?)\s+(\d{1,5})$/);
  if (trailingNumber) {
    return { street: trailingNumber[1].trim(), houseNumber: trailingNumber[2] };
  }

  const leadingNumber = normalized.match(/^(\d{1,5})\s+(.+)$/);
  if (leadingNumber) {
    return { street: leadingNumber[2].trim(), houseNumber: leadingNumber[1] };
  }

  return { street: normalized, houseNumber: null };
}

/**
 * Etiqueta corta estilo Google a partir de un resultado Nominatim con addressdetails.
 */
function formatNominatimDisplayLabel(mapped) {
  const addr = mapped?.address || {};
  const road = addr.road || addr.pedestrian || addr.footway || addr.residential || '';
  const house = addr.house_number || '';
  const poiName = addr.amenity || addr.shop || addr.building || addr.tourism || '';

  let title = '';
  if (road && house) {
    title = applyStreetNameExpansions(`${road} ${house}`);
  } else if (road) {
    title = applyStreetNameExpansions(road);
  } else if (poiName) {
    title = poiName;
  } else {
    title = formatAddressSuggestion(mapped?.formattedAddress || '').title;
  }

  const locality = addr.suburb || addr.neighbourhood || addr.quarter || addr.city_district || '';
  const city = addr.city || addr.town || 'Salta';
  const subtitleParts = [];
  if (locality && !locality.toLowerCase().includes('salta')) subtitleParts.push(locality);
  if (city) subtitleParts.push(city);
  const subtitle = subtitleParts.join(', ');
  const full = subtitle ? `${title}, ${subtitle}` : title;

  return { title, subtitle, full };
}

/**
 * Si el usuario escribió altura pero Nominatim solo devolvió la calle, la agregamos al título.
 */
function applyQueryHouseNumberToLabel(label, query) {
  const queryNum = pickPrimaryHouseNumber(query);
  if (queryNum == null || !label) return label;

  const title = String(label.title || '').trim();
  if (!title || /\b\d{1,5}\b/.test(title)) return label;

  const { street } = parseStreetHouseFromQuery(query);
  const streetTokens = tokenizeAddress(street);
  const titleTokens = new Set(tokenizeAddress(title));
  const hasStreetMatch = streetTokens.length === 0
    || streetTokens.some((token) => titleTokens.has(token));

  if (!hasStreetMatch) return label;

  const enrichedTitle = `${title} ${queryNum}`.trim();
  const full = label.subtitle ? `${enrichedTitle}, ${label.subtitle}` : enrichedTitle;
  return {
    title: enrichedTitle,
    subtitle: label.subtitle,
    full,
  };
}

function formatNominatimLabelForQuery(mapped, query) {
  const base = formatNominatimDisplayLabel(mapped);
  return applyQueryHouseNumberToLabel(base, query);
}

const INTERSECTION_POI_BLOCK_RE = /\b(shopping|hospital|terminal|axion|ypf|shell|supermercado|hiper|libertad|anonima|estacion\s+de\s+servicio)\b/i;

/**
 * Detecta direcciones tipo "Calle A y Calle B" (intersección / esquina).
 * @returns {{ street1: string, street2: string } | null}
 */
function parseStreetIntersection(value) {
  const raw = sanitizeAddressInput(value);
  if (!raw) return null;

  const normalized = normalizeAddressPhrase(raw) || raw;
  const cleaned = normalized
    .replace(/,?\s*salta(?:\s+capital)?(?:\s*,?\s*argentina)?\s*$/i, '')
    .trim();

  const match = cleaned.match(/^(.+?)\s+y\s+(.+)$/i);
  if (!match) return null;

  const street1 = sanitizeAddressInput(match[1]);
  const street2 = sanitizeAddressInput(match[2]);
  if (!street1 || !street2 || street1.length < 2 || street2.length < 2) return null;

  const combined = `${street1} ${street2}`;
  if (INTERSECTION_POI_BLOCK_RE.test(combined)) return null;
  if (looksLikeSaltaKnownPoi(cleaned)) return null;
  if (pickPrimaryHouseNumber(street1) != null || pickPrimaryHouseNumber(street2) != null) return null;

  return { street1, street2 };
}

module.exports = {
  sanitizeAddressInput,
  normalizeAddressPhrase,
  buildAddressSearchQueries,
  getCatalogAddressVariants,
  scoreCandidateAgainstQuery,
  formatAutocompleteInput,
  formatAddressSuggestion,
  formatNominatimDisplayLabel,
  formatNominatimLabelForQuery,
  applyQueryHouseNumberToLabel,
  parseStreetHouseFromQuery,
  pickPrimaryHouseNumber,
  parseStreetIntersection,
  ensureStreetCatalog,
};
