import { Audio, InterruptionModeAndroid, InterruptionModeIOS } from 'expo-av';
import { autocompleteAddressSalta, geocodeAddressMultiple } from './googleMaps';
import { BARRIO_NAMES, findBarrio, searchBarrios } from '../data/barrios';

const OPENAI_API_KEY = process.env.EXPO_PUBLIC_OPENAI_API_KEY || '';

const MATCH_STOPWORDS = new Set([
  'a', 'al', 'la', 'el', 'los', 'las', 'de', 'del', 'en', 'y', 'por', 'para', 'con', 'sin', 'que', 'un', 'una', 'me',
]);

const NUMBER_WORDS = {
  cero: 0,
  un: 1,
  uno: 1,
  una: 1,
  dos: 2,
  tres: 3,
  cuatro: 4,
  cinco: 5,
  seis: 6,
  siete: 7,
  ocho: 8,
  nueve: 9,
  diez: 10,
  once: 11,
  doce: 12,
  trece: 13,
  catorce: 14,
  quince: 15,
  dieciseis: 16,
  diecisiete: 17,
  dieciocho: 18,
  diecinueve: 19,
  veinte: 20,
  veintiuno: 21,
  veintidos: 22,
  veintitres: 23,
  veinticuatro: 24,
  veinticinco: 25,
  veintiseis: 26,
  veintisiete: 27,
  veintiocho: 28,
  veintinueve: 29,
  treinta: 30,
  cuarenta: 40,
  cincuenta: 50,
  sesenta: 60,
  setenta: 70,
  ochenta: 80,
  noventa: 90,
  cien: 100,
  ciento: 100,
  doscientos: 200,
  trescientos: 300,
  cuatrocientos: 400,
  quinientos: 500,
  seiscientos: 600,
  setecientos: 700,
  ochocientos: 800,
  novecientos: 900,
  mil: 1000,
};

function normalizeForMatch(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenizeForMatch(value) {
  return normalizeForMatch(value)
    .split(' ')
    .filter((token) => token && !MATCH_STOPWORDS.has(token));
}

function ensureSaltaSuffix(query) {
  const normalized = normalizeForMatch(query);
  if (!normalized) return '';
  return normalized.includes('salta') ? query.trim() : `${query.trim().replace(/,$/, '')}, Salta`;
}

function extractNumbers(value) {
  const matches = String(value || '').match(/\b\d{1,5}\b/g);
  return new Set((matches || []).map((n) => Number(n)));
}

function parseNumberWords(tokens, startIndex) {
  let total = 0;
  let current = 0;
  let consumed = 0;
  let sawNumberWord = false;

  for (let i = startIndex; i < tokens.length && consumed < 6; i += 1) {
    const token = normalizeForMatch(tokens[i]);
    if (!token) break;
    if (token === 'y') {
      consumed += 1;
      continue;
    }

    const value = NUMBER_WORDS[token];
    if (typeof value !== 'number') break;
    sawNumberWord = true;

    if (token === 'mil') {
      current = current || 1;
      total += current * 1000;
      current = 0;
    } else if (value >= 100) {
      current += value;
    } else {
      current += value;
    }
    consumed += 1;
  }

  if (!sawNumberWord || consumed < 2) return null;
  const finalValue = total + current;
  if (!Number.isFinite(finalValue) || finalValue <= 0 || finalValue > 20000) return null;
  return { value: finalValue, consumed };
}

function replaceSpokenNumbers(text) {
  const tokens = String(text || '').split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return String(text || '').trim();

  const output = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const parsed = parseNumberWords(tokens, i);
    if (parsed) {
      output.push(String(parsed.value));
      i += parsed.consumed - 1;
      continue;
    }
    output.push(tokens[i]);
  }

  return output.join(' ').trim();
}

