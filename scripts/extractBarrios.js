/**
 * Script to fetch IDEMSA barrios GeoJSON and extract
 * barrio names with centroid coordinates.
 * Run: node scripts/extractBarrios.js
 */
const https = require('https');

const URL = 'https://idemsa.municipalidadsalta.gob.ar/visor/maps/data/barrio3.js';

function fetchData(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve(data));
      res.on('error', reject);
    }).on('error', reject);
  });
}

function computeCentroid(coordinates) {
  // MultiPolygon: coordinates is array of Polygon arrays
  // Each Polygon is array of rings, first ring is exterior
  let sumLng = 0, sumLat = 0, count = 0;
  
  for (const polygon of coordinates) {
    const ring = polygon[0]; // exterior ring
    for (const [lng, lat] of ring) {
      sumLng += lng;
      sumLat += lat;
      count++;
    }
  }
  
  if (count === 0) return null;
  return {
    lat: Math.round((sumLat / count) * 1000000) / 1000000,
    lng: Math.round((sumLng / count) * 1000000) / 1000000,
  };
}

async function main() {
  console.log('Fetching IDEMSA barrios data...');
  const raw = await fetchData(URL);
  
  // The file starts with "var barrio = \n// comments\n{actual json}"
  // Remove the var assignment and strip // comment lines
  let cleaned = raw.replace(/^\s*var\s+barrio\s*=\s*/, '');
  // Remove single-line JS comments
  cleaned = cleaned.split('\n').map(line => {
    const trimmed = line.trim();
    if (trimmed.startsWith('//')) return '';
    return line;
  }).join('\n');
  cleaned = cleaned.replace(/;\s*$/, '').trim();
  const geojson = JSON.parse(cleaned);
  
  console.log(`Found ${geojson.features.length} barrios\n`);
  
  const barrios = {};
  const seen = new Set();
  
  for (const feature of geojson.features) {
    const name = feature.properties.BARRIO;
    const tipo = feature.properties.BARRIO_CL;
    const centroid = computeCentroid(feature.geometry.coordinates);
    
    if (!centroid) continue;
    
    // Use name as key, handling duplicates by appending tipo
    let key = name;
    if (seen.has(key)) {
      key = `${name} (${tipo})`;
    }
    seen.add(name);
    
    barrios[key] = centroid;
  }
  
  // Output as JS module
  const entries = Object.entries(barrios)
    .sort(([a], [b]) => a.localeCompare(b, 'es'))
    .map(([name, coord]) => `  '${name.replace(/'/g, "\\'")}': { lat: ${coord.lat}, lng: ${coord.lng} }`)
    .join(',\n');
  
  console.log(`// ${Object.keys(barrios).length} barrios with centroid coordinates`);
  console.log(`export const BARRIO_COORDINATES = {\n${entries}\n};`);
}

main().catch(console.error);
