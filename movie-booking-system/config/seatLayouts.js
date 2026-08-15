/**
 * Seat layouts — the single source of truth for every screen in the system.
 *
 * The server validates incoming seat IDs against these definitions and derives
 * each seat's tier (and therefore its price) from them. The same definitions
 * are served to the browser via GET /api/config/layouts so the grid the user
 * clicks is exactly the grid the server checks.
 *
 * Sections are listed screen-first, so the cheapest seats are nearest the
 * screen and prices climb towards the back — the way an Indian multiplex is
 * actually banded:
 *
 *   Normal     front rows, closest to the screen, cheapest
 *   Executive  the middle block, where most people sit
 *   Premium    further back, the best viewing angle
 *   Recliner   the last rows, full recline, most expensive
 *
 * `aislesAfter` lists the column numbers a walkway follows, so the rendered
 * grid breaks into blocks the way a real auditorium does.
 */

const LAYOUTS = {
  standard: {
    id: 'standard',
    name: 'Standard',
    sections: [
      { tier: 'normal',    label: 'Normal',    icon: '🪑', rows: ['A', 'B', 'C', 'D'],      cols: 12, aislesAfter: [4, 8] },
      { tier: 'executive', label: 'Executive', icon: '💺', rows: ['E', 'F', 'G', 'H'],      cols: 12, aislesAfter: [4, 8] },
      { tier: 'premium',   label: 'Premium',   icon: '🛋️', rows: ['J', 'K'],                cols: 10, aislesAfter: [3, 7] },
      { tier: 'recliner',  label: 'Recliner',  icon: '🛏️', rows: ['L', 'M'],                cols: 8,  aislesAfter: [4] },
    ],
  },

  imax: {
    id: 'imax',
    name: 'IMAX',
    sections: [
      { tier: 'normal',    label: 'Normal',    icon: '🪑', rows: ['A', 'B', 'C', 'D', 'E'], cols: 14, aislesAfter: [4, 10] },
      { tier: 'executive', label: 'Executive', icon: '💺', rows: ['F', 'G', 'H', 'J'],      cols: 14, aislesAfter: [4, 10] },
      { tier: 'premium',   label: 'Premium',   icon: '🛋️', rows: ['K', 'L'],                cols: 12, aislesAfter: [4, 8] },
      { tier: 'recliner',  label: 'Recliner',  icon: '🛏️', rows: ['M', 'N'],                cols: 8,  aislesAfter: [4] },
    ],
  },

  // Boutique screen: every seat is a recliner, so there is nothing to band.
  luxe: {
    id: 'luxe',
    name: 'Luxe',
    sections: [
      { tier: 'recliner', label: 'Luxe Recliner', icon: '🛏️', rows: ['A', 'B', 'C', 'D', 'E', 'F'], cols: 8, aislesAfter: [4] },
    ],
  },
};

/** Cheapest to most expensive — the order prices and legends follow. */
const TIERS = ['normal', 'executive', 'premium', 'recliner'];

const TIER_LABELS = {
  normal: 'Normal',
  executive: 'Executive',
  premium: 'Premium',
  recliner: 'Recliner',
};

function getLayout(layoutId) {
  return LAYOUTS[layoutId] || LAYOUTS.standard;
}

/**
 * Map every seat ID in a layout to its tier: { 'A1': 'normal', 'L3': 'recliner', ... }
 * Anything absent from this map is not a real seat.
 */
function buildSeatMap(layoutId) {
  const map = {};
  for (const section of getLayout(layoutId).sections) {
    for (const row of section.rows) {
      for (let c = 1; c <= section.cols; c++) {
        map[`${row}${c}`] = section.tier;
      }
    }
  }
  return map;
}

function totalSeats(layoutId) {
  return getLayout(layoutId).sections.reduce(
    (sum, s) => sum + s.rows.length * s.cols,
    0
  );
}

/** Which tiers a layout actually contains — Luxe only has recliners. */
function tiersInLayout(layoutId) {
  return [...new Set(getLayout(layoutId).sections.map(s => s.tier))];
}

module.exports = { LAYOUTS, TIERS, TIER_LABELS, getLayout, buildSeatMap, totalSeats, tiersInLayout };
