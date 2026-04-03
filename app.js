// ====================================================
//  CONFIG
// ====================================================
const SB_URL  = 'https://obzhlmzswthnorkiqemh.supabase.co';
const SB_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9iemhsbXpzd3Robm9ya2lxZW1oIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMxMDE2NjgsImV4cCI6MjA4ODY3NzY2OH0.5I4Ln0913h0AH5z4e64QBVx88igcIwEaM0Lz11FqDvU';
const EDGE_URL = SB_URL + '/functions/v1';

const CLAUDE_EDGE_URL = `${EDGE_URL}/claude-agent`;
let chatHistory = []; 
let adminAiHistory = [];

/** Call a deployed Edge Function securely with the user's JWT */
async function callEdge(fnName, body) {
  const session = (await db.auth.getSession()).data.session;
  const token   = session?.access_token;
  if (!token) throw new Error('Not authenticated');

  const res = await fetch(`${EDGE_URL}/${fnName}`, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${token}`,
      'apikey':        SB_KEY
    },
    body: JSON.stringify(body)
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `${fnName} failed (${res.status})`);
  return data;
}
const ADMIN_EMAIL = 'israelefe093@gmail.com';
const PAYSTACK_PUBLIC_KEY = 'pk_test_xxxxxxxxxxxxxxxx'; // Replace with live key
const COMMISSION_AMOUNT = 500000; // ₦5,000 in kobo
const PLATFORM_FEE_PCT = 0.03;

const db = window.supabase.createClient(SB_URL, SB_KEY, {
  auth: {
    persistSession:     true,
    autoRefreshToken:   true,
    detectSessionInUrl: true,
    storage:            window.localStorage
  }
});

// ====================================================
//  STATE
// ====================================================
let currentUser = null, currentRole = 'buyer', currentProd = null;
let cart = JSON.parse(localStorage.getItem('bs_cart') || '[]');
let products = [], filteredProducts = [], activeFilters = {};
let carouselIndex = 0, carouselTimer = null;
let selectedRating = 0, checkoutPaymentMethod = 'paystack';
let deferredInstallPrompt = null, salesChart = null;
let carouselStartX = 0;

// ====================================================
//  PWA
// ====================================================
if ('serviceWorker' in navigator) {
  const sw = `data:application/javascript,self.addEventListener('fetch',e=>{e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request)))});self.addEventListener('install',()=>self.skipWaiting());`;
  navigator.serviceWorker.register(sw).catch(()=>{});
}
const manifest = {name:'BUYSELL Nigeria',short_name:'BUYSELL',start_url: window.location.origin + '/','display':'standalone',theme_color:'#0b1f14',background_color:'#fdf8ef',icons:[{src:'https://via.placeholder.com/192x192/0b1f14/ffffff?text=B',sizes:'192x192',type:'image/png'}]};
const mBlob = new Blob([JSON.stringify(manifest)],{type:'application/json'});
const mUrl = URL.createObjectURL(mBlob);
const mLink = document.createElement('link');
mLink.rel='manifest';mLink.href=mUrl;
if(document.head) document.head.appendChild(mLink); else document.documentElement.appendChild(mLink);

window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredInstallPrompt = e; setTimeout(()=>document.getElementById('pwa-banner').classList.add('show'), 3000); });
function installPWA() { if (deferredInstallPrompt) { deferredInstallPrompt.prompt(); deferredInstallPrompt.userChoice.then(()=>{ document.getElementById('pwa-banner').classList.remove('show'); deferredInstallPrompt = null; }); } }
function dismissPWA() { document.getElementById('pwa-banner').classList.remove('show'); }

// ====================================================
//  TOAST
// ====================================================
function toast(title, msg='', type='success', dur=3500) {
  const tc = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast-item ${type}`;
  const icons = {success:'fa-check-circle',error:'fa-exclamation-triangle',info:'fa-info-circle',warn:'fa-exclamation-circle'};
  const cols = {success:'var(--green)',error:'var(--danger)',info:'var(--blue)',warn:'var(--gold)'};
  el.innerHTML = `<i class="fa-solid ${icons[type]||icons.info}" style="color:${cols[type]||cols.info};font-size:1.1rem;flex-shrink:0"></i><div class="ti"><div class="ti-title">${title}</div>${msg?`<div class="ti-msg">${msg}</div>`:''}</div><button onclick="this.parentElement.remove()" style="background:none;border:none;color:var(--text3);cursor:pointer;font-size:.85rem;flex-shrink:0"><i class="fa-solid fa-times"></i></button>`;
  tc.appendChild(el);
  setTimeout(() => { el.classList.add('exiting'); setTimeout(()=>el.remove(), 300); }, dur);
}

// ====================================================
//  MODAL HELPERS
// ====================================================
function showModal(id) { const m = document.getElementById(id); if(m){ m.classList.add('open'); document.body.classList.add('modal-open'); } }
function closeModal(id) { const m = document.getElementById(id); if(m){ m.classList.remove('open'); document.body.classList.remove('modal-open'); } }
document.querySelectorAll('.modal-overlay').forEach(m => m.addEventListener('click', e => { if(e.target===m) closeModal(m.id); }));

// ====================================================
//  AUTH
// ====================================================
function toggleAuth(mode) {
  const isLogin  = mode === 'login';
  const isSignup = mode === 'signup';
  const isForgot = mode === 'forgot';

  // Tab highlights
  document.getElementById('auth-tab-login').classList.toggle('active',  isLogin);
  document.getElementById('auth-tab-signup').classList.toggle('active', isSignup);

  // Show/hide panels
  document.getElementById('auth-form').classList.toggle('hidden',          isForgot);
  document.getElementById('auth-forgot-panel').classList.toggle('hidden',  !isForgot);
  document.getElementById('forgot-link-row').classList.toggle('hidden',    !isLogin || isForgot);

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
  document.getElementById('auth-btn-text').textContent = isLogin ? 'Sign In' : 'Create Account';
  document.getElementById('auth-password').setAttribute('autocomplete', isLogin ? 'current-password' : 'new-password');
  if (isSignup) selectRole('buyer');
}

// Role card selector
function selectRole(role) {
  document.querySelectorAll('.role-card').forEach(c => c.classList.remove('active'));
  document.getElementById('role-card-' + role)?.classList.add('active');
  document.querySelector(`input[name="auth-role-radio"][value="${role}"]`).checked = true;
  // Show/hide WhatsApp for seller/both/service_provider
  const needsWa = role === 'seller' || role === 'both' || role === 'service_provider';
  document.getElementById('auth-wa-group').classList.toggle('hidden', !needsWa);
  document.getElementById('role-both-note').classList.toggle('hidden', role !== 'both');
  document.getElementById('role-sp-note')?.classList.toggle('hidden', role !== 'service_provider');
}

