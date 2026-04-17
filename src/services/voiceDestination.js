import { Audio, InterruptionModeAndroid, InterruptionModeIOS } from 'expo-av';
import { autocompleteAddressSalta } from './googleMaps';
import { BARRIO_NAMES, findBarrio, searchBarrios } from '../data/barrios';

const OPENAI_API_KEY = process.env.EXPO_PUBLIC_OPENAI_API_KEY || '';

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

  // Step 3: If it's a barrio, try local lookup (instant, before API calls)
  if (isBarrio) {
    const barrioName = query.replace(/^Barrio\s+/i, '').replace(/[,\s]*Salta.*$/i, '').trim();
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
        });
      }
    }
  }

  // Step 4: Google Places Autocomplete (instant, no lat/lng resolution yet)
  try {
    const autocompleteResults = await autocompleteAddressSalta(query, 5);
    for (const r of autocompleteResults) {
      const key = r.address.toLowerCase();
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        allResults.push({
          address: r.address,
          placeId: r.placeId,
          // lat/lng resolved on selection via getPlaceDetails
        });
      }
    }
  } catch (err) {
    console.warn('Autocomplete error:', err);
  }

  if (allResults.length === 0) {
    throw new Error('No se encontraron direcciones. Intentá de nuevo.');
  }

  return {
    transcription: rawText,
    candidates: allResults,
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
