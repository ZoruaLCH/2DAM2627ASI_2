const state = {
  data: null,
  favorites: safeJSON(localStorage.getItem('pinto_favorites'), []),
  maps: {},
  currentRoute: 'inicio',
  quizIndex: 0,
  quizScore: 0,
  searchIndex: [],
  lastFocused: null,
  toastTimer: null,
  countdownTimer: null
};

function safeJSON(str, fallback) {
  try { return JSON.parse(str) ?? fallback; } catch { return fallback; }
}
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}
function prefersReduced() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
function safeStorageSet(key, val) {
  try { localStorage.setItem(key, val); } catch { }
}

document.addEventListener('DOMContentLoaded', async () => {
  initTheme();
  initHeaderAndScroll();
  initNavigation();
  bindGlobalModalListeners();
  initLightbox();

  try {
    const res = await fetch('data.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    state.data = await res.json();
    state.data.events = resolveEvents(state.data.events);

    const ids = new Set(state.data.places.map(p => p.id));
    state.favorites = state.favorites.filter(id => ids.has(id));
    safeStorageSet('pinto_favorites', JSON.stringify(state.favorites));

    buildSearchIndex();
    renderAllContent();
    initGlobalSearch();
    initCountdown();
    initStatsCounter();
    initRevealObserver();
    initMaps();
    updateFavoritesBadge();

    handleInitialHash();
  } catch (err) {
    console.error('Error cargando datos:', err);
    showToast('Error al cargar los datos. Abre la web con un servidor local (Live Server).', 'error');
  }
});

function handleInitialHash() {
  const hash = location.hash.slice(1);
  if (!hash) {
    navigateTo('inicio', null, { pushHash: false });
    return;
  }
  
  // Comprobamos si el hash es el ID de un lugar (ej: lago-wakeboard-centro-hipico)
  const isPlace = state.data.places.some(p => p.id === hash);
  
  if (isPlace) {
    // Si es un lugar, navegamos al inicio y abrimos el modal
    navigateTo('inicio', null, { pushHash: false });
    setTimeout(() => openPlaceModal(hash), 300);
  } else {
    // Si es una sección (ej: que-ver), navegamos allí
    navigateTo(hash, null, { pushHash: false });
  }
}

function initTheme() {
  const saved = localStorage.getItem('pinto_theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const theme = saved || (prefersDark ? 'dark' : 'light');
  document.documentElement.setAttribute('data-theme', theme);
  updateThemeColorMeta(theme);

  document.getElementById('theme-toggle')?.addEventListener('click', () => {
    const cur = document.documentElement.getAttribute('data-theme');
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    safeStorageSet('pinto_theme', next);
    updateThemeColorMeta(next);
  });
}

function updateThemeColorMeta(theme) {
  let meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'theme-color';
    document.head.appendChild(meta);
  }
  meta.content = theme === 'dark' ? '#121212' : '#C8102E';
}

function initHeaderAndScroll() {
  const header = document.getElementById('site-header');
  const heroBg = document.getElementById('hero-bg');
  const backToTop = document.getElementById('back-to-top');
  let ticking = false;

  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      const y = window.scrollY;
      header.classList.toggle('scrolled', y > 40);
      backToTop.classList.toggle('visible', y > 450);
      if (!prefersReduced() && state.currentRoute === 'inicio' && heroBg && y < window.innerHeight) {
        heroBg.style.transform = `translateY(${Math.min(y * 0.15, window.innerHeight * 0.15)}px)`;
      }
      ticking = false;
    });
  };
window.addEventListener('popstate', e => {
  const stateData = e.state;
  const hash = location.hash.slice(1);

  if (stateData?.placeId) {
    const targetRoute = stateData.route || state.currentRoute || 'inicio';
    if (document.getElementById(`view-${targetRoute}`) && state.currentRoute !== targetRoute) {
      navigateTo(targetRoute, null, { pushHash: false });
    }
    openPlaceModal(stateData.placeId, { pushState: false });
    return;
  }

  // Si veníamos de un modal abierto y retrocedimos, lo cerramos
  const modal = document.getElementById('detail-modal');
  if (modal && !modal.hidden) {
    modal.hidden = true;
    document.body.style.overflow = '';
    state.lastFocused?.focus?.();
  }

  if (state.data?.places?.some(p => p.id === hash)) {
    openPlaceModal(hash, { pushState: false });
    return;
  }

  navigateTo(hash || 'inicio', null, { pushHash: false });
});

  backToTop.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: prefersReduced() ? 'auto' : 'smooth' });
  });
}