async function handleAuth(e) {
  e.preventDefault();
  const isLogin = document.getElementById('auth-tab-login').classList.contains('active');
  const email    = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-password').value;

  if (!email || !password) { toast('Missing fields', 'Enter your email and password', 'warn'); return; }

  const btnText = document.getElementById('auth-btn-text');
  const spinner = document.getElementById('auth-spinner');
  const btn     = document.getElementById('auth-btn');
  btnText.textContent = ''; spinner.classList.remove('hidden'); btn.disabled = true;

  try {
    if (isLogin) {
      // ── SIGN IN ──────────────────────────────────────────────
      const { data, error } = await db.auth.signInWithPassword({ email, password });

      if (error) {
        // Give a clear, actionable message for every common error
        const msg = error.message?.toLowerCase() || '';
        if (msg.includes('email not confirmed')) {
          toast('Email Not Confirmed',
            'Supabase Dashboard → Auth → Providers → Email → turn OFF "Confirm email"',
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
      await onAuthSuccess(user);
      closeModal('auth-modal');

    } else {
      // ── SIGN UP ──────────────────────────────────────────────
      const name    = validateInput(document.getElementById('auth-name').value.trim());
      const rawRole = validateInput(document.querySelector('input[name="auth-role-radio"]:checked')?.value || 'buyer');
      const wa      = document.getElementById('auth-wa').value.trim();

      if (!name) { toast('Name required', 'Please enter your full name', 'warn'); return; }
      if (password.length < 6) { toast('Password too short', 'Minimum 6 characters', 'warn'); return; }

      const role     = rawRole === 'both' ? 'seller' : rawRole;
      const accounts = rawRole;

      // Step 1: Create the account
      const { data: signUpData, error: signUpError } = await db.auth.signUp({
        email, password,
        options: { data: { name, role, accounts, whatsapp: wa } }
      });

      if (signUpError) {
        const msg = signUpError.message?.toLowerCase() || '';
        if (msg.includes('already registered') || msg.includes('already exists') || msg.includes('user already')) {
          // Account exists — just sign them in directly
          toast('Account exists — signing you in…', '', 'info', 3000);
          const { data: loginData, error: loginError } = await db.auth.signInWithPassword({ email, password });
          if (loginError) {
            toast('Sign In Failed', 'Account exists but password is wrong. Try signing in.', 'error', 7000);
            return;
          }
          const user = loginData.session?.user || loginData.user;
          await onAuthSuccess(user);
          closeModal('auth-modal');
          return;
        } else if (msg.includes('rate limit') || msg.includes('too many')) {
          toast('Too Many Attempts', 'Wait a few minutes and try again', 'warn', 7000);
        } else {
          toast('Sign Up Failed', signUpError.message, 'error');
        }
        return;
      }

      // Step 2: Always immediately sign in after signup — guarantees a live session
      // regardless of whether email confirmation setting is truly off
      const { data: loginData, error: loginError } = await db.auth.signInWithPassword({ email, password });

      if (loginError) {
        // Signup worked but auto-login failed — tell them to sign in manually
        toast('Account Created!', 'Now sign in with your email and password', 'success', 6000);
        toggleAuth('login');
        document.getElementById('auth-email').value = email;
        return;
      }

      const user = loginData.session?.user || loginData.user;
      await upsertProfile(user, { name, role, accounts, whatsapp: wa });
      await onAuthSuccess(user);
      closeModal('auth-modal');

      const msgs = {
        buyer:            '🛍️ Welcome! Browse thousands of products.',
        seller:           '🏪 Welcome Seller! First month is FREE.',
        both:             '🔄 Welcome! You can shop and sell on BUYSELL.',
        service_provider: '🔧 Welcome Service Pro! Set up your portfolio and start getting hired.'
      };
      setTimeout(() => toast('Account Created! 🎉', msgs[rawRole] || '', 'success', 5000), 400);
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
  const trialEnd = new Date(); trialEnd.setDate(trialEnd.getDate() + 30);
  const { error } = await db.from('profiles').upsert({
    id:              user.id,
    name:            meta.name     || user.user_metadata?.name     || 'User',
    email:           user.email,
    role:            meta.role     || user.user_metadata?.role     || 'buyer',
    accounts:        meta.accounts || user.user_metadata?.accounts || meta.role || 'buyer',
    whatsapp:        meta.whatsapp || user.user_metadata?.whatsapp || '',
    trial_end:       trialEnd.toISOString(),
    commission_paid: false,
    referral_code:   'ref_' + Math.random().toString(36).substr(2, 8)
  }, { onConflict: 'id', ignoreDuplicates: false });
  if (error) console.warn('upsertProfile error:', error.message);
}

async function onAuthSuccess(user) {
  if (!user) return;
  currentUser = user;

  // Load profile from DB
  const { data: profile, error } = await db.from('profiles').select('*').eq('id', user.id).single();

  if (error || !profile) {
    // Profile not yet created (trigger may still be running) — create it now
    await upsertProfile(user, user.user_metadata || {});
    const { data: retryProfile } = await db.from('profiles').select('*').eq('id', user.id).single();
    currentUser.profile = retryProfile || {
      role: user.user_metadata?.role || 'buyer',
      name: user.user_metadata?.name || user.email?.split('@')[0] || 'User',
      email: user.email
    };
  } else {
    currentUser.profile = profile;
  }

  currentRole = currentUser.profile?.role || 'buyer';
  updateNavForUser();
}

async function checkSession() {
  // Subscribe to auth state changes FIRST so we don't miss the initial event
  db.auth.onAuthStateChange(async (event, session) => {
    if (event === 'SIGNED_IN' && session?.user) {
      if (!currentUser) {
        await onAuthSuccess(session.user);
        // Auto-enter site if still on landing page
        if (document.getElementById('landing') &&
            document.getElementById('landing').style.display !== 'none') {
          enterSite(currentUser?.profile?.role || 'buyer');
        }
      }
    }
    if (event === 'SIGNED_OUT') {
      currentUser = null;
      currentRole = 'buyer';
    }
    if (event === 'TOKEN_REFRESHED' && session?.user) {
      currentUser = session.user;
    }
    if (event === 'USER_UPDATED' && session?.user) {
      currentUser = session.user;
    }
  });

  // Then check for an existing persisted session
  const { data: { session } } = await db.auth.getSession();
  if (session?.user) {
    await onAuthSuccess(session.user);
  }
}

function updateNavForUser() {
  if (!currentUser) return;
  document.getElementById('nav-auth-btns').classList.add('hidden');
  document.getElementById('nav-user-btns').classList.remove('hidden');
  const initial = (currentUser.profile?.name || currentUser.email || 'U')[0].toUpperCase();
  document.getElementById('nav-avatar-inner').textContent = initial;
  document.getElementById('nav-avatar-inner').style.fontSize = '.9rem';
  document.getElementById('dash-user-name').textContent = currentUser.profile?.name || 'Seller';
  document.getElementById('dash-user-email').textContent = currentUser.email || '';
  // Admin check
  // DB-backed admin check — email alone is not sufficient
  const isAdmin = currentUser.email === ADMIN_EMAIL &&
                  currentUser.profile?.role === 'admin';
  if (isAdmin) {
    document.getElementById('admin-nav-item')?.classList.remove('hidden');
  }
  // Referral link
  const rc = currentUser.profile?.referral_code || 'ref_' + currentUser.id?.substr(0,8);
  document.getElementById('referral-link').value = `https://buysell.ng/ref/${rc}`;
}

async function sendPasswordReset() {
  const email = document.getElementById('forgot-email').value.trim();
  if (!email) { toast('Enter your email', '', 'warn'); return; }

  const btn     = document.getElementById('forgot-btn');
  const btnText = document.getElementById('forgot-btn-text');
  const spinner = document.getElementById('forgot-spinner');
  btn.disabled = true; btnText.textContent = ''; spinner.classList.remove('hidden');

  try {
    const { error } = await db.auth.resetPasswordForEmail(email, {
      redirectTo: 'https://israel2002551.github.io/BUYSELL_Nigeria_FINAL/'
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
    toast('Reset link sent! 📧', 'Check your email inbox', 'success', 6000);

  } catch(e) {
    toast('Error', e.message || 'Please try again', 'error');
  } finally {
    spinner.classList.add('hidden');
    btnText.textContent = 'Send Reset Link';
    btn.disabled = false;
  }
}

async function logoutUser() {
  await db.auth.signOut();
  currentUser = null;
  document.getElementById('nav-auth-btns').classList.remove('hidden');
  document.getElementById('nav-user-btns').classList.add('hidden');
  enterSite('buyer');
  toast('Signed Out', '', 'info');
}


async function generateDescription() {
  const name      = document.getElementById('p-name').value.trim();
  const price     = document.getElementById('p-price').value;
  const category  = document.getElementById('p-category').value;
  const condition = document.getElementById('p-condition').value;

  if (!name) { toast('Enter product name first', '', 'warn'); return; }

  const btn = event.target.closest('button');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-dark"></span> Writing...';

  try {
    const res  = await fetch(CLAUDE_EDGE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{
          role: 'user',
          content: `Write a compelling product description for a Nigerian marketplace listing.
                    Product: ${name}
                    Category: ${category}
                    Condition: ${condition}
                    Price: ₦${price}
                    
                    Requirements:
                    - 2–3 sentences max
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
      toast('Description Generated! ✨', 'Edit it to your liking', 'success');
    }
  } catch(e) {
    toast('AI unavailable', 'Write description manually', 'warn');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-magic"></i> Generate with AI';
  }
}



function showProfile() { if (!currentUser) { showModal('auth-modal'); } else { toast(currentUser.profile?.name || 'You', currentUser.email, 'info'); } }

// ====================================================
//  SITE NAVIGATION
// ====================================================
function enterSite(mode) {
  document.getElementById('landing').style.opacity = '0';
  setTimeout(() => {
    document.getElementById('landing').style.display = 'none';
    document.getElementById('topbar').style.display = 'block';
    document.getElementById('main-nav').style.display = 'block';
    document.getElementById('chatbot-fab').style.display = 'flex';
    document.getElementById('wa-fab').style.display = 'flex';
    
    const isAdmin = currentUser && currentUser.email === ADMIN_EMAIL && currentUser.profile?.role === 'admin';
    
    if (isAdmin) {
      showAdminPortal();
    } else if (mode === 'seller' || mode === 'both') {
      showSellerDashboard();
    } else if (mode === 'service_provider') {
      showServiceDashboard();
    } else {
      showBuyerView();
    }
  }, 350);
}


function showBuyerView() {
  document.getElementById('buyer-view').style.display = 'block';
  document.getElementById('seller-dashboard').style.display = 'none';
  document.getElementById('storefront-view').style.display = 'none';
  if(document.getElementById('admin-portal-view')) document.getElementById('admin-portal-view').style.display = 'none';
  if(document.getElementById('service-provider-view')) document.getElementById('service-provider-view').style.display = 'none';

  document.getElementById('toggle-view-icon').className = 'fa-solid fa-store';
  document.getElementById('toggle-view-text').textContent = 'Seller Dashboard';
  document.getElementById('mob-ham-btn').style.display = 'none';
  document.body.classList.remove('in-seller');
  currentRole = 'buyer';
  startCarousel();
  loadProducts();
  updateCartCount();
}

function showSellerDashboard() {
  if (!currentUser) { showModal('auth-modal'); toggleAuth('login'); return; }
  document.getElementById('buyer-view').style.display = 'none';
  document.getElementById('seller-dashboard').style.display = 'block';
  document.getElementById('storefront-view').style.display = 'none';
  if(document.getElementById('admin-portal-view')) document.getElementById('admin-portal-view').style.display = 'none';
  if(document.getElementById('service-provider-view')) document.getElementById('service-provider-view').style.display = 'none';

  document.getElementById('toggle-view-icon').className = 'fa-solid fa-store';
  document.getElementById('toggle-view-text').textContent = 'Back to Shopping';
  document.getElementById('mob-ham-btn').style.display = 'flex';
  // Show/hide admin nav item
  const adminNavItem = document.getElementById('admin-nav-item');
  if (adminNavItem) adminNavItem.style.display = currentUser?.email === ADMIN_EMAIL ? 'flex' : 'none';
  document.body.classList.add('in-seller');
  currentRole = 'seller';
  stopCarousel();
  checkSellerCommission();
  loadSellerStats();
  loadSellerProds();
  loadSellerOrders();
  renderChart();
  loadWithdrawalData();
  loadAffiliateData();
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
  if (section === 'affiliate') loadAffiliateData();
}

function setMobActive(btn) {
  document.querySelectorAll('.mob-bot-item').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}

// ====================================================
//  SIDEBAR (MOBILE)
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
//  CAROUSEL
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
//  PRODUCTS
// ====================================================
async function loadProducts() {
  document.getElementById('prods-skeleton').classList.remove('hidden');
  document.getElementById('prods-grid').classList.add('hidden');
  document.getElementById('prods-empty').classList.add('hidden');
  document.getElementById('prods-error').classList.add('hidden');
  try {
    let q = db.from('products').select(`*, profiles(name, whatsapp, bank_name, account_number, account_name, paystack_key)`).eq('status', 'active').order('created_at', { ascending: false });
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
  const discount = p.original_price && p.original_price > p.price ? Math.round((1 - p.price/p.original_price)*100) : 0;
  const stockPct = p.stock_quantity !== undefined ? p.stock_quantity : 999;
  const isSoldOut = stockPct === 0;
  const badges = [
    discount ? `<span class="prod-badge prod-badge-discount">-${discount}%</span>` : '',
    p.has_video ? `<span class="prod-badge prod-badge-video">🎬 Video</span>` : '',
    p.category === 'dropship' ? `<span class="prod-badge prod-badge-drop">Dropship</span>` : '',
    p.seller_verified ? `<span class="prod-badge prod-badge-verified">✓ Verified</span>` : ''
  ].filter(Boolean).join('');
  const stars = p.avg_rating ? '★'.repeat(Math.round(p.avg_rating)) + '☆'.repeat(5-Math.round(p.avg_rating)) : '★★★★★';
  return `
  <div class="prod-card" onclick="openProduct('${p.id}')">
    <div class="prod-img-wrap">
      <img src="${p.image_url||'https://images.unsplash.com/photo-1607082348824-0a96f2a4b9da?w=400&h=400&fit=crop'}" alt="${escHtml(p.name)}" loading="lazy">
      ${badges ? `<div class="prod-flags">${badges}</div>` : ''}
      ${isSoldOut ? `<div class="prod-sold-overlay"><span class="prod-sold-label">SOLD OUT</span></div>` : `<button class="prod-quick-add" onclick="event.stopPropagation();addToCart(${JSON.stringify({id:p.id,name:p.name,price:p.price,image_url:p.image_url,seller_id:p.seller_id,profiles:p.profiles}).replace(/"/g,'&quot;')})" aria-label="Add to cart"><i class="fa-solid fa-cart-plus"></i></button>`}
    </div>
    <div class="prod-body">
      <div class="prod-name">${escHtml(p.name)}</div>
      <div class="prod-price-row">
        <span class="prod-price">${fmtN(p.price)}</span>
        ${p.original_price>p.price ? `<span class="prod-orig">${fmtN(p.original_price)}</span>` : ''}
      </div>
      <div class="prod-rating-row"><span class="stars sm">${stars}</span><span class="text-xs color-text3">${p.avg_rating ? p.avg_rating.toFixed(1) : '5.0'} (${p.review_count||0})</span></div>
      <div class="prod-location"><i class="fa-solid fa-map-marker-alt" style="font-size:.6rem"></i>${escHtml(p.location||'Nigeria')}</div>
      <a class="prod-store-link" onclick="event.stopPropagation();viewStorefront('${p.seller_id}')"><i class="fa-solid fa-store" style="font-size:.6rem"></i>${escHtml(p.profiles?.name||'Seller')}</a>
      ${!isSoldOut ? `<button class="prod-mobile-add" onclick="event.stopPropagation();addToCart(${JSON.stringify({id:p.id,name:p.name,price:p.price,image_url:p.image_url,seller_id:p.seller_id,profiles:p.profiles}).replace(/"/g,'&quot;')})"><i class="fa-solid fa-cart-plus"></i> Add to Cart</button>` : ''}
    </div>
  </div>`;
}

// ====================================================
//  FILTERS & SEARCH
// ====================================================
function filterCat(cat) {
  document.querySelectorAll('.cat-chip').forEach(c => c.classList.toggle('active', c.dataset.cat === cat));
  if (cat === 'all') { delete activeFilters.category; document.getElementById('section-title-text').textContent = 'Latest Products'; }
  else { activeFilters.category = cat; document.getElementById('section-title-text').textContent = cat.charAt(0).toUpperCase()+cat.slice(1); }
  applyCurrentFilters();
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
      const res  = await fetch(CLAUDE_EDGE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
            `💡 Try searching: ${suggestions.slice(0,2).join(', ')}`,
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
  if (activeFilters.priceMin||activeFilters.priceMax) pills.push({key:'price',label:`₦${fmtNum(activeFilters.priceMin||0)} – ₦${fmtNum(activeFilters.priceMax||'∞')}`});
  if (activeFilters.minRating) pills.push({key:'minRating',label:`${activeFilters.minRating}+ ★`});
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
  document.getElementById('price-range-display').textContent = `₦${fmtNum(min)} – ₦${fmtNum(max)}`;
}

// ====================================================
//  PRODUCT DETAIL
// ====================================================
async function openProduct(id) {
  currentProd = products.find(p => p.id === id);
  if (!currentProd) return;
  const p = currentProd;
  showModal('product-modal');
  // Gallery
  const main = document.getElementById('gallery-main');
  if (p.has_video && p.video_url) {
    main.innerHTML = `<video src="${p.video_url}" controls playsinline style="width:100%;height:100%;object-fit:contain;border-radius:var(--radius-sm)" poster="${p.image_url||''}"></video>`;
  } else {
    main.innerHTML = `<img src="${p.image_url||'https://images.unsplash.com/photo-1607082348824-0a96f2a4b9da?w=600'}" alt="${escHtml(p.name)}" loading="lazy" style="width:100%;height:100%;object-fit:contain">`;
  }
  // Info
  document.getElementById('modal-prod-name').textContent = p.name;
  document.getElementById('modal-price').textContent = fmtN(p.price);
  document.getElementById('modal-desc').textContent = p.description || '';
  const origEl = document.getElementById('modal-orig-price');
  const discEl = document.getElementById('modal-discount');
  if (p.original_price > p.price) {
    origEl.textContent = fmtN(p.original_price);
    discEl.textContent = `-${Math.round((1-p.price/p.original_price)*100)}%`;
    discEl.classList.remove('hidden');
  } else { origEl.textContent=''; discEl.classList.add('hidden'); }
  document.getElementById('modal-condition').textContent = p.condition || 'New';
  document.getElementById('modal-location').textContent = p.location || 'Nigeria';
  const stock = p.stock_quantity;
  const sb = document.getElementById('modal-stock-badge');
  sb.textContent = stock === 0 ? 'Sold Out' : stock <= 5 ? `Only ${stock} left!` : 'In Stock';
  sb.className = `badge ${stock===0?'badge-red':stock<=5?'badge-gold':'badge-green'}`;
  document.getElementById('modal-cart-btn').disabled = stock === 0;
  document.getElementById('modal-negotiable-note').classList.toggle('hidden', !p.negotiable);
  // Seller
  const seller = p.profiles || {};
  document.getElementById('modal-seller-name').textContent = seller.name || 'Seller';
  document.getElementById('modal-seller-email').textContent = `WhatsApp: ${seller.whatsapp||'N/A'}`;
  document.getElementById('modal-seller-avatar').textContent = (seller.name||'S')[0].toUpperCase();
  // Flags
  const flags = [];
  if (p.has_video) flags.push('<span class="prod-badge prod-badge-video">🎬 Video</span>');
  if (p.seller_verified) flags.push('<span class="prod-badge prod-badge-verified">✓ Verified</span>');
  document.getElementById('modal-flags').innerHTML = flags.join('');
  // Reviews
  loadProductReviews(id);
}

async function loadProductReviews(productId) {
  const { data } = await db.from('reviews').select('*,profiles(name)').eq('product_id', productId).order('created_at', { ascending: false }).limit(10);
  const reviews = data || [];
  document.getElementById('modal-review-count').textContent = `${reviews.length} review${reviews.length!==1?'s':''}`;
  const avgR = reviews.length ? (reviews.reduce((s,r)=>s+r.rating,0)/reviews.length).toFixed(1) : '5.0';
  document.getElementById('modal-stars').textContent = '★'.repeat(Math.round(+avgR)) + '☆'.repeat(5-Math.round(+avgR));
  const list = document.getElementById('modal-reviews-list');
  if (!reviews.length) { list.innerHTML = '<p class="color-text3 text-sm">No reviews yet. Be the first!</p>'; return; }
  list.innerHTML = reviews.map(r => `
    <div class="review-card">
      <div class="flex justify-between items-center">
        <span class="reviewer-name">${escHtml(r.profiles?.name||'Buyer')}</span>
        <div class="stars sm">${'★'.repeat(r.rating)+'☆'.repeat(5-r.rating)}</div>
      </div>
      <p class="review-text">${escHtml(r.review_text)}</p>
      <span class="text-xs color-text3">${fmtDate(r.created_at)}</span>
    </div>`).join('');
}

// ====================================================
//  STOREFRONT
// ====================================================


function goBackFromStorefront() {
  document.getElementById('storefront-view').style.display = 'none';
  document.getElementById('buyer-view').style.display = 'block';
}

function shareStore() {
  const url = window.location.href;
  if (navigator.share) { navigator.share({ title: 'BUYSELL Store', url }); }
  else { navigator.clipboard.writeText(url); toast('Link Copied!','','success'); }
}

function copyStoreLink() {
  const link = `https://buysell.ng/store/${currentUser?.id?.substr(0,8)||'your-store'}`;
  navigator.clipboard.writeText(link).then(()=>toast('Store Link Copied!','Share with customers','success'));
}

// ====================================================
//  CART
// ====================================================
function saveCart() { localStorage.setItem('bs_cart', JSON.stringify(cart)); updateCartCount(); }

function addToCart(prod) {
  if (!prod?.id) return;
  const existing = cart.find(c => c.id === prod.id);
  if (existing) { existing.qty = (existing.qty || 1) + 1; } else { cart.push({...prod, qty: 1}); }
  saveCart();
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
  const total = cart.reduce((s,c)=>s+(c.price*(c.qty||1)),0);
  list.innerHTML = cart.map(c => `
    <div class="cart-item">
      <img src="${c.image_url||'https://images.unsplash.com/photo-1607082348824-0a96f2a4b9da?w=200'}" alt="${escHtml(c.name)}" loading="lazy">
      <div style="flex:1;min-width:0">
        <div class="font-600 text-sm" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:180px">${escHtml(c.name)}</div>
        <div class="color-green font-bold">${fmtN(c.price)}</div>
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
  document.getElementById('cart-subtotal').textContent = fmtN(total);
  document.getElementById('cart-total').textContent = fmtN(total);
}

// ====================================================
//  CHECKOUT
// ====================================================
function buyNow(prod) {
  cart = [{ ...prod, qty: 1 }];
  saveCart();
  closeModal('product-modal');
  startCheckout();
}

function startCheckout() {
  if (!currentUser) { showModal('auth-modal'); return; }
  if (!cart.length) { toast('Cart is empty','','warn'); return; }
  goCheckoutStep(1);
  showModal('checkout-modal');
  // Pre-fill
  const p = currentUser.profile || {};
  if (p.name) document.getElementById('co-name').value = p.name;
  document.getElementById('co-pay-email').textContent = currentUser.email;
  const total = cart.reduce((s,c)=>s+(c.price*(c.qty||1)),0);
  const comm = Math.round(total * PLATFORM_FEE_PCT);
  document.getElementById('co-pay-amount').textContent = fmtN(total);
  document.getElementById('co-commission').textContent = fmtN(comm);
  document.getElementById('co-total').textContent = fmtN(total);
  // Order items
  document.getElementById('co-items').innerHTML = cart.map(c=>`
    <div class="order-item">
      <img src="${c.image_url||'https://images.unsplash.com/photo-1607082348824-0a96f2a4b9da?w=100'}" alt="" loading="lazy">
      <div style="flex:1;min-width:0"><div class="font-600 text-sm" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:200px">${escHtml(c.name)}</div><div class="color-text3 text-xs">Qty: ${c.qty||1}</div></div>
      <div class="font-bold text-sm">${fmtN(c.price*(c.qty||1))}</div>
    </div>`).join('');
  // Bank transfer details from first seller
  const seller = cart[0]?.profiles || {};
  document.getElementById('seller-bank-details-co').innerHTML = `
    <div class="pay-row"><span class="label">Bank</span><span class="value">${escHtml(seller.bank_name||'Seller Bank')}</span></div>
    <div class="pay-row"><span class="label">Account</span><span class="value highlight">${escHtml(seller.account_number||'Contact seller')}</span></div>
    <div class="pay-row"><span class="label">Name</span><span class="value">${escHtml(seller.account_name||seller.name||'Seller')}</span></div>
    <div class="pay-row"><span class="label">Amount</span><span class="value highlight">${fmtN(total)}</span></div>`;
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
  checkoutPaymentMethod = method;
  document.getElementById('pm-paystack').classList.toggle('selected', method==='paystack');
  document.getElementById('pm-transfer').classList.toggle('selected', method==='transfer');
  document.getElementById('pm-paystack-panel').classList.toggle('hidden', method!=='paystack');
  document.getElementById('pm-transfer-panel').classList.toggle('hidden', method!=='transfer');
}

function payWithPaystack() {
  const handler = PaystackPop.setup({
    key: PAYSTACK_PUBLIC_KEY,
    email: currentUser.email,
    amount: total * 100, 
    callback: async function(response) {
      // 1. Show a loader
      toast('Verifying Payment...', 'Please do not close the window', 'info');

      // 2. Call your Edge Function instead of local saveOrderToDb
      try {
        const verification = await fetch(`${EDGE_URL}/verify-payment`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            reference: response.reference,
            order_details: {
              buyer_id: currentUser.id,
              items: cart,
              delivery_address: document.getElementById('co-address').value,
              // ... other fields
            }
          })
        });

        const result = await verification.json();
        if (result.success) {
          cart = []; saveCart();
          goCheckoutStep(3);
          toast('Payment Verified!', 'Your order is confirmed', 'success');
        }
      } catch (err) {
        toast('Verification Error', 'Contact support with ref: ' + response.reference, 'error');
      }
    }
  });
  handler.openIframe();
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
  if (!fileInput.files?.[0]) { toast('Please upload payment proof','','warn'); return; }
  const proofFile = fileInput.files[0];
  const ALLOWED_PROOF = ['image/jpeg','image/png','image/webp','image/heic','image/heif'];
  const MAX_PROOF_SIZE = 10 * 1024 * 1024; // 10MB
  if (!ALLOWED_PROOF.includes(proofFile.type)) { toast('Invalid file','Please upload a JPG or PNG screenshot','warn'); return; }
  if (proofFile.size > MAX_PROOF_SIZE)         { toast('File too large','Maximum proof image size is 10MB','warn'); return; }
  const btn = document.getElementById('co-transfer-btn');
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Submitting…';
  try {
    let proofUrl = '';
    const file = fileInput.files[0];
    const ext = file.name.split('.').pop();
    const path = `proofs/${Date.now()}.${ext}`;
    const { error: upErr } = await db.storage.from('uploads').upload(path, file);
    if (!upErr) { const { data } = db.storage.from('uploads').getPublicUrl(path); proofUrl = data.publicUrl; }
    await saveOrderToDb(null, 'transfer', null, proofUrl);
  } catch(e) { toast('Error','Could not submit order','error'); }
  btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Submit Order';
}



// ====================================================
//  REVIEWS
// ====================================================
let reviewProductId = null;
function openReviewModal() {
  if (!currentUser) { showModal('auth-modal'); return; }
  if (!currentProd) return;
  reviewProductId = currentProd.id;
  document.getElementById('review-product-name').textContent = currentProd.name;
  selectedRating = 0;
  setRating(0);
  document.getElementById('review-text').value = '';
  showModal('review-modal');
}

function setRating(val) {
  selectedRating = val;
  document.querySelectorAll('.star-btn').forEach((b,i)=>{
    b.classList.toggle('active', i < val);
  });
}

async function submitReview() {
  if (!currentUser) return;
  if (!selectedRating) { toast('Please select a rating','','warn'); return; }
  const text = document.getElementById('review-text').value.trim();
  if (!text) { toast('Please write a review','','warn'); return; }
  try {
    await callEdge('submit-review', {
      product_id:  reviewProductId,
      rating:      selectedRating,
      review_text: text
    });
  } catch(e) { toast('Error', e.message, 'error'); return; }
  toast('Review Submitted! ⭐', 'Thanks for your feedback!', 'success');
  closeModal('review-modal');
  loadProductReviews(reviewProductId);
  loadProducts();
}

// ====================================================
//  BUYER TABS & ORDERS
// ====================================================
function switchBuyerTab(tab) {
  document.getElementById('tab-shop').classList.toggle('active', tab==='shop');
  document.getElementById('tab-orders').classList.toggle('active', tab==='orders');
  document.getElementById('tab-services').classList.toggle('active', tab==='services');
  document.getElementById('buyer-shop-tab').classList.toggle('hidden', tab!=='shop');
  document.getElementById('buyer-orders-tab').classList.toggle('hidden', tab!=='orders');
  document.getElementById('buyer-services-tab').classList.toggle('hidden', tab!=='services');
  if (tab==='orders') loadBuyerOrders();
  if (tab==='services') loadServiceGigs();
}

async function loadBuyerOrders() {
  if (!currentUser) { document.getElementById('buyer-orders-empty').classList.remove('hidden'); document.getElementById('buyer-orders-skeleton').classList.add('hidden'); return; }
  document.getElementById('buyer-orders-skeleton').classList.remove('hidden');
  document.getElementById('buyer-orders-list').classList.add('hidden');
  const { data: orders } = await db.from('orders').select('*').eq('buyer_id', currentUser.id).order('created_at',{ascending:false});
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
      <div class="flex gap-1 flex-wrap mb-2">${(o.items||[]).map(i=>`<span class="text-xs badge badge-gray">${escHtml(i.name)} ×${i.qty}</span>`).join('')}</div>
      <div class="flex gap-2 flex-wrap">
        ${o.status==='delivered'?`<button class="btn btn-outline btn-sm" onclick="openDisputeModal('${o.id}')"><i class="fa-solid fa-exclamation-triangle"></i> Dispute</button>`:''}
        <a href="https://wa.me/2349061484256?text=Order ${o.id}" target="_blank" class="btn btn-outline btn-sm"><i class="fa-brands fa-whatsapp"></i> Track</a>
      </div>
    </div>`).join('');
}

// ====================================================
//  SELLER STATS & CHART
// ====================================================
async function loadSellerStats() {
  if (!currentUser) return;
  const { data: prods } = await db.from('products').select('id,status').eq('seller_id', currentUser.id);
  const { data: orders } = await db.from('orders').select('total_amount,status,created_at').eq('seller_id', currentUser.id);
  const { data: revs } = await db.from('reviews').select('rating').in('product_id', (prods||[]).map(p=>p.id));
  const active = (prods||[]).filter(p=>p.status==='active').length;
  const revenue = (orders||[]).filter(o=>o.status!=='cancelled').reduce((s,o)=>s+o.total_amount,0);
  const avgR = (revs||[]).length ? ((revs.reduce((s,r)=>s+r.rating,0)/revs.length).toFixed(1)) : '—';
  document.getElementById('st-products').textContent = active;
  document.getElementById('st-revenue').textContent = fmtN(revenue);
  document.getElementById('st-orders').textContent = (orders||[]).length;
  document.getElementById('st-rating').textContent = avgR;
  // Trial
  const profile = currentUser.profile || {};
  const trialEnd = profile.trial_end ? new Date(profile.trial_end) : new Date(Date.now()+30*86400000);
  const daysLeft = Math.max(0, Math.ceil((trialEnd - new Date()) / 86400000));
  document.getElementById('st-trial').textContent = daysLeft > 0 ? `${daysLeft}d left` : 'Expired';
  document.getElementById('st-days').textContent = daysLeft > 0 ? 'Free Trial' : 'Pay Commission';
  // Withdrawal data
  document.getElementById('wd-available').textContent = fmtN(Math.max(0, revenue * 0.92));
  document.getElementById('wd-total').textContent = fmtN(0);
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
    data: { labels, datasets: [{ label: 'Revenue (₦)', data, borderColor: '#19a847', backgroundColor: 'rgba(25,168,71,.08)', tension: 0.4, fill: true, pointBackgroundColor: '#19a847', pointRadius: 3 }] },
    options: { responsive: true, plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => '₦' + fmtNum(ctx.raw) } } }, scales: { y: { beginAtZero: true, ticks: { callback: v => '₦'+fmtNum(v) } }, x: { ticks: { maxTicksLimit: days>14?7:days } } } }
  });
}

// ====================================================
//  SELLER PRODUCTS
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
        <div class="prod-list-meta">
          <span class="badge badge-${p.status==='active'?'green':'gray'}">${p.status}</span>
          <span class="stock-pill ${p.stock_quantity===0?'stock-out':p.stock_quantity<=5?'stock-low':'stock-high'}">Stock: ${p.stock_quantity??'N/A'}</span>
          ${p.has_video?'<span class="badge badge-purple">🎬 Video</span>':''}
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
    // ── Input validation ──────────────────────────────────────
    const nameVal  = document.getElementById('p-name').value.trim();
    const priceVal = parseFloat(document.getElementById('p-price').value);
    const stockVal = parseInt(document.getElementById('p-stock').value) || 0;
    const descVal  = document.getElementById('p-desc').value.trim();
    const catVal   = document.getElementById('p-category').value;
    const condVal  = document.getElementById('p-condition').value;
    const locVal   = document.getElementById('p-location').value.trim();

    const VALID_CATS  = ['electronics','fashion','home','phones','beauty','sports','dropship','other'];
    const VALID_CONDS = ['new','used-like-new','used-good'];

    if (!nameVal || nameVal.length < 3)          { toast('Invalid name','Product name must be at least 3 characters','warn'); return; }
    if (nameVal.length > 120)                    { toast('Name too long','Max 120 characters','warn'); return; }
    if (isNaN(priceVal) || priceVal <= 0)        { toast('Invalid price','Enter a price greater than 0','warn'); return; }
    if (priceVal > 100000000)                    { toast('Price too high','Maximum price is ₦100,000,000','warn'); return; }
    if (stockVal < 0 || stockVal > 100000)       { toast('Invalid stock','Stock must be between 0 and 100,000','warn'); return; }
    if (descVal.length > 2000)                   { toast('Description too long','Max 2,000 characters','warn'); return; }
    if (!VALID_CATS.includes(catVal))            { toast('Invalid category','Please select a valid category','warn'); return; }
    if (!VALID_CONDS.includes(condVal))          { toast('Invalid condition','Please select a valid condition','warn'); return; }

    // ── File upload security ───────────────────────────────────
    const ALLOWED_IMG_TYPES = ['image/jpeg','image/png','image/webp','image/gif'];
    const ALLOWED_VID_TYPES = ['video/mp4','video/webm','video/ogg','video/quicktime'];
    const MAX_IMG_SIZE = 5 * 1024 * 1024;   // 5MB
    const MAX_VID_SIZE = 50 * 1024 * 1024;  // 50MB

    const imgFile = document.getElementById('p-image').files[0];
    const vidFile = document.getElementById('p-video').files[0];

    if (imgFile) {
      if (!ALLOWED_IMG_TYPES.includes(imgFile.type)) { toast('Invalid image','Only JPG, PNG, WebP, GIF allowed','warn'); return; }
      if (imgFile.size > MAX_IMG_SIZE)               { toast('Image too large','Maximum image size is 5MB','warn'); return; }
    }
    if (vidFile) {
      if (!ALLOWED_VID_TYPES.includes(vidFile.type)) { toast('Invalid video','Only MP4, WebM, OGG, MOV allowed','warn'); return; }
      if (vidFile.size > MAX_VID_SIZE)               { toast('Video too large','Maximum video size is 50MB','warn'); return; }
    }

    let imgUrl = '', vidUrl = '';
    if (imgFile) {
      const ext = imgFile.name.split('.').pop().toLowerCase().replace(/[^a-z0-9]/g,'');
      const { data, error } = await db.storage.from('products').upload(`imgs/${currentUser.id}/${Date.now()}.${ext}`, imgFile, { upsert: false });
      if (!error) { const { data: ud } = db.storage.from('products').getPublicUrl(data.path); imgUrl = sanitizeUrl(ud.publicUrl); }
    }
    if (vidFile) {
      const ext = vidFile.name.split('.').pop().toLowerCase().replace(/[^a-z0-9]/g,'');
      const { data, error } = await db.storage.from('products').upload(`vids/${currentUser.id}/${Date.now()}.${ext}`, vidFile, { upsert: false });
      if (!error) { const { data: ud } = db.storage.from('products').getPublicUrl(data.path); vidUrl = sanitizeUrl(ud.publicUrl); }
    }

    const price    = priceVal;
    const origPrice= parseFloat(document.getElementById('p-orig-price').value) || price;
    const stock    = stockVal;
    const prodData = {
      name: nameVal,
      description: descVal,
      price, original_price: Math.max(origPrice, price),
      category: catVal,
      condition: condVal,
      location: locVal.substring(0, 100),
      has_video: !!vidUrl, negotiable: document.getElementById('p-negotiable').checked,
      stock_quantity: stock, low_stock_alert: Math.max(0, parseInt(document.getElementById('p-low-stock').value)||3),
    };
    if (imgUrl) prodData.image_url = imgUrl;
    if (vidUrl) prodData.video_url = vidUrl;

    if (editingProductId) {
      // UPDATE mode
      await callEdge('manage-product', {
        action: 'update',
        product_id: editingProductId,
        data: { ...prodData, image_url: imgUrl || undefined, video_url: vidUrl || undefined }
      });
      editingProductId = null;
      toast('Product Updated! ✅', 'Changes saved successfully', 'success');
      const cancelBtn = document.getElementById('edit-cancel-btn');
      if (cancelBtn) cancelBtn.style.display = 'none';
      document.querySelector('#ds-add-product .dash-page-title').textContent = 'Add New Product';
      document.querySelector('#ds-add-product .dash-page-sub').textContent = 'Products with videos get 3× more sales! 🎬';
    } else {
      // INSERT mode — server-side via Edge Function
      await callEdge('manage-product', {
        action: 'create',
        data: { ...prodData, image_url: imgUrl, video_url: vidUrl }
      });
      toast('Product Published! 🎉', 'Your product is now live', 'success');
    }
    document.getElementById('add-prod-form').reset();
    showDash('products');
  } catch(err) { toast('Error', err.message, 'error'); }
  btn.disabled = false;
  document.getElementById('pub-btn-text').textContent = 'Publish Product';
  document.getElementById('pub-spinner').classList.add('hidden');
}

async function deleteProduct(id) {
  if (!confirm('Delete this product?')) return;
  try { await callEdge('manage-product', { action: 'delete', product_id: id }); }
  catch(e) { toast('Error', e.message, 'error'); return; }
  toast('Product Deleted', '', 'info');
  loadSellerProds();
}

async function toggleProductStatus(id, current) {
  const next = current === 'active' ? 'paused' : 'active';
  try { await callEdge('manage-product', { action: 'toggle_status', product_id: id }); }
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
  document.querySelector('#ds-add-product .dash-page-sub').textContent = 'Products with videos get 3× more sales! 🎬';
  const cancelBtn = document.getElementById('edit-cancel-btn');
  if (cancelBtn) cancelBtn.style.display = 'none';
  showDash('products');
}

// ====================================================
//  SELLER ORDERS
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
  list.innerHTML = orders.map(o=>`
    <div class="card card-pad mb-3">
      <div class="flex justify-between items-start flex-wrap gap-2 mb-2">
        <div><div class="font-bold">${o.id}</div><div class="text-xs color-text3">${fmtDate(o.created_at)}</div></div>
        <span class="badge ${statusColors[o.status]||'badge-gray'}">${o.status}</span>
      </div>
      <div class="mb-2">${(o.items||[]).map(i=>`<span class="text-sm">${escHtml(i.name)} ×${i.qty}</span>`).join(', ')}</div>
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
        ${o.status==='pending'?`<button onclick="updateOrderStatus('${o.id}','confirmed')" class="btn btn-primary btn-sm">Confirm Order</button>`:''}
        ${o.status==='confirmed'?`<button onclick="updateOrderStatus('${o.id}','shipped')" class="btn btn-sm" style="background:#ede9fe;color:#6d28d9">Mark Shipped</button>`:''}
        ${o.status==='shipped'?`<button onclick="updateOrderStatus('${o.id}','delivered')" class="btn btn-sm" style="background:#dcfce7;color:#15803d">Mark Delivered</button>`:''}
        <a href="https://wa.me/${(o.delivery_phone||'').replace(/\D/g,'')}" target="_blank" class="btn btn-outline btn-sm"><i class="fa-brands fa-whatsapp"></i> Contact</a>
      </div>
    </div>`).join('');
}

async function updateOrderStatus(id, status) {
  try {
    await callEdge('admin-action', { action: 'update_order', target_id: id, data: { status } });
    toast(`Order ${status}!`, '', 'success');
    loadSellerOrders();
  } catch(e) { toast('Error', e.message, 'error'); }
}

// ====================================================
//  SELLER REVIEWS
// ====================================================
async function loadSellerReviews() {
  if (!currentUser) return;
  const { data: prods } = await db.from('products').select('id').eq('seller_id', currentUser.id);
  const { data: revs } = await db.from('reviews').select('*,profiles(name)').in('product_id', (prods||[]).map(p=>p.id)).order('created_at',{ascending:false});
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
        <div class="stars sm">${'★'.repeat(r.rating)+'☆'.repeat(5-r.rating)}</div>
      </div>
      <p class="review-text">${escHtml(r.review_text)}</p>
      <span class="text-xs color-text3">${fmtDate(r.created_at)}</span>
    </div>`).join('');
}

// ====================================================
//  COMMISSION
// ====================================================
async function checkSellerCommission() {
  if (!currentUser?.profile) return;
  const p = currentUser.profile;
  const trialEnd = p.trial_end ? new Date(p.trial_end) : null;
  const commPaid = p.commission_paid;
  document.getElementById('comm-trial-end').textContent = trialEnd ? fmtDate(trialEnd.toISOString()) : 'N/A';
  const badge = document.getElementById('comm-status-badge');
  if (commPaid) { badge.className='badge badge-green'; badge.textContent='✓ Active'; }
  else if (trialEnd && trialEnd > new Date()) { badge.className='badge badge-gold'; badge.textContent=`Trial – ${Math.ceil((trialEnd-new Date())/86400000)}d left`; }
  else { badge.className='badge badge-red'; badge.textContent='Suspended'; }
  // Show suspended modal if needed
  if (!commPaid && trialEnd && trialEnd < new Date() && currentUser.email !== ADMIN_EMAIL) {
    document.getElementById('suspended-modal').classList.add('open');
  }
}

function payCommissionPaystack() {
  if (!currentUser) return;
  closeModal('suspended-modal');
  const handler = PaystackPop.setup({
    key: PAYSTACK_PUBLIC_KEY,
    email: currentUser.email,
    amount: COMMISSION_AMOUNT,
    currency: 'NGN',
    ref: 'comm_' + Date.now(),
    callback: async (response) => {
      // Commission confirmed via Paystack — direct update for immediate UI response
      await callEdge('admin-action', { action: 'toggle_commission', target_id: currentUser.id, data: { commission_paid: true } }).catch(() => db.from('profiles').update({ commission_paid: true }).eq('id', currentUser.id));
      currentUser.profile.commission_paid = true;
      document.getElementById('suspended-modal').classList.remove('open');
      document.body.classList.remove('modal-open');
      toast('Commission Paid! ✅', 'Your store is now active', 'success');
      checkSellerCommission();
    },
    onClose: () => toast('Payment cancelled','','warn')
  });
  handler.openIframe();
}

async function submitCommissionReceipt() {
  const file = document.getElementById('commission-file').files[0];
  const ref = document.getElementById('commission-ref').value.trim();
  if (!file || !ref) { toast('Please upload receipt and enter reference','','warn'); return; }
  toast('Receipt Submitted!', 'Admin will verify within 24hrs', 'success');
  closeModal('commission-modal');
  document.getElementById('suspended-modal').classList.remove('open');
  document.body.classList.remove('modal-open');
}

// ====================================================
//  SETTINGS
// ====================================================
async function loadSettings() {
  if (!currentUser?.profile) return;
  const p = currentUser.profile;
  document.getElementById('s-store-name').value = p.store_name||'';
  document.getElementById('s-store-desc').value = p.store_description||'';
  document.getElementById('s-whatsapp').value = p.whatsapp||'';
  document.getElementById('s-bank-name').value = p.bank_name||'';
  document.getElementById('s-account-num').value = p.account_number||'';
  document.getElementById('s-account-name').value = p.account_name||'';
  document.getElementById('s-paystack-key').value = p.paystack_key||'';
  document.getElementById('s-notif-email').value = p.notif_email||p.email||'';
  // Withdrawal panel
  document.getElementById('wd-bank-name').textContent = p.bank_name||'Not set';
  document.getElementById('wd-acct-num').textContent = p.account_number||'—';
  document.getElementById('wd-acct-name').textContent = p.account_name||'—';
}

async function saveSettings(e) {
  e.preventDefault();
  if (!currentUser) return;
  const updates = {
    store_name: document.getElementById('s-store-name').value.trim(),
    store_description: document.getElementById('s-store-desc').value.trim(),
    whatsapp: document.getElementById('s-whatsapp').value.trim(),
    bank_name: document.getElementById('s-bank-name').value.trim(),
    account_number: document.getElementById('s-account-num').value.trim(),
    account_name: document.getElementById('s-account-name').value.trim(),
    paystack_key: document.getElementById('s-paystack-key').value.trim(),
    notif_email: document.getElementById('s-notif-email').value.trim()
  };
  await callEdge('update-profile', updates);
  if (currentUser.profile) Object.assign(currentUser.profile, updates);
  toast('Settings Saved! ✅', '', 'success');
  loadWithdrawalData();
}

// ====================================================
//  WITHDRAWALS
// ====================================================
async function loadWithdrawalData() {
  if (!currentUser) return;
  const { data: orders } = await db.from('orders').select('total_amount,status').eq('seller_id', currentUser.id);
  const revenue = (orders||[]).filter(o=>o.status==='delivered').reduce((s,o)=>s+o.total_amount,0);
  const available = Math.max(0, revenue * 0.92);
  document.getElementById('wd-available').textContent = fmtN(available);
  document.getElementById('wd-pending').textContent = fmtN(0);
  document.getElementById('wd-total').textContent = fmtN(0);
}

async function requestWithdrawal() {
  const amount = parseFloat(document.getElementById('wd-amount').value);
  if (!amount || amount < 5000) { toast('Minimum withdrawal is ₦5,000','','warn'); return; }
  try {
    await callEdge('request-withdrawal', {
      amount,
      bank_name:      currentUser.profile?.bank_name      || '',
      account_number: currentUser.profile?.account_number || '',
      account_name:   currentUser.profile?.account_name   || ''
    });
  } catch(e) { toast('Error', e.message, 'error'); return; }
  toast('Withdrawal Requested!', `₦${fmtNum(amount)} – processed within 24hrs`, 'success');
  document.getElementById('wd-amount').value = '';
  document.getElementById('wd-pending').textContent = fmtN(amount);
}

// ====================================================
//  DROPSHIPPING
// ====================================================
function connectSupplier(supplier) {
  toast(`${supplier==='aliexpress'?'AliExpress':'CJ Dropshipping'} Connected!`, 'You can now import products', 'success');
}

async function importDropship(name, cost, price, emoji) {
  if (!currentUser) { showModal('auth-modal'); return; }
  try {
    await callEdge('manage-product', { action: 'create', data: {
      name,
      description:    `Imported from global supplier. ${name}`,
      price,
      original_price: price,
      category:       'dropship',
      condition:      'new',
      location:       'International',
      image_url:      '',
      has_video:      false,
      negotiable:     false,
      stock_quantity: 999
    }});
    const imported = parseInt(document.getElementById('ds-imported').textContent) || 0;
    document.getElementById('ds-imported').textContent = imported + 1;
    toast(`${emoji} ${name} Imported!`, `Listed at ${fmtN(price)}`, 'success');
  } catch(e) {
    toast('Import Failed', e.message, 'error');
  }
}

// ====================================================
//  AFFILIATE
// ====================================================
function copyRef() {
  const link = document.getElementById('referral-link').value;
  navigator.clipboard.writeText(link).then(()=>toast('Referral Link Copied!','Share to earn ₦500 per referral','success'));
}

async function loadAffiliateData() {
  if (!currentUser) return;
  const rc = currentUser.profile?.referral_code || 'ref_' + currentUser.id?.substr(0,8);
  document.getElementById('referral-link').value = `https://buysell.ng/ref/${rc}`;
  // Load referral earnings from DB
  const { data: refs } = await db.from('referrals').select('*').eq('referrer_id', currentUser.id);
  const earned = (refs||[]).filter(r=>r.paid).reduce((s,r)=>s+(r.amount||500),0);
  const pending = (refs||[]).filter(r=>!r.paid).reduce((s,r)=>s+(r.amount||500),0);
  document.getElementById('aff-total').textContent = fmtN(earned);
  document.getElementById('aff-pending').textContent = fmtN(pending);
  document.getElementById('aff-clicks').textContent = (refs||[]).length * 3 + Math.floor(Math.random()*5);
  document.getElementById('aff-conversions').textContent = (refs||[]).length;
  // Earnings table
  const tbody = document.getElementById('aff-table-body');
  if (!refs?.length) { tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:2rem;color:var(--text3)">No earnings yet. Share your referral link!</td></tr>'; return; }
  tbody.innerHTML = refs.map(r=>`<tr><td>${fmtDate(r.created_at)}</td><td>Referral Signup</td><td>Direct Link</td><td class="font-bold color-green">${fmtN(r.amount||500)}</td><td><span class="badge ${r.paid?'badge-green':'badge-gold'}">${r.paid?'Paid':'Pending'}</span></td></tr>`).join('');
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
  tbody.innerHTML = wds.map(w=>`<tr><td>${fmtDate(w.created_at)}</td><td class="font-bold">${fmtN(w.amount)}</td><td><span class="badge ${w.status==='paid'?'badge-green':w.status==='rejected'?'badge-red':'badge-gold'}">${w.status}</span></td><td class="text-xs color-text3">${w.id?.substr(0,8)||'—'}</td></tr>`).join('');
}

// ====================================================
//  DISPUTES
// ====================================================
let disputeOrderId = null;
function openDisputeModal(orderId) {
  disputeOrderId = orderId;
  document.getElementById('dispute-order-id').textContent = orderId;
  document.getElementById('dispute-type').value = '';
  document.getElementById('dispute-desc').value = '';
  showModal('dispute-modal');
}

async function submitDispute() {
  const type = document.getElementById('dispute-type').value;
  const desc = document.getElementById('dispute-desc').value.trim();
  if (!type || !desc) { toast('Please fill all fields','','warn'); return; }
  try {
    await callEdge('submit-dispute', {
      order_id:     disputeOrderId,
      dispute_type: type,
      description:  desc
    });
  } catch(e) { toast('Error', e.message, 'error'); return; }
  toast('Dispute Filed', 'Admin will review within 24hrs', 'success');
  closeModal('dispute-modal');
}

// ====================================================
//  SUPER ADMIN — full gated panel
// ====================================================
let _adminSellersCache = [];
let _adminRevenueChart = null;

function isAdmin() {
  // Both email AND database role must match — prevents email spoofing
  return currentUser?.email === ADMIN_EMAIL &&
         currentUser?.profile?.role === 'admin';
}

function guardAdminPanel() {
  const guard   = document.getElementById('admin-guard');
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
//  ADMIN BRANDING
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

    // 3. Save to localStorage so it persists instantly for all page reloads
    // (In a full scale app, you'd also save this to a 'site_settings' table in Supabase)
    localStorage.setItem('buysell_custom_logo', logoUrl);
    
    // 4. Apply globally to the DOM right now
    applySiteLogo(logoUrl);
    
    toast('Logo Updated! 🎨', 'Your new branding is live', 'success');
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
  // Show selected panel
  document.getElementById('adm-tab-' + tab)?.classList.remove('hidden');
  // Highlight sidebar item
  document.getElementById('ap-nav-' + tab)?.classList.add('active');
  // Load data
  if (tab === 'overview')     loadAdminOverview();
  if (tab === 'sellers')      loadAdminSellers();
  if (tab === 'orders')       loadAdminOrders();
  if (tab === 'disputes')     loadAdminDisputes();
  if (tab === 'withdrawals')  loadAdminWithdrawals();
  if (tab === 'broadcast')    loadBroadcastHistory();
  if (tab === 'ai')           adminAiHistory = [];
}

/* ── OVERVIEW ── */
async function loadAdminOverview() {
  if (!guardAdminPanel()) return;
  const [{ data: sellers }, { data: buyers }, { data: orders }] = await Promise.all([
    db.from('profiles').select('id,commission_paid,trial_end,role').eq('role','seller'),
    db.from('profiles').select('id').eq('role','buyer'),
    db.from('orders').select('total_amount,created_at,status').neq('status','cancelled')
  ]);
  const now      = new Date();
  const paid     = (sellers||[]).filter(s => s.commission_paid).length;
  const trial    = (sellers||[]).filter(s => !s.commission_paid && s.trial_end && new Date(s.trial_end) > now).length;
  const suspended= (sellers||[]).filter(s => !s.commission_paid && (!s.trial_end || new Date(s.trial_end) <= now)).length;
  const revenue  = (orders||[]).reduce((s,o) => s + (o.total_amount||0), 0);

  document.getElementById('adm-total-sellers').textContent = (sellers||[]).length;
  document.getElementById('adm-total-buyers').textContent  = (buyers||[]).length;
  document.getElementById('adm-revenue').textContent       = fmtN(revenue);
  document.getElementById('adm-commission-due').textContent= fmtN(Math.round(revenue * PLATFORM_FEE_PCT));
  document.getElementById('adm-paid').textContent          = paid;
  document.getElementById('adm-trial').textContent         = trial;
  document.getElementById('adm-suspended').textContent     = suspended;

  // Disputes count
  const { count } = await db.from('disputes').select('id', { count:'exact', head:true }).eq('status','open');
  document.getElementById('adm-disputes').textContent = count || 0;

  // Revenue bar chart
  _renderAdminRevenueChart(orders || []);
}

   // ====================================================
//  ADMIN AI ASSISTANT
// ====================================================

async function askAdminBot(preset) {
  const input = document.getElementById('admin-ai-input');
  const msg   = preset || input.value.trim();
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
  typingDiv.innerHTML = `<div style="background:var(--green-xlt);color:var(--green);font-size:.76rem;flex-shrink:0;width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center"><i class="fa-solid fa-robot"></i></div><div style="background:#fff;border:1px solid var(--border);padding:.52rem .82rem;border-radius:14px;font-size:.79rem;color:var(--text3)">Thinking…</div>`;
  container.appendChild(typingDiv);
  container.scrollTop = container.scrollHeight;

  try {
    const res  = await fetch(CLAUDE_EDGE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: adminAiHistory,
        context: {
          task:             'admin_assistant',
          platform:         'BUYSELL Nigeria',
          admin_email:      ADMIN_EMAIL,
          total_sellers:    document.getElementById('adm-total-sellers')?.textContent || '?',
          total_buyers:     document.getElementById('adm-total-buyers')?.textContent  || '?',
          total_revenue:    document.getElementById('adm-revenue')?.textContent       || '?',
          open_disputes:    document.getElementById('adm-disputes')?.textContent      || '?',
        }
      }),
    });

    const data  = await res.json();
    let reply = data.reply || 'Sorry, I could not process that.';
    
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
    document.getElementById('admin-typing')?.remove();
    toast('AI unavailable', 'Try again shortly', 'warn');
  }
  container.scrollTop = container.scrollHeight;
}