function createQueryVariants({ rawText, extractedQuery, isBarrio }) {
  const variants = [];
  const raw = String(rawText || '').trim();
  const extracted = String(extractedQuery || '').trim();

  if (extracted) {
    variants.push(extracted);
    variants.push(replaceSpokenNumbers(extracted));
  }

  if (raw) {
    variants.push(raw);
    variants.push(replaceSpokenNumbers(raw));
  }

  const normalizedRaw = normalizeForMatch(raw);
  const intersectionMatch = normalizedRaw.match(/([a-z0-9\s]+?)\s+(?:y|esquina\s+con)\s+([a-z0-9\s]+)/i);
  if (intersectionMatch) {
    const streetA = intersectionMatch[1].trim();
    const streetB = intersectionMatch[2].trim();
    if (streetA && streetB) {
      variants.push(`${streetA} y ${streetB}, Salta`);
    }
  }

  const barrioFromExtracted = findBarrio(extracted);
  const barrioFromRaw = findBarrio(raw);
  const barrioHint = barrioFromExtracted || barrioFromRaw;
  if (isBarrio && barrioHint) {
    variants.push(`Barrio ${barrioHint.name}, Salta`);
  }

  const normalizedSeen = new Set();
  const cleaned = [];
  for (const variant of variants) {
    const q = ensureSaltaSuffix(String(variant || '').replace(/\s+/g, ' ').trim());
    if (!q) continue;
    const normalized = normalizeForMatch(q);
    if (!normalized || normalizedSeen.has(normalized)) continue;
    normalizedSeen.add(normalized);
    cleaned.push(q);
  }

  return { variants: cleaned.slice(0, 6), barrioHint };
}

function scoreCandidate(query, address, { barrioHint = null } = {}) {
  const queryTokens = tokenizeForMatch(query);
  const addressTokens = tokenizeForMatch(address);
  const querySet = new Set(queryTokens);
  const addressSet = new Set(addressTokens);

  let overlap = 0;
  querySet.forEach((token) => {
    if (addressSet.has(token)) overlap += 1;
  });

  let score = querySet.size > 0 ? overlap / querySet.size : 0;

  const queryNumbers = extractNumbers(query);
  const addressNumbers = extractNumbers(address);
  if (queryNumbers.size > 0) {
    let matched = 0;
    queryNumbers.forEach((num) => {
      if (addressNumbers.has(num)) matched += 1;
    });
    score += matched > 0 ? 0.35 : -0.2;
  }

  const normalizedAddress = normalizeForMatch(address);
  if (normalizedAddress.includes('salta')) score += 0.1;

  if (barrioHint && normalizedAddress.includes(normalizeForMatch(barrioHint.name))) {
    score += 0.3;
  }

  return score;
}

function requireOpenAIKey() {
  if (!OPENAI_API_KEY) {
    throw new Error('Falta EXPO_PUBLIC_OPENAI_API_KEY en las variables de entorno');
  }
  return OPENAI_API_KEY;
}

// Top barrios subset for GPT prompt (avoid token overflow)
const BARRIOS_FOR_PROMPT = BARRIO_NAMES.slice(0, 200).join(', ');

/**
 * Transcribe audio file using OpenAI Whisper API
 * @param {string} uri - Local file URI from expo-av recording
 * @returns {Promise<string>} transcribed text
 */
