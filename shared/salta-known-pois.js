/**
 * POIs conocidos de Salta Capital — detección coloquial, typos y nombre canónico para geocodificar.
 * Compartido entre passenger-app y profesional-dashboard.
 */

function normalizePoiText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Corrige errores de tipeo frecuentes en nombres de lugares. */
function fixPoiTypoTokens(norm) {
  return String(norm || '')
    .replace(/\bterminalk\b/g, 'terminal')
    .replace(/\bterminak\b/g, 'terminal')
    .replace(/\btermnal\b/g, 'terminal')
    .replace(/\btermina+l\b/g, 'terminal')
    .replace(/\bshoping\b/g, 'shopping')
    .replace(/\bshopingk\b/g, 'shopping')
    .replace(/\bshopp?ingk\b/g, 'shopping')
    .replace(/\bhospitak\b/g, 'hospital')
    .replace(/\bbernado\b/g, 'bernardo')
    .replace(/\baeropuertok\b/g, 'aeropuerto')
    .replace(/\bestacionk\b/g, 'estacion')
    .replace(/\bestacion\b/g, 'estacion')
    .replace(/\bjarava\b/g, 'jaraba')
    .replace(/\bfransisca\b/g, 'francisca')
    .replace(/\bhiperlibertad\b/g, 'hiper libertad');
}