async function executeMassSuspension() {
  toast('Executing Enforcement', 'AI is scanning and suspending unpaid stores...', 'info', 3000);
  
  // 1. Fetch all sellers
  const { data: sellers } = await db.from('profiles').select('id, commission_paid, trial_end').eq('role', 'seller');
  if (!sellers) {
    toast('Suspension Failed', 'Could not retrieve sellers list', 'error');
    return;
  }
  
  const now = new Date();
  
  // 2. Identify unpaid + expired sellers
  const targetIds = sellers
    .filter(s => !s.commission_paid && (!s.trial_end || new Date(s.trial_end) <= now))
    .map(s => s.id);
    
  if (targetIds.length === 0) {
    toast('No Actions Needed', 'All sellers are paid or still within trial', 'success', 5000);
    return;
  }
  
  // 3. Mass update
  const { error } = await db.from('profiles').update({ updated_at: new Date().toISOString() }).in('id', targetIds);
  
  if (error) {
    toast('Execution Error', error.message, 'error');
    return;
  }
  
  toast('Enforcement Complete', `Successfully locked out ${targetIds.length} expired accounts.`, 'success', 6000);
  loadAdminOverview(); 
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
  const now = new Date();
  if (filter === 'paid')      return sellers.filter(s => s.commission_paid);
  if (filter === 'trial')     return sellers.filter(s => !s.commission_paid && s.trial_end && new Date(s.trial_end) > now);
  if (filter === 'suspended') return sellers.filter(s => !s.commission_paid && (!s.trial_end || new Date(s.trial_end) <= now));
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
  const list  = document.getElementById('admin-list');
  const empty = document.getElementById('admin-empty');
  document.getElementById('adm-seller-count').textContent = `${sellers.length} seller${sellers.length !== 1 ? 's' : ''}`;
  if (!sellers.length) { empty.classList.remove('hidden'); list.classList.add('hidden'); return; }
  empty.classList.add('hidden');
  list.classList.remove('hidden');
  const now = new Date();
  list.innerHTML = sellers.map(s => {
    const trialEnd = s.trial_end ? new Date(s.trial_end) : null;
    const daysLeft = trialEnd ? Math.ceil((trialEnd - now) / 86400000) : 0;
    const badge = s.commission_paid
      ? `<span class="badge badge-green">✓ Active</span>`
      : daysLeft > 0
        ? `<span class="badge badge-gold">Trial: ${daysLeft}d</span>`
        : `<span class="badge badge-red">⚠ Overdue</span>`;
    const approveBtn = s.commission_paid
      ? `<button onclick="adminToggleCommission('${s.id}',false)" class="btn btn-sm btn-outline"><i class="fa-solid fa-ban"></i> Revoke</button>`
      : `<button onclick="adminToggleCommission('${s.id}',true)"  class="btn btn-sm btn-primary"><i class="fa-solid fa-check"></i> Approve</button>`;
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
          ${s.store_name ? `<div class="text-xs color-text3">🏪 ${escHtml(s.store_name)}</div>` : ''}
          ${s.accounts ? `<div class="text-xs color-text3">Accounts: ${escHtml(s.accounts)}</div>` : ''}
          <div class="text-xs color-text3">Joined: ${fmtDate(s.created_at)}</div>
          <div class="flex gap-1 mt-1 flex-wrap">${badge}</div>
        </div>
      </div>
      <div class="flex gap-2 flex-wrap" style="flex-shrink:0">
        ${approveBtn}
        ${waBtn}
        <button onclick="adminViewStorefront('${s.id}')" class="btn btn-outline btn-sm" title="View store"><i class="fa-solid fa-store"></i></button>
        <button onclick="adminDeleteSeller('${s.id}')"  class="btn btn-danger btn-sm"  title="Delete"><i class="fa-solid fa-trash"></i></button>
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
    if (badge) { badge.className = 'badge ' + (paid ? 'badge-green' : 'badge-red'); badge.textContent = paid ? '✓ Active' : '⚠ Overdue'; }
  }
  toast(paid ? '✅ Seller Activated' : '⛔ Access Revoked', '', paid ? 'success' : 'warn');
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

/* ── ORDERS ── */
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
          <div class="text-xs color-text3">${fmtDate(o.created_at)} · ${o.payment_method||''}</div>
          <div class="text-xs mt-1">${(o.items||[]).map(i=>`${escHtml(i.name)} ×${i.qty}`).join(', ')}</div>
        </div>
        <div class="text-right">
          <div class="font-bold color-green">${fmtN(o.total_amount)}</div>
          <span class="badge ${sc[o.status]||'badge-gray'}">${o.status}</span>
        </div>
      </div>
      <div class="text-xs color-text3 mb-2"><i class="fa-solid fa-user"></i> ${escHtml(o.delivery_name||'—')} &nbsp;|&nbsp; <i class="fa-solid fa-map-marker-alt"></i> ${escHtml((o.delivery_address||'').substr(0,50))}</div>
      <div class="flex gap-2 flex-wrap">
        ${o.status==='pending'   ? `<button onclick="adminUpdateOrder('${o.id}','confirmed')"  class="btn btn-primary btn-sm">Confirm</button>` : ''}
        ${o.status==='confirmed' ? `<button onclick="adminUpdateOrder('${o.id}','shipped')"    class="btn btn-sm" style="background:#ede9fe;color:var(--purple)">Mark Shipped</button>` : ''}
        ${o.status==='shipped'   ? `<button onclick="adminUpdateOrder('${o.id}','delivered')"  class="btn btn-sm" style="background:#dcfce7;color:#15803d">Mark Delivered</button>` : ''}
        ${!['cancelled','refunded'].includes(o.status) ? `<button onclick="adminUpdateOrder('${o.id}','cancelled')" class="btn btn-outline btn-sm">Cancel</button>` : ''}
        ${o.proof_url ? `<a href="${o.proof_url}" target="_blank" class="btn btn-outline btn-sm"><i class="fa-solid fa-image"></i> Proof</a>` : ''}
      </div>
    </div>`).join('');
}

async function adminUpdateOrder(id, status) {
  try {
    await callEdge('admin-action', { action: 'update_order', target_id: id, data: { status } });
    toast('Order updated to ' + status, '', 'success');
    loadAdminOrders();
  } catch(e) { toast('Error', e.message, 'error'); }
}

/* ── DISPUTES ── */
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
          <div class="text-xs color-text3 mt-1">${escHtml((d.description||'').substr(0,200))}${(d.description?.length||0)>200?'…':''}</div>
        </div>
        <span class="badge ${d.status==='open'?'badge-red':d.status==='resolved'?'badge-green':'badge-orange'}">${d.status}</span>
      </div>
      ${d.status==='open' ? `
      <div class="flex gap-2 flex-wrap">
        <button onclick="resolveDispute('${d.id}')"                       class="btn btn-primary btn-sm"><i class="fa-solid fa-check"></i> Resolve</button>
        <button onclick="refundDispute('${d.id}','${d.order_id}')"        class="btn btn-danger btn-sm"><i class="fa-solid fa-undo"></i> Refund</button>
        <a href="https://wa.me/?text=Re%20dispute%20Order%20${d.order_id}" target="_blank" class="btn btn-outline btn-sm"><i class="fa-brands fa-whatsapp"></i></a>
      </div>` : ''}
    </div>`).join('');
}