const norm = s => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const MESES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

/* Calcula día, mes y estado de cada evento a partir de `date` (ISO, con hora opcional),
   `end` (opcional) y `recurring`. Oculta los eventos puntuales ya pasados y ordena por fecha. */
function resolveEvents(list, now = new Date()) {
  const sod = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const parse = s => { const [d, t = '00:00'] = s.split('T'); const [y, m, dd] = d.split('-').map(Number); const [hh, mi] = t.split(':').map(Number); return new Date(y, m - 1, dd, hh, mi); };
  const today = sod(now);
  return list.map(e => {
    if (!e.date) return { ...e, _t: null };
    const t = parse(e.date);
    const end = e.end ? parse(e.end + 'T23:59') : new Date(t.getFullYear(), t.getMonth(), t.getDate(), 23, 59, 59);
    if (e.recurring) while (end < now) { t.setFullYear(t.getFullYear() + 1); end.setFullYear(end.getFullYear() + 1); }
    if (end < now) return null;
    const days = Math.round((sod(t) - today) / 864e5);
    const status = t <= now ? (e.end ? 'En curso' : 'Hoy')
      : days <= 7 ? 'Esta semana'
      : (e.recurring && days > 60) ? 'Cada año' : 'Próximamente';
    return { ...e, day: String(t.getDate()).padStart(2, '0'), month: MESES[t.getMonth()], status, _t: t };
  }).filter(Boolean).sort((a, b) => a._t && b._t ? a._t - b._t : a._t ? -1 : b._t ? 1 : 0);
}

function initNavigation() {
  const menuToggle = document.getElementById('menu-toggle');
  const mainNav = document.getElementById('main-nav');
  const navOverlay = document.getElementById('nav-overlay');
  const closeNavBtn = document.getElementById('close-nav-btn');

  const openMenu = () => {
    mainNav.classList.add('open');
    navOverlay.classList.add('show');
    menuToggle.setAttribute('aria-expanded', 'true');
    document.body.style.overflow = 'hidden'; 
  };
  
  const closeMenu = () => {
    mainNav.classList.remove('open');
    navOverlay.classList.remove('show');
    menuToggle.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
  };

  menuToggle?.addEventListener('click', openMenu);
  closeNavBtn?.addEventListener('click', closeMenu);
  navOverlay?.addEventListener('click', closeMenu);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && mainNav.classList.contains('open')) { closeMenu(); menuToggle?.focus(); }
  });
  window.matchMedia('(min-width: 1101px)').addEventListener('change', e => { if (e.matches) closeMenu(); });

document.addEventListener('click', e => {
    const routeLink = e.target.closest('[data-route]');
    const themeCard = e.target.closest('[data-nav-filter]');

    if (routeLink || themeCard) {
      if (routeLink) {
        e.preventDefault();
        navigateTo(routeLink.dataset.route);
      } else if (themeCard) {
        e.preventDefault();
        const [route, filter] = themeCard.dataset.navFilter.split(':');
        navigateTo(route, filter);
      }

      if (mainNav.classList.contains('open')) {
        closeMenu();
      }
      return;
    }

    if (!mainNav.contains(e.target) && !menuToggle.contains(e.target) && !navOverlay.contains(e.target)) {
      closeMenu();
    }
  });
}

