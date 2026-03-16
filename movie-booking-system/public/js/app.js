/* ============================================
   CineCloud — SPA Application Logic
   ============================================ */

// ==================== STATE ====================
const state = {
  token: localStorage.getItem('token') || null,
  user: JSON.parse(localStorage.getItem('user') || 'null'),
  currentView: 'movies',
  movies: [],
  selectedMovie: null,
  selectedShowtime: null,
  selectedSeats: [],
  bookedSeats: [],
  seatType: 'normal', // current selection mode
};

// ==================== API CLIENT ====================
const API_BASE = window.location.origin + '/api';

async function api(endpoint, options = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (state.token) headers['Authorization'] = `Bearer ${state.token}`;

  try {
    const res = await fetch(`${API_BASE}${endpoint}`, {
      ...options,
      headers: { ...headers, ...options.headers },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  } catch (err) {
    if (err.message.includes('Invalid or expired token')) {
      logout();
      toast('Session expired. Please login again.', 'error');
    }
    throw err;
  }
}

// ==================== AUTH ====================
function isLoggedIn() { return !!state.token && !!state.user; }
function isAdmin() { return state.user?.role === 'admin'; }

function login(token, user) {
  state.token = token;
  state.user = user;
  localStorage.setItem('token', token);
  localStorage.setItem('user', JSON.stringify(user));
  updateNavbar();
}

function logout() {
  state.token = null;
  state.user = null;
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  updateNavbar();
  navigate('movies');
}

// ==================== PRICE HELPERS ====================
function getPrice(movie, type) {
  if (!movie || !movie.price) return 0;
  if (typeof movie.price === 'number') return movie.price;
  return movie.price[type] || movie.price.normal || 0;
}

function getMinPrice(movie) {
  if (!movie || !movie.price) return 0;
  if (typeof movie.price === 'number') return movie.price;
  return movie.price.normal || 0;
}

// ==================== NAVIGATION ====================
function navigate(view, data) {
  state.currentView = view;
  if (data) {
    if (view === 'book') state.selectedMovie = data;
    if (view === 'editMovie') state.editingMovie = data;
  }

  if (view !== 'book') {
    state.selectedShowtime = null;
    state.selectedSeats = [];
    state.bookedSeats = [];
    state.seatType = 'normal';
  }

  if (['history', 'admin'].includes(view) && !isLoggedIn()) {
    toast('Please login first', 'error');
    view = 'login';
    state.currentView = 'login';
  }
  if (view === 'admin' && !isAdmin()) {
    toast('Admin access required', 'error');
    view = 'movies';
    state.currentView = 'movies';
  }

  updateNavbar();
  renderView();
}

function updateNavbar() {
  document.querySelectorAll('.nav-link').forEach(l => {
    l.classList.toggle('active', l.dataset.view === state.currentView);
  });

  const loginBtn = document.getElementById('loginBtn');
  const registerBtn = document.getElementById('registerBtn');
  const userMenu = document.getElementById('userMenu');
  const adminLink = document.getElementById('adminLink');
  const userName = document.getElementById('userName');
  const userAvatar = document.getElementById('userAvatar');

  if (isLoggedIn()) {
    loginBtn.style.display = 'none';
    registerBtn.style.display = 'none';
    userMenu.style.display = 'flex';
    userName.textContent = state.user.name;
    userAvatar.textContent = state.user.name.charAt(0).toUpperCase();
    adminLink.style.display = isAdmin() ? 'block' : 'none';
  } else {
    loginBtn.style.display = '';
    registerBtn.style.display = '';
    userMenu.style.display = 'none';
    adminLink.style.display = 'none';
  }
}

function toggleMobileNav() {
  document.getElementById('navbar').classList.toggle('nav-open');
}

// ==================== VIEW ROUTER ====================
function renderView() {
  const app = document.getElementById('app');
  app.style.opacity = '0';
  setTimeout(() => {
    switch (state.currentView) {
      case 'login': renderLogin(app); break;
      case 'register': renderRegister(app); break;
      case 'movies': renderMovies(app); break;
      case 'book': renderBooking(app); break;
      case 'history': renderHistory(app); break;
      case 'admin': renderAdmin(app); break;
      case 'editMovie': renderEditMovie(app); break;
      default: renderMovies(app);
    }
    app.style.opacity = '1';
    app.style.transition = 'opacity 0.3s ease';
  }, 150);
}

// ==================== LOGIN VIEW ====================
function renderLogin(container) {
  container.innerHTML = `
    <div class="form-container fade-in">
      <h2>Welcome Back</h2>
      <p class="form-subtitle">Sign in to book your favourite movies</p>
      <form id="loginForm">
        <div class="form-group">
          <label>Email</label>
          <input type="email" id="loginEmail" placeholder="your@email.com" required>
        </div>
        <div class="form-group">
          <label>Password</label>
          <input type="password" id="loginPassword" placeholder="Enter password" required>
        </div>
        <button type="submit" class="btn btn-primary btn-block btn-lg" id="loginSubmit">Sign In</button>
      </form>
      <p class="form-footer">
        Don't have an account? <a onclick="navigate('register')">Sign up</a>
      </p>
    </div>
  `;

  document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('loginSubmit');
    btn.disabled = true; btn.textContent = 'Signing in...';
    try {
      const data = await api('/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          email: document.getElementById('loginEmail').value,
          password: document.getElementById('loginPassword').value,
        }),
      });
      login(data.token, data.user);
      toast('Welcome back, ' + data.user.name + '! 🎬', 'success');
      navigate('movies');
    } catch (err) {
      toast(err.message, 'error');
      btn.disabled = false; btn.textContent = 'Sign In';
    }
  });
}