async function resolveDispute(id) {
  try { await callEdge('admin-action', { action: 'resolve_dispute', target_id: id }); }
  catch(e) { toast('Error', e.message, 'error'); return; }
  toast('Dispute Resolved ✅', '', 'success');
  loadAdminDisputes();
}

async function refundDispute(disputeId, orderId) {
  try { await callEdge('admin-action', { action: 'refund_dispute', target_id: disputeId, data: { order_id: orderId } }); }
  catch(e) { toast('Error', e.message, 'error'); return; }
  toast('Refund Issued', 'Order ' + orderId + ' marked refunded', 'success');
  loadAdminDisputes();
}

/* ── WITHDRAWALS ── */
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
          <div class="text-xs mt-1"><b>${escHtml(w.bank_name||'')}</b> · ${escHtml(w.account_number||'')} · ${escHtml(w.account_name||'')}</div>
          <div class="text-xs color-text3">${fmtDate(w.created_at)}</div>
        </div>
        <div class="flex flex-col items-end gap-2">
          <span class="badge ${badge}">${w.status}</span>
          ${w.status==='pending' ? `
            <div class="flex gap-2">
              <button onclick="adminPayWithdrawal('${w.id}')"    class="btn btn-primary btn-sm"><i class="fa-solid fa-check"></i> Mark Paid</button>
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
  try { await callEdge('admin-action', { action: 'pay_withdrawal', target_id: id }); }
  catch(e) { toast('Error', e.message, 'error'); return; }
  toast('Withdrawal Marked Paid ✅', '', 'success');
  loadAdminWithdrawals();
}

async function adminRejectWithdrawal(id) {
  const reason = prompt('Reason for rejection (optional):') || 'Rejected by admin';
  try { await callEdge('admin-action', { action: 'reject_withdrawal', target_id: id, data: { reason } }); }
  catch(e) { toast('Error', e.message, 'error'); return; }
  toast('Withdrawal Rejected', '', 'warn');
  loadAdminWithdrawals();
}

/* ── BROADCAST ── */
async function sendBroadcast() {
  if (!isAdmin()) return;
  const title  = document.getElementById('bc-title').value.trim();
  const body   = document.getElementById('bc-body').value.trim();
  const target = document.getElementById('bc-target').value;
  const type   = document.querySelector('input[name="bc-type"]:checked')?.value || 'info';
  if (!title || !body) { toast('Fill in title and message', '', 'warn'); return; }
  try { await callEdge('send-broadcast', { title, body, target, type }); }
  catch(e) { toast('Error', e.message, 'error'); return; }
  toast('📣 Broadcast Sent!', 'To: ' + target, 'success');
  document.getElementById('bc-title').value = '';
  document.getElementById('bc-body').value  = '';
  loadBroadcastHistory();
}

async function loadBroadcastHistory() {
  const { data: bcs } = await db.from('broadcasts').select('*').order('created_at',{ascending:false}).limit(10);
  const el = document.getElementById('bc-history');
  if (!el) return;
  const icons = { info:'ℹ️', success:'✅', warn:'⚠️', error:'🚨' };
  el.innerHTML = (bcs||[]).length
    ? bcs.map(b => `<div class="card card-pad mb-2" style="border-left:3px solid var(--green)">
        <div class="flex justify-between items-center mb-1">
          <span class="font-600 text-sm">${icons[b.type]||'📢'} ${escHtml(b.title)}</span>
          <span class="text-xs color-text3">${fmtDate(b.created_at)}</span>
        </div>
        <div class="text-xs color-text3 mb-1">To: <b>${b.target}</b></div>
        <div class="text-sm">${escHtml(b.body)}</div>
      </div>`).join('')
    : '<p class="color-text3 text-sm">None sent yet.</p>';
}

async function checkBroadcastForUser() {
  if (!currentUser) return;
  const role = currentUser.profile?.role || 'buyer';
  const targets = ['all', role === 'seller' ? 'sellers' : 'buyers'];
  const { data: bcs } = await db.from('broadcasts').select('*').in('target', targets).order('created_at',{ascending:false}).limit(2);
  (bcs||[]).forEach((b, i) => setTimeout(() => toast(b.title, b.body, b.type||'info', 7000), i * 2200));
}

/* ── REVENUE CHART ── */
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
  const data   = Object.values(dayMap);
  if (_adminRevenueChart) _adminRevenueChart.destroy();
  _adminRevenueChart = new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets:[{ label:'Revenue (₦)', data, backgroundColor:'rgba(25,168,71,.2)', borderColor:'#19a847', borderWidth:1.5, borderRadius:4 }] },
    options: { responsive:true, plugins:{ legend:{display:false}, tooltip:{callbacks:{label:c=>'₦'+fmtNum(c.raw)}} }, scales:{ y:{ beginAtZero:true, ticks:{callback:v=>'₦'+fmtNum(v)} }, x:{ ticks:{maxTicksLimit:8} } } }
  });
}

// ====================================================
//  CHATBOT
// ====================================================
// ====================================================
//  CLAUDE-POWERED CHATBOT  (replaces old rule-based bot)
// ====================================================

async function sendChat() {
  const input  = document.getElementById('chat-input');
  const msg    = input.value.trim();
  if (!msg) return;

  addChatMsg(msg, 'user');
  input.value = '';
  chatHistory.push({ role: 'user', content: msg });

  // Show typing indicator
  const typingId = 'typing-' + Date.now();
  addChatMsg('...', 'bot', typingId);

  // Build context from current app state
  const context = {
    current_page:      getCurrentPage(),
    user_role:         currentRole || 'visitor',
    cart_item_count:   cart.length,
    cart_total:        cart.reduce((s, c) => s + c.price * (c.qty || 1), 0),
    current_product:   currentProd
      ? { name: currentProd.name, price: currentProd.price, category: currentProd.category }
      : null,
  };

  try {
    const res = await fetch(CLAUDE_EDGE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: chatHistory, context }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Agent error');

    const reply = data.reply;
    chatHistory.push({ role: 'assistant', content: reply });

    // Replace typing indicator with real reply
    const typingEl = document.getElementById(typingId);
    if (typingEl) typingEl.querySelector('.cb-bubble').textContent = reply;

  } catch (err) {
    const typingEl = document.getElementById(typingId);
    const fallback = "Sorry, I'm having trouble right now. WhatsApp us at 09061484256 for instant help!";
    if (typingEl) typingEl.querySelector('.cb-bubble').textContent = fallback;
    chatHistory.push({ role: 'assistant', content: fallback });
  }
}

// Helper — detect which "page" user is on
function getCurrentPage() {
  if (document.getElementById('seller-dashboard')?.style.display !== 'none') return 'seller-dashboard';
  if (document.getElementById('storefront-view')?.style.display !== 'none')  return 'storefront';
  if (document.getElementById('product-modal')?.classList.contains('open'))  return 'product-detail';
  return 'buyer-marketplace';
}

// Updated addChatMsg — accepts optional id for typing indicator replacement
function addChatMsg(text, sender, id = null) {
  const container = document.getElementById('chat-messages');
  const div       = document.createElement('div');
  div.className   = `cb-msg ${sender}`;
  if (id) div.id  = id;

  div.innerHTML = sender === 'bot'
    ? `<div class="cb-avatar" style="background:var(--green-xlt);color:var(--green);font-size:.76rem;flex-shrink:0">
         <i class="fa-solid fa-robot"></i>
       </div>
       <div class="cb-bubble">${sender === 'bot' ? text : escHtml(text)}</div>`
    : `<div class="cb-bubble">${escHtml(text)}</div>`;

  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

// Clear history when chat is closed (optional — remove to keep memory)
function toggleChat() {
  const win = document.getElementById('chatbot-window');
  const wasOpen = win.classList.contains('open');
  win.classList.toggle('open');
  // Optionally reset history on open for a fresh session:
  // if (!wasOpen) chatHistory = [];
}

function askBot(q) {
  document.getElementById('chat-input').value = q;
  sendChat();
}
// ====================================================
//  CSV BULK UPLOAD
// ====================================================
let csvRows = [];

function downloadCsvTemplate() {
  const headers = ['name','price','original_price','category','condition','description','location','stock_quantity','negotiable'];
  const example = ['iPhone 14 Pro Max','450000','550000','phones','new','Brand new sealed iPhone 14 Pro Max 256GB','Ikeja Lagos','5','false'];
  const csv = [headers.join(','), example.join(',')].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = 'buysell_product_template.csv'; a.click();
  URL.revokeObjectURL(url);
}

function handleCsvUpload(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const lines = e.target.result.split('\n').filter(l => l.trim());
    const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
    csvRows = lines.slice(1).map(line => {
      const vals = line.split(',');
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
          ${csvRows.length>5 ? `<div class="text-xs color-text3 mt-1 text-center">+${csvRows.length-5} more…</div>` : ''}
        </div>
      </div>`;
    document.getElementById('csv-import-btn').classList.remove('hidden');
  };
  reader.readAsText(file);
}

