/**
 * Seed catalog: theatres, and a fallback movie list.
 *
 * The movie list below is ONLY used when TMDB is not configured — see
 * services/tmdb.js. With a TMDB key set, the catalog is fetched live so it
 * reflects what is actually in cinemas rather than this frozen snapshot.
 *
 * Theatre brands here are invented ("CineCloud", "Galaxy", "Starlight") rather
 * than real chains, since this app is meant to be deployed publicly and should
 * not appear to represent a real business.
 */

const FALLBACK_MOVIES = [
  // ========================= BOLLYWOOD =========================
  {
    title: 'Pathaan',
    genre: 'Action',
    language: 'Hindi',
    duration: '2h 26m',
    certificate: 'UA',
    status: 'now_showing',
    formats: ['2D', '3D', 'IMAX 2D'],
    posterUrl: '',
    trailerUrl: 'https://www.youtube.com/watch?v=vqu4z34wENw',
    description: 'An Indian spy takes on the leader of a group of mercenaries who have planned a deadly attack on India.',
  },
  {
    title: 'Jawan',
    genre: 'Action',
    language: 'Hindi',
    duration: '2h 49m',
    certificate: 'UA',
    status: 'now_showing',
    formats: ['2D', '4DX'],
    posterUrl: '',
    trailerUrl: 'https://www.youtube.com/watch?v=COv52Qyctws',
    description: 'A man is driven by a personal vendetta to rectify the wrongs in society.',
  },
  {
    title: 'Animal',
    genre: 'Action',
    language: 'Hindi',
    duration: '3h 21m',
    certificate: 'A',
    status: 'now_showing',
    formats: ['2D', 'IMAX 2D'],
    posterUrl: '',
    trailerUrl: 'https://www.youtube.com/watch?v=Dydmpfo68DA',
    description: 'A son undergoes a violent transformation when his father\'s life is threatened.',
  },
  {
    title: 'Stree 2',
    genre: 'Horror Comedy',
    language: 'Hindi',
    duration: '2h 30m',
    certificate: 'UA',
    status: 'now_showing',
    formats: ['2D', '3D'],
    posterUrl: '',
    trailerUrl: '', // no verified YouTube ID — set via admin or use TMDB
    description: 'The town of Chanderi is under threat once again, and only the men are disappearing.',
  },
  {
    title: 'The Kerala Story',
    genre: 'Drama',
    language: 'Hindi',
    duration: '2h 18m',
    certificate: 'A',
    status: 'now_showing',
    formats: ['2D'],
    posterUrl: '',
    trailerUrl: '', // no verified YouTube ID — set via admin or use TMDB
    description: 'A drama following the lives of a group of women from Kerala.',
  },

  // ========================= HOLLYWOOD =========================
  {
    title: 'Oppenheimer',
    genre: 'Drama',
    language: 'English',
    duration: '3h 0m',
    certificate: 'A',
    status: 'now_showing',
    formats: ['2D', 'IMAX 2D'],
    posterUrl: '',
    trailerUrl: 'https://www.youtube.com/watch?v=uYPbbksJxIg',
    description: 'The story of J. Robert Oppenheimer and his role in the development of the atomic bomb.',
  },
  {
    title: 'Dune: Part Two',
    genre: 'Sci-Fi',
    language: 'English',
    duration: '2h 46m',
    certificate: 'UA',
    status: 'now_showing',
    formats: ['2D', '3D', 'IMAX 3D'],
    posterUrl: '',
    trailerUrl: 'https://www.youtube.com/watch?v=Way9Dexny3w',
    description: 'Paul Atreides unites with the Fremen to seek revenge against the conspirators who destroyed his family.',
  },
  {
    title: 'Deadpool & Wolverine',
    genre: 'Action',
    language: 'English',
    duration: '2h 8m',
    certificate: 'A',
    status: 'now_showing',
    formats: ['2D', '3D', '4DX'],
    posterUrl: '',
    trailerUrl: 'https://www.youtube.com/watch?v=73_1biulkYk',
    description: 'Deadpool is offered a place in the MCU by the TVA, but instead recruits a reluctant Wolverine.',
  },
  {
    title: 'Inside Out 2',
    genre: 'Animation',
    language: 'English',
    duration: '1h 36m',
    certificate: 'U',
    status: 'now_showing',
    formats: ['2D', '3D'],
    posterUrl: '',
    trailerUrl: 'https://www.youtube.com/watch?v=LEjhY15eCx0',
    description: 'Riley enters puberty and Headquarters makes room for a brand new set of emotions.',
  },
  {
    title: 'Interstellar',
    genre: 'Sci-Fi',
    language: 'English',
    duration: '2h 49m',
    certificate: 'UA',
    status: 'now_showing',
    formats: ['2D', 'IMAX 2D'],
    posterUrl: 'https://m.media-amazon.com/images/M/MV5BYzdjMDAxZGItMjI2My00ODA1LTlkNzItOWFjMDU5ZDJlYWY3XkEyXkFqcGc@._V1_.jpg',
    trailerUrl: 'https://www.youtube.com/watch?v=zSWdZVtXT7E',
    description: 'Explorers travel through a wormhole in space in an attempt to ensure humanity\'s survival.',
  },
  {
    title: 'The Dark Knight',
    genre: 'Action',
    language: 'English',
    duration: '2h 32m',
    certificate: 'UA',
    status: 'now_showing',
    formats: ['2D', 'IMAX 2D'],
    posterUrl: 'https://m.media-amazon.com/images/M/MV5BMTMxNTMwODM0NF5BMl5BanBnXkFtZTcwODAyMTk2Mw@@._V1_.jpg',
    trailerUrl: 'https://www.youtube.com/watch?v=EXeTwQWrcwY',
    description: 'When the menace known as the Joker wreaks havoc on Gotham, Batman must accept one of the greatest psychological tests.',
  },

  // ========================= COMING SOON =========================
  {
    title: 'Avatar: Fire and Ash',
    genre: 'Sci-Fi',
    language: 'English',
    duration: '3h 15m',
    certificate: 'UA',
    status: 'coming_soon',
    formats: ['3D', 'IMAX 3D', '4DX'],
    posterUrl: '',
    trailerUrl: '',
    description: 'The Sully family faces a new and dangerous Na\'vi clan on Pandora.',
  },
];