const SALTA_KNOWN_POIS = [
  // ── Transporte ────────────────────────────────────────────────────────────
  {
    id: 'terminal',
    label: 'Terminal de Ómnibus',
    geocodeQuery: 'Terminal de Ómnibus de Salta, Salta, Argentina',
    alternateGeocodeQueries: [
      'Terminal de Omnibus Salta',
      'Terminal de buses Salta',
      'Estación de ómnibus Salta',
    ],
    patterns: [
      /\b(la\s+)?terminal(?:\s+de\s+(omnibus|buses?))?\b/,
      /\bterminal\s+omnibus\b/,
      /\b(la\s+)?terminal\b/,
    ],
  },
  {
    id: 'aeropuerto',
    label: 'Aeropuerto de Salta',
    geocodeQuery: 'Aeropuerto Internacional Martín Miguel de Güemes, Salta, Argentina',
    patterns: [/\b(el\s+)?aeropuerto\b/, /\baeropuerto\s+(de\s+)?salta\b/],
  },
  {
    id: 'tren',
    label: 'Estación de Tren Salta',
    geocodeQuery: 'Estación Salta, Salta, Argentina',
    patterns: [
      /\b(el\s+)?tren\b/,
      /\bestacion\s+de\s+tren\b/,
      /\b(la\s+)?estacion(?:\s+de\s+tren)?\b/,
    ],
  },

  // ── Hospitales / Salud ────────────────────────────────────────────────────
  {
    id: 'hospital',
    label: 'Hospital San Bernardo',
    /** Búsqueda genérica sin calle: devolver varios hospitales de Salta. */
    categorySearch: true,
    geocodeQuery: 'Hospital San Bernardo, Salta, Argentina',
    alternateGeocodeQueries: [
      'Hospital San Bernardo, Avenida José Tobias 69, Salta',
      'Hospital San Bernardo, Dr. Mariano Boedo 167, Salta',
      'Sanatorio San Bernardo Salta',
      'Hospital Señor del Milagro Salta',
      'Hospital Público Materno Infantil Salta',
      'Hospital Papa Francisco Salta',
      'Hospital Militar Salta',
      'hospital Salta Capital',
    ],
    /** Opciones estables para el poll (Google a veces mezcla Cerro / hospitales irrelevantes). */
    pollSeeds: [
      {
        title: 'Hospital San Bernardo',
        subtitle: 'Avenida José Tobias 69',
        geocodeQuery: 'Hospital San Bernardo, Avenida José Tobias 69, Salta, Argentina',
        matchTokens: ['bernardo'],
      },
      {
        title: 'Hospital San Bernardo',
        subtitle: 'Dr. Mariano Boedo 167',
        geocodeQuery: 'Hospital San Bernardo, Dr. Mariano Boedo 167, Salta, Argentina',
        matchTokens: ['bernardo'],
      },
      {
        title: 'Sanatorio San Bernardo',
        subtitle: 'Dr. Mariano Boedo 167',
        geocodeQuery: 'Sanatorio San Bernardo, Dr. Mariano Boedo 167, Salta, Argentina',
        matchTokens: ['bernardo'],
        specificOnly: true,
      },
      {
        title: 'Hospital Señor del Milagro',
        subtitle: 'Salta',
        geocodeQuery: 'Hospital Señor del Milagro, Salta, Argentina',
        categoryOnly: true,
      },
      {
        title: 'Hospital Público Materno Infantil',
        subtitle: 'Salta',
        geocodeQuery: 'Hospital Público Materno Infantil, Salta, Argentina',
        categoryOnly: true,
      },
      {
        title: 'Hospital Papa Francisco',
        subtitle: 'Salta',
        geocodeQuery: 'Hospital Papa Francisco, Salta, Argentina',
        categoryOnly: true,
      },
      {
        title: 'Hospital Militar',
        subtitle: 'Salta',
        geocodeQuery: 'Hospital Militar, Salta, Argentina',
        categoryOnly: true,
      },
    ],
    patterns: [
      /\bhospital\s+san\s+bernardo\b/,
      /\bsan\s+bernardo\b/,
      /\b(el\s+)?hospital\b/,
    ],
    excludePatterns: [
      /\bmilitar\b/,
      /\bmaterno\b/,
      /\bpapa\s+francisco\b/,
      /\btres\s+cerritos\b/,
      /\bmilagro\b/,
      /\bpediatric/,
      /\bcerro\b/,
      /\btelef/,
    ],
  },
  {
    id: 'hospital_senor_milagro',
    label: 'Hospital Señor del Milagro',
    geocodeQuery: 'Hospital Señor del Milagro, Salta, Argentina',
    patterns: [
      /\bhospital\s+se(ñ|n)or\s+del\s+milagro\b/,
      /\bse(ñ|n)or\s+del\s+milagro\b/,
      /\bmilagro\b/,
    ],
  },
  {
    id: 'hospital_materno',
    label: 'Hospital Público Materno Infantil',
    geocodeQuery: 'Hospital Público Materno Infantil, Salta, Argentina',
    patterns: [
      /\bmaterno\s+infantil\b/,
      /\bhospital\s+materno\b/,
      /\bmaternidad\b/,
    ],
  },
  {
    id: 'hospital_papa_francisco',
    label: 'Hospital Papa Francisco',
    geocodeQuery: 'Hospital Papa Francisco, Salta, Argentina',
    patterns: [
      /\bhospital\s+papa\s+francisco\b/,
      /\bpapa\s+francisco\b/,
    ],
  },
  {
    id: 'hospital_militar',
    label: 'Hospital Militar',
    geocodeQuery: 'Hospital Militar, Salta, Argentina',
    patterns: [/\bhospital\s+militar\b/, /\bmilitar\b/],
  },
  {
    id: 'hospital_tres_cerritos',
    label: 'Hospital Privado Tres Cerritos',
    geocodeQuery: 'Hospital Privado Tres Cerritos, Salta, Argentina',
    patterns: [
      /\btres\s+cerritos\b/,
      /\bhospital\s+privado\s+tres\s+cerritos\b/,
    ],
  },
  {
    id: 'hospital_ragone',
    label: 'Hospital de Salud Mental Miguel Ragone',
    geocodeQuery: 'Hospital de Salud Mental Miguel Ragone, Salta, Argentina',
    patterns: [/\bragone\b/, /\bsalud\s+mental\s+ragone\b/],
  },
  {
    id: 'hospital_oñativia',
    label: 'Hospital Dr. Arturo Oñativia',
    geocodeQuery: 'Hospital De Endocrinologia Y Metabolismo Dr Arturo Oñativia, Salta, Argentina',
    patterns: [/\bo(ñ|n)ativia\b/, /\bendocrinolog(i|í)a\b/],
  },
  {
    id: 'clinica_santa_clara',
    label: 'Clínica Santa Clara de Asís',
    geocodeQuery: 'Clínica Santa Clara de Asís, Salta, Argentina',
    alternateGeocodeQueries: ['Fundación Santa Clara de Asís Salta'],
    patterns: [
      /\bclinica\s+santa\s+clara\b/,
      /\bsanta\s+clara(?:\s+de\s+asis)?\b/,
    ],
  },
  {
    id: 'sanatorio_el_carmen',
    label: 'Sanatorio El Carmen',
    geocodeQuery: 'Sanatorio El Carmen, Salta, Argentina',
    patterns: [/\bsanatorio\s+el\s+carmen\b/, /\bel\s+carmen\b/],
  },
  {
    id: 'emergencia_pediatrica',
    label: 'Emergencia Pediátrica',
    geocodeQuery: 'Emergencia Pediatrica, Salta, Argentina',
    patterns: [/\bemergencia\s+pediatrica\b/, /\bpediatrica\b/],
  },
  {
    id: 'apass',
    label: 'APASS',
    geocodeQuery: 'APASS Sanatorio, Salta, Argentina',
    patterns: [/\bapass\b/, /\bsanatorio\s+apass\b/],
  },

  // ── Universidades / Educación ─────────────────────────────────────────────
  {
    id: 'unsa',
    label: 'Universidad Nacional de Salta (UNSa)',
    geocodeQuery: 'Universidad Nacional de Salta, Salta, Argentina',
    alternateGeocodeQueries: [
      'UNSa Salta',
      'Facultad de Ciencias Naturales UNSA',
      'Universidad Nacional de Salta - Campo General San Martín',
    ],
    patterns: [
      /\bunsa\b/,
      /\buniversidad\s+nacional\s+de\s+salta\b/,
      /\bu\.?\s*n\.?\s*s\.?\s*a\.?\b/,
      /\bciudad\s+universitaria\b/,
    ],
  },
  {
    id: 'ucasal',
    label: 'Universidad Católica de Salta (UCASAL)',
    geocodeQuery: 'Universidad Católica de Salta, Salta, Argentina',
    alternateGeocodeQueries: ['UCASAL Salta'],
    patterns: [
      /\bucasal\b/,
      /\buniversidad\s+cat(o|ó)lica\s+de\s+salta\b/,
      /\bu\.?\s*c\.?\s*a\.?\s*s\.?\s*a\.?\s*l\.?\b/,
    ],
  },
  {
    id: 'universidad_siglo21',
    label: 'Universidad Siglo 21',
    geocodeQuery: 'Universidad Siglo 21, Salta, Argentina',
    patterns: [
      /\bsiglo\s+21\b/,
      /\buniversidad\s+siglo\s+21\b/,
    ],
  },

  // ── Estadios / Deportes ───────────────────────────────────────────────────
  {
    id: 'estadio_martearena',
    label: 'Estadio Padre Ernesto Martearena',
    geocodeQuery: 'Estadio Padre Ernesto Martearena, Salta, Argentina',
    patterns: [
      /\bmartearena\b/,
      /\bestadio\s+padre\s+ernesto\s+martearena\b/,
      /\bestadio\s+(de\s+)?salta\b/,
    ],
  },
  {
    id: 'estadio_gigante_norte',
    label: 'El Gigante del Norte (Estadio CAN)',
    geocodeQuery: 'El Gigante del Norte, Salta, Argentina',
    alternateGeocodeQueries: ['Club Atletico San Martín Salta', 'Estadio San Martin Salta'],
    patterns: [
      /\bgigante\s+del\s+norte\b/,
      /\bcan\b/,
      /\bclub\s+atletico\s+san\s+martin\b/,
    ],
  },
  {
    id: 'estadio_central_norte',
    label: 'Club Central Norte',
    geocodeQuery: 'Club Central Norte, Salta, Argentina',
    patterns: [
      /\bcentral\s+norte\b/,
      /\bclub\s+central\s+norte\b/,
    ],
  },
  {
    id: 'estadio_julio_caceres',
    label: 'Estadio Julio Cáceres (Juventud Antoniana)',
    geocodeQuery: 'Estadio Julio Caceres Salta, Argentina',
    alternateGeocodeQueries: ['Juventud Antoniana Salta'],
    patterns: [
      /\bjulio\s+c(a|á)ceres\b/,
      /\bantoni(a|ana)\b/,
      /\bjuventud\s+antoniana\b/,
    ],
  },

  // ── Mercados / Ferias ─────────────────────────────────────────────────────
  {
    id: 'mercado_san_miguel',
    label: 'Mercado San Miguel',
    geocodeQuery: 'Mercado San Miguel, Salta, Argentina',
    alternateGeocodeQueries: ['Mercado Municipal San Miguel Salta'],
    patterns: [
      /\bmercado\s+san\s+miguel\b/,
      /\bsan\s+miguel\b/,
    ],
  },
  {
    id: 'mercado_artesanal',
    label: 'Mercado Artesanal',
    geocodeQuery: 'Mercado Artesanal, Salta, Argentina',
    patterns: [
      /\bmercado\s+artesanal\b/,
      /\bartesanal\b/,
    ],
  },
  {
    id: 'mercado_evita',
    label: 'Mercado Evita',
    geocodeQuery: 'Mercado Evita, Salta, Argentina',
    patterns: [/\bmercado\s+evita\b/],
  },
  {
    id: 'feria_balcarce',
    label: 'Paseo Balcarce',
    geocodeQuery: 'Paseo Balcarce, Salta, Argentina',
    alternateGeocodeQueries: ['Feria Balcarce Salta'],
    patterns: [
      /\bbalcarce\b/,
      /\bpaseo\s+balcarce\b/,
      /\bferia\s+balcarce\b/,
    ],
  },

  // ── Museos / Cultura ──────────────────────────────────────────────────────
  {
    id: 'maam',
    label: 'Museo de Arqueología de Alta Montaña (MAAM)',
    geocodeQuery: 'Museo de Arqueología de Alta Montaña, Salta, Argentina',
    patterns: [
      /\bmaam\b/,
      /\bmusel?\s+de\s+arqueolog(i|í)a\b/,
      /\balta\s+monta(n|ñ)a\b/,
    ],
  },
  {
    id: 'museo_bellas_artes',
    label: 'Museo de Bellas Artes',
    geocodeQuery: 'Museo de Bellas Artes, Salta, Argentina',
    patterns: [
      /\bbellas\s+artes\b/,
      /\bmuseo\s+de\s+bellas\s+artes\b/,
    ],
  },
  {
    id: 'museo_guemes',
    label: 'Museo de Güemes',
    geocodeQuery: 'Museo de Güemes, Salta, Argentina',
    patterns: [
      /\bmuseo\s+de\s+g(u|ü)emes\b/,
      /\bmuseo\s+g(u|ü)emes\b/,
    ],
  },
  {
    id: 'cabildo',
    label: 'Cabildo de Salta',
    geocodeQuery: 'Cabildo de Salta, Salta, Argentina',
    patterns: [/\bcabildo\b/],
  },
  {
    id: 'museo_ciencias_naturales',
    label: 'Museo de Ciencias Naturales',
    geocodeQuery: 'Museo de Ciencias Naturales, Salta, Argentina',
    patterns: [
      /\bciencias\s+naturales\b/,
      /\bmuseo\s+de\s+ciencias\s+naturales\b/,
    ],
  },

  // ── Lugares / Esparcimiento ───────────────────────────────────────────────
  {
    id: 'plaza_ceferino',
    label: 'Plaza Ceferino',
    geocodeQuery: 'Plaza Ceferino, Barrio Don Ceferino, Salta, Argentina',
    alternateGeocodeQueries: ['Plaza de Ceferino, Salta, Argentina'],
    patterns: [
      /\bplaza\s+(de\s+)?ceferino\b/,
    ],
  },
  {
    id: 'plaza_alvarado',
    label: 'Plaza Alvarado',
    geocodeQuery: 'Plaza Alvarado, Salta, Argentina',
    patterns: [/\bplaza\s+(de\s+)?alvarado\b/],
  },
  {
    id: 'plaza_belgrano',
    label: 'Plaza Belgrano',
    geocodeQuery: 'Plaza Belgrano, Salta, Argentina',
    patterns: [/\bplaza\s+(de\s+)?belgrano\b/],
  },
  {
    id: 'plaza_guemes',
    label: 'Plaza General Güemes',
    geocodeQuery: 'Plaza General Güemes, Salta, Argentina',
    alternateGeocodeQueries: ['Plaza Gral Güemes, Salta, Argentina'],
    patterns: [
      /\bplaza\s+(gral\.?\s*)?g[uü]emes\b/,
      /\bplaza\s+don\s+mart[ií]n\s+miguel\s+de\s+g[uü]emes\b/,
    ],
  },
  {
    id: 'plaza_25_mayo',
    label: 'Plaza 25 de Mayo',
    geocodeQuery: 'Plaza 25 de Mayo, Salta, Argentina',
    patterns: [/\bplaza\s+25\s+de\s+mayo\b/],
  },
  {
    id: 'plaza_juventud',
    label: 'Plaza de la Juventud',
    geocodeQuery: 'Plaza de la Juventud, Salta, Argentina',
    patterns: [/\bplaza\s+(de\s+la\s+)?juventud\b/],
  },
  {
    id: 'plaza_9_de_julio',
    label: 'Plaza 9 de Julio',
    categorySearch: true,
    geocodeQuery: 'Plaza 9 de Julio, Salta, Argentina',
    alternateGeocodeQueries: [
      'Plaza 9 de Julio Salta',
      'Plaza 25 de Mayo Salta',
      'Plaza Belgrano Salta',
      'Plaza General Güemes Salta',
      'Plaza Alvarado Salta',
      'Plaza de la Juventud Salta',
      'plaza Salta Capital',
    ],
    patterns: [
      /\bplaza\s+9\s+de\s+julio\b/,
      /\bplaza\s+principal\b/,
    ],
    /** Solo "la plaza" / "plaza" a secas — no "plaza <otro nombre>". */
    exactPatterns: [/^(?:la\s+)?plaza$/i],
  },
  {
    id: 'catedral',
    label: 'Catedral Basílica de Salta',
    geocodeQuery: 'Catedral Basílica de Salta, Salta, Argentina',
    alternateGeocodeQueries: ['Catedral de Salta, Argentina'],
    patterns: [/\b(la\s+)?catedral\b/],
  },
  {
    id: 'casino',
    label: 'Casino Club Salta',
    geocodeQuery: 'Casino Club Salta, Salta, Argentina',
    patterns: [/\b(el\s+)?casino(?:\s+salta)?\b/],
  },
  {
    id: 'cementerio',
    label: 'Cementerio de la Santa Cruz',
    geocodeQuery: 'Cementerio de la Santa Cruz, Salta, Argentina',
    patterns: [/\b(el\s+)?cementerio\b/],
  },
  {
    id: 'parque_san_martin',
    label: 'Parque San Martín',
    geocodeQuery: 'Parque San Martín, Salta, Argentina',
    patterns: [
      /\bparque\s+san\s+mart(i|í)n\b/,
    ],
  },
  {
    id: 'cerro_san_bernardo',
    label: 'Cerro San Bernardo',
    geocodeQuery: 'Cerro San Bernardo, Salta, Argentina',
    alternateGeocodeQueries: ['Teleférico Salta'],
    patterns: [
      /\bcerro\s+san\s+bernardo\b/,
      /\btelef(e|é)rico\b/,
      /\bcerro\b/,
    ],
  },

  // ── Comercios / Servicios ─────────────────────────────────────────────────
  {
    id: 'el_punto_shopping',
    label: 'El Punto Shopping',
    geocodeQuery: 'Av. Finca Yerba Buena 4401, San Lorenzo, Salta, Argentina',
    alternateGeocodeQueries: [
      'Avenida Finca Yerba Buena 4401 San Lorenzo Salta',
      'El Punto Shopping San Lorenzo',
      'Finca Yerba Buena 4401 San Lorenzo',
    ],
    patterns: [
      /\bel\s+punto\s+shopping\b/,
      /\bpunto\s+shopping\b/,
      /\bpunto\s+shoping\b/,
    ],
    branches: [
      {
        subtitlePatterns: [/finca|yerba\s*buena|san\s*lorenzo/],
        geocodeQuery: 'Av. Finca Yerba Buena 4401, San Lorenzo, Salta, Argentina',
        shortLabel: 'El Punto Shopping, Finca Yerba Buena, San Lorenzo',
      },
    ],
  },
  {
    id: 'alto_noa_shopping',
    label: 'Alto NOA Shopping',
    geocodeQuery: 'Alto NOA Shopping, Av. del Bicentenario 702, Salta, Argentina',
    alternateGeocodeQueries: [
      'Alto Noa Shopping Center Salta',
      'Shopping Alto NOA Salta',
    ],
    patterns: [
      /\balto\s+noa\b/,
      /\bnoa\s+shopping\b/,
    ],
  },
  {
    id: 'shopping',
    label: 'Shopping Salta',
    /** Búsqueda genérica sin calle: varios centros comerciales de Salta. */
    categorySearch: true,
    geocodeQuery: 'Portal Salta Shopping, Salta, Argentina',
    alternateGeocodeQueries: [
      'Portal Salta Shopping, 20 de Febrero 1437, Salta',
      'Alto NOA Shopping, Av. del Bicentenario 702, Salta',
      'Paseo del Cabildo, Caseros 521, Salta',
      'Galería Salta Shop, Salta',
      'Nuevo Centro Shopping Salta',
      'El Punto Shopping, San Lorenzo, Salta',
      'Paseo Libertad Salta',
      'centro comercial Salta Capital',
      'shopping mall Salta',
    ],
    pollSeeds: [
      {
        title: 'Portal Salta',
        subtitle: '20 de Febrero 1437',
        geocodeQuery: 'Portal Salta Shopping, 20 de Febrero 1437, Salta, Argentina',
      },
      {
        title: 'Alto NOA Shopping',
        subtitle: 'Avenida del Bicentenario 702',
        geocodeQuery: 'Alto NOA Shopping, Av. del Bicentenario 702, Salta, Argentina',
      },
      {
        title: 'Paseo del Cabildo',
        subtitle: 'Caseros 521',
        geocodeQuery: 'Paseo del Cabildo, Caseros 521, Salta, Argentina',
      },
      {
        title: 'Nuevo Centro Shopping',
        subtitle: 'Salta',
        geocodeQuery: 'Nuevo Centro Shopping, Salta, Argentina',
      },
      {
        title: 'Paseo Libertad',
        subtitle: 'Rotonda Limache',
        geocodeQuery: 'Paseo Libertad, Salta, Argentina',
      },
      {
        title: 'El Punto Shopping',
        subtitle: 'Finca Yerba Buena, San Lorenzo',
        geocodeQuery: 'El Punto Shopping, San Lorenzo, Salta, Argentina',
      },
    ],
    patterns: [
      /\b(el\s+)?shopping(?:\s+salta)?\b/,
      /\bshopping\s+salta\b/,
      /\bnuevo\s+centro\s+shopping\b/,
      /\bcentro\s+comercial(?:\s+shopping)?\b/,
    ],
    /** No confundir con "El Punto Shopping" u otros shoppings con nombre propio. */
    excludePatterns: [/\bpunto\s+shop/i],
  },
  {
    id: 'paseo_libertad',
    label: 'Paseo Libertad',
    geocodeQuery: 'Paseo Libertad, Avenida Monseñor Roberto José Tavella, Salta, Argentina',
    alternateGeocodeQueries: [
      'Paseo Libertad Salta',
      'Paseo Libertad 1, Salta, Argentina',
      'Monseñor Roberto José Tavella 1, Salta, Argentina',
    ],
    patterns: [
      /\bpaseo\s+libertad\b/,
      /\bel\s+balcon\b/,
    ],
  },
  {
    id: 'paseo_salta',
    label: 'Paseo Salta',
    geocodeQuery: 'Paseo Libertad, Avenida Monseñor Roberto José Tavella, Salta, Argentina',
    alternateGeocodeQueries: [
      'Paseo Salta Rotonda Limache Salta',
      'Rotonda de Limache Salta',
      'Paseo Libertad Salta',
    ],
    patterns: [
      /\bpaseo\s+salta\b/,
    ],
  },
  {
    id: 'hiper_libertad',
    label: 'Hiper Libertad',
    geocodeQuery: 'Paseo Libertad, Avenida Monseñor Roberto José Tavella, Salta, Argentina',
    alternateGeocodeQueries: [
      'Paseo Libertad Salta',
      'Paseo Salta Rotonda Limache Salta',
      'Hiper Libertad Paseo Salta Salta',
    ],
    patterns: [
      /\bhiper\s*libertad\b/,
      /\bhiperlibertad\b/,
      /\blibertad\s+sa\b/,
    ],
  },
  {
    id: 'la_anonima',
    label: 'La Anónima',
    geocodeQuery: 'Paseo Libertad, Avenida Monseñor Roberto José Tavella, Salta, Argentina',
    alternateGeocodeQueries: [
      'Paseo Salta La Anónima Salta',
      'Paseo Libertad Salta',
      'Rotonda de Limache Salta',
    ],
    patterns: [
      /\b(la\s+)?anonima\b/,
    ],
  },
  {
    id: 'la_francisca',
    label: 'La Francisca',
    geocodeQuery: 'Av. Gral. Arenales 1819, Salta, Argentina',
    alternateGeocodeQueries: [
      'General Arenales 1819, Salta, Argentina',
      'Arenales 1819, Salta, Argentina',
    ],
    patterns: [
      /\b(la\s+)?fransisca\b/,
      /\b(la\s+)?francisca\b/,
    ],
    branches: [
      {
        subtitlePatterns: [/arenal/],
        geocodeQuery: 'Av. Gral. Arenales 1819, Salta, Argentina',
        shortLabel: 'La Francisca, Arenales 1819, Salta',
      },
      {
        subtitlePatterns: [/bicentenario|tres\s*cerritos/],
        geocodeQuery: 'Av. del Bicentenario de la Batalla de Salta 1431, Salta, Argentina',
        shortLabel: 'La Francisca, Bicentenario 1431, Salta',
      },
      {
        subtitlePatterns: [/reyes\s*catolicos/],
        geocodeQuery: 'Av. Reyes Católicos 1431, Salta, Argentina',
        shortLabel: 'La Francisca, Reyes Católicos 1431, Salta',
      },
    ],
  },
  {
    id: 'imagenes_jaraba',
    label: 'Imágenes Jaraba',
    geocodeQuery: 'Juan Martín de Pueyrredón 550, Salta, Argentina',
    patterns: [
      /\b(imagen(es)?\s+)?jaraba\b/,
      /\bjaraba\b/,
    ],
    branches: [
      {
        subtitlePatterns: [/pueyrredon/],
        geocodeQuery: 'Juan Martín de Pueyrredón 550, Salta, Argentina',
        shortLabel: 'Imágenes Jaraba, Pueyrredón 550, Salta',
      },
      {
        subtitlePatterns: [/mitre/],
        geocodeQuery: 'Bartolomé Mitre 486, Salta, Argentina',
        shortLabel: 'Imágenes Jaraba, Mitre 486, Salta',
      },
      {
        subtitlePatterns: [/vicente\s*lopez/],
        geocodeQuery: 'Vicente López 46, Salta, Argentina',
        shortLabel: 'Imágenes Jaraba, Vicente López 46, Salta',
      },
      {
        subtitlePatterns: [/9\s*de\s*julio|guemes/],
        geocodeQuery: '9 de Julio, General Güemes, Salta, Argentina',
        shortLabel: 'Imágenes Jaraba, 9 de Julio, Salta',
      },
    ],
  },
  {
    id: 'carrefour',
    label: 'Carrefour Salta',
    geocodeQuery: 'Carrefour, Salta, Argentina',
    patterns: [/\bcarrefour\b/],
  },
  {
    id: 'macro',
    label: 'Banco Macro',
    categorySearch: true,
    geocodeQuery: 'Banco Macro, Salta, Argentina',
    alternateGeocodeQueries: [
      'Banco Macro Belgrano Salta',
      'Banco Macro España Salta',
      'Banco Macro Bartolomé Mitre Salta',
      'Banco Macro Caseros Salta',
      'Banco Macro Salta Capital',
    ],
    patterns: [/\bbanco\s+macro\b/, /\bmacro\b/],
  },

  // ── Escuelas / Colegios ───────────────────────────────────────────────────
  {
    id: 'escuela_normal_belgrano',
    label: 'Escuela Normal de Maestras General Manuel Belgrano',
    geocodeQuery: 'Escuela Normal, Bartolomé Mitre, Salta, Argentina',
    alternateGeocodeQueries: [
      'Escuela Normal, Salta, Argentina',
      'Escuela Normal de Maestras, Salta, Argentina',
    ],
    patterns: [
      /\bescuela\s+normal\b/,
      /\bnormal\s+de\s+maestras\b/,
      /\bnormal\s+(general\s+)?manuel\s+belgrano\b/,
    ],
  },
  {
    id: 'colegio_belgrano',
    label: 'Colegio Belgrano',
    geocodeQuery: 'Colegio Belgrano, Salta, Argentina',
    patterns: [/\bcolegio\s+belgrano\b/],
    excludePatterns: [/\bescuela\s+normal\b/, /\bnormal\s+de\s+maestras\b/],
  },
  {
    id: 'colegio_del_milagro',
    label: 'Colegio del Milagro',
    geocodeQuery: 'Colegio del Milagro, Salta, Argentina',
    patterns: [/\bcolegio\s+del\s+milagro\b/],
  },
  {
    id: 'colegio_san_lucas',
    label: 'Colegio San Lucas',
    geocodeQuery: 'Colegio San Lucas, Salta, Argentina',
    patterns: [/\bcolegio\s+san\s+lucas\b/],
  },
  {
    id: 'colegio_jesus',
    label: 'Colegio de Jesús',
    geocodeQuery: 'Colegio de Jesús, Salta, Argentina',
    patterns: [/\bcolegio\s+de\s+jesus\b/],
  },
  {
    id: 'escuela_emprendedores',
    label: 'Escuela de Emprendedores Salta',
    geocodeQuery: 'Avenida Independencia 910, Salta, Argentina',
    alternateGeocodeQueries: [
      'Escuela de Emprendedores, Avenida Independencia 910, Salta',
      'Oficina de empleo, Avenida Independencia 910, Salta, Argentina',
    ],
    patterns: [
      /\bescuela\s+de\s+emprendedores\b/,
      /\bemprendedores\s+salta\b/,
    ],
    branches: [
      {
        subtitlePatterns: [/independencia/],
        geocodeQuery: 'Avenida Independencia 910, Salta, Argentina',
        shortLabel: 'Escuela de Emprendedores, Independencia 910, Salta',
      },
    ],
  },
  {
    id: 'incaa_hogar_escuela',
    label: 'Espacio INCAA Hogar Escuela',
    geocodeQuery: 'Escuela Hogar 4660, Avenida Hipólito Yrigoyen, Salta, Argentina',
    alternateGeocodeQueries: [
      'Espacio INCAA Hogar Escuela, Avenida Hipólito Yrigoyen, Salta',
      'Escuela Hogar 4660 Carmen Puch de Güemes, Salta, Argentina',
      'Pasaje Feliciano Chiclana y Avenida Hipólito Yrigoyen, Salta, Argentina',
    ],
    patterns: [
      /\bincaa\b/,
      /\bespacio\s+incaa\b/,
      /\bhogar\s+escuela\b/,
      /\bcarmen\s+puch\b/,
    ],
    excludePatterns: [/\bemprendedores\b/],
    branches: [
      {
        subtitlePatterns: [/yrigoyen/],
        geocodeQuery: 'Escuela Hogar 4660, Avenida Hipólito Yrigoyen, Salta, Argentina',
        shortLabel: 'Espacio INCAA Hogar Escuela, Yrigoyen, Salta',
      },
    ],
  },

  // ── Gobierno / Servicios públicos ─────────────────────────────────────────
  {
    id: 'municipalidad',
    label: 'Municipalidad de Salta',
    geocodeQuery: 'Municipalidad de la Ciudad de Salta, Salta, Argentina',
    patterns: [/\b(la\s+)?municipalidad\b/],
  },
  {
    id: 'correo',
    label: 'Correo Argentino Salta',
    geocodeQuery: 'Correo Argentino, Salta, Argentina',
    patterns: [/\b(el\s+)?correo\b/],
  },
];