export async function transcribeAudio(uri) {
  const formData = new FormData();

  formData.append('file', {
    uri,
    type: 'audio/m4a',
    name: 'audio.m4a',
  });
  formData.append('model', 'whisper-1');
  formData.append('language', 'es');
  formData.append('prompt', 'El chofer dice una dirección de destino en Salta, Argentina. Barrios conocidos: Centro, Tres Cerritos, Grand Bourg, Castañares, Limache, San Martín, Belgrano, El Huaico, La Loma, Portezuelo, Scalabrini Ortiz, Villa Cristina, San Benito, Norte Grande, El Tribuno, Ciudad del Milagro, Intersindical, Santa Ana.');

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${requireOpenAIKey()}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Whisper API error: ${err}`);
  }

  const data = await response.json();
  return data.text?.trim() || '';
}

/**
 * Use GPT to extract/clean the destination address from transcribed text
 * @param {string} rawText - Raw transcription
 * @returns {Promise<string>} cleaned address string for geocoding
 */
export async function extractAddress(rawText) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${requireOpenAIKey()}`,
    },
    body: JSON.stringify({
      model: 'gpt-5.4-mini',
      messages: [
        {
          role: 'system',
          content: `Sos un asistente que extrae direcciones de destino del habla de un chofer de remis en Salta Capital, Argentina.

BARRIOS OFICIALES DE SALTA (usá estos nombres exactos cuando reconozcas un barrio):
${BARRIOS_FOR_PROMPT}

REGLAS:
- Devolvé un JSON con: { "query": "texto para buscar en Google Maps", "isBarrio": true/false }
- "query" debe ser la dirección tal como la buscarías en Google Maps, limpia y concisa.
- Si mencionan una calle con número (ej: "Güemes al 200"), devolvé: { "query": "Güemes 200, Salta", "isBarrio": false }
- Si mencionan una intersección (ej: "Belgrano y Mitre"), devolvé: { "query": "Belgrano y Mitre, Salta", "isBarrio": false }
- Si mencionan un barrio, devolvé: { "query": "Barrio [nombre exacto], Salta", "isBarrio": true }
- Si mencionan un LUGAR + CALLE (ej: "al farmacity de la Belgrano"), armá la query como: "Farmacity Belgrano Salta". Formato: [Establecimiento] [Calle] Salta.
- Si mencionan solo un lugar/establecimiento sin calle (ej: "al shopping"), devolvé: { "query": "Shopping Salta", "isBarrio": false }
- Lugares comunes: shoppings, farmacias, hospitales, plazas, estaciones de servicio, supermercados, restaurantes, bancos, colegios, universidades, iglesias, terminales, etc.
- NO agregues "Argentina" ni modifiques el nombre de la calle. Dejá el nombre tal cual para que Google Maps resuelva las variantes.
- Quitá artículos y preposiciones innecesarias ("de la", "del", "al") del query final.
- Si no podés extraer una dirección clara, devolvé: { "query": "NO_ADDRESS", "isBarrio": false }
- Devolvé SOLO el JSON, sin explicación ni markdown.

EJEMPLOS:
- "Güemes al 200" → { "query": "Güemes 200, Salta", "isBarrio": false }
- "al barrio Tres Cerritos" → { "query": "Tres Cerritos, Salta", "isBarrio": true }
- "Belgrano al mil quinientos" → { "query": "Belgrano 1500, Salta", "isBarrio": false }
- "al shopping" → { "query": "Shopping Salta", "isBarrio": false }
- "al shopping del Limache" → { "query": "Shopping Limache Salta", "isBarrio": false }
- "a plaza 9 de julio" → { "query": "Plaza 9 de Julio Salta", "isBarrio": false }
- "España y Pellegrini" → { "query": "España y Pellegrini, Salta", "isBarrio": false }
- "al farmacity de la Belgrano" → { "query": "Farmacity Belgrano Salta", "isBarrio": false }
- "a la YPF de la San Martín" → { "query": "YPF San Martin Salta", "isBarrio": false }
- "al hospital San Bernardo" → { "query": "Hospital San Bernardo Salta", "isBarrio": false }
- "al colegio Belgrano" → { "query": "Colegio Belgrano Salta", "isBarrio": false }
- "a la terminal" → { "query": "Terminal de Omnibus Salta", "isBarrio": false }
- "al Carrefour de Limache" → { "query": "Carrefour Limache Salta", "isBarrio": false }`,
        },
        {
          role: 'user',
          content: rawText,
        },
      ],
      temperature: 0.1,
      max_completion_tokens: 200,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`GPT API error: ${err}`);
  }

  const data = await response.json();
  const raw = data.choices?.[0]?.message?.content?.trim();

  if (!raw) {
    throw new Error('No se pudo identificar una dirección en el audio');
  }

  try {
    const parsed = JSON.parse(raw);
    if (parsed.query && parsed.query !== 'NO_ADDRESS') {
      return parsed;
    }
  } catch {
    // If GPT didn't return valid JSON, treat as plain query
    if (raw !== 'NO_ADDRESS') {
      return { query: raw, isBarrio: false };
    }
  }

  throw new Error('No se pudo identificar una dirección en el audio');
}

/**
 * Full pipeline: transcribe audio → extract address variants → geocode all
 * Returns array of destination candidates for the driver to pick from
 * @param {string} uri - Local audio file URI
 * @returns {Promise<{transcription: string, candidates: Array<{address: string, lat: number, lng: number}>}>}
 */