function navigateTo(route, presetFilter = null, { pushHash = true } = {}) {
  if (!document.getElementById(`view-${route}`)) route = 'inicio';
  state.currentRoute = route;

  if (pushHash && location.hash !== `#${route}`) {
    history.pushState(null, '', `#${route}`);
  }

  // 1. Ocultamos todas las vistas y mostramos la nueva
  document.querySelectorAll('.spa-view').forEach(s => s.classList.remove('active'));
  document.getElementById(`view-${route}`)?.classList.add('active');

  document.querySelectorAll('.nav-link').forEach(l => {
    l.classList.toggle('active', l.dataset.route === route);
  });

  document.getElementById('site-header').classList.toggle('solid-mode', route !== 'inicio');

  // 2. FORZAMOS EL SCROLL ARRIBA DEL TODO (instantáneo)
  // Usamos 'instant' para que no haya conflicto con la animación de cambio de vista
  window.scrollTo({ top: 0, left: 0, behavior: 'instant' });

  if (presetFilter && presetFilter !== 'all') {
    const container = document.getElementById(`view-${route}`);
    const chip = container?.querySelector(`.chip[data-filter="${presetFilter}"]`);
    if (chip) chip.click();
  }

  setTimeout(() => {
    if (route === 'info-practica' && state.maps.full) state.maps.full.invalidateSize();
    if (route === 'inicio' && state.maps.home) state.maps.home.invalidateSize();
  }, 220);

  if (route === 'favoritos') renderFavoritesView();
}
function renderAllContent() {
  const { places, events, barrios, curiosities, gastroAndLodging, quiz } = state.data;

  const featured = places.filter(p => p.featured);
  const carousel = document.getElementById('imprescindibles-carousel');
  if (carousel) {
    carousel.innerHTML = featured.map(createPlaceCardHTML).join('');
    initCarouselControls(carousel);
  }

  const queVer = places.filter(p => p.section === 'que-ver');
  renderFilteredPlaces('que-ver-grid', queVer, 'all');
  setupFilterChips('view-que-ver', 'que-ver-grid', queVer);

  const queHacer = places.filter(p => p.section === 'que-hacer');
  renderFilteredPlaces('que-hacer-grid', queHacer, 'all');
  setupFilterChips('view-que-hacer', 'que-hacer-grid', queHacer);

  const comer = gastroAndLodging.filter(i => i.type === 'comer');
  const dormir = gastroAndLodging.filter(i => i.type === 'dormir');
  if (document.getElementById('comer-list')) document.getElementById('comer-list').innerHTML = comer.map(createHorizontalCardHTML).join('');
  if (document.getElementById('alojamientos-list')) document.getElementById('alojamientos-list').innerHTML = dormir.map(createHorizontalCardHTML).join('');

  if (document.getElementById('fiestas-grid')) document.getElementById('fiestas-grid').innerHTML = events.map(createEventCardHTML).join('');
  if (document.getElementById('home-events-list')) document.getElementById('home-events-list').innerHTML = events.slice(0, 3).map(createEventCardHTML).join('');
  if (document.getElementById('barrios-grid')) document.getElementById('barrios-grid').innerHTML = barrios.map(createBarrioCardHTML).join('');

  if (document.getElementById('curiosidades-grid')) {
    document.getElementById('curiosidades-grid').innerHTML = curiosities.map(c => `
      <div class="flip-card" tabindex="0" role="button" aria-label="Dato curioso: ${escapeHtml(c.question)}.">
        <div class="flip-card-inner">
          <div class="flip-front">
            <span class="badge-gold">¿Sabías qué?</span>
            <h3>${escapeHtml(c.question)}</h3>
          </div>
          <div class="flip-back"><p>${escapeHtml(c.answer)}</p></div>
        </div>
      </div>
    `).join('');

    document.querySelectorAll('.flip-card').forEach(card => {
      const toggle = () => card.classList.toggle('flipped');
      card.addEventListener('click', toggle);
      card.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
      });
    });
  }

  renderQuizQuestion(quiz);
  document.body.addEventListener('click', handleGlobalCardActions);
}