// ==================== REGISTER VIEW ====================
function renderRegister(container) {
  container.innerHTML = `
    <div class="form-container fade-in">
      <h2>Create Account</h2>
      <p class="form-subtitle">Join CineCloud and start booking!</p>
      <form id="registerForm">
        <div class="form-group">
          <label>Full Name</label>
          <input type="text" id="regName" placeholder="John Doe" required>
        </div>
        <div class="form-group">
          <label>Email</label>
          <input type="email" id="regEmail" placeholder="your@email.com" required>
        </div>
        <div class="form-group">
          <label>Password</label>
          <input type="password" id="regPassword" placeholder="Min 6 characters" minlength="6" required>
        </div>
        <button type="submit" class="btn btn-primary btn-block btn-lg" id="regSubmit">Create Account</button>
      </form>
      <p class="form-footer">
        Already have an account? <a onclick="navigate('login')">Sign in</a>
      </p>
    </div>
  `;

  document.getElementById('registerForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('regSubmit');
    btn.disabled = true; btn.textContent = 'Creating account...';
    try {
      await api('/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          name: document.getElementById('regName').value,
          email: document.getElementById('regEmail').value,
          password: document.getElementById('regPassword').value,
        }),
      });
      toast('Account created! Please sign in.', 'success');
      navigate('login');
    } catch (err) {
      toast(err.message, 'error');
      btn.disabled = false; btn.textContent = 'Create Account';
    }
  });
}

// ==================== MOVIES VIEW ====================
async function renderMovies(container) {
  container.innerHTML = `
    <div class="page-header fade-in">
      <h1>Now Showing</h1>
      <p>Choose a movie and book your seats instantly</p>
    </div>
    <div class="search-bar fade-in delay-1">
      <input type="text" class="search-input" id="movieSearch" placeholder="🔍 Search movies...">
      <div class="filter-chips" id="genreFilters"></div>
    </div>
    <div class="movie-grid" id="movieGrid">
      <div class="spinner"></div>
    </div>
  `;

  try {
    state.movies = await api('/movies');
    renderMovieGrid();

    const genres = ['All', ...new Set(state.movies.map(m => m.genre).filter(Boolean))];
    const filtersEl = document.getElementById('genreFilters');
    filtersEl.innerHTML = genres.map(g =>
      `<button class="chip ${g === 'All' ? 'active' : ''}" onclick="filterByGenre('${g}')">${g}</button>`
    ).join('');

    document.getElementById('movieSearch').addEventListener('input', (e) => {
      renderMovieGrid(e.target.value, document.querySelector('.chip.active')?.textContent);
    });
  } catch (err) {
    document.getElementById('movieGrid').innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">⚠️</div>
        <h3>Failed to load movies</h3>
        <p>${err.message}</p>
      </div>
    `;
  }
}

function filterByGenre(genre) {
  document.querySelectorAll('.chip').forEach(c => c.classList.toggle('active', c.textContent === genre));
  const search = document.getElementById('movieSearch')?.value || '';
  renderMovieGrid(search, genre);
}

function renderMovieGrid(search = '', genre = 'All') {
  let movies = state.movies;
  if (search) movies = movies.filter(m => m.title.toLowerCase().includes(search.toLowerCase()));
  if (genre && genre !== 'All') movies = movies.filter(m => m.genre === genre);

  const grid = document.getElementById('movieGrid');
  if (movies.length === 0) {
    grid.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1">
        <div class="empty-icon">🎬</div>
        <h3>No movies found</h3>
        <p>Try a different search or filter</p>
      </div>
    `;
    return;
  }

  grid.innerHTML = movies.map((movie, i) => `
    <div class="movie-card fade-in delay-${Math.min(i % 4 + 1, 3)}" onclick="navigate('book', ${JSON.stringify(movie).replace(/"/g, '&quot;')})">
      ${movie.posterUrl
        ? `<img src="${movie.posterUrl}" alt="${movie.title}" class="movie-poster" onerror="this.outerHTML='<div class=\\'movie-poster-placeholder\\'>🎬</div>'">`
        : '<div class="movie-poster-placeholder">🎬</div>'
      }
      <div class="movie-info">
        <h3>${movie.title}</h3>
        <div class="movie-meta">
          <span class="badge badge-genre">${movie.genre || 'Movie'}</span>
          ${movie.language ? `<span class="badge badge-lang">${movie.language}</span>` : ''}
          <span>⏱ ${movie.duration || '—'}</span>
        </div>
        ${movie.screen ? `<div style="font-size:11px;color:var(--text-secondary);margin-bottom:8px">📍 ${movie.screen}</div>` : ''}
        <div class="movie-price">₹${getMinPrice(movie)} <small>onwards</small></div>
      </div>
    </div>
  `).join('');
}