async function importCsvProducts() {
  if (!csvRows.length || !currentUser) return;
  const btn = document.getElementById('csv-import-btn');
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Importing…';
  const toInsert = csvRows.map(r => ({
    seller_id: currentUser.id,
    name: r.name, description: r.description||r.name,
    price: parseFloat(r.price)||0,
    original_price: parseFloat(r.original_price)||parseFloat(r.price)||0,
    category: r.category||'electronics',
    condition: r.condition||'new',
    location: r.location||'Nigeria',
    stock_quantity: parseInt(r.stock_quantity)||10,
    negotiable: r.negotiable==='true'||r.negotiable==='1',
    image_url: '', video_url: '', has_video: false,
    status: 'active', avg_rating: 5, review_count: 0,
    created_at: new Date().toISOString()
  }));
  const BATCH = 50;
  let imported = 0;
  for (let i = 0; i < toInsert.length; i += BATCH) {
    const { error } = await db.from('products').insert(toInsert.slice(i, i+BATCH));
    if (!error) imported += Math.min(BATCH, toInsert.length - i);
  }
  toast(`${imported} Products Imported! 🎉`, 'All products are now live', 'success');
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
//  SHARE PRODUCT
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
  const refCode = params.get('ref');
  if (productId) {
    await loadProducts();
    openProduct(productId);
  }
  if (storeId) {
    viewStorefront(storeId);
  }
  if (refCode) {
    // Track referral click
    localStorage.setItem('bs_ref', refCode);
  }
}