const POI_KEYWORD_RE =
  /\b(hospital|terminal|shopping|aeropuerto|catedral|plaza|casino|estacion|cementerio|sanatorio|apass|banco|farmacia|supermercado|colegio|escuela|universidad|unsa|ucasal|municipalidad|correo|edificio|oficina|galeria|centro\s+comercial|nuevo\s+centro|macro|carrefour|walmart|hiper|tren|estadio|mercado|feria|museo|cabildo|parque|cerro|telef[eé]rico|balcarce|martearena|milagro|materno|militarr|pediatric[ao]|maam|bellas\s+artes|ciencias\s+naturales|siglo\s+21|gigante|antoniana|san\s+bernardo|san\s+miguel|artesanal|incaa|hogar\s+escuela|carmen\s+puch)\b/;

function poiMatchesEntry(poi, norm) {
  if (poi.excludePatterns?.some((pattern) => pattern.test(norm))) return false;
  if (poi.exactPatterns?.some((pattern) => pattern.test(norm))) return true;
  return poi.patterns.some((pattern) => pattern.test(norm));
}

function resolveSaltaKnownPoi(value) {
  const norm = fixPoiTypoTokens(normalizePoiText(value));
  if (!norm) return null;

  for (const poi of SALTA_KNOWN_POIS) {
    if (poiMatchesEntry(poi, norm)) {
      return {
        id: poi.id,
        label: poi.label,
        geocodeQuery: poi.geocodeQuery,
        alternateGeocodeQueries: poi.alternateGeocodeQueries || [],
        categorySearch: Boolean(poi.categorySearch),
        patterns: poi.patterns || [],
        pollSeeds: poi.pollSeeds || [],
      };
    }
  }

  return null;
}