// ==================== BOOKING VIEW ====================
async function renderBooking(container) {
  const movie = state.selectedMovie;
  if (!movie) return navigate('movies');

  const priceNormal = getPrice(movie, 'normal');
  const priceSofa = getPrice(movie, 'sofa');
  const priceRecliner = getPrice(movie, 'recliner');

  container.innerHTML = `
    <button class="btn btn-ghost" onclick="navigate('movies')" style="margin-bottom: 20px">← Back to Movies</button>
    <div class="page-header fade-in">
      <h1>${movie.title}</h1>
      <p>${movie.description || ''}</p>
      <div style="margin-top:8px;font-size:13px;color:var(--text-secondary)">
        ${movie.genre ? `<span class="badge badge-genre">${movie.genre}</span>` : ''}
        ${movie.language ? `<span class="badge badge-lang" style="margin-left:6px">${movie.language}</span>` : ''}
        ${movie.screen ? `<span style="margin-left:12px">📍 ${movie.screen}</span>` : ''}
        ${movie.duration ? `<span style="margin-left:12px">⏱ ${movie.duration}</span>` : ''}
      </div>
    </div>

    <div class="showtime-picker fade-in delay-1">
      <h4>Select Showtime</h4>
      <div class="showtimes-list" id="showtimesList">
        ${(movie.showtimes || []).map(t => `
          <button class="showtime-btn" onclick="selectShowtime('${t}')">${t}</button>
        `).join('')}
      </div>
    </div>

    <div id="seatSection" style="display:none">
      <!-- Seat Type Selector -->
      <div class="seat-type-picker fade-in delay-2" id="seatTypePicker">
        <h4>Select Seat Type</h4>
        <div class="seat-type-options">
          <button class="seat-type-btn active" data-type="normal" onclick="changeSeatType('normal')">
            <span class="seat-type-icon">💺</span>
            <span class="seat-type-name">Normal</span>
            <span class="seat-type-price">₹${priceNormal}</span>
          </button>
          <button class="seat-type-btn" data-type="sofa" onclick="changeSeatType('sofa')">
            <span class="seat-type-icon">🛋️</span>
            <span class="seat-type-name">Sofa</span>
            <span class="seat-type-price">₹${priceSofa}</span>
          </button>
          <button class="seat-type-btn" data-type="recliner" onclick="changeSeatType('recliner')">
            <span class="seat-type-icon">🪑</span>
            <span class="seat-type-name">Recliner</span>
            <span class="seat-type-price">₹${priceRecliner}</span>
          </button>
        </div>
      </div>

      <div class="booking-layout fade-in delay-3">
        <div>
          <div class="screen-container">
            <div class="screen"></div>
            <div class="screen-label">Screen</div>
          </div>

          <div id="dynamicSeatGrids"></div>

          <div class="seat-legend">
            <div class="seat-legend-item"><div class="legend-box legend-available"></div> Available</div>
            <div class="seat-legend-item"><div class="legend-box legend-selected"></div> Selected</div>
            <div class="seat-legend-item"><div class="legend-box legend-booked"></div> Booked</div>
          </div>
        </div>

        <div class="booking-summary" id="bookingSummary">
          <h3>🎟 Booking Summary</h3>
          <div class="summary-row">
            <span class="label">Movie</span>
            <span class="value">${movie.title}</span>
          </div>
          <div class="summary-row">
            <span class="label">Showtime</span>
            <span class="value" id="summaryShowtime">—</span>
          </div>
          <div class="summary-row">
            <span class="label">Seats</span>
            <div>
              <span class="value" id="seatCount">0</span>
              <div class="selected-seats-display" id="selectedSeatsDisplay"></div>
            </div>
          </div>
          <div id="priceBreakdown"></div>
          <div class="summary-row summary-total">
            <span class="label" style="font-weight:600">Total</span>
            <span class="value" id="totalPrice">₹0</span>
          </div>
          <button class="btn btn-primary btn-block btn-lg" id="confirmBooking"
                  onclick="confirmBooking()" disabled style="margin-top:20px">
            ${isLoggedIn() ? 'Confirm Booking' : 'Login to Book'}
          </button>
        </div>
      </div>
    </div>
  `;

  // Hide type picker if Luxe screen (all sofa)
  if (movie.screenType === 'luxe') {
    document.getElementById('seatTypePicker').style.display = 'none';
    state.seatType = 'sofa';
  }
}