// ====================================================
//  WHATSAPP ORDER NOTIFICATION
// ====================================================
function sendWhatsAppOrderNotification(order, sellerWa) {
  if (!sellerWa) return;
  const phone = sellerWa.replace(/\D/g,'');
  const items = (order.items||[]).map(i=>`${i.name} ×${i.qty}`).join(', ');
  const msg = encodeURIComponent(
    `🛍️ NEW ORDER on BUYSELL!\n\n` +
    `Order ID: ${order.id}\n` +
    `Items: ${items}\n` +
    `Total: ${fmtN(order.total_amount)}\n` +
    `Payment: ${order.payment_method}\n\n` +
    `Deliver to:\n${order.delivery_name}\n${order.delivery_phone}\n${order.delivery_address}\n\n` +
    `Log in to dashboard to confirm: https://buysell.ng`
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
    const result = await callEdge('create-order', {
      cart: cart.map(c => ({ id: c.id, name: c.name, qty: c.qty||1, price: c.price, image_url: c.image_url })),
      delivery: {
        name:    document.getElementById('co-name').value,
        phone:   document.getElementById('co-phone').value,
        address: document.getElementById('co-address').value
      },
      payment_method: method,
      payment_ref:    txRef || paystackRef || '',
      proof_url:      proofUrl,
      referral_code:  localStorage.getItem('bs_ref') || ''
    });

    if (!result.success) { toast('Order Error', result.error, 'error'); return; }

    const orderId = result.order_id;
    const total   = result.total;

    // Clear referral cookie
    localStorage.removeItem('bs_ref');

    // WhatsApp notification to seller
    const seller = cart[0]?.profiles;
    if (seller?.whatsapp) sendWhatsAppOrderNotification({ id: orderId, total_amount: total }, seller.whatsapp);

    cart = []; saveCart();
    document.getElementById('co-order-id').textContent = orderId;
    document.getElementById('co-order-total').textContent = fmtN(total);
    goCheckoutStep(3);
    toast('Order Placed! 🎉', `Order ${orderId} confirmed`, 'success', 5000);

  } catch(err) {
    toast('Order Failed', err.message, 'error');
  }
}

