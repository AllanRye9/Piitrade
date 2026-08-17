'use client';

/**
 * FlagIcon — 100 % inline SVG flags. Zero network requests, zero emoji,
 * perfectly consistent on every OS / browser / screen size.
 *
 * Covers all countries used in Piitrade and falls back to a valid emoji flag
 * for any other ISO 3166-1 alpha-2 code so the UI never shows a blank placeholder.
 *
 * Usage:
 *   <FlagIcon code="AE" size={24} />
 *   <FlagIcon code="UG" size={32} className="rounded-sm" />
 */

interface FlagProps {
  /** ISO 3166-1 alpha-2 code, case-insensitive */
  code: string;
  /** Width in px. Height is auto (4:3 ratio). Defaults to 24. */
  size?: number;
  className?: string;
}

// ---------------------------------------------------------------------------
// Each flag is a self-contained SVG string rendered via dangerouslySetInnerHTML.
// Designs are simplified but recognisable; stripes/colours match official flags.
// ---------------------------------------------------------------------------
const COUNTRY_ALIASES: Record<string, string> = {
  UAE: 'AE', UNITEDARABEMIRATES: 'AE',
  UGANDA: 'UG',
  KENYA: 'KE',
  CHINA: 'CN',
  UNITEDSTATES: 'US', USA: 'US',
  UNITEDKINGDOM: 'GB', UK: 'GB',
  INDIA: 'IN',
  NEPAL: 'NP',
  BANGLADESH: 'BD',
  SOUTHAFRICA: 'ZA',
  NIGERIA: 'NG',
  GHANA: 'GH',
  TANZANIA: 'TZ',
  ETHIOPIA: 'ET',
  PAKISTAN: 'PK',
  RWANDA: 'RW',
  SOUTHSUDAN: 'SS',
  MEXICO: 'MX',
  BRAZIL: 'BR',
  GERMANY: 'DE',
  FRANCE: 'FR',
  ITALY: 'IT',
  SPAIN: 'ES',
  CANADA: 'CA',
  AUSTRALIA: 'AU',
  JAPAN: 'JP',
  SOUTHKOREA: 'KR',
  SAUDIARABIA: 'SA', SAUDI: 'SA',
  QATAR: 'QA',
  KUWAIT: 'KW',
  BAHRAIN: 'BH',
  OMAN: 'OM',
  PHILIPPINES: 'PH',
  INDONESIA: 'ID',
  MALAYSIA: 'MY',
  THAILAND: 'TH',
  VIETNAM: 'VN',
  SINGAPORE: 'SG',
  TURKEY: 'TR',
  BURKINAFASO: 'BF',
  MALI: 'ML',
  GABON: 'GA',
  CAMEROON: 'CM',
  // Previously missing — now mapped
  EGYPT: 'EG',
  JORDAN: 'JO',
  MOROCCO: 'MA',
  ISRAEL: 'IL',
  IRAQ: 'IQ',
  IRAN: 'IR',
  LEBANON: 'LB',
  SYRIA: 'SY',
  LIBYA: 'LY',
  ALGERIA: 'DZ',
  TUNISIA: 'TN',
  SUDAN: 'SD',
  ZAMBIA: 'ZM',
  ZIMBABWE: 'ZW',
  MALAWI: 'MW',
  MOZAMBIQUE: 'MZ',
  BOTSWANA: 'BW',
  NAMIBIA: 'NA',
  SENEGAL: 'SN',
  IVORYCOAST: 'CI', COTEDIVOIRE: 'CI',
  SIERRALEONE: 'SL',
  LIBERIA: 'LR',
  CAPEVERDE: 'CV',
  GAMBIA: 'GM',
  GUINEA: 'GN',
  GUINEA_BISSAU: 'GW',
  TOGO: 'TG',
  BENIN: 'BJ',
  NIGER: 'NE',
  CHAD: 'TD',
  CENTRALAFRICANREPUBLIC: 'CF',
  CONGO: 'CG', REPUBLICOFCONGO: 'CG',
  DRC: 'CD', DEMOCRATICREPUBLICOFCONGO: 'CD',
  ANGOLA: 'AO',
  BURUNDI: 'BI',
  DJIBOUTI: 'DJ',
  ERITREA: 'ER',
  SOMALIA: 'SO',
  COMOROS: 'KM',
  MAURITIUS: 'MU',
  SEYCHELLES: 'SC',
  MADAGASCAR: 'MG',
  LESOTHO: 'LS',
  SWAZILAND: 'SZ', ESWATINI: 'SZ',
  SRILANKA: 'LK',
  MALDIVES: 'MV',
  MYANMAR: 'MM', BURMA: 'MM',
  CAMBODIA: 'KH',
  LAOS: 'LA',
  HONGKONG: 'HK',
  TAIWAN: 'TW',
  NEWZEALAND: 'NZ',
  SWEDEN: 'SE',
  NORWAY: 'NO',
  DENMARK: 'DK',
  SWITZERLAND: 'CH',
  NETHERLANDS: 'NL', HOLLAND: 'NL',
  BELGIUM: 'BE',
  AUSTRIA: 'AT',
  PORTUGAL: 'PT',
  POLAND: 'PL',
  CZECHREPUBLIC: 'CZ',
  HUNGARY: 'HU',
  ROMANIA: 'RO',
  BULGARIA: 'BG',
  UKRAINE: 'UA',
  RUSSIA: 'RU',
  ARGENTINA: 'AR',
  CHILE: 'CL',
  COLOMBIA: 'CO',
  PERU: 'PE',
  VENEZUELA: 'VE',
  ECUADOR: 'EC',
  URUGUAY: 'UY',
  PARAGUAY: 'PY',
  BOLIVIA: 'BO',
};