export async function voiceToDestination(uri) {
  // Step 1: Transcribe audio
  const rawText = await transcribeAudio(uri);
  if (!rawText) {
    throw new Error('No se detectó audio. Intentá de nuevo hablando más claro.');
  }

  // Step 2: Extract clean search query via GPT
  const extracted = await extractAddress(rawText);
  let { query, isBarrio } = extracted;

  // Normalize: GPT sometimes says "Salta Capital" — standardize to "Salta"
  query = query.replace(/Salta\s*Capital/gi, 'Salta');

  // Ensure query ends with "Salta" for locality bias
  if (!/salta/i.test(query)) {
    query = query.replace(/,?\s*$/, '') + ' Salta';
  }

  const allResults = [];
  const seenKeys = new Set();

  const { variants: queryVariants, barrioHint } = createQueryVariants({
    rawText: rawText,
    extractedQuery: query,
    isBarrio,
  });

  if (queryVariants.length === 0) {
    throw new Error('No se pudo construir una búsqueda válida para el destino.');
  }

  // Step 3: If it's a barrio, try local lookup (instant, before API calls)
  if (isBarrio || barrioHint) {
    const barrioName = (barrioHint?.name || query)
      .replace(/^Barrio\s+/i, '')
      .replace(/[,\s]*Salta.*$/i, '')
      .trim();
    // Use searchBarrios which finds ALL partial matches (contains, startsWith)
    const barrioResults = searchBarrios(barrioName);
    for (const br of barrioResults.slice(0, 5)) {
      const key = br.name.toLowerCase();
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        allResults.push({
          address: `Barrio ${br.name}, Salta`,
          lat: br.lat,
          lng: br.lng,
          _score: 1.5,
          _sourceQuery: `barrio:${barrioName}`,
        });
      }
    }
  }

  // Step 4: Autocomplete over multiple query variants
  for (const variant of queryVariants) {
    try {
      const autocompleteResults = await autocompleteAddressSalta(variant, 5);
      for (const r of autocompleteResults) {
        const key = normalizeForMatch(r.address);
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          allResults.push({
            address: r.address,
            placeId: r.placeId,
            _score: scoreCandidate(variant, r.address, { barrioHint }),
            _sourceQuery: variant,
          });
        }
      }
    } catch (err) {
      console.warn('Autocomplete error:', err);
    }
  }

  // Step 5: Geocoding fallback for additional robustness when autocomplete is weak/ambiguous
  for (const variant of queryVariants.slice(0, 3)) {
    try {
      const geocodeResults = await geocodeAddressMultiple(variant, 3);
      for (const g of geocodeResults) {
        const key = normalizeForMatch(g.formattedAddress || g.address);
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          const formatted = g.formattedAddress || g.address;
          allResults.push({
            address: formatted,
            lat: g.lat,
            lng: g.lng,
            _score: scoreCandidate(variant, formatted, { barrioHint }) + 0.15,
            _sourceQuery: variant,
          });
        }
      }
    } catch (err) {
      console.warn('Geocode fallback error:', err);
    }
  }

  if (allResults.length === 0) {
    throw new Error('No se encontraron direcciones. Intentá de nuevo.');
  }

  allResults.sort((a, b) => {
    const scoreDiff = (b._score || 0) - (a._score || 0);
    if (scoreDiff !== 0) return scoreDiff;
    return String(a.address).localeCompare(String(b.address));
  });

  const rankedCandidates = allResults.slice(0, 8).map((item) => ({
    address: item.address,
    placeId: item.placeId,
    lat: item.lat,
    lng: item.lng,
  }));

  return {
    transcription: rawText,
    candidates: rankedCandidates,
  };
}

/**
 * Recording helpers using expo-av
 */
export async function startDestinationRecording() {
  const { granted } = await Audio.requestPermissionsAsync();
  if (!granted) {
    throw new Error('Se necesita permiso de micrófono');
  }

  await Audio.setAudioModeAsync({
    allowsRecordingIOS: true,
    playsInSilentModeIOS: true,
    staysActiveInBackground: true,
    interruptionModeIOS: InterruptionModeIOS.DuckOthers,
    interruptionModeAndroid: InterruptionModeAndroid.DuckOthers,
    shouldDuckAndroid: false,
    playThroughEarpieceAndroid: false,
  });

  const recordingOptions = {
    isMeteringEnabled: false,
    android: {
      extension: '.m4a',
      outputFormat: Audio.AndroidOutputFormat.MPEG_4,
      audioEncoder: Audio.AndroidAudioEncoder.AAC,
      sampleRate: 44100,
      numberOfChannels: 1,
      bitRate: 128000,
    },
    ios: {
      extension: '.m4a',
      outputFormat: Audio.IOSOutputFormat.MPEG4AAC,
      audioQuality: Audio.IOSAudioQuality.MAX,
      sampleRate: 44100,
      numberOfChannels: 1,
      bitRate: 128000,
    },
    web: {
      mimeType: 'audio/webm',
      bitsPerSecond: 128000,
    },
  };

  const { recording } = await Audio.Recording.createAsync(recordingOptions);
  return recording;
}

export async function stopDestinationRecording(recording) {
  await recording.stopAndUnloadAsync();
  const uri = recording.getURI();
  if (!uri) throw new Error('No se obtuvo el archivo de audio');
  return uri;
}