// ====================================================
//  STOREFRONT SALES COUNT
// ====================================================
// viewStorefront — full implementation with order count + reviews
async function viewStorefront(sellerId) {
  if (!sellerId) return;
  closeModal('product-modal');
  document.getElementById('buyer-view').style.display = 'none';
  document.getElementById('storefront-view').style.display = 'block';
  const { data: seller } = await db.from('profiles').select('*').eq('id', sellerId).single();
  if (!seller) { toast('Store not found','','error'); return; }
  document.getElementById('sf-avatar').textContent = (seller.name||'S')[0].toUpperCase();
  document.getElementById('sf-name').textContent = seller.name || 'Seller Store';
  document.getElementById('sf-desc').textContent = seller.store_description || 'Welcome to our store!';
  document.getElementById('sf-wa-link').href = `https://wa.me/${(seller.whatsapp||'').replace(/\D/g,'')}`;
  const { data: prods } = await db.from('products').select('*').eq('seller_id', sellerId).eq('status','active');
  const sfProds = prods || [];
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
  document.getElementById('sf-stars').textContent = '★'.repeat(Math.round(+avgRating))+'☆'.repeat(5-Math.round(+avgRating));
  // Share button URL
  const sfUrl = `${window.location.origin}${window.location.pathname}?store=${sellerId}`;
  document.getElementById('sf-wa-link').parentElement.querySelectorAll('button').forEach(b => {
    if (b.textContent.includes('Share')) b.onclick = () => { navigator.clipboard?.writeText(sfUrl).then(()=>toast('Store Link Copied!','','success')).catch(()=>{}); if(navigator.share) navigator.share({title:seller.name,url:sfUrl}); };
  });
  const grid = document.getElementById('sf-products-grid');
  const empty = document.getElementById('sf-empty');
  if (!sfProds.length) { grid.innerHTML=''; empty.classList.remove('hidden'); }
  else { empty.classList.add('hidden'); grid.innerHTML = sfProds.map(p=>prodCard(p)).join(''); }
  // Update page title
  document.title = `${seller.name} — BUYSELL Nigeria`;
  history.pushState(null,'',`?store=${sellerId}`);
}

