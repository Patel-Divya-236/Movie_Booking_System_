/**
 * Catalog constants. These lists were previously copy-pasted into both the
 * admin form and the edit form in app.js; they live here now and are served
 * to the browser via GET /api/config so the two can never drift apart.
 */

/**
 * Cities, and the languages each one actually programmes.
 *
 * `languages` is not decoration — it decides what gets scheduled. A Gujarati
 * film has no audience in Bengaluru, so the seeder never books it onto a
 * screen there, and the city's language filter only offers what is showing.
 * The first entry is the regional language for that city.
 */
const CITIES = [
  { id: 'ahmedabad', name: 'Ahmedabad', regional: 'Gujarati', languages: ['Gujarati', 'Hindi', 'English'] },
  { id: 'mumbai',    name: 'Mumbai',    regional: 'Marathi',  languages: ['Marathi', 'Hindi', 'English'] },
  { id: 'delhi',     name: 'Delhi NCR', regional: 'Punjabi',  languages: ['Punjabi', 'Hindi', 'English'] },
  { id: 'bengaluru', name: 'Bengaluru', regional: 'Kannada',  languages: ['Kannada', 'Hindi', 'English'] },
  { id: 'hyderabad', name: 'Hyderabad', regional: 'Telugu',   languages: ['Telugu', 'Hindi', 'English'] },
  { id: 'pune',      name: 'Pune',      regional: 'Marathi',  languages: ['Marathi', 'Hindi', 'English'] },
];

const GENRES = [
  'Action', 'Sci-Fi', 'Drama', 'Comedy', 'Horror',
  'Horror Comedy', 'Romance', 'Thriller', 'Animation',
];

const LANGUAGES = [
  'Hindi', 'English', 'Gujarati', 'Marathi', 'Punjabi',
  'Kannada', 'Telugu', 'Tamil', 'Malayalam',
];

/** Which languages a city programmes. */
function languagesForCity(cityId) {
  return CITIES.find(c => c.id === cityId)?.languages || ['Hindi', 'English'];
}

const CERTIFICATES = ['U', 'UA', 'UA 13+', 'UA 16+', 'A'];

const MOVIE_STATUS = ['now_showing', 'coming_soon'];

/** How many days ahead shows are listed and can be generated for. */
const BOOKING_WINDOW_DAYS = 14;

/**
 * How many films a single city programmes at once. A real multiplex chain
 * runs a dozen or so titles, not every film in the catalogue — capping this
 * is what lets each film play at several theatres instead of exactly one.
 *
 * The ratio that matters:
 *
 *     blocks per city  =  screens (~12) x FILMS_PER_SCREEN_PER_DAY (3)  =  36
 *     blocks per film  =  36 / FILMS_PER_CITY (12)                      =  3
 *
 * so every film lands on roughly three screens, in three different cinemas.
 * Raise FILMS_PER_CITY and films start appearing in only one theatre again.
 */
const FILMS_PER_CITY = 12;

/** Films sharing one screen in a day: 3 titles, 2 slots each. */
const FILMS_PER_SCREEN_PER_DAY = 3;

/** A booking can no longer be cancelled once the show is this close. */
const CANCELLATION_CUTOFF_MINUTES = 120;

/** Seats held for an unfinished checkout expire after this. */
const SEAT_HOLD_MINUTES = 5;

/** How long an email-verification link stays valid. */
const VERIFICATION_TOKEN_HOURS = 24;

/**
 * A signup waits in MovieBooking_PendingSignups until the link is clicked;
 * DynamoDB's TTL sweeps away anything never confirmed. Nothing enters the
 * Users table until the address is proven, so a typo leaves no dead account.
 */
const PENDING_SIGNUP_TTL_HOURS = 24;

/**
 * Whether an unverified user is blocked from booking.
 *
 * Off by default on purpose: while SES is in the sandbox it can only deliver
 * to addresses verified in AWS, so enforcing this would lock out every user
 * whose address is not already verified there. Turn it on once SES has
 * production access, via REQUIRE_EMAIL_VERIFICATION=true in .env.
 */
const REQUIRE_EMAIL_VERIFICATION = process.env.REQUIRE_EMAIL_VERIFICATION === 'true';

const SUPPORT_CATEGORIES = [
  { id: 'booking',  label: 'Booking issue',      hint: 'Seats, showtimes, or a booking that failed' },
  { id: 'payment',  label: 'Payment issue',      hint: 'Charges, refunds, or checkout problems' },
  { id: 'ticket',   label: 'Ticket / email',     hint: 'Ticket PDF or confirmation email not received' },
  { id: 'account',  label: 'Account access',     hint: 'Sign-in, password, or email verification' },
  { id: 'technical',label: 'Technical problem',  hint: 'Something on the site is broken' },
  { id: 'other',    label: 'Something else',     hint: 'Anything not covered above' },
];

const SUPPORT_STATUSES = ['open', 'in_progress', 'resolved', 'closed'];
const SUPPORT_PRIORITIES = ['low', 'normal', 'high'];

module.exports = {
  CITIES,
  languagesForCity,
  GENRES,
  LANGUAGES,
  CERTIFICATES,
  MOVIE_STATUS,
  BOOKING_WINDOW_DAYS,
  FILMS_PER_CITY,
  FILMS_PER_SCREEN_PER_DAY,
  CANCELLATION_CUTOFF_MINUTES,
  SEAT_HOLD_MINUTES,
  VERIFICATION_TOKEN_HOURS,
  PENDING_SIGNUP_TTL_HOURS,
  REQUIRE_EMAIL_VERIFICATION,
  SUPPORT_CATEGORIES,
  SUPPORT_STATUSES,
  SUPPORT_PRIORITIES,
};