/** POI genérico (shopping, hospital…) sin hint de calle → poll con varias opciones. */
function isCategoryPoiSearch(poi, streetHint = '', originalQuery = '') {
  if (String(streetHint || '').trim()) return false;
  if (!poi?.categorySearch) return false;
  if (isSpecificNamedPoiQuery(originalQuery, poi)) return false;
  return true;
}

const POI_QUERY_STOP_WORDS = new Set([
  'hola', 'me', 'un', 'una', 'al', 'el', 'la', 'los', 'las', 'del', 'de', 'en', 'a', 'para',
  'por', 'favor', 'mandas', 'mandame', 'mandar', 'movil', 'moviles', 'auto', 'autos', 'taxi',
  'remis', 'chofer', 'pedido', 'viaje', 'salta', 'capital', 'argentina', 'centro', 'comercial',
]);

const GENERIC_POI_CATEGORY_TOKENS = new Set([
  'hospital', 'sanatorio', 'clinica', 'shopping', 'shoping', 'terminal', 'plaza', 'banco',
  'macro', 'feria', 'galeria', 'paseo', 'portal', 'hiper', 'supermercado', 'farmacia', 'museo',
]);

/** Tokens demasiado genéricos para exigir match (ej. "san" en "san bernardo"). */
const WEAK_POI_NAME_TOKENS = new Set([
  'san', 'santa', 'santo', 'nuevo', 'nueva', 'alto', 'alta', 'punto', 'paseo', 'plaza', 'privado',
]);