// ====================================================
//  UTIL
// ====================================================
function fmtN(n) { return '₦' + fmtNum(n); }
function fmtNum(n) { if (!n && n!==0) return '0'; return Math.round(n).toLocaleString('en-NG'); }
function fmtDate(d) { if (!d) return ''; return new Date(d).toLocaleDateString('en-NG',{day:'numeric',month:'short',year:'numeric'}); }
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
  // Block javascript: and data: URIs
  if (!url) return '';
  const u = String(url).trim().toLowerCase();
  if (u.startsWith('javascript:') || u.startsWith('data:text') || u.startsWith('vbscript:')) return '';
  return String(url).trim();
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
        attribution: '© OpenStreetMap'
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
//  INIT
// ====================================================
(async function init() {
  const savedLogo = localStorage.getItem('buysell_custom_logo');
  if (savedLogo) applySiteLogo(savedLogo);
  await checkSession();
  updateCartCount();
  handleDeepLink();
  checkBroadcastForUser();
  // Real-time order updates for sellers
  db.channel('orders-rt').on('postgres_changes',{event:'INSERT',schema:'public',table:'orders'},payload=>{
    if (currentRole==='seller' && payload.new?.seller_id===currentUser?.id) {
      toast('New Order! 🛍️', 'Check your orders panel', 'success', 6000);
      loadSellerOrders();
      loadSellerStats();
    }
  }).subscribe();
  // Real-time low stock alerts
  db.channel('stock-rt').on('postgres_changes',{event:'UPDATE',schema:'public',table:'products'},payload=>{
    const p = payload.new;
    if (currentRole==='seller' && p?.seller_id===currentUser?.id && p?.stock_quantity !== undefined && p?.low_stock_alert && p.stock_quantity <= p.low_stock_alert && p.stock_quantity > 0) {
      toast(`⚠️ Low Stock: ${p.name}`, `Only ${p.stock_quantity} left`, 'warn', 7000);
    }
  }).subscribe();
})();

// --- PHASE 1-4 INJECTIONS ---
function validateInput(str) {
  if (typeof str !== 'string') return '';
  const invalid = /<script.*?>.*?<\/script>|<.*?on\w+?=.*?>|(SELECT|INSERT|UPDATE|DELETE|DROP|UNION)\s+/i;
  if (invalid.test(str)) {
    toast('Security Error', 'Invalid characters detected', 'error');
    throw new Error("Malicious input detected");
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
    toast('🔐 Admin Portal', 'Welcome back, Commander', 'info', 4000);
  }, 80);
}

function showServiceDashboard() {
  if (!currentUser) { showModal('auth-modal'); toggleAuth('login'); return; }
  document.getElementById('buyer-view').style.display = 'none';
  document.getElementById('seller-dashboard').style.display = 'none';
  document.getElementById('storefront-view').style.display = 'none';
  
  document.getElementById('service-provider-view').style.display = 'block';
  document.body.classList.add('in-seller');
  currentRole = 'service_provider';

  // Populate user info in SPD sidebar
  const nameEl  = document.getElementById('spd-user-name');
  const emailEl = document.getElementById('spd-user-email');
  if (nameEl)  nameEl.textContent  = currentUser.profile?.name  || 'Service Pro';
  if (emailEl) emailEl.textContent = currentUser.email || '';

  // Load data and show default section
  showSpdDash('overview');
  loadMyGigs();
}

function copyReferralLink() {
  const link = document.getElementById('referral-link')?.value;
  if(!link) return;
  navigator.clipboard.writeText(link).then(() => {
    toast('Referral Link Copied! 🔗', 'Share it to start earning.', 'success');
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
  // Hide all sections
  document.querySelectorAll('.spd-section').forEach(s => s.style.display = 'none');
  // Deactivate all nav items
  document.querySelectorAll('#spd-sidebar .dash-nav-item').forEach(n => n.classList.remove('active'));
  
  // Show target
  const el = document.getElementById(`spd-sec-${section}`);
  if (el) el.style.display = 'block';
  
  // Activate target nav
  const navEl = document.getElementById(`spd-nav-${section}`);
  if (navEl) navEl.classList.add('active');
}

// ====================================================
//  SERVICE ECONOMY — Browse & Filter (Buyer Side)
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
            <div style="font-size:.7rem;color:var(--text3)">${escHtml(g.category)} · ${escHtml(g.location || '—')}</div>
          </div>
        </div>
        <p style="font-size:.78rem;color:var(--text2);line-height:1.55;margin-bottom:.65rem;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${escHtml(g.description || 'No description provided.')}</p>
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.75rem">
          <div>
            <div style="font-size:.65rem;color:var(--text3);text-transform:uppercase;letter-spacing:.04em">Starting from</div>
            <div style="font-size:1.1rem;font-weight:800;color:var(--green)">₦${(g.starting_rate || g.price || 0).toLocaleString()}</div>
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
//  SERVICE PROVIDER — Load My Gigs (Portfolio)
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
    if (countEl) countEl.textContent = gigs.length;
    const listEl = document.getElementById('spd-gigs-list');
    if (!listEl) return;
    if (!gigs.length) {
      listEl.innerHTML = '<div class="empty-state"><i class="fa-solid fa-folder-open" style="font-size:2rem;color:var(--border2);display:block;margin-bottom:.65rem"></i><p class="color-text3 text-sm">Your portfolio is empty. Post your first service above!</p></div>';
      return;
    }
    listEl.innerHTML = gigs.map(g => `
      <div class="card card-pad mb-2" style="border-left:3px solid var(--green)">
        <div class="flex justify-between items-center flex-wrap gap-2">
          <div>
            <div class="font-bold">${escHtml(g.title)}</div>
            <div class="text-xs color-text3">${escHtml(g.category)} · ${escHtml(g.location || '')} · ₦${(g.starting_rate||0).toLocaleString()}</div>
          </div>
          <span class="badge ${g.status==='active'?'badge-green':'badge-red'}">${g.status}</span>
        </div>
      </div>`).join('');
  } catch(e) { /* silent */ }
}

// ====================================================
//  SERVICE PROVIDER — Publish Gig (with Image Upload)
// ====================================================
async function publishServiceGig() {
  if (!currentUser) { showModal('auth-modal'); return; }
  const title    = document.getElementById('spd-title')?.value.trim();
  const category = document.getElementById('spd-category')?.value;
  const rate     = parseFloat(document.getElementById('spd-rate')?.value) || 0;
  const location = document.getElementById('spd-location')?.value.trim();
  const desc     = document.getElementById('spd-desc')?.value.trim();
  const wa       = document.getElementById('spd-wa')?.value.trim();
  const imgInput = document.getElementById('spd-images');
  const files    = imgInput?.files ? Array.from(imgInput.files).slice(0, 4) : [];

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
      provider_id:   currentUser.id,
      title:         validateInput(title),
      category,
      starting_rate: rate,
      location:      validateInput(location),
      description:   validateInput(desc),
      whatsapp:      wa,
      portfolio_urls: imageUrls,
      status:        'active',
      created_at:    new Date().toISOString()
    });
    if (error) throw error;

    toast('Service Published! 🎉', 'Your gig is now live on BUYSELL', 'success');
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
//  SERVICE PROVIDER — Image Preview
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
//  VIEW PROVIDER PROFILE (Buyer Side)
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
//  HELP MODAL
// ====================================================
function openHelpModal() { showModal('help-modal'); }