function getPlaceholderSVG(label) {
  const safe = encodeURIComponent(`Imagen: ${label}`);
  return `data:image/svg+xml;charset=UTF-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='800' height='500' viewBox='0 0 800 500'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0' y1='0' x2='1' y2='1'%3E%3Cstop offset='0%25' stop-color='%230F4C81'/%3E%3Cstop offset='100%25' stop-color='%239B0B22'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='800' height='500' fill='url(%23g)'/%3E%3Ctext x='50%25' y='48%25' fill='%23FFFFFF' font-family='sans-serif' font-size='24' font-weight='bold' text-anchor='middle'%3E${safe}%3C/text%3E%3C/svg%3E`;
}

function createPlaceCardHTML(place) {
  const isFav = state.favorites.includes(place.id);
  const fallback = getPlaceholderSVG(place.title);
  const title = escapeHtml(place.title);
  return `
    <article class="place-card" data-id="${escapeHtml(place.id)}">
      <div class="card-media">
        <span class="card-tag">${escapeHtml(place.category)}</span>
        <button type="button" class="fav-btn ${isFav ? 'active' : ''}" data-fav-id="${escapeHtml(place.id)}" aria-label="${isFav ? 'Quitar' : 'Añadir'} favorito">
          ${isFav ? '♥' : '♡'}
        </button>
        <img src="${escapeHtml(place.image)}" alt="${title} en Pinto" loading="lazy" onload="this.parentElement.classList.add('loaded')" onerror="this.onerror=null; this.src='${fallback}'; this.parentElement.classList.add('loaded');">
        <h3 class="card-overlay-title">${title}</h3>
      </div>
      <div class="card-body">
        <p class="card-excerpt">${escapeHtml(place.shortDesc)}</p>
        <div class="card-actions">
          <button type="button" class="btn btn-outline" data-detail-id="${escapeHtml(place.id)}">Descubrir más</button>
          <button type="button" class="btn-link-map" data-map-id="${escapeHtml(place.id)}">📍 Ver en mapa</button>
        </div>
      </div>
    </article>
  `;
}

function createHorizontalCardHTML(item) {
  const fallback = getPlaceholderSVG(item.title);
  return `
    <article class="h-card">
      <img class="h-card-img" src="${escapeHtml(item.image)}" alt="${escapeHtml(item.title)}" loading="lazy" onerror="this.onerror=null; this.src='${fallback}';">
      <div class="h-card-body">
        <div><span class="badge-gold">${escapeHtml(item.tag)}</span></div>
        <h3>${escapeHtml(item.title)}</h3>
        <p class="text-muted">${escapeHtml(item.description)}</p>
        <small><strong>Info:</strong> ${escapeHtml(item.practical)}</small>
      </div>
    </article>
  `;
}

function createEventCardHTML(ev) {
  return `
    <article class="event-card">
      <div class="event-date-box">
        <span class="event-day">${escapeHtml(ev.day)}</span>
        <span class="event-month">${escapeHtml(ev.month)}</span>
      </div>
      <div class="event-content">
        <span class="badge-red">${escapeHtml(ev.status)}</span>
        <h3>${escapeHtml(ev.title)}</h3>
        <p class="text-muted">${escapeHtml(ev.description)}</p>
        <small>📍 ${escapeHtml(ev.location)}</small>
      </div>
    </article>
  `;
}

function createBarrioCardHTML(barrio) {
  const fallback = getPlaceholderSVG(`Barrio ${barrio.name}`);
  return `
    <article class="place-card">
      <div class="card-media">
        <span class="card-tag">${escapeHtml(barrio.zone)}</span>
        <img src="${escapeHtml(barrio.image)}" alt="Barrio ${escapeHtml(barrio.name)}" loading="lazy" onload="this.parentElement.classList.add('loaded')" onerror="this.onerror=null; this.src='${fallback}'; this.parentElement.classList.add('loaded');">
        <h3 class="card-overlay-title">${escapeHtml(barrio.name)}</h3>
      </div>
      <div class="card-body"><p class="card-excerpt">${escapeHtml(barrio.description)}</p></div>
    </article>
  `;
}

function renderFilteredPlaces(gridId, list, category) {
  const grid = document.getElementById(gridId);
  if (!grid) return;
  const filtered = category === 'all' ? list : list.filter(p => p.category === category);
  grid.innerHTML = filtered.map(createPlaceCardHTML).join('');
  const counter = document.getElementById(`${gridId}-count`);
  if (counter) counter.textContent = `${filtered.length} ${filtered.length === 1 ? 'resultado' : 'resultados'}`;
}