// Seat layout config
const SEAT_LAYOUT = {
  recliner: { rows: ['I', 'J'], cols: 8, type: 'recliner', label: '🪑 Recliner' },
  sofa:     { rows: ['G', 'H'], cols: 10, type: 'sofa', label: '🛋️ Sofa' },
  normal:   { rows: ['A', 'B', 'C', 'D', 'E', 'F'], cols: 12, type: 'normal', label: '💺 Normal' },
};

function changeSeatType(type) {
  state.seatType = type;
  document.querySelectorAll('.seat-type-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.type === type);
  });
}

async function selectShowtime(time) {
  state.selectedShowtime = time;
  state.selectedSeats = [];
  state.bookedSeats = [];

  document.querySelectorAll('.showtime-btn').forEach(b => {
    b.classList.toggle('active', b.textContent.trim() === time);
  });

  document.getElementById('seatSection').style.display = 'block';
  document.getElementById('summaryShowtime').textContent = time;

  try {
    const data = await api(`/bookings/seats/${state.selectedMovie.movieId}/${encodeURIComponent(time)}`);
    state.bookedSeats = data.bookedSeats || [];
  } catch (err) {
    console.error('Failed to fetch seats:', err);
  }

  renderAllSeatGrids();
  updateBookingSummary();
}