/**
 * Screen templates. `basePrices` are pre-format; the format surcharge from
 * config/pricing.js is applied when each show is created.
 */
const SCREEN_TEMPLATES = {
  imax: {
    name: 'Screen 1 — IMAX',
    layoutId: 'imax',
    supportedFormats: ['IMAX 2D', 'IMAX 3D', '2D'],
    basePrices: { normal: 250, executive: 340, premium: 460, recliner: 620 },
  },
  atmos: {
    name: 'Screen 2 — Dolby Atmos',
    layoutId: 'standard',
    supportedFormats: ['2D', '3D'],
    basePrices: { normal: 180, executive: 240, premium: 330, recliner: 460 },
  },
  fourdx: {
    name: 'Screen 3 — 4DX',
    layoutId: 'standard',
    supportedFormats: ['4DX', '3D', '2D'],
    basePrices: { normal: 200, executive: 270, premium: 360, recliner: 490 },
  },
  standard2: {
    name: 'Screen 4 — Digital 2K',
    layoutId: 'standard',
    supportedFormats: ['2D', '3D'],
    basePrices: { normal: 150, executive: 200, premium: 280, recliner: 400 },
  },
  luxe: {
    name: 'Screen 5 — Luxe',
    layoutId: 'luxe',
    supportedFormats: ['2D', '3D'],
    basePrices: { recliner: 550 },
  },
};

/** City price multiplier — metros cost more. */
const CITY_MULTIPLIER = {
  mumbai: 1.2, delhi: 1.2, bengaluru: 1.15,
  hyderabad: 1.0, pune: 1.0, ahmedabad: 0.9,
};

/**
 * Which languages a film can be shown in.
 *
 * Indian multiplexes routinely run Hollywood releases dubbed into Hindi and
 * the local regional language, and big Hindi films dubbed regionally. TMDB
 * does not publish dub schedules, so this derives a plausible set: the
 * original language always, plus dubs for wide-appeal genres.
 *
 * @param {object} movie   needs { language, genre, rating }
 * @param {string[]} cityLanguages  what the city programmes
 */
function languagesForMovie(movie, cityLanguages) {
  const original = movie.language;
  const available = new Set([original]);

  // Only films with broad appeal get dubbed; a small regional drama does not.
  const dubbable = ['Action', 'Sci-Fi', 'Animation', 'Horror', 'Comedy', 'Horror Comedy']
    .includes(movie.genre);
  const popular = (movie.rating || 0) >= 6 || movie.formats?.length > 2;

  if (dubbable && popular) {
    if (original === 'English') {
      available.add('Hindi');
      // …and the local language, where the city has one.
      for (const lang of cityLanguages) {
        if (!['Hindi', 'English'].includes(lang)) available.add(lang);
      }
    } else if (original === 'Hindi') {
      for (const lang of cityLanguages) {
        if (!['Hindi', 'English'].includes(lang)) available.add(lang);
      }
    }
  }

  // Never offer a language the city does not programme.
  return [...available].filter(l => cityLanguages.includes(l));
}