function setupFilterChips(sectionId, gridId, list) {
  const section = document.getElementById(sectionId);
  if (!section) return;
  const chips = section.querySelectorAll('.chip');
  chips.forEach(chip => {
    chip.addEventListener('click', () => {
      chips.forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      renderFilteredPlaces(gridId, list, chip.dataset.filter);
    });
  });
}

function initCarouselControls(carousel) {
  const prev = document.getElementById('carousel-prev');
  const next = document.getElementById('carousel-next');
  if (!prev || !next || !carousel) return;

  // Calculamos el ancho de una tarjeta + el hueco (gap) para desplazar exactamente 1
  const getScrollAmount = () => {
    const card = carousel.querySelector('.place-card');
    if (!card) return 340; // Fallback
    const gap = 24; // 1.5rem de gap
    return card.offsetWidth + gap;
  };

  prev.addEventListener('click', () => {
    carousel.scrollBy({ left: -getScrollAmount(), behavior: 'smooth' });
  });

  next.addEventListener('click', () => {
    carousel.scrollBy({ left: getScrollAmount(), behavior: 'smooth' });
  });
}

function handleGlobalCardActions(e) {
  const favBtn = e.target.closest('[data-fav-id]');
  if (favBtn) { e.stopPropagation(); toggleFavorite(favBtn.dataset.favId); return; }

  const detailBtn = e.target.closest('[data-detail-id]');
  if (detailBtn) { openPlaceModal(detailBtn.dataset.detailId); return; }

  const mapBtn = e.target.closest('[data-map-id]');
  if (mapBtn) { goToMapForPlace(mapBtn.dataset.mapId); return; }
}

function toggleFavorite(id) {
  if (!state.data) return;
  const idx = state.favorites.indexOf(id);
  if (idx === -1) { state.favorites.push(id); showToast('Añadido a tus favoritos ♥', 'success'); }
  else { state.favorites.splice(idx, 1); showToast('Eliminado de favoritos', 'info'); }

  safeStorageSet('pinto_favorites', JSON.stringify(state.favorites));
  updateFavoritesBadge();

  document.querySelectorAll(`[data-fav-id="${CSS.escape(id)}"]`).forEach(btn => {
    const active = state.favorites.includes(id);
    btn.classList.toggle('active', active);
    btn.textContent = active ? '♥' : '♡';
    if (active) { btn.classList.remove('pop'); void btn.offsetWidth; btn.classList.add('pop'); }
  });

  if (state.currentRoute === 'favoritos') renderFavoritesView();
}

function updateFavoritesBadge() {
  const el = document.getElementById('fav-count');
  if (el) el.textContent = state.favorites.length;
}

function renderFavoritesView() {
  if (!state.data) return;
  const grid = document.getElementById('favoritos-grid');
  const empty = document.getElementById('favoritos-empty');
  if (!grid || !empty) return;
  const favPlaces = state.data.places.filter(p => state.favorites.includes(p.id));

  if (favPlaces.length === 0) {
    grid.innerHTML = '';
    empty.hidden = false;
  } else {
    empty.hidden = true;
    grid.innerHTML = favPlaces.map(createPlaceCardHTML).join('');
  }
}

