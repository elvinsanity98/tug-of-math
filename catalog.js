/* Tug of Math — ranks, rank badges and the skin catalogue.
   Rank stars live in one number (profiles.rank_stars):
     0–249   five tiers of 50 stars, each split into divisions I–V of 10 stars
     250+    Legend, counting up to 999 Legend stars
   The same rules run in supabase/002_modes_ranks_skins.sql. */
const Catalog = (() => {
  const TIER_STARS = 50, DIV_STARS = 10, LEGEND_AT = 250, LEGEND_MAX = 999;
  const ROMAN = ['I', 'II', 'III', 'IV', 'V'];
  const TIERS = [
    { name: 'Bronze',   sym: '+', a: '#ffd2a1', b: '#c77a3e', c: '#6e3a15', gem: '#ff9a52' },
    { name: 'Silver',   sym: '−', a: '#ffffff', b: '#b7c3d3', c: '#56637a', gem: '#8fd3ff' },
    { name: 'Gold',     sym: '×', a: '#fff3a8', b: '#f2b416', c: '#8a5a00', gem: '#ff5d5d' },
    { name: 'Platinum', sym: '÷', a: '#dcfffa', b: '#44c7b5', c: '#115a55', gem: '#b388ff' },
    { name: 'Diamond',  sym: '√', a: '#e3f0ff', b: '#6c7dff', c: '#2b1a8f', gem: '#7ff0ff' },
    { name: 'Legend',   sym: '∞', a: '#fff1a6', b: '#ff7a2f', c: '#8f0f3c', gem: '#ffe066' },
  ];

  function rankInfo(total) {
    const s = Math.max(0, Math.min(LEGEND_AT + LEGEND_MAX, total | 0));
    if (s >= LEGEND_AT) {
      const st = s - LEGEND_AT;
      return { tier: 5, name: 'Legend', div: -1, divLabel: '', stars: st, total: s, legend: true, label: `Legend ★${st}` };
    }
    const tier = Math.floor(s / TIER_STARS);
    const div = Math.floor((s % TIER_STARS) / DIV_STARS);
    const st = s % DIV_STARS;
    return { tier, name: TIERS[tier].name, div, divLabel: ROMAN[div], stars: st, total: s, legend: false,
      label: `${TIERS[tier].name} ${ROMAN[div]}` };
  }
  // question level and computer strength that suit a rank
  const rankDiff = total => ['easy', 'easy', 'medium', 'medium', 'hard', 'hard'][rankInfo(total).tier];
  const rankBot = total => ['easy', 'easy', 'medium', 'medium', 'hard', 'hard'][rankInfo(total).tier];

  /* ---------- rank badge: an SVG shield that grows wings, a crown and flames as the tier climbs ---------- */
  let uid = 0;
  const reduceMotion = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const wingPath = 'M40 46 C28 38 14 36 4 40 C12 44 16 47 18 50 C9 50 4 55 1 62 C10 60 16 61 20 63 C13 66 10 72 9 79 C18 74 26 72 34 72 Z';

  function badge(total, opts = {}) {
    const r = rankInfo(total), T = TIERS[r.tier], id = 'rb' + (++uid);
    const anim = opts.animate !== false && !reduceMotion();
    const t = r.tier;
    const shield = 'M30 30 Q60 16 90 30 L90 58 Q88 86 60 104 Q32 86 30 58 Z';
    let s = `<svg class="badge" viewBox="0 0 120 124" role="img" aria-label="${r.label}" xmlns="http://www.w3.org/2000/svg">
<defs>
  <linearGradient id="${id}m" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${T.a}"/><stop offset=".55" stop-color="${T.b}"/><stop offset="1" stop-color="${T.c}"/></linearGradient>
  <linearGradient id="${id}i" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${T.c}"/><stop offset="1" stop-color="${T.b}"/></linearGradient>
  <linearGradient id="${id}s" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".75"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
  <radialGradient id="${id}g"><stop offset="0" stop-color="${T.gem}" stop-opacity=".85"/><stop offset="1" stop-color="${T.gem}" stop-opacity="0"/></radialGradient>
  <clipPath id="${id}c"><path d="${shield}"/></clipPath>
</defs>`;
    // glow + turning rays from Platinum up
    if (t >= 3) {
      s += `<circle cx="60" cy="62" r="${t >= 5 ? 58 : 50}" fill="url(#${id}g)" opacity="${t >= 5 ? 0.9 : 0.55}"/>`;
      s += `<g opacity="${t >= 5 ? 0.55 : 0.3}">`;
      for (let i = 0; i < 12; i++) s += `<path d="M60 62 L${57} 4 L${63} 4 Z" fill="${T.a}" transform="rotate(${i * 30} 60 62)"/>`;
      if (anim) s += `<animateTransform attributeName="transform" type="rotate" from="0 60 62" to="360 60 62" dur="${t >= 5 ? 10 : 18}s" repeatCount="indefinite"/>`;
      s += '</g>';
    }
    // Legend: flames behind the shield
    if (t >= 5) {
      for (const [x, h, d, col] of [[34, 34, 0, '#ff7a2f'], [86, 34, 0.6, '#ff7a2f'], [46, 40, 0.9, '#ffb33a'], [74, 40, 1.2, '#ffb33a'], [60, 48, 0.3, '#ffd23f']]) {
        // flame drawn from its base so it flickers upward
        s += `<g transform="translate(${x} 70)"><path d="M0 0 C-12 -18 -4 ${-12 - h} 0 ${-30 - h / 2} C4 ${-12 - h} 12 -18 0 0 Z" fill="${col}" opacity=".9">`;
        if (anim) s += `<animateTransform attributeName="transform" type="scale" values="1 1;1.05 1.14;.97 .94;1 1" dur="1.1s" begin="${d}s" repeatCount="indefinite"/>`;
        s += '</path></g>';
      }
    }
    // wings from Gold up, bigger each tier
    if (t >= 2) {
      const k = [0, 0, 0.8, 1, 1.15, 1.3][t];
      const w = `<path d="${wingPath}" fill="url(#${id}m)" stroke="${T.c}" stroke-width="1.5" stroke-linejoin="round"/>`;
      const place = `translate(${30 - 30 * k} ${58 - 58 * k}) scale(${k})`;
      s += `<g transform="${place}">${w}</g><g transform="translate(120 0) scale(-1 1) ${place}">${w}</g>`;
    }
    // shield: rim, inner field, shine sweep
    s += `<path d="${shield}" fill="url(#${id}m)" stroke="${T.c}" stroke-width="2.5"/>`;
    s += `<path d="${shield}" fill="url(#${id}i)" transform="translate(60 62) scale(.78) translate(-60 -62)"/>`;
    if (t >= 1) s += `<path d="M36 34 Q60 23 84 34" fill="none" stroke="${T.a}" stroke-width="2" stroke-linecap="round" opacity=".8"/>`;
    s += `<g clip-path="url(#${id}c)"><rect x="-40" y="10" width="30" height="110" fill="url(#${id}s)" transform="skewX(-18)">`;
    if (anim) s += `<animate attributeName="x" values="-60;150;150" keyTimes="0;.45;1" dur="3.2s" repeatCount="indefinite"/>`;
    s += '</rect></g>';
    // operator emblem, drawn as shapes so every device shows the same symbol
    s += emblem(t, T.c);
    // crown from Diamond up
    if (t >= 4) {
      s += `<path d="M42 30 L45 12 L53 22 L60 6 L67 22 L75 12 L78 30 Z" fill="${t >= 5 ? '#ffd23f' : '#e3f0ff'}" stroke="${T.c}" stroke-width="2" stroke-linejoin="round"/>`;
      s += `<circle cx="60" cy="22" r="3.2" fill="${T.gem}"/><circle cx="48" cy="25" r="2.2" fill="${T.gem}"/><circle cx="72" cy="25" r="2.2" fill="${T.gem}"/>`;
    } else if (t >= 2) {
      s += `<circle cx="60" cy="27" r="5" fill="${T.gem}" stroke="${T.c}" stroke-width="2"/>`;
    }
    // division ribbon (or Legend star count)
    if (opts.ribbon !== false) {
      const txt = r.legend ? `★ ${r.stars}` : r.divLabel;
      s += `<path d="M24 98 L96 98 L90 108 L96 118 L24 118 L30 108 Z" fill="${T.c}"/>`;
      s += `<path d="M30 96 L90 96 L90 114 L30 114 Z" fill="url(#${id}m)" stroke="${T.c}" stroke-width="2"/>`;
      s += `<text x="60" y="110" text-anchor="middle" font-family="Lilita One, Arial Rounded MT Bold, sans-serif" font-size="${r.legend ? 13 : 14}" fill="#fff" stroke="${T.c}" stroke-width="2.4" paint-order="stroke">${txt}</text>`;
    }
    return s + '</svg>';
  }

  // + − × ÷ √ ∞, one per tier, centred at (60, 64)
  function emblem(t, ink) {
    const fill = `fill="#fff" stroke="${ink}" stroke-width="3.5" stroke-linejoin="round" paint-order="stroke"`;
    const line = d => `<path d="${d}" fill="none" stroke="${ink}" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/>` +
      `<path d="${d}" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>`;
    const plus = 'M55 50 h10 v9 h9 v10 h-9 v9 h-10 v-9 h-9 v-10 h9 z';
    switch (t) {
      case 0: return `<path d="${plus}" ${fill}/>`;
      case 1: return `<path d="M46 59 h28 v10 h-28 z" ${fill}/>`;
      case 2: return `<path d="${plus}" ${fill} transform="rotate(45 60 64)"/>`;
      case 3: return `<g ${fill}><path d="M46 60 h28 v8 h-28 z"/><circle cx="60" cy="51.5" r="5"/><circle cx="60" cy="76.5" r="5"/></g>`;
      case 4: return line('M44 65 l6 -3 l7 14 l9 -27 h11');
      default: return line('M60 64 C54 55 44 55 44 64 C44 73 54 73 60 64 C66 55 76 55 76 64 C76 73 66 73 60 64 Z');
    }
  }

  // ten star slots for a division (Legend shows its count instead)
  function starsRow(total) {
    const r = rankInfo(total);
    if (r.legend) return `<span class="stars legend-stars">★ ${r.stars} <small>/ ${LEGEND_MAX}</small></span>`;
    let s = '<span class="stars" aria-label="' + r.stars + ' of 10 stars">';
    for (let i = 0; i < DIV_STARS; i++) s += `<i class="${i < r.stars ? 'on' : ''}">★</i>`;
    return s + '</span>';
  }

  // every rank step, for the Ranks page
  function ladder() {
    const out = [];
    for (let t = 0; t < 5; t++) for (let d = 0; d < 5; d++) out.push(t * TIER_STARS + d * DIV_STARS);
    out.push(LEGEND_AT);
    return out;
  }

  /* ---------- skins (prices and rank locks are checked again by the database) ---------- */
  const SKINS = [
    { id: 'classic', name: 'Classic',      price: 0,    minStars: 0,   blurb: 'The team headband. Timeless.' },
    { id: 'cap',     name: 'Sporty Cap',   price: 100,  minStars: 0,   blurb: 'A cap in your team colour.' },
    { id: 'shades',  name: 'Cool Shades',  price: 200,  minStars: 0,   blurb: 'Too cool to lose.' },
    { id: 'cat',     name: 'Cat Ears',     price: 250,  minStars: 0,   blurb: 'Nine lives, ten stars.' },
    { id: 'pirate',  name: 'Pirate',       price: 400,  minStars: 0,   blurb: 'Hat, patch and a hearty pull.' },
    { id: 'ninja',   name: 'Ninja',        price: 500,  minStars: 0,   blurb: 'Silent. Fast. Correct.' },
    { id: 'viking',  name: 'Viking',       price: 600,  minStars: 0,   blurb: 'Horns up for every answer.' },
    { id: 'wizard',  name: 'Wizard',       price: 800,  minStars: 0,   blurb: 'Math is basically magic.' },
    { id: 'astro',   name: 'Astronaut',    price: 1000, minStars: 0,   blurb: 'Pulling from orbit.' },
    { id: 'robot',   name: 'Robot',        price: 1200, minStars: 0,   blurb: 'Beep. Correct. Boop.' },
    // full-body costumes (drawn in scene.js SUITS)
    { id: 'straw',   name: 'Straw Hat',    price: 1300, minStars: 0,   blurb: 'Straw hat, red vest, big grin.' },
    { id: 'web',     name: 'Web Slinger',  price: 1400, minStars: 0,   blurb: 'Red-and-blue suit. Sticky grip.' },
    { id: 'iron',    name: 'Iron Armor',   price: 1600, minStars: 0,   blurb: 'Red and gold armor, glowing core.' },
    { id: 'doom',    name: 'Doom Lord',    price: 1600, minStars: 0,   blurb: 'Iron mask, green cloak, no mercy.' },
    { id: 'crown',   name: 'Royal Crown',  price: 1500, minStars: 100, blurb: 'For Gold rank and above.' },
    { id: 'halo',    name: 'Diamond Halo', price: 2000, minStars: 200, blurb: 'Wings and a halo. Diamond rank.' },
    { id: 'legend',  name: 'Legend Flame', price: 2500, minStars: 250, blurb: 'A blazing aura. Legends only.' },
  ];
  const skinById = id => SKINS.find(s => s.id === id) || SKINS[0];

  /* body looks, picked from a player id so everyone keeps the same face */
  const LOOKS = [
    { skin: '#f2c79a', hair: '#2b1a10', style: 'short', h: 1.00 },
    { skin: '#8d5a3b', hair: '#15100d', style: 'afro',  h: 1.05 },
    { skin: '#e8b58a', hair: '#8a4418', style: 'pony',  h: 0.96 },
    { skin: '#c68c5e', hair: '#1a1311', style: 'pony',  h: 0.97 },
    { skin: '#f5d0b0', hair: '#d9a441', style: 'short', h: 1.02 },
    { skin: '#6e4630', hair: '#0f0b09', style: 'bald',  h: 1.06 },
    { skin: '#d9a57a', hair: '#3b2416', style: 'afro',  h: 0.99 },
    { skin: '#fbe0c8', hair: '#a8391f', style: 'short', h: 0.98 },
  ];
  function lookFor(id) {
    let h = 0;
    for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return h % LOOKS.length;
  }
  const BOT_NAMES = ['Newton', 'Ada', 'Euler', 'Pixel', 'Gauss', 'Mochi', 'Turbo', 'Noether', 'Pascal', 'Zippy', 'Hypatia', 'Bolt'];

  return { TIERS, ROMAN, LEGEND_AT, LEGEND_MAX, rankInfo, rankDiff, rankBot, badge, starsRow, ladder,
    SKINS, skinById, LOOKS, lookFor, BOT_NAMES };
})();