/** Four cinemas per city, with a mix of screen formats. */
const THEATRES = [
  // ---- Ahmedabad
  { name: 'CineCloud Alpha One',            city: 'ahmedabad', area: 'Vastrapur',       screens: ['imax', 'atmos', 'standard2', 'luxe'] },
  { name: 'Galaxy Cineplex Prahladnagar',   city: 'ahmedabad', area: 'Prahladnagar',    screens: ['atmos', 'fourdx', 'standard2'] },
  { name: 'Starlight Acropolis',            city: 'ahmedabad', area: 'Thaltej',         screens: ['atmos', 'standard2', 'luxe'] },
  { name: 'CineCloud Himalaya',             city: 'ahmedabad', area: 'Drive-In Road',   screens: ['standard2', 'atmos'] },

  // ---- Mumbai
  { name: 'CineCloud Phoenix Lower Parel',  city: 'mumbai',    area: 'Lower Parel',     screens: ['imax', 'atmos', 'standard2', 'luxe'] },
  { name: 'Starlight Cinemas Andheri',      city: 'mumbai',    area: 'Andheri West',    screens: ['atmos', 'fourdx', 'standard2'] },
  { name: 'Galaxy Cineplex Juhu',           city: 'mumbai',    area: 'Juhu',            screens: ['atmos', 'standard2', 'luxe'] },
  { name: 'CineCloud Infiniti Malad',       city: 'mumbai',    area: 'Malad West',      screens: ['imax', 'standard2', 'atmos'] },

  // ---- Delhi NCR
  { name: 'CineCloud Select Saket',         city: 'delhi',     area: 'Saket',           screens: ['imax', 'atmos', 'standard2', 'luxe'] },
  { name: 'Galaxy Cineplex Noida',          city: 'delhi',     area: 'Sector 18',       screens: ['atmos', 'fourdx', 'standard2'] },
  { name: 'Starlight Ambience Gurugram',    city: 'delhi',     area: 'Gurugram',        screens: ['imax', 'atmos', 'luxe'] },
  { name: 'CineCloud Rajouri',              city: 'delhi',     area: 'Rajouri Garden',  screens: ['standard2', 'atmos'] },

  // ---- Bengaluru
  { name: 'CineCloud Orion Rajajinagar',    city: 'bengaluru', area: 'Rajajinagar',     screens: ['imax', 'atmos', 'standard2', 'luxe'] },
  { name: 'Starlight Cinemas Koramangala',  city: 'bengaluru', area: 'Koramangala',     screens: ['atmos', 'fourdx', 'standard2'] },
  { name: 'Galaxy Cineplex Whitefield',     city: 'bengaluru', area: 'Whitefield',      screens: ['atmos', 'standard2', 'luxe'] },
  { name: 'CineCloud Jayanagar',            city: 'bengaluru', area: 'Jayanagar',       screens: ['standard2', 'atmos'] },

  // ---- Hyderabad
  { name: 'CineCloud Inorbit Madhapur',     city: 'hyderabad', area: 'Madhapur',        screens: ['imax', 'atmos', 'standard2', 'luxe'] },
  { name: 'Galaxy Cineplex Banjara Hills',  city: 'hyderabad', area: 'Banjara Hills',   screens: ['atmos', 'fourdx', 'standard2'] },
  { name: 'Starlight Gachibowli',           city: 'hyderabad', area: 'Gachibowli',      screens: ['atmos', 'standard2', 'luxe'] },
  { name: 'CineCloud Kukatpally',           city: 'hyderabad', area: 'Kukatpally',      screens: ['standard2', 'atmos'] },

  // ---- Pune
  { name: 'CineCloud Phoenix Viman Nagar',  city: 'pune',      area: 'Viman Nagar',     screens: ['imax', 'atmos', 'standard2', 'luxe'] },
  { name: 'Starlight Cinemas Kothrud',      city: 'pune',      area: 'Kothrud',         screens: ['atmos', 'fourdx', 'standard2'] },
  { name: 'Galaxy Cineplex Hinjewadi',      city: 'pune',      area: 'Hinjewadi',       screens: ['atmos', 'standard2', 'luxe'] },
  { name: 'CineCloud Camp',                 city: 'pune',      area: 'Camp',            screens: ['standard2', 'atmos'] },
];

/** Daily slots per screen, 24h. Display strings are derived from these. */
const SHOW_SLOTS = ['09:15', '11:45', '14:15', '17:00', '19:45', '22:30'];