function openPlaceModal(id) {
  if (!state.data) return;
  const place = state.data.places.find(p => p.id === id);
  if (!place) return;

  history.pushState(null, '', `#${place.id}`);
  state.lastFocused = document.activeElement;

  const modal = document.getElementById('detail-modal');
  document.getElementById('modal-category').textContent = place.category;
  document.getElementById('modal-title').textContent = place.title;
  document.getElementById('modal-desc').textContent = place.fullDesc;

  const gallery = place.gallery?.length ? place.gallery : [place.image];
  document.getElementById('modal-gallery').innerHTML = gallery.map((src, i) => {
    const fb = getPlaceholderSVG(`${place.title} (${i + 1})`);
    return `<img src="${escapeHtml(src)}" alt="${escapeHtml(place.title)} vista ${i + 1}" class="lightbox-trigger" data-fullsrc="${escapeHtml(src)}" onerror="this.onerror=null; this.src='${fb}';" loading="lazy">`;
  }).join('');

  document.getElementById('modal-practical-list').innerHTML = (place.practicalInfo || []).map(info => `<li>${escapeHtml(info)}</li>`).join('')
    + (place.lastChecked ? `<li><em>Última comprobación: ${escapeHtml(place.lastChecked)}</em></li>` : '');

  const modalFavBtn = document.getElementById('modal-fav-btn');
  const updateModalFav = () => {
    const isFav = state.favorites.includes(place.id);
    modalFavBtn.textContent = isFav ? '♥ Guardado' : '♡ Guardar';
  };
  updateModalFav();
  modalFavBtn.onclick = () => { toggleFavorite(place.id); updateModalFav(); };

  document.getElementById('modal-share-btn').onclick = async () => {
    const text = `Descubre ${place.title} en Pinto (Madrid)`;
    const cleanUrl = `${location.origin}${location.pathname}#${place.id}`;
    try {
      if (navigator.share) await navigator.share({ title: place.title, text, url: cleanUrl });
      else { await navigator.clipboard.writeText(`${text} - ${cleanUrl}`); showToast('Enlace copiado', 'success'); }
    } catch { }
  };

// Enlazar el botón con la ruta a las coordenadas exactas del lugar
  document.getElementById('modal-directions-btn').href = 
  `https://www.openstreetmap.org/directions?route=;${place.coords[0]},${place.coords[1]}`;
  modal.hidden = false;
  document.body.style.overflow = 'hidden';
  setTimeout(() => document.getElementById('modal-close').focus(), 50);

  setTimeout(() => {
    if (state.maps.modal) { state.maps.modal.remove(); state.maps.modal = null; }
    const mapEl = document.getElementById('modal-map');
    if (!mapEl || !place.coords) return;
    const map = L.map(mapEl).setView(place.coords, 16);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap' }).addTo(map);
    L.marker(place.coords).addTo(map).bindPopup(escapeHtml(place.title)).openPopup();
    state.maps.modal = map;
    setTimeout(() => map.invalidateSize(), 100);
  }, 120);
}

function bindGlobalModalListeners() {
  document.getElementById('modal-close')?.addEventListener('click', closeModal);
  document.getElementById('detail-modal')?.addEventListener('click', e => {
    if (e.target.id === 'detail-modal') closeModal();
  });
  document.addEventListener('keydown', e => {
    const modal = document.getElementById('detail-modal');
    if (modal && !modal.hidden && e.key === 'Escape') closeModal();
  });
}

function closeModal() {
  const modal = document.getElementById('detail-modal');
  if (!modal) return;
  modal.hidden = true;
  document.body.style.overflow = '';
  state.lastFocused?.focus?.();
  if (location.hash !== `#${state.currentRoute}`) {
    history.pushState(null, '', `#${state.currentRoute}`);
  }
}

function initLightbox() {
  const modal = document.getElementById('detail-modal');
  const lightbox = document.getElementById('lightbox');
  const lbImg = document.getElementById('lightbox-img');
  const lbClose = document.getElementById('lightbox-close');

  modal?.addEventListener('click', e => {
    const trigger = e.target.closest('.lightbox-trigger');
    if (trigger) {
      lbImg.src = trigger.dataset.fullsrc;
      lightbox.hidden = false;
    }
  });

  lbClose?.addEventListener('click', () => { lightbox.hidden = true; lbImg.src = ''; });
  lightbox?.addEventListener('click', e => {
    if (e.target === lightbox) { lightbox.hidden = true; lbImg.src = ''; }
  });
}