/** Tokens del mensaje que identifican un POI con nombre propio (ej. "bernardo" en hospital). */
function getPoiSpecificSearchTokens(originalQuery, knownPoi) {
  const text = fixPoiTypoTokens(normalizePoiText(originalQuery || ''));
  if (!text) return [];

  const tokens = text
    .split(/\s+/)
    .filter(
      (token) =>
        token.length >= 3
        && !POI_QUERY_STOP_WORDS.has(token)
        && !GENERIC_POI_CATEGORY_TOKENS.has(token),
    );

  const strong = tokens.filter((token) => !WEAK_POI_NAME_TOKENS.has(token));
  return strong.length > 0 ? strong : tokens;
}

function isSpecificNamedPoiQuery(originalQuery, knownPoi) {
  return getPoiSpecificSearchTokens(originalQuery, knownPoi).length >= 1;
}

function queryTextMatchesPoiTokens(queryText, specificTokens) {
  if (!specificTokens?.length) return true;
  const norm = normalizePoiText(queryText);
  return specificTokens.every((token) => norm.includes(token));
}

/**
 * Seeds curados para el poll de WhatsApp (título + calle legibles).
 * Filtra specificOnly/categoryOnly según el mensaje del pasajero.
 */
function getKnownPoiPollSeeds(poi, originalQuery = '') {
  const seeds = Array.isArray(poi?.pollSeeds) ? poi.pollSeeds : [];
  if (!seeds.length) return [];

  const specific = isSpecificNamedPoiQuery(originalQuery, poi);
  const specificTokens = specific ? getPoiSpecificSearchTokens(originalQuery, poi) : [];

  return seeds.filter((seed) => {
    if (specific && seed.categoryOnly) return false;
    if (!specific && seed.specificOnly) return false;
    if (specific && specificTokens.length && Array.isArray(seed.matchTokens) && seed.matchTokens.length) {
      return specificTokens.some((token) => seed.matchTokens.includes(token));
    }
    return true;
  });
}