function renderAllSeatGrids() {
  const container = document.getElementById('dynamicSeatGrids');
  const movie = state.selectedMovie;
  const isLuxe = movie.screenType === 'luxe';

  let html = '';

  if (isLuxe) {
    // Luxe screens: all rows are Sofa. A-J rows.
    html += `<div class="seat-section-label">🛋️ LUXE (All Sofa) — ₹${getPrice(movie, 'sofa')}</div>`;
    html += `<div class="seat-grid" id="seatGridLuxe"></div>`;
  } else {
    // Normal layout matching cinema: Normal (front), Sofa (middle), Recliner (back)
    html += `<div class="seat-section-label">${SEAT_LAYOUT.normal.label} — ₹${getPrice(movie, 'normal')}</div>`;
    html += `<div class="seat-grid" id="seatGridNormal"></div>`;

    html += `<div class="seat-section-label">${SEAT_LAYOUT.sofa.label} — ₹${getPrice(movie, 'sofa')}</div>`;
    html += `<div class="seat-grid" id="seatGridSofa"></div>`;

    html += `<div class="seat-section-label">${SEAT_LAYOUT.recliner.label} — ₹${getPrice(movie, 'recliner')}</div>`;
    html += `<div class="seat-grid" id="seatGridRecliner"></div>`;
  }

  container.innerHTML = html;

  if (isLuxe) {
    renderSeatSection('seatGridLuxe', { rows: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'], cols: 10, type: 'sofa' });
  } else {
    renderSeatSection('seatGridNormal', SEAT_LAYOUT.normal);
    renderSeatSection('seatGridSofa', SEAT_LAYOUT.sofa);
    renderSeatSection('seatGridRecliner', SEAT_LAYOUT.recliner);
  }
}

function renderSeatSection(containerId, layout) {
  const container = document.getElementById(containerId);
  if (!container) return;

  container.innerHTML = layout.rows.map(row => {
    const seats = [];
    for (let c = 1; c <= layout.cols; c++) {
      const seatId = `${row}${c}`;
      const isBooked = state.bookedSeats.includes(seatId);
      const seatData = state.selectedSeats.find(s => s.id === seatId);
      const isSelected = !!seatData;
      let cls = `seat seat-${layout.type}`;
      if (isBooked) cls += ' seat-booked';
      else if (isSelected) cls += ' seat-selected';
      seats.push(`<div class="${cls}" onclick="toggleSeat('${seatId}','${layout.type}')" title="${seatId} (${layout.type})">${seatId}</div>`);
    }
    return `
      <div class="seat-row">
        <span class="seat-row-label">${row}</span>
        ${seats.join('')}
        <span class="seat-row-label">${row}</span>
      </div>
    `;
  }).join('');
}

function toggleSeat(seatId, type) {
  if (!isLoggedIn()) {
    toast('Please login to select seats', 'error');
    return navigate('login');
  }
  if (state.bookedSeats.includes(seatId)) return;

  const index = state.selectedSeats.findIndex(s => s.id === seatId);
  if (index > -1) {
    state.selectedSeats.splice(index, 1);
  } else {
    if (state.selectedSeats.length >= 10) {
      toast('Maximum 10 seats per booking', 'error');
      return;
    }
    state.selectedSeats.push({ id: seatId, type: type });
  }

  renderAllSeatGrids();
  updateBookingSummary();
}

function updateBookingSummary() {
  const movie = state.selectedMovie;
  const count = state.selectedSeats.length;

  // Calculate total with different seat type prices
  let total = 0;
  const breakdown = { normal: 0, sofa: 0, recliner: 0 };
  state.selectedSeats.forEach(s => {
    const p = getPrice(movie, s.type);
    total += p;
    breakdown[s.type]++;
  });

  document.getElementById('seatCount').textContent = count;
  document.getElementById('totalPrice').textContent = `₹${total}`;
  document.getElementById('selectedSeatsDisplay').innerHTML =
    state.selectedSeats.map(s => {
      const emoji = s.type === 'recliner' ? '🪑' : s.type === 'sofa' ? '🛋️' : '💺';
      return `<span class="seat-tag seat-tag-${s.type}">${emoji} ${s.id}</span>`;
    }).join('');

  // Price breakdown
  const breakdownEl = document.getElementById('priceBreakdown');
  const lines = [];
  if (breakdown.normal > 0) lines.push(`<div class="summary-row"><span class="label">Normal × ${breakdown.normal}</span><span class="value">₹${breakdown.normal * getPrice(movie, 'normal')}</span></div>`);
  if (breakdown.sofa > 0) lines.push(`<div class="summary-row"><span class="label">Sofa × ${breakdown.sofa}</span><span class="value">₹${breakdown.sofa * getPrice(movie, 'sofa')}</span></div>`);
  if (breakdown.recliner > 0) lines.push(`<div class="summary-row"><span class="label">Recliner × ${breakdown.recliner}</span><span class="value">₹${breakdown.recliner * getPrice(movie, 'recliner')}</span></div>`);
  breakdownEl.innerHTML = lines.join('');

  const btn = document.getElementById('confirmBooking');
  if (!isLoggedIn()) {
    btn.textContent = 'Login to Book';
    btn.disabled = false;
    btn.onclick = () => navigate('login');
  } else {
    btn.textContent = count > 0 ? `Pay ₹${total} & Book` : 'Select seats';
    btn.disabled = count === 0;
    btn.onclick = confirmBooking;
  }
}

async function confirmBooking() {
  if (!isLoggedIn()) return navigate('login');
  if (state.selectedSeats.length === 0) return;

  const movie = state.selectedMovie;
  let total = 0;
  state.selectedSeats.forEach(s => { total += getPrice(movie, s.type); });

  const btn = document.getElementById('confirmBooking');
  btn.disabled = true; btn.textContent = 'Initializing Payment...';

  // Razorpay Test Integration
  const options = {
    "key": "rzp_test_1DP5mmOlF5G5ag", // Razorpay Test Key (dummy/public test key)
    "amount": total * 100, // paise
    "currency": "INR",
    "name": "CineCloud",
    "description": `Ticket for ${movie.title}`,
    "image": "https://cdn-icons-png.flaticon.com/512/3658/3658959.png",
    "handler": async function (response) {
      toast('Payment successful! Confirming booking...', 'success');
      btn.textContent = 'Booking...';

      try {
        const result = await api('/bookings', {
          method: 'POST',
          body: JSON.stringify({
            movieId: movie.movieId,
            movieTitle: movie.title,
            showtime: state.selectedShowtime,
            seats: state.selectedSeats.map(s => s.id),
            seatDetails: state.selectedSeats,
            totalPrice: total,
            paymentId: response.razorpay_payment_id
          }),
        });
        toast('🎉 ' + result.message, 'success');
        navigate('history');
      } catch (err) {
        toast(err.message, 'error');
        btn.disabled = false;
        btn.textContent = `Pay ₹${total} & Book`;
        selectShowtime(state.selectedShowtime); // refresh seats in case of conflict
      }
    },
    "prefill": {
      "name": state.user?.name || "",
      "email": state.user?.email || "",
      "contact": "9999999999"
    },
    "theme": {
      "color": "#7c3aed"
    },
    "modal": {
      "ondismiss": function() {
        toast('Payment cancelled', 'info');
        btn.disabled = false;
        btn.textContent = `Pay ₹${total} & Book`;
      }
    }
  };

  const rzp1 = new window.Razorpay(options);
  rzp1.on('payment.failed', function (response){
    toast(response.error.description, 'error');
    btn.disabled = false;
    btn.textContent = `Pay ₹${total} & Book`;
  });
  
  rzp1.open();
}

// ==================== HISTORY VIEW ====================
async function renderHistory(container) {
  container.innerHTML = `
    <div class="page-header fade-in">
      <h1>My Bookings</h1>
      <p>Your movie ticket history</p>
    </div>
    <div class="booking-list" id="bookingList">
      <div class="spinner"></div>
    </div>
  `;

  loadBookings();
}

async function loadBookings() {
  try {
    const bookings = await api('/bookings');
    const list = document.getElementById('bookingList');

    if (bookings.length === 0) {
      list.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">🎟</div>
          <h3>No bookings yet</h3>
          <p>Browse movies and make your first booking!</p>
          <button class="btn btn-primary" onclick="navigate('movies')" style="margin-top:16px">Browse Movies</button>
        </div>
      `;
      return;
    }

    list.innerHTML = bookings.map((b, i) => `
      <div class="ticket-card fade-in delay-${Math.min(i + 1, 3)}">
        <div class="ticket-icon">🎬</div>
        <div class="ticket-details">
          <h4>${b.movieTitle || 'Movie'}</h4>
          <p>📅 ${b.showtime} &nbsp;•&nbsp; 💺 ${(b.seats || []).join(', ')}</p>
          <p>🕐 ${new Date(b.bookedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
        </div>
        <div style="text-align: right">
          <span class="ticket-status status-confirmed">${b.status || 'Confirmed'}</span>
          <div style="margin: 8px 0; font-weight:800;color:var(--success)">₹${b.totalPrice || 0}</div>
          <button class="btn btn-danger btn-sm" onclick="cancelBooking('${b.bookingId}')">Cancel Booking</button>
        </div>
      </div>
    `).join('');
  } catch (err) {
    document.getElementById('bookingList').innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">⚠️</div>
        <h3>Failed to load bookings</h3>
        <p>${err.message}</p>
      </div>
    `;
  }
}

async function cancelBooking(bookingId) {
  if (!confirm('Are you sure you want to cancel this booking? This action cannot be undone and seats will be released.')) return;

  try {
    await api(`/bookings/${bookingId}`, { method: 'DELETE' });
    toast('Booking cancelled successfully! Seals are released.', 'success');
    loadBookings(); // refresh list
  } catch (err) {
    toast('Failed to cancel: ' + err.message, 'error');
  }
}

// ==================== ADMIN VIEW ====================
async function renderAdmin(container) {
  container.innerHTML = `
    <div class="page-header fade-in">
      <h1>Admin Panel</h1>
      <p>Manage movies and view bookings</p>
    </div>
    <div class="stats-row fade-in delay-1" id="adminStats"><div class="spinner"></div></div>
    <div class="admin-grid fade-in delay-2">
      <div class="admin-section">
        <h3>➕ Add New Movie</h3>
        <form id="addMovieForm">
          <div class="form-group">
            <label>Title</label>
            <input type="text" id="movieTitle" placeholder="Movie title" required>
          </div>
          <div class="form-group">
            <label>Genre</label>
            <select id="movieGenre">
              <option value="Action">Action</option>
              <option value="Sci-Fi">Sci-Fi</option>
              <option value="Drama">Drama</option>
              <option value="Comedy">Comedy</option>
              <option value="Horror">Horror</option>
              <option value="Horror Comedy">Horror Comedy</option>
              <option value="Romance">Romance</option>
              <option value="Thriller">Thriller</option>
              <option value="Animation">Animation</option>
            </select>
          </div>
          <div class="form-group">
            <label>Language</label>
            <select id="movieLanguage">
              <option value="Hindi">Hindi</option>
              <option value="English">English</option>
              <option value="Tamil">Tamil</option>
              <option value="Telugu">Telugu</option>
              <option value="Malayalam">Malayalam</option>
            </select>
          </div>
          <div class="form-group">
            <label>Duration</label>
            <input type="text" id="movieDuration" placeholder="e.g. 2h 30m">
          </div>
          <div class="form-group">
            <label>Screen</label>
            <select id="movieScreen">
              <option value="Screen 1 — IMAX">Screen 1 — IMAX</option>
              <option value="Screen 2 — Dolby Atmos">Screen 2 — Dolby Atmos</option>
              <option value="Screen 3 — 4DX">Screen 3 — 4DX</option>
              <option value="Screen 4 — Standard">Screen 4 — Standard</option>
            </select>
          </div>
          <div class="form-group">
            <label>Base Price ₹ (Normal — Sofa & Recliner auto-calculated)</label>
            <input type="number" id="moviePrice" placeholder="200" required>
          </div>
          <div class="form-group">
            <label>Showtimes (comma-separated)</label>
            <input type="text" id="movieShowtimes" placeholder="10:00 AM, 2:00 PM, 6:00 PM, 9:30 PM" required>
          </div>
          <div class="form-group">
            <label>Poster URL (optional)</label>
            <input type="url" id="moviePoster" placeholder="https://...">
          </div>
          <div class="form-group">
            <label>Description (optional)</label>
            <textarea id="movieDesc" rows="3" placeholder="Brief description..."></textarea>
          </div>
          <button type="submit" class="btn btn-primary btn-block" id="addMovieBtn">Add Movie</button>
        </form>
      </div>
      <div class="admin-section">
        <h3>🎬 Current Movies</h3>
        <div id="adminMovieList"><div class="spinner"></div></div>
      </div>
    </div>
  `;

  try {
    const [movies, bookings] = await Promise.all([api('/movies'), api('/bookings')]);
    const totalRevenue = bookings.reduce((sum, b) => sum + (b.totalPrice || 0), 0);

    document.getElementById('adminStats').innerHTML = `
      <div class="stat-card"><div class="stat-value">${movies.length}</div><div class="stat-label">Total Movies</div></div>
      <div class="stat-card"><div class="stat-value">${bookings.length}</div><div class="stat-label">Total Bookings</div></div>
      <div class="stat-card"><div class="stat-value">₹${totalRevenue.toLocaleString()}</div><div class="stat-label">Total Revenue</div></div>
    `;

    const movieList = document.getElementById('adminMovieList');
    if (movies.length === 0) {
      movieList.innerHTML = '<p style="color:var(--text-secondary)">No movies added yet</p>';
    } else {
      movieList.innerHTML = movies.map(m => `
        <div class="admin-movie-item">
          <div>
            <strong>${m.title}</strong>
            <div style="font-size:12px;color:var(--text-secondary)">${m.genre} • ${m.language || ''} • ₹${getMinPrice(m)}+ • ${m.screen || ''}</div>
          </div>
          <div style="display:flex;gap:6px">
            <button class="btn btn-ghost btn-sm" onclick='navigate("editMovie", ${JSON.stringify(m).replace(/'/g, "\\'")})'>✏️ Edit</button>
            <button class="btn btn-danger btn-sm" onclick="deleteMovie('${m.movieId}', '${m.title.replace(/'/g, "\\'")}')">🗑 Delete</button>
          </div>
        </div>
      `).join('');
    }
  } catch (err) {
    document.getElementById('adminStats').innerHTML = '';
    toast('Failed to load admin data: ' + err.message, 'error');
  }

  // Add movie form
  document.getElementById('addMovieForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('addMovieBtn');
    btn.disabled = true; btn.textContent = 'Adding...';
    try {
      await api('/movies', {
        method: 'POST',
        body: JSON.stringify({
          title: document.getElementById('movieTitle').value,
          genre: document.getElementById('movieGenre').value,
          language: document.getElementById('movieLanguage').value,
          duration: document.getElementById('movieDuration').value,
          price: document.getElementById('moviePrice').value,
          showtimes: document.getElementById('movieShowtimes').value,
          screen: document.getElementById('movieScreen').value,
          posterUrl: document.getElementById('moviePoster').value,
          description: document.getElementById('movieDesc').value,
        }),
      });
      toast('Movie added successfully! 🎬', 'success');
      renderAdmin(document.getElementById('app'));
    } catch (err) {
      toast(err.message, 'error');
      btn.disabled = false; btn.textContent = 'Add Movie';
    }
  });
}

async function deleteMovie(movieId, title) {
  if (!confirm(`Delete "${title}"?`)) return;
  try {
    await api(`/movies/${movieId}`, { method: 'DELETE' });
    toast('Movie deleted', 'success');
    renderAdmin(document.getElementById('app'));
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ==================== EDIT MOVIE VIEW ====================
function renderEditMovie(container) {
  const m = state.editingMovie;
  if (!m) return navigate('admin');

  const basePrice = typeof m.price === 'number' ? m.price : (m.price?.normal || 0);

  container.innerHTML = `
    <button class="btn btn-ghost" onclick="navigate('admin')" style="margin-bottom: 20px">← Back to Admin</button>
    <div class="form-container fade-in" style="max-width:560px">
      <h2>Edit Movie</h2>
      <p class="form-subtitle">Update "${m.title}"</p>
      <form id="editMovieForm">
        <div class="form-group">
          <label>Title</label>
          <input type="text" id="editTitle" value="${m.title || ''}" required>
        </div>
        <div class="form-group">
          <label>Genre</label>
          <select id="editGenre">
            ${['Action','Sci-Fi','Drama','Comedy','Horror','Horror Comedy','Romance','Thriller','Animation'].map(g =>
              `<option value="${g}" ${m.genre === g ? 'selected' : ''}>${g}</option>`
            ).join('')}
          </select>
        </div>
        <div class="form-group">
          <label>Language</label>
          <select id="editLanguage">
            ${['Hindi','English','Tamil','Telugu','Malayalam'].map(l =>
              `<option value="${l}" ${m.language === l ? 'selected' : ''}>${l}</option>`
            ).join('')}
          </select>
        </div>
        <div class="form-group">
          <label>Duration</label>
          <input type="text" id="editDuration" value="${m.duration || ''}">
        </div>
        <div class="form-group">
          <label>Screen</label>
          <select id="editScreen">
            ${['Screen 1 — IMAX','Screen 2 — Dolby Atmos','Screen 3 — 4DX','Screen 4 — Standard'].map(s =>
              `<option value="${s}" ${m.screen === s ? 'selected' : ''}>${s}</option>`
            ).join('')}
          </select>
        </div>
        <div class="form-group">
          <label>Base Price ₹ (Normal)</label>
          <input type="number" id="editPrice" value="${basePrice}" required>
        </div>
        <div class="form-group">
          <label>Showtimes (comma-separated)</label>
          <input type="text" id="editShowtimes" value="${(m.showtimes || []).join(', ')}" required>
        </div>
        <div class="form-group">
          <label>Poster URL</label>
          <input type="url" id="editPoster" value="${m.posterUrl || ''}">
        </div>
        <div class="form-group">
          <label>Description</label>
          <textarea id="editDesc" rows="3">${m.description || ''}</textarea>
        </div>
        <button type="submit" class="btn btn-primary btn-block btn-lg" id="editMovieBtn">Save Changes</button>
      </form>
    </div>
  `;

  document.getElementById('editMovieForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('editMovieBtn');
    btn.disabled = true; btn.textContent = 'Saving...';
    try {
      await api(`/movies/${m.movieId}`, {
        method: 'PUT',
        body: JSON.stringify({
          title: document.getElementById('editTitle').value,
          genre: document.getElementById('editGenre').value,
          language: document.getElementById('editLanguage').value,
          duration: document.getElementById('editDuration').value,
          price: document.getElementById('editPrice').value,
          showtimes: document.getElementById('editShowtimes').value,
          screen: document.getElementById('editScreen').value,
          posterUrl: document.getElementById('editPoster').value,
          description: document.getElementById('editDesc').value,
        }),
      });
      toast('Movie updated! ✅', 'success');
      navigate('admin');
    } catch (err) {
      toast(err.message, 'error');
      btn.disabled = false; btn.textContent = 'Save Changes';
    }
  });
}

// ==================== TOAST NOTIFICATIONS ====================
function toast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateX(100px)';
    el.style.transition = 'all 0.3s ease';
    setTimeout(() => el.remove(), 300);
  }, 4000);
}

// ==================== INIT ====================
document.addEventListener('DOMContentLoaded', () => {
  updateNavbar();
  navigate('movies');
});