function buildSearchIndex() {
  const { places, events, barrios, curiosities, gastroAndLodging } = state.data;
  const idx = [];
  places.forEach(p => idx.push({ type: 'Lugar', title: p.title, text: `${p.title} ${p.shortDesc}`.toLowerCase(), open: () => openPlaceModal(p.id) }));
  events.forEach(e => idx.push({ type: 'Evento', title: e.title, text: `${e.title} ${e.description}`.toLowerCase(), open: () => navigateTo('fiestas') }));
  barrios.forEach(b => idx.push({ type: 'Barrio', title: b.name, text: `${b.name} ${b.description}`.toLowerCase(), open: () => navigateTo('barrios') }));
  curiosities.forEach(c => idx.push({ type: 'Curiosidad', title: c.question, text: `${c.question} ${c.answer}`.toLowerCase(), open: () => navigateTo('inicio') }));
  gastroAndLodging.forEach(g => idx.push({ type: 'Gastro', title: g.title, text: `${g.title} ${g.description}`.toLowerCase(), open: () => navigateTo('comer-comprar') }));
  // En buildSearchIndex():
places.forEach(p => idx.push({
  type: p.category || 'Lugar',
  title: p.title,
  text: `${p.title} ${p.category} ${p.shortDesc}`.toLowerCase(),
  open: () => openPlaceModal(p.id)
}));
  idx.forEach(i => { i.text = norm(i.text); });
  state.searchIndex = idx;
}

function initGlobalSearch() {
  const input = document.getElementById('global-search-input');
  const dropdown = document.getElementById('search-results-dropdown');
  if (!input || !dropdown) return;

  const render = () => {
    const q = norm(input.value.trim());
    if (q.length < 2) { dropdown.hidden = true; return; }
    const matches = state.searchIndex.filter(i => i.text.includes(q)).slice(0, 8);

    if (!matches.length) {
      dropdown.innerHTML = `<div class="search-result-item"><span>No hay resultados</span></div>`;
    } else {
      dropdown.innerHTML = matches.map((m, i) => `
        <div class="search-result-item" tabindex="0" data-search-idx="${i}">
          <span><strong>${escapeHtml(m.title)}</strong></span>
          <span class="badge-gold">${m.type}</span>
        </div>
      `).join('');
      dropdown.querySelectorAll('[data-search-idx]').forEach(el => {
        el.addEventListener('click', () => { matches[Number(el.dataset.searchIdx)].open(); dropdown.hidden = true; input.value = ''; });
      });
    }
    dropdown.hidden = false;
  };

  input.addEventListener('input', render);
  document.getElementById('global-search-form').addEventListener('submit', e => { e.preventDefault(); render(); });
  document.addEventListener('click', e => { if (!e.target.closest('.hero-search-wrapper')) dropdown.hidden = true; });
}

function initMaps() {
  if (typeof L === 'undefined' || !state.data) return;
  const center = [40.2417, -3.6997];
  const zoom = 14;

  const build = (id, z) => {
    const el = document.getElementById(id);
    if (!el) return null;
    const map = L.map(id).setView(center, z);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OSM' }).addTo(map);
    map._pintoMarkers = {};
    state.data.places.forEach(p => {
      if (!p.coords) return;
      
      // Creamos el marcador y el popup
      const m = L.marker(p.coords).addTo(map).bindPopup(`
        <strong>${escapeHtml(p.title)}</strong><br>
        <button class="map-popup-btn" data-detail-id="${escapeHtml(p.id)}">Ver ficha</button>
      `);
      
      map._pintoMarkers[p.id] = m;
    });
    
    // ARREGLO: Usar L.DomEvent para que el botón dentro del popup funcione al hacer clic
    map.on('popupopen', e => {
      const btn = e.popup.getElement()?.querySelector('.map-popup-btn');
      if (btn) {
        L.DomEvent.on(btn, 'click', function(ev) {
          L.DomEvent.stopPropagation(ev); // Evita que el mapa se cierre o haga zoom
          openPlaceModal(btn.dataset.detailId);
        });
      }
    });
    return map;
  };

  state.maps.home = build('home-map', zoom);
  state.maps.full = build('full-map', zoom);
}

