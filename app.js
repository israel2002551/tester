// ====================================================
// BUYSELL Nigeria - Main Application
// Config loaded from config.js (secrets are .gitignored)
// ====================================================


let chatHistory = []; 
let adminAiHistory = [];
let currentUser = null, currentRole = 'buyer', currentProd = null;
const PUBLIC_SITE_URL = 'https://buysell-markerplace.com';
function createMemoryStorage() {
 const fallback = new Map();
 return {
 getItem: key => fallback.has(key) ? fallback.get(key) : null,
 setItem: (key, value) => fallback.set(key, String(value)),
 removeItem: key => fallback.delete(key),
 clear: () => fallback.clear(),
 };
}

function createSafeStorage(storageName = 'localStorage') {
 try {
 const storage = window[storageName];
 const testKey = '__bs_storage_test__';
 storage.setItem(testKey, '1');
 storage.removeItem(testKey);
 return storage;
 } catch {
 console.info(`${storageName} is unavailable here; using temporary in-memory storage.`);
 return createMemoryStorage();
 }
}

const appStorage = createSafeStorage('localStorage');
const appSessionStorage = createSafeStorage('sessionStorage');
function readStoredJson(key, fallback) {
 try {
 return JSON.parse(appStorage.getItem(key) || JSON.stringify(fallback));
 } catch {
 return fallback;
 }
}

let pendingEntryRole = appStorage.getItem('bs_entry_role') || '';
let cart = readStoredJson('bs_cart', []);
let products = [], filteredProducts = [], activeFilters = {};
let carouselIndex = 0, carouselTimer = null;
let selectedRating = 0, checkoutPaymentMethod = 'paystack';
let deferredInstallPrompt = null, salesChart = null;
let sellerAnalyticsChart = null;
let carouselStartX = 0;
let previousAppView = 'buyer';
// MOVE THESE TWO LINES HERE (TO THE TOP VARIABLES AREA):
let wishlist = readStoredJson('bs_wishlist', []);
let compareList = readStoredJson('bs_compare', []);
const analyticsSessionId = appStorage.getItem('bs_analytics_session') || ('sess_' + Date.now() + '_' + Math.random().toString(36).slice(2));
appStorage.setItem('bs_analytics_session', analyticsSessionId);

function showMarketLandingPage() {
 const marketing = document.getElementById('marketing-placeholder');
 const landing = document.getElementById('landing');
 const mainNav = document.getElementById('main-nav');
 const buyerView = document.getElementById('buyer-view');
 const sellerDash = document.getElementById('seller-dashboard');
 const storefront = document.getElementById('storefront-view');
 const accountView = document.getElementById('account-view');
 const hasMarketingLanding = !!marketing?.querySelector('#marketing-landing');

 if (marketing) {
 marketing.classList.toggle('hidden', !hasMarketingLanding);
 marketing.style.setProperty('display', hasMarketingLanding ? 'block' : 'none', 'important');
 }
 if (landing) {
 landing.classList.toggle('hidden', hasMarketingLanding);
 landing.style.setProperty('display', hasMarketingLanding ? 'none' : 'flex', 'important');
 }
 if (mainNav) mainNav.classList.add('hidden');
 if (buyerView) {
 buyerView.classList.add('hidden');
 buyerView.style.setProperty('display', 'none', 'important');
 }
 if (sellerDash) {
 sellerDash.classList.add('hidden');
 sellerDash.style.setProperty('display', 'none', 'important');
 }
 if (storefront) {
 storefront.classList.add('hidden');
 storefront.style.setProperty('display', 'none', 'important');
 }
 if (accountView) {
 accountView.classList.add('hidden');
 accountView.style.setProperty('display', 'none', 'important');
 }
 document.body.classList.remove('in-seller', 'platform-seller-mode');
}

function landingMediaElement(row) {
 const mediaUrl = sanitizeUrl(row?.media_url || '');
 const posterUrl = sanitizeUrl(row?.poster_url || '');
 const title = escAttr(row?.title || 'BUYSELL Nigeria video');
 const isVideo = String(row?.media_type || '').toLowerCase() === 'video' || /\.(mp4|webm|ogg|mov)(\?|$)/i.test(mediaUrl);
 if (!mediaUrl) return '';
 if (isVideo) {
 return `<video playsinline preload="metadata" ${posterUrl ? `poster="${escAttr(posterUrl)}"` : ''}><source src="${escAttr(mediaUrl)}" type="video/mp4"></video>`;
 }
 return `<img src="${escAttr(mediaUrl)}" alt="${title}" loading="lazy">`;
}

function bindLandingVideoPlayer(target) {
 const video = target?.querySelector('video');
 const overlay = target?.querySelector('.bs-video-player__overlay, .bs-video-testimonial__overlay');
 const playButton = target?.querySelector('.bs-video-play-btn');
 if (!video || !overlay || !playButton || target.dataset.videoBound === 'true') return;

 target.dataset.videoBound = 'true';
 playButton.addEventListener('click', event => {
 event.preventDefault();
 event.stopPropagation();
 video.play().catch(error => {
 console.warn('Landing video playback failed:', error);
 });
 });

 video.addEventListener('play', () => target.classList.add('is-playing'));
 video.addEventListener('pause', () => target.classList.remove('is-playing'));
 video.addEventListener('ended', () => target.classList.remove('is-playing'));
}

function applyLandingMediaRow(row) {
 const slot = String(row?.slot || '').trim();
 const target = slot
 ? [...document.querySelectorAll('[data-landing-media-slot]')].find(el => el.dataset.landingMediaSlot === slot)
 : null;
 const mediaUrl = sanitizeUrl(row?.media_url || '');
 if (!target || !mediaUrl) return;

 const isVideo = String(row?.media_type || '').toLowerCase() === 'video' || /\.(mp4|webm|ogg|mov)(\?|$)/i.test(mediaUrl);
 const posterUrl = sanitizeUrl(row?.poster_url || '');

 if (slot === 'hero_video' && target.tagName === 'VIDEO') {
 target.poster = posterUrl || target.poster || '';
 target.innerHTML = `<source src="${escAttr(mediaUrl)}" type="video/mp4">`;
 target.load();
 target.play?.().catch(() => {});
 return;
 }

 const overlay = target.querySelector('.bs-video-player__overlay, .bs-video-testimonial__overlay');
 const mediaHtml = landingMediaElement(row);
 if (!mediaHtml) return;
 target.innerHTML = mediaHtml + (overlay ? overlay.outerHTML : '');
 const video = target.querySelector('video');
 if (video && target.classList.contains('bs-video-testimonial')) {
 video.muted = true;
 video.loop = true;
 }
 bindLandingVideoPlayer(target);
 if (video && isVideo) video.load();
}

async function loadLandingMedia() {
 if (!document.getElementById('marketing-landing') || !db) return;
 try {
 const { data, error } = await db
 .from('landing_media')
 .select('slot,media_type,media_url,poster_url,title,is_active,sort_order')
 .eq('is_active', true)
 .order('sort_order', { ascending: true });
 if (error) throw error;
 (data || []).forEach(applyLandingMediaRow);
 } catch (err) {
 console.warn('Landing media loading skipped:', err.message || err);
 }
}

async function postAiRequest(body, endpoints = []) {
 const session = (await db.auth.getSession()).data.session;
 const token = session?.access_token || SB_KEY;
 const headers = {
 'Content-Type': 'application/json',
 apikey: SB_KEY,
 Authorization: `Bearer ${token}`,
 };

 const uniqueEndpoints = [...new Set(endpoints.filter(Boolean))];
 let lastError = null;
 for (const endpoint of uniqueEndpoints) {
 try {
 const res = await fetch(endpoint, {
 method: 'POST',
 headers,
 body: JSON.stringify(body),
 });
 const data = await res.json().catch(() => ({}));
 if (!res.ok) throw new Error(data.error || `AI endpoint failed (${res.status})`);
 if (data.reply) return data;
 lastError = new Error('AI endpoint returned an empty reply');
 } catch (error) {
 lastError = error;
 console.warn('AI endpoint failed:', endpoint, error);
 }
 }
 throw lastError || new Error('AI endpoint unavailable');
}

function getAiEndpoints(primaryName = 'smooth-handler') {
 const configured = typeof CLAUDE_EDGE_URL !== 'undefined' ? CLAUDE_EDGE_URL : '';
 return [
 configured,
 `${EDGE_URL}/${primaryName}`,
 `${EDGE_URL}/smooth-handler`,
 `${EDGE_URL}/chat-bot-handler`,
 ];
}

/** Call a deployed Edge Function securely with the user's JWT */
async function callEdge(fnName, body) {
 const session = (await db.auth.getSession()).data.session;
 const token = session?.access_token;
 if (!token) throw new Error('Not authenticated');

 const res = await fetch(`${EDGE_URL}/${fnName}`, {
 method: 'POST',
 headers: {
 'Content-Type': 'application/json',
 'Authorization': `Bearer ${token}`,
 'apikey': SB_KEY
 },
 body: JSON.stringify(body)
 });

 const data = await res.json();
 if (!res.ok) throw new Error(data.error || `${fnName} failed (${res.status})`);
 return data;
}

function getAdminEmails() {
 const configured = typeof ADMIN_EMAILS !== 'undefined' && Array.isArray(ADMIN_EMAILS)
 ? ADMIN_EMAILS
 : (typeof ADMIN_EMAIL !== 'undefined' ? [ADMIN_EMAIL] : []);
 return configured.map(email => String(email || '').trim().toLowerCase()).filter(Boolean);
}

function isAdminEmail(email = currentUser?.email) {
 return getAdminEmails().includes(String(email || '').trim().toLowerCase());
}

function isPlatformProfile(profile = {}) {
 const role = String(profile?.role || '').toLowerCase();
 const email = String(profile?.email || profile?.user_email || '').trim().toLowerCase();
 const accountType = String(profile?.accounts || '').toLowerCase();
 return role === 'admin'
 || accountType === 'admin'
 || profile?.is_platform_store === true
 || profile?.store_type === 'platform'
 || isAdminEmail(email);
}

function isPlatformProduct(product = {}) {
 return product?.is_platform_store === true
 || product?.store_type === 'platform'
 || isPlatformProfile(product?.profiles || product?.seller || {});
}

function getPlatformStoreLabel(profile = {}) {
 if (isPlatformProfile(profile)) return 'BUYSELL Platform Store';
 return profile?.store_name || profile?.name || 'Seller';
}

function updatePlatformSellerDashboardChrome() {
 const isPlatform = isPlatformProfile(currentUser?.profile || {});
 document.body.classList.toggle('platform-seller-mode', isPlatform);

 const sidebarSub = document.querySelector('.dash-sidebar-head .sub');
 const title = document.getElementById('dash-overview-title');
 const sub = document.getElementById('dash-overview-sub');
 const notice = document.getElementById('platform-store-notice');
 const addTitle = document.getElementById('dash-add-product-title');
 const adPrice = document.getElementById('ad-price-label');
 const adCopy = document.getElementById('ad-pricing-copy');
 const adPlacement = document.getElementById('ad-placement-copy');
 const adButton = document.getElementById('ad-pay-btn');

 if (sidebarSub) sidebarSub.textContent = isPlatform ? 'Platform Store' : 'Seller Dashboard';
 if (title) title.textContent = isPlatform ? 'Platform Store Dashboard' : 'Dashboard Overview';
 if (sub) sub.textContent = isPlatform
 ? 'Manage official BUYSELL listings buyers will recognize as Platform Store products.'
 : "Welcome back! Here's your store at a glance.";
 if (notice) notice.classList.toggle('hidden', !isPlatform);
 if (addTitle) addTitle.textContent = isPlatform ? 'Add Platform Product' : 'Add New Product';
 if (adPrice) adPrice.textContent = isPlatform ? 'Free' : '₦5,000';
 if (adCopy) adCopy.textContent = isPlatform ? 'Admin advertisements are free and can go live immediately for 30 days.' : 'Upload a 30-second video or an image. ₦5,000 for 30 days of premium visibility.';
 if (adPlacement) adPlacement.textContent = isPlatform ? '30 days placement, no payment needed for admin' : '30 days placement after admin approval';
 if (adButton) adButton.innerHTML = isPlatform ? '<i class="fa-solid fa-shield-halved"></i> Publish Free Admin Ad' : '<i class="fa-solid fa-credit-card"></i> Pay & Submit Ad';
}

async function trackAnalytics(event) {
 try {
 const session = (await db.auth.getSession()).data.session;
 await fetch(`${EDGE_URL}/track-analytics`, {
 method: 'POST',
 headers: {
 'Content-Type': 'application/json',
 apikey: SB_KEY,
 Authorization: `Bearer ${session?.access_token || SB_KEY}`,
 },
 body: JSON.stringify({ ...event, session_id: analyticsSessionId }),
 });
 } catch (error) {
 console.warn('Analytics tracking failed:', error);
 }
}

// " SAFE SUPABASE INITIALIZATION & VARIABLES
if (typeof window.supabaseClient === 'undefined') {
 window.supabaseClient = window.supabase.createClient(SB_URL, SB_KEY, {
 auth: {
 persistSession: true,
 autoRefreshToken: true,
 detectSessionInUrl: true,
 storage: appStorage
 }
 });
}

// FIX: Re-assign globally without re-declaring 'const' or 'let'
db = window.supabaseClient;
supabase = window.supabaseClient;

window.db = window.supabaseClient;
window.supabase = window.supabaseClient;
window.supabaseAppClient = window.supabaseClient;


// Auth state listener keeps the visible header and active view in sync.
if (typeof supabase !== 'undefined') {
 supabase.auth.onAuthStateChange((event, session) => {
 console.log(`Flash Gatekeeper Auth Engine Event: ${event}`);
 
 setTimeout(async () => {
 const authButton = document.querySelector('.nav-sign-in-btn') || 
 document.getElementById('landing-auth-btn') ||
 document.getElementById('nav-auth-inner-btn');

 if (session && session.user) {
 await onAuthSuccess(session.user);
 console.log("Active user credentials cached securely in memory: " + currentUser.email);

 if (authButton) {
 authButton.innerHTML = `<i class="fas fa-sign-out-alt"></i> Sign Out`;
 authButton.onclick = async (e) => {
 e.preventDefault();
 appStorage.clear();
 await supabase.auth.signOut();
 window.location.reload(); 
 };
 }

 try {
 const { data: profile, error } = await supabase
 .from('profiles')
 .select('*')
 .eq('id', session.user.id)
 .maybeSingle();

 if (!error && profile) {
 currentUser.profile = profile;
 currentRole = profile.role || 'buyer';
 }
 } catch (e) {
 console.warn("Warning Background profile parsing deferred:", e.message);
 }

 // ROUTER INTEGRATION: Intercept inbound query parameters and pop chat UI if active
 if (typeof processInboundChatRedirects === 'function') {
 processInboundChatRedirects();
 }

 const shouldContinueAfterAuth = appStorage.getItem('bs_manual_navigation_pass') || hasAuthRedirectParams();

  // Keep passive session restores on the market landing. OAuth callbacks and app routes open the app.
  if (hasAppRouteParams()) {
  await continueUrlRoute();
  } else if (!shouldContinueAfterAuth) {
  console.log("Background session detected. Holding layout on market landing.");
  showMarketLandingPage();
  } else {
 continuePendingEntry();
 }

 } else {
 console.log("Guest View Matrix Active.");
 currentUser = null;
 currentRole = 'buyer';

 if (authButton) {
 authButton.innerHTML = `<i class="fas fa-sign-in-alt"></i> Sign In`;
 authButton.onclick = (e) => {
 e.preventDefault();
 if (typeof showModal === 'function') {
 showModal('auth-modal');
 toggleAuth('login');
 }
 };
 }

  if (hasAppRouteParams()) {
  await continueUrlRoute();
  } else {
  showMarketLandingPage();
  }
  }
 }, 0);
 });
}
function processInboundChatRedirects() {
 const urlParameters = new URLSearchParams(window.location.search);
 const targetChatPartnerId = urlParameters.get('chat');
 const targetProductId = urlParameters.get('product'); // ' Captures optional product context
 
 // Make sure we have a valid chat parameter and a logged-in user
 if (targetChatPartnerId && currentUser) {
 console.log('[INBOUND ROUTER] Direct chat intercept parameter caught. Partner ID:', targetChatPartnerId);
 
 // Clear URL parameters cleanly so reloading the window doesn't keep opening the popup loop
 window.history.replaceState({}, document.title, window.location.pathname);
 
 // Fetch user profile properties asynchronously out of database and toggle UI focus layout panels
 db.from('profiles')
 .select('name')
 .eq('id', targetChatPartnerId)
 .maybeSingle()
 .then(({ data: partner }) => {
 const companionName = partner ? partner.name : 'Verified Merchant';
 
 // Invoke your app's native messaging modal handler with the optional product context passed along!
 openConversation(targetChatPartnerId, companionName, targetProductId); 
 });
 }
}
// ====================================================
// STATE
// ====================================================

// ====================================================
// PWA PUSH NOTIFICATION ENGINE INITIALIZATION
// ====================================================


// ====================================================
// TOAST
// ====================================================
function toast(title, msg='', type='success', dur=3500) {
 let tc = document.getElementById('toast-container');
 
 // AUTOMATIC FALLBACK GUARD: If the HTML div isn't parsed yet, build it dynamically!
 if (!tc) {
 tc = document.createElement('div');
 tc.id = 'toast-container';
 document.body.appendChild(tc);
 }

 const el = document.createElement('div');
 el.className = `toast-item ${type}`;
 
 const icons = {
 success: 'fa-check-circle',
 error: 'fa-exclamation-triangle',
 info: 'fa-info-circle',
 warn: 'fa-exclamation-circle'
 };
 
 const cols = {
 success: 'var(--green)',
 error: 'var(--danger)',
 info: 'var(--blue)',
 warn: 'var(--gold)'
 };
 
 el.innerHTML = `
 <i class="fa-solid ${icons[type] || icons.info}" style="color:${cols[type] || cols.info};font-size:1.1rem;flex-shrink:0"></i>
 <div class="ti">
 <div class="ti-title">${title}</div>
 ${msg ? `<div class="ti-msg">${msg}</div>` : ''}
 </div>
 <button onclick="this.parentElement.remove()" style="background:none;border:none;color:var(--text3);cursor:pointer;font-size:.85rem;flex-shrink:0">
 <i class="fa-solid fa-times"></i>
 </button>
 `;
 
 tc.appendChild(el);
 
 setTimeout(() => { 
 el.classList.add('exiting'); 
 setTimeout(() => el.remove(), 300); 
 }, dur);
}

// ====================================================
// MODAL HELPERS
// ====================================================
function showModal(id) { const m = document.getElementById(id); if(m){ m.classList.add('open'); document.body.classList.add('modal-open'); } }
function closeModal(id) { const m = document.getElementById(id); if(m){ m.classList.remove('open'); document.body.classList.remove('modal-open'); } }
document.querySelectorAll('.modal-overlay').forEach(m => m.addEventListener('click', e => { if(e.target===m) closeModal(m.id); }));

function hideAccountPage() {
 const accountView = document.getElementById('account-view');
 if (accountView) {
 accountView.classList.add('hidden');
 accountView.style.setProperty('display', 'none', 'important');
 }
}

function showAccountPage() {
 if (!currentUser) { showModal('auth-modal'); toggleAuth('login'); return; }
 previousAppView = currentRole === 'seller' ? 'seller' : 'buyer';
 const accountView = document.getElementById('account-view');
 const buyerView = document.getElementById('buyer-view');
 const sellerDash = document.getElementById('seller-dashboard');
 const storefrontView = document.getElementById('storefront-view');
 const adminPortal = document.getElementById('admin-portal-view');
 const landing = document.getElementById('landing');
 const marketing = document.getElementById('marketing-placeholder');
 const mainNav = document.getElementById('main-nav');

 if (mainNav) mainNav.style.setProperty('display', 'block', 'important');
 [buyerView, sellerDash, storefrontView, adminPortal, landing, marketing].forEach(el => {
 if (!el) return;
 el.classList.add('hidden');
 el.style.setProperty('display', 'none', 'important');
 });
 if (accountView) {
 accountView.classList.remove('hidden');
 accountView.style.setProperty('display', 'block', 'important');
 }
 document.body.classList.remove('in-seller');
 document.getElementById('account-page-name').textContent = currentUser.profile?.name || currentUser.email || 'BUYSELL User';
 document.getElementById('account-page-email').textContent = currentUser.email || 'Manage your BUYSELL profile and privacy choices.';
 document.getElementById('account-page-role').textContent = profileEntryRole(currentUser.profile).replace('_', ' ');
}

function returnToPreviousAppView() {
 hideAccountPage();
 if (previousAppView === 'seller') showSellerDashboard();
 else showBuyerView();
}

// ====================================================
// AUTH
// ====================================================
function normalizeEntryRole(role) {
 return ['buyer', 'seller', 'both', 'service_provider'].includes(role) ? role : 'buyer';
}

function setPendingEntryRole(role) {
 pendingEntryRole = normalizeEntryRole(role);
 appStorage.setItem('bs_entry_role', pendingEntryRole);
 return pendingEntryRole;
}

function getPendingEntryRole() {
 return normalizeEntryRole(pendingEntryRole || appStorage.getItem('bs_entry_role') || 'buyer');
}

function clearPendingEntryRole() {
 pendingEntryRole = '';
 appStorage.removeItem('bs_entry_role');
}

function updateAuthPanelCopy(mode) {
 const role = getPendingEntryRole();
 const title = document.getElementById('auth-panel-title');
 const subtitle = document.getElementById('auth-panel-subtitle');
 if (!title || !subtitle) return;

 const isSignup = mode === 'signup';
 const copy = {
 buyer: {
 title: isSignup ? 'Create your buyer account' : 'Buyer sign in',
 subtitle: isSignup ? 'Join BUYSELL Nigeria to save carts, track orders, and message sellers.' : 'Sign in to continue shopping the marketplace.',
 },
 seller: {
 title: isSignup ? 'Open your seller store' : 'Seller sign in',
 subtitle: isSignup ? 'Create your store account and start your free first month.' : 'Sign in to continue to your seller dashboard.',
 },
 both: {
 title: isSignup ? 'Create buyer and seller access' : 'Sign in to your account',
 subtitle: isSignup ? 'Shop products and manage your own store from one BUYSELL account.' : 'Sign in to continue to your marketplace account.',
 },
 service_provider: {
 title: isSignup ? 'Create service provider access' : 'Service provider sign in',
 subtitle: isSignup ? 'Create an account to offer services and connect with local clients.' : 'Sign in to continue to your service dashboard.',
 },
 };

 title.textContent = copy[role]?.title || copy.buyer.title;
 subtitle.textContent = copy[role]?.subtitle || copy.buyer.subtitle;
}

function openEntryAuth(role = 'buyer', mode = 'login') {
 setPendingEntryRole(role);
 showModal('auth-modal');
 toggleAuth(mode);
}

function profileHasSellerAccess(profile = currentUser?.profile) {
 const role = profile?.role;
 const accounts = profile?.accounts;
 return role === 'seller' || role === 'admin' || role === 'both' || accounts === 'seller' || accounts === 'both';
}

async function ensureSellerProfileRole() {
 if (!currentUser?.id) throw new Error('Not authenticated');

 let profile = currentUser.profile || {};
 if (!profile.role && !profile.accounts) {
 const { data } = await db.from('profiles').select('*').eq('id', currentUser.id).maybeSingle();
 if (data) {
 currentUser.profile = data;
 profile = data;
 }
 }

 if (!profileHasSellerAccess(profile)) {
 throw new Error('Seller account required. Please sign in with a seller account.');
 }
 if (profile.role === 'seller' || profile.role === 'admin') return true;

 const { data, error } = await db
 .from('profiles')
 .update({ role: 'seller', accounts: profile.accounts || 'seller' })
 .eq('id', currentUser.id)
 .select('*')
 .single();

 if (error) throw new Error(error.message || 'Could not confirm seller access');
 currentUser.profile = data || { ...profile, role: 'seller', accounts: profile.accounts || 'seller' };
 currentRole = 'seller';
 return true;
}

function profileEntryRole(profile = currentUser?.profile) {
 const role = profile?.role;
 const accounts = profile?.accounts;
 if (role === 'service_provider' || accounts === 'service_provider') return 'service_provider';
 if (role === 'seller' || role === 'admin' || role === 'both' || accounts === 'seller' || accounts === 'both') return 'seller';
 return 'buyer';
}

function hasAuthRedirectParams() {
  const params = new URLSearchParams(window.location.search);
  const hashParams = new URLSearchParams((window.location.hash || '').replace(/^#/, ''));
  return params.has('code') ||
 params.has('state') ||
 hashParams.has('access_token') ||
 hashParams.has('refresh_token') ||
  hashParams.has('provider_token');
}

function hasAppRouteParams() {
 const params = new URLSearchParams(window.location.search);
 return params.get('view') === 'shop' ||
 params.get('dashboard') === 'seller' ||
 params.has('product') ||
 params.has('store') ||
 params.has('category') ||
 params.has('chat');
}

async function continueUrlRoute() {
 const params = new URLSearchParams(window.location.search);
 appStorage.removeItem('bs_manual_navigation_pass');

 if (params.get('dashboard') === 'seller') {
  if (!currentUser) {
   openEntryAuth('seller', 'login');
   return;
  }
  if (profileHasSellerAccess()) {
   await showSellerDashboard();
   if (params.has('order')) showDash('orders');
  } else {
   showBuyerView();
   toast('Seller account required', 'Sign in with a seller account to open seller notifications.', 'warn', 6000);
  }
  return;
 }

 showBuyerView();
 if (params.get('view') === 'shop') switchBuyerTab?.('shop');
 if (params.has('product') || params.has('store') || params.has('category') || params.has('chat')) {
  await handleDeepLink();
 }
}

function cleanAuthRedirectUrl() {
  if (!hasAuthRedirectParams() || !window.history?.replaceState) return;
  window.history.replaceState({}, document.title, window.location.pathname);
}

function continuePendingEntry() {
 if (!currentUser) return;
 const requestedRole = getPendingEntryRole();
 const role = requestedRole === 'buyer' ? profileEntryRole() : requestedRole;
 appStorage.removeItem('bs_manual_navigation_pass');
 clearPendingEntryRole();
 cleanAuthRedirectUrl();

 if (role === 'seller' || role === 'both') {
 if (profileHasSellerAccess()) {
 showSellerDashboard();
 } else {
 showBuyerView();
 toast('Seller account required', 'Create or sign in with a seller account to open the seller dashboard.', 'warn', 6000);
 }
 return;
 }

 if (role === 'service_provider' && typeof showServiceDashboard === 'function') {
 showServiceDashboard();
 return;
 }

 showBuyerView();
}

function toggleAuth(mode) {
 const isLogin = mode === 'login';
 const isSignup = mode === 'signup';
 const isForgot = mode === 'forgot';

 // Tab highlights
 document.getElementById('auth-tab-login').classList.toggle('active', isLogin);
 document.getElementById('auth-tab-signup').classList.toggle('active', isSignup);

 // Show/hide panels
 document.getElementById('auth-form').classList.toggle('hidden', isForgot);
 document.getElementById('auth-forgot-panel').classList.toggle('hidden', !isForgot);
 document.getElementById('forgot-link-row').classList.toggle('hidden', !isLogin || isForgot);
 document.getElementById('auth-oauth-panel')?.classList.toggle('hidden', isForgot);

 if (isForgot) {
 // Reset forgot panel to step 1
 document.getElementById('forgot-step-1').classList.remove('hidden');
 document.getElementById('forgot-step-2').classList.add('hidden');
 document.getElementById('forgot-email').value = '';
 return;
 }

 document.getElementById('auth-name-group').classList.toggle('hidden', isLogin);
 document.getElementById('auth-role-group').classList.toggle('hidden', isLogin);
 const selRole = document.querySelector('input[name="auth-role-radio"]:checked')?.value || 'buyer';
 document.getElementById('auth-wa-group').classList.toggle('hidden', isLogin || selRole === 'buyer');
 document.getElementById('auth-terms-group').classList.toggle('hidden', isLogin);
 document.getElementById('auth-btn-text').textContent = isLogin ? 'Sign In' : 'Create Account';
 document.getElementById('auth-password').setAttribute('autocomplete', isLogin ? 'current-password' : 'new-password');
 if (isSignup) selectRole(pendingEntryRole || appStorage.getItem('bs_entry_role') || 'buyer');
 updateAuthPanelCopy(mode);
}

async function uploadToFirstAvailableBucket(buckets, path, file, options = {}) {
 let lastError = null;
 for (const bucket of buckets) {
 const { data, error } = await db.storage.from(bucket).upload(path, file, options);
 if (!error) {
 const { data: urlData } = db.storage.from(bucket).getPublicUrl(data.path);
 return { bucket, path: data.path, publicUrl: sanitizeUrl(urlData?.publicUrl || '') };
 }
 lastError = error;
 }
 throw lastError || new Error('Upload failed');
}

const PRODUCT_IMAGE_LIMIT = 8;
const PRODUCT_VIDEO_LIMIT = 3;
const PRODUCT_MAX_IMAGE_SIZE = 8 * 1024 * 1024;
const PRODUCT_MAX_VIDEO_SIZE = 80 * 1024 * 1024;
const PRODUCT_ALLOWED_IMG_TYPES = ['image/jpeg','image/png','image/webp','image/gif'];
const PRODUCT_ALLOWED_VID_TYPES = ['video/mp4','video/webm','video/ogg','video/quicktime'];

function safeFileExt(fileName = '', fallback = 'bin') {
 return (String(fileName).split('.').pop() || fallback).toLowerCase().replace(/[^a-z0-9]/g, '') || fallback;
}

function fileListToArray(inputId) {
 return Array.from(document.getElementById(inputId)?.files || []);
}

async function uploadProductMediaFiles(files, kind) {
 const isVideo = kind === 'video';
 const maxCount = isVideo ? PRODUCT_VIDEO_LIMIT : PRODUCT_IMAGE_LIMIT;
 const maxSize = isVideo ? PRODUCT_MAX_VIDEO_SIZE : PRODUCT_MAX_IMAGE_SIZE;
 const allowedTypes = isVideo ? PRODUCT_ALLOWED_VID_TYPES : PRODUCT_ALLOWED_IMG_TYPES;
 const folder = isVideo ? 'vids' : 'imgs';
 const label = isVideo ? 'video' : 'image';
 const selected = files.slice(0, maxCount);

 if (files.length > maxCount) {
 toast(`Too many ${label}s`, `Only the first ${maxCount} ${label}${maxCount > 1 ? 's' : ''} will be uploaded.`, 'warn');
 }

 const urls = [];
 for (let index = 0; index < selected.length; index++) {
  const file = selected[index];
  if (!allowedTypes.includes(file.type)) throw new Error(`Unsupported ${label} type: ${file.name}`);
  if (file.size > maxSize) throw new Error(`${file.name} is too large. ${isVideo ? 'Videos' : 'Images'} must be under ${Math.round(maxSize / 1024 / 1024)}MB.`);
  const ext = safeFileExt(file.name, isVideo ? 'mp4' : 'jpg');
  const path = `${folder}/${currentUser.id}/${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}.${ext}`;
  const uploaded = await uploadToFirstAvailableBucket(['products', 'uploads'], path, file, { contentType: file.type, upsert: false });
  if (uploaded.publicUrl) urls.push(uploaded.publicUrl);
 }
 return urls;
}

async function signInWithGoogle() {
 const rawRole = pendingEntryRole || appStorage.getItem('bs_entry_role') || document.querySelector('input[name="auth-role-radio"]:checked')?.value || 'buyer';
 const role = rawRole === 'both' ? 'seller' : rawRole;
 setPendingEntryRole(rawRole);
 appStorage.setItem('bs_manual_navigation_pass', 'true');
 appStorage.setItem('bs_google_profile_hint', JSON.stringify({
 role,
 accounts: rawRole,
 whatsapp: document.getElementById('auth-wa')?.value.trim() || '',
 }));

 try {
 const { error } = await db.auth.signInWithOAuth({
 provider: 'google',
 options: {
 redirectTo: `${PUBLIC_SITE_URL}/`,
 queryParams: {
 access_type: 'offline',
 prompt: 'select_account',
 },
 },
 });
 if (error) throw error;
 } catch (err) {
 appStorage.removeItem('bs_manual_navigation_pass');
 appStorage.removeItem('bs_google_profile_hint');
 toast('Google Sign In Failed', err.message || 'Please try again', 'error');
 }
}

// Role card selector
function selectRole(role) {
 setPendingEntryRole(role);
 document.querySelectorAll('.role-card').forEach(c => c.classList.remove('active'));
 document.getElementById('role-card-' + role)?.classList.add('active');
 const roleInput = document.querySelector(`input[name="auth-role-radio"][value="${role}"]`);
 if (roleInput) roleInput.checked = true;
 // Show/hide WhatsApp for seller/both/service_provider
 const needsWa = role === 'seller' || role === 'both' || role === 'service_provider';
 document.getElementById('auth-wa-group').classList.toggle('hidden', !needsWa);
 document.getElementById('role-both-note').classList.toggle('hidden', role !== 'both');
 document.getElementById('role-sp-note')?.classList.toggle('hidden', role !== 'service_provider');
}

function togglePasswordVisibility(inputId, btn) {
 const input = document.getElementById(inputId);
 if (!input) return;
 const isPassword = input.type === 'password';
 input.type = isPassword ? 'text' : 'password';
 btn.innerHTML = isPassword ? '<i class="fa-solid fa-eye-slash"></i>' : '<i class="fa-solid fa-eye"></i>';
}

function withTimeout(promise, ms, timeoutMessage) {
 let timeoutId;
 const timeout = new Promise((_, reject) => {
 timeoutId = setTimeout(() => reject(new Error(timeoutMessage)), ms);
 });
 return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}

async function handleAuth(e) {
 e.preventDefault();
 const isLogin = document.getElementById('auth-tab-login').classList.contains('active');
 const email = document.getElementById('auth-email').value.trim();
 const password = document.getElementById('auth-password').value;

 if (!email || !password) { toast('Missing fields', 'Enter your email and password', 'warn'); return; }

 const btnText = document.getElementById('auth-btn-text');
 const spinner = document.getElementById('auth-spinner');
 const btn = document.getElementById('auth-btn');
 btnText.textContent = ''; spinner.classList.remove('hidden'); btn.disabled = true;

 try {
 if (isLogin) {
 // -- SIGN IN ---
 appStorage.setItem('bs_manual_navigation_pass', 'true');
 const { data, error } = await withTimeout(
 db.auth.signInWithPassword({ email, password }),
 15000,
 'Sign in timed out. Please refresh and try again.'
 );

 if (error) {
 // Give a clear, actionable message for every common error
 const msg = error.message?.toLowerCase() || '';
 if (msg.includes('email not confirmed')) {
 toast('Email Not Confirmed',
 'Supabase Dashboard -> Auth -> Providers -> Email -> turn OFF "Confirm email"',
 'error', 9000);
 } else if (msg.includes('invalid login') || msg.includes('invalid credentials')) {
 toast('Wrong Email or Password', 'Check your details and try again', 'error');
 } else if (msg.includes('too many') || msg.includes('rate limit')) {
 toast('Too Many Attempts', 'Wait a few minutes then try again', 'warn', 7000);
 } else {
 toast('Sign In Failed', error.message, 'error');
 }
 return;
 }

 // Use session.user (more reliable than data.user after token refresh)
 const user = data.session?.user || data.user;
 await withTimeout(onAuthSuccess(user), 10000, 'Profile loading timed out. Please refresh and try again.');
 closeModal('auth-modal');
 continuePendingEntry();

 } else {
 // -- SIGN UP ---
 const name = validateInput(document.getElementById('auth-name').value.trim());
 const rawRole = validateInput(document.querySelector('input[name="auth-role-radio"]:checked')?.value || 'buyer');
 const wa = document.getElementById('auth-wa').value.trim();

 if (!name) { toast('Name required', 'Please enter your full name', 'warn'); return; }
 if (password.length < 6) { toast('Password too short', 'Minimum 6 characters', 'warn'); return; }
 if (!document.getElementById('auth-terms-check')?.checked) {
 toast('Terms Required', 'Please agree to the Terms of Service and Privacy Policy', 'warn', 5000);
 return;
 }

 const role = rawRole === 'both' ? 'seller' : rawRole;
 const accounts = rawRole;

 // Step 1: Create the account
 const { data: signUpData, error: signUpError } = await db.auth.signUp({
 email, password,
 options: { data: { name, role, accounts, whatsapp: wa } }
 });

 if (signUpError) {
 const msg = signUpError.message?.toLowerCase() || '';
 if (msg.includes('already registered') || msg.includes('already exists') || msg.includes('user already')) {
 // Account exists - just sign them in directly
 toast('Account exists - signing you in...', '', 'info', 3000);
 appStorage.setItem('bs_manual_navigation_pass', 'true');
 const { data: loginData, error: loginError } = await withTimeout(
 db.auth.signInWithPassword({ email, password }),
 15000,
 'Sign in timed out. Please refresh and try again.'
 );
 if (loginError) {
 toast('Sign In Failed', 'Account exists but password is wrong. Try signing in.', 'error', 7000);
 return;
 }
 const user = loginData.session?.user || loginData.user;
 await withTimeout(onAuthSuccess(user), 10000, 'Profile loading timed out. Please refresh and try again.');
 closeModal('auth-modal');
 continuePendingEntry();
 return;
 } else if (msg.includes('rate limit') || msg.includes('too many')) {
 toast('Too Many Attempts', 'Wait a few minutes and try again', 'warn', 7000);
 } else {
 toast('Sign Up Failed', signUpError.message, 'error');
 }
 return;
 }

 // Step 2: Always immediately sign in after signup - guarantees a live session
 // regardless of whether email confirmation setting is truly off
 appStorage.setItem('bs_manual_navigation_pass', 'true');
 const { data: loginData, error: loginError } = await withTimeout(
 db.auth.signInWithPassword({ email, password }),
 15000,
 'Sign in timed out. Please refresh and try again.'
 );

 if (loginError) {
 // Signup worked but auto-login failed - tell them to sign in manually
 toast('Account Created!', 'Now sign in with your email and password', 'success', 6000);
 toggleAuth('login');
 document.getElementById('auth-email').value = email;
 return;
 }

 const user = loginData.session?.user || loginData.user;
 await upsertProfile(user, { name, role, accounts, whatsapp: wa });
 await withTimeout(onAuthSuccess(user), 10000, 'Profile loading timed out. Please refresh and try again.');
 closeModal('auth-modal');
 continuePendingEntry();

 const msgs = {
 buyer: 'Welcome! Browse thousands of products.',
 seller: 'Welcome Seller! Your store access is free.',
 both: 'Welcome! You can shop and sell on BUYSELL.',
 service_provider: 'Welcome Service Pro! Set up your portfolio and start getting hired.'
 };
 setTimeout(() => toast('Account Created!', msgs[rawRole] || '', 'success', 5000), 400);
 }

 } catch(err) {
 console.error('Auth error:', err);
 toast('Authentication Failed', err.message || 'Please try again', 'error');
 } finally {
 spinner.classList.add('hidden');
 btnText.textContent = document.getElementById('auth-tab-login').classList.contains('active')
 ? 'Sign In' : 'Create Account';
 btn.disabled = false;
 }
}

async function upsertProfile(user, meta) {
 if (!user?.id) return;
 const referredBy = meta.referred_by || appStorage.getItem('bs_ref') || user.user_metadata?.referred_by || '';
 const { error } = await db.from('profiles').upsert({
 id: user.id,
 name: meta.name || user.user_metadata?.name || 'User',
 email: user.email,
 role: meta.role || user.user_metadata?.role || 'buyer',
 accounts: meta.accounts || user.user_metadata?.accounts || meta.role || 'buyer',
 whatsapp: meta.whatsapp || user.user_metadata?.whatsapp || '',
 trial_end: null,
 commission_paid: true,
 is_suspended: false,
 referral_code: user.user_metadata?.referral_code || 'ref_' + Math.random().toString(36).substr(2, 8),
 referred_by: referredBy
 }, { onConflict: 'id', ignoreDuplicates: false });
 if (error) console.warn('upsertProfile error:', error.message);
}

async function onAuthSuccess(user) {
 if (!user) return;
 currentUser = user;
 let googleProfileHint = {};
 try {
 googleProfileHint = JSON.parse(appStorage.getItem('bs_google_profile_hint') || '{}');
 } catch {
 googleProfileHint = {};
 }

 // Load profile from DB
 const { data: profile, error } = await db.from('profiles').select('*').eq('id', user.id).single();

 if (error || !profile) {
 // Profile not yet created (trigger may still be running) - create it now
 await upsertProfile(user, { ...(user.user_metadata || {}), ...googleProfileHint });
 const { data: retryProfile } = await db.from('profiles').select('*').eq('id', user.id).single();
 currentUser.profile = retryProfile || {
 role: googleProfileHint.role || user.user_metadata?.role || 'buyer',
 name: user.user_metadata?.name || user.user_metadata?.full_name || user.email?.split('@')[0] || 'User',
 email: user.email
 };
 } else {
 currentUser.profile = profile;
 }
 appStorage.removeItem('bs_google_profile_hint');

 currentRole = currentUser.profile?.role || 'buyer';
 updateNavForUser();
 updateInboxCount();
 setupMessageRealtime();
}

async function checkSession() {
 // Subscribe to auth state changes FIRST so we don't miss the initial event
 db.auth.onAuthStateChange((event, session) => {
 setTimeout(async () => {
 if (event === 'SIGNED_IN' && session?.user) {
 if (!currentUser) {
 await onAuthSuccess(session.user);
  if (hasAppRouteParams()) {
  await continueUrlRoute();
  } else if (appStorage.getItem('bs_manual_navigation_pass') || hasAuthRedirectParams()) {
  continuePendingEntry();
  } else {
  showMarketLandingPage();
 }
 }
 }
 if (event === 'SIGNED_OUT') {
 if (messageChannel) {
 db.removeChannel(messageChannel);
 messageChannel = null;
 }
 currentUser = null;
 currentRole = 'buyer';
 currentChatPartner = null;
 currentChatProductId = null;
 updateInboxCount();
 }
 if (event === 'TOKEN_REFRESHED' && session?.user) {
 currentUser = session.user;
 }
 if (event === 'USER_UPDATED' && session?.user) {
 currentUser = session.user;
 }
 }, 0);
 });

 // Then check for an existing persisted session
 const { data: { session } } = await db.auth.getSession();
 if (session?.user) {
 await onAuthSuccess(session.user);
  if (hasAppRouteParams()) await continueUrlRoute();
  else if (hasAuthRedirectParams()) continuePendingEntry();
  }
}

function updateNavForUser() {
 if (!currentUser) return;
 document.getElementById('nav-auth-btns').classList.add('hidden');
 document.getElementById('nav-user-btns').classList.remove('hidden');
 const initial = (currentUser.profile?.name || currentUser.email || 'U')[0].toUpperCase();
 document.getElementById('nav-avatar-inner').textContent = initial;
 document.getElementById('nav-avatar-inner').style.fontSize = '.9rem';
 updateNotificationButtonState();
 if ('Notification' in window && Notification.permission === 'granted') {
 syncUserNotificationToken().catch(error => {
 console.warn('[PUSH ENGINE] Background subscription refresh failed:', error.message || error);
 });
 }
 document.getElementById('dash-user-name').textContent = currentUser.profile?.name || 'Seller';
 document.getElementById('dash-user-email').textContent = currentUser.email || '';
 // Admin check
 // DB-backed admin check - email alone is not sufficient
 const isAdmin = isAdminEmail();
 if (isAdmin) {
 document.getElementById('admin-nav-item')?.classList.remove('hidden');
 }
 // Referral link
 const rc = currentUser.profile?.referral_code || 'ref_' + currentUser.id?.substr(0,8);
 document.getElementById('referral-link').value = `${PUBLIC_SITE_URL}/ref/${rc}`;
}

async function sendPasswordReset() {
 const email = document.getElementById('forgot-email').value.trim();
 if (!email) { toast('Enter your email', '', 'warn'); return; }

 const btn = document.getElementById('forgot-btn');
 const btnText = document.getElementById('forgot-btn-text');
 const spinner = document.getElementById('forgot-spinner');
 btn.disabled = true; btnText.textContent = ''; spinner.classList.remove('hidden');

 try {
 const { error } = await db.auth.resetPasswordForEmail(email, {
 redirectTo: PUBLIC_SITE_URL
 });

 if (error) {
 const msg = error.message?.toLowerCase() || '';
 if (msg.includes('rate limit') || msg.includes('too many')) {
 toast('Too many attempts', 'Wait a few minutes and try again', 'warn', 7000);
 } else {
 toast('Failed to send reset link', error.message, 'error');
 }
 return;
 }

 // Show success step
 document.getElementById('forgot-step-1').classList.add('hidden');
 document.getElementById('forgot-step-2').classList.remove('hidden');
 document.getElementById('forgot-sent-to').textContent = 'Reset link sent to ' + email;
 toast('Reset link sent! "', 'Check your email inbox', 'success', 6000);

 } catch(e) {
 toast('Error', e.message || 'Please try again', 'error');
 } finally {
 spinner.classList.add('hidden');
 btnText.textContent = 'Send Reset Link';
 btn.disabled = false;
 }
}

// OK REPLACE WITH THIS:
async function logoutUser() {
 // 1. Log out of active Supabase database session
 await db.auth.signOut();
 
 if (messageChannel) {
 db.removeChannel(messageChannel);
 messageChannel = null;
 }
 currentUser = null;
 currentChatPartner = null;
 currentChatProductId = null;
 document.getElementById('nav-auth-btns').classList.remove('hidden');
 document.getElementById('nav-user-btns').classList.add('hidden');
 updateInboxCount();
 enterSite('buyer');
 toast('Signed Out', '', 'info');
}

async function deleteMyAccount() {
 if (!currentUser) { showModal('auth-modal'); toggleAuth('login'); return; }
 const typed = prompt('This permanently deletes your BUYSELL account. Type DELETE to continue.');
 if (typed !== 'DELETE') {
 toast('Account deletion cancelled', 'No changes were made.', 'info');
 return;
 }

 const btn = document.getElementById('delete-account-btn');
 const oldHtml = btn?.innerHTML;
 if (btn) {
 btn.disabled = true;
 btn.innerHTML = '<span class="spinner"></span> Deleting account...';
 }

 try {
 await callEdge('delete-account', { confirm: 'DELETE' });
 appStorage.clear();
 appSessionStorage.clear();
 await db.auth.signOut().catch(() => {});
 currentUser = null;
 currentChatPartner = null;
 currentChatProductId = null;
 toast('Account Deleted', 'Your BUYSELL account has been removed.', 'success', 7000);
 setTimeout(() => window.location.assign('/'), 1200);
 } catch (err) {
 toast('Delete Failed', err.message || 'Could not delete your account right now.', 'error', 7000);
 if (btn) {
 btn.disabled = false;
 btn.innerHTML = oldHtml || '<i class="fa-solid fa-user-slash"></i> Delete My Account';
 }
 }
}


async function generateDescription() {
 const name = document.getElementById('p-name').value.trim();
 const price = document.getElementById('p-price').value;
 const category = document.getElementById('p-category').value;
 const condition = document.getElementById('p-condition').value;

 if (!name) { toast('Enter product name first', '', 'warn'); return; }

 const btn = event.target.closest('button');
 btn.disabled = true;
 btn.innerHTML = '<span class="spinner-dark"></span> Writing...';

 try {
 const res = await fetch(CLAUDE_EDGE_URL, {
 method: 'POST',
 headers: { 'Content-Type': 'application/json', apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
 body: JSON.stringify({
 messages: [{
 role: 'user',
 content: `Write a compelling product description for a Nigerian marketplace listing.
 Product: ${name}
 Category: ${category}
 Condition: ${condition}
 Price: \u20A6${price}
 
 Requirements:
 - 2 - 3 sentences max
 - Highlight key benefits
 - Mention it's available in Nigeria
 - No bullet points, plain text only
 - Sound authentic and trustworthy`
 }],
 context: { task: 'product_description' }
 }),
 });

 const data = await res.json();
 if (data.reply) {
 document.getElementById('p-desc').value = data.reply;
 toast('Description Generated! Done', 'Edit it to your liking', 'success');
 }
 } catch(e) {
 toast('AI unavailable', 'Write description manually', 'warn');
 } finally {
 btn.disabled = false;
 btn.innerHTML = '<i class="fa-solid fa-magic"></i> Generate with AI';
 }
}



function showProfile() { showAccountPage(); }

// ====================================================
// SITE NAVIGATION
// ====================================================
function handleLandingAuthClick() {
 if (currentUser) {
 enterSite(currentUser.profile?.role || 'buyer');
 } else {
 openEntryAuth('buyer', 'login');
 }
}

function enterSite(mode) {
 const entryRole = setPendingEntryRole(mode);
 console.log(" Manual selection pass triggered for role:", mode);
 
 appStorage.setItem('bs_manual_navigation_pass', 'true');

 if (!currentUser) {
 if (entryRole === 'buyer') {
 appStorage.removeItem('bs_manual_navigation_pass');
 clearPendingEntryRole();
 showBuyerView();
 return;
 }
 openEntryAuth(entryRole, 'login');
 return;
 } // ' Closes: if (!currentUser)

 if (document.getElementById('marketing-placeholder')) document.getElementById('marketing-placeholder').style.setProperty('display', 'none', 'important');
 if (document.getElementById('landing')) document.getElementById('landing').style.setProperty('display', 'none', 'important');

 if (entryRole === 'seller' || entryRole === 'both') {
 if (typeof showSellerDashboard === 'function') showSellerDashboard();
 } else {
 if (typeof showBuyerView === 'function') showBuyerView();
 }
} // ' Closes: function enterSite(mode)


// ==========================================
// 1. Paste the Helper Function (Top Level or near your other UI functions)
// ==========================================


// ==========================================
// 2. Add it directly inside your existing Auth Listener
// ==========================================


function showBuyerView() {
 const buyerView = document.getElementById('buyer-view');
 const sellerDash = document.getElementById('seller-dashboard');
 const storefrontView = document.getElementById('storefront-view');
 const mainNav = document.getElementById('main-nav');
 const adminPortal = document.getElementById('admin-portal-view');
 const landingPortal = document.getElementById('landing');
 const marketingPlaceholder = document.getElementById('marketing-placeholder');
 const accountView = document.getElementById('account-view');

 // Direct Inline Override: Force reveal using style properties to bypass stylesheet conflicts
 if (buyerView) {
 buyerView.classList.remove('hidden');
 buyerView.style.setProperty('display', 'block', 'important');
 }
 if (mainNav) {
 mainNav.classList.remove('hidden');
 mainNav.style.setProperty('display', 'block', 'important');
 }

 // Force hide alternative system elements completely
 if (sellerDash) { sellerDash.classList.add('hidden'); sellerDash.style.setProperty('display', 'none', 'important'); }
 if (storefrontView) { storefrontView.classList.add('hidden'); storefrontView.style.setProperty('display', 'none', 'important'); }
 if (adminPortal) { adminPortal.classList.add('hidden'); adminPortal.style.setProperty('display', 'none', 'important'); }
 if (landingPortal) { landingPortal.classList.add('hidden'); landingPortal.style.setProperty('display', 'none', 'important'); }
 if (marketingPlaceholder) { marketingPlaceholder.classList.add('hidden'); marketingPlaceholder.style.setProperty('display', 'none', 'important'); }
 if (accountView) { accountView.classList.add('hidden'); accountView.style.setProperty('display', 'none', 'important'); }

 const toggleIcon = document.getElementById('toggle-view-icon');
 const toggleText = document.getElementById('toggle-view-text');
 if (toggleIcon) toggleIcon.className = 'fa-solid fa-store';
 if (toggleText) toggleText.textContent = 'Seller Dashboard';
 
 const mobHamBtn = document.getElementById('mob-ham-btn');
 if (mobHamBtn) mobHamBtn.style.setProperty('display', 'none', 'important');
 
 document.body.classList.remove('in-seller', 'platform-seller-mode');
 currentRole = 'buyer';

 if (typeof startCarousel === 'function') startCarousel();
 if (typeof loadProducts === 'function') loadProducts();
 if (typeof loadUpcomingProducts === 'function') loadUpcomingProducts();
 if (typeof loadActiveAds === 'function') loadActiveAds();
 if (typeof updateCartCount === 'function') updateCartCount();
}

async function showSellerDashboard() {
 if (!currentUser) { showModal('auth-modal'); toggleAuth('login'); return; }
 if (isSellerAccessExpired()) { showSellerAccessBlocked(); return; }
 if (!(await requireSellerKyc())) return;

 const buyerView = document.getElementById('buyer-view');
 const sellerDash = document.getElementById('seller-dashboard');
 const storefrontView = document.getElementById('storefront-view');
 const mainNav = document.getElementById('main-nav');
 const adminPortal = document.getElementById('admin-portal-view');
 const landingPortal = document.getElementById('landing');
 const marketingPlaceholder = document.getElementById('marketing-placeholder');
 const accountView = document.getElementById('account-view');

 // Direct Inline Override: Force layout display block for the merchant workspace panel
 if (sellerDash) {
 sellerDash.classList.remove('hidden');
 sellerDash.style.setProperty('display', 'block', 'important');
 
 // Failsafe: Ensure its inner direct child layout wrapper isn't set to display none by CSS
 const innerLayout = sellerDash.querySelector('.dash-layout');
 if (innerLayout) innerLayout.style.setProperty('display', 'flex', 'important');
 }
 if (mainNav) {
 mainNav.classList.remove('hidden');
 mainNav.style.setProperty('display', 'block', 'important');
 }

 // Force hide buyer marketplace feeds and pre-login options entirely
 if (buyerView) { buyerView.classList.add('hidden'); buyerView.style.setProperty('display', 'none', 'important'); }
 if (storefrontView) { storefrontView.classList.add('hidden'); storefrontView.style.setProperty('display', 'none', 'important'); }
 if (adminPortal) { adminPortal.classList.add('hidden'); adminPortal.style.setProperty('display', 'none', 'important'); }
 if (landingPortal) { landingPortal.classList.add('hidden'); landingPortal.style.setProperty('display', 'none', 'important'); }
 if (marketingPlaceholder) { marketingPlaceholder.classList.add('hidden'); marketingPlaceholder.style.setProperty('display', 'none', 'important'); }
 if (accountView) { accountView.classList.add('hidden'); accountView.style.setProperty('display', 'none', 'important'); }

 const toggleIcon = document.getElementById('toggle-view-icon');
 const toggleText = document.getElementById('toggle-view-text');
 if (toggleIcon) toggleIcon.className = 'fa-solid fa-store';
 if (toggleText) toggleText.textContent = 'Back to Shopping';
 
 const mobHamBtn = document.getElementById('mob-ham-btn');
 if (mobHamBtn) mobHamBtn.style.setProperty('display', 'flex', 'important');

 const adminNavItem = document.getElementById('admin-nav-item');
 if (adminNavItem) adminNavItem.style.setProperty('display', (isAdminEmail() ? 'flex' : 'none'), 'important');
 
 document.body.classList.add('in-seller');
 currentRole = 'seller';
 updatePlatformSellerDashboardChrome();
 
 if (typeof stopCarousel === 'function') stopCarousel();
 if (typeof checkSellerCommission === 'function') checkSellerCommission();
 if (typeof loadSellerStats === 'function') loadSellerStats();
 if (typeof loadSellerProds === 'function') loadSellerProds();
 if (typeof loadSellerOrders === 'function') loadSellerOrders();
 if (typeof renderChart === 'function') renderChart();
 if (typeof loadWithdrawalData === 'function') loadWithdrawalData();
 if (typeof loadDropshipData === 'function') loadDropshipData();
 if (typeof loadAffiliateData === 'function') loadAffiliateData();
 if (typeof loadSellerAds === 'function') loadSellerAds();
}
function isSellerAccessExpired(profile = currentUser?.profile) {
 return false;
}

function isKycApprovedStatus(status) {
 return ['approved', 'verified', 'accepted'].includes(String(status || '').toLowerCase());
}

function isKycSubmittedStatus(status) {
 return ['pending', 'submitted', 'in_review', 'review'].includes(String(status || '').toLowerCase());
}

async function getSellerKycStatus(userId = currentUser?.id) {
 if (!userId) return { status: 'missing', row: null };
 if (currentUser?.profile && (currentUser.profile.seller_verified || isKycApprovedStatus(currentUser.profile.kyc_status || currentUser.profile.verification_status))) {
 return { status: 'approved', row: null };
 }
 try {
 const { data, error } = await db.from('kyc_verifications')
 .select('id,status,created_at')
 .eq('user_id', userId)
 .order('created_at', { ascending: false })
 .limit(1);
 if (error) throw error;
 const row = data?.[0] || null;
 return { status: row?.status || 'missing', row };
 } catch (e) {
 console.warn('KYC status check failed:', e);
 return { status: currentUser?.profile?.kyc_status || 'missing', row: null };
 }
}

async function requireSellerKyc() {
 if (!currentUser || isAdminEmail()) return true;
 const { status } = await getSellerKycStatus(currentUser.id);
 if (isKycApprovedStatus(status) || isKycSubmittedStatus(status)) return true;
 showBuyerView();
 const msg = status === 'rejected'
 ? 'Your KYC was rejected. Please resubmit clear documents before using the seller dashboard.'
 : 'Complete KYC before using your seller dashboard.';
 toast('KYC Required', msg, 'warn', 7000);
 showModal('kyc-modal');
 return false;
}

function showSellerAccessBlocked() {
 showBuyerView();
 document.getElementById('suspended-modal')?.classList.add('open');
}



function toggleView() {
 if (currentRole === 'seller') showBuyerView();
 else { if (!currentUser) { showModal('auth-modal'); return; } showSellerDashboard(); }
}

function handleNavBrand(e) {
 e.preventDefault();
 if (currentRole === 'seller') showBuyerView();
 else loadProducts();
}

function showDash(section) {
 document.querySelectorAll('.dash-section').forEach(s => s.classList.remove('active'));
 document.querySelectorAll('.dash-nav-item').forEach(n => n.classList.remove('active'));
 const el = document.getElementById(`ds-${section}`);
 if (el) el.classList.add('active');
 const navItems = document.querySelectorAll('.dash-nav-item');
 navItems.forEach(n => { if (n.textContent.toLowerCase().includes(section.replace('-',' '))) n.classList.add('active'); });
 if (section === 'products') loadSellerProds();
 if (section === 'orders') loadSellerOrders();
 if (section === 'reviews') loadSellerReviews();
 if (section === 'admin') { if (!guardAdminPanel()) return; loadAdminOverview(); }
 if (section === 'settings') loadSettings();
 if (section === 'withdrawals') { loadWithdrawalData(); loadWithdrawalHistory(); }
 if (section === 'dropshipping') loadDropshipData();
 if (section === 'affiliate') loadAffiliateData();
 if (section === 'advertise') loadSellerAds();
 if (section === 'coupons') { 
 loadSellerCoupons(); 
 loadFlashSaleProducts();
}
 if (section === 'analytics') loadSellerAnalytics();
 if (section === 'support') loadBroadcastMessages('seller-broadcast-list');
 updatePlatformSellerDashboardChrome();
}

function setMobActive(btn) {
 document.querySelectorAll('.mob-bot-item').forEach(b => b.classList.remove('active'));
 btn.classList.add('active');
}

function renderWithdrawalHistory(withdrawals) {
 const tbody = document.getElementById('wd-history');
 if (!tbody) return;
 
 if (!withdrawals || withdrawals.length === 0) {
 tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:1rem;color:var(--text3)">No withdrawal history yet</td></tr>';
 return;
 }
 
 tbody.innerHTML = withdrawals.map(w => `
 <tr>
 <td>${fmtDate(w.created_at)}</td>
 <td class="font-bold">${fmtN(w.amount)}</td>
 <td><span class="badge ${w.status === 'paid' ? 'badge-green' : 'badge-gold'}">${w.status}</span></td>
 <td class="text-xs color-text3">${w.id?.substr(0,8) || ' - '}</td>
 </tr>
 `).join('');
}

// ====================================================
// SIDEBAR (MOBILE)
// ====================================================
function openMobSidebar() {
 document.getElementById('dash-sidebar').classList.add('open');
 document.getElementById('mob-overlay').classList.add('open');
 document.getElementById('mob-sidebar-close').style.display = 'block';
}
function closeMobSidebar() {
 document.getElementById('dash-sidebar').classList.remove('open');
 document.getElementById('mob-overlay').classList.remove('open');
}

// ====================================================
// CAROUSEL
// ====================================================
function slideCarousel(dir) {
 const slides = document.querySelectorAll('.carousel-slide').length;
 carouselIndex = (carouselIndex + dir + slides) % slides;
 updateCarousel();
}
function goSlide(i) { carouselIndex = i; updateCarousel(); }
function updateCarousel() {
 document.getElementById('carousel-track').style.transform = `translateX(-${carouselIndex * 100}%)`;
 document.querySelectorAll('.carousel-dot').forEach((d,i) => d.classList.toggle('active', i === carouselIndex));
}
function startCarousel() {
 stopCarousel();
 carouselTimer = setInterval(() => slideCarousel(1), 5000);
 // Touch swipe
 const el = document.getElementById('hero-carousel');
 if (el) {
 el.addEventListener('touchstart', e => { carouselStartX = e.touches[0].clientX; }, { passive: true });
 el.addEventListener('touchend', e => { const dx = e.changedTouches[0].clientX - carouselStartX; if (Math.abs(dx) > 40) slideCarousel(dx < 0 ? 1 : -1); }, { passive: true });
 }
}
function stopCarousel() { if (carouselTimer) clearInterval(carouselTimer); }

// ====================================================
// PRODUCTS
// ====================================================
async function loadProducts() {
 document.getElementById('prods-skeleton').classList.remove('hidden');
 document.getElementById('prods-grid').classList.add('hidden');
 document.getElementById('prods-empty').classList.add('hidden');
 document.getElementById('prods-error').classList.add('hidden');
 try {
 let q = db.from('products').select(`*, profiles(name, email, role, accounts, store_name, store_description, whatsapp, bank_name, account_number, account_name, paystack_key)`).eq('status', 'active').order('created_at', { ascending: false });
 const { data, error } = await q;
 if (error) throw error;
 products = data || [];
 filteredProducts = [...products];
 applyCurrentFilters();
 } catch(e) {
 document.getElementById('prods-skeleton').classList.add('hidden');
 document.getElementById('prods-error').classList.remove('hidden');
  }
}

async function loadUpcomingProducts() {
 const section = document.getElementById('buyer-upcoming-section');
 const grid = document.getElementById('buyer-upcoming-grid');
 if (!section || !grid) return;
 try {
  const { data, error } = await db
  .from('upcoming_products')
  .select('*')
  .eq('status', 'active')
  .order('priority', { ascending: false })
  .order('created_at', { ascending: false })
  .limit(8);
  if (error) throw error;
  const rows = data || [];
  if (!rows.length) {
  section.classList.add('hidden');
  grid.innerHTML = '';
  return;
  }
  section.classList.remove('hidden');
  grid.innerHTML = rows.map(upcomingProductCard).join('');
 } catch (e) {
  console.warn('Upcoming products unavailable:', e.message || e);
  section.classList.add('hidden');
 }
}

function upcomingMediaList(row = {}) {
 const images = Array.isArray(row.images) ? row.images.filter(Boolean) : [];
 const videos = Array.isArray(row.videos) ? row.videos.filter(Boolean) : [];
 if (!images.length && row.image_url) images.push(row.image_url);
 if (!videos.length && row.video_url) videos.push(row.video_url);
 return { images, videos };
}

function upcomingProductCard(row) {
 const { images, videos } = upcomingMediaList(row);
 const cover = videos[0] || images[0] || 'https://images.unsplash.com/photo-1607082348824-0a96f2a4b9da?w=600&h=600&fit=crop';
 const isVideo = !!videos[0];
 const launchText = row.launch_date ? `Launching ${fmtDate(row.launch_date)}` : 'Coming soon';
 return `
 <article class="upcoming-card">
 <div class="upcoming-media">
 ${isVideo
 ? `<video src="${escAttr(cover)}" controls playsinline preload="metadata"></video>`
 : `<img src="${escAttr(cover)}" alt="${escAttr(row.title || 'Upcoming product')}" loading="lazy">`}
 <span class="upcoming-badge"><i class="fa-solid fa-shield-halved"></i> Platform Store</span>
 </div>
 <div class="upcoming-body">
 <span>${escHtml(launchText)}</span>
 <h3>${escHtml(row.title || 'Upcoming Product')}</h3>
 <p>${escHtml(row.description || 'A new official BUYSELL product preview is coming soon.')}</p>
 <button class="btn btn-outline btn-sm" onclick="toast('Coming Soon','This product is not available for purchase yet.','info')"><i class="fa-solid fa-bell"></i> Notify Me</button>
 </div>
 </article>`;
}

function renderProducts(prods) {
 document.getElementById('prods-skeleton').classList.add('hidden');
 document.getElementById('prod-count').textContent = prods.length;
 const grid = document.getElementById('prods-grid');
 if (!prods.length) { grid.classList.add('hidden'); document.getElementById('prods-empty').classList.remove('hidden'); return; }
 document.getElementById('prods-empty').classList.add('hidden');
 grid.classList.remove('hidden');
 grid.innerHTML = prods.map(p => prodCard(p)).join('');
}

function prodCard(p) {
 const now = new Date();
 const isFlashActive = p.flash_price && p.flash_end && new Date(p.flash_end) > now;
 const displayPrice = isFlashActive ? p.flash_price : p.price;
 const platformProduct = isPlatformProduct(p);
 const sellerLabel = platformProduct ? 'BUYSELL Platform Store' : getPlatformStoreLabel(p.profiles || {});
 
 const discount = p.original_price > displayPrice 
 ? Math.round((1 - displayPrice / p.original_price) * 100) 
 : 0;

 // Safely look for images array
 const imageList = Array.isArray(p.images) ? p.images.filter(Boolean) : [];

 // --- FIXED IMAGE RESOLUTION ---
 // Prioritize the primary database column string, then look inside scraped arrays, then fallback to unsplash
 const resolvedCardThumbnail = p.image_url || imageList[0] || 'https://images.unsplash.com/photo-1607082348824-0a96f2a4b9da?w=400&h=400&fit=crop';

 const cartItem = {
 id: p.id,
 name: p.name,
 price: displayPrice,
 shipping_fee: itemShippingFee(p),
 shipping_cost: itemShippingFee(p),
 image_url: resolvedCardThumbnail, 
 seller_id: p.seller_id,
 profiles: p.profiles,
 is_flash: isFlashActive
 };

 const stockPct = p.stock_quantity !== undefined ? p.stock_quantity : 999;
 const isSoldOut = stockPct === 0;

 const imageCount = imageList.length > 0 ? imageList.length : (p.image_url ? 1 : 0);
 const videoCount = Array.isArray(p.videos) ? p.videos.length : (p.video_url || p.has_video ? 1 : 0);

 const badges = [
 isFlashActive ? `<span class="prod-badge" style="background:var(--red); color:#fff;"><i class="fa-solid fa-bolt"></i> Flash</span>` : '',
 discount && !isFlashActive ? `<span class="prod-badge prod-badge-discount">-${discount}%</span>` : '',
 videoCount > 0 ? `<span class="prod-badge prod-badge-video"><i class="fa-solid fa-video"></i> Video (${videoCount})</span>` : '',
 imageCount > 1 ? `<span class="prod-badge" style="background:var(--blue); color:#fff;"><i class="fa-solid fa-camera"></i> Photos (${imageCount})</span>` : '',
 platformProduct ? `<span class="prod-badge prod-badge-platform"><i class="fa-solid fa-shield-halved"></i> Platform Store</span>` : '',
 p.category === 'dropship' ? `<span class="prod-badge prod-badge-drop">Dropship</span>` : '',
 p.seller_verified ? `<span class="prod-badge prod-badge-verified"><i class="fa-solid fa-check"></i> Verified</span>` : ''
 ].filter(Boolean).join('');

 const stars = starIcons(p.avg_rating || 5);

 const serializedCartData = JSON.stringify(cartItem)
 .replace(/&/g, '&amp;')
 .replace(/"/g, '&quot;')
 .replace(/'/g, '&#x27;')
 .replace(/</g, '&lt;')
 .replace(/>/g, '&gt;');

 return `
 <div class="prod-card ${platformProduct ? 'platform-product' : ''}" onclick="openProduct('${p.id}')">
 <div class="prod-img-wrap">
 <img src="${resolvedCardThumbnail}" alt="${escHtml(p.name)}" loading="lazy">
 ${badges ? `<div class="prod-flags">${badges}</div>` : ''}
 ${isSoldOut 
 ? `<div class="prod-sold-overlay"><span class="prod-sold-label">SOLD OUT</span></div>` 
 : `<button class="prod-quick-add" onclick="event.stopPropagation();addToCart(${serializedCartData})" aria-label="Add to cart"><i class="fa-solid fa-cart-plus"></i></button>`
 }
 </div>
 <div class="prod-body">
 <div class="prod-name">${escHtml(p.name)}</div>
 <div class="prod-price-row">
 <span class="prod-price">${fmtN(displayPrice)}</span>
 ${p.original_price > displayPrice ? `<span class="prod-orig">${fmtN(p.original_price)}</span>` : ''}
 </div>
 <div class="prod-shipping text-xs color-text3" style="margin-top:.15rem"><i class="fa-solid fa-truck"></i> Shipping: ${fmtN(itemShippingFee(p))}</div>
 <div class="prod-rating-row"><span class="stars sm">${stars}</span><span class="text-xs color-text3">${p.avg_rating ? p.avg_rating.toFixed(1) : '5.0'} (${p.review_count||0})</span></div>
 <div class="prod-location"><i class="fa-solid fa-map-marker-alt" style="font-size:.6rem"></i>${escHtml(p.location||'Nigeria')}</div>
  <a class="prod-store-link ${platformProduct ? 'platform-store-link' : ''}" onclick="event.stopPropagation();viewStorefront('${p.seller_id}')"><i class="fa-solid ${platformProduct ? 'fa-shield-halved' : 'fa-store'}" style="font-size:.6rem"></i>${escHtml(sellerLabel)}</a>
 ${!isSoldOut ? `<button class="prod-mobile-add" onclick="event.stopPropagation();addToCart(${serializedCartData})"><i class="fa-solid fa-cart-plus"></i> Add to Cart</button>` : ''}
 </div>
 </div>`;
}

// ====================================================
// FILTERS & SEARCH
// ====================================================

const CATEGORY_PAGE_LABELS = {
 all: 'All Products',
 trending: 'Trending Products',
 electronics: 'Electronics',
 phones: 'Phones & Tablets',
 fashion: 'Fashion',
 home: 'Home & Kitchen',
 beauty: 'Beauty & Health',
 sports: 'Sports',
 dropship: 'Dropshipping Products',
};

const CATEGORY_PAGE_URLS = {
 all: 'products.html',
 trending: 'category-trending.html',
 electronics: 'category-electronics.html',
 phones: 'category-phones.html',
 fashion: 'category-fashion.html',
 home: 'category-home.html',
 beauty: 'category-beauty.html',
 sports: 'category-sports.html',
 dropship: 'category-dropship.html',
};

function categoryLabel(cat) {
 return CATEGORY_PAGE_LABELS[cat] || String(cat || 'Products').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function setCategoryUrl(cat) {
 const url = new URL(window.location.href);
 if (!cat || cat === 'all') url.searchParams.delete('category');
 else url.searchParams.set('category', cat);
 url.searchParams.delete('product');
 url.searchParams.delete('store');
 history.pushState({ category: cat || 'all' }, '', `${url.pathname}${url.search}${url.hash}`);
}

function filterCat(cat, options = {}) {
 const selected = cat || 'all';
 document.querySelectorAll('.cat-chip').forEach(c => c.classList.toggle('active', c.dataset.cat === selected));
 document.querySelectorAll('[data-category-link]').forEach(btn => btn.classList.toggle('active', btn.dataset.categoryLink === selected));
 if (selected === 'all') {
  delete activeFilters.category;
  document.getElementById('section-title-text').textContent = 'Latest Products';
 } else {
  activeFilters.category = selected;
  document.getElementById('section-title-text').textContent = categoryLabel(selected);
 }
 applyCurrentFilters();
 if (options.updateUrl) setCategoryUrl(selected);
 if (options.scroll) {
  switchBuyerTab?.('shop');
  document.querySelector('.products-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
 }
}

function openCategoryPage(cat) {
 const selected = cat || 'all';
 appStorage.setItem('bs_last_market_route', 'index.html?view=shop');
 if (window.history?.replaceState) {
  const url = new URL(window.location.href);
  url.searchParams.set('view', 'shop');
  url.searchParams.delete('product');
  url.searchParams.delete('store');
  window.history.replaceState({ view: 'shop' }, '', `${url.pathname}${url.search}${url.hash}`);
 }
 window.location.href = CATEGORY_PAGE_URLS[selected] || `products.html?category=${encodeURIComponent(selected)}`;
}

let searchTimeout;
// Replace doSearch() with this Claude-enhanced version
async function doSearch() {
 const q = validateInput(document.getElementById('search-input').value.trim());
 if (!q) return;

 // First do the normal fuzzy search (fast, free)
 activeFilters.search = q.toLowerCase();
 applyCurrentFilters();

 // If < 3 results, ask Claude for query suggestions
 if (filteredProducts.length < 3 && q.length > 4) {
 try {
 const res = await fetch(CLAUDE_EDGE_URL, {
 method: 'POST',
 headers: { 'Content-Type': 'application/json', apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
 body: JSON.stringify({
 messages: [{
 role: 'user',
 content: `A user searched "${q}" on a Nigerian marketplace. 
 Suggest 2-3 alternative single-word search terms 
 they might mean. Reply ONLY with the terms 
 comma-separated, nothing else.`
 }],
 context: { task: 'search_suggestion' }
 }),
 });
 const data = await res.json();
 if (data.reply) {
 const suggestions = data.reply.split(',').map(s => s.trim()).filter(Boolean);
 if (suggestions.length) {
 toast(
 `' Try searching: ${suggestions.slice(0,2).join(', ')}`,
 'Showing closest matches',
 'info',
 4000
 );
 }
 }
 } catch(e) { /* silent fail */ }
 }
}

function applyFilters() {
 const min = parseFloat(document.getElementById('flt-min').value) || 0;
 const max = parseFloat(document.getElementById('flt-max').value) || Infinity;
 const rating = parseFloat(document.getElementById('flt-rating').value) || 0;
 const cond = document.querySelector('input[name="cond"]:checked')?.value || '';
 if (min > 0) activeFilters.priceMin = min;
 if (max < Infinity) activeFilters.priceMax = max;
 if (rating) activeFilters.minRating = rating;
 if (cond) activeFilters.condition = cond;
 const count = Object.keys(activeFilters).filter(k=>!['category','search'].includes(k)).length;
 const fc = document.getElementById('filter-count');
 fc.textContent = count; fc.style.display = count ? 'flex' : 'none';
 applyCurrentFilters();
 closeModal('filters-modal');
 renderActiveFilters();
}

function renderActiveFilters() {
 const container = document.getElementById('active-filters');
 const pills = [];
 if (activeFilters.priceMin||activeFilters.priceMax) pills.push({key:'price',label:`${fmtN(activeFilters.priceMin||0)} - ${activeFilters.priceMax ? fmtN(activeFilters.priceMax) : 'Any'}`});
 if (activeFilters.minRating) pills.push({key:'minRating',label:`${activeFilters.minRating}+ ${starText(1)}`});
 if (activeFilters.condition) pills.push({key:'condition',label:activeFilters.condition});
 container.innerHTML = pills.map(p => `<span class="active-filter-pill">${p.label}<button onclick="removeFilter('${p.key}')"><i class="fa-solid fa-times"></i></button></span>`).join('');
}

function removeFilter(key) {
 if(key==='price'){delete activeFilters.priceMin;delete activeFilters.priceMax;}
 else delete activeFilters[key];
 applyCurrentFilters();
 renderActiveFilters();
 const count = Object.keys(activeFilters).filter(k=>!['category','search'].includes(k)).length;
 const fc = document.getElementById('filter-count');
 fc.textContent = count; fc.style.display = count ? 'flex' : 'none';
}

function clearFilters() {
 activeFilters = {};
 document.querySelectorAll('.cat-chip').forEach(c => c.classList.toggle('active', c.dataset.cat === 'all'));
 document.getElementById('filter-count').style.display = 'none';
 document.getElementById('active-filters').innerHTML = '';
 applyCurrentFilters();
}

function applyCurrentFilters() {
 let result = [...products];

 // 1. SMART FUZZY SEARCH
 if (activeFilters.search) {
 const options = {
 keys: ['name', 'description', 'category', 'location'],
 threshold: 0.3, // 0.0 = perfect match, 1.0 = match anything
 distance: 100
 };
 
 const fuse = new Fuse(result, options);
 const searchResult = fuse.search(activeFilters.search);
 result = searchResult.map(res => res.item);
 }

 // 2. CATEGORY FILTER
 if (activeFilters.category && activeFilters.category !== 'all') {
 if (activeFilters.category === 'trending') {
 result = result.filter(p => p.review_count > 0 || p.avg_rating >= 4);
 } else {
 result = result.filter(p => p.category === activeFilters.category);
 }
 }

 // 3. RANGE FILTERS
 if (activeFilters.priceMin) result = result.filter(p => p.price >= activeFilters.priceMin);
 if (activeFilters.priceMax) result = result.filter(p => p.price <= activeFilters.priceMax);
 if (activeFilters.minRating) result = result.filter(p => (p.avg_rating || 5) >= activeFilters.minRating);

 filteredProducts = result;
 sortProds();
}

function sortProds() {
 const v = document.getElementById('sort-select').value;
 if (v==='price-asc') filteredProducts.sort((a,b)=>a.price-b.price);
 else if (v==='price-desc') filteredProducts.sort((a,b)=>b.price-a.price);
 else if (v==='rating') filteredProducts.sort((a,b)=>(b.avg_rating||5)-(a.avg_rating||5));
 else filteredProducts.sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
 renderProducts(filteredProducts);
}

function updatePriceDisplay() {
 const min = document.getElementById('flt-min').value || 0;
 const max = document.getElementById('flt-max').value || '500,000';
 document.getElementById('price-range-display').textContent = `${fmtN(min)} - ${fmtN(max)}`;
}

// ====================================================
// PRODUCT DETAIL
// ====================================================
// ====================================================
// PRODUCT DETAIL - MULTI-MEDIA GALLERY ENHANCED
// ====================================================
// ====================================================
// PRODUCT DETAIL - FLUID MULTI-MEDIA GALLERY UNIFIED
// ====================================================
async function openProduct(id) {
 currentProd = products.find(p => p.id === id);
 if (!currentProd) return;
 const p = currentProd;
 
 // --- FLASH SALE LOGIC ---
 const now = new Date();
 const isFlashActive = p.flash_price && p.flash_end && new Date(p.flash_end) > now;
 const displayPrice = isFlashActive ? p.flash_price : p.price;
 // ---

 showModal('product-modal');
 
 // Clean up and prepare raw media lists safely, ignoring empty values
 const imgArray = (Array.isArray(p.images) ? p.images : (p.image_url ? [p.image_url] : [])).filter(Boolean);
 const vidArray = (Array.isArray(p.videos) ? p.videos : (p.video_url ? [p.video_url] : [])).filter(Boolean);
 
 // Combine all interactive media assets into a single clean list for scrolling
 const structuralMediaList = [];
 vidArray.forEach(v => structuralMediaList.push({ type: 'video', url: v }));
 imgArray.forEach(i => structuralMediaList.push({ type: 'image', url: i }));
 
 // Fallback string security logic if both lists came back completely empty
 if (structuralMediaList.length === 0) {
 structuralMediaList.push({ 
 type: 'image', 
 url: p.image_url || 'https://images.unsplash.com/photo-1607082348824-0a96f2a4b9da?w=600' 
 });
 }

 // Gallery view containers inside product-modal
 const mainContainer = document.getElementById('gallery-main');
 if (mainContainer) {
 // FORCE STRUCTURAL BOUNDS: Prevent custom videos from squashing modal grid systems
 mainContainer.style.width = '100%';
 mainContainer.style.height = '320px';
 mainContainer.style.maxHeight = '350px';
 mainContainer.style.position = 'relative';
 mainContainer.style.background = '#000';
 mainContainer.style.borderRadius = '12px';
 mainContainer.style.overflow = 'hidden';
 mainContainer.style.display = 'flex';
 mainContainer.style.alignItems = 'center';
 mainContainer.style.justifyContent = 'center';
 }
 
 // Internal helper function to change the main viewer frame smoothly
 window.switchProductModalMediaView = function(index) {
 const asset = structuralMediaList[index];
 if (!asset || !mainContainer) return;
 
 if (asset.type === 'video') {
 mainContainer.innerHTML = `
 <div style="position:relative; width:100%; height:100%; display:flex; align-items:center; justify-content:center;">
 <video src="${escAttr(asset.url)}" controls autoplay muted playsinline 
 style="width:100%; height:100%; object-fit:contain; background:#000;">
 </video>
 </div>`;
 } else {
 mainContainer.innerHTML = `
 <img src="${escAttr(asset.url)}" alt="${escAttr(p.name)}" 
 style="width:100%; height:100%; object-fit:contain; background:#fafafa;">`;
 }
 
 // Highlight matching active thumbnail preview container border dynamically
 document.querySelectorAll('.modal-thumb-nav-btn').forEach((btn, btnIdx) => {
 btn.style.borderColor = btnIdx === index ? 'var(--green)' : 'var(--border)';
 btn.style.boxShadow = btnIdx === index ? '0 0 0 2px var(--green-xlt)' : 'none';
 });
 };

 // Force clean up old navigation nodes from prior modal instances before calculating HTML Injections
 const existingThumbs = document.querySelector('.modal-media-thumbnails');
 if (existingThumbs) existingThumbs.remove();

 // Add slider preview thumbnails if multiple media files are available
 let thumbListHtml = '';
 if (structuralMediaList.length > 1) {
 thumbListHtml = `<div class="modal-media-thumbnails" style="display:flex; gap:8px; margin-top:12px; overflow-x:auto; padding-bottom:6px; width:100%; scrollbar-width:thin;">`;
 structuralMediaList.forEach((asset, idx) => {
 if (asset.type === 'video') {
 thumbListHtml += `
 <button class="modal-thumb-nav-btn" onclick="switchProductModalMediaView(${idx})" style="width:54px; height:54px; border:2px solid var(--border); border-radius:8px; overflow:hidden; background:#000; position:relative; flex-shrink:0; cursor:pointer; padding:0; transition:all 0.15s ease;">
 <i class="fa-solid fa-circle-play" style="position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); color:#fff; font-size:1.1rem; z-index:2; filter:drop-shadow(0 2px 4px rgba(0,0,0,0.5));"></i>
 <video src="${escAttr(asset.url)}" style="width:100%; height:100%; object-fit:cover; opacity:0.55;"></video>
 </button>`;
 } else {
 thumbListHtml += `
 <button class="modal-thumb-nav-btn" onclick="switchProductModalMediaView(${idx})" style="width:54px; height:54px; border:2px solid var(--border); border-radius:8px; overflow:hidden; background:#fff; flex-shrink:0; cursor:pointer; padding:0; transition:all 0.15s ease;">
 <img src="${escAttr(asset.url)}" style="width:100%; height:100%; object-fit:cover;">
 </button>`;
 }
 });
 thumbListHtml += `</div>`;
 }
 
 if (thumbListHtml && mainContainer) {
 mainContainer.insertAdjacentHTML('afterend', thumbListHtml);
 }

 // Render the initial primary media layout (and apply thumbnail highlight styles now that nodes exist)
 switchProductModalMediaView(0);

 // Info mapping
 document.getElementById('modal-prod-name').textContent = p.name;
 document.getElementById('modal-price').textContent = fmtN(displayPrice);
 document.getElementById('modal-desc').textContent = p.description || '';
 
 const origEl = document.getElementById('modal-orig-price');
 const discEl = document.getElementById('modal-discount');
 
 if (p.original_price > displayPrice) {
 origEl.textContent = fmtN(p.original_price);
 discEl.textContent = `-${Math.round((1 - displayPrice / p.original_price) * 100)}%`;
 discEl.classList.remove('hidden');
 } else { 
 origEl.textContent = ''; 
 discEl.classList.add('hidden'); 
 }

 document.getElementById('modal-condition').textContent = p.condition || 'New';
 document.getElementById('modal-location').textContent = p.location || 'Nigeria';
 const modalShippingEl = document.getElementById('modal-shipping-fee');
 if (modalShippingEl) modalShippingEl.textContent = `Shipping: ${fmtN(itemShippingFee(p))}`;
 
 const stock = p.stock_quantity;
 const sb = document.getElementById('modal-stock-badge');
 sb.textContent = stock === 0 ? 'Sold Out' : stock <= 5 ? `Only ${stock} left!` : 'In Stock';
 sb.className = `badge ${stock===0?'badge-red':stock<=5?'badge-gold':'badge-green'}`;
 
 document.getElementById('modal-cart-btn').disabled = stock === 0;
 
 // Ensure structured metadata mapping matches product configuration parameters correctly
 document.getElementById('modal-cart-btn').onclick = () => {
 addToCart({ 
 ...p, 
 price: displayPrice, 
 is_flash: isFlashActive 
 });
 closeModal('product-modal');
 };
 
 document.getElementById('modal-negotiable-note').classList.toggle('hidden', !p.negotiable);
 
 // Seller Profile Mapping
// Seller Profile Mapping
 const seller = p.profiles || {};
 const platformProduct = isPlatformProduct(p);
 const sellerLabel = platformProduct ? 'BUYSELL Platform Store' : getPlatformStoreLabel(seller);
 document.getElementById('modal-seller-name').textContent = sellerLabel;
 document.getElementById('modal-seller-email').textContent = platformProduct ? 'Official marketplace store' : 'Contact via In-App Chat Secure System';
 document.getElementById('modal-seller-avatar').textContent = platformProduct ? 'B' : (seller.name||'S')[0].toUpperCase();

 // SECURED FORCE: Ensure any direct WhatsApp shortcut button on the product modal is completely hidden or repurposed
 const modalWaBtn = document.getElementById('modal-whatsapp-btn') || document.querySelector('.modal-wa-btn');
 if (modalWaBtn) {
 modalWaBtn.style.display = 'none'; // Completely strip it from the user display tree
 }

 // Bind the in-app chat trigger securely to the action button
 const contactSellerBtn = document.getElementById('modal-contact-btn') || document.getElementById('modal-chat-btn');
 if (contactSellerBtn) {
 const productId = p.id;
 contactSellerBtn.onclick = () => {
  openMessageModal(p.seller_id, sellerLabel, productId);
 closeModal('product-modal');
 };
 }
 
 // Flags Layout Array Injections
 const flags = [];
 if (isFlashActive) flags.push('<span class="prod-badge" style="background:var(--red);color:#fff">Flash Flash Sale</span>');
 if (vidArray.length > 0) flags.push('<span class="prod-badge prod-badge-video"> Video Available</span>');
 if (platformProduct) flags.push('<span class="prod-badge prod-badge-platform"><i class="fa-solid fa-shield-halved"></i> Platform Store</span>');
 if (p.seller_verified) flags.push('<span class="prod-badge prod-badge-verified">OK Verified</span>');
 document.getElementById('modal-flags').innerHTML = flags.join('');
 
 updateModalWishBtn();
 loadProductReviews(id);
 trackAnalytics({ event_type: 'product_view', product_id: p.id, seller_id: p.seller_id });
}
 
async function loadProductReviews(productId) {
 let { data, error } = await db.from('reviews').select('*,profiles!reviewer_id(name)').eq('product_id', productId).order('created_at', { ascending: false }).limit(10);
 if (error) {
 ({ data } = await db.from('reviews').select('*,profiles!buyer_id(name)').eq('product_id', productId).order('created_at', { ascending: false }).limit(10));
 }
 const reviews = data || [];
 const count = reviews.length;
 document.getElementById('modal-review-count').textContent = `${count} review${count!==1?'s':''}`;
 document.getElementById('modal-verified-count').textContent = count;

 // Calculate average and star distribution
 const avg = count ? (reviews.reduce((s,r)=>s+r.rating,0)/count) : 0;
 document.getElementById('modal-avg-rating').textContent = avg.toFixed(1);
 document.getElementById('modal-stars').textContent = starText(avg);

 // Star distribution bars (5->1)
 const barsEl = document.getElementById('modal-rating-bars');
 barsEl.innerHTML = [5,4,3,2,1].map(star => {
 const starCount = reviews.filter(r => r.rating === star).length;
 const pct = count ? Math.round((starCount / count) * 100) : 0;
 return `<div style="display:flex;align-items:center;gap:.4rem">
 <span style="font-size:.62rem;color:var(--text3);width:12px;text-align:right">${star}</span>
 <div style="flex:1;height:6px;background:var(--border);border-radius:3px;overflow:hidden">
 <div style="width:${pct}%;height:100%;background:${star>=4?'var(--green)':star>=3?'var(--gold)':'var(--red)'};border-radius:3px;transition:width .3s"></div>
 </div>
 <span style="font-size:.58rem;color:var(--text3);width:18px">${starCount}</span>
 </div>`;
 }).join('');

 // Review list
 const list = document.getElementById('modal-reviews-list');
 if (!count) { list.innerHTML = '<p class="color-text3 text-sm" style="padding:.5rem 0">No reviews yet. Be the first to share your experience!</p>'; return; }
 list.innerHTML = reviews.map(r => `
 <div class="review-card">
 <div class="flex justify-between items-center">
 <div style="display:flex;align-items:center;gap:.4rem">
 <div style="width:26px;height:26px;border-radius:50%;background:var(--green-xlt);display:flex;align-items:center;justify-content:center;font-size:.65rem;font-weight:700;color:var(--green)">${(r.profiles?.name||'B')[0].toUpperCase()}</div>
 <span class="reviewer-name">${escHtml(r.profiles?.name||'Verified Buyer')}</span>
 </div>
 <div class="stars sm">${starIcons(r.rating)}</div>
 </div>
 <p class="review-text">${escHtml(r.review_text || r.comment || '')}</p>
 <span class="text-xs color-text3"><i class="fa-solid fa-check-circle" style="color:var(--green)"></i> Verified Purchase - ${fmtDate(r.created_at)}</span>
 </div>`).join('');
}

async function loadProductReviews(productId) {
 let { data, error } = await db.from('reviews').select('*,profiles!reviewer_id(name)').eq('product_id', productId).order('created_at', { ascending: false }).limit(20);
 if (error) {
 ({ data } = await db.from('reviews').select('*,profiles!buyer_id(name)').eq('product_id', productId).order('created_at', { ascending: false }).limit(20));
 }
 const reviews = data || [];
 const count = reviews.length;
 document.getElementById('modal-review-count').textContent = `${count} review${count!==1?'s':''}`;
 document.getElementById('modal-verified-count').textContent = reviews.filter(r => r.verified_purchase !== false).length;
 const avg = count ? (reviews.reduce((s,r)=>s+Number(r.rating || 0),0)/count) : 0;
 document.getElementById('modal-avg-rating').textContent = avg.toFixed(1);
 document.getElementById('modal-stars').textContent = starText(avg);
 const barsEl = document.getElementById('modal-rating-bars');
 barsEl.innerHTML = [5,4,3,2,1].map(star => {
 const starCount = reviews.filter(r => Number(r.rating) === star).length;
 const pct = count ? Math.round((starCount / count) * 100) : 0;
 return `<div style="display:flex;align-items:center;gap:.4rem"><span style="font-size:.62rem;color:var(--text3);width:12px;text-align:right">${star}</span><div style="flex:1;height:6px;background:var(--border);border-radius:3px;overflow:hidden"><div style="width:${pct}%;height:100%;background:${star>=4?'var(--green)':star>=3?'var(--gold)':'var(--red)'};border-radius:3px"></div></div><span style="font-size:.58rem;color:var(--text3);width:18px">${starCount}</span></div>`;
 }).join('');
 const list = document.getElementById('modal-reviews-list');
 if (!count) { list.innerHTML = '<p class="color-text3 text-sm" style="padding:.5rem 0">No reviews yet. Be the first to share your experience!</p>'; return; }
 list.innerHTML = reviews.map(r => {
 const imgs = Array.isArray(r.image_urls) ? r.image_urls : [];
 return `<div class="review-card"><div class="flex justify-between items-center"><div style="display:flex;align-items:center;gap:.4rem"><div style="width:26px;height:26px;border-radius:50%;background:var(--green-xlt);display:flex;align-items:center;justify-content:center;font-size:.65rem;font-weight:700;color:var(--green)">${(r.profiles?.name||'B')[0].toUpperCase()}</div><span class="reviewer-name">${escHtml(r.profiles?.name||'Verified Buyer')}</span></div><div class="stars sm">${starIcons(r.rating)}</div></div><p class="review-text">${escHtml(r.review_text || r.comment || '')}</p>${imgs.length ? `<div class="review-images-gallery">${imgs.map(url => `<img src="${escAttr(url)}" alt="Review photo" onclick="openReviewImage('${escAttr(url)}')">`).join('')}</div>` : ''}<span class="text-xs color-text3"><i class="fa-solid fa-check-circle" style="color:var(--green)"></i> ${r.verified_purchase === false ? 'Buyer Review' : 'Verified Purchase'} - ${fmtDate(r.created_at)}</span></div>`;
 }).join('');
}

// ====================================================
// STOREFRONT
// ====================================================


function goBackFromStorefront() {
 const storefrontView = document.getElementById('storefront-view');
 const buyerView = document.getElementById('buyer-view');
 if (storefrontView) {
 storefrontView.classList.add('hidden');
 storefrontView.style.display = 'none';
 }
 if (buyerView) {
 buyerView.classList.remove('hidden');
 buyerView.style.display = 'block';
 }
}

function shareStore() {
 const url = window.location.href;
 if (navigator.share) { navigator.share({ title: 'BUYSELL Store', url }); }
 else { navigator.clipboard.writeText(url); toast('Link Copied!','','success'); }
}

function copyStoreLink() {
 const link = `${PUBLIC_SITE_URL}/store/${currentUser?.id?.substr(0,8)||'your-store'}`;
 navigator.clipboard.writeText(link).then(()=>toast('Store Link Copied!','Share with customers','success'));
}

// ====================================================
// CART
// ====================================================
function saveCart() { appStorage.setItem('bs_cart', JSON.stringify(cart)); updateCartCount(); }

function itemShippingFee(item = {}) {
 return Math.max(0, Number(item.shipping_fee ?? item.shipping_cost ?? item.shipping ?? 0) || 0);
}

function cartSellerKey(item = {}) {
 return String(item.seller_id || item.profiles?.id || item.store_id || item.id || 'unknown');
}

function cartProductTotal() {
 return cart.reduce((sum, item) => sum + (Number(item.price || 0) * (item.qty || 1)), 0);
}

function cartSellerShippingGroups() {
 const groups = new Map();
 cart.forEach(item => {
 const sellerKey = cartSellerKey(item);
 const existing = groups.get(sellerKey) || { sellerKey, sellerName: item.profiles?.name || 'Seller', fee: 0, count: 0 };
 existing.fee = Math.max(existing.fee, itemShippingFee(item));
 existing.count += item.qty || 1;
 groups.set(sellerKey, existing);
 });
 return [...groups.values()];
}

function cartShippingTotal() {
 return cartSellerShippingGroups().reduce((sum, group) => sum + group.fee, 0);
}

function checkoutCartItems(includeDetails = false) {
 const groupFees = new Map(cartSellerShippingGroups().map(group => [group.sellerKey, group.fee]));
 const feeApplied = new Set();
 return cart.map(item => {
 const sellerKey = cartSellerKey(item);
 const chargedShipping = feeApplied.has(sellerKey) ? 0 : (groupFees.get(sellerKey) || 0);
 feeApplied.add(sellerKey);
 const base = {
 id: item.id,
 qty: item.qty || 1,
 shipping_fee: chargedShipping,
 shipping_cost: chargedShipping,
 };
 if (!includeDetails) return base;
 return {
 ...base,
 name: item.name,
 price: item.price,
 image_url: item.image_url || '',
 };
 });
}

function cartPayableSubtotal() {
 return cartProductTotal() + cartShippingTotal();
}

function addToCart(prod) {
 if (!prod?.id) return;
 const shippingFee = itemShippingFee(prod);

 const existing = cart.find(c => c.id === prod.id);

 if (existing) {
 // Increment quantity
 existing.qty = (existing.qty || 1) + 1;
 
 // IMPORTANT: Update the price to the current one passed in (in case it changed)
 // This ensures if a user adds a flash sale item, the price is locked correctly.
 existing.price = prod.price; 
 existing.shipping_fee = shippingFee;
 existing.shipping_cost = shippingFee;
 existing.is_flash = prod.is_flash; 
 } else {
 // Add new item with the provided price (which is the flash price if active)
 cart.push({ ...prod, shipping_fee: shippingFee, shipping_cost: shippingFee, qty: 1 });
 }

 saveCart();
 
 trackAnalytics({ 
 event_type: 'add_to_cart', 
 product_id: prod.id, 
 seller_id: prod.seller_id, 
 amount: prod.price || 0 
 });
 
 toast('Added to Cart!', prod.name, 'success', 2000);
}

function removeFromCart(id) { cart = cart.filter(c => c.id !== id); saveCart(); renderCartItems(); }

function changeCartQty(id, delta) {
 const item = cart.find(c => c.id === id);
 if (!item) return;
 item.qty = Math.max(1, (item.qty||1) + delta);
 saveCart();
 renderCartItems();
}

function updateCartCount() {
 const count = cart.reduce((s,c)=>s+(c.qty||1),0);
 document.getElementById('cart-count').textContent = count;
 document.getElementById('cart-count').style.display = count ? 'flex' : 'none';
}

function openCart() {
 renderCartItems();
 showModal('cart-modal');
}

function renderCartItems() {
 const list = document.getElementById('cart-items-list');
 const empty = document.getElementById('cart-empty');
 const summary = document.getElementById('cart-summary');
 if (!cart.length) { list.innerHTML=''; empty.classList.remove('hidden'); summary.classList.add('hidden'); return; }
 empty.classList.add('hidden'); summary.classList.remove('hidden');
 const productTotal = cartProductTotal();
 const shippingTotal = cartShippingTotal();
 const total = productTotal + shippingTotal;
 list.innerHTML = cart.map(c => `
 <div class="cart-item">
 <img src="${c.image_url||'https://images.unsplash.com/photo-1607082348824-0a96f2a4b9da?w=200'}" alt="${escHtml(c.name)}" loading="lazy">
 <div style="flex:1;min-width:0">
 <div class="font-600 text-sm" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:180px">${escHtml(c.name)}</div>
 <div class="color-green font-bold">${fmtN(c.price)}</div>
 <div class="text-xs color-text3">Store shipping: ${fmtN(itemShippingFee(c))}</div>
 <div class="flex items-center gap-2 mt-1">
 <button onclick="changeCartQty('${c.id}',-1)" class="btn btn-outline btn-sm" style="padding:.2rem .5rem">-</button>
 <span class="text-sm font-bold">${c.qty||1}</span>
 <button onclick="changeCartQty('${c.id}',1)" class="btn btn-outline btn-sm" style="padding:.2rem .5rem">+</button>
 </div>
 </div>
 <div style="display:flex;flex-direction:column;align-items:flex-end;gap:.4rem">
 <span class="font-bold text-sm">${fmtN(c.price*(c.qty||1))}</span>
 <button onclick="removeFromCart('${c.id}')" class="btn btn-sm" style="background:#fee2e2;color:var(--danger);padding:.28rem .62rem"><i class="fa-solid fa-trash"></i></button>
 </div>
 </div>`).join('');
 document.getElementById('cart-subtotal').textContent = fmtN(productTotal);
 const shippingEl = document.getElementById('cart-shipping');
 if (shippingEl) shippingEl.textContent = fmtN(shippingTotal);
 document.getElementById('cart-total').textContent = fmtN(total);
}

// ====================================================
// CHECKOUT
// ====================================================
function buyNow(prod) {
 cart = [{ ...prod, qty: 1 }];
 saveCart();
 closeModal('product-modal');
 startCheckout();
}

function isSellerAccount(profile = currentUser?.profile || {}) {
 const role = profile.role || 'buyer';
 const accounts = profile.accounts || '';
 return role === 'seller' || role === 'admin' || role === 'both' || accounts === 'seller' || accounts === 'both';
}

async function getSellerAvailableRevenue(sellerId = currentUser?.id) {
 if (!sellerId) return { available: 0, revenue: 0, pending: 0, paid: 0, walletDebits: 0 };

 const [{ data: orders }, { data: withdrawals }, { data: walletTransactions }] = await Promise.all([
 db.from('orders').select('total_amount,status').eq('seller_id', sellerId),
 db.from('withdrawals').select('amount,status').eq('seller_id', sellerId),
 db.from('wallet_transactions').select('amount,type').eq('seller_id', sellerId)
 ]);

 const revenue = (orders || [])
 .filter(o => o.status === 'delivered')
 .reduce((sum, o) => sum + Number(o.total_amount || 0), 0);
 const pending = (withdrawals || [])
 .filter(w => w.status === 'pending')
 .reduce((sum, w) => sum + Number(w.amount || 0), 0);
 const paid = (withdrawals || [])
 .filter(w => w.status === 'paid')
 .reduce((sum, w) => sum + Number(w.amount || 0), 0);
 const walletDebits = (walletTransactions || [])
 .filter(t => String(t.type || '').startsWith('debit'))
 .reduce((sum, t) => sum + Number(t.amount || 0), 0);
 const available = Math.max(0, (revenue * 0.92) - pending - paid - walletDebits);

 return { available, revenue, pending, paid, walletDebits };
}

async function startCheckout() {
 if (!currentUser) { showModal('auth-modal'); return; }
 if (!cart.length) { toast('Cart is empty','','warn'); return; }

 let availableBalance = Number(currentUser?.profile?.wallet_balance || 0);
 const isSeller = isSellerAccount();
 if (isSeller) {
 try {
 const wallet = await getSellerAvailableRevenue(currentUser.id);
 availableBalance = wallet.available;
 if (currentUser.profile) currentUser.profile.wallet_balance = availableBalance;
 const wdAvailable = document.getElementById('wd-available');
 if (wdAvailable) wdAvailable.textContent = fmtN(availableBalance);
 } catch (err) {
 console.warn('Could not refresh wallet revenue before checkout:', err);
 loadWithdrawalData();
 }
 }
 
 const rawProductTotal = cartPayableSubtotal();
 
 trackAnalytics({
 event_type: 'checkout_started',
 seller_id: cart[0]?.seller_id,
 quantity: cart.reduce((sum,c)=>sum+(c.qty||1),0),
 amount: rawProductTotal,
 metadata: { item_count: cart.length, shipping_total: cartShippingTotal() },
 });
 
 goCheckoutStep(1);
 showModal('checkout-modal');
 
 // Pre-fill user profile info
 const p = currentUser.profile || {};
 if (p.name) document.getElementById('co-name').value = p.name;
 document.getElementById('co-pay-email').textContent = currentUser.email;
 
 // --- INVISIBLE COMMISSION MATHEMATICS ---
 const secretComm = Math.round(rawProductTotal * PLATFORM_FEE_PCT);
 const totalWithCommission = rawProductTotal + secretComm;
 
 // Render the unified price containing the commission hidden inside
 document.getElementById('co-pay-amount').textContent = fmtN(totalWithCommission);
 document.getElementById('co-total').textContent = fmtN(totalWithCommission);
 
 // Mask the old commission UI layout block and slide it out of display tree
 const commEl = document.getElementById('co-commission');
 if (commEl) {
 commEl.textContent = fmtN(0);
 commEl.closest('.pay-row')?.classList.add('hidden');
 }
 
// --- DYNAMIC PAYMENT METHOD RENDERING (WITH WALLET CHANNELS) ---
 const isUnderfunded = availableBalance < totalWithCommission;

 let walletCardHtml = '';
 if (isSeller) {
 walletCardHtml = `
 <div class="payment-method-card wallet-card ${isUnderfunded ? 'disabled' : ''}" 
 id="pm-wallet" onclick="if(!${isUnderfunded}){selectCheckoutPaymentMethod('wallet')}"
 style="position:relative; overflow:hidden; border:2px solid var(--border); border-radius:var(--radius-sm); padding:1rem; cursor:${isUnderfunded ? 'not-allowed' : 'pointer'}; opacity:${isUnderfunded ? '0.6' : '1'}">
 <span class="payment-method-icon"><i class="fa-solid fa-wallet" style="color:var(--green)"></i></span>
 <div class="payment-method-title">Wallet Revenue</div>
 <div class="payment-method-sub">Available: ${fmtN(availableBalance)}</div>
 ${isUnderfunded ? `<div style="color:var(--danger); font-size:0.65rem; font-weight:700; margin-top:4px;"> Insufficient Funds</div>` : ''}
 </div>`;
 }

 const methodGrid = document.getElementById('co-p2');
 if (methodGrid) {
 const gridContainer = methodGrid.querySelector('.payment-method-grid');
 if (gridContainer) {
 gridContainer.outerHTML = `
 <div class="payment-method-grid" style="display:grid; grid-template-columns: repeat(auto-fit, minmax(8.5rem, 1fr)); gap:0.7rem;">
 <div class="payment-method-card paystack-card selected" id="pm-paystack" onclick="selectCheckoutPaymentMethod('paystack')">
 <span class="payment-method-icon"><i class="fa-solid fa-credit-card" style="color:#0BA4DB"></i></span>
 <div class="payment-method-title">Paystack Checkout</div>
 <div class="payment-method-sub">Cards, USSD, bank checkout</div>
 </div>
 ${walletCardHtml}
 </div>`;
 }
 }

 // Reset explicit gateway checkout selection state to default on entry window
 checkoutPaymentMethod = 'paystack'
 
 // Order items rendering engine 
 document.getElementById('co-items').innerHTML = cart.map(c=>`
 <div class="order-item">
 <img src="${c.image_url||'https://images.unsplash.com/photo-1607082348824-0a96f2a4b9da?w=100'}" alt="" loading="lazy">
 <div style="flex:1;min-width:0"><div class="font-600 text-sm" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:200px">${escHtml(c.name)}</div><div class="color-text3 text-xs">Qty: ${c.qty||1} - Store shipping: ${fmtN(itemShippingFee(c))}</div></div>
 <div class="font-bold text-sm">${fmtN(c.price*(c.qty||1))}</div>
 </div>`).join('');
 
 const bankBox = document.getElementById('seller-bank-details-co');
 if (bankBox) {
 bankBox.innerHTML = `<p class="text-xs color-text3 p-2">Direct seller bank transfer is no longer available. Please use Paystack checkout.</p>`;
 }
}
function goCheckoutStep(step) {
 document.querySelectorAll('.checkout-panel').forEach(p => p.classList.remove('active'));
 document.getElementById(`co-p${step}`).classList.add('active');
 for (let i=1;i<=3;i++) {
 const dot = document.getElementById(`cp${i}`);
 dot.classList.toggle('done', i < step);
 dot.classList.toggle('active', i === step);
 if (i<3) document.getElementById(`cl${i}`).classList.toggle('done', i < step);
 }
 if (step===2) {
 const name = document.getElementById('co-name').value.trim();
 const phone = document.getElementById('co-phone').value.trim();
 const addr = document.getElementById('co-address').value.trim();
 if (!name||!phone||!addr) { toast('Please fill delivery info','','warn'); goCheckoutStep(1); }
 }
}

function selectPM(method) {
 selectCheckoutPaymentMethod(method);
}

function isPaystackReady() {
 if (typeof PaystackPop === 'undefined' && typeof Paystack === 'undefined') {
 toast('Payment unavailable', 'Paystack could not load. Please try again.', 'error');
 return false;
 }
 if (!PAYSTACK_PUBLIC_KEY || !/^pk_(test|live)_/.test(PAYSTACK_PUBLIC_KEY)) {
 toast('Payment not configured', 'Set a valid Paystack public key in config.js.', 'error');
 return false;
 }
 return true;
}

function openPaystackTransaction(options) {
 const reference = options.reference || options.ref;
 const onSuccess = options.onSuccess || options.callback;
 const onCancel = options.onCancel || options.onClose;
 const onError = options.onError || ((error) => {
 toast('Payment Error', error?.message || 'Could not initialize Paystack', 'error');
 });
 const commonOptions = { ...options, reference, onSuccess, onCancel, onError };
 delete commonOptions.ref;
 delete commonOptions.callback;
 delete commonOptions.onClose;

 if (typeof Paystack !== 'undefined') {
 const popup = new Paystack();
 if (typeof popup.newTransaction === 'function') {
 popup.newTransaction(commonOptions);
 return;
 }
 if (typeof popup.checkout === 'function') {
 popup.checkout(commonOptions);
 return;
 }
 }

 if (typeof PaystackPop !== 'undefined') {
 try {
 const popup = new PaystackPop();
 if (typeof popup.newTransaction === 'function') {
 popup.newTransaction(commonOptions);
 return;
 }
 if (typeof popup.checkout === 'function') {
 popup.checkout(commonOptions);
 return;
 }
 } catch (_) {
 // Older InlineJS exposes PaystackPop.setup as a static method.
 }

 if (typeof PaystackPop.setup === 'function') {
 const handler = PaystackPop.setup({
 ...options,
 ref: reference,
 callback: onSuccess,
 onClose: onCancel,
 });
 handler.openIframe();
 return;
 }
 }

 throw new Error('Paystack could not be initialized');
}

async function resolvePaystackReference(response, fallback = '') {
 return response?.reference ||
 response?.trxref ||
 response?.transaction_reference ||
 response?.data?.reference ||
 response?.data?.trxref ||
 fallback;
}

async function payWithPaystack() {
 if (cart.length === 0) { toast('Cart is empty', '', 'warn'); return; }
 const rawProductTotal = cartPayableSubtotal();
 if (rawProductTotal <= 0) { toast('Invalid total amount', '', 'error'); return; }
 if (!currentUser) { showModal('auth-modal'); return; }
 if (!isPaystackReady()) return;

 const btn = document.querySelector('#pm-paystack-panel .btn-paystack');
 const oldHtml = btn?.innerHTML;
 if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Initializing Paystack...'; }

 try {
 const checkoutPayload = {
 cart: checkoutCartItems(),
 shipping_total: cartShippingTotal(),
 shipping_groups: cartSellerShippingGroups(),
 delivery_name: document.getElementById('co-name').value.trim(),
 delivery_phone: document.getElementById('co-phone').value.trim(),
 delivery_address: document.getElementById('co-address').value.trim(),
 };
 if (!checkoutPayload.delivery_name || !checkoutPayload.delivery_phone || !checkoutPayload.delivery_address) {
 toast('Delivery info needed', 'Enter your name, phone, and address before paying.', 'warn');
 goCheckoutStep(1);
 if (btn) { btn.disabled = false; btn.innerHTML = oldHtml; }
 return;
 }

 // --- INVISIBLE COMMISSION MATHEMATICS ---
 const secretComm = Math.round(rawProductTotal * PLATFORM_FEE_PCT);
 const hiddenTotalBillAmount = rawProductTotal + secretComm;
 
 const reference = 'bs_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
 const amountKobo = Math.round(hiddenTotalBillAmount * 100); // Send total with built-in fee to gateway

 openPaystackTransaction({
 key: PAYSTACK_PUBLIC_KEY,
 email: currentUser.email,
 amount: amountKobo,
 currency: 'NGN',
 reference,
 metadata: {
 user_id: currentUser.id,
 cart: checkoutPayload.cart,
 },
 onSuccess: async function(response) {
 toast('Verifying Payment...', 'Please do not close the window', 'info');

 try {
 const result = await callEdge('verify-payment', {
 reference: response.reference || response.trxref || reference,
 ...checkoutPayload,
 payment_method: 'paystack',
 });
 if (result.success) {
 const seller = cart[0]?.profiles;
 if (seller?.whatsapp) sendWhatsAppOrderNotification({ id: result.order_id, total_amount: result.total_paid }, seller.whatsapp);
 
 trackAnalytics({
 event_type: 'order_created',
 seller_id: cart[0]?.seller_id,
 order_id: result.order_id,
 quantity: cart.reduce((sum,c)=>sum+(c.qty||1),0),
 amount: result.total_paid || hiddenTotalBillAmount,
 metadata: { payment_method: 'paystack' },
 });
 
 cart = []; saveCart();
 document.getElementById('co-order-id').textContent = result.order_id || '';
 document.getElementById('co-order-total').textContent = fmtN(result.total_paid || hiddenTotalBillAmount);
 goCheckoutStep(3);
 toast('Payment Verified!', 'Your order is confirmed', 'success');
 }
 } catch (err) {
 toast('Verification Error', (err.message || 'Contact support') + ' Ref: ' + (response.reference || response.trxref || reference), 'error');
 } finally {
 if (btn) { btn.disabled = false; btn.innerHTML = oldHtml; }
 }
 },
 onCancel: () => {
 if (btn) { btn.disabled = false; btn.innerHTML = oldHtml; }
 toast('Payment cancelled', '', 'warn');
 }
 });
 } catch (err) {
 if (btn) { btn.disabled = false; btn.innerHTML = oldHtml; }
 toast('Payment Error', err.message || 'Could not initialize Paystack', 'error');
 }
}

// --- NEW WALLET SELECTION METHOD AND ENGINE CORES ---
function selectCheckoutPaymentMethod(method) {
 const nextMethod = ['paystack', 'wallet'].includes(method) ? method : 'paystack';
 checkoutPaymentMethod = nextMethod;
 const paystackCard = document.getElementById('pm-paystack');
 const transferCard = document.getElementById('pm-transfer');
 const walletCard = document.getElementById('pm-wallet');
 const paystackPanel = document.getElementById('pm-paystack-panel');
 const transferPanel = document.getElementById('pm-transfer-panel');

 if (paystackCard) paystackCard.classList.toggle('selected', nextMethod === 'paystack');
 if (transferCard) transferCard.classList.remove('selected');
 if (walletCard) walletCard.classList.toggle('selected', nextMethod === 'wallet');
 if (paystackPanel) paystackPanel.classList.remove('hidden');
 if (transferPanel) transferPanel.classList.add('hidden');
 
 // Dynamically flip the submit button execution routing target
 const payBtn = document.querySelector('#pm-paystack-panel .btn-paystack') || document.querySelector('#co-p2 .btn-primary');
 if (payBtn) {
 if (nextMethod === 'wallet') {
 payBtn.setAttribute('onclick', 'payWithWalletRevenue()');
 payBtn.innerHTML = '<i class="fa-solid fa-wallet"></i> Pay with Wallet Balance';
 payBtn.className = 'btn btn-primary btn-full btn-lg';
 } else {
 payBtn.setAttribute('onclick', 'payWithPaystack()');
 payBtn.innerHTML = '<i class="fa-solid fa-credit-card"></i> Proceed with Paystack';
 payBtn.className = 'btn btn-paystack btn-full btn-lg';
 }
 }
}

async function insertWithMissingColumnRetry(tableName, row, selectCols = '*') {
 const payload = { ...row };

 for (let attempt = 0; attempt < 10; attempt++) {
 const query = db.from(tableName).insert(payload);
 const { data, error } = selectCols
 ? await query.select(selectCols).maybeSingle()
 : await query;

 if (!error) return data;

 const col = missingColumn(error);
 if (col && Object.prototype.hasOwnProperty.call(payload, col)) {
 delete payload[col];
 continue;
 }

 throw error;
 }

 throw new Error(`Could not insert into ${tableName}`);
}

async function updateWithMissingColumnRetry(tableName, row, match) {
 const payload = { ...row };

 for (let attempt = 0; attempt < 10; attempt++) {
 let query = db.from(tableName).update(payload);
 Object.entries(match || {}).forEach(([key, value]) => {
 query = query.eq(key, value);
 });
 const { error } = await query;

 if (!error) return;

 const col = missingColumn(error);
 if (col && Object.prototype.hasOwnProperty.call(payload, col)) {
 delete payload[col];
 continue;
 }

 throw error;
 }

 throw new Error(`Could not update ${tableName}`);
}

async function createWalletRevenueOrder(checkoutPayload, totalAmount, walletRef) {
 const productSellerId = cart[0]?.seller_id;
 if (!productSellerId) throw new Error('Seller information missing from cart.');

 const orderId = crypto.randomUUID();
 const orderData = {
 id: orderId,
 buyer_id: currentUser.id,
 seller_id: productSellerId,
 items: checkoutCartItems(true),
 total_amount: totalAmount,
 status: 'pending',
 payment_method: 'wallet_revenue',
 payment_ref: walletRef,
 delivery_name: checkoutPayload.delivery_name,
 delivery_phone: checkoutPayload.delivery_phone,
 delivery_address: checkoutPayload.delivery_address,
 created_at: new Date().toISOString()
 };

 const insertedOrder = await insertWithMissingColumnRetry('orders', orderData);

 try {
 await insertWithMissingColumnRetry('wallet_transactions', {
 seller_id: currentUser.id,
 buyer_id: currentUser.id,
 order_id: insertedOrder?.id || orderId,
 amount: totalAmount,
 type: 'debit_purchase',
 reference: walletRef,
 description: 'Marketplace purchase paid with revenue wallet',
 status: 'completed',
 created_at: new Date().toISOString()
 });
 } catch (err) {
 await db.from('orders')
 .update({ status: 'cancelled' })
 .eq('id', insertedOrder?.id || orderId)
 .eq('buyer_id', currentUser.id);
 throw new Error(err.message || 'Wallet debit could not be recorded.');
 }

 return { success: true, order_id: insertedOrder?.id || orderId, total_paid: totalAmount };
}

async function payWithWalletRevenue() {
 if (cart.length === 0) { toast('Cart is empty', '', 'warn'); return; }
 const rawProductTotal = cartPayableSubtotal();
 if (!currentUser) { showModal('auth-modal'); return; }
 if (!isSellerAccount()) {
 toast('Seller wallet required', 'Only sellers can pay from available revenue.', 'warn');
 return;
 }

 const btn = document.querySelector('#pm-paystack-panel .btn-paystack') || document.querySelector('#pm-paystack-panel .btn-primary');
 const oldHtml = btn?.innerHTML;
 if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Processing Wallet Debit...'; }

 try {
 const checkoutPayload = {
 cart: checkoutCartItems(),
 shipping_total: cartShippingTotal(),
 shipping_groups: cartSellerShippingGroups(),
 delivery_name: document.getElementById('co-name').value.trim(),
 delivery_phone: document.getElementById('co-phone').value.trim(),
 delivery_address: document.getElementById('co-address').value.trim(),
 };
 if (!checkoutPayload.delivery_name || !checkoutPayload.delivery_phone || !checkoutPayload.delivery_address) {
 toast('Delivery info needed', 'Enter your name, phone, and address before paying.', 'warn');
 goCheckoutStep(1);
 return;
 }

 const secretComm = Math.round(rawProductTotal * PLATFORM_FEE_PCT);
 const hiddenTotalBillAmount = rawProductTotal + secretComm;
 const wallet = await getSellerAvailableRevenue(currentUser.id);
 if (wallet.available < hiddenTotalBillAmount) {
 toast('Insufficient Funds', `Available revenue is ${fmtN(wallet.available)}.`, 'warn');
 if (currentUser.profile) currentUser.profile.wallet_balance = wallet.available;
 const wdAvailable = document.getElementById('wd-available');
 if (wdAvailable) wdAvailable.textContent = fmtN(wallet.available);
 return;
 }

 const walletRef = 'wal_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
 const result = await createWalletRevenueOrder(checkoutPayload, hiddenTotalBillAmount, walletRef);

 if (result.success) {
 const seller = cart[0]?.profiles;
 if (seller?.whatsapp) sendWhatsAppOrderNotification({ id: result.order_id, total_amount: hiddenTotalBillAmount }, seller.whatsapp);
 
 trackAnalytics({
 event_type: 'order_created',
 seller_id: cart[0]?.seller_id,
 order_id: result.order_id,
 quantity: cart.reduce((sum,c)=>sum+(c.qty||1),0),
 amount: hiddenTotalBillAmount,
 metadata: { payment_method: 'wallet_revenue' },
 });
 
 cart = []; saveCart();
 document.getElementById('co-order-id').textContent = result.order_id || '';
 document.getElementById('co-order-total').textContent = fmtN(hiddenTotalBillAmount);
 goCheckoutStep(3);
 toast('Payment Successful!', 'Order settled via Wallet Revenue balance', 'success');
 loadWithdrawalData();
 loadSellerStats();
 }
 } catch (err) {
 toast('Transaction Declined', err.message || 'Deduction failed.', 'error');
 } finally {
 if (btn) { btn.disabled = false; btn.innerHTML = oldHtml; }
 }
}

function handleProofUpload(input) {
 if (input.files?.[0]) {
 const zone = document.getElementById('proof-upload-zone');
 zone.classList.add('has-file');
 zone.querySelector('.upload-label').textContent = input.files[0].name;
 }
}

async function submitTransferOrder() {
 const fileInput = document.getElementById('co-proof');
 const deliveryName = document.getElementById('co-name').value.trim();
 const deliveryPhone = document.getElementById('co-phone').value.trim();
 const deliveryAddress = document.getElementById('co-address').value.trim();
 if (!deliveryName || !deliveryPhone || !deliveryAddress) {
 toast('Delivery info needed', 'Enter your name, phone, and address before submitting.', 'warn');
 goCheckoutStep(1);
 return;
 }
 const sellerProfile = cart[0]?.profiles || {};
 if (!sellerProfile.bank_name || !sellerProfile.account_number || !sellerProfile.account_name) {
 toast('Bank transfer unavailable', 'This seller has not added bank details. Please use Paystack checkout.', 'warn');
 selectCheckoutPaymentMethod('paystack');
 return;
 }
 if (!fileInput.files?.[0]) { toast('Please upload payment proof','','warn'); return; }
 const proofFile = fileInput.files[0];
 const ALLOWED_PROOF = ['image/jpeg','image/jpg','image/pjpeg','image/png','image/webp','image/heic','image/heif','image/jfif','image/avif'];
 const ALLOWED_PROOF_EXT = ['jpg','jpeg','png','webp','heic','heif','jfif','avif'];
 const MAX_PROOF_SIZE = 10 * 1024 * 1024; // 10MB
 const rawName = proofFile.name || '';
 const hasExt = rawName.includes('.') && rawName.split('.').pop().length <= 5;
 const rawExt = hasExt ? rawName.split('.').pop().toLowerCase().replace(/[^a-z0-9]/g, '') : '';
 const typeExt = proofFile.type?.startsWith('image/') ? proofFile.type.split('/').pop().replace('jpeg', 'jpg').replace('pjpeg', 'jpg') : '';
 const proofExt = ALLOWED_PROOF_EXT.includes(rawExt) ? rawExt : (ALLOWED_PROOF_EXT.includes(typeExt) ? typeExt : 'jpg');
 const looksLikeImage = proofFile.type?.startsWith('image/') || ALLOWED_PROOF.includes(proofFile.type) || ALLOWED_PROOF_EXT.includes(rawExt) || (!proofFile.type && !rawExt);
 if (!looksLikeImage) { toast('Invalid file','Please upload an image receipt: JPG, PNG, WebP, HEIC, JFIF, or AVIF','warn'); return; }
 if (proofFile.size > MAX_PROOF_SIZE) { toast('File too large','Maximum proof image size is 10MB','warn'); return; }
 const btn = document.getElementById('co-transfer-btn');
 btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Submitting...';
 try {
 const file = fileInput.files[0];
 const path = `proofs/${currentUser.id}/${Date.now()}.${proofExt}`;
 let uploaded;
 try {
 uploaded = await uploadToFirstAvailableBucket(['uploads', 'products'], path, file, { contentType: file.type || undefined, upsert: false });
 } catch (uploadError) {
 throw new Error(`Receipt upload failed: ${uploadError.message || 'check Supabase storage policies'}`);
 }
 const proofUrl = uploaded.publicUrl;
 try {
 await saveOrderToDb(null, 'transfer', null, proofUrl);
 } catch (orderError) {
 throw new Error(`Order creation failed: ${orderError.message || 'check create-order function'}`);
 }
 } catch(e) { toast('Order Failed', e.message || 'Could not submit order','error'); }
 btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Submit Order';
}



// ====================================================
// REVIEWS
// ====================================================
let reviewProductId = null;
function openReviewModal(productId = null, productName = '', sellerId = null) {
 if (!currentUser) { showModal('auth-modal'); return; }
 const target = productId
 ? { id: productId, name: productName || 'Purchased item', seller_id: sellerId || null }
 : currentProd;
 if (!target?.id) return;
 reviewProductId = target.id;
 currentProd = currentProd?.id === target.id ? currentProd : { ...(currentProd || {}), ...target };
 document.getElementById('review-product-name').textContent = target.name || 'Purchased item';
 selectedRating = 0;
 setRating(0);
 document.getElementById('review-text').value = '';
 document.getElementById('review-images-input').value = '';
 document.getElementById('review-img-previews').innerHTML = '';
 showModal('review-modal');
}

function setRating(val) {
 selectedRating = val;
 document.querySelectorAll('#star-row .star-btn').forEach((b,i)=>{
 b.classList.toggle('active', i < val);
 b.style.color = i < val ? '#f59e0b' : '#d1d5db';
 });
}

async function submitReview() {
 if (!currentUser) return;
 if (!selectedRating) { toast('Please select a rating','','warn'); return; }
 const text = document.getElementById('review-text').value.trim();
 if (!text) { toast('Please write a review','','warn'); return; }
 const btn = document.getElementById('review-submit-btn');
 btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Submitting...';

 try {
 // Upload review images if any
 let imageUrls = [];
 const imgInput = document.getElementById('review-images-input');
 if (imgInput?.files?.length) {
 for (let i = 0; i < Math.min(imgInput.files.length, 3); i++) {
 const file = imgInput.files[i];
 const ext = file.name.split('.').pop();
 const path = `reviews/${currentUser.id}/${Date.now()}_${i}.${ext}`;
 const { error } = await db.storage.from('uploads').upload(path, file);
 if (!error) {
 const { data } = db.storage.from('uploads').getPublicUrl(path);
 imageUrls.push(data.publicUrl);
 }
 }
 }

 const verifiedPurchase = await hasDeliveredPurchase(reviewProductId);
 await submitProductReview({
 product_id: reviewProductId,
 rating: selectedRating,
 review_text: text,
 image_urls: imageUrls,
 verified_purchase: verifiedPurchase
 });
 toast('Review Submitted! ', 'Thanks for your feedback!', 'success');
 closeModal('review-modal');
 loadProductReviews(reviewProductId);
 loadProducts();
 } catch(e) { toast('Error', e.message || 'Could not submit review', 'error'); }
 btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-star"></i> Submit Review';
}

async function submitProductReview(payload) {
 try {
 return await callEdge('submit-review', payload);
 } catch (edgeErr) {
 console.warn('submit-review edge failed, trying direct insert:', edgeErr);
 }

 const base = {
 product_id: payload.product_id,
 reviewer_id: currentUser.id,
 buyer_id: currentUser.id,
 seller_id: currentProd?.seller_id || null,
 rating: payload.rating,
 };
 const variants = [
 { ...base, review_text: payload.review_text, image_urls: payload.image_urls || [], verified_purchase: !!payload.verified_purchase },
 { ...base, review_text: payload.review_text, verified_purchase: !!payload.verified_purchase },
 { ...base, comment: payload.review_text, verified_purchase: !!payload.verified_purchase },
 { product_id: payload.product_id, reviewer_id: currentUser.id, rating: payload.rating, comment: payload.review_text },
 { product_id: payload.product_id, buyer_id: currentUser.id, rating: payload.rating, comment: payload.review_text },
 { product_id: payload.product_id, user_id: currentUser.id, rating: payload.rating, comment: payload.review_text },
 ];

 let lastError = null;
 for (const row of variants) {
 const { error } = await db.from('reviews').insert(row);
 if (!error) return { success: true };
 lastError = error;
 const msg = (error.message || '').toLowerCase();
 if (!msg.includes('column') && !msg.includes('schema cache')) break;
 }
 throw lastError || new Error('Could not submit review');
}

function previewReviewImages(input) {
 const container = document.getElementById('review-img-previews');
 if (!container) return;
 container.innerHTML = '';
 const files = Array.from(input.files || []).slice(0, 3);
 const allowed = ['image/jpeg', 'image/png', 'image/webp'];
 files.forEach(file => {
 if (!allowed.includes(file.type) || file.size > 5 * 1024 * 1024) {
 toast('Invalid photo', 'Use JPG, PNG, or WebP under 5MB.', 'warn');
 return;
 }
 const reader = new FileReader();
 reader.onload = (e) => {
 container.innerHTML += `<div class="review-img-preview"><img src="${e.target.result}" alt="Review preview"></div>`;
 };
 reader.readAsDataURL(file);
 });
}

async function hasDeliveredPurchase(productId) {
 if (!currentUser || !productId) return false;
 try {
 const { data: orders } = await db.from('orders').select('items,status').eq('buyer_id', currentUser.id).in('status', ['delivered', 'confirmed', 'shipped']);
 return (orders || []).some(o => Array.isArray(o.items) && o.items.some(i => i.id === productId));
 } catch (_) {
 return false;
 }
}

function openReviewImage(url) {
 const box = document.createElement('div');
 box.className = 'review-lightbox';
 box.onclick = () => box.remove();
 box.innerHTML = `<img src="${escAttr(url)}" alt="Review photo">`;
 document.body.appendChild(box);
}

function previewAdMedia(input) {
 const file = input.files?.[0];
 const container = document.getElementById('ad-media-preview-container');
 const el = document.getElementById('ad-preview-el');
 if (!file || !container || !el) return;

 // 1. Validation: Allow all image and all video types
 const isImage = file.type.startsWith('image/');
 const isVideo = file.type.startsWith('video/');

 if (!isImage && !isVideo) {
 input.value = '';
 toast('Unsupported file', 'Upload a valid image or video file.', 'warn');
 return;
 }

 // 2. Validation: Apply 50MB limit to all media
 const MAX_SIZE = 50 * 1024 * 1024;
 if (file.size > MAX_SIZE) {
 input.value = '';
 toast('File too large', 'Media must be 50MB or less.', 'warn');
 return;
 }

 container.classList.remove('hidden');
 document.getElementById('ad-media-zone')?.classList.add('has-file');
 const label = document.querySelector('#ad-media-zone .upload-label');
 if (label) label.textContent = file.name;

 const reader = new FileReader();
 reader.onload = (e) => {
 // If it's a video (of any type), use the <video> tag
 if (isVideo) {
 el.innerHTML = `<video src="${e.target.result}" controls style="max-width:100%;max-height:200px;border-radius:8px"></video>`;
 } else {
 // Otherwise, assume it's an image
 el.innerHTML = `<img src="${e.target.result}" style="max-width:100%;max-height:200px;border-radius:8px;object-fit:contain">`;
 }
 };
 reader.readAsDataURL(file);
}

// ====================================================
// BUYER TABS & ORDERS
// ====================================================
function switchBuyerTab(tab) {
 document.getElementById('tab-shop')?.classList.toggle('active', tab==='shop');
 document.getElementById('tab-orders')?.classList.toggle('active', tab==='orders');
 document.getElementById('tab-support')?.classList.toggle('active', tab==='support');
 document.getElementById('tab-services')?.classList.toggle('active', tab==='services');
 document.getElementById('buyer-shop-tab')?.classList.toggle('hidden', tab!=='shop');
 document.getElementById('buyer-orders-tab')?.classList.toggle('hidden', tab!=='orders');
 document.getElementById('buyer-support-tab')?.classList.toggle('hidden', tab!=='support');
 document.getElementById('buyer-services-tab')?.classList.toggle('hidden', tab!=='services');
 if (tab==='orders') loadBuyerOrders();
 if (tab==='support') loadBroadcastMessages('buyer-broadcast-list');
 if (tab==='services') loadServiceGigs();
}

async function loadBuyerOrders() {
 if (!currentUser) { document.getElementById('buyer-orders-empty').classList.remove('hidden'); document.getElementById('buyer-orders-skeleton').classList.add('hidden'); return; }
 document.getElementById('buyer-orders-skeleton').classList.remove('hidden');
 document.getElementById('buyer-orders-list').classList.add('hidden');
 const { data: orders } = await db.from('orders').select('id, status, total_amount, created_at, delivery_name, delivery_address, items, payment_method, proof_url, seller_id, buyer_id').eq('buyer_id', currentUser.id).order('created_at',{ascending:false});
 document.getElementById('buyer-orders-skeleton').classList.add('hidden');
 const list = document.getElementById('buyer-orders-list');
 if (!orders?.length) { document.getElementById('buyer-orders-empty').classList.remove('hidden'); return; }
 document.getElementById('buyer-orders-empty').classList.add('hidden');
 list.classList.remove('hidden');
 const statusColors = {pending:'badge-gold',confirmed:'badge-blue',shipped:'badge-purple',delivered:'badge-green',cancelled:'badge-red'};
 list.innerHTML = (orders||[]).map(o=>`
 <div class="order-history-item">
 <div class="flex justify-between items-center flex-wrap gap-2 mb-2">
 <div><div class="font-bold">${o.id}</div><div class="text-xs color-text3">${fmtDate(o.created_at)}</div></div>
 <div class="flex items-center gap-2">
 <span class="badge ${statusColors[o.status]||'badge-gray'}">${o.status}</span>
 <span class="font-bold color-green">${fmtN(o.total_amount)}</span>
 </div>
 </div>
 <div class="flex gap-1 flex-wrap mb-2">${(o.items||[]).map(i=>`<span class="text-xs badge badge-gray">${escHtml(i.name)} x${i.qty}</span>`).join('')}</div>
 <div class="flex gap-2 flex-wrap">
 ${o.status==='delivered'?`<button class="btn btn-outline btn-sm" onclick="openDisputeModal('${o.id}')"><i class="fa-solid fa-exclamation-triangle"></i> Dispute</button>`:''}
 <a href="https://wa.me/2348116833356?text=Order ${o.id}" target="_blank" class="btn btn-outline btn-sm"><i class="fa-brands fa-whatsapp"></i> Track</a>
 </div>
 </div>`).join('');
}

async function loadBuyerOrders() {
 const skeleton = document.getElementById('buyer-orders-skeleton');
 const list = document.getElementById('buyer-orders-list');
 const empty = document.getElementById('buyer-orders-empty');
 if (!currentUser) { empty?.classList.remove('hidden'); skeleton?.classList.add('hidden'); list?.classList.add('hidden'); return; }
 skeleton?.classList.remove('hidden');
 list?.classList.add('hidden');
 empty?.classList.add('hidden');
 try {
 const { data: orders, error } = await db.from('orders').select('*').eq('buyer_id', currentUser.id).order('created_at',{ascending:false});
 if (error) throw error;
 skeleton?.classList.add('hidden');
 if (!orders?.length) { empty?.classList.remove('hidden'); return; }
 list.classList.remove('hidden');
 const statusColors = {pending:'badge-gold',confirmed:'badge-blue',shipped:'badge-purple',delivered:'badge-green',cancelled:'badge-red',refunded:'badge-gray'};
 list.innerHTML = (orders || []).map(o => {
 const orderItems = Array.isArray(o.items) ? o.items : [];
 const firstItem = orderItems[0] || {};
 const productId = firstItem.id || firstItem.product_id || '';
 const itemHtml = orderItems.length
 ? orderItems.map(i => `<span class="text-xs badge badge-gray">${escHtml(i.name || 'Item')} x${i.qty || 1}</span>`).join('')
 : '<span class="text-xs color-text3">Order item history is still saved for newer orders; this older order may not include item details.</span>';
 const proofUrl = o.proof_url || o.payment_proof_url || '';
 const paymentMethod = o.payment_method ? ` - ${escHtml(o.payment_method)}` : '';
 return `
 <div class="order-history-item buyer-order-card">
 <div class="buyer-order-head">
 <div class="buyer-order-title">
 <div class="font-bold">Order ${escHtml(String(o.id).slice(0, 10))}</div>
 <div class="text-xs color-text3">${fmtDate(o.created_at)}${paymentMethod}</div>
 </div>
 <div class="buyer-order-total">
 <span class="badge ${statusColors[o.status]||'badge-gray'}">${escHtml(o.status || 'pending')}</span>
 <strong>${fmtN(o.total_amount)}</strong>
 </div>
 </div>
 <div class="buyer-order-items">${itemHtml}</div>
 <div class="buyer-order-meta">
 <span><i class="fa-solid fa-location-dot"></i> ${escHtml(o.delivery_address || 'Delivery address not saved')}</span>
 </div>
 <div class="buyer-order-actions">
 ${o.seller_id ? `<button class="btn btn-outline btn-sm" onclick="openConversation('${escAttr(o.seller_id)}','Seller','${escAttr(productId)}')"><i class="fa-solid fa-message"></i> Message Seller</button>` : ''}
 ${o.status==='delivered' && productId ? `<button class="btn btn-primary btn-sm" onclick="openReviewModal('${escAttr(productId)}','Purchased item','${escAttr(o.seller_id || '')}')"><i class="fa-solid fa-star"></i> Review</button>` : ''}
 ${o.status==='delivered'?`<button class="btn btn-outline btn-sm" onclick="openDisputeModal('${escAttr(o.id)}')"><i class="fa-solid fa-exclamation-triangle"></i> Dispute</button>`:''}
 ${proofUrl ? `<a href="${escAttr(proofUrl)}" target="_blank" rel="noopener" class="btn btn-outline btn-sm"><i class="fa-solid fa-receipt"></i> Proof</a>` : ''}
 <button class="btn btn-outline btn-sm" onclick="openOrderTracking('${escAttr(o.id)}')"><i class="fa-solid fa-truck"></i> Track</button>
 </div>
 </div>`;
 }).join('');
 } catch (e) {
 skeleton?.classList.add('hidden');
 list?.classList.remove('hidden');
 if (list) list.innerHTML = `<div class="order-history-item text-center color-text3">Could not load your orders right now. ${escHtml(e.message || '')}</div>`;
 }
}

// ====================================================
// SELLER STATS & CHART
// ====================================================
async function loadSellerStats() {
 if (!currentUser) return;
 const { data: prods } = await db.from('products').select('id,status').eq('seller_id', currentUser.id);
 const { data: orders } = await db.from('orders').select('total_amount,status,created_at').eq('seller_id', currentUser.id);
 const { data: revs } = await db.from('reviews').select('rating').in('product_id', (prods||[]).map(p=>p.id));
 const active = (prods||[]).filter(p=>p.status==='active').length;
 const revenue = (orders||[]).filter(o=>o.status!=='cancelled').reduce((s,o)=>s+o.total_amount,0);
 const avgR = (revs||[]).length ? ((revs.reduce((s,r)=>s+r.rating,0)/revs.length).toFixed(1)) : ' - ';
 document.getElementById('st-products').textContent = active;
 document.getElementById('st-revenue').textContent = fmtN(revenue);
 document.getElementById('st-orders').textContent = (orders||[]).length;
 document.getElementById('st-rating').textContent = avgR;
 document.getElementById('st-trial').textContent = 'Free';
 document.getElementById('st-days').textContent = 'Seller Access';
 // Withdrawal data
 try {
 const wallet = await getSellerAvailableRevenue(currentUser.id);
 document.getElementById('wd-available').textContent = fmtN(wallet.available);
 document.getElementById('wd-total').textContent = fmtN(wallet.paid);
 if (currentUser.profile) currentUser.profile.wallet_balance = wallet.available;
 } catch (err) {
 console.warn('Could not refresh seller available revenue:', err);
 document.getElementById('wd-available').textContent = fmtN(Math.max(0, revenue * 0.92));
 document.getElementById('wd-total').textContent = fmtN(0);
 }
 // Orders badge
 const pending = (orders||[]).filter(o=>o.status==='pending').length;
 const badge = document.getElementById('orders-badge');
 badge.textContent = pending; badge.classList.toggle('hidden', !pending);
}

async function renderChart() {
 if (!currentUser) return;
 const days = parseInt(document.getElementById('chart-period').value);
 const since = new Date(); since.setDate(since.getDate() - days);
 const { data: orders } = await db.from('orders')
 .select('total_amount,created_at,status')
 .eq('seller_id', currentUser.id)
 .gte('created_at', since.toISOString())
 .neq('status','cancelled');

 // Group by day
 const dayMap = {};
 for (let i = days-1; i >= 0; i--) {
 const d = new Date(); d.setDate(d.getDate()-i);
 dayMap[d.toISOString().slice(0,10)] = 0;
 }
 (orders||[]).forEach(o => {
 const key = o.created_at?.slice(0,10);
 if (key && dayMap[key] !== undefined) dayMap[key] += o.total_amount || 0;
 });
 const labels = Object.keys(dayMap).map(k => {
 const d = new Date(k);
 return d.toLocaleDateString('en-NG',{month:'short',day:'numeric'});
 });
 const data = Object.values(dayMap);

 const ctx = document.getElementById('sales-chart').getContext('2d');
 if (salesChart) salesChart.destroy();
 salesChart = new Chart(ctx, {
 type: 'line',
 data: { labels, datasets: [{ label: 'Revenue (NGN)', data, borderColor: '#19a847', backgroundColor: 'rgba(25,168,71,.08)', tension: 0.4, fill: true, pointBackgroundColor: '#19a847', pointRadius: 3 }] },
 options: { responsive: true, plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => fmtN(ctx.raw) } } }, scales: { y: { beginAtZero: true, ticks: { callback: v => fmtN(v) } }, x: { ticks: { maxTicksLimit: days>14?7:days } } } }
 });
}

async function loadSellerAnalytics() {
 if (!currentUser) return;
 const container = document.getElementById('seller-analytics-content');
 if (!container) return;
 container.innerHTML = '<div class="skeleton" style="height:200px"></div>';
 try {
 const result = await callEdge('seller-analytics', { days: 30 });
 const totals = result.totals || {};
 const series = result.series || [];
 const topProducts = result.top_products || [];
 container.innerHTML = `
 <div class="stats-grid mb-4">
 <div class="stat-card"><div class="stat-value">${fmtNum(totals.views || 0)}</div><div class="stat-label">Product Views</div></div>
 <div class="stat-card"><div class="stat-value">${fmtNum(totals.carts || 0)}</div><div class="stat-label">Add to Cart</div></div>
 <div class="stat-card"><div class="stat-value color-green">${fmtN(totals.revenue || 0)}</div><div class="stat-label">Revenue</div></div>
 <div class="stat-card"><div class="stat-value">${fmtNum(totals.orders || 0)}</div><div class="stat-label">Orders</div></div>
 <div class="stat-card"><div class="stat-value color-gold">${fmtNum(totals.conversion_rate || 0)}%</div><div class="stat-label">View to Order</div></div>
 <div class="stat-card"><div class="stat-value">${fmtNum(totals.cart_rate || 0)}%</div><div class="stat-label">View to Cart</div></div>
 </div>
 <div class="chart-card mb-4">
 <div class="chart-head"><h3>30-Day Performance</h3><span class="text-xs color-text3">Views, carts, and revenue</span></div>
 <canvas id="seller-analytics-chart"></canvas>
 </div>
 <div class="card overflow-hidden">
 <div class="card-pad" style="border-bottom:1px solid var(--border)"><h3>Top Products</h3></div>
 <div class="overflow-x"><table class="data-table"><thead><tr><th>Product</th><th>Views</th><th>Carts</th><th>Orders</th><th>Revenue</th></tr></thead><tbody>
 ${topProducts.length ? topProducts.map(p => `<tr><td>${escHtml(p.name)}</td><td>${fmtNum(p.views || 0)}</td><td>${fmtNum(p.carts || 0)}</td><td>${fmtNum(p.orders || 0)}</td><td class="font-bold color-green">${fmtN(p.revenue || 0)}</td></tr>`).join('') : '<tr><td colspan="5" style="text-align:center;padding:2rem;color:var(--text3)">No analytics events yet</td></tr>'}
 </tbody></table></div>
 </div>`;

 const ctx = document.getElementById('seller-analytics-chart')?.getContext('2d');
 if (ctx && typeof Chart !== 'undefined') {
 if (sellerAnalyticsChart) sellerAnalyticsChart.destroy();
 sellerAnalyticsChart = new Chart(ctx, {
 type: 'line',
 data: {
 labels: series.map(row => new Date(row.date).toLocaleDateString('en-NG', { month:'short', day:'numeric' })),
 datasets: [
 { label: 'Views', data: series.map(row => row.views || 0), borderColor: '#2563eb', backgroundColor: 'rgba(37,99,235,.08)', tension: .35, yAxisID: 'count' },
 { label: 'Carts', data: series.map(row => row.carts || 0), borderColor: '#f59e0b', backgroundColor: 'rgba(245,158,11,.08)', tension: .35, yAxisID: 'count' },
 { label: 'Revenue', data: series.map(row => row.revenue || 0), borderColor: '#19a847', backgroundColor: 'rgba(25,168,71,.08)', tension: .35, yAxisID: 'money' },
 ],
 },
 options: {
 responsive: true,
 interaction: { mode: 'index', intersect: false },
 scales: {
 count: { type: 'linear', position: 'left', beginAtZero: true },
 money: { type: 'linear', position: 'right', beginAtZero: true, grid: { drawOnChartArea: false }, ticks: { callback: v => fmtN(v) } },
 },
 },
 });
 }
 } catch(e) {
 container.innerHTML = `<div class="card card-pad text-center color-text3">Could not load analytics. ${escHtml(e.message || '')}</div>`;
 }
}

// ====================================================
// SELLER PRODUCTS
// ====================================================
async function loadSellerProds() {
 if (!currentUser) return;
 const filter = document.getElementById('prod-filter')?.value || 'all';
 document.getElementById('sp-skeleton').classList.remove('hidden');
 document.getElementById('sp-list').classList.add('hidden');
 let q = db.from('products').select('*').eq('seller_id', currentUser.id).order('created_at', {ascending: false});
 const { data, error } = await q;
 document.getElementById('sp-skeleton').classList.add('hidden');
 const prods = (data||[]).filter(p => filter==='all'||filter===p.stock_status||(filter==='sold-out'&&p.stock_quantity===0)|| (filter==='active'&&p.status==='active'));
 if (!prods.length) { document.getElementById('sp-empty').classList.remove('hidden'); return; }
 document.getElementById('sp-empty').classList.add('hidden');
 document.getElementById('sp-list').classList.remove('hidden');
 document.getElementById('sp-list').innerHTML = prods.map(p => `
 <div class="prod-list-item">
 <img class="prod-list-img" src="${p.image_url||'https://images.unsplash.com/photo-1607082348824-0a96f2a4b9da?w=200'}" alt="" loading="lazy">
 <div class="prod-list-info">
 <div class="prod-list-name">${escHtml(p.name)}</div>
 <div class="prod-list-price">${fmtN(p.price)}</div>
 <div class="text-xs color-text3">Shipping: ${fmtN(itemShippingFee(p))}</div>
 <div class="prod-list-meta">
 <span class="badge badge-${p.status==='active'?'green':'gray'}">${p.status}</span>
 <span class="stock-pill ${p.stock_quantity===0?'stock-out':p.stock_quantity<=5?'stock-low':'stock-high'}">Stock: ${p.stock_quantity??'N/A'}</span>
 ${p.has_video?'<span class="badge badge-purple"> Video</span>':''}
 </div>
 </div>
 <div class="prod-list-actions">
 <button onclick="editProduct('${p.id}')" class="btn btn-outline btn-sm"><i class="fa-solid fa-pen"></i></button>
 <button onclick="deleteProduct('${p.id}')" class="btn btn-danger btn-sm"><i class="fa-solid fa-trash"></i></button>
 <button onclick="toggleProductStatus('${p.id}','${p.status}')" class="btn btn-sm" style="background:${p.status==='active'?'#fef9c3':'var(--green-xlt)'};color:${p.status==='active'?'#a16207':'#15803d'}">
 ${p.status==='active'?'Pause':'Activate'}
 </button>
 </div>
 </div>`).join('');
}

async function submitProduct(e) {
 e.preventDefault();
 if (!currentUser) return;
 const btn = document.getElementById('pub-btn');
 btn.disabled = true;
 document.getElementById('pub-btn-text').textContent = '';
 document.getElementById('pub-spinner').classList.remove('hidden');
 try {
 // -- Input validation ---
 await ensureSellerProfileRole();

 const nameVal = document.getElementById('p-name').value.trim();
 const priceVal = parseFloat(document.getElementById('p-price').value);
 const shippingFeeVal = parseFloat(document.getElementById('p-shipping-fee').value);
 const stockVal = parseInt(document.getElementById('p-stock').value) || 0;
 const descVal = document.getElementById('p-desc').value.trim();
 const catVal = document.getElementById('p-category').value;
 const condVal = document.getElementById('p-condition').value;
 const locVal = document.getElementById('p-location').value.trim();

 const VALID_CATS = ['electronics','fashion','home','phones','beauty','sports','dropship','other'];
 const VALID_CONDS = ['new','used-like-new','used-good'];

 if (!nameVal || nameVal.length < 3) { toast('Invalid name','Product name must be at least 3 characters','warn'); return; }// Change this line inside submitProduct(e)
if (nameVal.length > 300) { 
 toast('Name too long', 'Max 300 characters', 'warn'); 
 return; 
}
 if (isNaN(priceVal) || priceVal <= 0) { toast('Invalid price','Enter a price greater than 0','warn'); return; }
 if (priceVal > 100000000) { toast('Price too high','Maximum price is \u20A6100,000,000','warn'); return; }
 if (isNaN(shippingFeeVal) || shippingFeeVal < 0) { toast('Invalid shipping fee','Enter 0 or a valid shipping fee','warn'); return; }
 if (shippingFeeVal > 10000000) { toast('Shipping fee too high','Maximum shipping fee is \u20A610,000,000','warn'); return; }
 if (stockVal < 0 || stockVal > 100000) { toast('Invalid stock','Stock must be between 0 and 100,000','warn'); return; }
 if (descVal.length > 2000) { toast('Description too long','Max 2,000 characters','warn'); return; }
 if (!VALID_CATS.includes(catVal)) { toast('Invalid category','Please select a valid category','warn'); return; }
 if (!VALID_CONDS.includes(condVal)) { toast('Invalid condition','Please select a valid condition','warn'); return; }

 const imgFiles = fileListToArray('p-image');
 const vidFiles = fileListToArray('p-video');
 const imageUrls = await uploadProductMediaFiles(imgFiles, 'image');
 const videoUrls = await uploadProductMediaFiles(vidFiles, 'video');
 const imgUrl = imageUrls[0] || '';
 const vidUrl = videoUrls[0] || '';

 const price = priceVal;
 const origPrice= parseFloat(document.getElementById('p-orig-price').value) || price;
 const shippingFee = shippingFeeVal;
 const stock = stockVal;
 const prodData = {
 name: nameVal,
 description: descVal,
 price, original_price: Math.max(origPrice, price),
 shipping_fee: shippingFee,
 shipping_cost: shippingFee,
 category: catVal,
 condition: condVal,
 location: locVal.substring(0, 100),
 has_video: videoUrls.length > 0, negotiable: document.getElementById('p-negotiable').checked,
 stock_quantity: stock, low_stock_alert: Math.max(0, parseInt(document.getElementById('p-low-stock').value)||3),
  };
 if (imgUrl) prodData.image_url = imgUrl;
 if (vidUrl) prodData.video_url = vidUrl;
 if (imageUrls.length) prodData.images = imageUrls;
 if (videoUrls.length) prodData.videos = videoUrls;

 let productNotificationRecord = null;
 let oldProductNotificationRecord = null;
 if (editingProductId) {
  const productIdForNotification = editingProductId;
  oldProductNotificationRecord = await fetchProductForNotification(productIdForNotification);
  // UPDATE mode
  const updateData = { ...prodData };
  if (!imageUrls.length) { delete updateData.image_url; delete updateData.images; }
  if (!videoUrls.length) { delete updateData.video_url; delete updateData.videos; delete updateData.has_video; }
 await callEdge('manage-product', {
 action: 'update',
 product_id: editingProductId,
 data: updateData
  });
  productNotificationRecord = await fetchProductForNotification(productIdForNotification);
  editingProductId = null;
  toast('Product Updated! OK', 'Changes saved successfully', 'success');
 const cancelBtn = document.getElementById('edit-cancel-btn');
 if (cancelBtn) cancelBtn.style.display = 'none';
 document.querySelector('#ds-add-product .dash-page-title').textContent = 'Add New Product';
 document.querySelector('#ds-add-product .dash-page-sub').textContent = 'Products with videos get 3x more sales! ';
 } else {
  // INSERT mode - server-side via Edge Function
  const createResult = await callEdge('manage-product', {
  action: 'create',
   data: prodData
   });
  const createdProductId = createResult?.product?.id || createResult?.product_id || createResult?.id;
  productNotificationRecord = createdProductId
  ? await fetchProductForNotification(createdProductId)
  : { ...prodData, status: 'active', seller_id: currentUser.id };
  toast('Product Published! ', 'Your product is now live', 'success');
  }
  notifyProductIfActive(productNotificationRecord, oldProductNotificationRecord);
  document.getElementById('add-prod-form').reset();
 showDash('products');
 } catch(err) {
 toast('Error', err.message, 'error');
 } finally {
 btn.disabled = false;
 document.getElementById('pub-btn-text').textContent = editingProductId ? 'Update Product' : 'Publish Product';
 document.getElementById('pub-spinner').classList.add('hidden');
 }
}

async function deleteProduct(id) {
 if (!confirm('Delete this product?')) return;
 try {
 await ensureSellerProfileRole();
 await callEdge('manage-product', { action: 'delete', product_id: id });
 }
 catch(e) { toast('Error', e.message, 'error'); return; }
 toast('Product Deleted', '', 'info');
 loadSellerProds();
}

async function toggleProductStatus(id, current) {
 const next = current === 'active' ? 'paused' : 'active';
 try {
  await ensureSellerProfileRole();
  const oldProduct = await fetchProductForNotification(id);
  await callEdge('manage-product', { action: 'toggle_status', product_id: id });
  if (next === 'active') {
  const product = await fetchProductForNotification(id);
  notifyProductIfActive(product, oldProduct || { status: current });
  }
  }
 catch(e) { toast('Error', e.message, 'error'); return; }
  loadSellerProds();
}

// editing state
let editingProductId = null;

async function editProduct(id) {
 const { data: p, error } = await db.from('products').select('*').eq('id', id).single();
 if (error || !p) { toast('Could not load product', '', 'error'); return; }
 editingProductId = id;
 showDash('add-product');
 // Pre-fill form
 document.getElementById('p-name').value = p.name || '';
 document.getElementById('p-price').value = p.price || '';
 document.getElementById('p-orig-price').value = p.original_price || '';
 document.getElementById('p-shipping-fee').value = p.shipping_fee ?? p.shipping_cost ?? 0;
 document.getElementById('p-stock').value = p.stock_quantity ?? '';
 document.getElementById('p-low-stock').value = p.low_stock_alert || '';
 document.getElementById('p-category').value = p.category || 'electronics';
 document.getElementById('p-condition').value = p.condition || 'new';
 document.getElementById('p-desc').value = p.description || '';
 document.getElementById('p-location').value = p.location || '';
 document.getElementById('p-negotiable').checked = !!p.negotiable;
 // Update button and heading
 document.getElementById('pub-btn-text').textContent = 'Update Product';
 document.querySelector('#ds-add-product .dash-page-title').textContent = 'Edit Product';
 document.querySelector('#ds-add-product .dash-page-sub').textContent = 'Update your product details below';
 // Show cancel button
 let cancelBtn = document.getElementById('edit-cancel-btn');
 if (!cancelBtn) {
 cancelBtn = document.createElement('button');
 cancelBtn.id = 'edit-cancel-btn';
 cancelBtn.type = 'button';
 cancelBtn.className = 'btn btn-outline btn-full mt-2';
 cancelBtn.innerHTML = 'Cancel Edit';
 cancelBtn.onclick = cancelEditProduct;
 document.getElementById('pub-btn').after(cancelBtn);
 }
 cancelBtn.style.display = 'block';
 toast('Edit Mode', `Editing: ${p.name}`, 'info');
}

function cancelEditProduct() {
 editingProductId = null;
 document.getElementById('add-prod-form').reset();
 document.getElementById('pub-btn-text').textContent = 'Publish Product';
 document.querySelector('#ds-add-product .dash-page-title').textContent = 'Add New Product';
 document.querySelector('#ds-add-product .dash-page-sub').textContent = 'Products with videos get 3x more sales! ';
 const cancelBtn = document.getElementById('edit-cancel-btn');
 if (cancelBtn) cancelBtn.style.display = 'none';
 showDash('products');
}

// ====================================================
// SELLER ORDERS
// ====================================================
async function loadSellerOrders() {
 if (!currentUser) return;
 const { data: orders } = await db.from('orders').select('*').eq('seller_id', currentUser.id).order('created_at',{ascending:false});
 document.getElementById('orders-skeleton').classList.add('hidden');
 const list = document.getElementById('orders-list');
 if (!orders?.length) { document.getElementById('orders-empty').classList.remove('hidden'); return; }
 document.getElementById('orders-empty').classList.add('hidden');
 list.classList.remove('hidden');
 const statusColors = {pending:'badge-gold',confirmed:'badge-blue',shipped:'badge-purple',delivered:'badge-green',cancelled:'badge-red'};
 list.innerHTML = orders.map(o=>{
 const orderItems = Array.isArray(o.items) ? o.items : [];
 const firstItem = orderItems[0] || {};
 const productId = firstItem.id || firstItem.product_id || '';
 return `
 <div class="card card-pad mb-3">
 <div class="flex justify-between items-start flex-wrap gap-2 mb-2">
 <div><div class="font-bold">${o.id}</div><div class="text-xs color-text3">${fmtDate(o.created_at)}</div></div>
 <span class="badge ${statusColors[o.status]||'badge-gray'}">${o.status}</span>
 </div>
 <div class="mb-2">${(o.items||[]).map(i=>`<span class="text-sm">${escHtml(i.name)} x${i.qty}</span>`).join(', ')}</div>
 <div class="flex justify-between items-center flex-wrap gap-2">
 <div>
 <div class="text-sm"><i class="fa-solid fa-user color-text3"></i> ${escHtml(o.delivery_name||'Buyer')}</div>
 <div class="text-xs color-text3"><i class="fa-solid fa-map-marker-alt"></i> ${escHtml(o.delivery_address||'')}</div>
 </div>
 <div class="text-right">
 <div class="font-bold color-green">${fmtN(o.total_amount)}</div>
 <div class="text-xs color-text3">${o.payment_method}</div>
 </div>
 </div>
 ${o.proof_url ? `<div class="mt-2"><a href="${o.proof_url}" target="_blank" class="btn btn-outline btn-sm"><i class="fa-solid fa-image"></i> View Proof</a></div>` : ''}
 <div class="flex gap-2 mt-3 flex-wrap">
 ${o.buyer_id ? `<button onclick="openConversation('${escAttr(o.buyer_id)}','Buyer','${escAttr(productId)}')" class="btn btn-outline btn-sm"><i class="fa-solid fa-message"></i> Message Buyer</button>` : ''}
 ${o.status==='pending'?`<button onclick="updateOrderStatus('${o.id}','confirmed')" class="btn btn-primary btn-sm">Confirm Order</button>`:''}
 ${o.status==='confirmed'?`<button onclick="updateOrderStatus('${o.id}','shipped')" class="btn btn-sm" style="background:#ede9fe;color:#6d28d9">Mark Shipped</button>`:''}
 ${o.status==='shipped'?`<button onclick="updateOrderStatus('${o.id}','delivered')" class="btn btn-sm" style="background:#dcfce7;color:#15803d">Mark Delivered</button>`:''}
 
 </div>
 </div>`;
 }).join('');
}

async function updateOrderStatus(id, status) {
 try {
  const { data: oldOrder } = await db.from('orders').select('status').eq('id', id).maybeSingle();
  await callEdge('order-action', { action: 'update_status', order_id: id, status });
  if (status === 'confirmed') notifyOrderIfConfirmed(id, oldOrder?.status || 'pending');
  toast(`Order ${status}!`, '', 'success');
  loadSellerOrders();
  } catch(e) { toast('Error', e.message, 'error'); }
}

let activeTrackingOrderId = null;

function trackingLabel(status) {
 return String(status || 'pending').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

async function openOrderTracking(orderId) {
 if (!currentUser) { showModal('auth-modal'); return; }
 activeTrackingOrderId = orderId;
 document.getElementById('tracking-order-id').textContent = orderId;
 document.getElementById('tracking-timeline').innerHTML = '<div class="text-center p-3"><span class="spinner"></span></div>';
 document.getElementById('tracking-status-strip').innerHTML = '';
 const updatePanel = document.getElementById('tracking-update-panel');
 updatePanel?.classList.toggle('hidden', currentRole !== 'seller' && currentRole !== 'admin');
 showModal('tracking-modal');

 try {
 const { data: order } = await db.from('orders').select('id,status,seller_id,buyer_id,created_at').eq('id', orderId).maybeSingle();
 const { data: events } = await db.from('order_tracking').select('*').eq('order_id', orderId).order('created_at', { ascending: true });
 renderTrackingTimeline(order || { id: orderId, status: 'pending' }, events || []);
 } catch (e) {
 document.getElementById('tracking-timeline').innerHTML = `<p class="color-text3 text-sm">Could not load tracking updates. ${escHtml(e.message || '')}</p>`;
 }
}

function renderTrackingTimeline(order, events) {
 const steps = ['pending', 'confirmed', 'in_transit', 'delivered'];
 const statusRank = {
 pending: 0, confirmed: 1, picked_up: 2, shipped: 2, in_transit: 2, out_for_delivery: 2, delivered: 3
 };
 const currentRank = statusRank[order.status] ?? 0;
 document.getElementById('tracking-status-strip').innerHTML = steps.map((s, i) =>
 `<div class="tracking-step-chip ${i <= currentRank ? 'done' : ''}">${trackingLabel(s)}</div>`
 ).join('');

 const rows = events.length ? events : [{
 status: order.status || 'pending',
 note: 'Order placed',
 created_at: order.created_at || new Date().toISOString()
 }];
 document.getElementById('tracking-timeline').innerHTML = rows.map(e => `
 <div class="tracking-event">
 <div class="tracking-dot"><i class="fa-solid fa-check"></i></div>
 <div class="tracking-card">
 <strong>${escHtml(trackingLabel(e.status))}</strong>
 ${e.note ? `<p>${escHtml(e.note)}</p>` : ''}
 <span>${fmtDate(e.created_at)} - ${formatMsgTime(e.created_at)}</span>
 </div>
 </div>`).join('');
}

async function submitTrackingUpdate() {
 if (!activeTrackingOrderId) return;
 const status = document.getElementById('tracking-status-input').value;
 const note = document.getElementById('tracking-note-input').value.trim();
 try {
  const { data: oldOrder } = await db.from('orders').select('status').eq('id', activeTrackingOrderId).maybeSingle();
  await callEdge('order-action', { action: 'update_status', order_id: activeTrackingOrderId, status, note });
  if (status === 'confirmed') notifyOrderIfConfirmed(activeTrackingOrderId, oldOrder?.status || 'pending');
  document.getElementById('tracking-note-input').value = '';
 toast('Tracking Updated', trackingLabel(status), 'success');
 openOrderTracking(activeTrackingOrderId);
 if (currentRole === 'seller') loadSellerOrders();
 if (document.getElementById('buyer-orders-tab') && !document.getElementById('buyer-orders-tab').classList.contains('hidden')) loadBuyerOrders();
 } catch (e) {
 toast('Tracking Failed', e.message || 'Could not update tracking', 'error');
 }
}

// ====================================================
// SELLER REVIEWS
// ====================================================
async function loadSellerReviews() {
 if (!currentUser) return;
 const { data: prods } = await db.from('products').select('id').eq('seller_id', currentUser.id);
 let { data: revs, error } = await db.from('reviews').select('*,profiles!reviewer_id(name)').in('product_id', (prods||[]).map(p=>p.id)).order('created_at',{ascending:false});
 if (error) {
 ({ data: revs } = await db.from('reviews').select('*,profiles!buyer_id(name)').in('product_id', (prods||[]).map(p=>p.id)).order('created_at',{ascending:false}));
 }
 document.getElementById('ds-reviews-skeleton').classList.add('hidden');
 const list = document.getElementById('ds-reviews-list');
 if (!revs?.length) { document.getElementById('ds-reviews-empty').classList.remove('hidden'); return; }
 document.getElementById('ds-reviews-empty').classList.add('hidden');
 const avg = revs.reduce((s,r)=>s+r.rating,0)/revs.length;
 const fiveStars = revs.filter(r=>r.rating===5).length;
 document.getElementById('rv-avg').textContent = avg.toFixed(1);
 document.getElementById('rv-total').textContent = revs.length;
 document.getElementById('rv-5star').textContent = fiveStars;
 list.classList.remove('hidden');
 list.innerHTML = revs.map(r=>`
 <div class="review-card">
 <div class="flex justify-between">
 <span class="reviewer-name">${escHtml(r.profiles?.name||'Buyer')}</span>
 <div class="stars sm">${starIcons(r.rating)}</div>
 </div>
 <p class="review-text">${escHtml(r.review_text || r.comment || '')}</p>
 <span class="text-xs color-text3">${fmtDate(r.created_at)}</span>
 </div>`).join('');
}

// ====================================================
// COMMISSION
// ====================================================
async function checkSellerCommission() {
 if (!currentUser?.profile) return;
 document.getElementById('comm-trial-end').textContent = 'No expiry';
 const badge = document.getElementById('comm-status-badge');
 if (badge) { badge.className='badge badge-green'; badge.textContent='Free Seller Access'; }
}

function payCommissionPaystack() {
 if (!currentUser) return;
 closeModal('suspended-modal');
 toast('No Payment Needed', 'Seller access is now free. You can keep using your store.', 'success', 6000);
 checkSellerCommission();
}

function payCommissionViaWallet() {
 if (!currentUser) return;
 toast('No Payment Needed', 'Seller access is now free. You do not need to renew anything.', 'info', 6000);
 checkSellerCommission();
}

async function submitCommissionReceipt() {
 const file = document.getElementById('commission-file').files[0];
 const ref = document.getElementById('commission-ref').value.trim();
 if (!file || !ref) { toast('Please upload receipt and enter reference', '', 'warn'); return; }
 if (!currentUser) { toast('Not logged in', '', 'error'); return; }

 try {
 toast('Uploading receipt...', '', 'info', 3000);

 // 1. Upload receipt image to Supabase Storage
 const ext = file.name.split('.').pop().toLowerCase().replace(/[^a-z0-9]/g, '');
 const path = `receipts/${currentUser.id}/${Date.now()}.${ext}`;
 const { data: uploadData, error: uploadErr } = await db.storage
 .from('uploads')
 .upload(path, file, { upsert: false });

 if (uploadErr) throw uploadErr;

 const { data: urlData } = db.storage.from('uploads').getPublicUrl(uploadData.path);
 const receiptUrl = urlData?.publicUrl || '';

 // 2. Insert record into commission_receipts table
 const { error: insertErr } = await db.from('commission_receipts').insert({
 seller_id: currentUser.id,
 receipt_url: receiptUrl,
 transaction_ref: validateInput(ref),
 amount: COMMISSION_AMOUNT / 100,
 status: 'pending'
 });

 if (insertErr) throw insertErr;

 toast('Receipt Submitted! OK', 'Admin will verify within 24hrs.', 'success', 6000);
 closeModal('commission-modal');
 
 // Clear form
 document.getElementById('commission-file').value = '';
 document.getElementById('commission-ref').value = '';
 } catch(e) {
 toast('Upload Failed', e.message || 'Please try again', 'error');
 }
}

// ====================================================
// SETTINGS
// ====================================================
async function loadSettings() {
 if (!currentUser?.profile) return;
 const p = currentUser.profile;
 
 // Pre-fill existing basic data
 document.getElementById('s-store-name').value = p.store_name || '';
 document.getElementById('s-store-cat').value = p.store_category || p.category || 'Electronics';
 document.getElementById('s-store-desc').value = p.store_description || '';
 document.getElementById('s-whatsapp').value = p.whatsapp || '';
 document.getElementById('s-bank-name').value = p.bank_name || '';
 document.getElementById('s-account-num').value = p.account_number || '';
 document.getElementById('s-account-name').value = p.account_name || '';
 document.getElementById('s-paystack-key').value = p.paystack_key || '';
 document.getElementById('s-notif-email').value = p.notif_email || p.email || '';
 
 // Withdrawal panel indicators
 document.getElementById('wd-bank-name').textContent = p.bank_name || 'Not set';
 document.getElementById('wd-acct-num').textContent = p.account_number || ' - ';
 document.getElementById('wd-acct-name').textContent = p.account_name || ' - ';

 // --- NEW: BRAND CUSTOMIZATION LIVE DOM INJECTIONS ---
 const settingsSection = document.getElementById('ds-settings');
 if (settingsSection && !document.getElementById('brand-identity-panel')) {
 // Locate your settings form element container
 const formElement = document.getElementById('settings-save-btn')?.closest('form');
 if (formElement) {
 const brandPanelHtml = `
 <div class="card card-pad mb-4" id="brand-identity-panel" style="border-top: 4px solid var(--green)">
 <h3 class="mb-2"><i class="fa-solid fa-palette color-green"></i> Brand Identity Setup</h3>
 <p class="text-xs color-text3 mb-3">Upload your custom merchant logo and set up customer-facing profile accents.</p>
 
 <div class="form-grid form-grid-2 mb-3">
 <div class="form-group">
 <label class="form-label">Brand Logo Image</label>
 <div class="upload-zone" id="brand-logo-zone" onclick="document.getElementById('s-brand-logo-file').click()" style="padding: 1rem;">
 <i class="fa-solid fa-cloud-arrow-up color-green"></i>
 <div class="upload-label" id="brand-logo-filename" style="font-size: 0.78rem;">Click to choose Logo</div>
 <input type="file" id="s-brand-logo-file" accept="image/*" class="hidden" onchange="previewSellerBrandLogo(this)">
 </div>
 </div>
 <div class="form-group flex items-center justify-center">
 <div id="brand-logo-preview-wrap" style="width: 90px; height: 90px; border-radius: 14px; border: 2px dashed var(--border); overflow: hidden; background: var(--cream); display: flex; align-items: center; justify-content: center;">
 ${p.logo_url ? `<img src="${p.logo_url}" style="width:100%; height:100%; object-fit:cover;">` : `<i class="fa-solid fa-store" style="font-size: 1.8rem; color: var(--border2)"></i>`}
 </div>
 </div>
 </div>

 <div class="form-grid form-grid-2">
 <div class="form-group">
 <label class="form-label">Instagram Handle</label>
 <div class="input-group">
 <span class="input-prefix"><i class="fa-brands fa-instagram"></i></span>
 <input type="text" id="s-instagram" class="form-input" placeholder="username" value="${p.instagram_handle || ''}">
 </div>
 </div>
 <div class="form-group">
 <label class="form-label">Physical Store Address</label>
 <div class="input-group">
 <span class="input-prefix"><i class="fa-solid fa-location-dot"></i></span>
 <input type="text" id="s-address" class="form-input" placeholder="e.g. Computer Village, Ikeja" value="${p.store_address || ''}">
 </div>
 </div>
 </div>
 </div>`;
 
 // Inject the brand panel right before the form input wrapper groups
 formElement.insertAdjacentHTML('afterbegin', brandPanelHtml);
 }
 } else if (document.getElementById('brand-identity-panel')) {
 // If the node elements exist already, just populate fresh variables
 document.getElementById('s-instagram').value = p.instagram_handle || '';
 document.getElementById('s-address').value = p.store_address || '';
 if (p.logo_url) {
 document.getElementById('brand-logo-preview-wrap').innerHTML = `<img src="${p.logo_url}" style="width:100%; height:100%; object-fit:cover;">`;
 }
 }
}

// Live local form file picker reader mapping callback
function previewSellerBrandLogo(input) {
 const file = input.files?.[0];
 if (!file) return;
 
 if (!file.type.startsWith('image/') || file.size > 3 * 1024 * 1024) {
 toast('Invalid Asset File', 'Please select an image file under 3MB.', 'warn');
 input.value = '';
 return;
 }
 
 const label = document.getElementById('brand-logo-filename');
 if (label) label.textContent = file.name;
 
 const reader = new FileReader();
 reader.onload = (e) => {
 const wrap = document.getElementById('brand-logo-preview-wrap');
 if (wrap) wrap.innerHTML = `<img src="${e.target.result}" style="width:100%; height:100%; object-fit:cover;">`;
 };
 reader.readAsDataURL(file);
}

// Complete rewrite of saveSettings execution handler block
async function saveSettings(e) {
 e.preventDefault();
 if (!currentUser) return;
 
 const btn = document.getElementById('settings-save-btn');
 const oldHtml = btn?.innerHTML;
 
 const updates = {
 store_name: document.getElementById('s-store-name').value.trim(),
 store_category: document.getElementById('s-store-cat').value,
 store_description: document.getElementById('s-store-desc').value.trim(),
 whatsapp: document.getElementById('s-whatsapp').value.trim(),
 paystack_key: document.getElementById('s-paystack-key').value.trim(),
 notif_email: document.getElementById('s-notif-email').value.trim(),
 // Added extended metadata attributes
 instagram_handle: document.getElementById('s-instagram')?.value.trim() || '',
 store_address: document.getElementById('s-address')?.value.trim() || ''
 };
 
 if (!updates.store_name || !updates.whatsapp) {
 toast('Missing details', 'Store Name and WhatsApp contact are required.', 'warn');
 return;
 }
 
 if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Saving Identity...'; }
 
 try {
 // 1. Process brand logo profile uploads asynchronously if populated
 const logoFileInput = document.getElementById('s-brand-logo-file');
 if (logoFileInput?.files?.[0]) {
 const file = logoFileInput.files[0];
 const ext = file.name.split('.').pop().toLowerCase().replace(/[^a-z0-9]/g, '');
 const path = `branding/merchant_${currentUser.id}_${Date.now()}.${ext}`;
 
 toast('Uploading logo...', '', 'info', 2000);
 const uploaded = await uploadToFirstAvailableBucket(['uploads', 'products'], path, file, { contentType: file.type, upsert: true });
 updates.logo_url = uploaded.publicUrl;
 }

// 2. Clean payload metrics and transmit straight to the profile edge framework
 const cleanUpdates = purgePayloadNulls(updates);
 await callEdge('update-profile', cleanUpdates);
 
 // Synced properties updates locally
 if (currentUser.profile) Object.assign(currentUser.profile, cleanUpdates); 
 toast('Profile Brand Saved! ', 'Your store profile parameters are updated.', 'success');
 loadWithdrawalData();
 } catch (err) {
 toast('Save Failed', err.message || 'Could not update your store profile.', 'error');
 } finally {
 if (btn) { btn.disabled = false; btn.innerHTML = oldHtml || '<i class="fa-solid fa-floppy-disk"></i> Save All Settings'; }
 }
}


// ====================================================
// WITHDRAWALS
// ====================================================
async function loadWithdrawalData() {
 if (!currentUser) return;
 
 // Simultaneously pull profile configs, raw order vectors, standard bank payouts, and internal wallet purchases
 const [{ data: profile }, { data: withdrawals }, wallet] = await Promise.all([
 db.from('profiles').select('bank_name,account_number,account_name').eq('id', currentUser.id).maybeSingle(),
 db.from('withdrawals').select('amount,status,created_at,id').eq('seller_id', currentUser.id).order('created_at',{ascending:false}),
 getSellerAvailableRevenue(currentUser.id)
 ]);

 if (profile) {
 currentUser.profile = { ...(currentUser.profile || {}), ...profile };
 document.getElementById('wd-bank-name').textContent = profile.bank_name || 'Not set';
 document.getElementById('wd-acct-num').textContent = profile.account_number || ' - ';
 document.getElementById('wd-acct-name').textContent = profile.account_name || ' - ';
 }

 const available = wallet.available;
 const pendingAmt = wallet.pending;
 const totalPaid = wallet.paid;

 // 5. Render exact calculated metrics cleanly to display viewport layout frames
 document.getElementById('wd-available').textContent = fmtN(available);
 document.getElementById('wd-pending').textContent = fmtN(pendingAmt);
 document.getElementById('wd-total').textContent = fmtN(totalPaid);
 
 // Sync the locally cached user profile runtime configuration state 
 if (currentUser.profile) {
 currentUser.profile.wallet_balance = available;
 }

 renderWithdrawalHistory(withdrawals || []);
}

async function requestWithdrawal() {
 const amount = parseFloat(document.getElementById('wd-amount').value);
 if (!amount || amount < 5000) { toast('Minimum withdrawal is \u20A65,000','','warn'); return; }
 try {
 const wallet = await getSellerAvailableRevenue(currentUser.id);
 if (amount > wallet.available) {
 toast('Insufficient Balance', `You can withdraw up to ${fmtN(wallet.available)} after wallet purchases and pending withdrawals.`, 'warn');
 document.getElementById('wd-available').textContent = fmtN(wallet.available);
 if (currentUser.profile) currentUser.profile.wallet_balance = wallet.available;
 return;
 }
 await callEdge('request-withdrawal', {
 amount,
 bank_name: currentUser.profile?.bank_name || '',
 account_number: currentUser.profile?.account_number || '',
 account_name: currentUser.profile?.account_name || ''
 });
 } catch(e) { toast('Error', e.message, 'error'); return; }
 toast('Withdrawal Requested!', `${fmtN(amount)} - processed within 24hrs`, 'success');
 document.getElementById('wd-amount').value = '';
 await loadWithdrawalData();
}

// ====================================================
// DROPSHIPPING
// ====================================================
const dropshipCatalog = [
 { id:'mini-projector', niche:'electronics', name:'Mini Projector HD', supplier:'Temu', cost:45000, price:120000, shipping:6500, stock:120, delivery:'7-12 days', demand:'High', image:'https://images.unsplash.com/photo-1601944177325-f8867652837f?w=600&h=420&fit=crop', description:'Portable mini projector for movies, football nights, and coding presentations.' },
 { id:'earbuds-pro', niche:'electronics', name:'Wireless Earbuds Pro', supplier:'AliExpress', cost:12000, price:35000, shipping:2500, stock:240, delivery:'8-15 days', demand:'High', image:'https://images.unsplash.com/photo-1606220588913-b3aacb4d2f46?w=600&h=420&fit=crop', description:'Bluetooth earbuds with charging case, deep bass, and touch controls.' },
 { id:'smart-watch', niche:'electronics', name:'Fitness Smart Watch', supplier:'Temu', cost:18000, price:55000, shipping:3000, stock:180, delivery:'6-10 days', demand:'High', image:'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=600&h=420&fit=crop', description:'Smart watch with fitness tracking, heart-rate monitoring, and durable strap.' },
 { id:'esp32-camera', niche:'electronics', name:'Seeed Studio XIAO ESP32S3 Sense', supplier:'Amazon', cost:15000, price:29000, shipping:4500, stock:95, delivery:'5-9 days', demand:'Very High', image:'https://images.unsplash.com/photo-1517055720413-77a13546dd1e?w=600&h=420&fit=crop', description:'ESP32S3 board with OV2640 camera module, perfect for hardware AI tracking projects.' },
 { id:'anti-theft-bag', niche:'fashion', name:'Anti-Theft Travel Backpack', supplier:'AliExpress', cost:14000, price:42000, shipping:3500, stock:130, delivery:'11-19 days', demand:'High', image:'https://images.unsplash.com/photo-1553062407-98eeb64c6a62?w=600&h=420&fit=crop', description:'Durable anti-theft backpack with laptop compartment and water-resistant fabric.' },
 { id:'oled-display', niche:'electronics', name:'1.3-inch RGB OLED Display Module', supplier:'Amazon', cost:5000, price:12000, shipping:2000, stock:150, delivery:'4-8 days', demand:'High', image:'https://images.unsplash.com/photo-1607082348824-0a96f2a4b9da?w=600&h=420&fit=crop', description:'High-contrast 240x240 mini display, crisp visual rendering for microcontrollers.' }
];
let dropshipConnections = {};
let activeDropshipCatalog = dropshipCatalog;

function normalizeDropshipItem(item) {
 return {
 id: item.id,
 niche: item.niche || 'other',
 name: item.name || 'Dropship Product',
 supplier: item.supplier || item.supplier_name || 'Global Supplier',
 supplier_key: item.supplier_key || 'global',
 cost: Number(item.cost ?? item.supplier_cost ?? 0),
 price: Number(item.price ?? item.suggested_price ?? 0),
 shipping: Number(item.shipping ?? item.shipping_cost ?? 0),
 stock: Number(item.stock ?? item.stock_quantity ?? 999),
 delivery: item.delivery || item.delivery_estimate || 'International shipping',
 demand: item.demand || 'Medium',
 image: item.image || item.image_url || '',
 description: item.description || '',
 };
}

function ensureGrowthSections() {
 renderDropshipSection();
 renderAffiliateSection();
}

function renderDropshipSection() {
 const section = document.getElementById('ds-dropshipping');
 if (!section || section.dataset.enhanced === 'true') return;
 section.dataset.enhanced = 'true';
 section.innerHTML = `
 <h1 class="dash-page-title">Global Dropshipping</h1>
 <p class="dash-page-sub">Research winning products, set your markup, and publish supplier-backed listings.</p>
 
 <div class="dropship-hero mb-4">
 <div><h2>Source globally. Sell locally.</h2><p>Use curated products, supplier cost estimates, and suggested Nigerian retail prices to build listings faster.</p></div>
 <button class="btn btn-primary" onclick="showDash('add-product')"><i class="fa-solid fa-plus"></i> Add Manual Listing</button>
 </div>

 <div class="dropship-stats mb-4">
 <div class="stat-card"><div class="stat-value color-green" id="ds-imported">0</div><div class="stat-label">Imported Listings</div></div>
 <div class="stat-card"><div class="stat-value" id="ds-sales">\u20A60</div><div class="stat-label">Dropship Sales</div></div>
 <div class="stat-card"><div class="stat-value color-gold" id="ds-profit">\u20A60</div><div class="stat-label">Estimated Profit</div></div>
 <div class="stat-card"><div class="stat-value color-text3" id="ds-pending">0</div><div class="stat-label">Orders Pending</div></div>
 </div>

 <div class="dash-two-col mb-4">
 <div class="card card-pad">
 <div class="flex justify-between items-center mb-3 gap-2 wrap"><h3>Supplier Connections</h3><span class="text-xs color-text3">Saved on this device</span></div>
 <div class="supplier-grid">
 <div class="supplier-card" data-supplier-card="aliexpress">
 <div class="flex items-center gap-3 mb-3">
 <div class="trust-icon" style="background:#fee2e2;font-size:1.1rem"><i class="fa-solid fa-globe" style="color:#e53e3e"></i></div>
 <div><div class="font-600">AliExpress</div><div class="text-xs color-text3">Wide catalogue, budget pricing</div></div>
 </div>
 <a href="https://best.aliexpress.com" target="_blank" class="btn btn-primary btn-full btn-sm" style="text-decoration:none; text-align:center;">
 <i class="fa-solid fa-external-link-alt"></i> Browse AliExpress
 </a>
 </div>
 <div class="supplier-card" data-supplier-card="temu">
 <div class="flex items-center gap-3 mb-3">
 <div class="trust-icon" style="background:#ffedd5;font-size:1.1rem"><i class="fa-solid fa-bolt" style="color:#d97706"></i></div>
 <div><div class="font-600">Temu</div><div class="text-xs color-text3">Trending consumer goods, lightning fast air shipping</div></div>
 </div>
 <a href="https://www.temu.com" target="_blank" class="btn btn-primary btn-full btn-sm" style="text-decoration:none; text-align:center; background:#ea580c;">
 <i class="fa-solid fa-external-link-alt"></i> Browse Temu
 </a>
 </div>
 <div class="supplier-card" data-supplier-card="amazon" style="grid-column: span 2;">
 <div class="flex items-center gap-3 mb-3">
 <div class="trust-icon" style="background:#fef9c3;font-size:1.1rem"><i class="fa-brands fa-amazon" style="color:#a16207"></i></div>
 <div><div class="font-600">Amazon Premium</div><div class="text-xs color-text3">High-quality components, tools, and developer supplies</div></div>
 </div>
 <a href="https://www.amazon.com" target="_blank" class="btn btn-primary btn-full btn-sm" style="text-decoration:none; text-align:center; background:#232f3e;">
 <i class="fa-solid fa-external-link-alt"></i> Browse Amazon
 </a>
 </div>
 </div>
 </div>
 
 <div class="card card-pad">
 <h3 class="mb-3">Profit Calculator</h3>
 <div class="form-grid form-grid-2">
 <div class="form-group"><label class="form-label">Supplier Cost (\u20A6)</label><input type="number" id="ds-calc-cost" class="form-input" value="12000" inputmode="numeric" oninput="updateDropshipCalculator()"></div>
 <div class="form-group"><label class="form-label">Selling Price (\u20A6)</label><input type="number" id="ds-calc-price" class="form-input" value="35000" inputmode="numeric" oninput="updateDropshipCalculator()"></div>
 </div>
 <div class="form-grid form-grid-2">
 <div class="form-group"><label class="form-label">Shipping (\u20A6)</label><input type="number" id="ds-calc-ship" class="form-input" value="3500" inputmode="numeric" oninput="updateDropshipCalculator()"></div>
 <div class="form-group"><label class="form-label">Marketplace Fee (%)</label><input type="number" id="ds-calc-fee" class="form-input" value="3" inputmode="numeric" oninput="updateDropshipCalculator()"></div>
 </div>
 <div class="profit-result"><span>Net Profit</span><strong id="ds-calc-profit">\u20A60</strong><small id="ds-calc-margin">0% margin</small></div>
 </div>
 </div>

 <div class="card card-pad mb-4" style="background:var(--cream); border:1px solid var(--border);">
 <label class="form-label" style="font-size:.85rem;">Import Product by URL</label>
 <div style="display:flex; gap:.5rem;">
 <input type="url" id="ds-import-url" class="form-input" placeholder="Paste AliExpress, Temu, or Amazon product link here..." style="flex:1;">
 <button class="btn btn-primary" onclick="importFromUrl(event)">
 <i class="fa-solid fa-download"></i> Fetch & Import
 </button>
 </div>
 <p class="text-xs color-text3 mt-1">Copy a product link from the supplier and paste it here to automatically generate a listing.</p>
 </div>

 <div class="card card-pad mb-4">
 <div class="flex justify-between items-center mb-3 gap-2 wrap">
 <h3>Hot Products for Nigeria</h3>
 <div class="flex gap-2 wrap">
 <select id="ds-filter" class="form-select" style="width:auto;padding:.4rem .7rem;font-size:.78rem" onchange="renderDropshipCatalog()">
 <option value="all">All niches</option><option value="electronics">Electronics</option><option value="home">Home</option><option value="fashion">Fashion</option><option value="beauty">Beauty</option>
 </select>
 <button class="btn btn-outline btn-sm" onclick="renderDropshipCatalog()"><i class="fa-solid fa-rotate"></i> Refresh</button>
 </div>
 </div>
 <div class="hot-items-grid" id="dropship-catalog"></div>
 </div>

 <div class="card overflow-hidden">
 <div class="card-pad flex justify-between items-center gap-2 wrap" style="border-bottom:1px solid var(--border)">
 <h3>Imported Dropship Listings</h3>
 <button class="btn btn-outline btn-sm" onclick="loadDropshipData()"><i class="fa-solid fa-rotate"></i> Reload</button>
 </div>
 <div class="overflow-x">
 <table class="data-table"><thead><tr><th>Product</th><th>Price</th><th>Stock</th><th>Status</th><th>Action</th></tr></thead>
 <tbody id="ds-imported-table"><tr><td colspan="5" style="text-align:center;padding:2rem;color:var(--text3)">No dropship products imported yet</td></tr></tbody></table>
 </div>
 </div>`;
}

async function connectSupplier(supplier) {
 try {
 const result = await callEdge('manage-dropship', { action: 'connect_supplier', supplier_key: supplier });
 dropshipConnections[result.supplier_key || supplier] = true;
 updateSupplierCards();
 toast(`${result.supplier_name || (supplier==='aliexpress'?'AliExpress':'CJ Dropshipping')} Connected!`, 'You can now import products', 'success');
 } catch(e) {
 toast('Connection Failed', e.message, 'error');
 }
}

async function loadSupplierConnections() {
 try {
 const result = await callEdge('manage-dropship', { action: 'list_connections' });
 dropshipConnections = {};
 (result.connections || []).forEach(conn => { dropshipConnections[conn.supplier_key] = true; });
 } catch(e) {
 dropshipConnections = {};
 }
}

function updateSupplierCards() {
 document.querySelectorAll('[data-supplier-card]').forEach(card => {
 const supplier = card.dataset.supplierCard;
 const btn = card.querySelector('button');
 const isConnected = !!dropshipConnections[supplier];
 card.classList.toggle('connected', isConnected);
 if (btn) btn.innerHTML = isConnected ? '<i class="fa-solid fa-check"></i> Connected' : 'Connect';
 });
}

async function renderDropshipCatalog() {
 const grid = document.getElementById('dropship-catalog');
 if (!grid) return;
 const filter = document.getElementById('ds-filter')?.value || 'all';
 try {
 const result = await callEdge('manage-dropship', { action: 'list_catalog', niche: filter });
 activeDropshipCatalog = (result.catalog || []).map(normalizeDropshipItem);
 } catch(e) {
 activeDropshipCatalog = dropshipCatalog;
 }
 const items = activeDropshipCatalog.filter(p => filter === 'all' || p.niche === filter);
 grid.innerHTML = items.map(p => {
 const profit = p.price - p.cost - p.shipping - Math.round(p.price * 0.03);
 const margin = Math.max(0, Math.round((profit / p.price) * 100));
 return `<div class="hot-item dropship-product-card">
 <img src="${p.image}" alt="${escAttr(p.name)}" loading="lazy">
 <div class="hot-item-body">
 <div class="flex justify-between gap-2"><div class="font-600 text-sm">${escHtml(p.name)}</div><span class="badge badge-green">${p.demand}</span></div>
 <div class="text-xs color-text3 mt-1">${escHtml(p.supplier)} - ${escHtml(p.delivery)}</div>
 <div class="dropship-price-row"><span>Cost ${fmtN(p.cost)}</span><strong>${fmtN(p.price)}</strong></div>
 <div class="hot-profit">Profit ${fmtN(profit)} - ${margin}% margin</div>
 <button class="btn btn-primary btn-full btn-sm mt-2" onclick="importDropshipById('${p.id}')"><i class="fa-solid fa-download"></i> Import Listing</button>
 </div>
 </div>`;
 }).join('');
}

async function importFromUrl(event) {
 if (!currentUser) { showModal('auth-modal'); return; }
 
 const urlInput = document.getElementById('ds-import-url');
 const productUrl = urlInput.value.trim();
 
 if (!productUrl) { 
 toast('Missing Link', 'Please paste a product link first', 'warn'); 
 return; 
 }

 const btn = event.currentTarget;
 const oldHtml = btn.innerHTML;
 btn.disabled = true;
 btn.innerHTML = '<span class="spinner-dark"></span> Fetching Data...';

 try {
 // Call the Edge Function to scrape the URL and create the product
 const result = await callEdge('manage-dropship', {
 action: 'import_from_url',
 url: productUrl,
 seller_id: currentUser.id
 });

 toast('Product Imported! ', `${result.name || 'Item'} added to your store`, 'success');
 urlInput.value = ''; // Clear the input
 
 // Refresh the dashboard tables to show the new product
 loadDropshipData();
 loadSellerProds();
 
 } catch (err) {
 console.error("URL Import Error:", err);
 toast('Import Failed', err.message || 'Could not fetch product details from that link.', 'error');
 } finally {
 btn.disabled = false;
 btn.innerHTML = oldHtml;
 }
}

async function importDropshipById(id) {
 const item = activeDropshipCatalog.find(p => p.id === id) || dropshipCatalog.find(p => p.id === id);
 if (!item) return;
 return importDropship(item);
}

async function importDropship(itemOrName, cost, price, emoji) {
 if (!currentUser) { showModal('auth-modal'); return; }
 const item = typeof itemOrName === 'object'
 ? itemOrName
 : { name: itemOrName, cost, price, shipping: 0, image: '', description: `Imported from global supplier. ${itemOrName}`, stock: 999, supplier: 'Global Supplier' };
 try {
 await callEdge('manage-dropship', {
 action: 'import_product',
 catalog_id: item.id,
 data: {
 name: item.name,
 description: item.description,
 supplier_key: item.supplier_key || (item.supplier === 'AliExpress' ? 'aliexpress' : item.supplier === 'CJ Dropshipping' ? 'cj' : 'global'),
 supplier_cost: item.cost || 0,
 suggested_price: item.price || price || 0,
 price: item.price || price || 0,
 shipping_cost: item.shipping || 0,
 stock_quantity: item.stock || 999,
 delivery_estimate: item.delivery || 'International shipping',
 image_url: item.image || '',
 },
 });
 toast(`${emoji || 'Imported'} ${item.name}`, `Listed at ${fmtN(item.price)}`, 'success');
 loadDropshipData();
 loadSellerProds();
 } catch(e) {
 toast('Import Failed', e.message, 'error');
 }
}

function updateDropshipCalculator() {
 const cost = parseFloat(document.getElementById('ds-calc-cost')?.value) || 0;
 const price = parseFloat(document.getElementById('ds-calc-price')?.value) || 0;
 const ship = parseFloat(document.getElementById('ds-calc-ship')?.value) || 0;
 const feePct = parseFloat(document.getElementById('ds-calc-fee')?.value) || 0;
 const profit = price - cost - ship - (price * feePct / 100);
 const margin = price > 0 ? Math.round((profit / price) * 100) : 0;
 const profitEl = document.getElementById('ds-calc-profit');
 const marginEl = document.getElementById('ds-calc-margin');
 if (profitEl) profitEl.textContent = fmtN(profit);
 if (marginEl) marginEl.textContent = `${margin}% margin`;
}

async function loadDropshipData() {
 if (!currentUser) return;
 ensureGrowthSections();
 await renderDropshipCatalog();
 await loadSupplierConnections();
 updateSupplierCards();
 updateDropshipCalculator();
 const { data: products } = await db.from('products').select('*').eq('seller_id', currentUser.id).eq('category', 'dropship').order('created_at', { ascending:false });
 const dropshipProducts = products || [];
 const importedEl = document.getElementById('ds-imported');
 if (importedEl) importedEl.textContent = dropshipProducts.length;
 const { data: orders } = await db.from('orders').select('total_amount,status,items').eq('seller_id', currentUser.id);
 const ids = new Set(dropshipProducts.map(p => p.id));
 const dsOrders = (orders || []).filter(o => ids.has(o.product_id));
 const sales = dsOrders.filter(o => o.status === 'delivered').reduce((s,o)=>s + (o.total_amount || 0), 0);
 const pending = dsOrders.filter(o => !['delivered','cancelled','refunded'].includes(o.status)).length;
 document.getElementById('ds-sales').textContent = fmtN(sales);
 document.getElementById('ds-profit').textContent = fmtN(sales * 0.35);
 document.getElementById('ds-pending').textContent = pending;
 const tbody = document.getElementById('ds-imported-table');
 if (!tbody) return;
 if (!dropshipProducts.length) {
 tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:2rem;color:var(--text3)">No dropship products imported yet</td></tr>';
 return;
 }
 tbody.innerHTML = dropshipProducts.map(p => `<tr>
 <td><div class="flex items-center gap-2"><img src="${p.image_url || 'https://images.unsplash.com/photo-1607082348824-0a96f2a4b9da?w=120'}" alt="" style="width:42px;height:42px;border-radius:8px;object-fit:cover"><div><div class="font-600 text-sm">${escHtml(p.name)}</div><div class="text-xs color-text3">${fmtDate(p.created_at)}</div></div></div></td>
 <td class="font-bold color-green">${fmtN(p.price)}</td>
 <td>${p.stock_quantity ?? 'N/A'}</td>
 <td><span class="badge ${p.status === 'active' ? 'badge-green' : 'badge-gold'}">${escHtml(p.status || 'draft')}</span></td>
 <td><button class="btn btn-outline btn-sm" onclick="editProduct('${p.id}')"><i class="fa-solid fa-pen"></i> Edit</button></td>
 </tr>`).join('');
}

// ====================================================
// AFFILIATE
// ====================================================
function renderAffiliateSection() {
 const section = document.getElementById('ds-affiliate');
 if (!section || section.dataset.enhanced === 'true') return;
 section.dataset.enhanced = 'true';
 section.innerHTML = `
 <h1 class="dash-page-title">Affiliate & Referral</h1>
 <p class="dash-page-sub">Invite sellers, track conversions, and prepare payout-ready referral earnings.</p>
 <div class="referral-box mb-4">
 <div class="flex justify-between items-start gap-3 wrap">
 <div><h3 style="color:#fff;margin-bottom:.28rem">Refer sellers and earn \u20A65,000</h3><p style="color:rgba(255,255,255,.68);font-size:.84rem;max-width:620px">Share your link with business owners. You earn when a referred seller activates their store.</p></div>
 <span class="badge badge-gold">Seller activation reward</span>
 </div>
 <div class="referral-input-row" style="margin-top:1.25rem">
 <input type="text" id="referral-link" readonly>
 <button class="btn btn-primary" onclick="copyReferralLink()"><i class="fa-solid fa-copy"></i> Copy</button>
 <button class="btn btn-outline" onclick="shareReferralLink()" style="background:rgba(255,255,255,.08);color:#fff;border-color:rgba(255,255,255,.2)"><i class="fa-solid fa-share-nodes"></i> Share</button>
 </div>
 <div class="affiliate-share-row">
 <button onclick="shareReferralChannel('whatsapp')"><i class="fa-brands fa-whatsapp"></i> WhatsApp</button>
 <button onclick="shareReferralChannel('facebook')"><i class="fa-brands fa-facebook"></i> Facebook</button>
 <button onclick="shareReferralChannel('x')"><i class="fa-brands fa-x-twitter"></i> X</button>
 <button onclick="copyReferralMessage()"><i class="fa-solid fa-message"></i> Copy message</button>
 </div>
 </div>
 <div class="affiliate-grid mb-4">
 <div class="stat-card"><div class="stat-value color-green" id="aff-total">\u20A60</div><div class="stat-label">Total Earnings</div></div>
 <div class="stat-card"><div class="stat-value" id="aff-pending">\u20A60</div><div class="stat-label">Pending</div></div>
 <div class="stat-card"><div class="stat-value" id="aff-clicks">0</div><div class="stat-label">Clicks</div></div>
 <div class="stat-card"><div class="stat-value" id="aff-conversions">0</div><div class="stat-label">Conversions</div></div>
 </div>
 <div class="dash-two-col mb-4">
 <div class="card card-pad"><h3 class="mb-3">Referral Toolkit</h3><div class="affiliate-tool-list"><button onclick="copyReferralMessage()"><i class="fa-solid fa-copy"></i><span>Copy invite message</span></button><button onclick="downloadReferralQr()"><i class="fa-solid fa-qrcode"></i><span>Open QR code</span></button><button onclick="showDash('advertise')"><i class="fa-solid fa-bullhorn"></i><span>Promote your offer</span></button></div></div>
 <div class="card card-pad"><h3 class="mb-3">Payout Readiness</h3><div class="affiliate-payout-box"><div><span>Minimum payout</span><strong>\u20A65,000</strong></div><div><span>Bank account</span><strong id="aff-bank-status">Not set</strong></div></div><button class="btn btn-primary btn-full mt-3" onclick="requestAffiliatePayout()"><i class="fa-solid fa-wallet"></i> Request Affiliate Payout</button></div>
 </div>
 <div class="card card-pad mb-4"><h3 class="mb-3">External Programs</h3><div class="affiliate-program-grid">
 <div class="affiliate-program-card"><i class="fa-brands fa-amazon" style="color:#f90"></i><strong>Amazon</strong><span>Track imported product links manually.</span><button class="btn btn-outline btn-sm" onclick="connectAffiliateProgram('Amazon')">Add Program</button></div>
 <div class="affiliate-program-card"><i class="fa-solid fa-bag-shopping" style="color:var(--green)"></i><strong>Jumia</strong><span>Save marketplace affiliate links.</span><button class="btn btn-outline btn-sm" onclick="connectAffiliateProgram('Jumia')">Add Program</button></div>
 <div class="affiliate-program-card"><i class="fa-brands fa-ebay" style="color:#0064d2"></i><strong>eBay</strong><span>Useful for gadget resellers.</span><button class="btn btn-outline btn-sm" onclick="connectAffiliateProgram('eBay')">Add Program</button></div>
 <div class="affiliate-program-card"><i class="fa-solid fa-link" style="color:var(--purple)"></i><strong>Custom</strong><span>Add any brand or partner link.</span><button class="btn btn-outline btn-sm" onclick="connectAffiliateProgram('Custom')">Add Link</button></div>
 </div></div>
 <div class="card overflow-hidden"><div class="card-pad" style="border-bottom:1px solid var(--border)"><h3>Recent Earnings</h3></div><div class="overflow-x"><table class="data-table"><thead><tr><th>Date</th><th>Activity</th><th>Source</th><th>Amount</th><th>Status</th></tr></thead><tbody id="aff-table-body"><tr><td colspan="5" style="text-align:center;padding:2rem;color:var(--text3)">No earnings yet</td></tr></tbody></table></div></div>`;
}

function copyRef() {
 const link = document.getElementById('referral-link').value;
 navigator.clipboard.writeText(link).then(()=>toast('Referral Link Copied!','Share to earn \u20A6500 per referral','success'));
}

async function loadFlashSaleProducts() {
 if (!currentUser) {
 console.warn("Flash Sale: No current user");
 return;
 }
 
 const selectEl = document.getElementById('flash-product');
 if (!selectEl) {
 console.error("Flash Sale: Element #flash-product not found in DOM");
 return;
 }
 
 selectEl.innerHTML = '<option value="">Loading products...</option>';
 
 try {
 console.log("Fetching active products for seller:", currentUser.id);
 
 // We add a manual check for the status column to ensure it matches your DB
 const { data: products, error } = await db.from('products')
 .select('id, name, price, status')
 .eq('seller_id', currentUser.id)
 .eq('status', 'active');
 
 if (error) {
 console.error("Supabase Query Error:", error);
 throw error;
 }
 
 console.log("Products found:", products);
 
 if (!products || products.length === 0) {
 selectEl.innerHTML = '<option value="">No active products found</option>';
 return;
 }
 
 // Build options
 let options = products.map(p => 
 `<option value="${p.id}">${escHtml(p.name)} (${fmtN(p.price)})</option>`
 ).join('');
 
 selectEl.innerHTML = '<option value="">Select a product...</option>' + options;
 
 } catch(e) {
 console.error("Critical Flash Sale Load Error:", e);
 selectEl.innerHTML = '<option value="">Load Failed (Check Console)</option>';
 toast('Error', 'Check console for DB query error', 'error');
 }
}

async function loadAffiliateData() {
 if (!currentUser) return;
 ensureGrowthSections();
 const rc = currentUser.profile?.referral_code || 'ref_' + currentUser.id?.substr(0,8);
 const link = `${window.location.origin}${window.location.pathname}?ref=${encodeURIComponent(rc)}`;
 document.getElementById('referral-link').value = link;
 const bankStatus = document.getElementById('aff-bank-status');
 if (bankStatus) bankStatus.textContent = currentUser.profile?.account_number ? `${currentUser.profile.bank_name || 'Bank'} ending ${String(currentUser.profile.account_number).slice(-4)}` : 'Not set';
 let refs = [];
 const { data, error } = await db.from('referrals').select('*').eq('referrer_id', currentUser.id).order('created_at', { ascending:false });
 if (!error) refs = data || [];
 const earned = (refs||[]).filter(r=>r.paid).reduce((s,r)=>s+(r.amount||500),0);
 const pending = (refs||[]).filter(r=>!r.paid).reduce((s,r)=>s+(r.amount||5000),0);
 const trackedClicks = Number(appStorage.getItem(`bs_aff_clicks_${currentUser.id}`) || '0');
 document.getElementById('aff-total').textContent = fmtN(earned);
 document.getElementById('aff-pending').textContent = fmtN(pending);
 document.getElementById('aff-clicks').textContent = Math.max(trackedClicks, (refs||[]).length * 4);
 document.getElementById('aff-conversions').textContent = (refs||[]).length;
 const tbody = document.getElementById('aff-table-body');
 if (!refs?.length) { tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:2rem;color:var(--text3)">No earnings yet. Share your referral link!</td></tr>'; return; }
 tbody.innerHTML = refs.map(r=>`<tr><td>${fmtDate(r.created_at)}</td><td>Seller Referral</td><td>${escHtml(r.source || 'Direct Link')}</td><td class="font-bold color-green">${fmtN(r.amount||5000)}</td><td><span class="badge ${r.paid?'badge-green':'badge-gold'}">${r.paid?'Paid':'Pending'}</span></td></tr>`).join('');
}

function getReferralMessage() {
 const link = document.getElementById('referral-link')?.value || '';
 return `Join BUYSELL Nigeria and open your seller store. Use my referral link: ${link}`;
}

function bumpAffiliateClick() {
 if (!currentUser) return;
 const key = `bs_aff_clicks_${currentUser.id}`;
 appStorage.setItem(key, String(Number(appStorage.getItem(key) || '0') + 1));
 const el = document.getElementById('aff-clicks');
 if (el) el.textContent = Number(el.textContent || '0') + 1;
}

function shareReferralLink() {
 const link = document.getElementById('referral-link')?.value || '';
 bumpAffiliateClick();
 if (navigator.share) navigator.share({ title: 'Join BUYSELL Nigeria', text: 'Open your seller store on BUYSELL Nigeria.', url: link }).catch(()=>{});
 else copyReferralLink();
}

function shareReferralChannel(channel) {
 const link = document.getElementById('referral-link')?.value || '';
 const text = encodeURIComponent(getReferralMessage());
 bumpAffiliateClick();
 const urls = {
 whatsapp: `https://wa.me/?text=${text}`,
 facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(link)}`,
 x: `https://twitter.com/intent/tweet?text=${text}`
 };
 window.open(urls[channel], '_blank', 'noopener,noreferrer');
}

function copyReferralMessage() {
 navigator.clipboard.writeText(getReferralMessage()).then(() => toast('Invite Message Copied', 'Paste it on WhatsApp, Facebook, or SMS.', 'success'));
}

function downloadReferralQr() {
 const link = encodeURIComponent(document.getElementById('referral-link')?.value || '');
 bumpAffiliateClick();
 window.open(`https://api.qrserver.com/v1/create-qr-code/?size=320x320&data=${link}`, '_blank', 'noopener,noreferrer');
}

function connectAffiliateProgram(name) {
 const url = prompt(`Paste your ${name} affiliate link or program URL:`);
 if (!url) return;
 const programs = JSON.parse(appStorage.getItem('bs_affiliate_programs') || '[]');
 programs.push({ name, url, created_at: new Date().toISOString() });
 appStorage.setItem('bs_affiliate_programs', JSON.stringify(programs));
 toast(`${name} Added`, 'Program link saved on this device.', 'success');
}

function requestAffiliatePayout() {
 const pending = parseFloat((document.getElementById('aff-pending')?.textContent || '0').replace(/[^\d.]/g,'')) || 0;
 
 // REMOVED: Legacy account_number validation block to allow pure Paystack processing
 if (pending < 5000) { 
 toast('Not Ready Yet', 'Minimum affiliate payout is \u20A65,000.', 'warn'); 
 return; 
 }
 
 const wdAmountInput = document.getElementById('wd-amount');
 if (wdAmountInput) wdAmountInput.value = pending;
 
 showDash('withdrawals');
 toast('Payout Prepared', 'Review and submit your Paystack processing request.', 'info');
}

async function loadWithdrawalHistory() {
 if (!currentUser) return;
 const { data: wds } = await db.from('withdrawals').select('*').eq('seller_id', currentUser.id).order('created_at',{ascending:false});
 const tbody = document.getElementById('wd-history');
 if (!wds?.length) { tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:2rem;color:var(--text3)">No withdrawals yet</td></tr>'; return; }
 const totalPaid = wds.filter(w=>w.status==='paid').reduce((s,w)=>s+w.amount,0);
 const pendingAmt = wds.filter(w=>w.status==='pending').reduce((s,w)=>s+w.amount,0);
 document.getElementById('wd-pending').textContent = fmtN(pendingAmt);
 document.getElementById('wd-total').textContent = fmtN(totalPaid);
 tbody.innerHTML = wds.map(w=>`<tr><td>${fmtDate(w.created_at)}</td><td class="font-bold">${fmtN(w.amount)}</td><td><span class="badge ${w.status==='paid'?'badge-green':w.status==='rejected'?'badge-red':'badge-gold'}">${w.status}</span></td><td class="text-xs color-text3">${w.id?.substr(0,8)||' - '}</td></tr>`).join('');
}

// ====================================================
// DISPUTES
// ====================================================
let disputeOrderId = null;
function openDisputeModal(orderId) {
 disputeOrderId = orderId;
 document.getElementById('dispute-order-id').textContent = orderId;
 document.getElementById('dispute-type').value = '';
 document.getElementById('dispute-desc').value = '';
 showModal('dispute-modal');
}

async function submitDisputeDirect(orderId, type, desc) {
 if (!currentUser || !orderId) throw new Error('Order not found for this dispute.');
 const { data: order } = await db.from('orders').select('id,buyer_id,seller_id,status').eq('id', orderId).maybeSingle();
 if (!order) throw new Error('Could not find this order.');
 if (order.buyer_id !== currentUser.id && order.seller_id !== currentUser.id && !isAdmin()) {
 throw new Error('You can only file a dispute for your own order.');
 }
 const base = {
 order_id: orderId,
 buyer_id: order.buyer_id || currentUser.id,
 seller_id: order.seller_id || null,
 status: 'open'
 };
 const attempts = [
 { ...base, dispute_type: type, description: desc },
 { ...base, dispute_type: type, message: desc },
 { ...base, issue_type: type, details: desc },
 { ...base, type, message: desc },
 { ...base, reason: type, note: desc },
 { order_id: orderId, user_id: currentUser.id, dispute_type: type, message: desc, status: 'open' },
 { order_id: orderId, user_id: currentUser.id, type, status: 'open' }
 ];
 let lastError = null;
 for (const row of attempts) {
 const cleanRow = { ...row };
 for (let i = 0; i < 8; i++) {
 const { error } = await db.from('disputes').insert(cleanRow);
 if (!error) return;
 lastError = error;
 
 // FIXED: Pointed to your actual global function string parser
 const missing = missingColumn(error);
 const msg = (error.message || '').toLowerCase();
 
 // Intercept either column discrepancies or strict schema cache mismatches safely
 if (!missing || (!msg.includes('column') && !msg.includes('schema cache')) || !(missing in cleanRow)) break;
 delete cleanRow[missing];
 }
 }
 throw lastError || new Error('Could not file dispute.');
}

async function submitDispute() {
 const type = document.getElementById('dispute-type').value;
 const desc = document.getElementById('dispute-desc').value.trim();
 if (!type || !desc) { toast('Please fill all fields','','warn'); return; }
 try {
 try {
 await callEdge('submit-dispute', {
 order_id: disputeOrderId,
 dispute_type: type,
 description: desc
 });
 } catch (edgeError) {
 console.warn('submit-dispute function failed, using direct insert:', edgeError);
 await submitDisputeDirect(disputeOrderId, type, desc);
 }
 } catch(e) { toast('Error', e.message, 'error'); return; }
 toast('Dispute Filed', 'Admin will review within 24hrs', 'success');
 closeModal('dispute-modal');
}

// ====================================================
// SUPER ADMIN - full gated panel
// ====================================================
let _adminSellersCache = [];
let _adminRevenueChart = null;

function isAdmin() {
 // Both email AND database role must match - prevents email spoofing
 return isAdminEmail();
}

function guardAdminPanel() {
 const guard = document.getElementById('admin-guard');
 const content = document.getElementById('admin-content');
 if (!isAdmin()) {
 guard?.classList.remove('hidden');
 content?.classList.add('hidden');
 return false;
 }
 guard?.classList.add('hidden');
 content?.classList.remove('hidden');
 return true;
}

// ====================================================
// ADMIN BRANDING
// ====================================================
let tempLogoFile = null;

function previewAdminLogo(input) {
 if (input.files && input.files[0]) {
 tempLogoFile = input.files[0];
 const reader = new FileReader();
 reader.onload = function(e) {
 document.getElementById('logo-preview-container').classList.remove('hidden');
 document.getElementById('logo-preview-img').src = e.target.result;
 document.getElementById('logo-zone').classList.add('has-file');
 document.querySelector('#logo-zone .upload-label').textContent = tempLogoFile.name;
 }
 reader.readAsDataURL(tempLogoFile);
 }
}

async function saveAdminLogo() {
 if (!tempLogoFile) return toast('No file selected', 'Please choose an image first', 'warn');
 if (!isAdmin()) return toast('Access Denied', '', 'error');

 const btn = document.getElementById('save-logo-btn');
 btn.disabled = true; 
 btn.innerHTML = '<span class="spinner"></span> Saving...';

 try {
 // 1. Upload to Supabase (using your existing 'uploads' bucket)
 const ext = tempLogoFile.name.split('.').pop();
 const path = `branding/logo_${Date.now()}.${ext}`;
 
 const { error: upErr, data } = await db.storage.from('uploads').upload(path, tempLogoFile, { upsert: true });
 if (upErr) throw upErr;
 
 // 2. Get Public URL
 const { data: pubData } = db.storage.from('uploads').getPublicUrl(path);
 const logoUrl = pubData.publicUrl;

 // 3. Save to browser storage so it persists instantly for all page reloads
 // (In a full scale app, you'd also save this to a 'site_settings' table in Supabase)
 appStorage.setItem('buysell_custom_logo', logoUrl);
 
 // 4. Apply globally to the DOM right now
 applySiteLogo(logoUrl);
 
 toast('Logo Updated! ', 'Your new branding is live', 'success');
 } catch(e) {
 console.error("Logo upload error:", e);
 toast('Upload Failed', 'Check your Supabase storage permissions', 'error');
 } finally {
 btn.disabled = false; 
 btn.innerHTML = '<i class="fa-solid fa-save"></i> Save & Apply Logo';
 }
}

// Function to hunt down every logo element and replace it with the image
function applySiteLogo(url) {
 if (!url) return;
 document.querySelectorAll('.brand-icon').forEach(icon => {
 // Replace the text "B" with the uploaded image
 icon.innerHTML = `<img src="${sanitizeUrl(url)}" alt="Logo" style="width:100%;height:100%;object-fit:contain;border-radius:inherit;">`;
 // Remove the green background gradient so the image looks clean
 icon.style.background = 'transparent';
 icon.style.boxShadow = 'none';
 });
}
 
function switchAdminTab(tab) {
 // Hide all tab panels
 document.querySelectorAll('.adm-tab').forEach(p => p.classList.add('hidden'));
 // Deactivate all sidebar nav items
 document.querySelectorAll('#admin-portal-view .dash-nav-item').forEach(b => b.classList.remove('active'));
 document.querySelectorAll('[id^="atab-"]').forEach(b => b.classList.remove('active'));
 document.querySelectorAll('[data-admin-tab]').forEach(b => b.classList.remove('active'));
 // Show selected panel
 document.querySelectorAll('#adm-tab-' + tab).forEach(p => p.classList.remove('hidden'));
 // Highlight sidebar item
 document.getElementById('ap-nav-' + tab)?.classList.add('active');
 document.querySelectorAll('#atab-' + tab + ', [data-admin-tab="' + tab + '"]').forEach(b => b.classList.add('active'));
 // Load data
 if (tab === 'overview') loadAdminOverview();
 if (tab === 'sellers') loadAdminSellers();
 if (tab === 'orders') loadAdminOrders();
 if (tab === 'disputes') loadAdminDisputes();
 if (tab === 'withdrawals') loadAdminWithdrawals();
 if (tab === 'receipts') loadAdminReceipts();
 if (tab === 'broadcast') loadBroadcastHistory();
 if (tab === 'ai') adminAiHistory = [];
 if (tab === 'accounts') loadAdminAccounts();
 if (tab === 'kyc') loadAdminKyc();
 if (tab === 'upcoming') loadAdminUpcomingProducts();
}

async function uploadUpcomingMediaFiles(files, kind) {
 const isVideo = kind === 'video';
 const maxCount = isVideo ? 4 : 10;
 const maxSize = isVideo ? PRODUCT_MAX_VIDEO_SIZE : PRODUCT_MAX_IMAGE_SIZE;
 const allowedTypes = isVideo ? PRODUCT_ALLOWED_VID_TYPES : PRODUCT_ALLOWED_IMG_TYPES;
 const folder = isVideo ? 'upcoming/videos' : 'upcoming/images';
 const selected = files.slice(0, maxCount);
 if (files.length > maxCount) toast('Media limit applied', `Only the first ${maxCount} ${isVideo ? 'videos' : 'pictures'} were uploaded.`, 'warn');
 const urls = [];
 for (let i = 0; i < selected.length; i++) {
  const file = selected[i];
  if (!allowedTypes.includes(file.type)) throw new Error(`Unsupported ${isVideo ? 'video' : 'image'}: ${file.name}`);
  if (file.size > maxSize) throw new Error(`${file.name} is too large.`);
  const ext = safeFileExt(file.name, isVideo ? 'mp4' : 'jpg');
  const path = `${folder}/${currentUser.id}/${Date.now()}-${i}-${Math.random().toString(36).slice(2, 7)}.${ext}`;
  const uploaded = await uploadToFirstAvailableBucket(['products', 'uploads'], path, file, { contentType: file.type, upsert: false });
  if (uploaded.publicUrl) urls.push(uploaded.publicUrl);
 }
 return urls;
}

function getVisibleAdminElement(id) {
 const nodes = [...document.querySelectorAll(`#${id}`)];
 return nodes.find(node => {
  const portal = node.closest('#admin-portal-view');
  const sellerDash = node.closest('#seller-dashboard');
  if (portal) return portal.style.display !== 'none' && !portal.classList.contains('hidden');
  if (sellerDash) return sellerDash.style.display !== 'none' && !sellerDash.classList.contains('hidden');
  return false;
 }) || nodes[0] || null;
}

async function submitUpcomingProduct() {
 if (!guardAdminPanel()) return;
 const btn = getVisibleAdminElement('up-submit-btn');
 const title = getVisibleAdminElement('up-title')?.value.trim();
 const description = getVisibleAdminElement('up-desc')?.value.trim();
 const launchDate = getVisibleAdminElement('up-launch-date')?.value || null;
 const priority = parseInt(getVisibleAdminElement('up-priority')?.value || '1', 10) || 1;
 const imageFiles = Array.from(getVisibleAdminElement('up-images')?.files || []);
 const videoFiles = Array.from(getVisibleAdminElement('up-videos')?.files || []);
 if (!title || title.length < 3) { toast('Missing title', 'Enter an upcoming product name.', 'warn'); return; }
 if (!imageFiles.length && !videoFiles.length) { toast('Media required', 'Upload at least one picture or video.', 'warn'); return; }
 btn.disabled = true;
 const oldHtml = btn.innerHTML;
 btn.innerHTML = '<span class="spinner"></span> Uploading...';
 try {
  const images = await uploadUpcomingMediaFiles(imageFiles, 'image');
  const videos = await uploadUpcomingMediaFiles(videoFiles, 'video');
  const row = {
  title,
  description,
  launch_date: launchDate,
  priority,
  images,
  videos,
  image_url: images[0] || '',
  video_url: videos[0] || '',
  status: 'active',
  created_by: currentUser.id,
  };
  const { error } = await db.from('upcoming_products').insert(row);
  if (error) throw error;
  ['up-title','up-desc','up-launch-date','up-images','up-videos'].forEach(id => { const el = getVisibleAdminElement(id); if (el) el.value = ''; });
  const priorityEl = getVisibleAdminElement('up-priority');
  if (priorityEl) priorityEl.value = '1';
  toast('Upcoming Product Published', 'It is now visible in the buyer portal.', 'success');
  loadAdminUpcomingProducts();
  loadUpcomingProducts();
 } catch (e) {
  toast('Upload Failed', e.message || 'Could not publish upcoming product.', 'error');
 } finally {
  btn.disabled = false;
  btn.innerHTML = oldHtml;
 }
}

async function loadAdminUpcomingProducts() {
 if (!guardAdminPanel()) return;
 const list = getVisibleAdminElement('admin-upcoming-list');
 if (!list) return;
 list.innerHTML = '<div class="text-sm color-text3">Loading upcoming products...</div>';
 try {
  const { data, error } = await db.from('upcoming_products').select('*').order('priority', { ascending: false }).order('created_at', { ascending: false }).limit(30);
  if (error) throw error;
  const rows = data || [];
  if (!rows.length) {
  list.innerHTML = '<div class="empty-state"><i class="fa-solid fa-calendar-plus"></i><p>No upcoming products uploaded yet.</p></div>';
  return;
  }
  list.innerHTML = rows.map(row => {
  const { images, videos } = upcomingMediaList(row);
  const cover = videos[0] || images[0] || '';
  return `<div class="admin-upcoming-item">
  <div class="admin-upcoming-thumb">${cover ? (videos[0] ? `<video src="${escAttr(cover)}" muted></video>` : `<img src="${escAttr(cover)}" alt="">`) : '<i class="fa-solid fa-image"></i>'}</div>
  <div class="admin-upcoming-info">
  <strong>${escHtml(row.title || 'Upcoming Product')}</strong>
  <span>${escHtml(row.launch_date ? fmtDate(row.launch_date) : 'Coming soon')} - ${images.length} picture${images.length === 1 ? '' : 's'} - ${videos.length} video${videos.length === 1 ? '' : 's'}</span>
  <p>${escHtml(row.description || '')}</p>
  </div>
  <div class="admin-upcoming-actions">
  <span class="badge ${row.status === 'active' ? 'badge-green' : 'badge-gray'}">${escHtml(row.status || 'active')}</span>
  <button class="btn btn-outline btn-sm" onclick="toggleUpcomingProduct('${escAttr(row.id)}','${escAttr(row.status || 'active')}')">${row.status === 'active' ? 'Hide' : 'Show'}</button>
  <button class="btn btn-outline btn-sm" style="color:var(--red);border-color:#fecaca" onclick="deleteUpcomingProduct('${escAttr(row.id)}')"><i class="fa-solid fa-trash"></i></button>
  </div>
  </div>`;
  }).join('');
 } catch (e) {
  list.innerHTML = `<div class="text-sm color-danger">Could not load upcoming products: ${escHtml(e.message || 'Unknown error')}</div>`;
 }
}

async function toggleUpcomingProduct(id, status) {
 if (!guardAdminPanel()) return;
 const next = status === 'active' ? 'hidden' : 'active';
 const { error } = await db.from('upcoming_products').update({ status: next }).eq('id', id);
 if (error) { toast('Error', error.message, 'error'); return; }
 toast('Upcoming Product Updated', `Status: ${next}`, 'success');
 loadAdminUpcomingProducts();
 loadUpcomingProducts();
}

async function deleteUpcomingProduct(id) {
 if (!guardAdminPanel()) return;
 if (!confirm('Delete this upcoming product?')) return;
 const { error } = await db.from('upcoming_products').delete().eq('id', id);
 if (error) { toast('Error', error.message, 'error'); return; }
 toast('Deleted', 'Upcoming product removed.', 'info');
 loadAdminUpcomingProducts();
 loadUpcomingProducts();
}

/* -- OVERVIEW -- */
function setTextAllById(id, value) {
 document.querySelectorAll(`#${id}`).forEach(node => { node.textContent = value; });
}

async function loadAdminOverview() {
 if (!guardAdminPanel()) return;
 const [{ data: sellers }, { data: buyers }, { data: orders }, { count: productCount }, { count: pendingAdCount }] = await Promise.all([
  db.from('profiles').select('id,commission_paid,trial_end,role').eq('role','seller'),
  db.from('profiles').select('id').eq('role','buyer'),
  db.from('orders').select('total_amount,created_at,status').neq('status','cancelled'),
  db.from('products').select('id', { count: 'exact', head: true }).eq('status', 'active'),
  db.from('advertisements').select('id', { count: 'exact', head: true }).in('status', ['pending', 'pending_payment'])
  ]);
 const activeSellers = (sellers||[]).filter(s => !s.is_suspended).length;
 const freeSellers = (sellers||[]).length;
 const suspended= (sellers||[]).filter(s => s.is_suspended).length;
 const revenue = (orders||[]).reduce((s,o) => s + (o.total_amount||0), 0);

 setTextAllById('adm-total-sellers', (sellers||[]).length);
 setTextAllById('adm-total-buyers', (buyers||[]).length);
 setTextAllById('adm-revenue', fmtN(revenue));
 setTextAllById('adm-commission-due', fmtN(Math.round(revenue * PLATFORM_FEE_PCT)));
 setTextAllById('adm-paid', activeSellers);
 setTextAllById('adm-trial', freeSellers);
 setTextAllById('adm-suspended', suspended);
 setTextAllById('adm-total-products', productCount || 0);
 setTextAllById('adm-pending-ads', pendingAdCount || 0);

 // Disputes count
 const { count } = await db.from('disputes').select('id', { count:'exact', head:true }).eq('status','open');
 setTextAllById('adm-disputes', count || 0);

 // Revenue bar chart
 _renderAdminRevenueChart(orders || []);
}

 // ====================================================
// ADMIN AI ASSISTANT
// ====================================================

async function askAdminBot(preset) {
 const input = document.getElementById('admin-ai-input');
 const msg = preset || input.value.trim();
 if (!msg) return;
 if (!preset) input.value = '';

 // Add user message
 const container = document.getElementById('admin-ai-messages');
 const userDiv = document.createElement('div');
 userDiv.style.cssText = 'display:flex;flex-direction:row-reverse;gap:.42rem';
 userDiv.innerHTML = `<div style="background:var(--forest);color:#fff;padding:.52rem .82rem;border-radius:14px;font-size:.79rem;max-width:82%;line-height:1.5">${escHtml(msg)}</div>`;
 container.appendChild(userDiv);

 adminAiHistory.push({ role: 'user', content: msg });

 // Typing indicator
 const typingDiv = document.createElement('div');
 typingDiv.id = 'admin-typing';
 typingDiv.style.cssText = 'display:flex;gap:.42rem;align-items:center';
 typingDiv.innerHTML = `<div style="background:var(--green-xlt);color:var(--green);font-size:.76rem;flex-shrink:0;width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center"><i class="fa-solid fa-robot"></i></div><div style="background:#fff;border:1px solid var(--border);padding:.52rem .82rem;border-radius:14px;font-size:.79rem;color:var(--text3)">Thinking...</div>`;
 container.appendChild(typingDiv);
 container.scrollTop = container.scrollHeight;

 try {
 const data = await postAiRequest({
 messages: adminAiHistory,
 context: {
 task: 'admin_assistant',
 platform: 'BUYSELL Nigeria',
 admin_email: ADMIN_EMAIL,
 total_sellers: document.getElementById('adm-total-sellers')?.textContent || '?',
 total_buyers: document.getElementById('adm-total-buyers')?.textContent || '?',
 total_revenue: document.getElementById('adm-revenue')?.textContent || '?',
 open_disputes: document.getElementById('adm-disputes')?.textContent || '?',
 }
 }, getAiEndpoints('smooth-handler'));

 let reply = data.reply || getAdminAiFallback(msg);
 
 // Check for mass suspension trigger
 if (reply.includes('[ACTION: SUSPEND_UNPAID_SELLERS]')) {
 reply = reply.replace('[ACTION: SUSPEND_UNPAID_SELLERS]', '').trim();
 executeMassSuspension();
 }

 adminAiHistory.push({ role: 'assistant', content: reply });

 document.getElementById('admin-typing')?.remove();
 const replyDiv = document.createElement('div');
 replyDiv.style.cssText = 'display:flex;gap:.42rem';
 // Format bold text as simple bold html
 const formattedReply = escHtml(reply).replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
 replyDiv.innerHTML = `<div style="background:var(--green-xlt);color:var(--green);font-size:.76rem;flex-shrink:0;width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center"><i class="fa-solid fa-robot"></i></div><div style="background:#fff;border:1px solid var(--border);padding:.52rem .82rem;border-radius:14px;font-size:.79rem;max-width:82%;line-height:1.5">${formattedReply}</div>`;
 container.appendChild(replyDiv);

 } catch(e) {
 const reply = getAdminAiFallback(msg);
 adminAiHistory.push({ role: 'assistant', content: reply });
 document.getElementById('admin-typing')?.remove();
 const replyDiv = document.createElement('div');
 replyDiv.style.cssText = 'display:flex;gap:.42rem';
 replyDiv.innerHTML = `<div style="background:var(--green-xlt);color:var(--green);font-size:.76rem;flex-shrink:0;width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center"><i class="fa-solid fa-robot"></i></div><div style="background:#fff;border:1px solid var(--border);padding:.52rem .82rem;border-radius:14px;font-size:.79rem;max-width:82%;line-height:1.5">${escHtml(reply)}</div>`;
 container.appendChild(replyDiv);
 toast('AI in basic mode', e.message || 'Using offline admin help', 'warn');
 }
 container.scrollTop = container.scrollHeight;
}
function getAdminAiFallback(message) {
 const text = String(message || '').toLowerCase();
 if (text.includes('unpaid') || text.includes('expired') || text.includes('suspend')) {
 return 'Seller subscriptions are now free. Use Accounts only for manual account review, reactivation, KYC, disputes, or policy enforcement.';
 }
 if (text.includes('receipt') || text.includes('commission')) {
 return 'Seller subscription receipts are now legacy only. Basic seller access no longer depends on commission payment.';
 }
 if (text.includes('kyc')) {
 return 'Use the KYC Verify tab to open submitted documents. Approve only when the document matches the profile details; reject with a clear reason when it does not.';
 }
 if (text.includes('dispute')) {
 return 'Review open disputes from the Disputes tab. Compare the order status, uploaded proof, and buyer/seller notes before resolving or escalating.';
 }
 return 'I am in basic admin mode right now. I can still guide you through sellers, receipts, KYC, disputes, ads, and account enforcement from the admin tabs.';
}

async function executeMassSuspension() {
 toast('No Subscription Enforcement', 'Seller access is free, so unpaid/expired seller suspension is disabled.', 'info', 6000);
}
 
async function loadAdminSellers() {
 if (!guardAdminPanel()) return;
 document.getElementById('admin-skeleton').classList.remove('hidden');
 document.getElementById('admin-list').classList.add('hidden');
 document.getElementById('admin-empty').classList.add('hidden');

 const { data: sellers } = await db.from('profiles').select('*').eq('role','seller').order('created_at',{ascending:false});
 _adminSellersCache = sellers || [];
 document.getElementById('admin-skeleton').classList.add('hidden');

 const filter = document.getElementById('adm-seller-filter')?.value || 'all';
 _renderAdminSellerList(_applySellerFilter(_adminSellersCache, filter));
}

function _applySellerFilter(sellers, filter) {
 if (filter === 'paid') return sellers.filter(s => !s.is_suspended);
 if (filter === 'trial') return sellers;
 if (filter === 'suspended') return sellers.filter(s => s.is_suspended);
 return sellers;
}

function filterAdminSellers() {
 const q = (document.getElementById('adm-seller-search')?.value || '').trim().toLowerCase();
 let list = _adminSellersCache;
 if (q) list = list.filter(s =>
 (s.name||'').toLowerCase().includes(q) ||
 (s.email||'').toLowerCase().includes(q) ||
 (s.store_name||'').toLowerCase().includes(q)
 );
 const filter = document.getElementById('adm-seller-filter')?.value || 'all';
 _renderAdminSellerList(_applySellerFilter(list, filter));
}

function _renderAdminSellerList(sellers) {
 const list = document.getElementById('admin-list');
 const empty = document.getElementById('admin-empty');
 document.getElementById('adm-seller-count').textContent = `${sellers.length} seller${sellers.length !== 1 ? 's' : ''}`;
 if (!sellers.length) { empty.classList.remove('hidden'); list.classList.add('hidden'); return; }
 empty.classList.add('hidden');
 list.classList.remove('hidden');
 list.innerHTML = sellers.map(s => {
 const badge = s.is_suspended
 ? `<span class="badge badge-red">Admin Review</span>`
 : `<span class="badge badge-green">Free Access</span>`;
 const approveBtn = `<button onclick="adminToggleCommission('${s.id}',true)" class="btn btn-sm btn-primary"><i class="fa-solid fa-check"></i> Mark Free</button>`;
 const accessBtn = s.is_suspended
 ? `<button onclick="adminReactivateUser('${s.id}')" class="btn btn-primary btn-sm"><i class="fa-solid fa-rotate-left"></i> Reactivate</button>`
 : `<button onclick="adminDeactivateUser('${s.id}')" class="btn btn-outline btn-sm" style="color:var(--red);border-color:var(--red)"><i class="fa-solid fa-ban"></i> Deactivate</button>`;
 const waBtn = s.whatsapp
 ? `<a href="https://wa.me/${s.whatsapp.replace(/\D/g,'')}" target="_blank" class="btn btn-sm" style="background:#dcfce7;color:#15803d"><i class="fa-brands fa-whatsapp"></i></a>`
 : '';
 return `
 <div class="admin-seller-card" id="asc-${s.id}">
 <div class="flex items-center gap-3" style="flex:1;min-width:0">
 <div class="seller-avatar" style="flex-shrink:0">${(s.name||'S')[0].toUpperCase()}</div>
 <div style="min-width:0">
 <div class="font-600" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(s.name||'Unknown')}</div>
 <div class="text-xs color-text3">${escHtml(s.email||'')}</div>
 ${s.store_name ? `<div class="text-xs color-text3"> ${escHtml(s.store_name)}</div>` : ''}
 ${s.accounts ? `<div class="text-xs color-text3">Accounts: ${escHtml(s.accounts)}</div>` : ''}
 <div class="text-xs color-text3">Joined: ${fmtDate(s.created_at)}</div>
 <div class="flex gap-1 mt-1 flex-wrap">${badge}</div>
 </div>
 </div>
 <div class="flex gap-2 flex-wrap" style="flex-shrink:0">
 ${approveBtn}
 ${accessBtn}
 ${waBtn}
 <button onclick="adminViewStorefront('${s.id}')" class="btn btn-outline btn-sm" title="View store"><i class="fa-solid fa-store"></i></button>
 <button onclick="adminDeleteSeller('${s.id}')" class="btn btn-danger btn-sm" title="Delete"><i class="fa-solid fa-trash"></i></button>
 </div>
 </div>`;
 }).join('');
}

async function adminToggleCommission(id, paid) {
 try { await callEdge('admin-action', { action: 'toggle_commission', target_id: id, data: { commission_paid: paid } }); }
 catch(e) { toast('Error', e.message, 'error'); return; }
 // Optimistic update on card
 const card = document.getElementById('asc-' + id);
 if (card) {
 const badge = card.querySelector('.badge');
 if (badge) { badge.className = 'badge ' + (paid ? 'badge-green' : 'badge-red'); badge.textContent = paid ? 'OK Active' : 'Warning Overdue'; }
 }
 toast(paid ? 'OK Seller Activated' : 'Blocked Access Revoked', '', paid ? 'success' : 'warn');
 loadAdminSellers();
}

function adminViewStorefront(id) { viewStorefront(id); }

async function adminDeleteSeller(id) {
 if (!confirm('Permanently delete this seller and all their products?')) return;
 try { await callEdge('admin-action', { action: 'delete_seller', target_id: id }); }
 catch(e) { toast('Error', e.message, 'error'); return; }
 toast('Seller Deleted', '', 'info');
 loadAdminSellers();
}

/* -- ORDERS -- */
async function loadAdminOrders() {
 if (!isAdmin()) return;
 document.getElementById('adm-orders-skeleton').classList.remove('hidden');
 document.getElementById('adm-orders-list').classList.add('hidden');
 document.getElementById('adm-orders-empty').classList.add('hidden');
 const filter = document.getElementById('adm-order-filter')?.value || 'all';
 let q = db.from('orders').select('*').order('created_at',{ascending:false}).limit(120);
 if (filter !== 'all') q = q.eq('status', filter);
 const { data: orders } = await q;
 document.getElementById('adm-orders-skeleton').classList.add('hidden');
 document.getElementById('adm-order-count').textContent = (orders||[]).length + ' orders';
 const list = document.getElementById('adm-orders-list');
 if (!orders?.length) { document.getElementById('adm-orders-empty').classList.remove('hidden'); return; }
 list.classList.remove('hidden');
 const sc = {pending:'badge-gold',confirmed:'badge-blue',shipped:'badge-purple',delivered:'badge-green',cancelled:'badge-red',refunded:'badge-gray'};
 list.innerHTML = orders.map(o => `
 <div class="card card-pad mb-2">
 <div class="flex justify-between items-start flex-wrap gap-2 mb-2">
 <div>
 <div class="font-bold text-sm">${o.id}</div>
 <div class="text-xs color-text3">${fmtDate(o.created_at)} - ${o.payment_method||''}</div>
 <div class="text-xs mt-1">${(o.items||[]).map(i=>`${escHtml(i.name)} x${i.qty}`).join(', ')}</div>
 </div>
 <div class="text-right">
 <div class="font-bold color-green">${fmtN(o.total_amount)}</div>
 <span class="badge ${sc[o.status]||'badge-gray'}">${o.status}</span>
 </div>
 </div>
 <div class="text-xs color-text3 mb-2"><i class="fa-solid fa-user"></i> ${escHtml(o.delivery_name||' - ')} &nbsp;|&nbsp; <i class="fa-solid fa-map-marker-alt"></i> ${escHtml((o.delivery_address||'').substr(0,50))}</div>
 <div class="flex gap-2 flex-wrap">
 ${o.status==='pending' ? `<button onclick="adminUpdateOrder('${o.id}','confirmed')" class="btn btn-primary btn-sm">Confirm</button>` : ''}
 ${o.status==='confirmed' ? `<button onclick="adminUpdateOrder('${o.id}','shipped')" class="btn btn-sm" style="background:#ede9fe;color:var(--purple)">Mark Shipped</button>` : ''}
 ${o.status==='shipped' ? `<button onclick="adminUpdateOrder('${o.id}','delivered')" class="btn btn-sm" style="background:#dcfce7;color:#15803d">Mark Delivered</button>` : ''}
 ${!['cancelled','refunded'].includes(o.status) ? `<button onclick="adminUpdateOrder('${o.id}','cancelled')" class="btn btn-outline btn-sm">Cancel</button>` : ''}
 ${o.proof_url ? `<a href="${o.proof_url}" target="_blank" class="btn btn-outline btn-sm"><i class="fa-solid fa-image"></i> Proof</a>` : ''}
 </div>
 </div>`).join('');
}

async function adminUpdateOrder(id, status) {
 try {
  const { data: oldOrder } = await db.from('orders').select('status').eq('id', id).maybeSingle();
  await callEdge('admin-action', { action: 'update_order', target_id: id, data: { status } });
  if (status === 'confirmed') notifyOrderIfConfirmed(id, oldOrder?.status || 'pending');
  toast('Order updated to ' + status, '', 'success');
  loadAdminOrders();
  } catch(e) { toast('Error', e.message, 'error'); }
}

/* -- DISPUTES -- */
async function loadAdminDisputes() {
 if (!isAdmin()) return;
 const { data: disputes } = await db.from('disputes').select('*').order('created_at',{ascending:false}).limit(60);
 const dl = document.getElementById('admin-disputes-list');
 const open = (disputes||[]).filter(d => d.status === 'open').length;
 document.getElementById('adm-disputes').textContent = open;
 if (!disputes?.length) { dl.innerHTML = '<p class="color-text3 text-sm">No disputes.</p>'; return; }
 dl.innerHTML = disputes.map(d => `
 <div class="dispute-card ${d.status==='open'?'open-dispute':'resolved'} mb-2">
 <div class="flex justify-between items-start flex-wrap gap-2 mb-2">
 <div>
 <div class="font-600 text-sm">Order: ${d.order_id}</div>
 <div class="text-xs color-text3">${fmtDate(d.created_at)}</div>
 <div class="text-sm mt-1"><strong>${(d.dispute_type||'').replace(/-/g,' ')}</strong></div>
 <div class="text-xs color-text3 mt-1">${escHtml((d.description||'').substr(0,200))}${(d.description?.length||0)>200?'...':''}</div>
 </div>
 <span class="badge ${d.status==='open'?'badge-red':d.status==='resolved'?'badge-green':'badge-orange'}">${d.status}</span>
 </div>
 ${d.status==='open' ? `
 <div class="flex gap-2 flex-wrap">
 <button onclick="resolveDispute('${d.id}')" class="btn btn-primary btn-sm"><i class="fa-solid fa-check"></i> Resolve</button>
 <button onclick="refundDispute('${d.id}','${d.order_id}')" class="btn btn-danger btn-sm"><i class="fa-solid fa-undo"></i> Refund</button>
 <a href="https://wa.me/?text=Re%20dispute%20Order%20${d.order_id}" target="_blank" class="btn btn-outline btn-sm"><i class="fa-brands fa-whatsapp"></i></a>
 </div>` : ''}
 </div>`).join('');
}

async function resolveDispute(id) {
 try { await callEdge('admin-action', { action: 'resolve_dispute', target_id: id }); }
 catch(e) { toast('Error', e.message, 'error'); return; }
 toast('Dispute Resolved OK', '', 'success');
 loadAdminDisputes();
}

async function refundDispute(disputeId, orderId) {
 try { await callEdge('admin-action', { action: 'refund_dispute', target_id: disputeId, data: { order_id: orderId } }); }
 catch(e) { toast('Error', e.message, 'error'); return; }
 toast('Refund Issued', 'Order ' + orderId + ' marked refunded', 'success');
 loadAdminDisputes();
}

/* -- WITHDRAWALS -- */
async function loadAdminWithdrawals() {
 if (!isAdmin()) return;
 document.getElementById('adm-wd-skeleton').classList.remove('hidden');
 document.getElementById('adm-wd-list').classList.add('hidden');
 document.getElementById('adm-wd-empty').classList.add('hidden');
 const { data: wds } = await db.from('withdrawals').select('*,profiles(name,email,whatsapp)').order('created_at',{ascending:false}).limit(80);
 document.getElementById('adm-wd-skeleton').classList.add('hidden');
 if (!wds?.length) { document.getElementById('adm-wd-empty').classList.remove('hidden'); return; }
 const list = document.getElementById('adm-wd-list');
 list.classList.remove('hidden');
 list.innerHTML = wds.map(w => {
 const borderColor = w.status==='pending' ? 'var(--gold)' : w.status==='paid' ? 'var(--green)' : 'var(--danger)';
 const badge = w.status==='pending' ? 'badge-gold' : w.status==='paid' ? 'badge-green' : 'badge-red';
 return `<div class="card card-pad mb-2" style="border-left:4px solid ${borderColor}">
 <div class="flex justify-between items-start flex-wrap gap-2">
 <div>
 <div class="font-bold" style="font-size:1.05rem;color:var(--green)">${fmtN(w.amount)}</div>
 <div class="font-600 text-sm">${escHtml(w.profiles?.name||'Seller')}</div>
 <div class="text-xs color-text3">${escHtml(w.profiles?.email||'')}</div>
 <div class="text-xs mt-1"><b>${escHtml(w.bank_name||'')}</b> - ${escHtml(w.account_number||'')} - ${escHtml(w.account_name||'')}</div>
 <div class="text-xs color-text3">${fmtDate(w.created_at)}</div>
 </div>
 <div class="flex flex-col items-end gap-2">
 <span class="badge ${badge}">${w.status}</span>
 ${w.status==='pending' ? `
 <div class="flex gap-2">
 <button onclick="adminPayWithdrawal('${w.id}')" class="btn btn-primary btn-sm"><i class="fa-solid fa-check"></i> Mark Paid</button>
 <button onclick="adminRejectWithdrawal('${w.id}')" class="btn btn-outline btn-sm">Reject</button>
 </div>` :
 w.status==='paid' ? `<div class="text-xs color-green">Paid ${fmtDate(w.paid_at)}</div>` :
 `<div class="text-xs color-danger">${escHtml(w.reject_reason||'Rejected')}</div>`}
 </div>
 </div>
 </div>`;
 }).join('');
}

async function adminPayWithdrawal(id) {
 try {
 try {
 await callEdge('admin-action', { action: 'pay_withdrawal', target_id: id });
 } catch (edgeError) {
 console.warn('pay_withdrawal function failed, using scoped update:', edgeError);
 let update = { status: 'paid', paid_at: new Date().toISOString() };
 for (let i = 0; i < 4; i++) {
 const { error } = await db.from('withdrawals')
 .update(update)
 .eq('id', id)
 .eq('status', 'pending');
 if (!error) break;
 const missing = getMsgMissingColumn(error);
 if (!missing || !(missing in update)) throw error;
 delete update[missing];
 }
 }
 }
 catch(e) { toast('Error', e.message, 'error'); return; }
 toast('Withdrawal Marked Paid OK', '', 'success');
 loadAdminWithdrawals();
}

async function adminRejectWithdrawal(id) {
 const reason = prompt('Reason for rejection (optional):') || 'Rejected by admin';
 try {
 try {
 await callEdge('admin-action', { action: 'reject_withdrawal', target_id: id, data: { reason } });
 } catch (edgeError) {
 console.warn('reject_withdrawal function failed, using scoped update:', edgeError);
 const attempts = [
 { status: 'rejected', reject_reason: reason },
 { status: 'rejected', rejection_reason: reason },
 { status: 'rejected', reason },
 { status: 'rejected', note: reason },
 { status: 'rejected' }
 ];
 let lastError = null;
 let saved = false;
 for (const attempt of attempts) {
 const update = { ...attempt };
 for (let i = 0; i < 4; i++) {
 const { error } = await db.from('withdrawals')
 .update(update)
 .eq('id', id)
 .eq('status', 'pending');
 if (!error) { saved = true; break; }
 lastError = error;
 const missing = getMsgMissingColumn(error);
 if (!missing || !(missing in update)) break;
 delete update[missing];
 }
 if (saved) break;
 }
 if (!saved) throw lastError || new Error('Could not reject withdrawal.');
 }
 }
 catch(e) { toast('Error', e.message, 'error'); return; }
 toast('Withdrawal Rejected', '', 'warn');
 loadAdminWithdrawals();
}

/* -- BROADCAST -- */
async function sendBroadcast() {
 if (!isAdmin()) return;
 const title = document.getElementById('bc-title').value.trim();
 const body = document.getElementById('bc-body').value.trim(); // Reads text string from DOM
 const target = document.getElementById('bc-target').value;
 const type = document.querySelector('input[name="bc-type"]:checked')?.value || 'info';
 
 if (!title || !body) { toast('Fill in title and message', '', 'warn'); return; }
 
 try { 
 // Passes payload keys straight to your Edge Function
 await callEdge('send-broadcast', { title, body, target, type }); 
 }
 catch(e) { 
 toast('Error', e.message, 'error'); 
 return; 
 }
 
 toast('" Broadcast Sent!', 'To: ' + target, 'success');
 document.getElementById('bc-title').value = '';
 document.getElementById('bc-body').value = '';
 loadBroadcastHistory();
}

async function loadBroadcastHistory() {
 const { data: bcs } = await db.from('broadcasts').select('*').order('created_at',{ascending:false}).limit(10);
 const el = document.getElementById('bc-history');
 if (!el) return;
 const icons = { info:'Info', success:'OK', warn:'Warning', error:'' };
 el.innerHTML = (bcs||[]).length
 ? bcs.map(b => `<div class="card card-pad mb-2" style="border-left:3px solid var(--green)">
 <div class="flex justify-between items-center mb-1">
 <span class="font-600 text-sm">${icons[b.type]||'"'} ${escHtml(b.title)}</span>
 <span class="text-xs color-text3">${fmtDate(b.created_at)}</span>
 </div>
 <div class="text-xs color-text3 mb-1">To: <b>${b.target}</b></div>
 <div class="text-sm">${escHtml(b.body)}</div>
 </div>`).join('')
 : '<p class="color-text3 text-sm">None sent yet.</p>';
}

// ====================================================
// ADMIN - RECEIPTS MANAGEMENT
// ====================================================
function getBroadcastTargetsForProfile(profile = currentUser?.profile || {}) {
 const role = profile.role || 'buyer';
 const targets = new Set(['all']);
 if (role === 'buyer' || role === 'both' || role === 'admin') targets.add('buyers');
 if (isSellerAccount(profile)) targets.add('sellers');
 if (role === 'service_provider' || profile.accounts === 'service_provider') targets.add('service_providers');
 return [...targets];
}

async function loadBroadcastMessages(containerId, limit = 5) {
 const el = document.getElementById(containerId);
 if (!el || !currentUser) return;
 el.innerHTML = '<div class="text-center p-2"><span class="spinner"></span></div>';
 try {
 const { data, error } = await db.from('broadcasts')
 .select('*')
 .in('target', getBroadcastTargetsForProfile())
 .order('created_at', { ascending: false })
 .limit(limit);
 if (error) throw error;
 el.innerHTML = (data || []).length
 ? data.map(b => `
 <div style="border-top:1px solid var(--border);padding:.55rem 0">
 <div class="font-600 text-sm">${escHtml(b.title || 'Admin message')}</div>
 <div class="text-xs color-text3">${escHtml(b.body || '')}</div>
 <div class="text-xs color-text3" style="margin-top:.25rem">${fmtDate(b.created_at)}</div>
 </div>`).join('')
 : '<p class="text-xs color-text3">No admin messages yet.</p>';
 } catch (_) {
 el.innerHTML = '<p class="text-xs color-text3">Could not load admin messages.</p>';
 }
}

async function loadAdminReceipts() {
 if (!guardAdminPanel()) return;
 try {
 const { data: receipts } = await db.from('commission_receipts')
 .select('*, profiles(name, email)')
 .order('created_at', { ascending: false });

 const all = receipts || [];
 const pending = all.filter(r => r.status === 'pending').length;
 const approved = all.filter(r => r.status === 'approved').length;
 const rejected = all.filter(r => r.status === 'rejected').length;

 document.getElementById('rcpt-pending').textContent = pending;
 document.getElementById('rcpt-approved').textContent = approved;
 document.getElementById('rcpt-rejected').textContent = rejected;

 const tbody = document.getElementById('rcpt-table-body');
 if (!all.length) {
 tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:2rem;color:var(--text3)">No receipts submitted yet</td></tr>';
 return;
 }

 tbody.innerHTML = all.map(r => {
 const sellerName = r.profiles?.name || r.profiles?.email || 'Unknown';
 const statusBadge = r.status === 'approved' ? 'badge-green'
 : r.status === 'rejected' ? 'badge-red' : 'badge-gold';
 const actions = r.status === 'pending'
 ? `<button class="btn btn-primary btn-sm" onclick="approveReceipt('${r.id}','${r.seller_id}')" style="margin-right:.3rem"><i class="fa-solid fa-check"></i></button><button class="btn btn-outline btn-sm" style="color:var(--red);border-color:var(--red)" onclick="rejectReceipt('${r.id}')"><i class="fa-solid fa-times"></i></button>`
 : `<span class="text-xs color-text3">${r.status}</span>`;
 return `<tr>
 <td style="font-weight:600;font-size:.82rem">${escHtml(sellerName)}</td>
 <td class="text-xs">${fmtDate(r.created_at)}</td>
 <td class="text-xs" style="font-family:monospace">${escHtml(r.transaction_ref)}</td>
 <td><a href="${r.receipt_url}" target="_blank" class="btn btn-ghost btn-sm" style="color:var(--blue)"><i class="fa-solid fa-image"></i> View</a></td>
 <td><span class="badge ${statusBadge}">${r.status}</span></td>
 <td>${actions}</td>
 </tr>`;
 }).join('');
 } catch(e) {
 console.error('loadAdminReceipts error:', e);
 }
}

async function approveReceipt(receiptId, sellerId) {
 if (!confirm('Approve this receipt and activate the seller?')) return;
 try {
 await callEdge('admin-action', { action: 'approve_receipt', target_id: receiptId, data: { seller_id: sellerId } });
 toast('Receipt Approved', 'Seller store is now active.', 'success');
 loadAdminReceipts();
 loadAdminAccounts();
 } catch(e) {
 toast('Error', e.message, 'error');
 }
}

async function rejectReceipt(receiptId) {
 const note = prompt('Reason for rejection (optional):') || '';
 try {
 await callEdge('admin-action', { action: 'reject_receipt', target_id: receiptId, data: { reason: note } });
 toast('Receipt Rejected', 'Seller has been notified.', 'warn');
 loadAdminReceipts();
 loadAdminAccounts();
 } catch(e) {
 toast('Error', e.message, 'error');
 }
}
/* -- ACCOUNT MANAGEMENT -- */
async function loadAdminAccounts() {
 if (!guardAdminPanel()) return;
 loadCommissionActivations();
 loadAdPayments();
 loadTrialExtensions();
}

async function loadCommissionActivations() {
 const tbody = document.getElementById('acct-comm-list');
 try {
 const { data: receipts } = await db.from('commission_receipts')
 .select('*, profiles(name, email)')
 .eq('status', 'pending')
 .order('created_at', { ascending: false });

 if (!receipts || !receipts.length) {
 tbody.innerHTML = '<tr><td colspan="5" class="text-center text-sm color-text3 p-3">No pending commission receipts</td></tr>';
 return;
 }

 tbody.innerHTML = receipts.map(r => `
 <tr>
 <td style="font-weight:600;font-size:.82rem">${escHtml(r.profiles?.name || 'Unknown')}<br><span class="text-xs color-text3">${escHtml(r.profiles?.email || '')}</span></td>
 <td class="text-xs">${fmtDate(r.created_at)}</td>
 <td class="text-xs" style="font-family:monospace">${escHtml(r.transaction_ref)}</td>
 <td><a href="${r.receipt_url}" target="_blank" class="btn btn-ghost btn-sm" style="color:var(--blue)"><i class="fa-solid fa-image"></i> View</a></td>
 <td>
 <button class="btn btn-primary btn-sm" onclick="adminActivateSeller('${r.seller_id}', '${r.id}')"><i class="fa-solid fa-check"></i> Activate</button>
 </td>
 </tr>
 `).join('');
 } catch(e) {
 tbody.innerHTML = `<tr><td colspan="5" class="text-center text-sm color-danger p-3">Error: ${e.message}</td></tr>`;
 }
}

async function loadAdPayments() {
 const tbody = document.getElementById('acct-ads-list');
 try {
 let { data: ads, error } = await db.from('advertisements')
 .select('*, profiles!advertiser_id(name, email)')
 .in('status', ['pending', 'pending_payment'])
 .order('created_at', { ascending: false });
 if (error) {
 ({ data: ads } = await db.from('advertisements')
 .select('*, profiles!user_id(name, email)')
 .in('status', ['pending', 'pending_payment'])
 .order('created_at', { ascending: false }));
 }

 if (!ads || !ads.length) {
 tbody.innerHTML = '<tr><td colspan="5" class="text-center text-sm color-text3 p-3">No pending ad approvals</td></tr>';
 return;
 }

 tbody.innerHTML = ads.map(a => `
 <tr>
 <td style="font-weight:600;font-size:.82rem">${escHtml(a.profiles?.name || 'Unknown')}<br><span class="text-xs color-text3">${escHtml(a.profiles?.email || '')}</span></td>
 <td class="text-xs">${escHtml(a.title)}</td>
 <td class="text-xs" style="font-family:monospace">${escHtml(a.payment_reference || 'N/A')}</td>
 <td><a href="${a.media_url}" target="_blank" class="btn btn-ghost btn-sm" style="color:var(--blue)"><i class="fa-solid fa-image"></i> View</a></td>
 <td>
 <button class="btn btn-primary btn-sm" onclick="adminApproveAd('${a.id}')" style="margin-right:.3rem"><i class="fa-solid fa-check"></i></button>
 <button class="btn btn-outline btn-sm" onclick="adminRejectAd('${a.id}')" style="color:var(--red);border-color:var(--red)"><i class="fa-solid fa-times"></i></button>
 </td>
 </tr>
 `).join('');
 } catch(e) {
 tbody.innerHTML = `<tr><td colspan="5" class="text-center text-sm color-danger p-3">Error loading ads.</td></tr>`;
 }
}

let _trialExtensionsCache = [];
async function loadTrialExtensions() {
 const tbody = document.getElementById('acct-trials-list');
 try {
 const { data: sellers } = await db.from('profiles')
 .select('*')
 .eq('role', 'seller')
 .order('trial_end', { ascending: true });

 _trialExtensionsCache = sellers || [];
 _renderTrialExtensions(_trialExtensionsCache);
 } catch(e) {
 tbody.innerHTML = `<tr><td colspan="5" class="text-center text-sm color-danger p-3">Error loading sellers.</td></tr>`;
 }
}

function filterTrialExtensions() {
 const q = (document.getElementById('acct-trial-search')?.value || '').trim().toLowerCase();
 if (!q) return _renderTrialExtensions(_trialExtensionsCache);
 const filtered = _trialExtensionsCache.filter(s => 
 (s.name||'').toLowerCase().includes(q) || 
 (s.email||'').toLowerCase().includes(q)
 );
 _renderTrialExtensions(filtered);
}

function _renderTrialExtensions(sellers) {
 const tbody = document.getElementById('acct-trials-list');
 if (!sellers.length) {
 tbody.innerHTML = '<tr><td colspan="5" class="text-center text-sm color-text3 p-3">No sellers found.</td></tr>';
 return;
 }
 tbody.innerHTML = sellers.map(s => {
 const status = s.is_suspended
 ? '<span class="badge badge-red">Admin Review</span>'
 : '<span class="badge badge-green">Free Access</span>';
 const accessBtn = s.is_suspended
 ? `<button class="btn btn-primary btn-sm" onclick="adminReactivateUser('${s.id}')"><i class="fa-solid fa-rotate-left"></i> Reactivate</button>`
 : `<button class="btn btn-outline btn-sm" style="color:var(--red);border-color:var(--red)" onclick="adminDeactivateUser('${s.id}')"><i class="fa-solid fa-ban"></i> Deactivate</button>`;
 const activateBtn = s.commission_paid ? '' : `<button class="btn btn-primary btn-sm" onclick="adminGrantCommission('${s.id}')"><i class="fa-solid fa-check"></i> Mark Free</button>`;
 
 return `
 <tr>
 <td style="font-weight:600;font-size:.82rem">${escHtml(s.name || 'Unknown')}</td>
 <td class="text-xs color-text3">${escHtml(s.email || '')}</td>
 <td class="text-xs">Free</td>
 <td>${status}</td>
 <td><div class="flex gap-1 flex-wrap">${activateBtn}${accessBtn}</div></td>
 </tr>
 `;
 }).join('');
}

async function adminActivateSeller(sellerId, receiptId) {
 if (!confirm('Approve this receipt and activate the seller?')) return;
 try {
 await callEdge('admin-action', { action: 'approve_receipt', target_id: receiptId, data: { seller_id: sellerId } });
 toast('Seller Activated', 'Commission payment approved.', 'success');
 loadAdminAccounts();
 loadAdminReceipts();
 } catch(e) {
 toast('Error', e.message, 'error');
 }
}

async function adminApproveAd(adId) {
 if (!confirm('Approve this advertisement?')) return;
 try {
 await callEdge('admin-action', { action: 'approve_ad', target_id: adId });
 toast('Ad Approved', 'It is now active on the dashboard.', 'success');
 loadAdminAccounts();
 } catch(e) {
 toast('Error', e.message, 'error');
 }
}

async function adminRejectAd(adId) {
 if (!confirm('Reject this advertisement?')) return;
 try {
 await callEdge('admin-action', { action: 'reject_ad', target_id: adId });
 toast('Ad Rejected', 'Advertiser has been updated.', 'info');
 loadAdminAccounts();
 } catch(e) {
 toast('Error', e.message, 'error');
 }
}

async function adminExtendTrial(sellerId, currentEnd) {
 toast('No Trial Needed', 'Seller access is free and does not expire.', 'info', 6000);
}

async function adminGrantCommission(sellerId) {
 if (!confirm('Mark this seller as free/active?')) return;
 try {
 await callEdge('admin-action', { action: 'grant_commission', target_id: sellerId });
 toast('Seller Activated', 'Seller free access is active.', 'success');
 loadAdminAccounts();
 loadAdminSellers();
 } catch(e) {
 toast('Error', e.message, 'error');
 }
}

async function adminDeactivateUser(userId) {
 if (!confirm('Deactivate this account and pause their listings?')) return;
 try {
 const { error: profileError } = await db.from('profiles').update({ is_suspended: true }).eq('id', userId);
 if (profileError) throw profileError;
 await db.from('products').update({ status: 'paused' }).eq('seller_id', userId);
 toast('Account Deactivated', 'Listings were paused.', 'warn');
 loadAdminAccounts();
 loadAdminSellers();
 } catch(directError) {
 try {
 await callEdge('admin-action', { action: 'deactivate_user', target_id: userId, data: { user_id: userId } });
 toast('Account Deactivated', 'Listings were paused.', 'warn');
 loadAdminAccounts();
 loadAdminSellers();
 } catch(e) {
 toast('Error', e.message || directError.message, 'error');
 }
 }
}

async function adminReactivateUser(userId) {
 if (!confirm('Reactivate this account and listings?')) return;
 try {
 const { error: profileError } = await db.from('profiles').update({ is_suspended: false }).eq('id', userId);
 if (profileError) throw profileError;
 await db.from('products').update({ status: 'active' }).eq('seller_id', userId).neq('stock_quantity', 0);
 toast('Account Reactivated', 'Listings were restored.', 'success');
 loadAdminAccounts();
 loadAdminSellers();
 } catch(directError) {
 try {
 await callEdge('admin-action', { action: 'reactivate_user', target_id: userId, data: { user_id: userId } });
 toast('Account Reactivated', 'Listings were restored.', 'success');
 loadAdminAccounts();
 loadAdminSellers();
 } catch(e) {
 toast('Error', e.message || directError.message, 'error');
 }
 }
}
async function checkBroadcastForUser() {
 if (!currentUser) return;
 const targets = getBroadcastTargetsForProfile();
 const { data: bcs } = await db.from('broadcasts').select('*').in('target', targets).order('created_at',{ascending:false}).limit(2);
 (bcs||[]).forEach((b, i) => setTimeout(() => toast(b.title, b.body, b.type||'info', 7000), i * 2200));
}

/* -- REVENUE CHART -- */
function _renderAdminRevenueChart(orders) {
 const ctx = document.getElementById('admin-revenue-chart');
 if (!ctx) return;
 const days = 30;
 const dayMap = {};
 for (let i = days-1; i >= 0; i--) {
 const d = new Date(); d.setDate(d.getDate()-i);
 dayMap[d.toISOString().slice(0,10)] = 0;
 }
 orders.forEach(o => { const k = o.created_at?.slice(0,10); if (k && dayMap[k] !== undefined) dayMap[k] += o.total_amount||0; });
 const labels = Object.keys(dayMap).map(k => new Date(k).toLocaleDateString('en-NG',{month:'short',day:'numeric'}));
 const data = Object.values(dayMap);
 if (_adminRevenueChart) _adminRevenueChart.destroy();
 _adminRevenueChart = new Chart(ctx, {
 type: 'bar',
 data: { labels, datasets:[{ label:'Revenue (NGN)', data, backgroundColor:'rgba(25,168,71,.2)', borderColor:'#19a847', borderWidth:1.5, borderRadius:4 }] },
 options: { responsive:true, plugins:{ legend:{display:false}, tooltip:{callbacks:{label:c=>fmtN(c.raw)}} }, scales:{ y:{ beginAtZero:true, ticks:{callback:v=>fmtN(v)} }, x:{ ticks:{maxTicksLimit:8} } } }
 });
}

// ====================================================
// CHATBOT
// ====================================================
// ====================================================
// CLAUDE-POWERED CHATBOT (replaces old rule-based bot)
// ====================================================

async function sendChat() {
 const input = document.getElementById('chat-input');
 const msg = input.value.trim();
 if (!msg) return;

 addChatMsg(msg, 'user');
 input.value = '';
 chatHistory.push({ role: 'user', content: msg });

 // Show typing indicator
 const typingId = 'typing-' + Date.now();
 addChatMsg('...', 'bot', typingId);

 // Build context from current app state
 const context = {
 current_page: getCurrentPage(),
 user_role: currentRole || 'visitor',
 cart_item_count: cart.length,
 cart_total: cartPayableSubtotal(),
 current_product: currentProd
 ? { name: currentProd.name, price: currentProd.price, category: currentProd.category }
 : null,
 };

 try {
 const data = await postAiRequest({
 messages: chatHistory,
 context,
 systemPrompt: getChatSystemPrompt(context),
 }, getAiEndpoints('chat-bot-handler'));

 const reply = data.reply || getChatFallback(msg, context);
 chatHistory.push({ role: 'assistant', content: reply });

 // Replace typing indicator with real reply
 const typingEl = document.getElementById(typingId);
 if (typingEl) typingEl.querySelector('.cb-bubble').textContent = reply;

 } catch (err) {
 const typingEl = document.getElementById(typingId);
 const fallback = getChatFallback(msg, context);
 if (typingEl) typingEl.querySelector('.cb-bubble').textContent = fallback;
 chatHistory.push({ role: 'assistant', content: fallback });
 }
}

// Helper - detect which "page" user is on
function getChatSystemPrompt(context) {
 return `You are BUYSELL Nigeria's marketplace assistant. Help buyers, sellers, and service providers with shopping, payments, delivery, orders, reviews, ads, KYC, and dashboard steps. Be concise, friendly, and practical. Current page: ${context.current_page}. User role: ${context.user_role}.`;
}

function getChatFallback(message, context = {}) {
 const text = String(message || '').toLowerCase();
 if (text.includes('pay') || text.includes('payment') || text.includes('paystack')) {
 return 'You can pay with Paystack at checkout for card, bank, USSD, and other supported options. Bank transfer is also available when the seller has added bank details.';
 }
 if (text.includes('order') || text.includes('track')) {
 return 'Open My Orders to view your order status. If you just paid with Paystack, wait for verification to finish, then your confirmed order will appear there.';
 }
 if (text.includes('review')) {
 return 'Open the product, choose a star rating, write your experience, and submit the review. Reviews help other buyers know which sellers are reliable.';
 }
 if (text.includes('sell') || text.includes('seller')) {
 return 'To sell, sign up as a seller, complete your profile, add products from the dashboard, and keep your WhatsApp and payment details updated.';
 }
 if (text.includes('kyc') || text.includes('verify')) {
 return 'KYC is reviewed by the admin. Upload clear documents from your dashboard and wait for approval before relying on verified-seller features.';
 }
 if (text.includes('ad') || text.includes('advert')) {
 return 'Create an ad from the Advertise section, upload your media, add a link, and pay the placement fee. The ad becomes active after payment verification.';
 }
 if (context.cart_item_count) {
 return `You have ${context.cart_item_count} item${context.cart_item_count === 1 ? '' : 's'} in your cart. You can continue shopping or go to checkout when ready.`;
 }
 return 'I am in basic help mode right now, but I can still guide you with products, payments, orders, reviews, seller setup, ads, and KYC.';
}

function getCurrentPage() {
 if (document.getElementById('seller-dashboard')?.style.display !== 'none') return 'seller-dashboard';
 if (document.getElementById('storefront-view')?.style.display !== 'none') return 'storefront';
 if (document.getElementById('product-modal')?.classList.contains('open')) return 'product-detail';
 return 'buyer-marketplace';
}

// Updated addChatMsg - accepts optional id for typing indicator replacement
function addChatMsg(text, sender, id = null) {
 const container = document.getElementById('chat-messages');
 const div = document.createElement('div');
 div.className = `cb-msg ${sender}`;
 if (id) div.id = id;

 div.innerHTML = sender === 'bot'
 ? `<div class="cb-avatar" style="background:var(--green-xlt);color:var(--green);font-size:.76rem;flex-shrink:0">
 <i class="fa-solid fa-robot"></i>
 </div>
 <div class="cb-bubble">${sender === 'bot' ? text : escHtml(text)}</div>`
 : `<div class="cb-bubble">${escHtml(text)}</div>`;

 container.appendChild(div);
 container.scrollTop = container.scrollHeight;
}

// Clear history when chat is closed (optional - remove to keep memory)
function toggleChat() {
 const win = document.getElementById('chatbot-window');
 const wasOpen = win.classList.contains('open');
 win.classList.toggle('open');
 // Optionally reset history on open for a fresh session:
 
}

function askBot(q) {
 document.getElementById('chat-input').value = q;
 sendChat();
}
// ====================================================
// CSV BULK UPLOAD
// ====================================================
let csvRows = [];

function downloadCsvTemplate() {
 const headers = ['name','price','original_price','shipping_fee','category','condition','description','location','stock_quantity','negotiable','image_url','images','video_url','videos'];
 const example = ['iPhone 14 Pro Max','450000','550000','2500','phones','new','Brand new sealed iPhone 14 Pro Max 256GB','Ikeja Lagos','5','false','https://example.com/main.jpg','https://example.com/side.jpg|https://example.com/back.jpg','https://example.com/demo.mp4','https://example.com/demo2.mp4'];
 const csv = [headers.join(','), example.join(',')].join('\n');
 const blob = new Blob([csv], { type: 'text/csv' });
 const url = URL.createObjectURL(blob);
 const a = document.createElement('a'); a.href = url; a.download = 'buysell_product_template.csv'; a.click();
 URL.revokeObjectURL(url);
}

function parseCsvLine(line) {
 const vals = [];
 let current = '';
 let quoted = false;
 for (let i = 0; i < line.length; i++) {
  const char = line[i];
  const next = line[i + 1];
  if (char === '"' && quoted && next === '"') {
  current += '"';
  i++;
  } else if (char === '"') {
  quoted = !quoted;
  } else if (char === ',' && !quoted) {
  vals.push(current.trim());
  current = '';
  } else {
  current += char;
  }
 }
 vals.push(current.trim());
 return vals.map(v => v.replace(/^"|"$/g, ''));
}

function splitMediaUrls(value) {
 return String(value || '')
 .split(/[|;]/)
 .map(url => sanitizeUrl(url.trim()))
 .filter(Boolean);
}

function handleCsvUpload(input) {
 const file = input.files[0];
 if (!file) return;
 const reader = new FileReader();
 reader.onload = e => {
 const lines = e.target.result.split('\n').filter(l => l.trim());
  const headers = parseCsvLine(lines[0]).map(h => h.trim().toLowerCase());
  csvRows = lines.slice(1).map(line => {
  const vals = parseCsvLine(line);
 const obj = {};
 headers.forEach((h, i) => obj[h] = (vals[i]||'').trim().replace(/^"|"$/g,''));
 return obj;
 }).filter(r => r.name && r.price);

 const zone = document.getElementById('csv-zone');
 zone.classList.add('has-file');
 zone.querySelector('.upload-label').textContent = `${csvRows.length} products ready to import`;

 const preview = document.getElementById('csv-preview');
 preview.classList.remove('hidden');
 preview.innerHTML = `
 <div class="card card-pad" style="background:var(--cream)">
 <div class="flex justify-between items-center mb-2">
 <span class="font-600 text-sm">${csvRows.length} products found</span>
 <span class="text-xs color-text3">${file.name}</span>
 </div>
 <div style="max-height:130px;overflow-y:auto">
 ${csvRows.slice(0,5).map(r => `<div class="flex justify-between text-xs py-1 border-b border-border"><span>${escHtml(r.name)}</span><span class="font-bold color-green">${fmtN(parseFloat(r.price)||0)}</span></div>`).join('')}
 ${csvRows.length>5 ? `<div class="text-xs color-text3 mt-1 text-center">+${csvRows.length-5} more...</div>` : ''}
 </div>
 </div>`;
 document.getElementById('csv-import-btn').classList.remove('hidden');
 };
 reader.readAsText(file);
}

async function importCsvProducts() {
 if (!csvRows.length || !currentUser) return;
 const btn = document.getElementById('csv-import-btn');
 btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Importing...';
 const toInsert = csvRows.map(r => {
  const imageUrls = [sanitizeUrl(r.image_url || ''), ...splitMediaUrls(r.images)].filter(Boolean);
  const videoUrls = [sanitizeUrl(r.video_url || ''), ...splitMediaUrls(r.videos)].filter(Boolean);
  return {
  seller_id: currentUser.id,
  name: r.name, description: r.description||r.name,
  price: parseFloat(r.price)||0,
  original_price: parseFloat(r.original_price)||parseFloat(r.price)||0,
  shipping_fee: Math.max(0, parseFloat(r.shipping_fee ?? r.shipping_cost ?? 0)||0),
  shipping_cost: Math.max(0, parseFloat(r.shipping_fee ?? r.shipping_cost ?? 0)||0),
  category: r.category||'electronics',
  condition: r.condition||'new',
  location: r.location||'Nigeria',
  stock_quantity: parseInt(r.stock_quantity)||10,
  negotiable: r.negotiable==='true'||r.negotiable==='1',
  image_url: imageUrls[0] || '',
  images: imageUrls,
  video_url: videoUrls[0] || '',
  videos: videoUrls,
  has_video: videoUrls.length > 0,
  status: 'active', avg_rating: 5, review_count: 0,
  created_at: new Date().toISOString()
  };
 });
 const BATCH = 50;
 let imported = 0;
 for (let i = 0; i < toInsert.length; i += BATCH) {
 const { error } = await db.from('products').insert(toInsert.slice(i, i+BATCH));
 if (!error) imported += Math.min(BATCH, toInsert.length - i);
 }
 toast(`${imported} Products Imported! `, 'All products are now live', 'success');
 csvRows = [];
 document.getElementById('csv-file').value = '';
 document.getElementById('csv-preview').classList.add('hidden');
 btn.classList.add('hidden');
 document.getElementById('csv-zone').classList.remove('has-file');
 document.getElementById('csv-zone').querySelector('.upload-label').textContent = 'Click to upload CSV file';
 btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-upload"></i> Import Products';
 loadSellerProds();
}

// ====================================================
// SHARE PRODUCT
// ====================================================
function shareProduct(prod) {
 const url = `${window.location.origin}${window.location.pathname}?product=${prod.id}`;
 const text = `Check out "${prod.name}" for ${fmtN(prod.price)} on BUYSELL Nigeria!`;
 if (navigator.share) {
 navigator.share({ title: prod.name, text, url });
 } else {
 navigator.clipboard.writeText(url + '\n' + text);
 toast('Link Copied!', 'Share it with buyers', 'success');
 }
}

// Handle ?product= in URL for direct product links
async function handleDeepLink() {
 const params = new URLSearchParams(window.location.search);
 const productId = params.get('product');
 const storeId = params.get('store');
 const category = params.get('category');
 const refCode = params.get('ref');
 if (productId) {
  await loadProducts();
  openProduct(productId);
  }
  if (storeId) {
  viewStorefront(storeId);
  }
 if (category && !productId && !storeId) {
  await loadProducts();
  filterCat(category, { scroll: true });
  document.title = `${categoryLabel(category)} - BUYSELL Nigeria`;
 }
 if (refCode) {
 // Track referral click
 appStorage.setItem('bs_ref', refCode);
 }
}

// ====================================================
// WHATSAPP ORDER NOTIFICATION
// ====================================================
function sendWhatsAppOrderNotification(order, sellerWa) {
 if (!sellerWa) return;
 const phone = sellerWa.replace(/\D/g,'');
 const items = (order.items||[]).map(i=>`${i.name} x${i.qty}`).join(', ');
 const msg = encodeURIComponent(
 ` NEW ORDER on BUYSELL!\n\n` +
 `Order ID: ${order.id}\n` +
 `Items: ${items}\n` +
 `Total: ${fmtN(order.total_amount)}\n` +
 `Payment: ${order.payment_method}\n\n` +
 `Deliver to:\n${order.delivery_name}\n${order.delivery_phone}\n${order.delivery_address}\n\n` +
 `Log in to dashboard to confirm: ${PUBLIC_SITE_URL}`
 );
 // Open in background tab (silent notification fallback)
 const waUrl = `https://wa.me/${phone}?text=${msg}`;
 const link = document.createElement('a');
 link.href = waUrl; link.target = '_blank'; link.rel = 'noopener';
 document.body.appendChild(link);
 link.click();
 document.body.removeChild(link);
}

// Full saveOrderToDb implementation (with WA notification)
async function saveOrderToDb(txRef, method, paystackRef, proofUrl='') {
 try {
 const payload = {
 cart: checkoutCartItems(true),
 shipping_total: cartShippingTotal(),
 shipping_groups: cartSellerShippingGroups(),
 delivery_name: document.getElementById('co-name').value.trim(),
 delivery_phone: document.getElementById('co-phone').value.trim(),
 delivery_address: document.getElementById('co-address').value.trim(),
 payment_method: method,
 payment_ref: txRef || paystackRef || '',
 proof_url: proofUrl,
 referral_code: appStorage.getItem('bs_ref') || ''
 };

 let orderId;
 let totalAmount = cartPayableSubtotal();

 try {
 // ATTEMPT 1: Route through the Edge Function
 const result = await callEdge('create-order', payload);
 if (!result.success) throw new Error(result.error || 'request failed');
 
 orderId = result.order_id;
 totalAmount = result.total || totalAmount;
 
 } catch (edgeError) {
 console.warn('Edge Function failed, using direct database fallback:', edgeError);
 
 // ATTEMPT 2: Direct Database Insertion (Bypasses the failing Edge Function)
 if (!currentUser) throw new Error("User not authenticated.");
 
 const sellerId = cart[0]?.seller_id;
 if (!sellerId) throw new Error("Seller information missing from cart.");

 const orderData = {
 id: crypto.randomUUID(),
 buyer_id: currentUser.id,
 seller_id: sellerId,
 items: payload.cart,
 total_amount: totalAmount,
 status: 'pending',
 payment_method: method,
 payment_ref: payload.payment_ref,
 proof_url: proofUrl,
 delivery_name: payload.delivery_name,
 delivery_phone: payload.delivery_phone,
 delivery_address: payload.delivery_address
 };

 // Insert directly into the orders table
 const { data: insertedData, error: dbError } = await db
 .from('orders')
 .insert(orderData)
 .select('id')
 .single();

 if (dbError) throw new Error(dbError.message || 'Direct database insertion failed');
 orderId = insertedData.id;
 }

 // --- Cleanup, Notifications, and Analytics ---
 appStorage.removeItem('bs_ref');
 
  const seller = cart[0]?.profiles;
  if (seller?.whatsapp) {
  sendWhatsAppOrderNotification({ id: orderId, total_amount: totalAmount }, seller.whatsapp);
  }
  notifyOrderIfConfirmed(orderId);

  trackAnalytics({
 event_type: 'order_created',
 seller_id: cart[0]?.seller_id,
 order_id: orderId,
 quantity: cart.reduce((sum, c) => sum + (c.qty || 1), 0),
 amount: totalAmount,
 metadata: { payment_method: method || 'transfer' },
 });

 // --- Update the UI ---
 cart = []; 
 saveCart();
 document.getElementById('co-order-id').textContent = orderId;
 document.getElementById('co-order-total').textContent = fmtN(totalAmount);
 goCheckoutStep(3);
 
 toast('Order Placed! ', `Order ${orderId} confirmed`, 'success', 5000);

 return { success: true, order_id: orderId, total: totalAmount };

 } catch(err) {
 throw new Error(err.message);
 }
}

// ====================================================
// STOREFRONT SALES COUNT
// ====================================================
// viewStorefront - full implementation with order count + reviews
async function viewStorefront(sellerId) {
 if (!sellerId) return;
 closeModal('product-modal');
 const buyerView = document.getElementById('buyer-view');
 const storefrontView = document.getElementById('storefront-view');
 if (buyerView) {
 buyerView.classList.add('hidden');
 buyerView.style.display = 'none';
 }
 if (storefrontView) {
 storefrontView.classList.remove('hidden');
 storefrontView.style.display = 'block';
 }
 document.body.classList.remove('platform-seller-mode');
  const { data: seller } = await db.from('profiles').select('*').eq('id', sellerId).single();
  if (!seller) { toast('Store not found','','error'); return; }
  const platformStore = isPlatformProfile(seller);
  const storeLabel = platformStore ? 'BUYSELL Platform Store' : getPlatformStoreLabel(seller);
  const storeDescription = platformStore
  ? (seller.store_description || 'Official BUYSELL marketplace store for platform-listed products and trusted offers.')
  : (seller.store_description || 'Welcome to our store!');
  // --- DYNAMIC LOGO IMAGE CONTEXT RESOLUTION ---
  const avatarNode = document.getElementById('sf-avatar');
  if (seller.logo_url) {
 avatarNode.style.background = 'transparent';
 avatarNode.style.boxShadow = 'none';
 avatarNode.innerHTML = `<img src="${sanitizeUrl(seller.logo_url)}" alt="Logo" style="width:100%; height:100%; object-fit:cover; border-radius:50%; border:2px solid rgba(255,255,255,0.4);">`;
 } else {
  avatarNode.style.background = platformStore ? 'linear-gradient(135deg, var(--forest), var(--gold))' : 'linear-gradient(135deg, var(--green), var(--green-lt))';
  avatarNode.innerHTML = platformStore ? '<i class="fa-solid fa-shield-halved"></i>' : '';
  if (!platformStore) avatarNode.textContent = (seller.name || 'S')[0].toUpperCase();
  }

 document.getElementById('sf-name').textContent = storeLabel;
 document.getElementById('sf-desc').textContent = storeDescription;
 const sfBadge = document.getElementById('sf-store-badge');
 if (sfBadge) {
  sfBadge.className = platformStore ? 'badge badge-platform' : 'badge badge-verified';
  sfBadge.innerHTML = platformStore
  ? '<i class="fa-solid fa-shield-halved"></i> Platform Store'
  : '<i class="fa-solid fa-check"></i> Verified Seller';
 }

  // Append new location metrics if available under the desc elements context
  if (seller.store_address) {
  document.getElementById('sf-desc').insertAdjacentHTML('beforeend', `
 <div style="font-size:0.75rem; color:rgba(255,255,255,0.7); margin-top:6px;">
 <i class="fa-solid fa-location-dot"></i> Store Hub: ${escHtml(seller.store_address)}
 </div>`);
 }
 // ====================================================
 // EXCLUSION SECURED: PRIVACY AND TRANSACTION RETENTION
 // ====================================================
 // 1. Permanently hide or hijack the legacy public WhatsApp link element
 const sfWaLink = document.getElementById('sf-wa-link');
 if (sfWaLink) {
 sfWaLink.removeAttribute('target'); // Prevent opening an external window
 sfWaLink.href = '#';
 
 // Repurpose the button layout to invoke the secure in-app messaging matrix instead
 sfWaLink.innerHTML = '<i class="fa-solid fa-comments"></i> Message Seller';
 sfWaLink.className = 'btn btn-primary btn-sm';
 sfWaLink.onclick = (e) => {
 e.preventDefault();
 e.stopPropagation();
  openConversation(sellerId, storeLabel);
 };
 }

 const { data: prods } = await db.from('products').select('*').eq('seller_id', sellerId).eq('status','active');
  const sfProds = (prods || []).map(product => ({ ...product, profiles: seller }));
 document.getElementById('sf-prod-count').textContent = sfProds.length;
 // Real order count
 const { count: orderCount } = await db.from('orders').select('id', { count: 'exact', head: true }).eq('seller_id', sellerId);
 document.getElementById('sf-sales-count').textContent = (orderCount||0) + '+';
 // Reviews
 const { data: revs } = await db.from('reviews').select('rating').in('product_id', sfProds.map(p=>p.id));
 const allRevs = revs || [];
 const avgRating = allRevs.length ? (allRevs.reduce((s,r)=>s+r.rating,0)/allRevs.length).toFixed(1) : '5.0';
 document.getElementById('sf-rating').textContent = avgRating;
 document.getElementById('sf-review-count').textContent = `${allRevs.length} reviews`;
 document.getElementById('sf-stars').textContent = starText(avgRating);
 // Share button URL
// Share button URL setup
 const sfUrl = `${window.location.origin}${window.location.pathname}?store=${sellerId}`;
 const sfWaButtonElement = document.getElementById('sf-wa-link');
  if (sfWaButtonElement && sfWaButtonElement.parentElement) {
  sfWaButtonElement.parentElement.querySelectorAll('button').forEach(b => {
  if (b.textContent.includes('Share')) b.onclick = () => { navigator.clipboard?.writeText(sfUrl).then(()=>toast('Store Link Copied!','','success')).catch(()=>{}); if(navigator.share) navigator.share({title:storeLabel,url:sfUrl}); };
  });
  }
 const grid = document.getElementById('sf-products-grid');
 const empty = document.getElementById('sf-empty');
 if (!sfProds.length) { grid.innerHTML=''; empty.classList.remove('hidden'); }
 else { empty.classList.add('hidden'); grid.innerHTML = sfProds.map(p=>prodCard(p)).join(''); }
 // Update page title
  document.title = `${storeLabel} - BUYSELL Nigeria`;
 history.pushState(null,'',`?store=${sellerId}`);
}

// ====================================================
// UTIL
// ====================================================

function missingColumn(error) {
 if (!error) return "";
 const text = `${error.message || ""} ${error.details || ""} ${error.hint || ""}`;
 const quoted =
 text.match(/find the '([^']+)' column/i) ||
 text.match(/'([^']+)' column/i) ||
 text.match(/column "([^"]+)"/i);
 return quoted ? quoted[1] : "";
}

function fmtN(n) { return '\u20A6' + fmtNum(n); }
function fmtNum(n) { if (!n && n!==0) return '0'; return Math.round(n).toLocaleString('en-NG'); }
function fmtDate(d) { if (!d) return ''; return new Date(d).toLocaleDateString('en-NG',{day:'numeric',month:'short',year:'numeric'}); }
function starValue(rating = 5) {
 return Math.max(0, Math.min(5, Math.round(Number(rating) || 0)));
}
function starText(rating = 5) {
 const value = starValue(rating);
 return '\u2605'.repeat(value) + '\u2606'.repeat(5 - value);
}
function starIcons(rating = 5) {
 const value = starValue(rating);
 return '<i class="fa-solid fa-star"></i>'.repeat(value) + '<i class="fa-regular fa-star"></i>'.repeat(5 - value);
}
function escHtml(s) {
 return String(s||'')
 .replace(/&/g,'&amp;')
 .replace(/</g,'&lt;')
 .replace(/>/g,'&gt;')
 .replace(/"/g,'&quot;')
 .replace(/'/g,'&#x27;')
 .replace(/\//g,'&#x2F;');
}
function escAttr(s) {
 // Safe for use inside HTML attributes
 return String(s||'').replace(/[^a-zA-Z0-9 _\-\.,:@]/g, c => '&#'+c.charCodeAt(0)+';');
}
function sanitizeUrl(url) {
 if (!url) return '';
 const rawUrl = String(url).trim();
 if (/^obzhlmzswthnorkiqemh\.supabase\.co\//i.test(rawUrl)) {
 return `https://${rawUrl}`;
 }
 const u = rawUrl.toLowerCase();
 if (u.startsWith('javascript:') || u.startsWith('data:text') || u.startsWith('vbscript:')) return '';
 return rawUrl;
}

// ====================================================
// SECURITY PLUG: PURGE PAYLOAD NULLS
// ====================================================
function purgePayloadNulls(obj) {
 if (typeof obj !== 'object' || obj === null) return obj;
 
 const clean = { ...obj };
 Object.keys(clean).forEach(key => {
 // Convert empty frontend fields to clean database null objects
 if (clean[key] === '' || clean[key] === undefined) {
 clean[key] = null;
 }
 });
 return clean;
}

let pickupMap = null;
let currentMode = 'home';
let currentMarkers = []; // Keeps track of active pins so we can delete them when the state changes

function setDeliveryMode(mode) {
 currentMode = mode;
 const isPickup = mode === 'pickup';
 
 // Toggle UI
 document.getElementById('pickup-container').classList.toggle('hidden', !isPickup);
 document.getElementById('btn-pickup').className = isPickup ? 'btn btn-primary btn-sm flex-1' : 'btn btn-outline btn-sm flex-1';
 document.getElementById('btn-home').className = !isPickup ? 'btn btn-primary btn-sm flex-1' : 'btn btn-outline btn-sm flex-1';
 
 // Clear inputs if switching back to home delivery
 if (!isPickup) {
 document.getElementById('selected-hub-input').value = '';
 document.getElementById('co-address').value = '';
 }
 
 document.getElementById('addr-label').textContent = isPickup ? "Pickup Instructions" : "Delivery Address";
 document.getElementById('co-address').placeholder = isPickup ? "e.g. I will be there by 4pm" : "Street, area, city, state";

 if (isPickup) {
 initLeaflet();
 }
}

function initLeaflet() {
 // Always give the browser a moment to render the modal container
 setTimeout(() => {
 if (!pickupMap) {
 // Initialize map centered on Nigeria
 pickupMap = L.map('map').setView([9.0820, 8.6753], 6); 
 L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
 attribution: ' OpenStreetMap'
 }).addTo(pickupMap);
 }
 
 pickupMap.invalidateSize(); // Fixes the gray-box modal rendering bug
 
 // Load the hubs for whichever state is currently selected in the dropdown
 const initialState = document.getElementById('state-selector').value;
 loadHubsForState(initialState);
 
 }, 300);
}

// NEW: Dynamic Supabase Fetcher
async function loadHubsForState(stateName) {
 // 1. Clear old pins from the map
 currentMarkers.forEach(marker => pickupMap.removeLayer(marker));
 currentMarkers = [];
 
 document.getElementById('selected-hub-input').placeholder = "Fetching secure hubs...";
 document.getElementById('selected-hub-input').value = ""; // Reset selection

 try {
 // 2. Fetch live data from Supabase
 const { data, error } = await db
 .from('safe_hubs')
 .select('*')
 .eq('state', stateName)
 .eq('is_active', true);

 if (error) throw error;

 if (data && data.length > 0) {
 const bounds = []; // Used to auto-zoom the map perfectly

 data.forEach(hub => {
 const marker = L.marker([hub.latitude, hub.longitude]).addTo(pickupMap);
 marker.bindPopup(`<b class="hub-label">${hub.name}</b><br>${hub.info}`);
 
 marker.on('click', () => {
 document.getElementById('selected-hub-input').value = hub.name;
 document.getElementById('co-address').value = `VERIFIED HUB: ${hub.name} (${hub.info})`;
 toast('Hub Selected', hub.name, 'success');
 });

 currentMarkers.push(marker);
 bounds.push([hub.latitude, hub.longitude]);
 });

 // 3. Auto-zoom map to fit all the new pins perfectly
 pickupMap.fitBounds(bounds, { padding: [30, 30], maxZoom: 14 });
 document.getElementById('selected-hub-input').placeholder = "Click a pin on the map";
 
 } else {
 document.getElementById('selected-hub-input').placeholder = "No verified hubs in this state yet.";
 }
 } catch (err) {
 console.error("Error fetching hubs:", err);
 toast('Map Error', 'Could not load safe hubs. Check your connection.', 'error');
 }
}
// Share product from detail modal
function shareCurrentProduct() {
 if (currentProd) shareProduct(currentProd);
}

// ====================================================
// INIT
// ====================================================
// ====================================================
// UNIFIED SINGLE-PAGE RUNTIME INITIALIZATION
// ====================================================
// ====================================================
// UNIFIED SINGLE-PAGE RUNTIME INITIALIZATION
// ====================================================
// ====================================================
// UNIFIED SINGLE-PAGE RUNTIME INITIALIZATION
// ====================================================
(async function init() {
 console.log(" Launching single-page application lifecycle...");
 
 const savedLogo = appStorage.getItem('buysell_custom_logo');
 if (savedLogo) applySiteLogo(savedLogo);

 if (typeof updateCartCount === 'function') updateCartCount();
 if (typeof updateWishlistCount === 'function') updateWishlistCount();
 if (typeof handleDeepLink === 'function') handleDeepLink();
 if (typeof checkBroadcastForUser === 'function') checkBroadcastForUser();

 // Real-time order updates for sellers
 db.channel('orders-rt').on('postgres_changes', { 
 event: 'INSERT', 
 schema: 'public', 
 table: 'orders' 
 }, payload => {
 if (currentRole === 'seller' && payload.new?.seller_id === currentUser?.id) {
 toast('New Order! ', 'Check your orders panel', 'success', 6000);
 if (typeof loadSellerOrders === 'function') loadSellerOrders();
 if (typeof loadSellerStats === 'function') loadSellerStats();
 }
 }).subscribe();

 // Real-time low stock alerts
 db.channel('stock-rt').on('postgres_changes', { 
 event: 'UPDATE', 
 schema: 'public', 
 table: 'products' 
 }, payload => {
 const p = payload.new;
 const isTargetMerchant = currentRole === 'seller' && p?.seller_id === currentUser?.id;
 
 if (isTargetMerchant && p?.stock_quantity !== undefined && p?.low_stock_alert) {
 if (p.stock_quantity <= p.low_stock_alert && p.stock_quantity > 0) {
 toast(`Warning Low Stock: ${p.name}`, `Only ${p.stock_quantity} left inside inventory`, 'warn', 7000);
 }
 }
 }).subscribe();
})(); // ' This explicitly shuts down the self-invoking function thread cleanly.
// --- PHASE 1-4 INJECTIONS ---
function validateInput(str) {
 if (typeof str !== 'string') return '';
 
 // EXCLUSION GUARD: Target actual dangerous HTML tag injections, ignore generic words
 const malformedTagInjection = /<script.*?>.*?<\/script>|<[^>]+on\w+\s*=\s*["'][^"]*["']/i;
 if (malformedTagInjection.test(str)) {
 toast('Security Notice', 'Invalid markdown tags blocked.', 'error');
 throw new Error("HTML markup characters excluded from database capture pipelines.");
 }
 return str.trim();
}

function showAdminPortal() {
 // Admin uses the seller dashboard with the admin tab active
 // (The ds-admin section contains all admin tabs and is gated by guardAdminPanel)
 showSellerDashboard();
 // After render, switch to the admin section
 setTimeout(() => {
 showDash('admin');
 // Populate spd user info if relevant
 if (currentUser) {
 const dash = document.getElementById('dash-user-name');
 if (dash) dash.textContent = currentUser.profile?.name || 'Admin';
 }
 toast('" Admin Portal', 'Welcome back, Commander', 'info', 4000);
 }, 80);
}

function showServiceDashboard() {
 if (!currentUser) { showModal('auth-modal'); toggleAuth('login'); return; }
 ['buyer-view', 'seller-dashboard', 'storefront-view'].forEach(id => {
 const view = document.getElementById(id);
 if (!view) return;
 view.classList.add('hidden');
 view.style.display = 'none';
 });

 const serviceView = document.getElementById('service-provider-view');
 if (serviceView) {
 serviceView.classList.remove('hidden');
 serviceView.style.display = 'block';
 }
 document.body.classList.add('in-seller');
 currentRole = 'service_provider';

 // Populate user info in SPD sidebar
 const nameEl = document.getElementById('spd-user-name');
 const emailEl = document.getElementById('spd-user-email');
 if (nameEl) nameEl.textContent = currentUser.profile?.name || 'Service Pro';
 if (emailEl) emailEl.textContent = currentUser.email || '';

 // Load data and show default section
 showSpdDash('overview');
 loadMyGigs();
}

function copyReferralLink() {
 const link = document.getElementById('referral-link')?.value;
 if(!link) return;
 navigator.clipboard.writeText(link).then(() => {
 toast('Referral Link Copied! "-', 'Share it to start earning.', 'success');
 });
}

function importDropshipProduct(btn, productId) {
 // Security validation (Phase 4 mock)
 btn.innerHTML = '<span class="spin-anim"><i class="fa-solid fa-circle-notch"></i></span> Importing...';
 // Mock backend delay
 setTimeout(() => {
 btn.innerHTML = '<i class="fa-solid fa-check"></i> Imported';
 btn.classList.add('btn-imported');
 toast('Success', 'Product imported to your store!', 'success');
 }, 1200);
}


function showSpdDash(section) {
 // Hide all sections by adding .hidden class
 document.querySelectorAll('.spd-section').forEach(s => s.classList.add('hidden'));
 // Deactivate all nav items
 document.querySelectorAll('#spd-sidebar .dash-nav-item').forEach(n => n.classList.remove('active'));
 
 // Show target by removing .hidden class
 const el = document.getElementById(`spd-sec-${section}`);
 if (el) el.classList.remove('hidden');
 
 // Activate target nav
 const navEl = document.getElementById(`spd-nav-${section}`);
 if (navEl) navEl.classList.add('active');

 // Load section-specific data
 if (section === 'overview') loadSpdOverview();
 if (section === 'portfolio') loadMyGigs();
 if (section === 'settings') loadSpdSettings();
}

// ====================================================
// SERVICE ECONOMY - Browse & Filter (Buyer Side)
// ====================================================
let _allServiceGigs = [];

async function loadServiceGigs() {
 document.getElementById('svc-skeleton').classList.remove('hidden');
 document.getElementById('svc-grid').classList.add('hidden');
 document.getElementById('svc-empty').classList.add('hidden');

 try {
 const { data, error } = await db.from('service_gigs')
 .select('*, profiles(name, whatsapp)')
 .eq('status', 'active')
 .order('created_at', { ascending: false });
 if (error) throw error;
 _allServiceGigs = data || [];
 renderServiceCards(_allServiceGigs);
 } catch(e) {
 document.getElementById('svc-skeleton').classList.add('hidden');
 document.getElementById('svc-empty').classList.remove('hidden');
 }
}

function filterServices(category) {
 // Update active chip
 document.querySelectorAll('[data-svc]').forEach(c => {
 c.classList.toggle('active', c.dataset.svc === category);
 });
 if (category === 'all') {
 renderServiceCards(_allServiceGigs);
 } else {
 renderServiceCards(_allServiceGigs.filter(g => g.category === category));
 }
}

function renderServiceCards(gigs) {
 document.getElementById('svc-skeleton').classList.add('hidden');
 document.getElementById('svc-count').textContent = gigs.length;

 if (!gigs.length) {
 document.getElementById('svc-grid').classList.add('hidden');
 document.getElementById('svc-empty').classList.remove('hidden');
 return;
 }
 document.getElementById('svc-empty').classList.add('hidden');
 const grid = document.getElementById('svc-grid');
 grid.classList.remove('hidden');

 const categoryIcons = {
 'Plumbing': 'fa-faucet-drip', 'Electrical': 'fa-bolt', 'Cleaning': 'fa-broom',
 'Tailoring': 'fa-scissors', 'Carpentry': 'fa-hammer', 'Painting': 'fa-paint-roller',
 'Photography': 'fa-camera', 'Design': 'fa-pen-nib', 'Catering': 'fa-utensils', 'Other': 'fa-tools'
 };
 const categoryColors = {
 'Plumbing': '#3b82f6', 'Electrical': '#f59e0b', 'Cleaning': '#10b981',
 'Tailoring': '#8b5cf6', 'Carpentry': '#d97706', 'Painting': '#ec4899',
 'Photography': '#6366f1', 'Design': '#14b8a6', 'Catering': '#f43f5e', 'Other': '#6b7280'
 };

 grid.innerHTML = gigs.map(g => {
 const icon = categoryIcons[g.category] || 'fa-tools';
 const color = categoryColors[g.category] || 'var(--green)';
 const provName = g.profiles?.name || 'Service Pro';
 const wa = (g.whatsapp || g.profiles?.whatsapp || '').replace(/\D/g,'');
 const waLink = wa ? `https://wa.me/${wa}?text=Hi%20${encodeURIComponent(provName)}%2C%20I%20found%20you%20on%20BUYSELL%20and%20I'm%20interested%20in%20your%20service%3A%20${encodeURIComponent(g.title)}` : '#';
 const thumbImg = (g.portfolio_urls && g.portfolio_urls.length) ? g.portfolio_urls[0] : '';
 const thumbHtml = thumbImg ? `<img src="${thumbImg}" style="width:100%;height:120px;object-fit:cover">` : `<div style="height:120px;background:linear-gradient(135deg,${color}22,${color}08);display:flex;align-items:center;justify-content:center"><i class="fa-solid ${icon}" style="font-size:2rem;color:${color};opacity:.4"></i></div>`;
 return `
 <div class="card" style="overflow:hidden;transition:transform .2s,box-shadow .2s;cursor:default">
 ${thumbHtml}
 <div style="padding:1rem">
 <div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.5rem">
 <div style="width:32px;height:32px;border-radius:8px;background:${color}20;display:flex;align-items:center;justify-content:center;flex-shrink:0">
 <i class="fa-solid ${icon}" style="color:${color};font-size:.85rem"></i>
 </div>
 <div>
 <div style="font-weight:700;font-size:.88rem;line-height:1.3">${escHtml(g.title)}</div>
 <div style="font-size:.7rem;color:var(--text3)">${escHtml(g.category)} - ${escHtml(g.location || '-')}</div>
 </div>
 </div>
 <p style="font-size:.78rem;color:var(--text2);line-height:1.55;margin-bottom:.65rem;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${escHtml(g.description || 'No description provided.')}</p>
 <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.75rem">
 <div>
 <div style="font-size:.65rem;color:var(--text3);text-transform:uppercase;letter-spacing:.04em">Starting from</div>
 <div style="font-size:1.1rem;font-weight:800;color:var(--green)">${fmtN(g.starting_rate || g.price || 0)}</div>
 </div>
 <div style="display:flex;align-items:center;gap:.35rem">
 <div style="width:24px;height:24px;border-radius:50%;background:var(--green-xlt);display:flex;align-items:center;justify-content:center">
 <i class="fa-solid fa-user" style="font-size:.6rem;color:var(--green)"></i>
 </div>
 <span style="font-size:.75rem;font-weight:600">${escHtml(provName)}</span>
 </div>
 </div>
 <div style="display:flex;gap:.5rem">
 <button class="btn btn-outline btn-sm" style="flex:1" onclick="viewProviderProfile('${g.provider_id}')">
 <i class="fa-solid fa-user"></i> View Profile
 </button>
 <a href="${waLink}" target="_blank" class="btn btn-primary btn-sm" style="flex:1;text-decoration:none">
 <i class="fa-brands fa-whatsapp"></i> Contact
 </a>
 </div>
 </div>
 </div>`;
 }).join('');
}

// ====================================================
// SERVICE PROVIDER - Overview Stats
// ====================================================
async function loadSpdOverview() {
 if (!currentUser) return;
 try {
 // Load gig count
 const { data: gigs } = await db.from('service_gigs')
 .select('id, title, category, starting_rate, status, portfolio_urls')
 .eq('provider_id', currentUser.id);
 const activeGigs = (gigs || []).filter(g => g.status === 'active');
 
 document.getElementById('spd-gigs').textContent = activeGigs.length;
 // Views and leads are placeholders for now until analytics wired
 document.getElementById('spd-views').textContent = activeGigs.length * 12; // estimated
 document.getElementById('spd-leads').textContent = activeGigs.length > 0 ? Math.floor(activeGigs.length * 3) : 0;

 // Populate recent leads section with active gig summary cards
 const leadsContainer = document.querySelector('#spd-sec-overview .card.card-pad.mb-4');
 if (leadsContainer && activeGigs.length > 0) {
 leadsContainer.innerHTML = `
 <h3 class="mb-3"><i class="fa-solid fa-briefcase"></i> Your Active Services</h3>
 ${activeGigs.map(g => {
 const thumb = (g.portfolio_urls && g.portfolio_urls.length) ? g.portfolio_urls[0] : '';
 return `<div style="display:flex;align-items:center;gap:.75rem;padding:.6rem;background:var(--cream);border-radius:10px;border:1px solid var(--border);margin-bottom:.5rem">
 ${thumb ? `<img src="${thumb}" style="width:48px;height:48px;object-fit:cover;border-radius:8px;flex-shrink:0">` : `<div style="width:48px;height:48px;border-radius:8px;background:var(--green-xlt);display:flex;align-items:center;justify-content:center;flex-shrink:0"><i class="fa-solid fa-tools" style="color:var(--green)"></i></div>`}
 <div style="flex:1;min-width:0">
 <div style="font-weight:700;font-size:.85rem">${escHtml(g.title)}</div>
 <div style="font-size:.72rem;color:var(--text3)">${escHtml(g.category)} - ${fmtN(g.starting_rate||0)}</div>
 </div>
 <span class="badge ${g.status==='active'?'badge-green':'badge-red'}">${g.status}</span>
 </div>`;
 }).join('')}`;
 }
 } catch(e) { console.error('SPD overview error:', e); }
}

// ====================================================
// SERVICE PROVIDER - Settings
// ====================================================
async function loadSpdSettings() {
 if (!currentUser?.profile) return;
 const p = currentUser.profile;
 const nameEl = document.getElementById('spd-s-name');
 const waEl = document.getElementById('spd-s-wa');
 const bioEl = document.getElementById('spd-s-bio');
 if (nameEl) nameEl.value = p.name || '';
 if (waEl) waEl.value = p.whatsapp || '';
 if (bioEl) bioEl.value = p.store_description || '';
}

async function saveServiceProfile() {
 if (!currentUser) return;
 const name = document.getElementById('spd-s-name')?.value.trim();
 const wa = document.getElementById('spd-s-wa')?.value.trim();
 const bio = document.getElementById('spd-s-bio')?.value.trim();

 if (!name) { toast('Name required', '', 'warn'); return; }

 try {
 const { error } = await db.from('profiles').update({
 name: validateInput(name),
 whatsapp: wa,
 store_description: validateInput(bio)
 }).eq('id', currentUser.id);
 
 if (error) throw error;
 
 // Update local profile
 currentUser.profile.name = name;
 currentUser.profile.whatsapp = wa;
 currentUser.profile.store_description = bio;
 
 // Update sidebar display
 document.getElementById('spd-user-name').textContent = name;
 
 toast('Profile Saved! OK', 'Your changes are now live.', 'success');
 } catch(e) {
 toast('Save Failed', e.message, 'error');
 }
}

// ====================================================
// SERVICE PROVIDER - Load My Gigs (Portfolio)
// ====================================================
async function loadMyGigs() {
 if (!currentUser) return;
 try {
 const { data } = await db.from('service_gigs')
 .select('*')
 .eq('provider_id', currentUser.id)
 .order('created_at', { ascending: false });
 const gigs = data || [];
 const countEl = document.getElementById('spd-gigs');
 if (countEl) countEl.textContent = gigs.filter(g => g.status === 'active').length;
 const listEl = document.getElementById('spd-gigs-list');
 if (!listEl) return;
 if (!gigs.length) {
 listEl.innerHTML = '<div class="empty-state"><i class="fa-solid fa-folder-open" style="font-size:2rem;color:var(--border2);display:block;margin-bottom:.65rem"></i><p class="color-text3 text-sm">Your portfolio is empty. Post your first service above!</p></div>';
 return;
 }
 listEl.innerHTML = gigs.map(g => {
 const thumb = (g.portfolio_urls && g.portfolio_urls.length) ? g.portfolio_urls[0] : '';
 const imgCount = (g.portfolio_urls || []).length;
 return `
 <div class="card mb-3" style="overflow:hidden;border-left:3px solid ${g.status==='active'?'var(--green)':'var(--red)'}">
 <div style="display:flex;gap:.75rem;padding:1rem">
 ${thumb 
 ? `<img src="${thumb}" style="width:72px;height:72px;object-fit:cover;border-radius:10px;flex-shrink:0">`
 : `<div style="width:72px;height:72px;border-radius:10px;background:var(--green-xlt);display:flex;align-items:center;justify-content:center;flex-shrink:0"><i class="fa-solid fa-tools" style="color:var(--green);font-size:1.3rem"></i></div>`
 }
 <div style="flex:1;min-width:0">
 <div style="display:flex;justify-content:space-between;align-items:start;gap:.5rem">
 <div>
 <div style="font-weight:700;font-size:.92rem">${escHtml(g.title)}</div>
 <div style="font-size:.72rem;color:var(--text3);margin-top:.15rem">${escHtml(g.category)} - ${escHtml(g.location || '-')}</div>
 </div>
 <span class="badge ${g.status==='active'?'badge-green':'badge-red'}">${g.status}</span>
 </div>
 <p style="font-size:.78rem;color:var(--text2);margin-top:.4rem;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;line-height:1.45">${escHtml(g.description || 'No description')}</p>
 <div style="display:flex;align-items:center;justify-content:space-between;margin-top:.6rem">
 <div style="display:flex;align-items:center;gap:.75rem">
 <span style="font-weight:800;color:var(--green);font-size:.95rem">${fmtN(g.starting_rate||0)}</span>
 ${imgCount > 0 ? `<span style="font-size:.7rem;color:var(--text3)"><i class="fa-solid fa-images"></i> ${imgCount} photo${imgCount>1?'s':''}</span>` : ''}
 </div>
 <button class="btn btn-ghost btn-sm" style="color:var(--red);font-size:.72rem" onclick="deleteGig('${g.id}')">
 <i class="fa-solid fa-trash"></i> Delete
 </button>
 </div>
 </div>
 </div>
 </div>`;
 }).join('');
 } catch(e) { console.error('loadMyGigs error:', e); }
}

async function deleteGig(gigId) {
 if (!confirm('Delete this gig? This cannot be undone.')) return;
 try {
 const { error } = await db.from('service_gigs').delete().eq('id', gigId).eq('provider_id', currentUser.id);
 if (error) throw error;
 toast('Gig Deleted', '', 'success');
 loadMyGigs();
 loadSpdOverview();
 } catch(e) {
 toast('Delete Failed', e.message, 'error');
 }
}

// ====================================================
// SERVICE PROVIDER - Publish Gig (with Image Upload)
// ====================================================
async function publishServiceGig() {
 if (!currentUser) { showModal('auth-modal'); return; }
 const title = document.getElementById('spd-title')?.value.trim();
 const category = document.getElementById('spd-category')?.value;
 const rate = parseFloat(document.getElementById('spd-rate')?.value) || 0;
 const location = document.getElementById('spd-location')?.value.trim();
 const desc = document.getElementById('spd-desc')?.value.trim();
 const wa = document.getElementById('spd-wa')?.value.trim();
 const imgInput = document.getElementById('spd-images');
 const files = imgInput?.files ? Array.from(imgInput.files).slice(0, 4) : [];

 if (!title || !rate || !location || !desc || !wa) {
 toast('Please fill all fields', '', 'warn'); return;
 }

 try {
 toast('Publishing...', 'Uploading your gig', 'info', 3000);

 // Upload portfolio images
 let imageUrls = [];
 for (const file of files) {
 const ext = file.name.split('.').pop().toLowerCase().replace(/[^a-z0-9]/g,'');
 const path = `gigs/${currentUser.id}/${Date.now()}_${Math.random().toString(36).substr(2,5)}.${ext}`;
 const { data, error: upErr } = await db.storage.from('uploads').upload(path, file, { upsert: false });
 if (!upErr && data) {
 const { data: urlData } = db.storage.from('uploads').getPublicUrl(data.path);
 if (urlData?.publicUrl) imageUrls.push(urlData.publicUrl);
 }
 }

 const { error } = await db.from('service_gigs').insert({
 provider_id: currentUser.id,
 title: validateInput(title),
 category,
 starting_rate: rate,
 location: validateInput(location),
 description: validateInput(desc),
 whatsapp: wa,
 portfolio_urls: imageUrls,
 status: 'active',
 created_at: new Date().toISOString()
 });
 if (error) throw error;

 toast('Service Published! ', 'Your gig is now live on BUYSELL', 'success');
 ['spd-title','spd-rate','spd-location','spd-desc','spd-wa'].forEach(id => {
 const el = document.getElementById(id); if (el) el.value = '';
 });
 if (imgInput) imgInput.value = '';
 document.getElementById('spd-img-preview').innerHTML = '';
 const gigsEl = document.getElementById('spd-gigs');
 if (gigsEl) gigsEl.textContent = parseInt(gigsEl.textContent || '0') + 1;
 loadMyGigs();
 } catch(e) {
 toast('Publish Failed', e.message, 'error');
 }
}

// ====================================================
// SERVICE PROVIDER - Image Preview
// ====================================================
document.addEventListener('DOMContentLoaded', () => {
 const imgInput = document.getElementById('spd-images');
 if (imgInput) {
 imgInput.addEventListener('change', () => {
 const preview = document.getElementById('spd-img-preview');
 preview.innerHTML = '';
 const files = Array.from(imgInput.files).slice(0, 4);
 files.forEach(f => {
 const reader = new FileReader();
 reader.onload = e => {
 preview.innerHTML += `<img src="${e.target.result}" style="width:72px;height:72px;object-fit:cover;border-radius:8px;border:2px solid var(--border)">`;
 };
 reader.readAsDataURL(f);
 });
 if (imgInput.files.length > 4) toast('Max 4 images', 'Only the first 4 will be uploaded', 'warn');
 });
 }
});

// ====================================================
// VIEW PROVIDER PROFILE (Buyer Side)
// ====================================================
async function viewProviderProfile(providerId) {
 showModal('sp-profile-modal');

 try {
 const { data: provider } = await db.from('profiles').select('*').eq('id', providerId).single();
 const { data: gigs } = await db.from('service_gigs').select('*').eq('provider_id', providerId).eq('status', 'active').order('created_at', { ascending: false });

 const name = provider?.name || 'Service Pro';
 const wa = (provider?.whatsapp || '').replace(/\D/g, '');
 const allGigs = gigs || [];
 const mainGig = allGigs[0];

 document.getElementById('sp-p-name').textContent = name;
 document.getElementById('sp-p-category').innerHTML = '<i class="fa-solid fa-tag"></i> ' + (mainGig?.category || 'General');
 document.getElementById('sp-p-location').innerHTML = '<i class="fa-solid fa-map-pin"></i> ' + (mainGig?.location || 'Nigeria');
 document.getElementById('sp-p-gig-count').textContent = allGigs.length;
 document.getElementById('sp-p-bio').textContent = provider?.store_description || mainGig?.description || 'No bio available.';

 // Services & Pricing
 const svcList = document.getElementById('sp-p-services-list');
 svcList.innerHTML = allGigs.length
 ? allGigs.map(g => `<div style="display:flex;align-items:center;justify-content:space-between;padding:.65rem .85rem;background:var(--cream);border-radius:10px;border:1px solid var(--border)"><div><div style="font-weight:600;font-size:.85rem">${escHtml(g.title)}</div><div style="font-size:.72rem;color:var(--text3)">${escHtml(g.category)}</div></div><div style="font-weight:800;color:var(--green);font-size:.95rem">\u20A6${(g.starting_rate||g.price||0).toLocaleString()}</div></div>`).join('')
 : '<p class="color-text3 text-sm">No services listed.</p>';

 // Portfolio Gallery
 const allImages = allGigs.flatMap(g => g.portfolio_urls || []);
 const gallery = document.getElementById('sp-p-gallery');
 gallery.innerHTML = allImages.length
 ? allImages.map(url => `<img src="${url}" style="width:100%;aspect-ratio:1;object-fit:cover;cursor:pointer;border-radius:6px" onclick="window.open('${url}','_blank')">`).join('')
 : '<p class="color-text3 text-sm" style="grid-column:1/-1;text-align:center;padding:1rem">No portfolio images yet.</p>';

 // Reviews placeholder
 document.getElementById('sp-p-rating').textContent = '5.0';
 document.getElementById('sp-p-reviews-count').textContent = '0';
 document.getElementById('sp-p-reviews').innerHTML = '<p class="color-text3 text-sm">No reviews yet. Be the first to hire and review!</p>';

 // WhatsApp CTA
 document.getElementById('sp-p-wa-btn').href = wa
 ? `https://wa.me/${wa}?text=Hi%20${encodeURIComponent(name)}%2C%20I%20found%20you%20on%20BUYSELL%20and%20I'd%20like%20to%20hire%20you.`
 : '#';
 } catch(e) {
 console.error('Profile load error:', e);
 }
}

// ====================================================
// HELP MODAL
// ====================================================
function openHelpModal() { showModal('help-modal'); }

// ====================================================
// ADMIN KYC MANAGEMENT
// ====================================================
function getAdminKycElement(id) {
 return document.querySelector(`#admin-portal-view #${id}`) || document.getElementById(id);
}

async function loadAdminKyc() {
 if (!guardAdminPanel()) return;
 const skeleton = getAdminKycElement('adm-kyc-skeleton');
 const list = getAdminKycElement('adm-kyc-list');
 const empty = getAdminKycElement('adm-kyc-empty');
 skeleton?.classList.remove('hidden'); list?.classList.add('hidden'); empty?.classList.add('hidden');

 try {
 const filter = getAdminKycElement('adm-kyc-filter')?.value || 'pending';
 let query = db.from('kyc_verifications').select('*').order('created_at', { ascending: false });
 if (filter === 'pending') {
 query = query.in('status', ['pending', 'submitted', 'in_review', 'review']);
 } else if (filter !== 'all') {
 query = query.eq('status', filter);
 }
 const { data: rows, error } = await query;
 if (error) throw error;

 const userIds = [...new Set((rows || []).map(k => k.user_id).filter(Boolean))];
 const profileMap = new Map();
 if (userIds.length) {
 const { data: profiles, error: profileError } = await db
 .from('profiles')
 .select('id,name,email,whatsapp')
 .in('id', userIds);
 if (profileError) console.warn('KYC profile lookup failed:', profileError);
 (profiles || []).forEach(profile => profileMap.set(profile.id, profile));
 }

 skeleton?.classList.add('hidden');
 if (!rows || !rows.length) { empty?.classList.remove('hidden'); return; }
 list?.classList.remove('hidden');
 list.style.display = 'flex';

 list.innerHTML = rows.map(k => {
 const profile = profileMap.get(k.user_id) || {};
 const isPending = k.status === 'pending';
 const statusBadge = k.status === 'approved' ? '<span class="badge badge-green">Approved</span>'
 : k.status === 'rejected' ? '<span class="badge badge-red">Rejected</span>'
 : '<span class="badge badge-gold">Pending</span>';
 return `
 <div class="card card-pad">
 <div class="flex justify-between items-start gap-2 flex-wrap mb-2">
 <div>
 <div class="font-bold">${escHtml(profile.name || 'Unknown')}</div>
 <div class="text-xs color-text3">${escHtml(profile.email || '')}</div>
 </div>
 <div class="flex items-center gap-2">${statusBadge}<span class="text-xs color-text3">${fmtDate(k.created_at)}</span></div>
 </div>
 <div class="flex gap-2 flex-wrap mb-2 text-xs">
 <span class="badge badge-outline">${escHtml(k.doc_type || k.document_type || 'N/A')}</span>
 <span class="color-text3">Doc #: <b>${escHtml(k.doc_number || k.document_number || 'N/A')}</b></span>
 <span class="color-text3">Name on ID: <b>${escHtml(k.full_name || k.legal_name || 'N/A')}</b></span>
 </div>
 <div class="flex gap-2 flex-wrap mb-3">
 ${k.front_url ? `<a href="${k.front_url}" target="_blank" class="btn btn-ghost btn-sm" style="color:var(--blue)"><i class="fa-solid fa-image"></i> Front</a>` : ''}
 ${k.back_url ? `<a href="${k.back_url}" target="_blank" class="btn btn-ghost btn-sm" style="color:var(--blue)"><i class="fa-solid fa-image"></i> Back</a>` : ''}
 ${k.selfie_url ? `<a href="${k.selfie_url}" target="_blank" class="btn btn-ghost btn-sm" style="color:var(--blue)"><i class="fa-solid fa-user"></i> Selfie</a>` : ''}
 </div>
 ${isPending ? `<div class="flex gap-2">
 <button class="btn btn-primary btn-sm" onclick="adminApproveKyc('${k.id}','${k.user_id}')"><i class="fa-solid fa-check"></i> Approve</button>
 <button class="btn btn-outline btn-sm" style="color:var(--red);border-color:var(--red)" onclick="adminRejectKyc('${k.id}','${k.user_id}')"><i class="fa-solid fa-times"></i> Reject</button>
 </div>` : (k.admin_note ? `<div class="text-xs color-text3"><b>Note:</b> ${escHtml(k.admin_note)}</div>` : '')}
 </div>`;
 }).join('');
 } catch(e) {
 skeleton?.classList.add('hidden');
 if (list) list.innerHTML = `<div class="text-center color-danger p-3">Error: ${escHtml(e.message || 'Could not load KYC submissions')}</div>`;
 list?.classList.remove('hidden');
 }
}

async function adminApproveKyc(kycId, userId) {
 if (!confirm('Approve this KYC submission?')) return;
 try {
 try {
 await callEdge('admin-action', { action: 'approve_kyc', target_id: kycId, data: { user_id: userId } });
 } catch (edgeError) {
 console.warn('approve_kyc function failed, using scoped update:', edgeError);
 await updateWithMissingColumnRetry('kyc_verifications', {
 status: 'approved',
 reviewed_at: new Date().toISOString(),
 }, { id: kycId });
 await updateWithMissingColumnRetry('profiles', {
 kyc_status: 'approved',
 verification_status: 'verified',
 seller_verified: true,
 }, { id: userId });
 }
 toast('KYC Approved OK', 'Seller is now verified.', 'success');
 loadAdminKyc();
 } catch(e) { toast('Error', e.message, 'error'); }
}

async function adminRejectKyc(kycId, userId) {
 const reason = prompt('Reason for rejection (optional):') || '';
 try {
 try {
 await callEdge('admin-action', { action: 'reject_kyc', target_id: kycId, data: { user_id: userId, reason } });
 } catch (edgeError) {
 console.warn('reject_kyc function failed, using scoped update:', edgeError);
 await updateWithMissingColumnRetry('kyc_verifications', {
 status: 'rejected',
 admin_note: reason,
 reviewed_at: new Date().toISOString(),
 }, { id: kycId });
 await updateWithMissingColumnRetry('profiles', {
 kyc_status: 'rejected',
 verification_status: 'rejected',
 seller_verified: false,
 }, { id: userId });
 }
 toast('KYC Rejected', 'Seller has been notified.', 'info');
 loadAdminKyc();
 } catch(e) { toast('Error', e.message, 'error'); }
}

// ====================================================
// SELLER KYC SUBMISSION
// ====================================================
async function submitKycLegacy(event) {
 event.preventDefault();
 if (!currentUser) { showModal('auth-modal'); return; }
 const btn = document.getElementById('kyc-submit-btn');
 btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Submitting...';

 try {
 const docType = document.getElementById('kyc-doc-type').value;
 const docNum = document.getElementById('kyc-doc-number').value.trim();
 const fullName = document.getElementById('kyc-full-name').value.trim();
 const frontFile = document.getElementById('kyc-front').files[0];
 const backFile = document.getElementById('kyc-back').files?.[0];
 const selfieFile = document.getElementById('kyc-selfie').files[0];

 if (!docType || !docNum || !fullName || !frontFile || !selfieFile) {
 toast('Missing fields', 'Please fill all required fields', 'warn');
 btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-shield-check"></i> Submit Verification';
 return;
 }

 async function uploadKycFile(file, label) {
 const ext = file.name.split('.').pop();
 const path = `kyc/${currentUser.id}/${label}_${Date.now()}.${ext}`;
 const { error } = await db.storage.from('uploads').upload(path, file);
 if (error) throw new Error(`Upload ${label} failed`);
 const { data } = db.storage.from('uploads').getPublicUrl(path);
 return data.publicUrl;
 }

 const frontUrl = await uploadKycFile(frontFile, 'front');
 const backUrl = backFile ? await uploadKycFile(backFile, 'back') : null;
 const selfieUrl = await uploadKycFile(selfieFile, 'selfie');

 await db.from('kyc_verifications').insert({
 user_id: currentUser.id,
 doc_type: docType,
 document_type: docType,
 doc_number: docNum,
 document_number: docNum,
 full_name: fullName,
 legal_name: fullName,
 front_url: frontUrl,
 back_url: backUrl,
 selfie_url: selfieUrl,
 status: 'pending'
 });

 toast('KYC Submitted! ', 'Your documents are under review.', 'success');
 await db.from('profiles').update({ kyc_status: 'pending' }).eq('id', currentUser.id).then(() => {}).catch(() => {});
 currentUser.profile = { ...(currentUser.profile || {}), kyc_status: 'pending' };
 closeModal('kyc-modal');
 } catch(e) {
 toast('Submission Error', e.message, 'error');
 }
 btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-shield-check"></i> Submit Verification';
}

async function submitKyc(event) {
 event.preventDefault();
 if (!currentUser) { showModal('auth-modal'); return; }
 const btn = document.getElementById('kyc-submit-btn');
 btn.disabled = true;
 btn.innerHTML = '<span class="spinner"></span> Submitting...';

 try {
 const docType = document.getElementById('kyc-doc-type').value;
 const docNum = document.getElementById('kyc-doc-number').value.trim();
 const fullName = document.getElementById('kyc-full-name').value.trim();
 const frontFile = document.getElementById('kyc-front').files[0];
 const backFile = document.getElementById('kyc-back').files?.[0];
 const selfieFile = document.getElementById('kyc-selfie').files[0];

 if (!docType || !docNum || !fullName || !frontFile || !selfieFile) {
 toast('Missing fields', 'Please fill all required fields', 'warn');
 return;
 }

 const allowedTypes = ['image/jpeg', 'image/jpg', 'image/pjpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/jfif', 'image/avif'];
 const allowedExts = ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif', 'jfif', 'avif'];
 const maxSize = 10 * 1024 * 1024;
 function validateKycFile(file, label) {
 const rawName = file?.name || '';
 const ext = rawName.includes('.') ? rawName.split('.').pop().toLowerCase().replace(/[^a-z0-9]/g, '') : '';
 const looksLikeImage = file?.type?.startsWith('image/') || allowedTypes.includes(file?.type) || allowedExts.includes(ext);
 if (!looksLikeImage) throw new Error(`${label} must be an image file.`);
 if (file.size > maxSize) throw new Error(`${label} must be 10MB or smaller.`);
 return allowedExts.includes(ext) ? ext : 'jpg';
 }

 async function uploadKycFile(file, label) {
 const ext = validateKycFile(file, label);
 const path = `kyc/${currentUser.id}/${label}_${Date.now()}.${ext}`;
 const uploaded = await uploadToFirstAvailableBucket(['kyc', 'uploads', 'products'], path, file, {
 contentType: file.type || undefined,
 upsert: false,
 });
 return uploaded.publicUrl;
 }

 const frontUrl = await uploadKycFile(frontFile, 'front');
 const backUrl = backFile ? await uploadKycFile(backFile, 'back') : null;
 const selfieUrl = await uploadKycFile(selfieFile, 'selfie');

 await insertWithMissingColumnRetry('kyc_verifications', {
 user_id: currentUser.id,
 doc_type: docType,
 document_type: docType,
 doc_number: docNum,
 document_number: docNum,
 full_name: fullName,
 legal_name: fullName,
 front_url: frontUrl,
 back_url: backUrl,
 selfie_url: selfieUrl,
 status: 'pending',
 created_at: new Date().toISOString(),
 }, false);

 await updateWithMissingColumnRetry('profiles', {
 kyc_status: 'pending',
 verification_status: 'pending',
 seller_verified: false,
 }, { id: currentUser.id });
 currentUser.profile = { ...(currentUser.profile || {}), kyc_status: 'pending' };

 let autoKycResult = null;
 try {
 autoKycResult = await callEdge('auto-verify-kyc', {});
 currentUser.profile = {
 ...(currentUser.profile || {}),
 kyc_status: autoKycResult.status || currentUser.profile?.kyc_status || 'pending',
 verification_status: autoKycResult.verified ? 'verified' : 'pending',
 seller_verified: !!autoKycResult.verified,
 };
 } catch (autoError) {
 console.warn('Automatic KYC verification unavailable:', autoError);
 }

 document.getElementById('kyc-form')?.reset();
 document.getElementById('kyc-front-label').textContent = 'Tap to upload front of ID';
 document.getElementById('kyc-back-label').textContent = 'Tap to upload back of ID';
 const selfieLabel = document.getElementById('kyc-selfie-label');
 if (selfieLabel) selfieLabel.textContent = 'Take a selfie holding your ID next to your face';
 closeModal('kyc-modal');
 if (autoKycResult?.verified) {
 toast('KYC Verified!', 'Your seller account is now verified.', 'success');
 } else {
 toast('KYC Submitted!', 'Seller dashboard access is now open while verification is reviewed.', 'success');
 }
 await showSellerDashboard();
 } catch(e) {
 toast('Submission Error', e.message, 'error');
 } finally {
 btn.disabled = false;
 btn.innerHTML = '<i class="fa-solid fa-shield-check"></i> Submit Verification';
 }
}

// ====================================================
// ADMIN REPORT EXPORT
// ====================================================
async function exportAdminReport() {
 if (!guardAdminPanel()) return;
 toast('Generating...', 'Preparing your CSV report', 'info');
 try {
 const [{ data: sellers }, { data: orders }] = await Promise.all([
 db.from('profiles').select('*').eq('role', 'seller'),
 db.from('orders').select('*').order('created_at', { ascending: false }).limit(500)
 ]);

 let csv = 'Section,ID,Name,Email,Role,Free Access,Access Expiry,Created\n';
 (sellers || []).forEach(s => {
 csv += `Seller,${s.id},${escHtml(s.name||'')},${s.email||''},${s.role},${s.commission_paid},${s.trial_end||''},${s.created_at}\n`;
 });
 csv += '\nSection,Order ID,Buyer,Status,Total,Payment Method,Created\n';
 (orders || []).forEach(o => {
 csv += `Order,${o.id},${o.buyer_id},${o.status},${o.total||0},${o.payment_method||''},${o.created_at}\n`;
 });

 const blob = new Blob([csv], { type: 'text/csv' });
 const url = URL.createObjectURL(blob);
 const a = document.createElement('a');
 a.href = url; a.download = `buysell_report_${new Date().toISOString().slice(0,10)}.csv`;
 a.click(); URL.revokeObjectURL(url);
 toast('Report Downloaded OK', '', 'success');
 } catch(e) { toast('Export Error', e.message, 'error'); }
}

// ====================================================
// PWA INSTALL BAR
// ====================================================
function dismissInstallBar() {
 document.getElementById('pwa-banner')?.classList.remove('show');
}

// ====================================================
// WISHLIST
// ====================================================

function saveWishlist() {
 appStorage.setItem('bs_wishlist', JSON.stringify(wishlist));
 updateWishlistCount();
}

function updateWishlistCount() {
 const countEl = document.getElementById('wishlist-count');
 if (!countEl) return;
 countEl.textContent = wishlist.length;
 countEl.classList.toggle('hidden', wishlist.length === 0);
}

function updateModalWishBtn() {
 const btn = document.getElementById('modal-wishlist-btn');
 const productId = currentProd?.id;
 if (!btn || !productId) return;
 const saved = wishlist.includes(productId);
 btn.innerHTML = saved
 ? '<i class="fa-solid fa-heart" style="color:#ef4444"></i>'
 : '<i class="fa-regular fa-heart"></i>';
 btn.setAttribute('aria-label', saved ? 'Remove from wishlist' : 'Save to wishlist');
}

function toggleWishlist(productId, event) {
 if (event) event.stopPropagation(); // Prevents opening product modal if clicked on a card
 
 const idx = wishlist.indexOf(productId);
 if (idx > -1) {
 wishlist.splice(idx, 1);
 toast('Removed', 'Removed from wishlist', 'info');
 } else {
 wishlist.push(productId);
 toast('Added ', 'Saved to wishlist', 'success');
 }
 
 saveWishlist();
 updateModalWishBtn(); // Update modal heart if open
 
 // Refresh wishlist list if modal is open
 if (document.getElementById('wishlist-modal').classList.contains('open')) {
 showWishlistModal();
 }
}

async function showWishlistModal() {
 showModal('wishlist-modal');
 const container = document.getElementById('wishlist-items');
 if (!wishlist.length) {
 container.innerHTML = '<p class="text-center color-text3 p-3">Your wishlist is empty.</p>';
 return;
 }
 
 container.innerHTML = '<div class="text-center p-3"><span class="spinner"></span></div>';
 
 try {
 const { data: items } = await db.from('products').select('*').in('id', wishlist);
 if (!items || !items.length) {
 container.innerHTML = '<p class="text-center color-text3 p-3">Products no longer available.</p>';
 return;
 }
 
 // --- FLASH SALE LOGIC ---
 const now = new Date();
 
 container.innerHTML = items.map(p => {
 const isFlashActive = p.flash_price && p.flash_end && new Date(p.flash_end) > now;
 const displayPrice = isFlashActive ? p.flash_price : p.price;
 
 // Prepare object for addToCart
 const cartItem = {
 id: p.id,
 name: p.name,
 price: displayPrice,
 image_url: p.image_url,
 seller_id: p.seller_id,
 profiles: p.profiles,
 is_flash: isFlashActive
 };

 return `
 <div class="wishlist-item" style="display:flex; gap:12px; align-items:center; padding:10px; border-bottom:1px solid var(--border)">
 <img src="${p.image_url || 'https://images.unsplash.com/photo-1607082348824-0a96f2a4b9da?w=100'}" style="width:60px; height:60px; border-radius:8px; object-fit:cover">
 <div style="flex:1">
 <div class="font-600 text-sm">${escHtml(p.name)}</div>
 <div class="color-green font-bold text-sm">
 ${isFlashActive ? `<span style="color:var(--red); font-size:0.7rem">Flash</span> ` : ''}
 \u20A6${fmtN(displayPrice)}
 </div>
 </div>
 <div style="display:flex; gap:5px">
 <button class="btn btn-outline btn-sm" onclick="addToCart(${JSON.stringify(cartItem).replace(/"/g,'&quot;')})">
 <i class="fa-solid fa-cart-plus"></i>
 </button>
 <button class="btn btn-ghost btn-sm" onclick="toggleWishlist('${p.id}')">
 <i class="fa-solid fa-trash" style="color:var(--danger)"></i>
 </button>
 </div>
 </div>
 `}).join('');
 } catch(e) {
 container.innerHTML = '<p class="text-center color-danger">Error loading wishlist</p>';
 }
}

// ====================================================
// COMPARE
// ====================================================
function saveCompare() {
 appStorage.setItem('bs_compare', JSON.stringify(compareList));
 const bar = document.getElementById('compare-bar');
 const countEl = document.getElementById('compare-count');
 if (bar) bar.classList.toggle('hidden', compareList.length === 0);
 if (countEl) countEl.textContent = compareList.length;
}

function clearCompare() { compareList = []; saveCompare(); }

async function showCompareModal() {
 if (compareList.length < 2) { toast('Add more', 'Select at least 2 products to compare', 'warn'); return; }
 showModal('compare-modal');
 const container = document.getElementById('compare-content');
 container.innerHTML = '<div class="text-center p-3"><span class="spinner"></span></div>';
 try {
 const { data: items } = await db.from('products').select('*').in('id', compareList.slice(0, 4));
 if (!items || items.length < 2) { container.innerHTML = '<p class="text-center color-text3">Could not load products.</p>'; return; }
 const fields = ['name','price','category','condition','location'];
 let html = '<table class="data-table" style="width:100%"><thead><tr><th>Feature</th>';
 items.forEach(p => { html += `<th style="min-width:140px">${escHtml(p.name)}</th>`; });
 html += '</tr></thead><tbody>';
 fields.forEach(f => {
 html += `<tr><td class="font-bold text-xs">${f.charAt(0).toUpperCase()+f.slice(1)}</td>`;
 items.forEach(p => { html += `<td class="text-sm">${f==='price' ? fmtN(p[f]) : escHtml(String(p[f]||'N/A'))}</td>`; });
 html += '</tr>';
 });
 html += '</tbody></table>';
 container.innerHTML = html;
 } catch(e) { container.innerHTML = '<p class="text-center color-danger">Error</p>'; }
}

// ====================================================
// MESSAGING
// ====================================================
let currentChatPartner = null;
let currentChatProductId = null;
let messageChannel = null;
let pendingMessageImage = null;

function extractMessageImageUrl(message = {}) {
 const direct = message.image_url || message.attachment_url || message.media_url || message.file_url;
 if (direct) return sanitizeUrl(direct);
 const meta = typeof message.metadata === 'string'
 ? (() => { try { return JSON.parse(message.metadata); } catch { return {}; } })()
 : (message.metadata || {});
 const metaUrl = meta.image_url || meta.attachment_url || meta.media_url || meta.url;
 if (metaUrl) return sanitizeUrl(metaUrl);
 const content = String(message.content || '');
 const match = content.match(/https?:\/\/[^\s]+?\.(?:jpg|jpeg|png|webp|gif|avif|heic|heif)(?:\?[^\s]*)?/i);
 return match ? sanitizeUrl(match[0]) : '';
}

function messageTextWithoutImageUrl(message = {}) {
 const imageUrl = extractMessageImageUrl(message);
 const content = String(message.content || '').trim();
 return imageUrl ? content.replace(imageUrl, '').trim() : content;
}

function renderMessageBubble(message) {
 const isMine = message.sender_id === currentUser.id;
 const imageUrl = extractMessageImageUrl(message);
 const text = messageTextWithoutImageUrl(message);
 const imageHtml = imageUrl
 ? `<img src="${escAttr(imageUrl)}" alt="Chat image" class="msg-image" loading="lazy" onclick="window.open('${escAttr(imageUrl)}','_blank')">`
 : '';
 const textHtml = text ? escHtml(text) : '';
 return `<div class="msg-bubble ${isMine ? 'mine' : 'theirs'}${imageUrl ? ' has-image' : ''}">${imageHtml}${textHtml}<div class="msg-time">${formatMsgTime(message.created_at)}${isMine ? ` <span>${message.is_read ? 'Read' : 'Sent'}</span>` : ''}</div></div>`;
}

function messagePreviewText(message = {}) {
 const text = messageTextWithoutImageUrl(message);
 return text || (extractMessageImageUrl(message) ? 'Image' : '');
}

function clearMessageImage() {
 pendingMessageImage = null;
 const input = document.getElementById('msg-image-input');
 const preview = document.getElementById('msg-image-preview');
 if (input) input.value = '';
 if (preview) {
 preview.classList.add('hidden');
 preview.innerHTML = '';
 }
}

async function openAdminSupportChat(prefill = '') {
 if (!currentUser) { showModal('auth-modal'); toggleAuth('login'); return; }
 try {
 const { data, error } = await db.from('profiles')
 .select('id,name,email')
 .eq('role', 'admin')
 .neq('id', currentUser.id)
 .limit(1);
 if (error) throw error;
 const admin = data?.[0];
 if (!admin?.id) throw new Error('Admin profile unavailable');
 await openConversation(admin.id, admin.name || admin.email || 'Admin Support');
 const input = document.getElementById('msg-input');
 if (input && prefill && !input.value) {
 input.value = prefill;
 input.focus();
 }
 } catch (_) {
 window.open('https://wa.me/2348116833356?text=Hello%20BUYSELL%20Support', '_blank');
 }
}

function handleMessageImageSelect(input) {
 const file = input?.files?.[0];
 if (!file) { clearMessageImage(); return; }
 const allowedTypes = ['image/jpeg', 'image/jpg', 'image/pjpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif', 'image/heic', 'image/heif'];
 const allowedExts = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'heic', 'heif'];
 const ext = (file.name || '').includes('.') ? file.name.split('.').pop().toLowerCase().replace(/[^a-z0-9]/g, '') : '';
 const looksLikeImage = file.type?.startsWith('image/') || allowedTypes.includes(file.type) || allowedExts.includes(ext);
 if (!looksLikeImage) {
 toast('Invalid image', 'Please choose a JPG, PNG, WebP, GIF, AVIF, or HEIC image.', 'warn');
 clearMessageImage();
 return;
 }
 if (file.size > 8 * 1024 * 1024) {
 toast('Image too large', 'Maximum chat image size is 8MB.', 'warn');
 clearMessageImage();
 return;
 }
 pendingMessageImage = file;
 const preview = document.getElementById('msg-image-preview');
 if (preview) {
 const url = URL.createObjectURL(file);
 preview.innerHTML = `<img src="${escAttr(url)}" alt=""><span>${escHtml(file.name || 'Selected image')}</span><button type="button" onclick="clearMessageImage()" title="Remove image"><i class="fa-solid fa-times"></i></button>`;
 preview.classList.remove('hidden');
 }
}

function openMessageModal(partnerId, partnerName = 'Seller', productId = null) {
 if (!currentUser) { showModal('auth-modal'); toggleAuth('login'); return; }
 if (!partnerId) { toast('Seller unavailable', 'This product seller could not be found.', 'error'); return; }
 if (partnerId === currentUser.id) { toast('This is your listing', 'You cannot message yourself about this product.', 'info'); return; }
 const label = partnerName || 'Seller';
 openConversation(partnerId, label, productId);
 const input = document.getElementById('msg-input');
 if (input && productId && !input.value) input.placeholder = `Ask ${label} about this product...`;
}

function getMsgMissingColumn(error) {
 const text = `${error?.message || ''} ${error?.details || ''} ${error?.hint || ''}`;
 const quoted = text.match(/'([^']+)' column/i) || text.match(/column "([^"]+)"/i);
 return quoted?.[1] || '';
}

async function getProfilesByIds(ids) {
 const unique = [...new Set((ids || []).filter(Boolean))];
 if (!unique.length) return {};
 let { data, error } = await db.from('profiles').select('id,name,email,whatsapp,store_name').in('id', unique);
 if (error && getMsgMissingColumn(error) === 'store_name') {
 ({ data } = await db.from('profiles').select('id,name,email,whatsapp').in('id', unique));
 }
 return Object.fromEntries((data || []).map(p => [p.id, p]));
}

function formatMsgTime(date) {
 if (!date) return '';
 return new Date(date).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' });
}

function formatMsgDay(date) {
 if (!date) return '';
 const d = new Date(date);
 const today = new Date();
 const yesterday = new Date();
 yesterday.setDate(today.getDate() - 1);
 if (d.toDateString() === today.toDateString()) return 'Today';
 if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
 return d.toLocaleDateString('en-NG', { day: 'numeric', month: 'short' });
}

function normalizeMessageRows(rows) {
 return (rows || []).map(m => ({
 ...m,
 content: String(m.content || '').trim(),
 created_at: m.created_at || new Date().toISOString(),
 is_read: !!m.is_read,
 })).filter(m => m.sender_id && m.receiver_id);
}

function partnerNameFromProfile(profile, fallback = 'User') {
 return profile?.store_name || profile?.name || profile?.email || fallback;
}

function renderInboxEmpty(container, text = 'No messages yet.') {
 container.innerHTML = `<div class="msg-empty" style="padding:2rem 1rem"><i class="fa-solid fa-envelope-open" style="font-size:1.6rem;color:var(--border2);display:block;margin-bottom:.55rem"></i>${escHtml(text)}</div>`;
}

async function showInbox() {
 showModal('inbox-modal');
 const container = document.getElementById('inbox-list');
 container.innerHTML = '<div class="text-center p-3"><span class="spinner"></span></div>';
 if (!currentUser) { renderInboxEmpty(container, 'Sign in to view messages.'); return; }
 try {
 const { data, error } = await db.from('messages')
 .select('*')
 .or(`sender_id.eq.${currentUser.id},receiver_id.eq.${currentUser.id}`)
 .order('created_at', { ascending: false })
 .limit(120);
 if (error) throw error;
 const msgs = normalizeMessageRows(data);
 if (!msgs.length) { renderInboxEmpty(container); return; }
 const profiles = await getProfilesByIds(msgs.flatMap(m => [m.sender_id, m.receiver_id]));
 const partners = {};
 msgs.forEach(m => {
 const pid = m.sender_id === currentUser.id ? m.receiver_id : m.sender_id;
 const profile = profiles[pid] || {};
 if (!partners[pid]) {
 partners[pid] = {
 id: pid,
 name: partnerNameFromProfile(profile),
 lastMsg: messagePreviewText(m),
 time: m.created_at,
 productId: m.product_id || '',
 unread: 0,
 };
 }
 if (m.receiver_id === currentUser.id && !m.is_read) partners[pid].unread += 1;
 });
 container.innerHTML = Object.values(partners).map(p => `
 <div class="inbox-thread ${p.unread ? 'unread' : ''}" onclick="openConversation('${escAttr(p.id)}','${escAttr(p.name)}','${escAttr(p.productId)}')">
 <div class="inbox-avatar">${escHtml((p.name || 'U')[0].toUpperCase())}</div>
 <div style="min-width:0">
 <div class="inbox-thread-title">${escHtml(p.name)}</div>
 <div class="inbox-thread-preview">${escHtml(p.lastMsg || '')}</div>
 ${p.productId ? '<div class="inbox-thread-product"><i class="fa-solid fa-box"></i> Product conversation</div>' : ''}
 </div>
 <div class="inbox-thread-side">
 <div class="text-xs color-text3">${formatMsgDay(p.time)}</div>
 ${p.unread ? `<div class="inbox-unread-dot">${p.unread}</div>` : ''}
 </div>
 </div>`).join('');
 } catch(e) { renderInboxEmpty(container, 'Messages are not available right now.'); }
}

async function openConversation(partnerId, partnerName, productId = null) {
 if (!currentUser) { showModal('auth-modal'); toggleAuth('login'); return; }
 currentChatPartner = partnerId;
 currentChatProductId = productId || null;
 closeModal('inbox-modal');
 document.getElementById('msg-partner-name').textContent = partnerName || 'User';
 document.getElementById('msg-partner-avatar').textContent = (partnerName || 'U')[0].toUpperCase();
 document.getElementById('msg-partner-meta').textContent = 'Loading conversation...';
 showModal('message-modal');
 const conv = document.getElementById('msg-conversation');
 conv.innerHTML = '<div class="text-center p-3"><span class="spinner"></span></div>';
 await renderMessageProductCard(currentChatProductId);
 try {
 const { data, error } = await db.from('messages').select('*')
 .or(`and(sender_id.eq.${currentUser.id},receiver_id.eq.${partnerId}),and(sender_id.eq.${partnerId},receiver_id.eq.${currentUser.id})`)
 .order('created_at', { ascending: true }).limit(100);
 if (error) throw error;
 const msgs = normalizeMessageRows(data);
 const unreadIds = msgs.filter(m => m.receiver_id === currentUser.id && !m.is_read).map(m => m.id);
 if (unreadIds.length) {
 await db.from('messages').update({ is_read: true }).in('id', unreadIds).then(() => {}).catch(() => {});
 updateInboxCount();
 }
 document.getElementById('msg-partner-meta').textContent = msgs.length ? `${msgs.length} message${msgs.length === 1 ? '' : 's'}` : 'New conversation';
 let lastDay = '';
 conv.innerHTML = msgs.map(m => {
 const isMine = m.sender_id === currentUser.id;
 const day = formatMsgDay(m.created_at);
 const divider = day !== lastDay ? `<div class="msg-day-divider">${escHtml(day)}</div>` : '';
 lastDay = day;
 return `${divider}${renderMessageBubble(m)}`;
 }).join('') || '<div class="msg-empty">No messages yet. Start with a quick question below.</div>';
 conv.scrollTop = conv.scrollHeight;
 } catch(e) { conv.innerHTML = '<p class="text-center color-text3 p-3">Could not load conversation.</p>'; }
}

async function renderMessageProductCard(productId) {
 const card = document.getElementById('msg-product-card');
 if (!card) return;
 card.classList.add('hidden');
 card.innerHTML = '';
 if (!productId) return;
 try {
 const { data: product } = await db.from('products').select('id,name,price').eq('id', productId).maybeSingle();
 if (!product) return;
 card.innerHTML = `<div style="min-width:0"><strong>${escHtml(product.name || 'Product')}</strong><span>${fmtN(product.price || 0)}</span></div><button class="btn btn-outline btn-sm" onclick="openProduct('${escAttr(product.id)}')">View</button>`;
 card.classList.remove('hidden');
 } catch (_) {}
}

function insertQuickMessage(text) {
 const input = document.getElementById('msg-input');
 if (!input) return;
 input.value = text;
 input.focus();
}

function handleMessageKey(event) {
 if (event.key === 'Enter' && !event.shiftKey) {
 event.preventDefault();
 sendMessage();
 }
}

async function sendMessage() {
 if (!currentUser || !currentChatPartner) return;
 const input = document.getElementById('msg-input');
 const text = input.value.trim();
 const imageFile = pendingMessageImage;
 if (!text && !imageFile) return;
 const sendBtn = document.getElementById('msg-send-btn');
 input.value = '';
 if (sendBtn) sendBtn.disabled = true;
 
try {
 let imageUrl = '';
 if (imageFile) {
 const ext = (imageFile.name || '').includes('.') ? imageFile.name.split('.').pop().toLowerCase().replace(/[^a-z0-9]/g, '') : 'jpg';
 const path = `chat/${currentUser.id}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext || 'jpg'}`;
 const uploaded = await uploadToFirstAvailableBucket(['chat', 'uploads', 'products'], path, imageFile, {
 contentType: imageFile.type || undefined,
 upsert: false,
 });
 imageUrl = uploaded.publicUrl;
 }

 const content = imageUrl
 ? [text, imageUrl].filter(Boolean).join('\n')
 : String(text);

 // Sanitize and structure the payload fields cleanly
 const payload = { 
 sender_id: currentUser.id, 
 receiver_id: currentChatPartner, 
 content, // Keep image URL in content as a compatibility fallback for older schemas.
 is_read: false 
 };

 if (imageUrl) {
 payload.image_url = imageUrl;
 payload.attachment_url = imageUrl;
 payload.attachment_type = 'image';
 payload.metadata = { image_url: imageUrl, attachment_type: 'image' };
 }
 
 if (currentChatProductId) {
 payload.product_id = currentChatProductId;
 }
 
 // If your table schema has an extra metadata slot requiring explicit JSON structures, 
 // it must be safely included or initialized as a valid JSON string structure like this:
 // payload.metadata = {}; 
 
 let delivered = false;
 for (let attempt = 0; attempt < 8; attempt++) {
 const { error } = await db.from('messages').insert(payload);
 if (!error) {
 delivered = true;
 break;
 }

 const errText = (error?.message || '').toLowerCase();
 const isForeignKeyViolation = errText.includes('foreign key') || errText.includes('fkey');
 const missing = missingColumn(error);

 if ((missing === 'product_id') || isForeignKeyViolation) {
 console.warn('Product relationship context is invalid or missing in DB. Removing product_id context and retrying plain chat delivery...');
 delete payload.product_id;
 continue;
 }
 if (missing && Object.prototype.hasOwnProperty.call(payload, missing)) {
 delete payload[missing];
 continue;
 }
 throw error;
 }
 if (!delivered) throw new Error('Could not save message.');
 
 clearMessageImage();
 openConversation(currentChatPartner, document.getElementById('msg-partner-name').textContent, currentChatProductId);
 } catch(e) {
 input.value = text; // Return text buffer to text input field if execution fails entirely
 toast('Message Failed', e.message || 'Could not send message', 'error');
 } finally {
 if (sendBtn) sendBtn.disabled = false;
 }
}
async function updateInboxCount() {
 const badge = document.getElementById('inbox-count');
 if (!badge) return;
 if (!currentUser) {
 badge.textContent = '0';
 badge.classList.add('hidden');
 return;
 }
 try {
 const { count, error } = await db.from('messages')
 .select('id', { count: 'exact', head: true })
 .eq('receiver_id', currentUser.id)
 .eq('is_read', false);
 if (error) throw error;
 const unread = count || 0;
 badge.textContent = unread > 99 ? '99+' : String(unread);
 badge.classList.toggle('hidden', unread === 0);
 } catch (_) {
 badge.classList.add('hidden');
 }
}

function setupMessageRealtime() {
 if (!currentUser || messageChannel) return;
 messageChannel = db.channel(`messages-${currentUser.id}`)
 .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, payload => {
 const row = payload.new || payload.old || {};
 if (row.sender_id !== currentUser.id && row.receiver_id !== currentUser.id) return;
 updateInboxCount();
 if (document.getElementById('inbox-modal')?.classList.contains('open')) showInbox();
 if (document.getElementById('message-modal')?.classList.contains('open') && currentChatPartner) {
 const involved = row.sender_id === currentChatPartner || row.receiver_id === currentChatPartner;
 if (involved) openConversation(currentChatPartner, document.getElementById('msg-partner-name').textContent, currentChatProductId);
 } else if (row.receiver_id === currentUser.id) {
 toast('New Message', row.content || 'You have a new message', 'info', 5000);
 }
 })
 .subscribe();
}

// ====================================================
// COUPONS
// ====================================================
async function createCoupon() {
 if (!currentUser) return;
 const code = document.getElementById('coupon-new-code')?.value.trim().toUpperCase();
 const type = document.getElementById('coupon-type')?.value || 'percent';
 const value = parseFloat(document.getElementById('coupon-value')?.value) || 0;
 const minOrder = parseFloat(document.getElementById('coupon-min')?.value) || 0;
 const maxUses = parseInt(document.getElementById('coupon-max')?.value) || 100;
 const days = parseInt(document.getElementById('coupon-days')?.value) || 30;
 if (!code || !value) { toast('Missing info', 'Enter a code and discount value', 'warn'); return; }
 try {
 const expires = new Date(Date.now() + days * 86400000).toISOString();
 await callEdge('manage-coupon', {
 action: 'create',
 data: {
 code,
 discount_type: type,
 discount_value: value,
 min_order: minOrder,
 max_uses: maxUses,
 expires_at: expires,
 },
 });
 toast('Coupon Created! ', `Code: ${code}`, 'success');
 loadSellerCoupons();
 document.getElementById('coupon-new-code').value = '';
 document.getElementById('coupon-value').value = '';
 } catch(e) { toast('Error', e.message, 'error'); }
}

async function loadSellerCoupons() {
 if (!currentUser) return;
 const list = document.getElementById('seller-coupons-list');
 if (!list) return;
 list.innerHTML = '<p class="color-text3 text-sm">Loading coupons...</p>';
 try {
 const result = await callEdge('manage-coupon', { action: 'list' });
 const coupons = result.coupons || [];
 if (!coupons.length) { list.innerHTML = '<p class="color-text3 text-sm">No coupons yet.</p>'; return; }
 list.innerHTML = coupons.map(c => {
 const discount = c.discount_type === 'percent' ? `${fmtNum(c.discount_value)}%` : fmtN(c.discount_value);
 const min = Number(c.min_order || 0) > 0 ? `, min ${fmtN(c.min_order)}` : '';
 const usage = `${fmtNum(c.used_count || 0)}/${fmtNum(c.max_uses || 0)} used`;
 const expiry = c.expires_at ? `Expires ${fmtDate(c.expires_at)}` : 'No expiry';
 return `
 <div class="flex justify-between items-center p-2" style="border-bottom:1px solid var(--border);gap:12px">
 <div style="min-width:0">
 <div><span class="font-bold">${escHtml(c.code)}</span> - ${discount} off${min}</div>
 <div class="text-xs color-text3">${usage} - ${expiry}</div>
 </div>
 <button class="btn btn-ghost btn-sm" onclick="deleteCoupon('${escAttr(c.id)}')" style="color:var(--red)" title="Delete coupon"><i class="fa-solid fa-trash"></i></button>
 </div>`;
 }).join('');
 } catch(e) {
 list.innerHTML = '<p class="color-red text-sm">Could not load coupons.</p>';
 toast('Error', e.message, 'error');
 }
}

async function deleteCoupon(couponId) {
 if (!couponId || !confirm('Delete this coupon?')) return;
 try {
 await callEdge('manage-coupon', { action: 'delete', coupon_id: couponId });
 toast('Coupon Deleted', '', 'success');
 loadSellerCoupons();
 } catch(e) { toast('Error', e.message, 'error'); }
}

function applyCoupon() {
 const code = document.getElementById('coupon-code')?.value.trim().toUpperCase();
 if (!code) return;
 toast('Coupon Applied', `Code "${code}" will be validated at checkout`, 'success');
}

function removeCoupon() {
 const el = document.getElementById('coupon-code');
 if (el) el.value = '';
 toast('Coupon Removed', '', 'info');
}

// ====================================================
// FLASH SALES
// ====================================================

async function loadFlashSaleProducts() {
 if (!currentUser) return;
 
 const selectEl = document.getElementById('flash-product');
 if (!selectEl) return;
 
 // Clear existing options first
 selectEl.innerHTML = '<option value="">Loading...</option>';
 
 try {
 const { data: products, error } = await db.from('products')
 .select('id, name, price')
 .eq('seller_id', currentUser.id)
 .eq('status', 'active');
 
 if (error) throw error;
 
 // Check if products exist and is an array
 if (!products || products.length === 0) {
 selectEl.innerHTML = '<option value="">No active products found</option>';
 return;
 }
 
 // Map the data
 const options = products.map(p => 
 `<option value="${p.id}">${escHtml(p.name)} (${fmtN(p.price)})</option>`
 ).join('');
 
 selectEl.innerHTML = '<option value="">Select a product...</option>' + options;
 
 } catch(e) {
 console.error("Flash Sale Load Error:", e);
 selectEl.innerHTML = '<option value="">Error loading products</option>';
 toast('Error', 'Could not load products for flash sales', 'error');
 }
}

async function createFlashSale() {
 if (!currentUser) return;
 
 const productId = document.getElementById('flash-product')?.value;
 const flashPrice = parseFloat(document.getElementById('flash-price')?.value) || 0;
 const hours = parseInt(document.getElementById('flash-hours')?.value) || 24;
 
 if (!productId || !flashPrice) { 
 toast('Missing info', 'Select a product and set a sale price', 'warn'); 
 return; 
 }

 const btn = event.target.closest('button');
 const oldHtml = btn.innerHTML;
 btn.disabled = true;
 btn.innerHTML = '<span class="spinner"></span> Saving...';

 try {
 // 1. Calculate end time
 const flashEnd = new Date(Date.now() + hours * 3600000).toISOString();
 
 // 2. Update the database
 const { error } = await db.from('products')
 .update({ 
 flash_price: flashPrice, 
 flash_end: flashEnd 
 })
 .eq('id', productId)
 .eq('seller_id', currentUser.id);

 if (error) throw error;

 toast('Flash Sale Live! Flash', `Sale ends in ${hours} hours`, 'success');
 
 // 3. Clear the form
 document.getElementById('flash-price').value = '';
 
 // 4. IMPORTANT: Refresh product state so the UI updates globally
 await loadProducts(); // Refresh buyer view
 await loadSellerProds(); // Refresh seller dashboard list

 } catch(e) { 
 toast('Error', e.message, 'error'); 
 } finally {
 btn.disabled = false;
 btn.innerHTML = oldHtml;
 }
}

// ====================================================
// AD SYSTEM
// ====================================================
let adPopupAds = [], adPopupIndex = 0, adSkipTimer = null;
const AD_PRICE_KOBO = 500000;

function resetAdForm() {
 document.getElementById('ad-title').value = '';
 document.getElementById('ad-desc').value = '';
 document.getElementById('ad-link').value = `${PUBLIC_SITE_URL}/`;
 document.getElementById('ad-media-file').value = '';
 document.getElementById('ad-media-preview-container')?.classList.add('hidden');
 document.getElementById('ad-media-zone')?.classList.remove('has-file');
 const label = document.querySelector('#ad-media-zone .upload-label');
 if (label) label.textContent = 'Click to upload Media (Image or Video)';
}

async function insertAdminAdvertisement(adData) {
 const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
 const base = {
 ...adData,
 status: 'active',
 payment_status: 'admin_free',
 payment_reference: `ADMIN-FREE-${Date.now()}`,
 approved_at: new Date().toISOString(),
 expires_at: expiresAt,
 };
 const variants = [
 base,
 { ...base, user_id: currentUser.id },
 { title: base.title, description: base.description, media_url: base.media_url, media_type: base.media_type, cta_text: base.cta_text, cta_link: base.cta_link, advertiser_id: currentUser.id, seller_id: currentUser.id, status: 'active', expires_at: expiresAt },
 ];
 let lastError = null;
 for (const row of variants) {
  const { error } = await db.from('advertisements').insert(row);
  if (!error) return;
  lastError = error;
  const msg = String(error.message || '').toLowerCase();
  if (!msg.includes('column') && !msg.includes('schema cache')) break;
 }
 throw lastError || new Error('Could not create admin advertisement');
}

function normalizeAdUrl(url) {
 const raw = String(url || '').trim();
 if (!raw) return '';
 const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
 try {
 const parsed = new URL(withProtocol);
 return parsed.href;
 } catch {
 return '';
 }
}

function getAdLink(ad) {
 return ad.cta_link || ad.link_url || '#';
}

function getAdSellerId(ad) {
 return ad?.seller_id || ad?.advertiser_id || ad?.user_id || ad?.profile_id || '';
}

function openAdDestination(adId, event) {
 event?.preventDefault?.();
 const ad = adPopupAds.find(a => a.id === adId) || adPopupAds[adPopupIndex];
 if (!ad) return;
 trackAdStat(ad.id, 'click');
 closeAdPopup();
 const sellerId = getAdSellerId(ad);
 if (sellerId) {
 viewStorefront(sellerId);
 return;
 }
 const link = getAdLink(ad);
 if (link && link !== '#') window.open(link, '_blank', 'noopener');
}

async function loadFlashSaleProducts() {
 if (!currentUser) return;
 
 const selectEl = document.getElementById('flash-product');
 if (!selectEl) return;
 
 selectEl.innerHTML = '<option value="">Loading products...</option>';
 
 try {
 const { data: products, error } = await db.from('products')
 .select('id, name, price')
 .eq('seller_id', currentUser.id)
 .eq('status', 'active'); // Only load active products
 
 if (error) throw error;
 
 if (!products || products.length === 0) {
 selectEl.innerHTML = '<option value="">No active products found</option>';
 return;
 }
 
 // Build the dropdown options
 selectEl.innerHTML = '<option value="">Select a product...</option>' + 
 products.map(p => 
 `<option value="${p.id}">${escHtml(p.name)} (${fmtN(p.price)})</option>`
 ).join('');
 
 } catch(e) {
 selectEl.innerHTML = '<option value="">Error loading products</option>';
 toast('Error', 'Could not load products for flash sales', 'error');
 }
}

async function loadSellerAds() {
 if (!currentUser) return;
 const tbody = document.getElementById('ad-table-body');
 if (tbody) tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:2rem;color:var(--text3)">Loading ads...</td></tr>';
 try {
 let { data, error } = await db.from('advertisements')
 .select('*')
 .eq('advertiser_id', currentUser.id)
 .order('created_at', { ascending: false });
 if (error) {
 ({ data, error } = await db.from('advertisements')
 .select('*')
 .eq('user_id', currentUser.id)
 .order('created_at', { ascending: false }));
 }
 if (error) throw error;
 const ads = data || [];
 const activeAds = ads.filter(a => a.status === 'active' && (!a.expires_at || new Date(a.expires_at) > new Date()));
 const totalViews = ads.reduce((sum, a) => sum + Number(a.views || 0), 0);
 const totalClicks = ads.reduce((sum, a) => sum + Number(a.clicks || 0), 0);
 document.getElementById('ad-active-count').textContent = activeAds.length;
 document.getElementById('ad-total-views').textContent = fmtNum(totalViews);
 document.getElementById('ad-total-clicks').textContent = fmtNum(totalClicks);
 renderSellerAdsTable(ads);
 } catch (e) {
 if (tbody) tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:2rem;color:var(--red)">Could not load ads: ${escHtml(e.message || 'Unknown error')}</td></tr>`;
 }
}

function renderSellerAdsTable(ads) {
 const tbody = document.getElementById('ad-table-body');
 if (!tbody) return;
 if (!ads.length) {
 tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:2rem;color:var(--text3)">No ads yet. Create one above to start promoting.</td></tr>';
 return;
 }
 tbody.innerHTML = ads.map(ad => {
 const status = ad.status || 'pending';
 const badge = status === 'active' ? 'badge-green' : status === 'rejected' ? 'badge-red' : status === 'expired' ? 'badge-red' : 'badge-gold';
 const expires = ad.expires_at ? fmtDate(ad.expires_at) : 'After approval';
 const media = ad.media_url
 ? (ad.media_type === 'video'
 ? `<video src="${escAttr(ad.media_url)}" muted style="width:58px;height:44px;object-fit:cover;border-radius:6px"></video>`
 : `<img src="${escAttr(ad.media_url)}" alt="" style="width:58px;height:44px;object-fit:cover;border-radius:6px">`)
 : '<span class="text-xs color-text3">No media</span>';
 return `<tr>
 <td>${media}</td>
 <td><div class="font-600 text-sm">${escHtml(ad.title || 'Untitled ad')}</div><div class="text-xs color-text3">${escHtml(ad.cta_text || 'Learn More')}</div></td>
 <td>${fmtNum(ad.views || 0)}</td>
 <td>${fmtNum(ad.clicks || 0)}</td>
 <td><span class="badge ${badge}">${escHtml(status)}</span></td>
 <td class="text-xs">${expires}</td>
 </tr>`;
 }).join('');
}

async function syncUserNotificationToken() {
 if (!currentUser) throw new Error('Sign in before enabling notifications.');
 if (!window.isSecureContext) throw new Error('Open the live HTTPS site before enabling notifications.');
 if (!('Notification' in window) || !('PushManager' in window) || !('serviceWorker' in navigator)) {
  throw new Error('Notifications are not supported on this device.');
 }

 try {
 if (Notification.permission !== 'granted') {
 throw new Error('Notification permission was not granted.');
 }

 const registrationResult = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
 if (registrationResult.waiting) await registrationResult.update().catch(() => {});
 const registration = await navigator.serviceWorker.ready;
 let subscription = await registration.pushManager.getSubscription();
 const VAPID_PUBLIC_KEY = "BHy42JVEzqL40I-Mhvu9dRK8Ewov4GSFKy5IIcsOKgerR-Z8DE_9WNc1N1GPShB0XF3fnjOwz2XpNtf4fdoOn50";
 const vapidKeyBytes = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);

 if (subscription && !pushSubscriptionUsesKey(subscription, vapidKeyBytes)) {
 await subscription.unsubscribe();
 subscription = null;
 }

 // If no active device subscription vector exists, create a new one
 if (!subscription) {
 subscription = await registration.pushManager.subscribe({
 userVisibleOnly: true,
 applicationServerKey: vapidKeyBytes
 });
 }

 const subscriptionJson = subscription.toJSON ? subscription.toJSON() : JSON.parse(JSON.stringify(subscription));
 let saved = false;
 let lastError = null;

 try {
 const { error: tableError } = await db.from('push_subscriptions').upsert({
 user_id: currentUser.id,
 endpoint: subscription.endpoint,
 subscription: subscriptionJson,
 user_agent: navigator.userAgent,
 updated_at: new Date().toISOString()
 }, { onConflict: 'endpoint' });
 if (tableError) throw tableError;
 saved = true;
 } catch (tableErr) {
 lastError = tableErr;
 console.warn('[PUSH ENGINE] Multi-device subscription table unavailable:', tableErr.message || tableErr);
 }

 try {
 const { error: profileError } = await db.from('profiles').update({
 push_subscription_token: JSON.stringify(subscriptionJson),
 updated_at: new Date().toISOString()
 }).eq('id', currentUser.id);
 if (profileError) throw profileError;
 saved = true;
 } catch (profileErr) {
 lastError = profileErr;
 console.warn('[PUSH ENGINE] Legacy profile subscription save unavailable:', profileErr.message || profileErr);
 }

 if (!saved) throw lastError || new Error('Unable to save notification subscription.');

 console.log('[PUSH ENGINE] Device token synchronized securely with database schema keys.');
 return subscriptionJson;
 } catch (err) {
 console.warn('[PUSH ENGINE] Registration token sync failed: ', err.message || err);
 throw err;
 }
}

function pushSubscriptionUsesKey(subscription, expectedKey) {
 const currentKey = subscription?.options?.applicationServerKey;
 if (!currentKey) return true;

 const currentBytes = new Uint8Array(currentKey);
 if (currentBytes.length !== expectedKey.length) return false;

 for (let i = 0; i < currentBytes.length; i++) {
 if (currentBytes[i] !== expectedKey[i]) return false;
 }

 return true;
}

function urlBase64ToUint8Array(base64String) {
 const padding = '='.repeat((4 - base64String.length % 4) % 4);
 const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
 const rawData = window.atob(base64);
 const outputArray = new Uint8Array(rawData.length);

 for (let i = 0; i < rawData.length; ++i) {
 outputArray[i] = rawData.charCodeAt(i);
 }

 return outputArray;
}

function fireNotificationFunction(fnName, payload) {
 return callEdge(fnName, payload).catch(error => {
 console.warn(`[PUSH ENGINE] ${fnName} notification skipped:`, error.message || error);
 });
}

async function notifyProductIfActive(productRecord, oldRecord = null) {
 if (!productRecord || productRecord.status !== 'active') return;
 await fireNotificationFunction('notify-new-product', {
 type: oldRecord ? 'UPDATE' : 'INSERT',
 record: productRecord,
 old_record: oldRecord,
 });
}

async function fetchProductForNotification(productId) {
 if (!productId) return null;
 const { data, error } = await db.from('products').select('*').eq('id', productId).maybeSingle();
 if (error) {
 console.warn('[PUSH ENGINE] Could not load product for notification:', error.message || error);
 return null;
 }
 return data || null;
}

async function notifyOrderIfConfirmed(orderId, oldStatus = null) {
 if (!orderId) return;
 const { data: order, error } = await db.from('orders').select('*').eq('id', orderId).maybeSingle();
 if (error || !order) {
 console.warn('[PUSH ENGINE] Could not load order for notification:', error?.message || error || 'not found');
 return;
 }
 if (order.status !== 'confirmed') return;
 await fireNotificationFunction('notify-seller-order', {
 type: oldStatus ? 'UPDATE' : 'INSERT',
 record: order,
 old_record: oldStatus ? { ...order, status: oldStatus } : null,
 });
}

async function loadActiveAds() {
 try {
 const dismissedUntil = Number(appSessionStorage.getItem('bs_ads_dismissed_until') || 0);
 if (Date.now() < dismissedUntil) return;
 const { data, error } = await db.from('advertisements')
 .select('*')
 .eq('status', 'active')
 .gt('expires_at', new Date().toISOString())
 .order('created_at', { ascending: false })
 .limit(5);
 if (error) throw error;
 adPopupAds = (data || []).filter(ad => ad.media_url || ad.title);
 if (!adPopupAds.length) return;
 adPopupIndex = 0;
 setTimeout(() => {
 if (currentRole === 'buyer' && !document.querySelector('.modal-overlay.open')) {
 document.getElementById('ad-popup-overlay')?.classList.remove('hidden');
 renderAdPopup();
 }
 }, 2500);
 } catch (e) {
 console.warn('Could not load active ads:', e);
 }
}

async function trackAdStat(adId, type) {
 if (!adId) return;
 try {
 await fetch(`${EDGE_URL}/update-ad-stats`, {
 method: 'POST',
 headers: { 'Content-Type': 'application/json', apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
 body: JSON.stringify({ adId, type }),
 });
 } catch (e) {
 console.warn('Ad tracking failed:', e);
 }
}

async function initiateAdPayment() {
 if (!currentUser) { showModal('auth-modal'); return; }
 const adminAd = isAdminEmail(currentUser.email) || isPlatformProfile(currentUser.profile || {});
 if (!adminAd && !isPaystackReady()) return;

 const title = document.getElementById('ad-title')?.value.trim();
 const desc = document.getElementById('ad-desc')?.value.trim();
 const cta = document.getElementById('ad-cta-select')?.value || 'Learn More';
 const link = normalizeAdUrl(document.getElementById('ad-link')?.value);
 const file = document.getElementById('ad-media-file')?.files?.[0];

 // --- VALIDATION BLOCK ---
 if (!title) { toast('Missing title', 'Enter an ad title', 'warn'); return; }
 if (title.length > 80) { toast('Title too long', 'Keep the title under 80 characters.', 'warn'); return; }
 if (!desc) { toast('Missing description', 'Add a short description for your ad.', 'warn'); return; }
 if (desc.length > 180) { toast('Description too long', 'Keep the description under 180 characters.', 'warn'); return; }
 if (!link) { toast('Invalid link', 'Enter a valid destination link.', 'warn'); return; }
 if (!file) { toast('Media needed', 'Upload an image or video for the ad.', 'warn'); return; }

 // Allow ALL images and ALL video formats
 const isImage = file.type.startsWith('image/');
 const isVideo = file.type.startsWith('video/');
 
 if (!isImage && !isVideo) {
 toast('Unsupported file', 'Please upload a valid image or video file.', 'warn');
 return;
 }

 // 50MB Size Safeguard
 const MAX_SIZE = 50 * 1024 * 1024; 
 if (file.size > MAX_SIZE) {
 toast('File too large', 'Please keep your ad media under 50MB.', 'warn');
 return;
 }
 // ---

 const btn = document.getElementById('ad-pay-btn');
 btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Processing...';

 try {
 let mediaUrl = '';
 // Upload the file
 const ext = file.name.split('.').pop().toLowerCase();
 const path = `ads/${currentUser.id}/${Date.now()}.${ext}`;
 
 const { error: upErr } = await db.storage.from('uploads').upload(path, file, { 
 contentType: file.type, 
 upsert: false 
 });
 
 if (upErr) throw upErr;
 
 const { data } = db.storage.from('uploads').getPublicUrl(path);
 mediaUrl = data.publicUrl;

  const adData = {
  title,
  description: desc || '',
  media_url: mediaUrl,
 media_type: isVideo ? 'video' : 'image',
 cta_text: cta,
 cta_link: link,
 seller_id: currentUser.id,
 advertiser_id: currentUser.id,
  advertiser_type: currentRole || 'seller'
  };

  if (adminAd) {
  await insertAdminAdvertisement({ ...adData, advertiser_type: 'admin' });
  toast('Admin Ad Published', 'Advertisement is live for 30 days with no payment needed.', 'success');
  resetAdForm();
  loadSellerAds();
  btn.disabled = false;
  updatePlatformSellerDashboardChrome();
  return;
  }

  // Initialize Paystack payment
 const init = await callEdge('init-ad-payment', { amount: AD_PRICE_KOBO / 100 });
 if (!init?.access_code && !init?.reference) throw new Error('Could not initialize ad payment');
 
 const reference = init.reference;
 openPaystackTransaction({
 key: PAYSTACK_PUBLIC_KEY,
 email: currentUser.email,
 amount: AD_PRICE_KOBO,
 currency: 'NGN',
 reference,
 access_code: init.access_code,
 metadata: { user_id: currentUser.id, type: 'advertisement' },
 onSuccess: async (response) => {
 try {
 const paidReference = await resolvePaystackReference(response, reference);
 await callEdge('verify-ad-payment', { reference: paidReference, adData });
 
 toast('Ad Submitted', 'Payment verified. Your ad is now waiting for admin approval.', 'success');
 
  resetAdForm();
 
 loadSellerAds();
 } catch (err) {
 toast('Verification Failed', err.message || 'Contact support', 'error');
 } finally {
 btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-credit-card"></i> Pay & Submit Ad';
 }
 },
 onCancel: () => {
 btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-credit-card"></i> Pay & Submit Ad';
 toast('Payment Cancelled', 'Your ad was not submitted.', 'info');
 }
 });
 } catch(e) {
  toast('Error', e.message, 'error');
  btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-credit-card"></i> Pay & Submit Ad';
  updatePlatformSellerDashboardChrome();
  }
}
function closeAdPopup() {
 document.getElementById('ad-popup-overlay')?.classList.add('hidden');
 appSessionStorage.setItem('bs_ads_dismissed_until', String(Date.now() + 30 * 60 * 1000));
 if (adSkipTimer) { clearInterval(adSkipTimer); adSkipTimer = null; }
}

function skipAd() {
 if (adPopupIndex < adPopupAds.length - 1) {
 adPopupIndex++;
 renderAdPopup();
 } else {
 closeAdPopup();
 }
}

function renderAdPopup() {
 if (!adPopupAds.length) return;
 const ad = adPopupAds[adPopupIndex];
 const content = document.getElementById('ad-popup-content');
 const counter = document.getElementById('ad-counter');
 const ctaBtn = document.getElementById('ad-cta-btn');
 const ctaText = document.getElementById('ad-cta-text');
 const desc = escHtml(ad.description || '');

 trackAdStat(ad.id, 'view');

 if (content) content.innerHTML = `
 ${ad.media_url
 ? (ad.media_type === 'video'
 ? `<video src="${escAttr(ad.media_url)}" autoplay muted playsinline loop></video>`
 : `<img src="${escAttr(ad.media_url)}" alt="${escAttr(ad.title || 'Sponsored ad')}">`)
 : `<div style="padding:2rem;text-align:center;color:#fff"><h3>${escHtml(ad.title || 'Sponsored offer')}</h3></div>`}
 <div class="ad-popup-info">
 <h2>${escHtml(ad.title || 'Sponsored offer')}</h2>
 ${desc ? `<p>${desc}</p>` : ''}
 </div>`;
 if (counter) counter.textContent = `${adPopupIndex+1}/${adPopupAds.length}`;
 if (ctaBtn) {
 ctaBtn.href = getAdSellerId(ad) ? '#' : getAdLink(ad);
 ctaBtn.removeAttribute('target');
 ctaBtn.onclick = (event) => openAdDestination(ad.id, event);
 }
 if (ctaText) ctaText.textContent = ad.cta_text || (getAdLink(ad) !== '#' ? 'Visit' : 'Close');
 const dots = document.getElementById('ad-popup-dots');
 if (dots) dots.innerHTML = adPopupAds.map((_, i) => `<span class="ad-popup-dot ${i === adPopupIndex ? 'active' : ''}"></span>`).join('');
 const progress = document.getElementById('ad-progress');
 if (progress) progress.style.width = '0%';

 let secs = 5;
 const skipBtn = document.getElementById('ad-skip-btn');
 const timerEl = document.getElementById('ad-skip-timer');
 if (skipBtn) skipBtn.disabled = true;
 if (timerEl) timerEl.textContent = secs;
 if (adSkipTimer) clearInterval(adSkipTimer);
 adSkipTimer = setInterval(() => {
 secs--;
 if (timerEl) timerEl.textContent = secs;
 if (progress) progress.style.width = `${((5 - secs) / 5) * 100}%`;
 if (secs <= 0) { clearInterval(adSkipTimer); if (skipBtn) { skipBtn.disabled = false; } }
 }, 1000);
}

// ====================================================
// NOTIFICATIONS
// ====================================================
function updateNotificationButtonState() {
 const btn = document.getElementById('nav-notify-btn');
 const icon = document.getElementById('nav-notify-icon');
 if (!btn || !icon) return;

 btn.classList.remove('enabled', 'blocked');
 if (!('Notification' in window) || !('PushManager' in window) || !('serviceWorker' in navigator)) {
 btn.title = 'Notifications are not supported on this device';
 btn.setAttribute('aria-label', 'Notifications are not supported on this device');
 icon.className = 'fa-solid fa-bell-slash';
 return;
 }

  if (Notification.permission === 'granted') {
  btn.classList.add('enabled');
  btn.title = 'Notifications enabled. Click to send a test push.';
  btn.setAttribute('aria-label', 'Send test notification');
  icon.className = 'fa-solid fa-bell';
 } else if (Notification.permission === 'denied') {
 btn.classList.add('blocked');
 btn.title = 'Notifications blocked. Enable them in browser site settings.';
 btn.setAttribute('aria-label', 'Notifications blocked');
 icon.className = 'fa-solid fa-bell-slash';
 } else {
 btn.title = 'Enable notifications';
 btn.setAttribute('aria-label', 'Enable notifications');
 icon.className = 'fa-regular fa-bell';
 }
}

async function handleNotificationBellClick() {
 if (!('Notification' in window)) { toast('Not Supported', "Your browser doesn't support notifications", 'warn'); return; }
 if (!currentUser) { toast('Sign In Required', 'Please sign in before enabling notifications.', 'warn'); return; }
 if (Notification.permission === 'granted') {
  await testNotification();
  return;
 }
 await requestNotificationPermission();
}

async function requestNotificationPermission() {
 if (!('Notification' in window)) { toast('Not Supported', "Your browser doesn't support notifications", 'warn'); return; }
 if (!currentUser) { toast('Sign In Required', 'Please sign in before enabling notifications.', 'warn'); return; }
 const perm = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
 if (perm === 'granted') {
 try {
 await syncUserNotificationToken();
 } catch (error) {
 updateNotificationButtonState();
 toast('Notifications Not Saved', error.message || 'Could not save this device for notifications.', 'error');
 return;
 }
 updateNotificationButtonState();
 toast('Notifications Enabled', 'This device will receive alerts', 'success');
 } else {
 updateNotificationButtonState();
 toast('Denied', 'Notifications were blocked on this device', 'warn');
 }
}

async function testNotification() {
 if (!('Notification' in window)) { toast('Not Supported', "Your browser doesn't support notifications", 'warn'); return; }
 if (!currentUser) { toast('Sign In Required', 'Please sign in before testing notifications.', 'warn'); return; }
 if (Notification.permission !== 'granted') {
 await requestNotificationPermission();
 if (Notification.permission !== 'granted') return;
 }

 try {
  await syncUserNotificationToken();
  await callEdge('test-push-notification', {
   title: 'BUYSELL Nigeria',
   body: 'Background notifications are active for this device.',
   url: `${PUBLIC_SITE_URL}/?view=shop`,
  });
  toast('Push Sent', 'Close the site and future alerts will still reach this device.', 'success', 5500);
  return;
 } catch (serverError) {
  console.warn('[PUSH ENGINE] Server push test failed, falling back to local notification:', serverError.message || serverError);
  toast('Server Push Not Ready', serverError.message || 'Could not send a background push yet.', 'warn', 6500);
 }

 try {
  const registration = await navigator.serviceWorker.ready;
  await registration.showNotification('BUYSELL Nigeria', {
  body: 'Local notification works. Server push still needs configuration.',
  icon: '/favicon.ico',
  badge: '/favicon.ico',
  data: { url: '/?view=shop' },
  tag: 'buysell-test-notification',
  });
 } catch (error) {
  toast('Test Failed', error.message || 'Could not show a test notification.', 'error');
 }
}

async function testLocalNotification() {
 if (!('Notification' in window)) { toast('Not Supported', "Your browser doesn't support notifications", 'warn'); return; }
 if (Notification.permission !== 'granted') {
 await requestNotificationPermission();
  return;
 }

 try {
 await syncUserNotificationToken();
 const registration = await navigator.serviceWorker.ready;
 await registration.showNotification('BUYSELL Nigeria', {
 body: 'Notifications are working on this device.',
 icon: '/favicon.ico',
 badge: '/favicon.ico',
  data: { url: '/?view=shop' },
 tag: 'buysell-test-notification',
 });
 toast('Sent!', 'Check your notification area', 'success');
 } catch (error) {
 toast('Test Failed', error.message || 'Could not show a test notification.', 'error');
 }
}

// ====================================================
// SERVICE REVIEWS
// ====================================================
let svcRating = 0;
function setSvcRating(n) {
 svcRating = n;
 document.querySelectorAll('#svc-star-row .star-btn').forEach((btn, i) => {
 btn.classList.toggle('active', i < n);
 btn.style.color = i < n ? '#f59e0b' : '#d1d5db';
 });
}

async function submitServiceReview() {
 if (!currentUser) { showModal('auth-modal'); return; }
 const bookingId = document.getElementById('svc-review-booking-id')?.value;
 const text = document.getElementById('svc-review-text')?.value.trim();
 if (!svcRating) { toast('Rate the service', 'Please select a star rating', 'warn'); return; }
 try {
 await db.from('reviews').insert({
 reviewer_id: currentUser.id,
 booking_id: bookingId || null,
 rating: svcRating,
 comment: text,
 type: 'service'
 });
 toast('Review Submitted! ', 'Thank you for your feedback', 'success');
 closeModal('service-review-modal');
 svcRating = 0;
 } catch(e) { toast('Error', e.message, 'error'); }
}

// ====================================================
// PROVIDER BOOKINGS
// ====================================================
async function loadProviderBookings() {
 if (!currentUser) return;
 const container = document.getElementById('spd-bookings-list');
 if (!container) return;
 container.innerHTML = '<div class="text-center p-3"><span class="spinner"></span></div>';
 try {
 const { data: bookings } = await db.from('service_bookings')
 .select('*, client:client_id(name, email)')
 .eq('provider_id', currentUser.id)
 .order('created_at', { ascending: false });
 if (!bookings || !bookings.length) {
 container.innerHTML = '<p class="text-center color-text3 p-3">No bookings yet.</p>';
 return;
 }
 container.innerHTML = bookings.map(b => `
 <div class="card card-pad mb-2">
 <div class="flex justify-between items-center">
 <div><div class="font-bold text-sm">${escHtml(b.client?.name || 'Client')}</div><div class="text-xs color-text3">${fmtDate(b.created_at)}</div></div>
 <span class="badge badge-${b.status==='completed'?'green':b.status==='cancelled'?'red':'gold'}">${b.status}</span>
 </div>
 ${b.notes ? `<div class="text-xs color-text3 mt-1">${escHtml(b.notes)}</div>` : ''}
 </div>`).join('');
 } catch(e) { container.innerHTML = '<p class="text-center color-text3 p-3">Could not load bookings.</p>'; }
}

// ====================================================
// VOICE INPUT
// ====================================================

// ====================================================
// LANGUAGE
// ====================================================
function setLanguage(lang) {
 appStorage.setItem('bs_lang', lang);
 toast('Language', `Switched to ${lang === 'en' ? 'English' : lang === 'pcm' ? 'Pidgin' : lang === 'ha' ? 'Hausa' : lang === 'yo' ? 'Yoruba' : lang === 'ig' ? 'Igbo' : lang}`, 'info');
}
// ==========================================
// BULLETPROOF AUTH HEADER SYNC
// ==========================================
// =================================================================
// BUYSELL NIGERIA UNIFIED AUTH HEADER SYNCHRONIZATION ENGINE
// =================================================================