/**
 * Mapea título + subtítulo de Google Autocomplete a una dirección estructurada
 * (calle + altura) cuando el POI no existe en OSM pero sí la sucursal conocida.
 */
function resolveKnownPoiBranch(title, subtitle) {
  const titleNorm = fixPoiTypoTokens(normalizePoiText(title));
  const subtitleNorm = normalizePoiText(subtitle);
  const combined = `${titleNorm} ${subtitleNorm}`.trim();
  if (!titleNorm && !combined) return null;

  for (const poi of SALTA_KNOWN_POIS) {
    const matchesPoi = poiMatchesEntry(poi, titleNorm) || poiMatchesEntry(poi, combined);
    if (!matchesPoi) continue;

    for (const branch of poi.branches || []) {
      const matchesBranch = branch.subtitlePatterns?.some(
        (pattern) => pattern.test(subtitleNorm) || pattern.test(combined),
      );
      if (matchesBranch) {
        return {
          id: poi.id,
          label: branch.shortLabel || poi.label,
          geocodeQuery: branch.geocodeQuery,
        };
      }
    }

    if (poi.geocodeQuery) {
      return {
        id: poi.id,
        label: poi.label,
        geocodeQuery: poi.geocodeQuery,
      };
    }
  }

  return null;
}

function looksLikeSaltaKnownPoi(value) {
  const norm = fixPoiTypoTokens(normalizePoiText(value));
  if (!norm) return false;
  if (resolveSaltaKnownPoi(norm)) return true;
  return POI_KEYWORD_RE.test(norm);
}