const FLAGS: Record<string, (w: number, h: number) => string> = {
  // ── United Arab Emirates ─────────────────────────────────────────────────
  AE: (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
    <rect width="${w}" height="${h}" fill="#fff"/>
    <rect width="${w}" height="${h/3}" fill="#00732f"/>
    <rect y="${h*2/3}" width="${w}" height="${h/3}" fill="#000"/>
    <rect width="${w*0.25}" height="${h}" fill="#ef3340"/>
  </svg>`,

  // ── Uganda ────────────────────────────────────────────────────────────────
  UG: (w, h) => {
    const s = h / 6;
    const cx = w * 0.5, cy = h * 0.5, r = h * 0.17;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
      <rect width="${w}" height="${s}" y="0"       fill="#111"/>
      <rect width="${w}" height="${s}" y="${s}"     fill="#fcdc04"/>
      <rect width="${w}" height="${s}" y="${s*2}"   fill="#de3008"/>
      <rect width="${w}" height="${s}" y="${s*3}"   fill="#111"/>
      <rect width="${w}" height="${s}" y="${s*4}"   fill="#fcdc04"/>
      <rect width="${w}" height="${s}" y="${s*5}"   fill="#de3008"/>
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="#fff"/>
      <!-- Grey crowned crane (simplified) -->
      <circle cx="${cx}" cy="${cy-r*0.18}" r="${r*0.48}" fill="#808080"/>
      <ellipse cx="${cx}" cy="${cy+r*0.25}" rx="${r*0.28}" ry="${r*0.42}" fill="#808080"/>
      <circle cx="${cx}" cy="${cy-r*0.55}" r="${r*0.22}" fill="#de3008"/>
      <!-- crown spines -->
      <line x1="${cx}" y1="${cy-r*0.78}" x2="${cx-r*0.15}" y2="${cy-r*1.05}" stroke="#fcdc04" stroke-width="${r*0.07}"/>
      <line x1="${cx}" y1="${cy-r*0.78}" x2="${cx}"         y2="${cy-r*1.1}"  stroke="#fcdc04" stroke-width="${r*0.07}"/>
      <line x1="${cx}" y1="${cy-r*0.78}" x2="${cx+r*0.15}" y2="${cy-r*1.05}" stroke="#fcdc04" stroke-width="${r*0.07}"/>
    </svg>`;
  },

  // ── Kenya ─────────────────────────────────────────────────────────────────
  KE: (w, h) => {
    const cx = w * 0.5, cy = h * 0.5;
    const sh = h * 0.22;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
      <rect width="${w}" height="${h/3}"     fill="#006600"/>
      <rect y="${h/3}" width="${w}" height="${h/3}" fill="#de0000"/>
      <rect y="${h*2/3}" width="${w}" height="${h/3}" fill="#111"/>
      <rect y="${h/3-sh*0.45}" width="${w}" height="${sh*0.9}" fill="#fff"/>
      <!-- Maasai shield -->
      <ellipse cx="${cx}" cy="${cy}" rx="${w*0.09}" ry="${h*0.3}" fill="#de0000"/>
      <ellipse cx="${cx}" cy="${cy}" rx="${w*0.055}" ry="${h*0.18}" fill="#111"/>
      <ellipse cx="${cx}" cy="${cy}" rx="${w*0.03}" ry="${h*0.08}" fill="#fff"/>
      <!-- spears -->
      <line x1="${cx-w*0.12}" y1="${cy-h*0.38}" x2="${cx+w*0.12}" y2="${cy+h*0.38}" stroke="#c8a414" stroke-width="${w*0.025}"/>
      <line x1="${cx+w*0.12}" y1="${cy-h*0.38}" x2="${cx-w*0.12}" y2="${cy+h*0.38}" stroke="#c8a414" stroke-width="${w*0.025}"/>
    </svg>`;
  },

  // ── China ─────────────────────────────────────────────────────────────────
  CN: (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
    <rect width="${w}" height="${h}" fill="#de2910"/>
    <!-- large star -->
    <polygon fill="#ffde00" points="${star(w*0.17,h*0.3,h*0.14,5,Math.PI/2)}"/>
    <!-- 4 small stars -->
    ${[[-18,10],[0,22],[3,35],[8,44]].map(([dx,dy]) => {
      const sx = w*(0.38 + dx/100), sy = h*(0.12 + dy/100);
      const ang = Math.atan2(h*0.3-sy, w*0.17-sx) - Math.PI/2;
      return `<polygon fill="#ffde00" points="${star(sx,sy,h*0.048,5,ang)}"/>`;
    }).join('')}
  </svg>`,

  // ── United States ─────────────────────────────────────────────────────────
  US: (w, h) => {
    const sh = h / 13;
    const stripes = Array.from({length:13},(_,i) =>
      `<rect y="${i*sh}" width="${w}" height="${sh}" fill="${i%2===0?'#b22234':'#fff'}"/>`
    ).join('');
    // simplified canton — no individual stars
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
      ${stripes}
      <rect width="${w*0.4}" height="${h*7/13}" fill="#3c3b6e"/>
      <g fill="#fff" font-size="${h*0.06}" text-anchor="middle">
        ${[0,1,2,3,4].map(row =>
          [0,1,2,3,4,5].slice(0,(row%2===0?6:5)).map(col =>
            `<circle cx="${w*0.4*(col/(row%2===0?5:4)+1/10)}" cy="${h*7/13*(row/4+1/10)}" r="${h*0.022}"/>`
          ).join('')
        ).join('')}
      </g>
    </svg>`;
  },

  // ── United Kingdom ────────────────────────────────────────────────────────
  GB: (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
    <rect width="${w}" height="${h}" fill="#012169"/>
    <!-- white diagonals -->
    <line x1="0" y1="0" x2="${w}" y2="${h}" stroke="#fff" stroke-width="${h*0.19}"/>
    <line x1="${w}" y1="0" x2="0" y2="${h}" stroke="#fff" stroke-width="${h*0.19}"/>
    <!-- red diagonals -->
    <line x1="0" y1="0" x2="${w}" y2="${h}" stroke="#c8102e" stroke-width="${h*0.12}"/>
    <line x1="${w}" y1="0" x2="0" y2="${h}" stroke="#c8102e" stroke-width="${h*0.12}"/>
    <!-- white cross -->
    <rect x="${w*0.375}" width="${w*0.25}" height="${h}" fill="#fff"/>
    <rect y="${h*0.375}" width="${w}" height="${h*0.25}" fill="#fff"/>
    <!-- red cross -->
    <rect x="${w*0.417}" width="${w*0.166}" height="${h}" fill="#c8102e"/>
    <rect y="${h*0.417}" width="${w}" height="${h*0.166}" fill="#c8102e"/>
  </svg>`,

  // ── India ─────────────────────────────────────────────────────────────────
  IN: (w, h) => {
    const cx = w/2, cy = h/2, r = h*0.18;
    const spoke = Array.from({length:24},(_,i) => {
      const a = i * Math.PI*2/24;
      return `<line x1="${cx}" y1="${cy}" x2="${cx+r*Math.cos(a)}" y2="${cy+r*Math.sin(a)}" stroke="#000080" stroke-width="${r*0.06}"/>`;
    }).join('');
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
      <rect width="${w}" height="${h/3}"     fill="#ff9933"/>
      <rect y="${h/3}" width="${w}" height="${h/3}" fill="#fff"/>
      <rect y="${h*2/3}" width="${w}" height="${h/3}" fill="#128807"/>
      ${spoke}
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#000080" stroke-width="${r*0.12}"/>
      <circle cx="${cx}" cy="${cy}" r="${r*0.18}" fill="#000080"/>
    </svg>`;
  },

  // ── Nepal ─────────────────────────────────────────────────────────────────
  NP: (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
    <rect width="${w}" height="${h}" fill="#fff"/>
    <!-- pennant shape approximated as two triangles -->
    <polygon points="0,0 ${w*0.55},${h*0.55} 0,${h*0.55}" fill="#003893"/>
    <polygon points="0,${h*0.45} ${w*0.7},${h} 0,${h}" fill="#003893"/>
    <!-- crimson fill -->
    <polygon points="${w*0.04},0 ${w*0.5},${h*0.52} ${w*0.04},${h*0.52}" fill="#dc143c"/>
    <polygon points="${w*0.04},${h*0.48} ${w*0.64},${h*0.98} ${w*0.04},${h*0.98}" fill="#dc143c"/>
    <!-- simple moon + sun -->
    <circle cx="${w*0.2}" cy="${h*0.3}" r="${h*0.1}" fill="#fff"/>
    <circle cx="${w*0.26}" cy="${h*0.3}" r="${h*0.08}" fill="#dc143c"/>
    <circle cx="${w*0.19}" cy="${h*0.73}" r="${h*0.1}" fill="#fff"/>
  </svg>`,

  // ── European Union ────────────────────────────────────────────────────────
  EU: (w, h) => {
    const cx = w/2, cy = h/2, R = h*0.36;
    const stars = Array.from({length:12},(_,i) => {
      const a = i*Math.PI*2/12 - Math.PI/2;
      const sx = cx + R*Math.cos(a), sy = cy + R*Math.sin(a);
      return `<polygon fill="#fc0" points="${star(sx,sy,h*0.058,5,-Math.PI/2)}"/>`;
    }).join('');
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
      <rect width="${w}" height="${h}" fill="#003399"/>
      ${stars}
    </svg>`;
  },

  // ── Bangladesh ────────────────────────────────────────────────────────────
  BD: (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
    <rect width="${w}" height="${h}" fill="#006a4e"/>
    <circle cx="${w*0.45}" cy="${h*0.5}" r="${h*0.28}" fill="#f42a41"/>
  </svg>`,

  // ── South Africa ──────────────────────────────────────────────────────────
  ZA: (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
    <rect width="${w}" height="${h}" fill="#007a4d"/>
    <rect width="${w}" height="${h*0.33}" fill="#de3831"/>
    <rect y="${h*0.67}" width="${w}" height="${h*0.33}" fill="#002395"/>
    <!-- horizontal white band -->
    <rect y="${h*0.375}" width="${w}" height="${h*0.25}" fill="#fff"/>
    <!-- central gold band -->
    <rect y="${h*0.42}" width="${w}" height="${h*0.16}" fill="#ffb612"/>
    <!-- green chevron -->
    <polygon points="0,0 ${w*0.42},${h*0.5} 0,${h}" fill="#007a4d"/>
    <polygon points="${w*0.04},0 ${w*0.44},${h*0.5} ${w*0.04},${h}" fill="#000"/>
    <polygon points="${w*0.08},0 ${w*0.46},${h*0.5} ${w*0.08},${h}" fill="#fff"/>
    <polygon points="${w*0.13},0.5 ${w*0.48},${h*0.5} ${w*0.13},${h*0.97}" fill="#ffb612"/>
  </svg>`,

  // ── Nigeria ───────────────────────────────────────────────────────────────
  NG: (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
    <rect width="${w/3}" height="${h}" fill="#008751"/>
    <rect x="${w/3}" width="${w/3}" height="${h}" fill="#fff"/>
    <rect x="${w*2/3}" width="${w/3}" height="${h}" fill="#008751"/>
  </svg>`,

  // ── Ghana ─────────────────────────────────────────────────────────────────
  GH: (w, h) => {
    const cx = w/2, cy = h/2;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
      <rect width="${w}" height="${h/3}"     fill="#006b3f"/>
      <rect y="${h/3}" width="${w}" height="${h/3}" fill="#fcd116"/>
      <rect y="${h*2/3}" width="${w}" height="${h/3}" fill="#ce1126"/>
      <polygon fill="#000" points="${star(cx,cy,h*0.16,5,-Math.PI/2)}"/>
    </svg>`;
  },

  // ── Tanzania ──────────────────────────────────────────────────────────────
  TZ: (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
    <polygon points="0,0 ${w*0.55},0 0,${h*0.55}" fill="#1eb53a"/>
    <polygon points="${w},${h*0.45} ${w},${h} ${w*0.45},${h}" fill="#00a3dd"/>
    <polygon points="${w*0.6},0 ${w},0 ${w},${h*0.4}" fill="#00a3dd"/>
    <polygon points="0,${h*0.6} 0,${h} ${w*0.4},${h}" fill="#1eb53a"/>
    <!-- diagonal band -->
    <polygon points="${w*0.42},0 ${w*0.6},0 ${w},${h*0.57} ${w},${h*0.42} ${w*0.58},0" fill="#000"/>
    <polygon points="0,${h*0.4} 0,${h*0.58} ${w*0.57},${h} ${w*0.42},${h}" fill="#000"/>
    <polygon points="${w*0.47},0 ${w*0.55},0 ${w},${h*0.52} ${w},${h*0.47} ${w*0.55},0" fill="#ffd100"/>
    <polygon points="0,${h*0.46} 0,${h*0.53} ${w*0.52},${h} ${w*0.47},${h}" fill="#ffd100"/>
  </svg>`,

  // ── Ethiopia ──────────────────────────────────────────────────────────────
  ET: (w, h) => {
    const cx = w/2, cy = h/2;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
      <rect width="${w}" height="${h/3}"     fill="#078930"/>
      <rect y="${h/3}" width="${w}" height="${h/3}" fill="#fcdd09"/>
      <rect y="${h*2/3}" width="${w}" height="${h/3}" fill="#da121a"/>
      <circle cx="${cx}" cy="${cy}" r="${h*0.25}" fill="#0f47af"/>
      <polygon fill="#fcdd09" points="${star(cx,cy,h*0.15,5,-Math.PI/2)}"/>
    </svg>`;
  },

  // ── Pakistan ──────────────────────────────────────────────────────────────
  PK: (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
    <rect width="${w}" height="${h}" fill="#01411c"/>
    <rect width="${w*0.25}" height="${h}" fill="#fff"/>
    <circle cx="${w*0.62}" cy="${h*0.5}" r="${h*0.23}" fill="#01411c"/>
    <circle cx="${w*0.68}" cy="${h*0.5}" r="${h*0.19}" fill="#fff"/>
    <polygon fill="#fff" points="${star(w*0.77,h*0.38,h*0.09,5,-Math.PI/4)}"/>
  </svg>`,

  // ── Rwanda ────────────────────────────────────────────────────────────────
  RW: (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
    <rect width="${w}" height="${h*0.4}"     fill="#20603d"/>
    <rect y="${h*0.4}" width="${w}" height="${h*0.3}" fill="#fad201"/>
    <rect y="${h*0.7}" width="${w}" height="${h*0.3}" fill="#e5be01"/>
    <!-- sun in top right -->
    <circle cx="${w*0.82}" cy="${h*0.22}" r="${h*0.12}" fill="#e5be01"/>
    ${Array.from({length:8},(_,i) => {
      const a = i*Math.PI/4;
      return `<line x1="${w*0.82+h*0.12*Math.cos(a)}" y1="${h*0.22+h*0.12*Math.sin(a)}" x2="${w*0.82+h*0.19*Math.cos(a)}" y2="${h*0.22+h*0.19*Math.sin(a)}" stroke="#e5be01" stroke-width="${h*0.04}"/>`;
    }).join('')}
  </svg>`,

  // ── South Sudan ───────────────────────────────────────────────────────────
  SS: (w, h) => {
    const cx = w*0.22, cy = h*0.5;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
      <rect width="${w}" height="${h/3}"     fill="#078930"/>
      <rect y="${h/3}" width="${w}" height="${h/3}" fill="#fff"/>
      <rect y="${h*2/3}" width="${w}" height="${h/3}" fill="#da121a"/>
      <polygon points="0,0 ${w*0.44},${h*0.5} 0,${h}" fill="#078930"/>
      <polygon points="0,0 0,${h*0.04} ${w*0.4},${h*0.5} 0,${h*0.96} 0,${h} ${w*0.44},${h*0.5}" fill="#000"/>
      <polygon points="0,0 0,${h*0.06} ${w*0.38},${h*0.5} 0,${h*0.94} 0,${h} ${w*0.42},${h*0.5}" fill="#078930"/>
      <polygon fill="#fcdd09" points="${star(cx,cy,h*0.17,5,-Math.PI/2)}"/>
    </svg>`;
  },

  // ── Mexico ────────────────────────────────────────────────────────────────
  MX: (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
    <rect width="${w/3}" height="${h}" fill="#006847"/>
    <rect x="${w/3}" width="${w/3}" height="${h}" fill="#fff"/>
    <rect x="${w*2/3}" width="${w/3}" height="${h}" fill="#ce1126"/>
    <!-- coat of arms simplified as brown eagle -->
    <ellipse cx="${w*0.5}" cy="${h*0.5}" rx="${w*0.07}" ry="${h*0.12}" fill="#8b5e3c"/>
  </svg>`,

  // ── Brazil ────────────────────────────────────────────────────────────────
  BR: (w, h) => {
    const cx = w/2, cy = h/2;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
      <rect width="${w}" height="${h}" fill="#009c3b"/>
      <polygon points="${w*0.5},${h*0.07} ${w*0.94},${h*0.5} ${w*0.5},${h*0.93} ${w*0.06},${h*0.5}" fill="#fedf00"/>
      <circle cx="${cx}" cy="${cy}" r="${h*0.26}" fill="#002776"/>
      <path d="M${cx-h*0.24},${cy} a${h*0.24},${h*0.24} 0 0,1 ${h*0.48},0" fill="none" stroke="#fff" stroke-width="${h*0.065}"/>
    </svg>`;
  },

  // ── Germany ───────────────────────────────────────────────────────────────
  DE: (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
    <rect width="${w}" height="${h/3}"     fill="#000"/>
    <rect y="${h/3}" width="${w}" height="${h/3}" fill="#de0000"/>
    <rect y="${h*2/3}" width="${w}" height="${h/3}" fill="#ffce00"/>
  </svg>`,

  // ── France ────────────────────────────────────────────────────────────────
  FR: (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
    <rect width="${w/3}" height="${h}" fill="#002395"/>
    <rect x="${w/3}" width="${w/3}" height="${h}" fill="#fff"/>
    <rect x="${w*2/3}" width="${w/3}" height="${h}" fill="#ed2939"/>
  </svg>`,

  // ── Italy ─────────────────────────────────────────────────────────────────
  IT: (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
    <rect width="${w/3}" height="${h}" fill="#009246"/>
    <rect x="${w/3}" width="${w/3}" height="${h}" fill="#fff"/>
    <rect x="${w*2/3}" width="${w/3}" height="${h}" fill="#ce2b37"/>
  </svg>`,

  // ── Spain ─────────────────────────────────────────────────────────────────
  ES: (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
    <rect width="${w}" height="${h}"       fill="#c60b1e"/>
    <rect y="${h*0.25}" width="${w}" height="${h*0.5}" fill="#ffc400"/>
  </svg>`,

  // ── Canada ────────────────────────────────────────────────────────────────
  CA: (w, h) => {
    const cx = w/2, cy = h/2;
    // Simplified maple leaf
    const leaf = `M${cx},${cy-h*0.3} l${w*0.04},${h*0.12} l${w*0.1},${-h*0.06} l${-w*0.03},${h*0.1} l${w*0.08},${h*0.04} l${-w*0.1},${h*0.06} l${w*0.02},${h*0.08} l${-w*0.07},${-h*0.03} l${-w*0.04},${h*0.12} l${-w*0.04},${-h*0.12} l${-w*0.07},${h*0.03} l${w*0.02},${-h*0.08} l${-w*0.1},${-h*0.06} l${w*0.08},${-h*0.04} l${-w*0.03},${-h*0.1} l${w*0.1},${h*0.06} Z`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
      <rect width="${w}" height="${h}" fill="#fff"/>
      <rect width="${w*0.25}" height="${h}" fill="#ff0000"/>
      <rect x="${w*0.75}" width="${w*0.25}" height="${h}" fill="#ff0000"/>
      <path d="${leaf}" fill="#ff0000"/>
    </svg>`;
  },

  // ── Australia ─────────────────────────────────────────────────────────────
  AU: (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
    <rect width="${w}" height="${h}" fill="#00008b"/>
    <!-- Union Jack canton (simplified) -->
    <rect width="${w*0.5}" height="${h*0.5}" fill="#00008b"/>
    <line x1="0" y1="0" x2="${w*0.5}" y2="${h*0.5}" stroke="#fff" stroke-width="${h*0.1}"/>
    <line x1="${w*0.5}" y1="0" x2="0" y2="${h*0.5}" stroke="#fff" stroke-width="${h*0.1}"/>
    <line x1="0" y1="0" x2="${w*0.5}" y2="${h*0.5}" stroke="#cc0000" stroke-width="${h*0.06}"/>
    <line x1="${w*0.5}" y1="0" x2="0" y2="${h*0.5}" stroke="#cc0000" stroke-width="${h*0.06}"/>
    <rect width="${w*0.5}" height="${h*0.08}" y="${h*0.21}" fill="#fff"/>
    <rect x="${w*0.21}" width="${w*0.08}" height="${h*0.5}" fill="#fff"/>
    <rect width="${w*0.5}" height="${h*0.05}" y="${h*0.225}" fill="#cc0000"/>
    <rect x="${w*0.225}" width="${w*0.05}" height="${h*0.5}" fill="#cc0000"/>
    <!-- Southern Cross (5 stars) -->
    <polygon fill="#fff" points="${star(w*0.72,h*0.68,h*0.08,5,-Math.PI/2)}"/>
    <polygon fill="#fff" points="${star(w*0.88,h*0.48,h*0.08,5,-Math.PI/2)}"/>
    <polygon fill="#fff" points="${star(w*0.95,h*0.7,h*0.08,5,-Math.PI/2)}"/>
    <polygon fill="#fff" points="${star(w*0.83,h*0.88,h*0.08,5,-Math.PI/2)}"/>
    <polygon fill="#fff" points="${star(w*0.65,h*0.56,h*0.04,5,-Math.PI/2)}"/>
  </svg>`,

  // ── Japan ─────────────────────────────────────────────────────────────────
  JP: (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
    <rect width="${w}" height="${h}" fill="#fff"/>
    <circle cx="${w*0.5}" cy="${h*0.5}" r="${h*0.3}" fill="#bc002d"/>
  </svg>`,

  // ── South Korea ───────────────────────────────────────────────────────────
  KR: (w, h) => {
    const cx = w/2, cy = h/2, r = h*0.22;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
      <rect width="${w}" height="${h}" fill="#fff"/>
      <!-- Yin-yang circle -->
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="#003478"/>
      <path d="M${cx},${cy-r} a${r/2},${r/2} 0 0,1 0,${r} a${r/2},${r/2} 0 0,0 0,${r}" fill="#cd2e3a"/>
      <circle cx="${cx}" cy="${cy-r/2}" r="${r/4}" fill="#cd2e3a"/>
      <circle cx="${cx}" cy="${cy+r/2}" r="${r/4}" fill="#003478"/>
      <!-- Trigrams (simplified bars) -->
      ${[[-1,-1],[1,-1],[-1,1],[1,1]].map(([sx,sy],i) => {
        const tx = cx + sx*w*0.33, ty = cy + sy*h*0.33;
        const rot = [0,45,-45,90][i];
        return `<g transform="translate(${tx},${ty}) rotate(${rot})">
          <rect x="${-h*0.1}" y="${-h*0.07}" width="${h*0.2}" height="${h*0.035}" fill="#000"/>
          <rect x="${-h*0.1}" y="${-h*0.02}" width="${h*0.08}" height="${h*0.035}" fill="#000"/>
          <rect x="${h*0.02}" y="${-h*0.02}" width="${h*0.08}" height="${h*0.035}" fill="#000"/>
          <rect x="${-h*0.1}" y="${h*0.03}"  width="${h*0.2}" height="${h*0.035}" fill="#000"/>
        </g>`;
      }).join('')}
    </svg>`;
  },

  // ── Saudi Arabia ──────────────────────────────────────────────────────────
  SA: (w, h) => {
    const cx = w * 0.52, cy = h * 0.42, outerR = h * 0.22, innerR = h * 0.16;
    // Crescent: a circle with a bite taken out of it
    const swordY = h * 0.68, swordW = w * 0.54, swordH = h * 0.055;
    const swordX = w * 0.23;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
      <rect width="${w}" height="${h}" fill="#006c35"/>
      <!-- Crescent moon (white) -->
      <circle cx="${cx}" cy="${cy}" r="${outerR}" fill="#fff"/>
      <circle cx="${cx + outerR * 0.35}" cy="${cy}" r="${innerR}" fill="#006c35"/>
      <!-- Sword blade -->
      <rect x="${swordX}" y="${swordY}" width="${swordW}" height="${swordH}" rx="${swordH * 0.4}" fill="#fff"/>
      <!-- Sword handle crossguard -->
      <rect x="${swordX + swordW - swordH}" y="${swordY - swordH}" width="${swordH}" height="${swordH * 3}" rx="${swordH * 0.3}" fill="#fff"/>
      <!-- Sword pommel -->
      <circle cx="${swordX}" cy="${swordY + swordH * 0.5}" r="${swordH * 0.7}" fill="#fff"/>
    </svg>`;
  },

  // ── Qatar ─────────────────────────────────────────────────────────────────
  QA: (w, h) => {
    const points = Array.from({length:9},(_,i) => {
      const y = i * h/8;
      return i % 2 === 0 ? `${w*0.38},${y}` : `${w*0.28},${y}`;
    }).join(' ') + ` ${w*0.38},${h} 0,${h} 0,0`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
      <rect width="${w}" height="${h}" fill="#8d1b3d"/>
      <polygon points="${points}" fill="#fff"/>
    </svg>`;
  },

  // ── Kuwait ────────────────────────────────────────────────────────────────
  KW: (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
    <rect width="${w}" height="${h/3}"     fill="#007a3d"/>
    <rect y="${h/3}" width="${w}" height="${h/3}" fill="#fff"/>
    <rect y="${h*2/3}" width="${w}" height="${h/3}" fill="#ce1126"/>
    <polygon points="0,0 ${w*0.27},${h*0.5} 0,${h}" fill="#000"/>
  </svg>`,

  // ── Bahrain ───────────────────────────────────────────────────────────────
  BH: (w, h) => {
    const points = Array.from({length:6},(_,i) => {
      const y = i * h/5;
      return i % 2 === 0 ? `${w*0.38},${y}` : `${w*0.28},${y}`;
    }).join(' ') + ` ${w*0.38},${h} 0,${h} 0,0`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
      <rect width="${w}" height="${h}" fill="#ce1126"/>
      <polygon points="${points}" fill="#fff"/>
    </svg>`;
  },

  // ── Oman ──────────────────────────────────────────────────────────────────
  OM: (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
    <rect width="${w}" height="${h/3}"     fill="#fff"/>
    <rect y="${h/3}" width="${w}" height="${h/3}" fill="#db161b"/>
    <rect y="${h*2/3}" width="${w}" height="${h/3}" fill="#008000"/>
    <rect width="${w*0.26}" height="${h}" fill="#db161b"/>
  </svg>`,

  // ── Philippines ───────────────────────────────────────────────────────────
  PH: (w, h) => {
    const cx = w*0.22, cy = h/2;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
      <rect width="${w}" height="${h/2}"   fill="#0038a8"/>
      <rect y="${h/2}" width="${w}" height="${h/2}" fill="#ce1126"/>
      <polygon points="0,0 ${w*0.44},${h*0.5} 0,${h}" fill="#fff"/>
      <circle cx="${cx}" cy="${cy}" r="${h*0.12}" fill="#fcd116"/>
      ${[0,1,2].map(i => {
        const a = i*Math.PI*2/3 - Math.PI/2;
        const sx = cx + h*0.22*Math.cos(a), sy = cy + h*0.22*Math.sin(a);
        return `<polygon fill="#fcd116" points="${star(sx,sy,h*0.06,5,a)}"/>`;
      }).join('')}
    </svg>`;
  },

  // ── Indonesia ─────────────────────────────────────────────────────────────
  ID: (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
    <rect width="${w}" height="${h/2}"   fill="#ce1126"/>
    <rect y="${h/2}" width="${w}" height="${h/2}" fill="#fff"/>
  </svg>`,

  // ── Malaysia ──────────────────────────────────────────────────────────────
  MY: (w, h) => {
    const stripes = Array.from({length:14},(_,i) =>
      `<rect y="${i*h/14}" width="${w}" height="${h/14}" fill="${i%2===0?'#cc0001':'#fff'}"/>`
    ).join('');
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
      ${stripes}
      <rect width="${w*0.5}" height="${h*0.5}" fill="#010066"/>
      <circle cx="${w*0.21}" cy="${h*0.26}" r="${h*0.16}" fill="#fc0"/>
      <circle cx="${w*0.27}" cy="${h*0.26}" r="${h*0.14}" fill="#010066"/>
      <polygon fill="#fc0" points="${star(w*0.36,h*0.26,h*0.09,14,-Math.PI/2)}"/>
    </svg>`;
  },

  // ── Thailand ──────────────────────────────────────────────────────────────
  TH: (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
    <rect width="${w}" height="${h}"         fill="#a51931"/>
    <rect y="${h/6}"   width="${w}" height="${h*4/6}" fill="#f4f5f8"/>
    <rect y="${h*2/6}" width="${w}" height="${h*2/6}" fill="#2d2a4a"/>
  </svg>`,

  // ── Vietnam ───────────────────────────────────────────────────────────────
  VN: (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
    <rect width="${w}" height="${h}" fill="#da251d"/>
    <polygon fill="#ffcd00" points="${star(w/2,h/2,h*0.28,5,-Math.PI/2)}"/>
  </svg>`,

  // ── Singapore ─────────────────────────────────────────────────────────────
  SG: (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
    <rect width="${w}" height="${h/2}"   fill="#ef3340"/>
    <rect y="${h/2}" width="${w}" height="${h/2}" fill="#fff"/>
    <circle cx="${w*0.22}" cy="${h*0.5}" r="${h*0.18}" fill="#fff"/>
    <circle cx="${w*0.28}" cy="${h*0.5}" r="${h*0.15}" fill="#ef3340"/>
    ${[0,1,2,3,4].map(i => {
      const a = i*Math.PI*2/5 - Math.PI/2;
      return `<circle cx="${w*0.38+h*0.1*Math.cos(a)}" cy="${h*0.5+h*0.1*Math.sin(a)}" r="${h*0.033}" fill="#fff"/>`;
    }).join('')}
  </svg>`,

  // ── Turkey ────────────────────────────────────────────────────────────────
  TR: (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
    <rect width="${w}" height="${h}" fill="#e30a17"/>
    <circle cx="${w*0.39}" cy="${h*0.5}" r="${h*0.28}" fill="#fff"/>
    <circle cx="${w*0.46}" cy="${h*0.5}" r="${h*0.22}" fill="#e30a17"/>
    <polygon fill="#fff" points="${star(w*0.62,h*0.5,h*0.12,5,-Math.PI/6)}"/>
  </svg>`,

  // ── Burkina Faso ──────────────────────────────────────────────────────────
  BF: (w, h) => {
    const cx = w / 2, cy = h / 2;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
      <rect width="${w}" height="${h/2}"     fill="#ef2b2d"/>
      <rect y="${h/2}" width="${w}" height="${h/2}" fill="#009e49"/>
      <polygon fill="#fcd116" points="${star(cx,cy,h*0.22,5,-Math.PI/2)}"/>
    </svg>`;
  },

  // ── Mali ──────────────────────────────────────────────────────────────────
  ML: (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
    <rect width="${w/3}" height="${h}" fill="#14b53a"/>
    <rect x="${w/3}" width="${w/3}" height="${h}" fill="#fcd116"/>
    <rect x="${w*2/3}" width="${w/3}" height="${h}" fill="#ce1126"/>
  </svg>`,

  // ── Gabon ─────────────────────────────────────────────────────────────────
  GA: (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
    <rect width="${w}" height="${h/3}"     fill="#009e60"/>
    <rect y="${h/3}" width="${w}" height="${h/3}" fill="#fcd116"/>
    <rect y="${h*2/3}" width="${w}" height="${h/3}" fill="#3a75c4"/>
  </svg>`,

  // ── Egypt ─────────────────────────────────────────────────────────────────
  EG: (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
    <rect width="${w}" height="${h/3}"     fill="#ce1126"/>
    <rect y="${h/3}" width="${w}" height="${h/3}" fill="#fff"/>
    <rect y="${h*2/3}" width="${w}" height="${h/3}" fill="#000"/>
    <!-- Eagle of Saladin (gold ellipse) -->
    <ellipse cx="${w*0.5}" cy="${h*0.5}" rx="${w*0.11}" ry="${h*0.16}" fill="#c09300"/>
  </svg>`,

  // ── Morocco ───────────────────────────────────────────────────────────────
  MA: (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
    <rect width="${w}" height="${h}" fill="#c1272d"/>
    <polygon fill="none" stroke="#006233" stroke-width="${h*0.03}"
      points="${star(w/2,h/2,h*0.22,5,-Math.PI/2)}"/>
  </svg>`,

  // ── Jordan ────────────────────────────────────────────────────────────────
  JO: (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
    <rect width="${w}" height="${h/3}"     fill="#007a3d"/>
    <rect y="${h/3}" width="${w}" height="${h/3}" fill="#fff"/>
    <rect y="${h*2/3}" width="${w}" height="${h/3}" fill="#000"/>
    <polygon points="0,0 ${w*0.38},${h*0.5} 0,${h}" fill="#c8102e"/>
    <circle cx="${w*0.17}" cy="${h*0.5}" r="${h*0.1}" fill="#fff"/>
    <polygon fill="#fff" points="${star(w*0.17,h*0.5,h*0.07,7,-Math.PI/2)}"/>
  </svg>`,

  // ── Israel ────────────────────────────────────────────────────────────────
  IL: (w, h) => {
    const cx = w/2, cy = h/2, tri = h*0.24;
    // Star of David = two overlapping triangles
    const t1 = `${cx},${cy-tri} ${cx-tri*0.866},${cy+tri*0.5} ${cx+tri*0.866},${cy+tri*0.5}`;
    const t2 = `${cx},${cy+tri} ${cx-tri*0.866},${cy-tri*0.5} ${cx+tri*0.866},${cy-tri*0.5}`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
      <rect width="${w}" height="${h}" fill="#fff"/>
      <rect y="${h*0.13}" width="${w}" height="${h*0.11}" fill="#0038b8"/>
      <rect y="${h*0.76}" width="${w}" height="${h*0.11}" fill="#0038b8"/>
      <polygon fill="none" stroke="#0038b8" stroke-width="${h*0.04}" points="${t1}"/>
      <polygon fill="none" stroke="#0038b8" stroke-width="${h*0.04}" points="${t2}"/>
    </svg>`;
  },

  // ── Iraq ──────────────────────────────────────────────────────────────────
  IQ: (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
    <rect width="${w}" height="${h/3}"     fill="#ce1126"/>
    <rect y="${h/3}" width="${w}" height="${h/3}" fill="#fff"/>
    <rect y="${h*2/3}" width="${w}" height="${h/3}" fill="#000"/>
    <!-- Takbir in green (simplified as rect) -->
    <rect x="${w*0.3}" y="${h*0.38}" width="${w*0.4}" height="${h*0.24}" fill="#007a3d" rx="${h*0.03}"/>
  </svg>`,

  // ── Iran ──────────────────────────────────────────────────────────────────
  IR: (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
    <rect width="${w}" height="${h/3}"     fill="#239f40"/>
    <rect y="${h/3}" width="${w}" height="${h/3}" fill="#fff"/>
    <rect y="${h*2/3}" width="${w}" height="${h/3}" fill="#da0000"/>
    <!-- tulip emblem (simplified) -->
    <circle cx="${w*0.5}" cy="${h*0.5}" r="${h*0.12}" fill="#da0000"/>
    <rect x="${w*0.48}" y="${h*0.38}" width="${w*0.04}" height="${h*0.24}" fill="#239f40"/>
  </svg>`,

  // ── Lebanon ───────────────────────────────────────────────────────────────
  LB: (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
    <rect width="${w}" height="${h}"         fill="#fff"/>
    <rect width="${w}" height="${h*0.25}"    fill="#ee161f"/>
    <rect y="${h*0.75}" width="${w}" height="${h*0.25}" fill="#ee161f"/>
    <!-- Cedar tree (green triangle) -->
    <polygon points="${w*0.5},${h*0.25} ${w*0.3},${h*0.75} ${w*0.7},${h*0.75}" fill="#009a44"/>
    <rect x="${w*0.46}" y="${h*0.62}" width="${w*0.08}" height="${h*0.13}" fill="#6b4a1b"/>
  </svg>`,

  // ── Algeria ───────────────────────────────────────────────────────────────
  DZ: (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
    <rect width="${w/2}" height="${h}" fill="#006233"/>
    <rect x="${w/2}" width="${w/2}" height="${h}" fill="#fff"/>
    <circle cx="${w*0.56}" cy="${h*0.5}" r="${h*0.22}\" fill="#d21034"/>
    <circle cx="${w*0.63}" cy="${h*0.5}" r="${h*0.18}\" fill="#fff"/>
    <polygon fill="#d21034" points="${star(w*0.67,h*0.39,h*0.08,5,Math.PI/6)}"/>
  </svg>`,

  // ── Tunisia ───────────────────────────────────────────────────────────────
  TN: (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
    <rect width="${w}" height="${h}" fill="#e70013"/>
    <circle cx="${w*0.5}" cy="${h*0.5}" r="${h*0.28}" fill="#fff"/>
    <circle cx="${w*0.5}" cy="${h*0.5}" r="${h*0.22}" fill="#e70013"/>
    <circle cx="${w*0.54}" cy="${h*0.5}" r="${h*0.18}" fill="#fff"/>
    <polygon fill="#e70013" points="${star(w*0.6,h*0.4,h*0.08,5,-Math.PI/4)}"/>
  </svg>`,

  // ── Libya ─────────────────────────────────────────────────────────────────
  LY: (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
    <rect width="${w}" height="${h*0.25}"     fill="#000"/>
    <rect y="${h*0.25}" width="${w}" height="${h*0.5}" fill="#239e46"/>
    <rect y="${h*0.75}" width="${w}" height="${h*0.25}" fill="#000"/>
    <!-- white crescent + star -->
    <circle cx="${w*0.5}" cy="${h*0.5}" r="${h*0.18}" fill="#fff"/>
    <circle cx="${w*0.55}" cy="${h*0.5}" r="${h*0.14}" fill="#239e46"/>
    <polygon fill="#fff" points="${star(w*0.62,h*0.38,h*0.06,5,-Math.PI/4)}"/>
  </svg>`,

  // ── Sudan ─────────────────────────────────────────────────────────────────
  SD: (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
    <rect width="${w}" height="${h/3}"     fill="#d21034"/>
    <rect y="${h/3}" width="${w}" height="${h/3}" fill="#fff"/>
    <rect y="${h*2/3}" width="${w}" height="${h/3}" fill="#000"/>
    <polygon points="0,0 ${w*0.38},${h*0.5} 0,${h}" fill="#007229"/>
  </svg>`,

  // ── Zambia ────────────────────────────────────────────────────────────────
  ZM: (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
    <rect width="${w}" height="${h}" fill="#198a00"/>
    <rect x="${w*0.66}" width="${w*0.115}" height="${h}" fill="#de2010"/>
    <rect x="${w*0.775}" width="${w*0.115}" height="${h}" fill="#000"/>
    <rect x="${w*0.885}" width="${w*0.115}" height="${h}" fill="#e97c00"/>
    <!-- eagle (simplified) -->
    <polygon fill="#e97c00" points="${w*0.84},${h*0.08} ${w*0.76},${h*0.22} ${w*0.92},${h*0.22}"/>
  </svg>`,

  // ── Zimbabwe ──────────────────────────────────────────────────────────────
  ZW: (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
    ${[['#006400',0],['#ffd200',h/7],['#de2010',h*2/7],['#000',h*3/7],['#de2010',h*4/7],['#ffd200',h*5/7],['#006400',h*6/7]].map(([c,y]) =>
      `<rect y="${y}" width="${w}" height="${h/7}" fill="${c}"/>`).join('')}
    <polygon points="0,0 ${w*0.4},${h*0.5} 0,${h}" fill="#fff"/>
    <polygon points="${w*0.04},0 ${w*0.38},${h*0.5} ${w*0.04},${h}" fill="#de2010"/>
    <polygon fill="#ffd200" points="${star(w*0.18,h*0.5,h*0.14,5,-Math.PI/2)}"/>
  </svg>`,

  // ── Senegal ───────────────────────────────────────────────────────────────
  SN: (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
    <rect width="${w/3}" height="${h}" fill="#00853f"/>
    <rect x="${w/3}" width="${w/3}" height="${h}" fill="#fdef42"/>
    <rect x="${w*2/3}" width="${w/3}" height="${h}" fill="#e31b23"/>
    <polygon fill="#00853f" points="${star(w*0.5,h*0.5,h*0.16,5,-Math.PI/2)}"/>
  </svg>`,

  // ── Sweden ────────────────────────────────────────────────────────────────
  SE: (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
    <rect width="${w}" height="${h}" fill="#006aa7"/>
    <rect x="${w*0.3}" width="${w*0.12}" height="${h}" fill="#fecc00"/>
    <rect y="${h*0.38}" width="${w}" height="${h*0.24}" fill="#fecc00"/>
  </svg>`,

  // ── Norway ────────────────────────────────────────────────────────────────
  NO: (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
    <rect width="${w}" height="${h}" fill="#ef2b2d"/>
    <rect x="${w*0.28}" width="${w*0.12}" height="${h}" fill="#fff"/>
    <rect y="${h*0.38}" width="${w}" height="${h*0.24}" fill="#fff"/>
    <rect x="${w*0.31}" width="${w*0.06}" height="${h}" fill="#002868"/>
    <rect y="${h*0.41}" width="${w}" height="${h*0.18}" fill="#002868"/>
  </svg>`,

  // ── Denmark ───────────────────────────────────────────────────────────────
  DK: (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
    <rect width="${w}" height="${h}" fill="#c60c30"/>
    <rect x="${w*0.3}" width="${w*0.12}" height="${h}" fill="#fff"/>
    <rect y="${h*0.38}" width="${w}" height="${h*0.24}" fill="#fff"/>
  </svg>`,

  // ── Switzerland ───────────────────────────────────────────────────────────
  CH: (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
    <rect width="${w}" height="${h}" fill="#ff0000"/>
    <rect x="${w*0.38}" y="${h*0.2}" width="${w*0.24}" height="${h*0.6}" fill="#fff"/>
    <rect x="${w*0.2}" y="${h*0.38}" width="${w*0.6}" height="${h*0.24}" fill="#fff"/>
  </svg>`,

  // ── Netherlands ───────────────────────────────────────────────────────────
  NL: (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
    <rect width="${w}" height="${h/3}"     fill="#ae1c28"/>
    <rect y="${h/3}" width="${w}" height="${h/3}" fill="#fff"/>
    <rect y="${h*2/3}" width="${w}" height="${h/3}" fill="#21468b"/>
  </svg>`,

  // ── Belgium ───────────────────────────────────────────────────────────────
  BE: (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
    <rect width="${w/3}" height="${h}" fill="#000"/>
    <rect x="${w/3}" width="${w/3}" height="${h}" fill="#ffd90c"/>
    <rect x="${w*2/3}" width="${w/3}" height="${h}" fill="#ef3340"/>
  </svg>`,

  // ── Poland ────────────────────────────────────────────────────────────────
  PL: (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
    <rect width="${w}" height="${h/2}"   fill="#fff"/>
    <rect y="${h/2}" width="${w}" height="${h/2}" fill="#dc143c"/>
  </svg>`,

  // ── Ukraine ───────────────────────────────────────────────────────────────
  UA: (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
    <rect width="${w}" height="${h/2}"   fill="#005bbb"/>
    <rect y="${h/2}" width="${w}" height="${h/2}" fill="#ffd500"/>
  </svg>`,

  // ── Russia ────────────────────────────────────────────────────────────────
  RU: (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
    <rect width="${w}" height="${h/3}"     fill="#fff"/>
    <rect y="${h/3}" width="${w}" height="${h/3}" fill="#0039a6"/>
    <rect y="${h*2/3}" width="${w}" height="${h/3}" fill="#d52b1e"/>
  </svg>`,

  // ── Argentina ─────────────────────────────────────────────────────────────
  AR: (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
    <rect width="${w}" height="${h/3}"     fill="#74acdf"/>
    <rect y="${h/3}" width="${w}" height="${h/3}" fill="#fff"/>
    <rect y="${h*2/3}" width="${w}" height="${h/3}" fill="#74acdf"/>
    <!-- sun rays (simplified) -->
    <circle cx="${w*0.5}" cy="${h*0.5}" r="${h*0.13}" fill="#f6b40e"/>
  </svg>`,

  // ── Chile ─────────────────────────────────────────────────────────────────
  CL: (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
    <rect width="${w}" height="${h/2}"   fill="#fff"/>
    <rect y="${h/2}" width="${w}" height="${h/2}" fill="#d52b1e"/>
    <rect width="${w*0.33}" height="${h/2}" fill="#002d62"/>
    <polygon fill="#fff" points="${star(w*0.165,h*0.25,h*0.13,5,-Math.PI/2)}"/>
  </svg>`,

  // ── Colombia ──────────────────────────────────────────────────────────────
  CO: (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
    <rect width="${w}" height="${h*0.4}"  fill="#fcd116"/>
    <rect y="${h*0.4}" width="${w}" height="${h*0.3}" fill="#003087"/>
    <rect y="${h*0.7}" width="${w}" height="${h*0.3}" fill="#ce1126"/>
  </svg>`,

  // ── Sri Lanka ─────────────────────────────────────────────────────────────
  LK: (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
    <rect width="${w}" height="${h}" fill="#8d153a"/>
    <rect width="${w*0.17}" height="${h}" fill="#e9b636"/>
    <rect x="${w*0.17}" width="${w*0.08}" height="${h}" fill="#f36f21"/>
    <rect x="${w*0.25}" width="${w*0.08}" height="${h}" fill="#006a4e"/>
    <rect x="${w*0.33}" width="${w*0.6}" height="${h}" fill="#8d153a" rx="${h*0.04}"/>
    <rect x="${w*0.36}" y="${h*0.1}" width="${w*0.54}" height="${h*0.8}" fill="#ffc832" rx="${h*0.04}"/>
    <rect x="${w*0.42}" y="${h*0.2}" width="${w*0.42}" height="${h*0.6}" fill="#8d153a" rx="${h*0.03}"/>
  </svg>`,

  // ── New Zealand ───────────────────────────────────────────────────────────
  NZ: (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
    <rect width="${w}" height="${h}" fill="#00247d"/>
    <rect width="${w*0.5}" height="${h*0.5}" fill="#00247d"/>
    <line x1="0" y1="0" x2="${w*0.5}" y2="${h*0.5}" stroke="#fff" stroke-width="${h*0.1}"/>
    <line x1="${w*0.5}" y1="0" x2="0" y2="${h*0.5}" stroke="#fff" stroke-width="${h*0.1}"/>
    <line x1="0" y1="0" x2="${w*0.5}" y2="${h*0.5}" stroke="#cc0000" stroke-width="${h*0.06}"/>
    <line x1="${w*0.5}" y1="0" x2="0" y2="${h*0.5}" stroke="#cc0000" stroke-width="${h*0.06}"/>
    <rect x="${w*0.21}" width="${w*0.08}" height="${h*0.5}" fill="#fff"/>
    <rect y="${h*0.21}" width="${w*0.5}" height="${h*0.08}" fill="#fff"/>
    <rect x="${w*0.225}" width="${w*0.05}" height="${h*0.5}" fill="#cc0000"/>
    <rect y="${h*0.225}" width="${w*0.5}" height="${h*0.05}" fill="#cc0000"/>
    <!-- Southern Cross (4 stars) -->
    <polygon fill="#cc0000" stroke="#fff" stroke-width="${h*0.01}" points="${star(w*0.72,h*0.22,h*0.09,4,-Math.PI/4)}"/>
    <polygon fill="#cc0000" stroke="#fff" stroke-width="${h*0.01}" points="${star(w*0.9,h*0.35,h*0.07,4,-Math.PI/4)}"/>
    <polygon fill="#cc0000" stroke="#fff" stroke-width="${h*0.01}" points="${star(w*0.78,h*0.62,h*0.09,4,-Math.PI/4)}"/>
    <polygon fill="#cc0000" stroke="#fff" stroke-width="${h*0.01}" points="${star(w*0.62,h*0.48,h*0.07,4,-Math.PI/4)}"/>
  </svg>`,

  // ── Peru ──────────────────────────────────────────────────────────────────
  PE: (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
    <rect width="${w/3}" height="${h}" fill="#d91023"/>
    <rect x="${w/3}" width="${w/3}" height="${h}" fill="#fff"/>
    <rect x="${w*2/3}" width="${w/3}" height="${h}" fill="#d91023"/>
  </svg>`,

  // ── Ivory Coast ───────────────────────────────────────────────────────────
  CI: (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
    <rect width="${w/3}" height="${h}" fill="#f77f00"/>
    <rect x="${w/3}" width="${w/3}" height="${h}" fill="#fff"/>
    <rect x="${w*2/3}" width="${w/3}" height="${h}" fill="#009a44"/>
  </svg>`,

  // ── Togo ──────────────────────────────────────────────────────────────────
  TG: (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
    ${[[0,'#006a4e'],[h/5,'#ffce00'],[h*2/5,'#006a4e'],[h*3/5,'#ffce00'],[h*4/5,'#006a4e']].map(([y,c])=>
      `<rect y="${y}" width="${w}" height="${h/5}" fill="${c}"/>`).join('')}
    <rect width="${w*0.34}" height="${h*0.4}" fill="#d21034"/>
    <polygon fill="#fff" points="${star(w*0.17,h*0.2,h*0.12,5,-Math.PI/2)}"/>
  </svg>`,

  // ── Angola ────────────────────────────────────────────────────────────────
  AO: (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
    <rect width="${w}" height="${h/2}"   fill="#cc0000"/>
    <rect y="${h/2}" width="${w}" height="${h/2}" fill="#000"/>
    <!-- gear + machete emblem (simplified) -->
    <circle cx="${w*0.5}" cy="${h*0.5}" r="${h*0.15}" fill="none" stroke="#ffd700" stroke-width="${h*0.05}"/>
    <line x1="${w*0.35}" y1="${h*0.38}" x2="${w*0.65}" y2="${h*0.62}" stroke="#ffd700" stroke-width="${h*0.05}"/>
    <polygon fill="#ffd700" points="${star(w*0.5,h*0.36,h*0.07,5,-Math.PI/2)}"/>
  </svg>`,

  // ── Democratic Republic of Congo ──────────────────────────────────────────
  CD: (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
    <rect width="${w}" height="${h}" fill="#007fff"/>
    <line x1="0" y1="${h}" x2="${w}" y2="0" stroke="#f7d618" stroke-width="${h*0.14}"/>
    <line x1="0" y1="${h}" x2="${w}" y2="0" stroke="#ce1021" stroke-width="${h*0.07}"/>
    <polygon fill="#f7d618" points="${star(w*0.1,h*0.1,h*0.13,5,-Math.PI/2)}"/>
  </svg>`,

  // ── Mozambique ────────────────────────────────────────────────────────────
  MZ: (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
    <rect width="${w}" height="${h/3}"     fill="#009a44"/>
    <rect y="${h/3}" width="${w}" height="${h/3}" fill="#fff"/>
    <rect y="${h*2/3}" width="${w}" height="${h/3}" fill="#fce100"/>
    <rect y="${h*0.44}" width="${w}" height="${h*0.12}" fill="#000"/>
    <polygon points="0,0 ${w*0.36},${h*0.5} 0,${h}" fill="#d21034"/>
    <polygon fill="#fff" points="${star(w*0.14,h*0.5,h*0.16,5,-Math.PI/2)}"/>
    <polygon fill="#fce100" points="${star(w*0.14,h*0.5,h*0.09,5,-Math.PI/2)}"/>
  </svg>`,

  // ── Botswana ──────────────────────────────────────────────────────────────
  BW: (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
    <rect width="${w}" height="${h*0.38}"  fill="#75aadb"/>
    <rect y="${h*0.38}" width="${w}" height="${h*0.24}" fill="#fff"/>
    <rect y="${h*0.41}" width="${w}" height="${h*0.18}" fill="#000"/>
    <rect y="${h*0.62}" width="${w}" height="${h*0.38}" fill="#75aadb"/>
  </svg>`,

  // ── Burundi ───────────────────────────────────────────────────────────────
  BI: (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
    <polygon points="0,0 ${w*0.5},${h*0.5} 0,${h}" fill="#ce1126"/>
    <polygon points="${w},0 ${w*0.5},${h*0.5} ${w},${h}" fill="#ce1126"/>
    <polygon points="0,0 ${w*0.5},${h*0.5} ${w},0" fill="#1eb53a"/>
    <polygon points="0,${h} ${w*0.5},${h*0.5} ${w},${h}" fill="#1eb53a"/>
    <circle cx="${w*0.5}" cy="${h*0.5}" r="${h*0.22}" fill="#fff"/>
    ${[0,1,2].map(i => { const a = i*2*Math.PI/3 - Math.PI/6; return `<polygon fill="#ce1126" points="${star(w*0.5+h*0.12*Math.cos(a),h*0.5+h*0.12*Math.sin(a),h*0.06,6,0)}"/>`; }).join('')}
  </svg>`,

  // ── Djibouti ──────────────────────────────────────────────────────────────
  DJ: (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
    <rect width="${w}" height="${h/2}"   fill="#6ab2e7"/>
    <rect y="${h/2}" width="${w}" height="${h/2}" fill="#12ad2b"/>
    <polygon points="0,0 ${w*0.4},${h*0.5} 0,${h}" fill="#fff"/>
    <polygon fill="#d7141a" points="${star(w*0.15,h*0.5,h*0.14,5,-Math.PI/2)}"/>
  </svg>`,

  // ── Somalia ───────────────────────────────────────────────────────────────
  SO: (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
    <rect width="${w}" height="${h}" fill="#4189dd"/>
    <polygon fill="#fff" points="${star(w*0.5,h*0.5,h*0.28,5,-Math.PI/2)}"/>
  </svg>`,

  // ── Eritrea ───────────────────────────────────────────────────────────────
  ER: (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
    <rect width="${w}" height="${h/2}"   fill="#4189dd"/>
    <rect y="${h/2}" width="${w}" height="${h/2}" fill="#12ad2b"/>
    <polygon points="0,0 ${w*0.52},${h*0.5} 0,${h}" fill="#d7141a"/>
    <circle cx="${w*0.2}" cy="${h*0.5}" r="${h*0.17}" fill="none" stroke="#ffc726" stroke-width="${h*0.05}"/>
    <polygon fill="#ffc726" points="${star(w*0.2,h*0.5,h*0.09,12,-Math.PI/2)}"/>
  </svg>`,

  // ── Namibia ───────────────────────────────────────────────────────────────
  NA: (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
    <polygon points="0,0 ${w},0 ${w},${h}" fill="#003580"/>
    <polygon points="0,0 0,${h} ${w},${h}" fill="#009543"/>
    <polygon points="0,0 ${w*0.7},0 0,${h*0.85}" fill="#fff"/>
    <polygon points="${w*0.04},0 ${w*0.65},0 0,${h*0.8}" fill="#d21034"/>
    <!-- sun -->
    <circle cx="${w*0.24}" cy="${h*0.28}" r="${h*0.14}" fill="#ffc726"/>
    ${Array.from({length:12},(_,i)=>{const a=i*Math.PI/6;return `<line x1="${w*0.24+h*0.14*Math.cos(a)}" y1="${h*0.28+h*0.14*Math.sin(a)}" x2="${w*0.24+h*0.2*Math.cos(a)}" y2="${h*0.28+h*0.2*Math.sin(a)}" stroke="#ffc726" stroke-width="${h*0.03}"/>`}).join('')}
  </svg>`,

  // ── Mauritius ─────────────────────────────────────────────────────────────
  MU: (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
    ${[['#ea2839',0],['#1a206d',h/4],['#ffcb00',h/2],['#00a551',h*3/4]].map(([c,y])=>
      `<rect y="${y}" width="${w}" height="${h/4}" fill="${c}"/>`).join('')}
  </svg>`,

  // ── Seychelles ────────────────────────────────────────────────────────────
  SC: (w, h) => {
    const colors = ['#003f87','#fcd856','#d62828','#fff','#007a5e'];
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
      ${colors.map((c,i) => `<polygon points="0,${h} ${w*i/5},0 ${w*(i+1)/5},0 0,${h}" fill="${c}"/>`).join('')}
    </svg>`;
  },

  // ── Madagascar ────────────────────────────────────────────────────────────
  MG: (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
    <rect width="${w*0.33}" height="${h}" fill="#fff"/>
    <rect x="${w*0.33}" width="${w*0.67}" height="${h/2}" fill="#fc3d32"/>
    <rect x="${w*0.33}" y="${h/2}" width="${w*0.67}" height="${h/2}" fill="#007e3a"/>
  </svg>`,

  // ── Lesotho ───────────────────────────────────────────────────────────────
  LS: (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
    <rect width="${w}" height="${h/3}"     fill="#009a44"/>
    <rect y="${h/3}" width="${w}" height="${h/3}" fill="#fff"/>
    <rect y="${h*2/3}" width="${w}" height="${h/3}" fill="#009a44"/>
    <!-- Basotho hat (mokorotlo) -->
    <polygon points="${w*0.38},${h*0.62} ${w*0.5},${h*0.25} ${w*0.62},${h*0.62}" fill="#000"/>
    <ellipse cx="${w*0.5}" cy="${h*0.62}" rx="${w*0.14}" ry="${h*0.05}" fill="#000"/>
  </svg>`,

  // ── Eswatini ──────────────────────────────────────────────────────────────
  SZ: (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
    <rect width="${w}" height="${h*0.22}"  fill="#3e5eb9"/>
    <rect y="${h*0.22}" width="${w}" height="${h*0.56}" fill="#ffd900"/>
    <rect y="${h*0.78}" width="${w}" height="${h*0.22}" fill="#3e5eb9"/>
    <!-- horizontal bands on yellow -->
    <rect y="${h*0.36}" width="${w}" height="${h*0.08}" fill="#000"/>
    <rect y="${h*0.56}" width="${w}" height="${h*0.08}" fill="#000"/>
    <!-- shield (red oval) -->
    <ellipse cx="${w*0.5}" cy="${h*0.5}" rx="${w*0.12}" ry="${h*0.2}" fill="#b22222"/>
    <rect x="${w*0.47}" y="${h*0.3}" width="${w*0.06}" height="${h*0.4}" fill="#000"/>
  </svg>`,

  // ── Hong Kong ─────────────────────────────────────────────────────────────
  HK: (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
    <rect width="${w}" height="${h}" fill="#de2910"/>
    <!-- Bauhinia flower (5 petals) -->
    ${Array.from({length:5},(_,i) => {
      const a = i*2*Math.PI/5 - Math.PI/2;
      const px = w*0.5 + h*0.28*Math.cos(a), py = h*0.5 + h*0.28*Math.sin(a);
      return `<ellipse cx="${px}" cy="${py}" rx="${h*0.1}" ry="${h*0.055}" transform="rotate(${i*72-90} ${px} ${py})" fill="#fff"/>`;
    }).join('')}
    <circle cx="${w*0.5}" cy="${h*0.5}" r="${h*0.08}" fill="#de2910"/>
  </svg>`,

  // ── Taiwan ────────────────────────────────────────────────────────────────
  TW: (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
    <rect width="${w}" height="${h}" fill="#fe0000"/>
    <rect width="${w*0.5}" height="${h*0.5}" fill="#000095"/>
    <circle cx="${w*0.25}" cy="${h*0.25}" r="${h*0.16}" fill="#fff"/>
    <polygon fill="#000095" points="${star(w*0.25,h*0.25,h*0.13,12,-Math.PI/2)}"/>
    <circle cx="${w*0.25}" cy="${h*0.25}" r="${h*0.05}" fill="#fff"/>
  </svg>`,

  // ── Cameroon (CM) ─────────────────────────────────────────────────────────
  CM: (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
    <rect width="${w/3}" height="${h}" fill="#007a5e"/>
    <rect x="${w/3}" width="${w/3}" height="${h}" fill="#ce1126"/>
    <rect x="${w*2/3}" width="${w/3}" height="${h}" fill="#fcd116"/>
    <polygon fill="#fcd116" points="${star(w/2, h/2, h*0.16, 5, -Math.PI/2)}"/>
  </svg>`,

  // ── Malawi (MW) ───────────────────────────────────────────────────────────
  MW: (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
    <rect width="${w}" height="${h/3}"     fill="#000"/>
    <rect y="${h/3}" width="${w}" height="${h/3}" fill="#ce1126"/>
    <rect y="${h*2/3}" width="${w}" height="${h/3}" fill="#339e35"/>
    <circle cx="${w*0.5}" cy="${h*0.165}" r="${h*0.13}" fill="#ce1126"/>
    ${Array.from({length:12},(_,i)=>{const a=i*Math.PI/6;return `<line x1="${w*0.5+h*0.13*Math.cos(a)}" y1="${h*0.165+h*0.13*Math.sin(a)}" x2="${w*0.5+h*0.2*Math.cos(a)}" y2="${h*0.165+h*0.2*Math.sin(a)}" stroke="#ce1126" stroke-width="${h*0.025}"/>`;}).join('')}
  </svg>`,

  // ── Gambia (GM) ───────────────────────────────────────────────────────────
  GM: (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
    <rect width="${w}" height="${h*0.25}"  fill="#3a7728"/>
    <rect y="${h*0.25}" width="${w}" height="${h*0.08}" fill="#fff"/>
    <rect y="${h*0.33}" width="${w}" height="${h*0.34}" fill="#ce1126"/>
    <rect y="${h*0.67}" width="${w}" height="${h*0.08}" fill="#fff"/>
    <rect y="${h*0.75}" width="${w}" height="${h*0.25}" fill="#3a7728"/>
  </svg>`,

  // ── Sierra Leone (SL) ─────────────────────────────────────────────────────
  SL: (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
    <rect width="${w}" height="${h/3}"     fill="#1eb53a"/>
    <rect y="${h/3}" width="${w}" height="${h/3}" fill="#fff"/>
    <rect y="${h*2/3}" width="${w}" height="${h/3}" fill="#0072c6"/>
  </svg>`,

  // ── Liberia (LR) ──────────────────────────────────────────────────────────
  LR: (w, h) => {
    const sh = h / 11;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
      ${Array.from({length:11},(_,i)=>`<rect y="${i*sh}" width="${w}" height="${sh}" fill="${i%2===0?'#bf0a30':'#fff'}"/>`).join('')}
      <rect width="${w*0.36}" height="${h*6/11}" fill="#002868"/>
      <polygon fill="#fff" points="${star(w*0.18, h*3/11, h*0.12, 5, -Math.PI/2)}"/>
    </svg>`;
  },

  // ── Cape Verde (CV) ───────────────────────────────────────────────────────
  CV: (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
    <rect width="${w}" height="${h}" fill="#003893"/>
    <rect y="${h*0.42}" width="${w}" height="${h*0.08}" fill="#fff"/>
    <rect y="${h*0.5}"  width="${w}" height="${h*0.16}" fill="#cf2027"/>
    <rect y="${h*0.66}" width="${w}" height="${h*0.08}" fill="#fff"/>
    ${Array.from({length:10},(_,i)=>{const a=i*2*Math.PI/10-Math.PI/2;return `<polygon fill="#f7d116" points="${star(w*0.36+h*0.28*Math.cos(a),h*0.54+h*0.28*Math.sin(a),h*0.06,5,-Math.PI/2)}"/>`;}).join('')}
  </svg>`,

  // ── Myanmar (MM) ──────────────────────────────────────────────────────────
  MM: (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
    <rect width="${w}" height="${h/3}"     fill="#fecb00"/>
    <rect y="${h/3}" width="${w}" height="${h/3}" fill="#34b233"/>
    <rect y="${h*2/3}" width="${w}" height="${h/3}" fill="#ea2839"/>
    <polygon fill="#fff" points="${star(w*0.5, h*0.5, h*0.32, 5, -Math.PI/2)}"/>
  </svg>`,

  // ── Cambodia (KH) ─────────────────────────────────────────────────────────
  KH: (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
    <rect width="${w}" height="${h}"        fill="#032ea1"/>
    <rect y="${h*0.25}" width="${w}" height="${h*0.5}" fill="#e00025"/>
    <rect x="${w*0.35}" y="${h*0.28}" width="${w*0.3}"  height="${h*0.32}" fill="#fff"/>
    <rect x="${w*0.42}" y="${h*0.22}" width="${w*0.16}" height="${h*0.38}" fill="#fff"/>
    <rect x="${w*0.47}" y="${h*0.17}" width="${w*0.06}" height="${h*0.43}" fill="#fff"/>
    <rect x="${w*0.25}" y="${h*0.35}" width="${w*0.5}"  height="${h*0.1}"  fill="#fff"/>
  </svg>`,

  // ── Czech Republic (CZ) ───────────────────────────────────────────────────
  CZ: (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
    <rect width="${w}" height="${h/2}"   fill="#fff"/>
    <rect y="${h/2}" width="${w}" height="${h/2}" fill="#d7141a"/>
    <polygon points="0,0 ${w*0.44},${h*0.5} 0,${h}" fill="#11457e"/>
  </svg>`,

  // ── Hungary (HU) ──────────────────────────────────────────────────────────
  HU: (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
    <rect width="${w}" height="${h/3}"     fill="#ce2939"/>
    <rect y="${h/3}" width="${w}" height="${h/3}" fill="#fff"/>
    <rect y="${h*2/3}" width="${w}" height="${h/3}" fill="#477050"/>
  </svg>`,

  // ── Romania (RO) ──────────────────────────────────────────────────────────
  RO: (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
    <rect width="${w/3}" height="${h}" fill="#002b7f"/>
    <rect x="${w/3}" width="${w/3}" height="${h}" fill="#fcd116"/>
    <rect x="${w*2/3}" width="${w/3}" height="${h}" fill="#ce1126"/>
  </svg>`,

  // ── Bulgaria (BG) ─────────────────────────────────────────────────────────
  BG: (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
    <rect width="${w}" height="${h/3}"     fill="#fff"/>
    <rect y="${h/3}" width="${w}" height="${h/3}" fill="#00966e"/>
    <rect y="${h*2/3}" width="${w}" height="${h/3}" fill="#d62612"/>
  </svg>`,

  // ── Benin (BJ) ────────────────────────────────────────────────────────────
  BJ: (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
    <rect width="${w*0.36}" height="${h}" fill="#008751"/>
    <rect x="${w*0.36}" width="${w*0.64}" height="${h/2}" fill="#fcd116"/>
    <rect x="${w*0.36}" y="${h/2}" width="${w*0.64}" height="${h/2}" fill="#e8112d"/>
  </svg>`,

  // ── Niger (NE) ────────────────────────────────────────────────────────────
  NE: (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
    <rect width="${w}" height="${h/3}"     fill="#e05206"/>
    <rect y="${h/3}" width="${w}" height="${h/3}" fill="#fff"/>
    <rect y="${h*2/3}" width="${w}" height="${h/3}" fill="#0db02b"/>
    <circle cx="${w*0.5}" cy="${h*0.5}" r="${h*0.16}" fill="#e05206"/>
  </svg>`,

  // ── Chad (TD) ─────────────────────────────────────────────────────────────
  TD: (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
    <rect width="${w/3}" height="${h}" fill="#002664"/>
    <rect x="${w/3}" width="${w/3}" height="${h}" fill="#fecb00"/>
    <rect x="${w*2/3}" width="${w/3}" height="${h}" fill="#c60c30"/>
  </svg>`,

  // ── Central African Republic (CF) ─────────────────────────────────────────
  CF: (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
    <rect width="${w}" height="${h*0.25}"  fill="#003082"/>
    <rect y="${h*0.25}" width="${w}" height="${h*0.25}" fill="#fff"/>
    <rect y="${h*0.5}"  width="${w}" height="${h*0.25}" fill="#289728"/>
    <rect y="${h*0.75}" width="${w}" height="${h*0.25}" fill="#fec608"/>
    <rect x="${w*0.44}" width="${w*0.12}" height="${h}" fill="#bc0026"/>
    <polygon fill="#fec608" points="${star(w*0.12, h*0.12, h*0.1, 5, -Math.PI/2)}"/>
  </svg>`,

  // ── Republic of Congo (CG) ────────────────────────────────────────────────
  CG: (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
    <rect width="${w}" height="${h}" fill="#009543"/>
    <polygon points="0,0 ${w},${h} 0,${h}" fill="#dc241f"/>
    <polygon points="0,${h*0.28} ${w*0.72},${h} ${w},${h} ${w},${h*0.72} 0,0" fill="#fbde4a"/>
  </svg>`,

  // ── Laos (LA) ─────────────────────────────────────────────────────────────
  LA: (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
    <rect width="${w}" height="${h/3}"     fill="#ce1126"/>
    <rect y="${h/3}" width="${w}" height="${h/3}" fill="#002868"/>
    <rect y="${h*2/3}" width="${w}" height="${h/3}" fill="#ce1126"/>
    <circle cx="${w*0.5}" cy="${h*0.5}" r="${h*0.2}" fill="#fff"/>
  </svg>`,

  // ── Portugal (PT) ─────────────────────────────────────────────────────────
  PT: (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
    <rect width="${w*0.4}" height="${h}" fill="#006600"/>
    <rect x="${w*0.4}" width="${w*0.6}" height="${h}" fill="#ff0000"/>
    <circle cx="${w*0.4}" cy="${h*0.5}" r="${h*0.22}" fill="#ffff00" stroke="#00009a" stroke-width="${h*0.04}"/>
    <circle cx="${w*0.4}" cy="${h*0.5}" r="${h*0.14}" fill="#fff" stroke="#00009a" stroke-width="${h*0.03}"/>
  </svg>`,

  // ── Austria (AT) ──────────────────────────────────────────────────────────
  AT: (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
    <rect width="${w}" height="${h/3}"     fill="#ed2939"/>
    <rect y="${h/3}" width="${w}" height="${h/3}" fill="#fff"/>
    <rect y="${h*2/3}" width="${w}" height="${h/3}" fill="#ed2939"/>
  </svg>`,

  // ── Greece (GR) ───────────────────────────────────────────────────────────
  GR: (w, h) => {
    const s = h / 9;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
      ${Array.from({length:9},(_,i)=>`<rect y="${i*s}" width="${w}" height="${s}" fill="${i%2===0?'#0d5eaf':'#fff'}"/>`).join('')}
      <rect width="${w*0.4}" height="${h*5/9}" fill="#0d5eaf"/>
      <rect x="${w*0.15}" width="${w*0.1}" height="${h*5/9}" fill="#fff"/>
      <rect y="${h*2/9}" width="${w*0.4}" height="${h/9}" fill="#fff"/>
    </svg>`;
  },

  // ── Finland (FI) ──────────────────────────────────────────────────────────
  FI: (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
    <rect width="${w}" height="${h}" fill="#fff"/>
    <rect x="${w*0.24}" width="${w*0.14}" height="${h}" fill="#003580"/>
    <rect y="${h*0.38}" width="${w}" height="${h*0.24}" fill="#003580"/>
  </svg>`,

  // ── Croatia (HR) ──────────────────────────────────────────────────────────
  HR: (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
    <rect width="${w}" height="${h/3}"     fill="#ff0000"/>
    <rect y="${h/3}" width="${w}" height="${h/3}" fill="#fff"/>
    <rect y="${h*2/3}" width="${w}" height="${h/3}" fill="#0000cc"/>
    <!-- Coat of arms checkerboard (simplified) -->
    <rect x="${w*0.38}" y="${h*0.18}" width="${w*0.24}" height="${h*0.3}" fill="#fff" stroke="#ccc" stroke-width="1"/>
    ${Array.from({length:6},(_,i)=>`<rect x="${w*0.38+w*0.08*(i%3)}" y="${h*0.18+h*0.15*Math.floor(i/3)}" width="${w*0.08}" height="${h*0.15}" fill="${(Math.floor(i/3)+i%3)%2===0?'#ff0000':'#fff'}"/>`).join('')}
  </svg>`,

  // ── Vietnam additional coverage (already defined above as VN)
  // ── Fiji (FJ) ─────────────────────────────────────────────────────────────
  FJ: (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
    <rect width="${w}" height="${h}" fill="#68bfe5"/>
    <!-- Union Jack simplified -->
    <rect width="${w*0.5}" height="${h*0.5}" fill="#012169"/>
    <line x1="0" y1="0" x2="${w*0.5}" y2="${h*0.5}" stroke="#fff" stroke-width="${h*0.1}"/>
    <line x1="${w*0.5}" y1="0" x2="0" y2="${h*0.5}" stroke="#fff" stroke-width="${h*0.1}"/>
    <line x1="0" y1="0" x2="${w*0.5}" y2="${h*0.5}" stroke="#c8102e" stroke-width="${h*0.06}"/>
    <line x1="${w*0.5}" y1="0" x2="0" y2="${h*0.5}" stroke="#c8102e" stroke-width="${h*0.06}"/>
    <rect x="${w*0.21}" width="${w*0.08}" height="${h*0.5}" fill="#fff"/>
    <rect y="${h*0.21}" width="${w*0.5}" height="${h*0.08}" fill="#fff"/>
    <rect x="${w*0.225}" width="${w*0.05}" height="${h*0.5}" fill="#c8102e"/>
    <rect y="${h*0.225}" width="${w*0.5}" height="${h*0.05}" fill="#c8102e"/>
  </svg>`,
};

// ── Helper: compute points for a regular star polygon ─────────────────────
function star(cx: number, cy: number, r: number, n: number, startAngle: number): string {
  const inner = r * 0.382;
  return Array.from({length: n * 2}, (_, i) => {
    const angle = startAngle + (i * Math.PI) / n;
    const radius = i % 2 === 0 ? r : inner;
    return `${cx + radius * Math.cos(angle)},${cy + radius * Math.sin(angle)}`;
  }).join(' ');
}

// ── FlagIcon component ─────────────────────────────────────────────────────
export function FlagIcon({ code, size = 24, className = '' }: FlagProps) {
  const input = (code ?? '').toString().trim();
  const normalized = input.toUpperCase().replace(/[^A-Z]/g, '');
  const upper = COUNTRY_ALIASES[normalized] ?? normalized;

  // Defense-in-depth: w/h are interpolated directly into raw SVG markup below
  // (via dangerouslySetInnerHTML), so they must be guaranteed-safe finite
  // numbers no matter what a caller passes — never a string that could break
  // out of an SVG attribute. Coerce + clamp to a sane pixel range.
  const safeSize = Number.isFinite(size) ? Math.min(Math.max(size, 1), 512) : 24;
  const w = safeSize;
  const h = Math.round(safeSize * 0.75); // 4:3 aspect
  const builder = FLAGS[upper];

  if (!builder) {
    const emoji = flagEmoji(upper);
    return (
      <span
        className={`inline-flex items-center justify-center ${className}`}
        style={{
          width: w,
          height: h,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 2,
          overflow: 'hidden',
          flexShrink: 0,
          fontSize: `${Math.max(w * 0.8, 12)}px`,
          lineHeight: 1,
        }}
        aria-label={`Flag of ${upper}`}
        role="img"
      >
        {emoji}
      </span>
    );
  }

  return (
    <span
      className={`inline-block ${className}`}
      style={{
        width: w,
        height: h,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 2,
        overflow: 'hidden',
        flexShrink: 0,
        boxShadow: '0 0 0 1px rgba(0,0,0,0.08)',
      }}
      aria-label={`Flag of ${upper}`}
      role="img"
      dangerouslySetInnerHTML={{ __html: builder(w, h) }}
    />
  );
}

/**
 * Returns the ISO 3166-1 alpha-2 code for a given app country name.
 * Useful for components that store country as "UAE", "UGANDA", etc.
 */
export function countryToISO(country: string): string {
  const normalized = (country ?? '').toString().trim().toUpperCase().replace(/[^A-Z]/g, '');
  return COUNTRY_ALIASES[normalized] ?? normalized.slice(0, 2);
}

/**
 * flagEmoji — kept for backward compat with select <option> elements
 * where dangerouslySetInnerHTML isn't available.
 */
export function flagEmoji(code: string): string {
  const upper = code.toUpperCase();
  try {
    if (upper.length !== 2) return '🌍';
    return String.fromCodePoint(
      ...upper.split('').map(c => 0x1F1E6 - 65 + c.charCodeAt(0))
    );
  } catch { return '🌍'; }
}