/* ------------------------------------------------------------------ reviews
 *
 * Demo reviews, so a freshly seeded catalogue does not show "no ratings yet"
 * on every film. These are INVENTED — no real person wrote them and no booking
 * backs them. Every seeded item carries `source: 'seed'`, so they can be told
 * apart from genuine ones in the table and removed with a filtered delete.
 *
 * Treat them the way the generated dub schedules are treated: realistic demo
 * data, and described as such wherever the project is written up.
 */

const REVIEWER_NAMES = [
  'Ananya R.', 'Rahul M.', 'Priya S.', 'Karthik V.', 'Sneha J.', 'Arjun N.',
  'Meera K.', 'Vikram D.', 'Divya P.', 'Rohan T.', 'Ishita B.', 'Aditya G.',
  'Nikhil S.', 'Pooja H.', 'Sameer A.', 'Tanvi L.', 'Harsh P.', 'Neha C.',
  'Manav R.', 'Kavya I.', 'Siddharth W.', 'Riya F.', 'Aman Q.', 'Shruti Y.',
];

/**
 * Comment pools keyed by rating, so the words match the stars.
 *
 * Each pool is deliberately larger than the most reviews any one film gets, so
 * the seeder can draw without replacement. Small pools produced the same
 * sentence four times on a single film, which is the one thing that makes
 * seeded reviews obvious at a glance.
 */
const REVIEW_COMMENTS = {
  5: [
    'Absolutely worth the ticket. Stayed with me all the way home.',
    'Best thing I have watched this year. The last twenty minutes are superb.',
    'Booked it twice. The sound design on a big screen is unreal.',
    'Performances carry the whole thing. Not a wasted scene in it.',
    'Went in with no expectations and came out stunned.',
    'The kind of film you want to talk about the moment it ends.',
    'Everything lands — script, cast, music. Rare these days.',
    'Take the family. Genuinely something for everyone.',
    'Second half is a masterclass. Worth every rupee.',
    'Still thinking about the final scene two days later.',
    'Easily the best cinema experience I have had all year.',
    'No interval break for me. Could not look away.',
  ],
  4: [
    'Really enjoyed it. Slightly long in the middle but the payoff lands.',
    'Strong film, great visuals. Better in a cinema than at home.',
    'Solid story and a good cast. Would recommend to friends.',
    'Very good, though the ending felt a little rushed.',
    'Well made and genuinely funny in places. Worth a watch.',
    'The lead is excellent. Supporting cast slightly wasted.',
    'Held my attention throughout. A few scenes could have gone.',
    'Better than I expected from the trailer. Pleasantly surprised.',
    'Great first half. Loses a bit of steam after the interval.',
    'Beautifully shot and well acted. Just short of brilliant.',
    'Good pace, good music, satisfying finish.',
    'Would happily watch it again on a quiet evening.',
  ],
  3: [
    'Watchable. Some lovely moments, but it never quite takes off.',
    'Fine for a one-time watch. The plot has been done before.',
    'Good acting, thin script. Went in expecting more.',
    'Decent, not memorable. The interval block is the strongest part.',
    'Half a good film. The other half drags badly.',
    'Nice performances stuck in a very predictable story.',
    'Enjoyable enough, but I have forgotten most of it already.',
    'Started strong, ended flat. Middling overall.',
    'Worth it at a matinee price, not at a weekend one.',
    'Some clever ideas that the writing never follows through on.',
    'Perfectly okay. Nothing here you have not seen before.',
    'The visuals do a lot of heavy lifting for a weak plot.',
  ],
  2: [
    'Struggled to stay interested. The pacing is a real problem.',
    'Nice to look at, but the story goes nowhere.',
    'Expected much more given the trailer. Fairly disappointing.',
    'The cast deserved a far better script than this.',
    'Long, slow and oddly hollow. Checked my watch twice.',
    'A few good scenes buried in a lot of filler.',
    'Confusing in the second half and not in an interesting way.',
    'Hard to care about anyone in it.',
  ],
  1: [
    'Not for me at all. Left before the second half.',
    'Hard to sit through. Would not recommend.',
    'Two hours I would genuinely like back.',
    'No story, no pacing, nothing to hold on to.',
    'The trailer contains every good moment in the film.',
    'Walked out. First time I have ever done that.',
  ],
};

module.exports = {
  FALLBACK_MOVIES, THEATRES, SCREEN_TEMPLATES,
  CITY_MULTIPLIER, SHOW_SLOTS, languagesForMovie,
  REVIEWER_NAMES, REVIEW_COMMENTS,
};