function getKnownPoiSearchQueries(poi, originalQuery = '') {
  if (!poi) return [];
  const seen = new Set();
  const out = [];
  const specific = isSpecificNamedPoiQuery(originalQuery, poi);
  const specificTokens = specific ? getPoiSpecificSearchTokens(originalQuery, poi) : [];

  const add = (q) => {
    const trimmed = String(q || '').trim();
    if (!trimmed) return;
    if (specific && specificTokens.length && trimmed !== poi.geocodeQuery) {
      if (!queryTextMatchesPoiTokens(trimmed, specificTokens)) return;
    }
    const key = normalizePoiText(trimmed);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(trimmed);
  };

  add(poi.geocodeQuery);
  for (const q of poi.alternateGeocodeQueries || []) add(q);
  for (const seed of getKnownPoiPollSeeds(poi, originalQuery)) {
    add(seed.geocodeQuery);
  }
  return out;
}

/** Varias consultas Nominatim para autocomplete de POIs (typos + alternativas + categoría). */
function buildPoiAutocompleteQueries(value) {
  const raw = String(value || '').trim();
  const norm = fixPoiTypoTokens(normalizePoiText(value));
  const queries = [];
  const seen = new Set();
  const add = (q) => {
    const text = String(q || '').trim();
    if (text.length < 3) return;
    const key = normalizePoiText(text);
    if (seen.has(key)) return;
    seen.add(key);
    queries.push(text);
  };

  add(raw);
  if (norm && norm !== normalizePoiText(raw)) {
    add(norm);
  }

  const known = resolveSaltaKnownPoi(value);
  if (known) {
    for (const q of getKnownPoiSearchQueries(known, value)) {
      add(q);
    }
  }

  if (/\bshopping\b/.test(norm) || /\bcentro\s+comercial\b/.test(norm)) {
    add('Portal Salta Shopping Salta');
    add('Alto NOA Shopping Salta');
    add('Paseo del Cabildo Salta');
    add('Galería Salta Shop Salta');
    add('Nuevo Centro Shopping Salta');
    add('El Punto Shopping San Lorenzo Salta');
    add('Paseo Libertad Salta');
    add('centro comercial Salta');
    add('shopping mall Salta');
  }
  if (/\bhospital\b/.test(norm)) {
    const hospitalSpecific = known && isSpecificNamedPoiQuery(value, known);
    if (hospitalSpecific) {
      add('Hospital San Bernardo José Tobias Salta');
      add('Hospital San Bernardo Boedo Salta');
      add('Sanatorio San Bernardo Salta');
    } else {
      add('Hospital San Bernardo Salta');
      add('Hospital Señor del Milagro Salta');
      add('Hospital Materno Infantil Salta');
      add('Hospital Papa Francisco Salta');
      add('Hospital Militar Salta');
    }
  }
  if (/\bmacro\b/.test(norm) || /\bbanco\s+macro\b/.test(norm)) {
    add('Banco Macro Belgrano Salta');
    add('Banco Macro España Salta');
    add('Banco Macro Mitre Salta');
  }
  if (/^(?:la\s+)?plaza$/.test(norm) || /\bplaza\s+principal\b/.test(norm)) {
    add('Plaza 9 de Julio Salta');
    add('Plaza 25 de Mayo Salta');
    add('Plaza Belgrano Salta');
    add('Plaza General Güemes Salta');
  }
  if (/\bhiper\s*libertad\b/.test(norm) || /\bhiperlibertad\b/.test(norm)) {
    add('Paseo Libertad Salta');
    add('Paseo Salta Rotonda Limache Salta');
  }
  if (/\bpaseo\s+salta\b/.test(norm) || /\bpaseo\s+libertad\b/.test(norm)) {
    add('Paseo Libertad Salta');
    add('Rotonda de Limache Salta');
  }
  if (/\banonima\b/.test(norm)) {
    add('Paseo Libertad Salta');
  }
  if (/\bterminal\b/.test(norm)) {
    add('terminal de omnibus Salta');
  }
  if (/\bunsa\b/.test(norm) || /\buniversidad\b/.test(norm)) {
    add('universidad Salta');
  }
  if (/\bestadio\b/.test(norm) || /\bmartearena\b/.test(norm)) {
    add('estadio Salta');
  }
  if (/\bmercado\b/.test(norm)) {
    add('mercado Salta');
  }
  if (/\bmuseo\b/.test(norm)) {
    add('museo Salta');
  }
  if (/\bbalcarce\b/.test(norm)) {
    add('Paseo Balcarce Salta');
  }
  if (/\bcerro\b/.test(norm) || /\btelef/.test(norm)) {
    add('Cerro San Bernardo Salta');
  }
  if (/\bparque\b/.test(norm)) {
    add('Parque San Martín Salta');
  }

  return queries;
}