function goToMapForPlace(id) {
  const place = state.data.places.find(p => p.id === id);
  if (!place || !place.coords) return;
  closeModal();
  navigateTo('info-practica');
  setTimeout(() => {
    if (state.maps.full) {
      state.maps.full.flyTo(place.coords, 17, { duration: 0.8 });
      state.maps.full._pintoMarkers?.[id]?.openPopup();
    }
  }, 400);
}

function initCountdown() {
  if (state.countdownTimer) clearInterval(state.countdownTimer);
  const $ = id => document.getElementById(id);
  const next = state.data.events.find(e => e.countdown && e._t && e._t > new Date());
  const target = next?._t;
  if (next) {
    $('countdown-event-name').textContent = next.title;
    $('countdown-event-desc').textContent = next.description;
  }
  const set = (d, h, m, s) => { $('cd-days').textContent = d; $('cd-hours').textContent = h; $('cd-mins').textContent = m; $('cd-secs').textContent = s; };
  const pad = n => String(n).padStart(2, '0');
  const update = () => {
    if (!target) return set('--', '--', '--', '--');
    const diff = target - new Date();
    if (diff <= 0) { set('00', '00', '00', '00'); clearInterval(state.countdownTimer); return; }
    set(Math.floor(diff / 864e5), pad(Math.floor((diff / 36e5) % 24)), pad(Math.floor((diff / 6e4) % 60)), pad(Math.floor((diff / 1e3) % 60)));
  };
  update();
  state.countdownTimer = setInterval(update, 1000);
}

function initStatsCounter() {
  const numbers = document.querySelectorAll('.stat-number');
  const obs = new IntersectionObserver((entries, o) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      const el = entry.target;
      const target = Number(el.dataset.target);
      const suffix = el.dataset.suffix || '';
      let cur = 0;
      const step = Math.max(1, Math.ceil(target / 45));
      const t = setInterval(() => {
        cur += step;
        if (cur >= target) { el.textContent = target.toLocaleString('es-ES') + suffix; clearInterval(t); }
        else el.textContent = cur.toLocaleString('es-ES') + suffix;
      }, 28);
      o.unobserve(el);
    });
  }, { threshold: 0.4 });
  numbers.forEach(n => obs.observe(n));
}

function renderQuizQuestion(quiz) {
  const container = document.getElementById('quiz-content');
  if (!container) return;
  if (state.quizIndex >= quiz.length) {
    container.innerHTML = `<p>¡Reto completado! Has acertado <strong>${state.quizScore} de ${quiz.length}</strong>.</p><button class="btn btn-primary mt-1" id="quiz-restart">Volver a jugar</button>`;
    document.getElementById('quiz-restart').onclick = () => { state.quizIndex = 0; state.quizScore = 0; renderQuizQuestion(quiz); };
    return;
  }
  const q = quiz[state.quizIndex];
  container.innerHTML = `
    <p><strong>Pregunta ${state.quizIndex + 1} de ${quiz.length}:</strong> ${escapeHtml(q.question)}</p>
    <div class="quiz-options">
      ${q.options.map((opt, i) => `<button class="quiz-opt-btn" data-idx="${i}">${escapeHtml(opt)}</button>`).join('')}
    </div>
  `;
  container.querySelectorAll('.quiz-opt-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const chosen = Number(btn.dataset.idx);
      container.querySelectorAll('.quiz-opt-btn').forEach(b => b.disabled = true);
      if (chosen === q.correctIndex) { btn.classList.add('correct'); state.quizScore++; }
      else { btn.classList.add('wrong'); container.querySelector(`[data-idx="${q.correctIndex}"]`).classList.add('correct'); }
      setTimeout(() => { state.quizIndex++; renderQuizQuestion(quiz); }, 1500);
    });
  });
}

function initRevealObserver() {
  const obs = new IntersectionObserver(entries => {
    entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('in-view'); });
  }, { threshold: 0.12 });
  document.querySelectorAll('.reveal').forEach(el => obs.observe(el));
}

function showToast(msg, type = 'info') {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = msg;
  toast.className = `toast toast-${type}`;
  void toast.offsetWidth;
  toast.classList.add('show');
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => toast.classList.remove('show'), 2800);
}