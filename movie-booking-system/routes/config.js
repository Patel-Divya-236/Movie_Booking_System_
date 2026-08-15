const express = require('express');
const {
  CITIES, GENRES, LANGUAGES, CERTIFICATES, BOOKING_WINDOW_DAYS,
  SUPPORT_CATEGORIES, SUPPORT_STATUSES, REQUIRE_EMAIL_VERIFICATION,
} = require('../config/catalog');
const { LAYOUTS } = require('../config/seatLayouts');
const { PASSWORD_RULES } = require('../config/validation');
const { FORMATS, CONVENIENCE_FEE_PER_TICKET, GST_RATE, MAX_SEATS_PER_BOOKING } = require('../config/pricing');

const router = express.Router();

/**
 * GET /api/config
 * Everything the browser needs to render forms and seat grids, served from the
 * same modules the server validates against so the two cannot drift apart.
 */
router.get('/', (req, res) => {
  res.json({
    cities: CITIES,
    genres: GENRES,
    languages: LANGUAGES,
    certificates: CERTIFICATES,
    formats: FORMATS,
    layouts: LAYOUTS,
    bookingWindowDays: BOOKING_WINDOW_DAYS,
    supportCategories: SUPPORT_CATEGORIES,
    supportStatuses: SUPPORT_STATUSES,
    requireEmailVerification: REQUIRE_EMAIL_VERIFICATION,
    passwordRules: PASSWORD_RULES,
    fees: {
      conveniencePerTicket: CONVENIENCE_FEE_PER_TICKET,
      gstRate: GST_RATE,
      maxSeatsPerBooking: MAX_SEATS_PER_BOOKING,
    },
  });
});

module.exports = router;