function mergeDistinctAddressCandidates(base = [], extra = [], { maxResults = 6 } = {}) {
  const merged = [...(base || [])];
  const seen = new Set();

  for (const candidate of merged) {
    const key = String(candidate?.formattedAddress || candidate?.address || '')
      .toLowerCase()
      .trim();
    if (key) seen.add(key);
  }

  for (const candidate of extra || []) {
    const key = String(candidate?.formattedAddress || candidate?.address || '')
      .toLowerCase()
      .trim();
    if (!key || seen.has(key)) continue;

    const tooClose = merged.some((prev) => {
      const prevLat = Number(prev?.lat);
      const prevLng = Number(prev?.lng);
      const candLat = Number(candidate?.lat);
      const candLng = Number(candidate?.lng);
      if (![prevLat, prevLng, candLat, candLng].every(Number.isFinite)) return false;
      return Math.abs(prevLat - candLat) < 0.001 && Math.abs(prevLng - candLng) < 0.001;
    });
    if (tooClose) continue;

    seen.add(key);
    merged.push(candidate);
  }

  merged.sort((a, b) => Number(b?.score || 0) - Number(a?.score || 0));
  return merged.slice(0, maxResults);
}

module.exports = {
  resolveSaltaKnownPoi,
  resolveKnownPoiBranch,
  looksLikeSaltaKnownPoi,
  getKnownPoiSearchQueries,
  getKnownPoiPollSeeds,
  buildPoiAutocompleteQueries,
  isCategoryPoiSearch,
  isSpecificNamedPoiQuery,
  getPoiSpecificSearchTokens,
  normalizePoiText,
  fixPoiTypoTokens,
  mergeDistinctAddressCandidates,
};
