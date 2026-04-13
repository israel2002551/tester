// ====================================================
//  CONFIG
// ====================================================
const SB_URL  = 'https://obzhlmzswthnorkiqemh.supabase.co';
const SB_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9iemhsbXpzd3Robm9ya2lxZW1oIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMxMDE2NjgsImV4cCI6MjA4ODY3NzY2OH0.5I4Ln0913h0AH5z4e64QBVx88igcIwEaM0Lz11FqDvU';
const EDGE_URL = SB_URL + '/functions/v1';
// ── GROQ DIRECT CALL (replaces CLAUDE_EDGE_URL / edge function) ──────────────
const GROQ_API_KEY = "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";
const GROQ_URL     = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL   = "llama-3.3-70b-versatile";

async function callGroq(messages, systemPrompt = null) {
  const groqMessages = [];
  if (systemPrompt) groqMessages.push({ role: 'system', content: systemPrompt });

  // Sanitize: only user/assistant, no consecutive same-role, must start with user
  const valid = messages.filter(m =>
    m && typeof m.role === 'string' && typeof m.content === 'string' &&
    (m.role === 'user' || m.role === 'assistant')
  );

  // Deduplicate consecutive same-role
  const deduped = [];
  for (const msg of valid) {
    if (deduped.length > 0 && deduped[deduped.length - 1].role === msg.role) {
      deduped[deduped.length - 1].content += '\n' + msg.content;
    } else {
      deduped.push({ role: msg.role, content: msg.content });
    }
  }
  if (deduped.length > 0 && deduped[0].role !== 'user') deduped[0].role = 'user';
  groqMessages.push(...deduped);

  if (groqMessages.filter(m => m.role !== 'system').length === 0) {
    throw new Error('No valid messages to send.');
  }

  const response = await fetch(GROQ_URL, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${GROQ_API_KEY}`
    },
    body: JSON.stringify({
      model:       GROQ_MODEL,
      messages:    groqMessages,
      max_tokens:  1024,
      temperature: 0.7
    })
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || 'Groq API error');
  return data.choices[0].message.content;
}

let chatHistory = []; 
let adminAiHistory = [];

const CLAUDE_EDGE_URL = `${EDGE_URL}/smooth-handler`;
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
let checkoutTotal = 0;
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
  document.getElementById('auth-terms-group').classList.toggle('hidden', isLogin);
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
      if (!document.getElementById('auth-terms-check')?.checked) {
        toast('Terms Required', 'Please agree to the Terms of Service and Privacy Policy', 'warn', 5000);
        return;
      }

      const role     = rawRole === 'both' ? 'seller' : rawRole;
      const accounts = (rawRole === 'service_provider' || rawRole === 'both') ? 'seller' : rawRole;

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

  // Update Toggle View text for Service Providers
  if (currentRole === 'service_provider') {
    document.getElementById('toggle-view-text').textContent = 'Service Dashboard';
    document.getElementById('toggle-view-icon').className = 'fa-solid fa-wrench';
  }
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

  document.getElementById('toggle-view-icon').className = currentUser?.profile?.role === 'service_provider' ? 'fa-solid fa-wrench' : 'fa-solid fa-store';
  document.getElementById('toggle-view-text').textContent = currentUser?.profile?.role === 'service_provider' ? 'Service Dashboard' : 'Seller Dashboard';
  document.getElementById('mob-ham-btn').style.display = 'none';
  document.body.classList.remove('in-seller');
  currentRole = 'buyer';
  startCarousel();
  loadProducts();
  updateCartCount();
}

function showSellerDashboard() {
  if (!currentUser) { showModal('auth-modal'); toggleAuth('login'); return; }
  if (!checkAndPromptKyc()) return; // Block unverified access
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
  if (currentRole === 'seller' || currentRole === 'service_provider') {
    showBuyerView();
  } else { 
    if (!currentUser) { showModal('auth-modal'); return; }
    if (!checkAndPromptKyc()) return; // Block unverified access
    if (currentUser.profile?.role === 'service_provider') {
      showServiceDashboard();
    } else {
      showSellerDashboard(); 
    }
  }
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
  const count = reviews.length;
  document.getElementById('modal-review-count').textContent = `${count} review${count!==1?'s':''}`;
  document.getElementById('modal-verified-count').textContent = count;

  // Calculate average and star distribution
  const avg = count ? (reviews.reduce((s,r)=>s+r.rating,0)/count) : 0;
  document.getElementById('modal-avg-rating').textContent = avg.toFixed(1);
  document.getElementById('modal-stars').textContent = '★'.repeat(Math.round(avg)) + '☆'.repeat(5-Math.round(avg));

  // Star distribution bars (5→1)
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
        <div class="stars sm">${'★'.repeat(r.rating)+'☆'.repeat(5-r.rating)}</div>
      </div>
      <p class="review-text">${escHtml(r.review_text || r.comment || '')}</p>
      <span class="text-xs color-text3"><i class="fa-solid fa-check-circle" style="color:var(--green)"></i> Verified Purchase · ${fmtDate(r.created_at)}</span>
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
  checkoutTotal = total;
  const comm = Math.round(total * PLATFORM_FEE_PCT);
  document.getElementById('co-pay-amount').textContent = fmtN(total);
  document.getElementById('co-commission').textContent = fmtN(comm);
  document.getElementById('co-total').textContent = fmtN(checkoutTotal);
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
  if (typeof PaystackPop === 'undefined') {
    toast('Payment Error', 'Paystack not loaded. Please refresh and try again.', 'error');
    return;
  }
  const handler = PaystackPop.setup({
    key: PAYSTACK_PUBLIC_KEY,
    email: currentUser.email,
    amount: checkoutTotal * 100, 
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
    const path = `proofs/${currentUser.id}/${Date.now()}.${ext}`;
    const { error: upErr } = await db.storage.from('uploads').upload(path, file);
    if (!upErr) { const { data } = db.storage.from('uploads').getPublicUrl(path); proofUrl = data.publicUrl; }
    await saveOrderToDb(null, 'transfer', null, proofUrl);

    // Also save to payment_receipts for seller auditing
    if (proofUrl && cart.length > 0) {
      const sellerId = cart[0]?.seller_id || cart[0]?.profiles?.id;
      const total = cart.reduce((sum, c) => sum + (c.price * (c.qty || 1)), 0);
      await db.from('payment_receipts').insert({
        buyer_id:     currentUser.id,
        seller_id:    sellerId || null,
        receipt_url:  proofUrl,
        amount:       total,
        payment_type: 'product',
        status:       'pending'
      }).then(() => {}).catch(() => {}); // non-blocking
    }
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
        <button class="btn btn-outline btn-sm" onclick="showOrderTracking('${o.id}')"><i class="fa-solid fa-truck"></i> Track</button>
        <button class="btn btn-outline btn-sm" onclick="openMessageModal('${o.seller_id}', 'Seller')" style="color:var(--green);border-color:var(--green)"><i class="fa-solid fa-comment-dots"></i> Message Seller</button>
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

// Advanced chart system
let _chartInstances = {};
let _dashboardCharts = {};

async function renderChart() {
  if (!currentUser) return;
  const days = parseInt(document.getElementById('chart-period').value);
  const since = new Date(); since.setDate(since.getDate() - days);
  const chartType = document.getElementById('chart-type')?.value || 'line';
  
  const { data: orders } = await db.from('orders')
    .select('total_amount,created_at,status,items')
    .eq('seller_id', currentUser.id)
    .gte('created_at', since.toISOString())
    .neq('status','cancelled');

  // Group by day
  const dayMap = {};
  for (let i = days-1; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate()-i);
    dayMap[d.toISOString().slice(0,10)] = { revenue: 0, orders: 0 };
  }
  (orders||[]).forEach(o => {
    const key = o.created_at?.slice(0,10);
    if (key && dayMap[key] !== undefined) {
      dayMap[key].orders++;
      dayMap[key].revenue += o.total_amount || 0;
    }
  });
  
  const labels = Object.keys(dayMap).map(k => {
    const d = new Date(k);
    return d.toLocaleDateString('en-NG',{month:'short',day:'numeric'});
  });
  const revenueData = Object.values(dayMap).map(d => d.revenue);
  const ordersData = Object.values(dayMap).map(d => d.orders);

  const ctx = document.getElementById('sales-chart').getContext('2d');
  if (_chartInstances.main) _chartInstances.main.destroy();
  
  const datasets = chartType === 'bar' ? [
    { type: 'bar', label: 'Revenue (₦)', data: revenueData, backgroundColor: 'rgba(25,168,71,0.7)', borderColor: '#19a847', borderWidth: 1, yAxisID: 'y' },
    { type: 'line', label: 'Orders', data: ordersData, borderColor: '#7c3aed', backgroundColor: 'rgba(124,58,237,0.1)', tension: 0.4, fill: true, yAxisID: 'y1' }
  ] : [{
    label: 'Revenue (₦)', data: revenueData, borderColor: '#19a847', backgroundColor: 'rgba(25,168,71,.08)', tension: 0.4, fill: true, pointBackgroundColor: '#19a847', pointRadius: 4, pointHoverRadius: 6
  }];
  
  _chartInstances.main = new Chart(ctx, {
    type: chartType,
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: true, position: 'top', labels: { usePointStyle: true, padding: 20 } },
        tooltip: {
          backgroundColor: 'rgba(11,31,20,0.95)',
          titleColor: '#fff',
          bodyColor: '#fff',
          padding: 12,
          cornerRadius: 8,
          callbacks: {
            label: ctx => ctx.dataset.label + ': ₦' + fmtNum(ctx.raw)
          }
        }
      },
      scales: {
        y: { beginAtZero: true, position: 'left', grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { callback: v => '₦'+fmtNum(v) } },
        y1: { beginAtZero: true, position: 'right', grid: { display: false }, ticks: { color: '#7c3aed' } },
        x: { grid: { display: false }, ticks: { maxTicksLimit: days>14?7:days } }
      }
    }
  });
  
  // Auto-refresh every 30 sec
  if (_chartInstances.refresh) clearInterval(_chartInstances.refresh);
  _chartInstances.refresh = setInterval(renderChart, 30000);
}

// Product performance chart
async function renderProductChart() {
  if (!currentUser) return;
  const { data: products } = await db.from('products')
    .select('name,price,views,sold_count,created_at')
    .eq('seller_id', currentUser.id)
    .order('sold_count', { ascending: false })
    .limit(10);
  
  if (!products?.length) return;
  
  const ctx = document.getElementById('product-chart')?.getContext('2d');
  if (!ctx) return;
  if (_chartInstances.products) _chartInstances.products.destroy();
  
  _chartInstances.products = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: products.map(p => p.name?.substring(0,15) + '...'),
      datasets: [{
        label: 'Units Sold',
        data: products.map(p => p.sold_count || 0),
        backgroundColor: ['#19a847','#7c3aed','#ea580c','#0d9488','#0284c7','#c026d3','#dc2626','#65a30d','#4f46e5','#0891b2'],
        borderRadius: 6
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      plugins: { legend: { display: false } },
      scales: { x: { beginAtZero: true }, y: { grid: { display: false } } }
    }
  });
}

// Revenue by category chart
async function renderCategoryChart() {
  if (!currentUser) return;
  const { data: orders } = await db.from('orders')
    .select('items')
    .eq('seller_id', currentUser.id)
    .neq('status','cancelled');
  
  const catMap = {};
  (orders||[]).forEach(o => {
    try {
      const items = typeof o.items === 'string' ? JSON.parse(o.items) : o.items;
      (items||[]).forEach(item => {
        const cat = item.category || 'Other';
        catMap[cat] = (catMap[cat] || 0) + (item.price || 0) * (item.qty || 1);
      });
    } catch(e) {}
  });
  
  const ctx = document.getElementById('category-chart')?.getContext('2d');
  if (!ctx) return;
  if (_chartInstances.category) _chartInstances.category.destroy();
  
  const colors = ['#19a847','#7c3aed','#ea580c','#0d9488','#0284c7'];
  _chartInstances.category = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: Object.keys(catMap),
      datasets: [{
        data: Object.values(catMap),
        backgroundColor: colors.slice(0, Object.keys(catMap).length),
        borderWidth: 0
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { position: 'right' } }
    }
  });
}

// Real-time analytics summary
async function loadRealTimeAnalytics() {
  if (!currentUser) return;
  try {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    
    // Today's stats
    const { data: todayOrders } = await db.from('orders')
      .select('total_amount')
      .eq('seller_id', currentUser.id)
      .gte('created_at', todayStart)
      .neq('status','cancelled');
    
    // This month's stats
    const { data: monthOrders } = await db.from('orders')
      .select('total_amount,status')
      .eq('seller_id', currentUser.id)
      .gte('created_at', monthStart);
    
    // Products
    const { data: products } = await db.from('products')
      .select('views,sold_count')
      .eq('seller_id', currentUser.id);
    
    // Calculate metrics
    const todayRevenue = (todayOrders||[]).reduce((s,o) => s + (o.total_amount||0), 0);
    const monthRevenue = (monthOrders||[]).reduce((s,o) => s + (o.total_amount||0), 0);
    const monthOrdersCount = (monthOrders||[]).length;
    const pendingOrders = (monthOrders||[]).filter(o => o.status === 'pending').length;
    const totalViews = (products||[]).reduce((s,p) => s + (p.views||0), 0);
    const totalSold = (products||[]).reduce((s,p) => s + (p.sold_count||0), 0);
    
    // Update UI
    const updateEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    updateEl('st-today-revenue', fmtN(todayRevenue));
    updateEl('st-month-revenue', fmtN(monthRevenue));
    updateEl('st-orders-count', monthOrdersCount);
    updateEl('st-pending-count', pendingOrders);
    updateEl('st-total-views', totalViews);
    updateEl('st-conversion-rate', totalViews > 0 ? ((totalSold/totalViews)*100).toFixed(1) + '%' : '0%');
  } catch(e) { console.error('Real-time analytics error:', e); }
}

// Load all charts at once
function loadAllCharts() {
  renderChart();
  renderProductChart();
  renderCategoryChart();
  loadRealTimeAnalytics();
}

async function loadSellerAnalytics() {
  const container = document.getElementById('seller-analytics-content');
  if (!container || !currentUser) return;
  container.innerHTML = '<div class="skeleton" style="height:100px"></div>';

  try {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const last30Days = new Date(); last30Days.setDate(last30Days.getDate() - 30);
    
    // Fetch all data
    const [ordersResult, productsResult, reviewsResult] = await Promise.all([
      db.from('orders').select('id,total_amount,status,created_at,items').eq('seller_id', currentUser.id).gte('created_at', monthStart),
      db.from('products').select('id,name,price,views,sold_count,category').eq('seller_id', currentUser.id),
      db.from('reviews').select('rating').eq('seller_id', currentUser.id)
    ]);
    
    const orders = ordersResult.data || [];
    const products = productsResult.data || [];
    const reviews = reviewsResult.data || [];
    
    // Calculate metrics
    const totalViews = products.reduce((s,p) => s + (p.views||0), 0);
    const totalOrders = orders.length;
    const totalRevenue = orders.reduce((s,o) => s + (o.total_amount||0), 0);
    const avgRating = reviews.length ? (reviews.reduce((s,r) => s + r.rating, 0) / reviews.length).toFixed(1) : '0.0';
    const conversionRate = totalViews > 0 ? ((totalOrders / totalViews) * 100).toFixed(1) : '0.0';
    const pendingOrders = orders.filter(o => o.status === 'pending').length;
    
    // Top products
    const topProducts = [...products].sort((a,b) => (b.sold_count||0) - (a.sold_count||0)).slice(0, 5);
    
    // Category breakdown
    const catMap = {};
    products.forEach(p => { catMap[p.category] = (catMap[p.category] || 0) + (p.sold_count||0); });
    const topCategories = Object.entries(catMap).sort((a,b) => b[1] - a[1]).slice(0,5);
    
    container.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:1rem;margin-bottom:1.5rem">
        <div class="card card-pad" style="text-align:center">
          <div class="text-xs color-text3 mb-1">Today's Revenue</div>
          <div style="font-size:1.3rem;font-weight:800;color:var(--green)" id="st-today-revenue">₦0</div>
        </div>
        <div class="card card-pad" style="text-align:center">
          <div class="text-xs color-text3 mb-1">This Month</div>
          <div style="font-size:1.3rem;font-weight:800;color:var(--purple)" id="st-month-revenue">₦0</div>
        </div>
        <div class="card card-pad" style="text-align:center">
          <div class="text-xs color-text3 mb-1">Total Orders</div>
          <div style="font-size:1.3rem;font-weight:800" id="st-orders-count">0</div>
        </div>
        <div class="card card-pad" style="text-align:center">
          <div class="text-xs color-text3 mb-1">Pending</div>
          <div style="font-size:1.3rem;font-weight:800;color:var(--gold)" id="st-pending-count">0</div>
        </div>
        <div class="card card-pad" style="text-align:center">
          <div class="text-xs color-text3 mb-1">Total Views</div>
          <div style="font-size:1.3rem;font-weight:800;color:var(--blue)" id="st-total-views">0</div>
        </div>
        <div class="card card-pad" style="text-align:center">
          <div class="text-xs color-text3 mb-1">Conversion</div>
          <div style="font-size:1.3rem;font-weight:800" id="st-conversion-rate">0%</div>
        </div>
      </div>
      
      <div class="card card-pad mb-3">
        <h3 class="mb-3"><i class="fa-solid fa-chart-line color-green"></i> Revenue & Orders Trend</h3>
        <div style="display:flex;gap:.5rem;margin-bottom:1rem;flex-wrap:wrap">
          <select id="chart-type" class="form-select" style="width:auto;padding:.35rem .65rem;font-size:.75rem" onchange="renderChart()">
            <option value="line">Line</option>
            <option value="bar">Bar</option>
            <option value="area">Area</option>
          </select>
          <button class="btn btn-outline btn-sm" onclick="renderChart()"><i class="fa-solid fa-sync"></i> Refresh</button>
        </div>
        <div style="height:280px;position:relative">
          <canvas id="sales-chart"></canvas>
        </div>
      </div>
      
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:1rem;margin-bottom:1rem">
        <div class="card card-pad">
          <h3 class="mb-3"><i class="fa-solid fa-fire color-gold"></i> Top Products by Sales</h3>
          <div style="height:220px">
            <canvas id="product-chart"></canvas>
          </div>
        </div>
        <div class="card card-pad">
          <h3 class="mb-3"><i class="fa-solid fa-chart-pie color-purple"></i> Revenue by Category</h3>
          <div style="height:220px">
            <canvas id="category-chart"></canvas>
          </div>
        </div>
      </div>
      
      ${renderSellerBadge(totalOrders, parseFloat(avgRating))}
      <div class="card card-pad mt-3">
        <h3 class="mb-3"><i class="fa-solid fa-trophy color-gold"></i> Top Products</h3>
        ${topProducts.length ? topProducts.map((p, i) => `
          <div class="flex justify-between items-center py-2 ${i<topProducts.length-1?'border-b border-border':''}">
            <div class="flex items-center gap-2">
              <span style="font-weight:700;color:var(--text3);width:20px">${i+1}.</span>
              <div>
                <div class="text-sm font-600">${escHtml(p.name?.substring(0,25))}</div>
                <div class="text-xs color-text3">${fmtN(p.price)} · ${p.views||0} views</div>
              </div>
            </div>
            <div class="font-bold color-green">${p.sold_count||0} sold</div>
          </div>
        `).join('') : '<p class="color-text3 text-sm">No product data yet.</p>'}
      </div>`;
    
    // Load charts after rendering
    setTimeout(loadAllCharts, 100);
  } catch(e) { console.error('Analytics error:', e); }
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
        <button class="btn btn-outline btn-sm" onclick="showOrderTracking('${o.id}')"><i class="fa-solid fa-truck"></i> Track</button>
        ${o.buyer_id ? `<button class="btn btn-outline btn-sm" onclick="openMessageModal('${o.buyer_id}', '${escAttr(o.delivery_name||'Buyer')}')" style="color:var(--green);border-color:var(--green)"><i class="fa-solid fa-comment-dots"></i> Message Buyer</button>` : `<a href="https://wa.me/${(o.delivery_phone||'').replace(/\D/g,'')}" target="_blank" class="btn btn-outline btn-sm"><i class="fa-brands fa-whatsapp"></i> Contact</a>`}
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
  const ref  = document.getElementById('commission-ref').value.trim();
  if (!file || !ref) { toast('Please upload receipt and enter reference', '', 'warn'); return; }
  if (!currentUser) { toast('Not logged in', '', 'error'); return; }

  try {
    toast('Uploading receipt...', '', 'info', 3000);

    // 1. Upload receipt image to Supabase Storage
    const ext  = file.name.split('.').pop().toLowerCase().replace(/[^a-z0-9]/g, '');
    const path = `receipts/${currentUser.id}/${Date.now()}.${ext}`;
    const { data: uploadData, error: uploadErr } = await db.storage
      .from('uploads')
      .upload(path, file, { upsert: false });

    if (uploadErr) throw uploadErr;

    const { data: urlData } = db.storage.from('uploads').getPublicUrl(uploadData.path);
    const receiptUrl = urlData?.publicUrl || '';

    // 2. Insert record into commission_receipts table
    const { error: insertErr } = await db.from('commission_receipts').insert({
      seller_id:       currentUser.id,
      receipt_url:     receiptUrl,
      transaction_ref: validateInput(ref),
      amount:          5000,
      status:          'pending'
    });

    if (insertErr) throw insertErr;

    toast('Receipt Submitted! ✅', 'Admin will verify within 24hrs.', 'success', 6000);
    closeModal('commission-modal');
    document.getElementById('suspended-modal').classList.remove('open');
    document.body.classList.remove('modal-open');
    
    // Clear form
    document.getElementById('commission-file').value = '';
    document.getElementById('commission-ref').value = '';
  } catch(e) {
    toast('Upload Failed', e.message || 'Please try again', 'error');
  }
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
  if (tab === 'receipts')     loadAdminReceipts();
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
  _renderAdminOrdersChart(orders || []);
}

   // ====================================================
//  ADMIN AI ASSISTANT (uses Groq directly)
// ====================================================
async function askAdminBot(preset) {
  const input = document.getElementById('admin-ai-input');
  const msg   = preset || input.value.trim();
  if (!msg) return;
  if (!preset) input.value = '';

  const container = document.getElementById('admin-ai-messages');
  const userDiv   = document.createElement('div');
  userDiv.style.cssText = 'display:flex;flex-direction:row-reverse;gap:.42rem';
  userDiv.innerHTML = `<div style="background:var(--forest);color:#fff;padding:.52rem .82rem;border-radius:14px;font-size:.79rem;max-width:82%;line-height:1.5">${escHtml(msg)}</div>`;
  container.appendChild(userDiv);

  adminAiHistory.push({ role: 'user', content: msg });

  const typingDiv = document.createElement('div');
  typingDiv.id = 'admin-typing';
  typingDiv.style.cssText = 'display:flex;gap:.42rem;align-items:center';
  typingDiv.innerHTML = `<div style="background:var(--green-xlt);color:var(--green);font-size:.76rem;flex-shrink:0;width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center"><i class="fa-solid fa-robot"></i></div><div style="background:#fff;border:1px solid var(--border);padding:.52rem .82rem;border-radius:14px;font-size:.79rem;color:var(--text3)">Thinking… (reading database)</div>`;
  container.appendChild(typingDiv);
  container.scrollTop = container.scrollHeight;

  // ── LIVE DATABASE CONTEXT INJECTION ──
  let dbContext = '';
  try {
    const now = new Date();
    // Fetch open disputes
    const { data: disputes } = await db.from('disputes').select('id, order_id, dispute_type, description, status, created_at, buyer_id').eq('status', 'open').order('created_at', { ascending: false }).limit(20);
    // Fetch all sellers + service providers with trial/commission info
    const { data: sellers } = await db.from('profiles').select('id, name, email, role, commission_paid, trial_end, kyc_verified, created_at').in('role', ['seller', 'service_provider']).order('created_at', { ascending: false });
    // Fetch pending receipts
    const { data: receipts } = await db.from('commission_receipts').select('id, seller_id, status, created_at, profiles(name)').eq('status', 'pending').limit(10);
    // Fetch recent orders
    const { data: orders } = await db.from('orders').select('id, total_amount, status, created_at').order('created_at', { ascending: false }).limit(20);
    // Fetch pending withdrawals
    const { data: withdrawals } = await db.from('withdrawals').select('id, amount, status, seller_id, profiles(name)').eq('status', 'pending').limit(10);

    const allSellers = sellers || [];
    const paidSellers = allSellers.filter(s => s.commission_paid);
    const trialSellers = allSellers.filter(s => !s.commission_paid && s.trial_end && new Date(s.trial_end) > now);
    const expiredSellers = allSellers.filter(s => !s.commission_paid && (!s.trial_end || new Date(s.trial_end) <= now));
    const serviceProviders = allSellers.filter(s => s.role === 'service_provider');
    const expiredSPs = serviceProviders.filter(s => !s.commission_paid && (!s.trial_end || new Date(s.trial_end) <= now));

    dbContext = `

=== LIVE DATABASE SNAPSHOT ===
SELLERS: ${allSellers.filter(s=>s.role==='seller').length} total (${paidSellers.filter(s=>s.role==='seller').length} paid, ${trialSellers.filter(s=>s.role==='seller').length} trial, ${expiredSellers.filter(s=>s.role==='seller').length} expired/unpaid)
SERVICE PROVIDERS: ${serviceProviders.length} total (${serviceProviders.filter(s=>s.commission_paid).length} paid, ${expiredSPs.length} expired/unpaid)

OPEN DISPUTES (${(disputes||[]).length}):
${(disputes||[]).map(d => `  - #${d.id.substring(0,8)} | Order ${d.order_id} | Type: ${d.dispute_type} | "${(d.description||'').substring(0,80)}"`).join('\n') || '  None'}

PENDING COMMISSION RECEIPTS (${(receipts||[]).length}):
${(receipts||[]).map(r => `  - Receipt #${r.id.substring(0,8)} from ${r.profiles?.name || 'Unknown'}`).join('\n') || '  None'}

PENDING WITHDRAWALS (${(withdrawals||[]).length}):
${(withdrawals||[]).map(w => `  - ${fmtN(w.amount)} by ${w.profiles?.name || 'Seller'}`).join('\n') || '  None'}

RECENT ORDERS (last 20): ${(orders||[]).length} orders, Total: ${fmtN((orders||[]).reduce((s,o)=>s+(o.total_amount||0),0))}
  Pending: ${(orders||[]).filter(o=>o.status==='pending').length} | Confirmed: ${(orders||[]).filter(o=>o.status==='confirmed').length} | Delivered: ${(orders||[]).filter(o=>o.status==='delivered').length}

EXPIRED/UNPAID USERS (candidates for suspension):
${expiredSellers.filter(s=>s.role==='seller').map(s => `  - SELLER: ${s.name} (${s.email}) ID:${s.id.substring(0,8)}`).join('\n') || '  No expired sellers'}
${expiredSPs.map(s => `  - SVC_PROVIDER: ${s.name} (${s.email}) ID:${s.id.substring(0,8)}`).join('\n') || '  No expired service providers'}
=== END SNAPSHOT ===`;
  } catch(e) {
    dbContext = '\n[Database read failed – using cached stats only]';
  }

  const systemPrompt = `You are BUYSELL AI — the elite Chief Operating Officer for Nigeria's leading marketplace platform.

🎯 YOUR ROLE:
You are a proactive, data-driven admin assistant. Analyze platform health, suggest optimizations, and execute actions when needed.

📊 AVAILABLE DATA:
You have live access to: disputes, sellers, service providers, orders, revenue, products, reviews, KYC, withdrawals, receipts.

⚡ POWERFUL ACTIONS (include EXACT token in response):
1. [ACTION: SUSPEND_UNPAID_SELLERS] — Suspend sellers with expired unpaid trials
2. [ACTION: SUSPEND_UNPAID_PROVIDERS] — Suspend service providers with expired trials
3. [ACTION: DEACTIVATE_USER:uuid] — Suspend any user by ID
4. [ACTION: RESOLVE_DISPUTE:dispute_id] — Close dispute with resolution
5. [ACTION: APPROVE_RECEIPT:receipt_id] — Approve commission payment
6. [ACTION: REJECT_RECEIPT:receipt_id:reason] — Reject receipt with reason
7. [ACTION: APPROVE_WITHDRAWAL:withdrawal_id] — Approve payout request
8. [ACTION: APPROVE_KYC:kyc_id] — Approve identity verification
9. [ACTION: REJECT_KYC:kyc_id:reason] — Reject KYC with reason
10. [ACTION: BROADCAST:title:message] — Send platform-wide notification
11. [ACTION: EXPORT_REPORT:type] — Generate report (sellers/orders/revenue)
12. [ACTION: CREATE_COUPON:code:percent:days] — Create promo coupon
13. [ACTION: REFRESH_DATA] — Reload dashboard stats

📈 INSIGHTS TO PROVIDE:
• Revenue trends & forecasts
• Top performing sellers/products
• At-risk accounts (expiring trials, low ratings)
• Dispute patterns & resolution times
• User growth metrics
• Conversion funnel analysis

🎨 RESPONSE STYLE:
• Use emoji liberally for visual hierarchy
• Present stats in clean bullet format
• Include specific names & numbers
• Be proactive — suggest actions, don't just answer
• For suspensions: cite specific reasons (days overdue, unresolved disputes, etc.)
• End with clear recommendation or question
• Use tables for comparisons

⚖️ DECISION FRAMEWORK:
• For disputes: Summarize issue → Review evidence → Suggest resolution
• For sellers: Tier + sales + rating → Keep/Pause/Remove
• For revenue: Current vs previous period → Trend → Recommendation

${dbContext}

REMEMBER: You're the expert. Proactively identify issues, suggest fixes, and act when appropriate.`;

  try {
    const reply = await callGroq(adminAiHistory, systemPrompt);
    let finalReply = reply;

    // ── ADVANCED ACTION PARSER ──
    let actionLog = [];
    
    // 1. Suspend unpaid sellers
    if (finalReply.includes('[ACTION: SUSPEND_UNPAID_SELLERS]')) {
      finalReply = finalReply.replace('[ACTION: SUSPEND_UNPAID_SELLERS]', '⚡ Executing seller suspension...').trim();
      executeMassSuspension();
      actionLog.push('Suspended unpaid sellers');
    }
    // 2. Suspend unpaid service providers
    if (finalReply.includes('[ACTION: SUSPEND_UNPAID_PROVIDERS]')) {
      finalReply = finalReply.replace('[ACTION: SUSPEND_UNPAID_PROVIDERS]', '⚡ Executing provider suspension...').trim();
      executeMassProviderSuspension();
      actionLog.push('Suspended unpaid providers');
    }
    // 3. Deactivate specific user
    const deactivateMatch = finalReply.match(/\[ACTION: DEACTIVATE_USER:([a-f0-9-]+)\]/i);
    if (deactivateMatch) {
      const targetId = deactivateMatch[1];
      finalReply = finalReply.replace(deactivateMatch[0], `⚡ Deactivating user ${targetId.substring(0,8)}...`);
      await adminAiDeactivateUser(targetId);
      actionLog.push(`Deactivated user ${targetId.substring(0,8)}`);
    }
    // 4. Resolve dispute
    const resolveMatch = finalReply.match(/\[ACTION: RESOLVE_DISPUTE:([a-f0-9-]+)\]/i);
    if (resolveMatch) {
      const disputeId = resolveMatch[1];
      finalReply = finalReply.replace(resolveMatch[0], `✅ Resolving dispute ${disputeId.substring(0,8)}...`);
      await adminAiResolveDispute(disputeId);
      actionLog.push(`Resolved dispute ${disputeId.substring(0,8)}`);
    }
    // 5. Approve receipt
    const approveMatch = finalReply.match(/\[ACTION: APPROVE_RECEIPT:([a-f0-9-]+)\]/i);
    if (approveMatch) {
      const receiptId = approveMatch[1];
      finalReply = finalReply.replace(approveMatch[0], `✅ Approving receipt ${receiptId.substring(0,8)}...`);
      await adminAiApproveReceipt(receiptId);
      actionLog.push(`Approved receipt ${receiptId.substring(0,8)}`);
    }
    // 6. Reject receipt
    const rejectMatch = finalReply.match(/\[ACTION: REJECT_RECEIPT:([a-f0-9-]+):(.+)\]/i);
    if (rejectMatch) {
      const [_, receiptId, reason] = rejectMatch;
      finalReply = finalReply.replace(rejectMatch[0], `❌ Rejecting receipt ${receiptId.substring(0,8)}...`);
      await adminAiRejectReceipt(receiptId, reason);
      actionLog.push(`Rejected receipt ${receiptId.substring(0,8)}`);
    }
    // 7. Approve withdrawal
    const wdMatch = finalReply.match(/\[ACTION: APPROVE_WITHDRAWAL:([a-f0-9-]+)\]/i);
    if (wdMatch) {
      const wdId = wdMatch[1];
      finalReply = finalReply.replace(wdMatch[0], `✅ Approving withdrawal ${wdId.substring(0,8)}...`);
      await adminAiApproveWithdrawal(wdId);
      actionLog.push(`Approved withdrawal ${wdId.substring(0,8)}`);
    }
    // 8. Approve KYC
    const kycMatch = finalReply.match(/\[ACTION: APPROVE_KYC:([a-f0-9-]+)\]/i);
    if (kycMatch) {
      const kycId = kycMatch[1];
      finalReply = finalReply.replace(kycMatch[0], `✅ Approving KYC ${kycId.substring(0,8)}...`);
      await adminAiApproveKyc(kycId);
      actionLog.push(`Approved KYC ${kycId.substring(0,8)}`);
    }
    // 9. Reject KYC
    const kycRejectMatch = finalReply.match(/\[ACTION: REJECT_KYC:([a-f0-9-]+):(.+)\]/i);
    if (kycRejectMatch) {
      const [_, kycId, reason] = kycRejectMatch;
      finalReply = finalReply.replace(kycRejectMatch[0], `❌ Rejecting KYC ${kycId.substring(0,8)}...`);
      await adminAiRejectKyc(kycId, reason);
      actionLog.push(`Rejected KYC ${kycId.substring(0,8)}`);
    }
    // 10. Broadcast
    const bcMatch = finalReply.match(/\[ACTION: BROADCAST:(.+):(.+)\]/i);
    if (bcMatch) {
      const [_, title, message] = bcMatch;
      finalReply = finalReply.replace(bcMatch[0], `📣 Sending broadcast: ${title}...`);
      await sendBroadcastMessage(title, message);
      actionLog.push(`Broadcast: ${title}`);
    }
    // 11. Create coupon
    const couponMatch = finalReply.match(/\[ACTION: CREATE_COUPON:([A-Z0-9]+):(\d+):(\d+)\]/i);
    if (couponMatch) {
      const [_, code, percent, days] = couponMatch;
      finalReply = finalReply.replace(couponMatch[0], `🎟️ Creating coupon ${code}...`);
      await adminAiCreateCoupon(code, parseInt(percent), parseInt(days));
      actionLog.push(`Created coupon ${code}`);
    }
    // 12. Export report
    const exportMatch = finalReply.match(/\[ACTION: EXPORT_REPORT:(sellers|orders|revenue|disputes)\]/i);
    if (exportMatch) {
      const reportType = exportMatch[1];
      finalReply = finalReply.replace(exportMatch[0], `📊 Generating ${reportType} report...`);
      exportAdminReport(reportType);
      actionLog.push(`Generated ${reportType} report`);
    }
    // 13. Refresh data
    if (finalReply.includes('[ACTION: REFRESH_DATA]')) {
      finalReply = finalReply.replace('[ACTION: REFRESH_DATA]', '🔄 Refreshing dashboard...');
      loadAdminOverview();
      actionLog.push('Refreshed dashboard');
    }
    
    // Add action summary if any actions taken
    if (actionLog.length > 0) {
      finalReply += '<br><br><em style="color:var(--green)">✓ Actions completed: ' + actionLog.join(', ') + '</em>';
    }

    adminAiHistory.push({ role: 'assistant', content: finalReply });

    document.getElementById('admin-typing')?.remove();
    const replyDiv = document.createElement('div');
    replyDiv.style.cssText = 'display:flex;gap:.42rem';
    const formattedReply = escHtml(finalReply).replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>');
    replyDiv.innerHTML = `<div style="background:var(--green-xlt);color:var(--green);font-size:.76rem;flex-shrink:0;width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center"><i class="fa-solid fa-robot"></i></div><div style="background:#fff;border:1px solid var(--border);padding:.52rem .82rem;border-radius:14px;font-size:.79rem;max-width:82%;line-height:1.5">${formattedReply}</div>`;
    container.appendChild(replyDiv);

  } catch(e) {
    document.getElementById('admin-typing')?.remove();
    toast('AI unavailable', 'Try again shortly', 'warn');
  }

  container.scrollTop = container.scrollHeight;
}


async function executeMassSuspension() {
  toast('Executing Enforcement', 'AI is scanning and suspending unpaid sellers...', 'info', 3000);
  
  const { data: sellers } = await db.from('profiles').select('id, name, commission_paid, trial_end').eq('role', 'seller');
  if (!sellers) {
    toast('Suspension Failed', 'Could not retrieve sellers list', 'error');
    return;
  }
  
  const now = new Date();
  const targetIds = sellers
    .filter(s => !s.commission_paid && (!s.trial_end || new Date(s.trial_end) <= now))
    .map(s => s.id);
    
  if (targetIds.length === 0) {
    toast('No Actions Needed', 'All sellers are paid or still within trial', 'success', 5000);
    return;
  }
  
  // Deactivate products of suspended sellers
  await db.from('products').update({ status: 'paused' }).in('seller_id', targetIds).catch(() => {});
  const { error } = await db.from('profiles').update({ updated_at: new Date().toISOString() }).in('id', targetIds);
  
  if (error) {
    toast('Execution Error', error.message, 'error');
    return;
  }
  
  toast('Enforcement Complete', `Successfully locked out ${targetIds.length} expired accounts.`, 'success', 6000);
  loadAdminOverview();
}

// ====================================================
//  AI ACTION HANDLERS
// ====================================================
async function executeMassProviderSuspension() {
  toast('Suspending Providers', 'AI is scanning service providers...', 'info', 3000);
  const { data: providers } = await db.from('profiles').select('id, name, commission_paid, trial_end').eq('role', 'service_provider');
  if (!providers) { toast('Failed', 'Could not retrieve providers', 'error'); return; }

  const now = new Date();
  const targetIds = providers
    .filter(s => !s.commission_paid && (!s.trial_end || new Date(s.trial_end) <= now))
    .map(s => s.id);

  if (!targetIds.length) { toast('No Action Needed', 'All providers are paid or in trial', 'success'); return; }

  // Pause their gigs
  await db.from('service_gigs').update({ status: 'paused' }).in('provider_id', targetIds).catch(() => {});
  const { error } = await db.from('profiles').update({ updated_at: new Date().toISOString() }).in('id', targetIds);
  if (error) { toast('Error', error.message, 'error'); return; }

  toast('Providers Suspended', `${targetIds.length} expired accounts locked out`, 'success', 6000);
  loadAdminOverview();
}

async function adminAiDeactivateUser(userId) {
  try {
    // Pause all their products/gigs
    await db.from('products').update({ status: 'paused' }).eq('seller_id', userId).catch(() => {});
    await db.from('service_gigs').update({ status: 'paused' }).eq('provider_id', userId).catch(() => {});
    // Mark commission as unpaid to trigger lockout
    await db.from('profiles').update({ commission_paid: false, trial_end: new Date('2020-01-01').toISOString() }).eq('id', userId);
    toast('User Deactivated', `User ${userId.substring(0,8)} has been suspended by AI`, 'warn', 5000);
    loadAdminSellers();
  } catch(e) {
    toast('Deactivation Failed', e.message, 'error');
  }
}

async function adminAiResolveDispute(disputeId) {
  try {
    await db.from('disputes').update({ status: 'resolved', resolved_at: new Date().toISOString() }).eq('id', disputeId);
    toast('Dispute Resolved', `Dispute ${disputeId.substring(0,8)} closed by AI`, 'success');
    loadAdminDisputes();
  } catch(e) {
    toast('Failed', e.message, 'error');
  }
}

async function adminAiApproveReceipt(receiptId) {
  try {
    const { data: receipt } = await db.from('commission_receipts').select('seller_id').eq('id', receiptId).single();
    if (receipt?.seller_id) {
      await db.from('profiles').update({ commission_paid: true }).eq('id', receipt.seller_id);
    }
    await db.from('commission_receipts').update({ status: 'approved', reviewed_at: new Date().toISOString() }).eq('id', receiptId);
    toast('Receipt Approved', 'Seller activated by AI', 'success');
    loadAdminReceipts();
  } catch(e) {
    toast('Failed', e.message, 'error');
  }
}

async function adminAiRejectReceipt(receiptId, reason) {
  try {
    await db.from('commission_receipts').update({ status: 'rejected', reviewed_at: new Date().toISOString(), rejection_reason: reason }).eq('id', receiptId);
    toast('Receipt Rejected', reason, 'warn');
    loadAdminReceipts();
  } catch(e) {
    toast('Failed', e.message, 'error');
  }
}

async function adminAiApproveWithdrawal(withdrawalId) {
  try {
    await db.from('withdrawals').update({ status: 'approved', processed_at: new Date().toISOString() }).eq('id', withdrawalId);
    toast('Withdrawal Approved', 'Funds released', 'success');
    loadAdminWithdrawals();
  } catch(e) {
    toast('Failed', e.message, 'error');
  }
}

async function adminAiApproveKyc(kycId) {
  try {
    await db.from('kyc_submissions').update({ status: 'approved', reviewed_at: new Date().toISOString() }).eq('id', kycId);
    await db.from('profiles').update({ kyc_verified: true }).eq('id', kycId);
    toast('KYC Approved', 'User verified', 'success');
    loadAdminKyc();
  } catch(e) {
    toast('Failed', e.message, 'error');
  }
}

async function adminAiRejectKyc(kycId, reason) {
  try {
    await db.from('kyc_submissions').update({ status: 'rejected', reviewed_at: new Date().toISOString(), rejection_reason: reason }).eq('id', kycId);
    toast('KYC Rejected', reason, 'warn');
    loadAdminKyc();
  } catch(e) {
    toast('Failed', e.message, 'error');
  }
}

async function sendBroadcastMessage(title, message) {
  try {
    await db.from('broadcasts').insert({
      title: title,
      message: message,
      target: 'all',
      created_at: new Date().toISOString()
    });
    toast('Broadcast Sent!', title, 'success');
  } catch(e) {
    toast('Failed', e.message, 'error');
  }
}

async function adminAiCreateCoupon(code, percent, daysValid) {
  try {
    const expires = new Date(); expires.setDate(expires.getDate() + daysValid);
    await db.from('coupons').insert({
      seller_id: currentUser.id,
      code: code,
      discount_type: 'percent',
      discount_value: percent,
      min_order: 0,
      max_uses: 100,
      expires_at: expires.toISOString(),
      is_active: true
    });
    toast('Coupon Created!', `${code} - ${percent}% off`, 'success');
    loadSellerCoupons();
  } catch(e) {
    toast('Failed', e.message, 'error');
  }
}

async function sendBroadcast() {
  const target = document.getElementById('bc-target')?.value || 'all';
  const title = document.getElementById('bc-title')?.value.trim();
  const body = document.getElementById('bc-body')?.value.trim();
  if (!title || !body) { toast('Fill all fields', '', 'warn'); return; }
  try {
    await db.from('broadcasts').insert({
      target, title, message: body,
      created_at: new Date().toISOString()
    });
    toast('Broadcast Sent!', title, 'success');
    ['bc-title','bc-body'].forEach(id => { const el = document.getElementById(id); if(el) el.value = ''; });
  } catch(e) {
    toast('Failed', e.message, 'error');
  }
}

// ====================================================
//  AI ACTION HANDLERS
// ====================================================
async function executeMassProviderSuspension() {
  toast('Suspending Providers', 'AI is scanning service providers...', 'info', 3000);
  const { data: providers } = await db.from('profiles').select('id, name, commission_paid, trial_end').eq('role', 'service_provider');
  if (!providers) { toast('Failed', 'Could not retrieve providers', 'error'); return; }

  const now = new Date();
  const targetIds = providers
    .filter(s => !s.commission_paid && (!s.trial_end || new Date(s.trial_end) <= now))
    .map(s => s.id);

  if (!targetIds.length) { toast('No Action Needed', 'All providers are paid or in trial', 'success'); return; }

  // Pause their gigs
  await db.from('service_gigs').update({ status: 'paused' }).in('provider_id', targetIds).catch(() => {});
  const { error } = await db.from('profiles').update({ updated_at: new Date().toISOString() }).in('id', targetIds);
  if (error) { toast('Error', error.message, 'error'); return; }

  toast('Providers Suspended', `${targetIds.length} expired accounts locked out`, 'success', 6000);
  loadAdminOverview();
}

async function adminAiDeactivateUser(userId) {
  try {
    // Pause all their products/gigs
    await db.from('products').update({ status: 'paused' }).eq('seller_id', userId).catch(() => {});
    await db.from('service_gigs').update({ status: 'paused' }).eq('provider_id', userId).catch(() => {});
    // Mark commission as unpaid to trigger lockout
    await db.from('profiles').update({ commission_paid: false, trial_end: new Date('2020-01-01').toISOString() }).eq('id', userId);
    toast('User Deactivated', `User ${userId.substring(0,8)} has been suspended by AI`, 'warn', 5000);
    loadAdminSellers();
  } catch(e) {
    toast('Deactivation Failed', e.message, 'error');
  }
}

async function adminAiResolveDispute(disputeId) {
  try {
    await db.from('disputes').update({ status: 'resolved', resolved_at: new Date().toISOString() }).eq('id', disputeId);
    toast('Dispute Resolved', `Dispute ${disputeId.substring(0,8)} closed by AI`, 'success');
    loadAdminDisputes();
  } catch(e) {
    toast('Failed', e.message, 'error');
  }
}

async function adminAiApproveReceipt(receiptId) {
  try {
    const { data: receipt } = await db.from('commission_receipts').select('seller_id').eq('id', receiptId).single();
    if (receipt?.seller_id) {
      await db.from('profiles').update({ commission_paid: true }).eq('id', receipt.seller_id);
    }
    await db.from('commission_receipts').update({ status: 'approved', reviewed_at: new Date().toISOString() }).eq('id', receiptId);
    toast('Receipt Approved', 'Seller activated by AI', 'success');
    loadAdminReceipts();
  } catch(e) {
    toast('Failed', e.message, 'error');
  } 
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

// ====================================================
//  KYC VERIFICATION SYSTEM
// ====================================================
function checkAndPromptKyc() {
  if (!currentUser?.profile) return false;
  const role = currentUser.profile.role;
  if (role !== 'seller' && role !== 'service_provider') return true;
  
  if (currentUser.profile.kyc_verified || currentUser.profile.kyc_status === 'approved') return true;
  
  const statusEl = document.getElementById('kyc-status-banner');
  if (currentUser.profile.kyc_status === 'pending') {
    statusEl.innerHTML = '<i class="fa-solid fa-clock text-xl"></i> <div><b>Verification Pending</b><br>Your KYC documents are currently under review.</div>';
    statusEl.style.background = '#fef3c7'; statusEl.style.color = '#92400e';
    statusEl.classList.remove('hidden');
    document.getElementById('kyc-submit-btn').disabled = true;
    document.getElementById('kyc-submit-btn').innerHTML = '<i class="fa-solid fa-clock"></i> Under Review';
    showModal('kyc-modal');
    return false;
  }
  
  if (currentUser.profile.kyc_status === 'rejected') {
    statusEl.innerHTML = '<i class="fa-solid fa-exclamation-triangle text-xl"></i> <div><b>Verification Rejected</b><br>Please resubmit your documents with clear photos.</div>';
    statusEl.style.background = '#fee2e2'; statusEl.style.color = '#b91c1c';
    statusEl.classList.remove('hidden');
  }

  showModal('kyc-modal');
  return false;
}

async function submitKyc(e) {
  e.preventDefault();
  if (!currentUser) return;
  const btn = document.getElementById('kyc-submit-btn');
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Uploading...';
  
  try {
    const docType = document.getElementById('kyc-doc-type').value;
    const docNum  = document.getElementById('kyc-doc-number').value.trim();
    const name    = document.getElementById('kyc-full-name').value.trim();
    
    // Upload files
    const uploadFile = async (id) => {
      const el = document.getElementById(id);
      if (!el.files?.[0]) return null;
      const file = el.files[0];
      const ext = file.name.split('.').pop();
      const path = `kyc/${currentUser.id}/${id}_${Date.now()}.${ext}`;
      const { error } = await db.storage.from('uploads').upload(path, file);
      if (error) throw new Error(`Failed to upload ${id}`);
      return db.storage.from('uploads').getPublicUrl(path).data.publicUrl;
    };

    const [frontUrl, backUrl, selfieUrl] = await Promise.all([
      uploadFile('kyc-front'), uploadFile('kyc-back'), uploadFile('kyc-selfie')
    ]);

    if (!frontUrl || !selfieUrl) throw new Error("Front photo and selfie are required");

    await db.from('kyc_verifications').insert({
      user_id: currentUser.id,
      document_type: docType,
      document_number: docNum,
      full_name: name,
      document_front_url: frontUrl,
      document_back_url: backUrl,
      selfie_url: selfieUrl,
      status: 'pending'
    });

    await db.from('profiles').update({ kyc_status: 'pending' }).eq('id', currentUser.id);
    currentUser.profile.kyc_status = 'pending';
    
    toast('KYC Submitted', ' documents are pending review', 'success');
    closeModal('kyc-modal');
    checkAndPromptKyc(); // updates modal UI
  } catch(e) {
    toast('Error', e.message, 'error');
    btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-shield-check"></i> Submit Verification';
  }
}

// Admin KYC management
async function loadAdminKyc() {
  if (!guardAdminPanel()) return;
  const filter = document.getElementById('adm-kyc-filter').value;
  let q = db.from('kyc_verifications').select('*, profiles(name, email, role)').order('created_at', { ascending: false });
  if (filter !== 'all') q = q.eq('status', filter);
  
  const { data: kycs, error } = await q;
  document.getElementById('adm-kyc-skeleton').classList.add('hidden');
  const list = document.getElementById('adm-kyc-list');
  const empty = document.getElementById('adm-kyc-empty');
  
  if (error || !kycs?.length) {
    list.classList.add('hidden'); empty.classList.remove('hidden');
    return;
  }
  
  list.classList.remove('hidden'); empty.classList.add('hidden');
  list.innerHTML = kycs.map(k => `
    <div class="card card-pad mb-3" style="border-left: 4px solid ${k.status==='approved'?'var(--green)':k.status==='rejected'?'var(--red)':'var(--gold)'}">
      <div class="flex justify-between items-start mb-2 flex-wrap gap-2">
        <div>
          <div class="font-bold flex items-center gap-2">${escHtml(k.profiles?.name||'Unknown')} <span class="badge badge-gray">${k.profiles?.role}</span></div>
          <div class="text-xs color-text3">${escHtml(k.profiles?.email)}</div>
          <div class="text-sm mt-1"><b>ID:</b> ${escHtml(k.document_number)} (${k.document_type.toUpperCase()})</div>
          <div class="text-sm"><b>Name on ID:</b> ${escHtml(k.full_name)}</div>
        </div>
        <span class="badge ${k.status==='approved'?'badge-green':k.status==='rejected'?'badge-red':'badge-gold'}">${k.status.toUpperCase()}</span>
      </div>
      <div class="flex gap-2 flex-wrap mb-3 mt-2">
        <a href="${k.document_front_url}" target="_blank" class="btn btn-outline btn-sm"><i class="fa-solid fa-id-card"></i> Front</a>
        ${k.document_back_url ? `<a href="${k.document_back_url}" target="_blank" class="btn btn-outline btn-sm"><i class="fa-solid fa-id-card"></i> Back</a>` : ''}
        <a href="${k.selfie_url}" target="_blank" class="btn btn-outline btn-sm"><i class="fa-solid fa-user"></i> Selfie</a>
      </div>
      ${k.status === 'pending' ? `
        <div class="flex gap-2 border-t pt-3 mt-2">
          <button class="btn btn-primary btn-sm flex-1" onclick="adminApproveKyc('${k.id}', '${k.user_id}')"><i class="fa-solid fa-check"></i> Approve KYC</button>
          <button class="btn btn-outline btn-sm text-red flex-1" onclick="adminRejectKyc('${k.id}', '${k.user_id}')" style="border-color:var(--red);color:var(--red)"><i class="fa-solid fa-times"></i> Reject</button>
        </div>
      ` : ''}
    </div>
  `).join('');
}

async function adminApproveKyc(kycId, userId) {
  if (!confirm('Approve KYC and verify this user?')) return;
  try {
    await db.from('kyc_verifications').update({ status: 'approved', reviewed_at: new Date().toISOString() }).eq('id', kycId);
    await db.from('profiles').update({ kyc_status: 'approved', kyc_verified: true }).eq('id', userId);
    toast('KYC Approved', 'User is now a verified seller.', 'success');
    loadAdminKyc();
  } catch(e) { toast('Error', e.message, 'error'); }
}

async function adminRejectKyc(kycId, userId) {
  const note = prompt('Reason for rejection:');
  if (!note) return;
  try {
    await db.from('kyc_verifications').update({ status: 'rejected', admin_note: note, reviewed_at: new Date().toISOString() }).eq('id', kycId);
    await db.from('profiles').update({ kyc_status: 'rejected', kyc_verified: false }).eq('id', userId);
    toast('KYC Rejected', 'User must resubmit.', 'warn');
    loadAdminKyc();
  } catch(e) { toast('Error', e.message, 'error'); }
}

// ====================================================
//  ADMIN — RECEIPTS MANAGEMENT
// ====================================================
async function loadAdminReceipts() {
  if (!guardAdminPanel()) return;
  try {
    const { data: receipts } = await db.from('commission_receipts')
      .select('*, profiles(name, email)')
      .order('created_at', { ascending: false });

    const all = receipts || [];
    const pending  = all.filter(r => r.status === 'pending').length;
    const approved = all.filter(r => r.status === 'approved').length;
    const rejected = all.filter(r => r.status === 'rejected').length;

    document.getElementById('rcpt-pending').textContent  = pending;
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
    // 1. Update receipt status
    await db.from('commission_receipts').update({
      status: 'approved',
      reviewed_at: new Date().toISOString()
    }).eq('id', receiptId);

    // 2. Activate the seller's commission_paid flag
    await db.from('profiles').update({
      commission_paid: true,
      updated_at: new Date().toISOString()
    }).eq('id', sellerId);

    toast('Receipt Approved ✅', 'Seller store is now active.', 'success');
    loadAdminReceipts();
  } catch(e) {
    toast('Error', e.message, 'error');
  }
}

async function rejectReceipt(receiptId) {
  const note = prompt('Reason for rejection (optional):') || '';
  try {
    await db.from('commission_receipts').update({
      status: 'rejected',
      admin_note: note,
      reviewed_at: new Date().toISOString()
    }).eq('id', receiptId);

    toast('Receipt Rejected', 'Seller has been notified.', 'warn');
    loadAdminReceipts();
  } catch(e) {
    toast('Error', e.message, 'error');
  }
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
//  CHATBOT (uses Groq directly)
// ====================================================
async function sendChat() {
  const input  = document.getElementById('chat-input');
  const msg    = input.value.trim();
  if (!msg) return;

  addChatMsg(msg, 'user');
  input.value = '';
  chatHistory.push({ role: 'user', content: msg });

  const typingId = 'typing-' + Date.now();
  addChatMsg('...', 'bot', typingId);

  const context = {
    current_page:    getCurrentPage(),
    user_role:       currentRole || 'visitor',
    cart_item_count: cart.length,
    cart_total:      cart.reduce((s, c) => s + c.price * (c.qty || 1), 0),
    current_product: currentProd
      ? { name: currentProd.name, price: currentProd.price, category: currentProd.category }
      : null,
  };

  const systemPrompt = `You are the authentic BUYSELL Nigeria Assistant — friendly, helpful, and concise.
Current page: ${context.current_page}. User role: ${context.user_role}.
Cart: ${context.cart_item_count} item(s), total ₦${context.cart_total}.
${context.current_product ? `Viewing: "${context.current_product.name}" at ₦${context.current_product.price} (${context.current_product.category}).` : ''}
Help users shop, track orders, find products, and navigate the platform. Keep replies short and friendly.`;

  try {
    const reply = await callGroq(chatHistory, systemPrompt);
    chatHistory.push({ role: 'assistant', content: reply });

    const typingEl = document.getElementById(typingId);
    if (typingEl) typingEl.querySelector('.cb-bubble').textContent = reply;

  } catch (err) {
    const fallback = "Sorry, I'm having trouble right now. WhatsApp us at 09061484256 for instant help!";
    const typingEl = document.getElementById(typingId);
    if (typingEl) typingEl.querySelector('.cb-bubble').textContent = fallback;
  }
}


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
  if (!checkAndPromptKyc()) return;
  document.getElementById('buyer-view').style.display = 'none';
  document.getElementById('seller-dashboard').style.display = 'none';
  document.getElementById('storefront-view').style.display = 'none';
  if(document.getElementById('admin-portal-view')) document.getElementById('admin-portal-view').style.display = 'none';

  document.getElementById('service-provider-view').style.display = 'block';
  document.body.classList.add('in-seller');
  currentRole = 'service_provider';

  // Populate user info in SPD sidebar
  const nameEl  = document.getElementById('spd-user-name');
  const emailEl = document.getElementById('spd-user-email');
  if (nameEl)  nameEl.textContent  = currentUser.profile?.name  || 'Service Pro';
  if (emailEl) emailEl.textContent = currentUser.email || '';

  // Commission / trial check (same rules as sellers)
  checkServiceProviderCommission();

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
  if (section === 'overview')   loadSpdOverview();
  if (section === 'portfolio')  loadMyGigs();
  if (section === 'bookings')   loadProviderBookings();
  if (section === 'earnings')   loadProviderEarnings();
  if (section === 'settings')   loadSpdSettings();
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
          <div style="display:flex;gap:.5rem;flex:1">
            <button onclick="openMessageModal('${g.provider_id}', '${escAttr(provName)}')" class="btn btn-primary btn-sm flex-1">
              <i class="fa-solid fa-comment-dots"></i> Message
            </button>
            <a href="${waLink}" target="_blank" class="btn btn-outline btn-sm flex-1" style="text-decoration:none;border-color:var(--green);color:var(--green)">
              <i class="fa-brands fa-whatsapp"></i>
            </a>
          </div>
        </div>
      </div>
    </div>`;
  }).join('');
}

// ====================================================
//  SERVICE PROVIDER — Overview Stats
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
              <div style="font-size:.72rem;color:var(--text3)">${escHtml(g.category)} · ₦${(g.starting_rate||0).toLocaleString()}</div>
            </div>
            <span class="badge ${g.status==='active'?'badge-green':'badge-red'}">${g.status}</span>
          </div>`;
        }).join('')}`;
    }
  } catch(e) { console.error('SPD overview error:', e); }
}

// ====================================================
//  SERVICE PROVIDER — Settings
// ====================================================
async function loadSpdSettings() {
  if (!currentUser?.profile) return;
  const p = currentUser.profile;
  const nameEl = document.getElementById('spd-s-name');
  const waEl   = document.getElementById('spd-s-wa');
  const bioEl  = document.getElementById('spd-s-bio');
  if (nameEl) nameEl.value = p.name || '';
  if (waEl)   waEl.value   = p.whatsapp || '';
  if (bioEl)  bioEl.value  = p.store_description || '';
}

async function saveServiceProfile() {
  if (!currentUser) return;
  const name = document.getElementById('spd-s-name')?.value.trim();
  const wa   = document.getElementById('spd-s-wa')?.value.trim();
  const bio  = document.getElementById('spd-s-bio')?.value.trim();

  if (!name) { toast('Name required', '', 'warn'); return; }

  try {
    const { error } = await db.from('profiles').update({
      name:              validateInput(name),
      whatsapp:          wa,
      store_description: validateInput(bio),
      updated_at:        new Date().toISOString()
    }).eq('id', currentUser.id);
    
    if (error) throw error;
    
    // Update local profile
    currentUser.profile.name = name;
    currentUser.profile.whatsapp = wa;
    currentUser.profile.store_description = bio;
    
    // Update sidebar display
    document.getElementById('spd-user-name').textContent = name;
    
    toast('Profile Saved! ✅', 'Your changes are now live.', 'success');
  } catch(e) {
    toast('Save Failed', e.message, 'error');
  }
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
                <div style="font-size:.72rem;color:var(--text3);margin-top:.15rem">${escHtml(g.category)} · ${escHtml(g.location || '—')}</div>
              </div>
              <span class="badge ${g.status==='active'?'badge-green':'badge-red'}">${g.status}</span>
            </div>
            <p style="font-size:.78rem;color:var(--text2);margin-top:.4rem;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;line-height:1.45">${escHtml(g.description || 'No description')}</p>
            <div style="display:flex;align-items:center;justify-content:space-between;margin-top:.6rem">
              <div style="display:flex;align-items:center;gap:.75rem">
                <span style="font-weight:800;color:var(--green);font-size:.95rem">₦${(g.starting_rate||0).toLocaleString()}</span>
                ${imgCount > 0 ? `<span style="font-size:.7rem;color:var(--text3)"><i class="fa-solid fa-images"></i> ${imgCount} photo${imgCount>1?'s':''}</span>` : ''}
              </div>
              <button class="btn btn-ghost btn-sm" style="color:var(--red);font-size:.72rem" onclick="deleteGig('${g.id}')">
                <i class="fa-solid fa-trash"></i> Delete Gig
              </button>
            </div>
            
            ${imgCount > 0 ? `
              <div style="margin-top: .8rem; display: flex; gap: .5rem; overflow-x: auto; padding-bottom: .2rem">
                ${(g.portfolio_urls || []).map(url => `
                  <div style="position:relative; width: 60px; height: 60px; flex-shrink: 0; border-radius: 6px; overflow: hidden; border: 1px solid var(--border)">
                    <img src="${url}" style="width:100%; height:100%; object-fit:cover">
                    <button onclick="deletePortfolioImage('${url}', '${g.id}', event)" title="Delete this image" style="position:absolute; top: 2px; right: 2px; background: rgba(220,38,38,0.9); color: white; border: none; border-radius: 50%; width: 18px; height: 18px; font-size: 10px; cursor: pointer; display: flex; align-items:center; justify-content:center"><i class="fa-solid fa-times"></i></button>
                  </div>
                `).join('')}
              </div>
            ` : ''}
            
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

    // Book button
    const bookBtnContainer = document.getElementById('sp-p-book-btn');
    if (bookBtnContainer && mainGig) {
      bookBtnContainer.innerHTML = `<button class="btn btn-primary btn-full mt-3" onclick="bookService('${mainGig.id}','${providerId}')"><i class="fa-solid fa-calendar-check"></i> Book This Provider – from ₦${(mainGig.starting_rate||0).toLocaleString()}</button>`;
    }
  } catch(e) {
    console.error('Profile load error:', e);
  }
}

// ====================================================
//  SERVICE PROVIDER — COMMISSION CHECK (same rules as sellers)
// ====================================================
async function checkServiceProviderCommission() {
  if (!currentUser?.profile) return;
  const p = currentUser.profile;
  const role = p.role;
  if (role !== 'service_provider') return;

  const trialEnd = p.trial_end ? new Date(p.trial_end) : null;
  const commPaid = p.commission_paid;

  // Update SPD commission badge if it exists
  const badge = document.getElementById('spd-comm-badge');
  if (badge) {
    if (commPaid) { badge.className='badge badge-green'; badge.textContent='✓ Active'; }
    else if (trialEnd && trialEnd > new Date()) { badge.className='badge badge-gold'; badge.textContent=`Trial – ${Math.ceil((trialEnd-new Date())/86400000)}d left`; }
    else { badge.className='badge badge-red'; badge.textContent='Suspended'; }
  }

  // Lock out if expired
  if (!commPaid && trialEnd && trialEnd < new Date() && currentUser.email !== ADMIN_EMAIL) {
    document.getElementById('suspended-modal').classList.add('open');
  }
}

// ====================================================
//  SERVICE PROVIDER — BOOKINGS (Provider Side)
// ====================================================
async function loadProviderBookings() {
  if (!currentUser) return;
  const container = document.getElementById('spd-bookings-list');
  if (!container) return;
  container.innerHTML = '<div class="skeleton-block" style="height:80px"></div>'.repeat(3);

  try {
    const { data: bookings } = await db.from('service_bookings')
      .select('*, profiles!service_bookings_buyer_id_fkey(name, email, whatsapp), service_gigs(title)')
      .eq('provider_id', currentUser.id)
      .order('created_at', { ascending: false });

    if (!bookings?.length) {
      container.innerHTML = '<div class="empty-state"><i class="fa-solid fa-inbox" style="font-size:2rem;color:var(--border2);display:block;margin-bottom:.65rem"></i><p class="color-text3 text-sm">No bookings yet. Share your services to get hired!</p></div>';
      return;
    }

    const statusColors = {pending:'badge-gold',accepted:'badge-blue',in_progress:'badge-purple',completed:'badge-green',cancelled:'badge-red'};
    container.innerHTML = bookings.map(b => {
      const buyerName = b.profiles?.name || 'Buyer';
      const buyerWa = (b.profiles?.whatsapp || '').replace(/\D/g,'');
      const gigTitle = b.service_gigs?.title || 'Service';
      return `
      <div class="card card-pad mb-3" style="border-left:4px solid ${b.status==='completed'?'var(--green)':b.status==='cancelled'?'var(--red)':'var(--gold)'}">
        <div class="flex justify-between items-start flex-wrap gap-2 mb-2">
          <div>
            <div class="font-bold text-sm">${escHtml(gigTitle)}</div>
            <div class="text-xs color-text3"><i class="fa-solid fa-user"></i> ${escHtml(buyerName)} · ${fmtDate(b.created_at)}</div>
            ${b.message ? `<div class="text-sm mt-1" style="color:var(--text2)">"${escHtml(b.message.substring(0,150))}"</div>` : ''}
          </div>
          <div class="text-right">
            <div class="font-bold color-green">${fmtN(b.agreed_price || b.budget || 0)}</div>
            <span class="badge ${statusColors[b.status]||'badge-gray'}">${(b.status||'pending').replace(/_/g,' ')}</span>
          </div>
        </div>
        <div class="flex gap-2 flex-wrap mt-2">
          ${b.status==='pending' ? `
            <button onclick="updateBookingStatus('${b.id}','accepted')" class="btn btn-primary btn-sm"><i class="fa-solid fa-check"></i> Accept</button>
            <button onclick="updateBookingStatus('${b.id}','cancelled')" class="btn btn-outline btn-sm">Decline</button>
          ` : ''}
          ${b.status==='accepted' ? `<button onclick="updateBookingStatus('${b.id}','in_progress')" class="btn btn-sm" style="background:#ede9fe;color:#6d28d9"><i class="fa-solid fa-play"></i> Start Work</button>` : ''}
          ${b.status==='in_progress' ? `<button onclick="updateBookingStatus('${b.id}','completed')" class="btn btn-sm" style="background:#dcfce7;color:#15803d"><i class="fa-solid fa-check-double"></i> Mark Completed</button>` : ''}
          ${buyerWa ? `<a href="https://wa.me/${buyerWa}" target="_blank" class="btn btn-outline btn-sm"><i class="fa-brands fa-whatsapp"></i> Chat</a>` : ''}
        </div>
      </div>`;
    }).join('');

    // Update badge count
    const pendingCount = bookings.filter(b => b.status === 'pending').length;
    const bookingsBadge = document.getElementById('spd-bookings-badge');
    if (bookingsBadge) { bookingsBadge.textContent = pendingCount; bookingsBadge.classList.toggle('hidden', !pendingCount); }
  } catch(e) {
    console.error('loadProviderBookings:', e);
    container.innerHTML = '<p class="color-text3 text-sm">Could not load bookings.</p>';
  }
}

async function updateBookingStatus(bookingId, status) {
  try {
    const updates = { status };
    if (status === 'completed') updates.completed_at = new Date().toISOString();
    const { error } = await db.from('service_bookings').update(updates).eq('id', bookingId).eq('provider_id', currentUser.id);
    if (error) throw error;
    toast(`Booking ${status.replace(/_/g,' ')}!`, '', 'success');
    loadProviderBookings();
  } catch(e) {
    toast('Error', e.message, 'error');
  }
}

// ====================================================
//  SERVICE PROVIDER — EARNINGS
// ====================================================
async function loadProviderEarnings() {
  if (!currentUser) return;
  try {
    const { data: bookings } = await db.from('service_bookings')
      .select('agreed_price, budget, status, created_at')
      .eq('provider_id', currentUser.id);
    const completed = (bookings||[]).filter(b => b.status === 'completed');
    const totalEarned = completed.reduce((s,b) => s + (b.agreed_price || b.budget || 0), 0);
    const pendingJobs = (bookings||[]).filter(b => b.status === 'in_progress' || b.status === 'accepted');
    const pendingEarnings = pendingJobs.reduce((s,b) => s + (b.agreed_price || b.budget || 0), 0);

    const el = document.getElementById('spd-earnings-content');
    if (!el) return;
    el.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:1rem;margin-bottom:1.5rem">
        <div class="card card-pad" style="text-align:center">
          <div class="text-xs color-text3 mb-1">Total Earned</div>
          <div style="font-size:1.4rem;font-weight:800;color:var(--green)">${fmtN(totalEarned)}</div>
        </div>
        <div class="card card-pad" style="text-align:center">
          <div class="text-xs color-text3 mb-1">Pending Jobs</div>
          <div style="font-size:1.4rem;font-weight:800;color:var(--purple)">${pendingJobs.length}</div>
        </div>
        <div class="card card-pad" style="text-align:center">
          <div class="text-xs color-text3 mb-1">In Pipeline</div>
          <div style="font-size:1.4rem;font-weight:800;color:var(--gold)">${fmtN(pendingEarnings)}</div>
        </div>
        <div class="card card-pad" style="text-align:center">
          <div class="text-xs color-text3 mb-1">Completed Jobs</div>
          <div style="font-size:1.4rem;font-weight:800;color:var(--green)">${completed.length}</div>
        </div>
      </div>
      <div class="card card-pad">
        <h3 class="mb-3"><i class="fa-solid fa-clock-rotate-left"></i> Recent Completions</h3>
        ${completed.length ? completed.slice(0,10).map(b => `
          <div class="flex justify-between items-center py-2 border-b border-border">
            <div class="text-sm">${fmtDate(b.created_at)}</div>
            <div class="font-bold color-green">${fmtN(b.agreed_price || b.budget || 0)}</div>
          </div>
        `).join('') : '<p class="color-text3 text-sm">No completed jobs yet.</p>'}
      </div>`;
  } catch(e) { console.error('loadProviderEarnings:', e); }
}

// ====================================================
//  BOOK SERVICE (Buyer Side)
// ====================================================
async function bookService(gigId, providerId) {
  if (!currentUser) { showModal('auth-modal'); return; }
  const message = prompt('Describe what you need (optional):') || '';
  const budget = prompt('Your budget (₦):');
  if (!budget || isNaN(parseFloat(budget))) { toast('Please enter a valid budget', '', 'warn'); return; }

  try {
    const { error } = await db.from('service_bookings').insert({
      service_id:   gigId,
      buyer_id:     currentUser.id,
      provider_id:  providerId,
      message:      validateInput(message),
      budget:       parseFloat(budget),
      agreed_price: parseFloat(budget),
      status:       'pending',
      created_at:   new Date().toISOString()
    });
    if (error) throw error;
    toast('Booking Sent! 📩', 'The service provider will review your request', 'success', 5000);
    closeModal('sp-profile-modal');
  } catch(e) {
    toast('Booking Failed', e.message, 'error');
  }
}

// ====================================================
//  SERVICE PROVIDER — COMMISSION CHECK (same rules as sellers)
// ====================================================
async function checkServiceProviderCommission() {
  if (!currentUser?.profile) return;
  const p = currentUser.profile;
  const role = p.role;
  if (role !== 'service_provider') return;

  const trialEnd = p.trial_end ? new Date(p.trial_end) : null;
  const commPaid = p.commission_paid;

  // Update SPD commission badge if it exists
  const badge = document.getElementById('spd-comm-badge');
  if (badge) {
    if (commPaid) { badge.className='badge badge-green'; badge.textContent='✓ Active'; }
    else if (trialEnd && trialEnd > new Date()) { badge.className='badge badge-gold'; badge.textContent=`Trial – ${Math.ceil((trialEnd-new Date())/86400000)}d left`; }
    else { badge.className='badge badge-red'; badge.textContent='Suspended'; }
  }

  // Lock out if expired
  if (!commPaid && trialEnd && trialEnd < new Date() && currentUser.email !== ADMIN_EMAIL) {
    document.getElementById('suspended-modal').classList.add('open');
  }
}

// ====================================================
//  SERVICE PROVIDER — BOOKINGS (Provider Side)
// ====================================================
async function loadProviderBookings() {
  if (!currentUser) return;
  const container = document.getElementById('spd-bookings-list');
  if (!container) return;
  container.innerHTML = '<div class="skeleton-block" style="height:80px"></div>'.repeat(3);

  try {
    const { data: bookings } = await db.from('service_bookings')
      .select('*, profiles!service_bookings_buyer_id_fkey(name, email, whatsapp), service_gigs(title)')
      .eq('provider_id', currentUser.id)
      .order('created_at', { ascending: false });

    if (!bookings?.length) {
      container.innerHTML = '<div class="empty-state"><i class="fa-solid fa-inbox" style="font-size:2rem;color:var(--border2);display:block;margin-bottom:.65rem"></i><p class="color-text3 text-sm">No bookings yet. Share your services to get hired!</p></div>';
      return;
    }

    const statusColors = {pending:'badge-gold',accepted:'badge-blue',in_progress:'badge-purple',completed:'badge-green',cancelled:'badge-red'};
    container.innerHTML = bookings.map(b => {
      const buyerName = b.profiles?.name || 'Buyer';
      const buyerWa = (b.profiles?.whatsapp || '').replace(/\D/g,'');
      const gigTitle = b.service_gigs?.title || 'Service';
      return `
      <div class="card card-pad mb-3" style="border-left:4px solid ${b.status==='completed'?'var(--green)':b.status==='cancelled'?'var(--red)':'var(--gold)'}">
        <div class="flex justify-between items-start flex-wrap gap-2 mb-2">
          <div>
            <div class="font-bold text-sm">${escHtml(gigTitle)}</div>
            <div class="text-xs color-text3"><i class="fa-solid fa-user"></i> ${escHtml(buyerName)} · ${fmtDate(b.created_at)}</div>
            ${b.message ? `<div class="text-sm mt-1" style="color:var(--text2)">"${escHtml(b.message.substring(0,150))}"</div>` : ''}
          </div>
          <div class="text-right">
            <div class="font-bold color-green">${fmtN(b.agreed_price || b.budget || 0)}</div>
            <span class="badge ${statusColors[b.status]||'badge-gray'}">${(b.status||'pending').replace(/_/g,' ')}</span>
          </div>
        </div>
        <div class="flex gap-2 flex-wrap mt-2">
          ${b.status==='pending' ? `
            <button onclick="updateBookingStatus('${b.id}','accepted')" class="btn btn-primary btn-sm"><i class="fa-solid fa-check"></i> Accept</button>
            <button onclick="updateBookingStatus('${b.id}','cancelled')" class="btn btn-outline btn-sm">Decline</button>
          ` : ''}
          ${b.status==='accepted' ? `<button onclick="updateBookingStatus('${b.id}','in_progress')" class="btn btn-sm" style="background:#ede9fe;color:#6d28d9"><i class="fa-solid fa-play"></i> Start Work</button>` : ''}
          ${b.status==='in_progress' ? `<button onclick="updateBookingStatus('${b.id}','completed')" class="btn btn-sm" style="background:#dcfce7;color:#15803d"><i class="fa-solid fa-check-double"></i> Mark Completed</button>` : ''}
          ${buyerWa ? `<a href="https://wa.me/${buyerWa}" target="_blank" class="btn btn-outline btn-sm"><i class="fa-brands fa-whatsapp"></i> Chat</a>` : ''}
        </div>
      </div>`;
    }).join('');

    // Update badge count
    const pendingCount = bookings.filter(b => b.status === 'pending').length;
    const bookingsBadge = document.getElementById('spd-bookings-badge');
    if (bookingsBadge) { bookingsBadge.textContent = pendingCount; bookingsBadge.classList.toggle('hidden', !pendingCount); }
  } catch(e) {
    console.error('loadProviderBookings:', e);
    container.innerHTML = '<p class="color-text3 text-sm">Could not load bookings.</p>';
  }
}

async function updateBookingStatus(bookingId, status) {
  try {
    const updates = { status };
    if (status === 'completed') updates.completed_at = new Date().toISOString();
    const { error } = await db.from('service_bookings').update(updates).eq('id', bookingId).eq('provider_id', currentUser.id);
    if (error) throw error;
    toast(`Booking ${status.replace(/_/g,' ')}!`, '', 'success');
    loadProviderBookings();
  } catch(e) {
    toast('Error', e.message, 'error');
  }
}

// ====================================================
//  SERVICE PROVIDER — EARNINGS
// ====================================================
async function loadProviderEarnings() {
  if (!currentUser) return;
  try {
    const { data: bookings } = await db.from('service_bookings')
      .select('agreed_price, budget, status, created_at')
      .eq('provider_id', currentUser.id);
    const completed = (bookings||[]).filter(b => b.status === 'completed');
    const totalEarned = completed.reduce((s,b) => s + (b.agreed_price || b.budget || 0), 0);
    const pendingJobs = (bookings||[]).filter(b => b.status === 'in_progress' || b.status === 'accepted');
    const pendingEarnings = pendingJobs.reduce((s,b) => s + (b.agreed_price || b.budget || 0), 0);

    const el = document.getElementById('spd-earnings-content');
    if (!el) return;
    el.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:1rem;margin-bottom:1.5rem">
        <div class="card card-pad" style="text-align:center">
          <div class="text-xs color-text3 mb-1">Total Earned</div>
          <div style="font-size:1.4rem;font-weight:800;color:var(--green)">${fmtN(totalEarned)}</div>
        </div>
        <div class="card card-pad" style="text-align:center">
          <div class="text-xs color-text3 mb-1">Pending Jobs</div>
          <div style="font-size:1.4rem;font-weight:800;color:var(--purple)">${pendingJobs.length}</div>
        </div>
        <div class="card card-pad" style="text-align:center">
          <div class="text-xs color-text3 mb-1">In Pipeline</div>
          <div style="font-size:1.4rem;font-weight:800;color:var(--gold)">${fmtN(pendingEarnings)}</div>
        </div>
        <div class="card card-pad" style="text-align:center">
          <div class="text-xs color-text3 mb-1">Completed Jobs</div>
          <div style="font-size:1.4rem;font-weight:800;color:var(--green)">${completed.length}</div>
        </div>
      </div>
      <div class="card card-pad">
        <h3 class="mb-3"><i class="fa-solid fa-clock-rotate-left"></i> Recent Completions</h3>
        ${completed.length ? completed.slice(0,10).map(b => `
          <div class="flex justify-between items-center py-2 border-b border-border">
            <div class="text-sm">${fmtDate(b.created_at)}</div>
            <div class="font-bold color-green">${fmtN(b.agreed_price || b.budget || 0)}</div>
          </div>
        `).join('') : '<p class="color-text3 text-sm">No completed jobs yet.</p>'}
      </div>`;
  } catch(e) { console.error('loadProviderEarnings:', e); }
}

// ====================================================
//  BOOK SERVICE (Buyer Side)
// ====================================================
async function bookService(gigId, providerId) {
  if (!currentUser) { showModal('auth-modal'); return; }
  const message = prompt('Describe what you need (optional):') || '';
  const budget = prompt('Your budget (₦):');
  if (!budget || isNaN(parseFloat(budget))) { toast('Please enter a valid budget', '', 'warn'); return; }

  try {
    const { error } = await db.from('service_bookings').insert({
      service_id:   gigId,
      buyer_id:     currentUser.id,
      provider_id:  providerId,
      message:      validateInput(message),
      budget:       parseFloat(budget),
      agreed_price: parseFloat(budget),
      status:       'pending',
      created_at:   new Date().toISOString()
    });
    if (error) throw error;
    toast('Booking Sent! 📩', 'The service provider will review your request', 'success', 5000);
    closeModal('sp-profile-modal');
  } catch(e) {
    toast('Booking Failed', e.message, 'error');
  }
}

// ====================================================
//  HELP MODAL
// ====================================================
function openHelpModal() { showModal('help-modal'); }

// ====================================================
//  MARKETPLACE ADVERTISING (Sellers & Service Providers)
// ====================================================
async function previewAdMedia(input) {
  const file = input.files[0];
  if (!file) return;

  const previewContainer = document.getElementById('ad-media-preview-container');
  const previewEl = document.getElementById('ad-preview-el');
  previewContainer.classList.remove('hidden');

  const fileUrl = URL.createObjectURL(file);
  if (file.type.startsWith('video/')) {
    // Validate duration
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.onloadedmetadata = function() {
      window.URL.revokeObjectURL(video.src);
      if (video.duration > 30) {
        toast('Video too long', 'Maximum length is 30 seconds.', 'error');
        input.value = '';
        previewContainer.classList.add('hidden');
        return;
      }
      previewEl.innerHTML = `<video src="${fileUrl}" controls style="width:100%;max-height:200px;border-radius:var(--radius-sm)"></video>`;
    }
    video.src = fileUrl;
  } else {
    previewEl.innerHTML = `<img src="${fileUrl}" style="width:100%;max-height:200px;object-fit:contain;border-radius:var(--radius-sm)">`;
  }
}

async function initiateAdPayment() {
  if (!user || (user.user_type !== 'seller' && user.user_type !== 'service_provider')) {
    return toast('Access Denied', 'Only sellers and service providers can advertise', 'error');
  }

  const title = document.getElementById('ad-title').value.trim();
  const desc = document.getElementById('ad-desc').value.trim();
  const cta = document.getElementById('ad-cta-select').value;
  const link = document.getElementById('ad-link').value.trim();
  const fileInput = document.getElementById('ad-media-file');
  const file = fileInput.files[0];

  if (!title || !desc || !link || !file) {
    return toast('Incomplete Form', 'Please fill all required fields and upload media', 'error');
  }

  // Pay ₦10,000 via Paystack
  const adFee = 10000;
  const btn = document.getElementById('ad-pay-btn');
  btn.innerHTML = '<span class="spinner"></span> Processing...';
  btn.disabled = true;

  try {
    const { data: profile } = await db.from('profiles').select('email').eq('id', user.id).single();
    
    let handler = PaystackPop.setup({
      key: 'pk_test_b8e5c2cf1d5a7d72856f6ba3a7b6cf7169bed9b7', // Using test key for dev
      email: profile?.email || user.email || 'advertiser@buysell.ng',
      amount: adFee * 100, // kobo
      currency: 'NGN',
      ref: 'AD_' + Math.floor(Math.random() * 1000000000 + 1),
      callback: async function(response) {
        toast('Payment Successful', 'Uploading advertisement...', 'success');
        
        // Use existing submitProduct logic for file upload pattern
        const ext = file.name.split('.').pop();
        const path = `ads/${user.id}/${Date.now()}.${ext}`;
        const { data: uploadData, error: uploadErr } = await supabase.storage.from('products').upload(path, file);
        if (uploadErr) throw uploadErr;
        
        const { data: { publicUrl } } = supabase.storage.from('products').getPublicUrl(path);

        const adData = {
          advertiser_id: user.id,
          advertiser_type: user.user_type,
          title: title,
          description: desc,
          media_url: publicUrl,
          media_type: file.type.startsWith('video/') ? 'video' : 'image',
          cta_text: cta,
          cta_link: link,
          payment_ref: response.reference,
          payment_amount: adFee,
          status: 'active',
          expires_at: new Date(Date.now() + 21 * 24 * 60 * 60 * 1000).toISOString() // 3 weeks
        };

        const { error: adErr } = await db.from('advertisements').insert([adData]);
        if (adErr) throw adErr;

        toast('Success', 'Your advertisement is now live!', 'success');
        document.getElementById('ad-title').value = '';
        document.getElementById('ad-desc').value = '';
        document.getElementById('ad-media-file').value = '';
        document.getElementById('ad-media-preview-container').classList.add('hidden');
        loadActiveAds();
      },
      onClose: function() {
        toast('Cancelled', 'Payment was cancelled', 'warn');
        btn.innerHTML = '<i class="fa-solid fa-credit-card"></i> Pay & Publish Ad';
        btn.disabled = false;
      }
    });
    handler.openIframe();
  } catch(e) {
    console.error('Ad payment err:', e);
    toast('Error', 'Failed to process ad payment', 'error');
    btn.innerHTML = '<i class="fa-solid fa-credit-card"></i> Pay & Publish Ad';
    btn.disabled = false;
  }
}

async function loadActiveAds() {
  if (!user) return;
  const tbody = document.getElementById('ad-table-body');
  try {
    const { data: ads, error } = await db.from('advertisements').select('*').eq('advertiser_id', user.id).order('created_at', { ascending: false });
    if (error) throw error;

    let totalViews = 0, totalClicks = 0;
    
    if (!ads || ads.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:2rem;color:var(--text3)">No active ads yet</td></tr>';
    } else {
      tbody.innerHTML = ads.map(a => {
        totalViews += a.views || 0;
        totalClicks += a.clicks || 0;
        const mediaTag = a.media_type === 'video' 
          ? `<video src="${a.media_url}" style="width:40px;height:40px;object-fit:cover;border-radius:4px"></video>` 
          : `<img src="${a.media_url}" style="width:40px;height:40px;object-fit:cover;border-radius:4px">`;
        const expDate = new Date(a.expires_at).toLocaleDateString();
        return `<tr>
          <td>${mediaTag}</td>
          <td style="font-weight:600">${escHtml(a.title)}</td>
          <td>${a.views || 0}</td>
          <td>${a.clicks || 0}</td>
          <td><span class="badge ${a.status==='active'?'badge-green':a.status==='expired'?'badge-red':'badge-gold'}">${a.status}</span></td>
          <td>${expDate}</td>
        </tr>`;
      }).join('');
    }
    
    document.getElementById('ad-active-count').textContent = ads?.filter(a=>a.status==='active').length || 0;
    document.getElementById('ad-total-views').textContent = totalViews;
    document.getElementById('ad-total-clicks').textContent = totalClicks;

  } catch(e) {
    console.error('Failed to load ads:', e);
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:2rem;color:red">Failed to load ads</td></tr>';
  }
}

// Buyer side rotating popup logic
let activeSystemAds = [];
let adPopupInterval = null;
let currentAdIndex = 0;
let adSkipTimer = 5;
let adSkipInterval = null;

async function fetchSystemAds() {
  try {
    const { data: ads } = await db.from('advertisements')
      .select('*')
      .eq('status', 'active')
      .gt('expires_at', new Date().toISOString())
      .limit(5); // Show max 5 rotating ads
      
    if (ads && ads.length > 0) {
      activeSystemAds = ads;
      // Randomize starting point or shuffle
      activeSystemAds.sort(() => 0.5 - Math.random());
      
      // Delay to not immediately annoy user
      setTimeout(showAdPopup, 10000); // show 10s after load
    }
  } catch(e) { console.error('Fetch ads error', e); }
}

function showAdPopup() {
  if (activeSystemAds.length === 0 || sessionStorage.getItem('ads_seen_session')) return;
  
  const popup = document.getElementById('ad-popup-overlay');
  popup.classList.remove('hidden');
  renderCurrentAd();
}

function renderCurrentAd() {
  if (activeSystemAds.length === 0) return;
  const ad = activeSystemAds[currentAdIndex];
  
  document.getElementById('ad-counter').textContent = `${currentAdIndex + 1}/${activeSystemAds.length}`;
  
  const contentEl = document.getElementById('ad-popup-content');
  if (ad.media_type === 'video') {
    contentEl.innerHTML = `<video id="ad-video-el" src="${ad.media_url}" style="width:100%;height:100%;object-fit:cover" autoplay loop muted playsinline></video>
                           <div class="ad-popup-info" style="pointer-events:none">
                             <h2>${escHtml(ad.title)}</h2>
                             <p>${escHtml(ad.description)}</p>
                           </div>`;
    // ensure it plays
    setTimeout(() => {
      const v = document.getElementById('ad-video-el');
      if(v) v.play().catch(e=>console.log("Autoplay prevented"));
    }, 100);
  } else {
    contentEl.innerHTML = `<img src="${ad.media_url}" style="width:100%;height:100%;object-fit:cover">
                           <div class="ad-popup-info" style="pointer-events:none">
                             <h2>${escHtml(ad.title)}</h2>
                             <p>${escHtml(ad.description)}</p>
                           </div>`;
  }
  
  document.getElementById('ad-cta-btn').href = ad.cta_link || '#';
  document.getElementById('ad-cta-text').textContent = ad.cta_text || 'Learn More';
  
  // Register View
  callEdge('/update-ad-stats', { adId: ad.id, type: 'view' }).catch(e=>console.error(e));
  
  // setup dots
  const dotsContainer = document.getElementById('ad-popup-dots');
  dotsContainer.innerHTML = activeSystemAds.map((_, i) => `<div class="ad-popup-dot ${i === currentAdIndex ? 'active' : ''}"></div>`).join('');
  
  // reset timer
  adSkipTimer = 5;
  const skipBtn = document.getElementById('ad-skip-btn');
  skipBtn.disabled = true;
  document.getElementById('ad-skip-timer').textContent = adSkipTimer;
  
  clearInterval(adSkipInterval);
  adSkipInterval = setInterval(() => {
    adSkipTimer--;
    if (adSkipTimer <= 0) {
      clearInterval(adSkipInterval);
      skipBtn.disabled = false;
      document.getElementById('ad-skip-timer').textContent = '';
      skipBtn.innerHTML = 'Skip <i class="fa-solid fa-step-forward"></i>';
    } else {
      document.getElementById('ad-skip-timer').textContent = adSkipTimer;
    }
  }, 1000);
  
  // Setup progress animation for 10s total
  const progress = document.getElementById('ad-progress');
  progress.style.transition = 'none';
  progress.style.width = '0%';
  setTimeout(() => {
    progress.style.transition = 'width 10s linear';
    progress.style.width = '100%';
  }, 50);
  
  clearTimeout(adPopupInterval);
  adPopupInterval = setTimeout(nextAd, 10000);
  
  // Track clicks
  document.getElementById('ad-cta-btn').onclick = () => {
    callEdge('/update-ad-stats', { adId: ad.id, type: 'click' }).catch(e=>console.error(e));
  };
}

function nextAd() {
  currentAdIndex = (currentAdIndex + 1) % activeSystemAds.length;
  // If we cycled through all of them, maybe just close it
  if (currentAdIndex === 0) {
    closeAdPopup();
    return;
  }
  renderCurrentAd();
}

function skipAd() {
  nextAd();
}

function closeAdPopup() {
  document.getElementById('ad-popup-overlay').classList.add('hidden');
  clearTimeout(adPopupInterval);
  clearInterval(adSkipInterval);
  sessionStorage.setItem('ads_seen_session', 'true');
}

// Call fetch on load for buyers
if (!user || user.user_type === 'buyer') {
  document.addEventListener('DOMContentLoaded', fetchSystemAds);
}


// ====================================================
//  SERVICE PROVIDER IMAGE DELETION
// ====================================================
async function deletePortfolioImage(url, gigId, event) {
  event.stopPropagation();
  if(!confirm("Are you sure you want to delete this image?")) return;
  const btn = event.currentTarget;
  const originalHtml = btn.innerHTML;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
  
  try {
    const { data: gigData, error: fetchErr } = await db.from('service_gigs').select('*').eq('id', gigId).single();
    if (fetchErr) throw fetchErr;
    if (!gigData) return;
    
    let urls = gigData.portfolio_urls || [];
    urls = urls.filter(u => u !== url); // remove the specific url
    
    // Update db
    const { error: updateErr } = await db.from('service_gigs').update({ portfolio_urls: urls }).eq('id', gigId);
    if(updateErr) throw updateErr;
    
    toast('Deleted', 'Image removed from portfolio', 'success');
    
    // Rerender UI
    loadMyGigs();

  } catch(e) {
    console.error('Delete image err:', e);
    toast('Error', 'Failed to delete image', 'error');
    btn.innerHTML = originalHtml;
  }
}


// ====================================================
//  AFFILIATE SYSTEMS
// ====================================================
async function generateAndLoadAffiliateData() {
  if (!user || (user.user_type !== 'seller' && user.user_type !== 'service_provider')) return;
  
  const linkInput = document.getElementById('referral-link');
  linkInput.value = `${window.location.origin}${window.location.pathname}?ref=${user.id}`;
  
  try {
    const { data: earnings, error } = await db.from('affiliate_earnings').select('*').eq('affiliate_id', user.id).order('created_at', { ascending: false });
    if(error) throw error;
    
    const total = earnings?.filter(e=>e.status==='paid').reduce((a,c)=>a+(Number(c.earning_amount)||0), 0) || 0;
    const pending = earnings?.filter(e=>e.status==='pending').reduce((a,c)=>a+(Number(c.earning_amount)||0), 0) || 0;
    
    document.getElementById('aff-total').textContent = `₦${total.toLocaleString()}`;
    document.getElementById('aff-pending').textContent = `₦${pending.toLocaleString()}`;
    // Clicks/conversions would normally come from a referrals/clicks table. Assuming conversion = total referrals made
    const { count: refCount } = await db.from('referrals').select('*', { count: 'exact', head: true }).eq('referrer_id', user.id);
    document.getElementById('aff-conversions').textContent = refCount || 0;
    
    const tbody = document.getElementById('aff-table-body');
    if(!earnings || earnings.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:2rem;color:var(--text3)">No earnings yet</td></tr>';
    } else {
      tbody.innerHTML = earnings.map(e => `
        <tr>
          <td>${new Date(e.created_at).toLocaleDateString()}</td>
          <td>${e.product_name || 'Referral Subscription'}</td>
          <td>${e.source || 'referral_link'}</td>
          <td style="font-weight:600;color:var(--green)">₦${e.earning_amount}</td>
          <td><span class="badge ${e.status==='paid'?'badge-green':e.status==='cancelled'?'badge-red':'badge-gold'}">${e.status}</span></td>
        </tr>
      `).join('');
    }
  } catch(e) {
    console.error('Affiliate load error', e);
  }
}

function copyReferralLink() {
  const linkInput = document.getElementById('referral-link');
  if(!linkInput || !linkInput.value) return;
  navigator.clipboard.writeText(linkInput.value).then(()=>{
    toast('Copied', 'Referral link copied to clipboard', 'success');
  }).catch(()=>{
    linkInput.select();
    document.execCommand('copy');
    toast('Copied', 'Referral link copied to clipboard', 'success');
  });
}

// Intercept showDash to trigger loads
const _origShowDash = showDash;
showDash = function(section) {
  _origShowDash(section);
  if (section === 'advertise') loadActiveAds();
  if (section === 'affiliate') generateAndLoadAffiliateData();
}

// Track referrals in DB on signup
// Need to add referral ref processing in app.js
window.addEventListener('DOMContentLoaded', () => {
  const urlParams = new URLSearchParams(window.location.search);
  const ref = urlParams.get('ref');
  if (ref && !sessionStorage.getItem('referred_by')) {
    sessionStorage.setItem('referred_by', ref);
  }
});


// ════════════════════════════════════════════════════════════
//  FEATURE 1: WISHLIST / SAVE FOR LATER
// ════════════════════════════════════════════════════════════
let wishlist = JSON.parse(localStorage.getItem('bs_wishlist') || '[]');

function toggleWishlist(productId) {
  if (!currentUser) { showModal('auth-modal'); return; }
  const idx = wishlist.indexOf(productId);
  if (idx > -1) {
    wishlist.splice(idx, 1);
    db.from('wishlists').delete().eq('user_id', currentUser.id).eq('product_id', productId).catch(()=>{});
    toast('Removed from Wishlist', '', 'info');
  } else {
    wishlist.push(productId);
    db.from('wishlists').insert({ user_id: currentUser.id, product_id: productId }).catch(()=>{});
    toast('Added to Wishlist ❤️', 'You\'ll see it in your saved items', 'success');
  }
  localStorage.setItem('bs_wishlist', JSON.stringify(wishlist));
  updateWishlistBadge();
  // Re-render product cards to update heart icons
  if (typeof renderProducts === 'function' && filteredProducts) renderProducts(filteredProducts);
}

function isWishlisted(productId) { return wishlist.includes(productId); }

function updateWishlistBadge() {
  const badge = document.getElementById('wishlist-count');
  if (badge) { badge.textContent = wishlist.length; badge.classList.toggle('hidden', !wishlist.length); }
}

async function loadWishlist() {
  if (!currentUser) return;
  const { data } = await db.from('wishlists').select('product_id').eq('user_id', currentUser.id);
  if (data) { wishlist = data.map(w => w.product_id); localStorage.setItem('bs_wishlist', JSON.stringify(wishlist)); }
  updateWishlistBadge();
}

async function showWishlistModal() {
  if (!currentUser) { showModal('auth-modal'); return; }
  showModal('wishlist-modal');
  const container = document.getElementById('wishlist-items');
  if (!container) return;
  if (!wishlist.length) {
    container.innerHTML = '<div class="empty-state"><i class="fa-solid fa-heart" style="font-size:2rem;color:var(--border2);display:block;margin-bottom:.65rem"></i><p class="color-text3 text-sm">Your wishlist is empty. Browse products and tap ❤️ to save!</p></div>';
    return;
  }
  container.innerHTML = '<div class="skeleton" style="height:80px"></div>'.repeat(3);
  const { data: prods } = await db.from('products').select('*').in('id', wishlist);
  if (!prods?.length) { container.innerHTML = '<p class="color-text3 text-sm">No products found.</p>'; return; }
  container.innerHTML = prods.map(p => `
    <div class="card mb-2" style="display:flex;gap:.75rem;padding:.75rem;align-items:center">
      <img src="${(p.images&&p.images[0])||''}" style="width:56px;height:56px;object-fit:cover;border-radius:8px;flex-shrink:0" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 1 1%22><rect fill=%22%23f0f0f0%22 width=%221%22 height=%221%22/></svg>'">
      <div style="flex:1;min-width:0">
        <div class="font-bold text-sm" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(p.name)}</div>
        <div class="font-bold color-green text-sm">${fmtN(p.price)}</div>
      </div>
      <div style="display:flex;gap:.4rem;flex-shrink:0">
        <button class="btn btn-primary btn-sm" onclick="closeModal('wishlist-modal');openProduct('${p.id}')"><i class="fa-solid fa-eye"></i></button>
        <button class="btn btn-sm" style="background:#fee2e2;color:var(--red)" onclick="toggleWishlist('${p.id}');showWishlistModal()"><i class="fa-solid fa-trash"></i></button>
      </div>
    </div>
  `).join('');
}

// ════════════════════════════════════════════════════════════
//  FEATURE 2: PRODUCT COMPARISON
// ════════════════════════════════════════════════════════════
let compareList = [];

function toggleCompare(productId) {
  const idx = compareList.indexOf(productId);
  if (idx > -1) {
    compareList.splice(idx, 1);
    toast('Removed from comparison', '', 'info');
  } else {
    if (compareList.length >= 3) { toast('Max 3 products', 'Remove one first', 'warn'); return; }
    compareList.push(productId);
    toast('Added to Compare', `${compareList.length}/3 selected`, 'success');
  }
  updateCompareBadge();
}

function updateCompareBadge() {
  const badge = document.getElementById('compare-count');
  if (badge) { badge.textContent = compareList.length; badge.classList.toggle('hidden', !compareList.length); }
  const bar = document.getElementById('compare-bar');
  if (bar) bar.classList.toggle('hidden', compareList.length < 2);
}

async function showCompareModal() {
  if (compareList.length < 2) { toast('Select at least 2 products to compare', '', 'warn'); return; }
  showModal('compare-modal');
  const container = document.getElementById('compare-content');
  if (!container) return;
  const { data: prods } = await db.from('products').select('*').in('id', compareList);
  if (!prods?.length) return;

  const cols = prods.length;
  container.innerHTML = `
    <table style="width:100%;border-collapse:collapse;font-size:.82rem">
      <thead><tr style="background:var(--green-xlt)">
        <th style="padding:.6rem;text-align:left;border:1px solid var(--border)">Feature</th>
        ${prods.map(p => `<th style="padding:.6rem;text-align:center;border:1px solid var(--border);max-width:160px">
          <img src="${(p.images&&p.images[0])||''}" style="width:50px;height:50px;object-fit:cover;border-radius:6px;display:block;margin:0 auto .4rem" onerror="this.style.display='none'">
          <div class="font-bold" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(p.name)}</div>
        </th>`).join('')}
      </tr></thead>
      <tbody>
        <tr><td style="padding:.5rem;border:1px solid var(--border);font-weight:600">Price</td>
          ${prods.map(p => `<td style="padding:.5rem;border:1px solid var(--border);text-align:center;font-weight:700;color:var(--green)">${fmtN(p.price)}</td>`).join('')}</tr>
        <tr><td style="padding:.5rem;border:1px solid var(--border);font-weight:600">Category</td>
          ${prods.map(p => `<td style="padding:.5rem;border:1px solid var(--border);text-align:center">${escHtml(p.category||'—')}</td>`).join('')}</tr>
        <tr><td style="padding:.5rem;border:1px solid var(--border);font-weight:600">Condition</td>
          ${prods.map(p => `<td style="padding:.5rem;border:1px solid var(--border);text-align:center">${escHtml(p.condition||'—')}</td>`).join('')}</tr>
        <tr><td style="padding:.5rem;border:1px solid var(--border);font-weight:600">Rating</td>
          ${prods.map(p => `<td style="padding:.5rem;border:1px solid var(--border);text-align:center">⭐ ${(p.avg_rating||0).toFixed(1)}</td>`).join('')}</tr>
        <tr><td style="padding:.5rem;border:1px solid var(--border);font-weight:600">Description</td>
          ${prods.map(p => `<td style="padding:.5rem;border:1px solid var(--border);font-size:.75rem;line-height:1.4">${escHtml((p.description||'').substring(0,120))}...</td>`).join('')}</tr>
        <tr><td style="padding:.5rem;border:1px solid var(--border)"></td>
          ${prods.map(p => `<td style="padding:.5rem;border:1px solid var(--border);text-align:center"><button class="btn btn-primary btn-sm" onclick="closeModal('compare-modal');openProduct('${p.id}')">View</button></td>`).join('')}</tr>
      </tbody>
    </table>`;
}

function clearCompare() { compareList = []; updateCompareBadge(); toast('Comparison cleared', '', 'info'); }

// ════════════════════════════════════════════════════════════
//  FEATURE 3: SELLER TIERS & BADGES
// ════════════════════════════════════════════════════════════
function getSellerTier(salesCount, avgRating) {
  if (salesCount >= 100 && avgRating >= 4.5) return { tier: 'verified', label: '✅ Verified Seller', color: '#16a34a', bg: '#dcfce7' };
  if (salesCount >= 50 && avgRating >= 4.0)  return { tier: 'gold', label: '🥇 Gold Seller', color: '#ca8a04', bg: '#fef9c3' };
  if (salesCount >= 20 && avgRating >= 3.5)  return { tier: 'silver', label: '🥈 Silver Seller', color: '#64748b', bg: '#f1f5f9' };
  return { tier: 'bronze', label: '🥉 New Seller', color: '#a16207', bg: '#fefce8' };
}

function renderSellerBadge(salesCount, avgRating) {
  const t = getSellerTier(salesCount || 0, avgRating || 0);
  return `<span style="display:inline-flex;align-items:center;gap:.25rem;font-size:.65rem;font-weight:700;padding:.2rem .5rem;border-radius:6px;background:${t.bg};color:${t.color}">${t.label}</span>`;
}

// ════════════════════════════════════════════════════════════
//  FEATURE 4: COUPON / DISCOUNT SYSTEM
// ════════════════════════════════════════════════════════════
let appliedCoupon = null;

async function applyCoupon() {
  const codeInput = document.getElementById('coupon-code');
  const code = codeInput?.value.trim().toUpperCase();
  if (!code) { toast('Enter a coupon code', '', 'warn'); return; }

  try {
    const { data: coupons } = await db.from('coupons')
      .select('*')
      .eq('code', code)
      .eq('is_active', true)
      .gte('expires_at', new Date().toISOString())
      .limit(1);

    const coupon = coupons?.[0];
    if (!coupon) { toast('Invalid or expired coupon', '', 'error'); return; }
    if (coupon.used_count >= coupon.max_uses) { toast('Coupon limit reached', '', 'error'); return; }

    const cartTotal = cart.reduce((s, c) => s + c.price * (c.qty || 1), 0);
    if (cartTotal < (coupon.min_order || 0)) {
      toast(`Min order ₦${(coupon.min_order||0).toLocaleString()}`, 'Add more items', 'warn');
      return;
    }

    appliedCoupon = coupon;
    let discount = 0;
    if (coupon.discount_type === 'percent') {
      discount = cartTotal * (coupon.discount_value / 100);
    } else {
      discount = coupon.discount_value;
    }
    discount = Math.min(discount, cartTotal);

    const discountEl = document.getElementById('co-discount');
    const discountRow = document.getElementById('co-discount-row');
    if (discountEl) discountEl.textContent = '-' + fmtN(discount);
    if (discountRow) discountRow.classList.remove('hidden');

    checkoutTotal = cartTotal - discount;
    const totalEl = document.getElementById('co-total');
    if (totalEl) totalEl.textContent = fmtN(checkoutTotal);

    toast(`Coupon Applied! 🎉`, `${coupon.discount_type === 'percent' ? coupon.discount_value + '%' : fmtN(coupon.discount_value)} off`, 'success');
    codeInput.value = '';
    codeInput.disabled = true;
  } catch(e) {
    toast('Coupon Error', e.message, 'error');
  }
}

function removeCoupon() {
  appliedCoupon = null;
  const discountRow = document.getElementById('co-discount-row');
  if (discountRow) discountRow.classList.add('hidden');
  const codeInput = document.getElementById('coupon-code');
  if (codeInput) { codeInput.disabled = false; codeInput.value = ''; }
  // Recalculate total
  const cartTotal = cart.reduce((s, c) => s + c.price * (c.qty || 1), 0);
  checkoutTotal = cartTotal;
  const totalEl = document.getElementById('co-total');
  if (totalEl) totalEl.textContent = fmtN(checkoutTotal);
  toast('Coupon removed', '', 'info');
}

// Seller: Create coupon
async function createCoupon() {
  if (!currentUser) return;
  const code = document.getElementById('coupon-new-code')?.value.trim().toUpperCase();
  const type = document.getElementById('coupon-type')?.value || 'percent';
  const value = parseFloat(document.getElementById('coupon-value')?.value) || 0;
  const minOrder = parseFloat(document.getElementById('coupon-min')?.value) || 0;
  const maxUses = parseInt(document.getElementById('coupon-max')?.value) || 100;
  const daysValid = parseInt(document.getElementById('coupon-days')?.value) || 30;

  if (!code || !value) { toast('Fill code and value', '', 'warn'); return; }

  try {
    const { error } = await db.from('coupons').insert({
      seller_id: currentUser.id,
      code,
      discount_type: type,
      discount_value: value,
      min_order: minOrder,
      max_uses: maxUses,
      expires_at: new Date(Date.now() + daysValid * 86400000).toISOString(),
      is_active: true
    });
    if (error) throw error;
    toast('Coupon Created! 🎫', `Code: ${code}`, 'success');
    loadSellerCoupons();
    ['coupon-new-code','coupon-value','coupon-min','coupon-max','coupon-days'].forEach(id => {
      const el = document.getElementById(id); if (el) el.value = '';
    });
  } catch(e) {
    toast('Failed', e.message, 'error');
  }
}

async function loadSellerCoupons() {
  if (!currentUser) return;
  const container = document.getElementById('seller-coupons-list');
  if (!container) return;
  const { data } = await db.from('coupons').select('*').eq('seller_id', currentUser.id).order('created_at', { ascending: false });
  if (!data?.length) { container.innerHTML = '<p class="color-text3 text-sm">No coupons yet.</p>'; return; }
  container.innerHTML = data.map(c => {
    const expired = c.expires_at && new Date(c.expires_at) < new Date();
    return `<div class="card card-pad mb-2" style="border-left:3px solid ${expired?'var(--red)':'var(--green)'}">
      <div class="flex justify-between items-center">
        <div>
          <span class="font-bold">${escHtml(c.code)}</span>
          <span class="badge ${expired?'badge-red':'badge-green'} ml-2">${expired?'Expired':'Active'}</span>
        </div>
        <span class="font-bold color-green">${c.discount_type==='percent'?c.discount_value+'%':fmtN(c.discount_value)} off</span>
      </div>
      <div class="text-xs color-text3 mt-1">Used ${c.used_count}/${c.max_uses} · Min order ${fmtN(c.min_order)} · Expires ${fmtDate(c.expires_at)}</div>
    </div>`;
  }).join('');
}

// ════════════════════════════════════════════════════════════
//  FEATURE 5: FLASH SALES / DEAL OF THE DAY
// ════════════════════════════════════════════════════════════
let activeFlashSales = [];

async function loadFlashSales() {
  const now = new Date().toISOString();
  const { data } = await db.from('flash_sales')
    .select('*, products(*)')
    .eq('is_active', true)
    .lte('starts_at', now)
    .gte('ends_at', now)
    .order('ends_at', { ascending: true })
    .limit(10);
  activeFlashSales = data || [];
  renderFlashSales();
}

function renderFlashSales() {
  const container = document.getElementById('flash-sales-container');
  if (!container) return;
  if (!activeFlashSales.length) { container.classList.add('hidden'); return; }
  container.classList.remove('hidden');

  const listEl = document.getElementById('flash-sales-list');
  if (!listEl) return;
  listEl.innerHTML = activeFlashSales.map(fs => {
    const p = fs.products;
    if (!p) return '';
    const discount = Math.round((1 - fs.sale_price / fs.original_price) * 100);
    const endsAt = new Date(fs.ends_at);
    return `
    <div class="flash-card" onclick="openProduct('${p.id}')" style="min-width:160px;max-width:180px;cursor:pointer;flex-shrink:0;background:#fff;border-radius:12px;overflow:hidden;border:1px solid var(--border);box-shadow:0 2px 8px rgba(0,0,0,.06)">
      <div style="position:relative">
        <img src="${(p.images&&p.images[0])||''}" style="width:100%;height:120px;object-fit:cover" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 1 1%22><rect fill=%22%23f0f0f0%22 width=%221%22 height=%221%22/></svg>'">
        <span style="position:absolute;top:6px;left:6px;background:#ef4444;color:#fff;font-size:.65rem;font-weight:700;padding:.2rem .45rem;border-radius:4px">-${discount}%</span>
      </div>
      <div style="padding:.55rem">
        <div class="text-sm font-bold" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(p.name)}</div>
        <div style="display:flex;align-items:center;gap:.4rem;margin-top:.25rem">
          <span class="font-bold color-green" style="font-size:.9rem">${fmtN(fs.sale_price)}</span>
          <span style="text-decoration:line-through;color:var(--text3);font-size:.72rem">${fmtN(fs.original_price)}</span>
        </div>
        <div class="flash-timer text-xs" style="color:#ef4444;font-weight:600;margin-top:.3rem" data-ends="${fs.ends_at}"></div>
      </div>
    </div>`;
  }).join('');

  // Start countdown timers
  updateFlashTimers();
}

function updateFlashTimers() {
  document.querySelectorAll('.flash-timer').forEach(el => {
    const ends = new Date(el.dataset.ends);
    const diff = ends - new Date();
    if (diff <= 0) { el.textContent = 'ENDED'; return; }
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const s = Math.floor((diff % 60000) / 1000);
    el.textContent = `⏰ ${h}h ${m}m ${s}s left`;
  });
}
setInterval(updateFlashTimers, 1000);

// Seller: create flash sale
async function createFlashSale() {
  if (!currentUser) return;
  const productId = document.getElementById('flash-product')?.value;
  const salePrice = parseFloat(document.getElementById('flash-price')?.value) || 0;
  const hours = parseInt(document.getElementById('flash-hours')?.value) || 24;
  if (!productId || !salePrice) { toast('Select product and set sale price', '', 'warn'); return; }

  // Get original price
  const { data: prod } = await db.from('products').select('price').eq('id', productId).single();
  if (!prod) { toast('Product not found', '', 'error'); return; }

  try {
    const { error } = await db.from('flash_sales').insert({
      product_id: productId,
      seller_id: currentUser.id,
      original_price: prod.price,
      sale_price: salePrice,
      starts_at: new Date().toISOString(),
      ends_at: new Date(Date.now() + hours * 3600000).toISOString(),
      is_active: true
    });
    if (error) throw error;
    toast('Flash Sale Live! ⚡', `Ends in ${hours} hours`, 'success');
  } catch(e) {
    toast('Failed', e.message, 'error');
  }
}

// ════════════════════════════════════════════════════════════
//  FEATURE 6: IN-APP MESSAGING
// ════════════════════════════════════════════════════════════
let currentChatPartner = null;
let msgInterval = null;

async function openMessageModal(partnerId, partnerName, productId=null) {
  if (!currentUser) { showModal('auth-modal'); return; }
  currentChatPartner = { id: partnerId, name: partnerName, productId };
  showModal('message-modal');
  document.getElementById('msg-partner-name').textContent = partnerName || 'User';
  await loadConversation(partnerId);
  // Poll for new messages
  if (msgInterval) clearInterval(msgInterval);
  msgInterval = setInterval(() => loadConversation(partnerId, true), 5000);
}

async function loadConversation(partnerId, silent=false) {
  const container = document.getElementById('msg-conversation');
  if (!container) return;
  if (!silent) container.innerHTML = '<div class="skeleton" style="height:40px"></div>'.repeat(3);

  const { data: msgs } = await db.from('messages')
    .select('*')
    .or(`and(sender_id.eq.${currentUser.id},receiver_id.eq.${partnerId}),and(sender_id.eq.${partnerId},receiver_id.eq.${currentUser.id})`)
    .order('created_at', { ascending: true })
    .limit(100);

  if (!msgs?.length && !silent) {
    container.innerHTML = '<p class="color-text3 text-sm text-center" style="padding:2rem">No messages yet. Start the conversation!</p>';
    return;
  }
  if (!msgs?.length) return;

  container.innerHTML = msgs.map(m => {
    const isMine = m.sender_id === currentUser.id;
    return `<div style="display:flex;${isMine?'flex-direction:row-reverse':'flex-direction:row'};gap:.3rem;margin-bottom:.4rem">
      <div style="max-width:75%;padding:.45rem .7rem;border-radius:12px;font-size:.8rem;line-height:1.4;${isMine?'background:var(--green);color:#fff;border-bottom-right-radius:4px':'background:#fff;border:1px solid var(--border);border-bottom-left-radius:4px'}">
        ${escHtml(m.content)}
        <div style="font-size:.6rem;opacity:.6;margin-top:.15rem;text-align:${isMine?'right':'left'}">${new Date(m.created_at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</div>
      </div>
    </div>`;
  }).join('');
  container.scrollTop = container.scrollHeight;

  // Mark unread as read
  const unreadIds = msgs.filter(m => m.receiver_id === currentUser.id && !m.is_read).map(m => m.id);
  if (unreadIds.length) db.from('messages').update({ is_read: true }).in('id', unreadIds).catch(()=>{});
}

async function sendMessage() {
  if (!currentUser || !currentChatPartner) return;
  const input = document.getElementById('msg-input');
  const text = input?.value.trim();
  if (!text) return;
  input.value = '';

  await db.from('messages').insert({
    sender_id: currentUser.id,
    receiver_id: currentChatPartner.id,
    product_id: currentChatPartner.productId || null,
    content: validateInput(text)
  });
  loadConversation(currentChatPartner.id);
}

async function loadInboxCount() {
  if (!currentUser) return;
  const { count } = await db.from('messages').select('id', { count: 'exact', head: true }).eq('receiver_id', currentUser.id).eq('is_read', false);
  const badge = document.getElementById('inbox-count');
  if (badge) { badge.textContent = count || 0; badge.classList.toggle('hidden', !count); }
}

async function showInbox() {
  if (!currentUser) { showModal('auth-modal'); return; }
  showModal('inbox-modal');
  const container = document.getElementById('inbox-list');
  if (!container) return;
  container.innerHTML = '<div class="skeleton" style="height:60px"></div>'.repeat(3);

  // Get unique conversations
  const { data: msgs } = await db.from('messages')
    .select('*, profiles!messages_sender_id_fkey(name)')
    .or(`sender_id.eq.${currentUser.id},receiver_id.eq.${currentUser.id}`)
    .order('created_at', { ascending: false })
    .limit(200);

  if (!msgs?.length) {
    container.innerHTML = '<div class="empty-state"><i class="fa-solid fa-envelope" style="font-size:2rem;color:var(--border2);display:block;margin-bottom:.65rem"></i><p class="color-text3 text-sm">No messages yet.</p></div>';
    return;
  }

  // Group by conversation partner
  const convos = {};
  msgs.forEach(m => {
    const partnerId = m.sender_id === currentUser.id ? m.receiver_id : m.sender_id;
    if (!convos[partnerId]) convos[partnerId] = { partnerId, messages: [], unread: 0 };
    convos[partnerId].messages.push(m);
    if (m.receiver_id === currentUser.id && !m.is_read) convos[partnerId].unread++;
  });

  // Get partner names
  const partnerIds = Object.keys(convos);
  const { data: profiles } = await db.from('profiles').select('id, name').in('id', partnerIds);
  const nameMap = {};
  (profiles||[]).forEach(p => nameMap[p.id] = p.name);

  container.innerHTML = Object.values(convos).map(c => {
    const last = c.messages[0];
    const name = nameMap[c.partnerId] || 'User';
    return `<div class="card card-pad mb-2" style="cursor:pointer;${c.unread?'border-left:3px solid var(--green)':''}" onclick="closeModal('inbox-modal');openMessageModal('${c.partnerId}','${escAttr(name)}')">
      <div class="flex justify-between items-center">
        <div class="font-bold text-sm">${escHtml(name)}</div>
        <div class="text-xs color-text3">${fmtDate(last.created_at)}</div>
      </div>
      <div class="text-xs color-text3 mt-1" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(last.content.substring(0,60))}</div>
      ${c.unread ? `<span class="badge badge-green mt-1">${c.unread} new</span>` : ''}
    </div>`;
  }).join('');
}

// ════════════════════════════════════════════════════════════
//  FEATURE 7: SERVICE PROVIDER REVIEWS
// ════════════════════════════════════════════════════════════
let svcReviewRating = 0;

function openServiceReview(bookingId, providerName) {
  showModal('service-review-modal');
  document.getElementById('svc-review-provider').textContent = providerName;
  document.getElementById('svc-review-booking-id').value = bookingId;
  svcReviewRating = 0;
  document.querySelectorAll('#svc-star-row .star-btn').forEach(b => b.classList.remove('active'));
}

function setSvcRating(val) {
  svcReviewRating = val;
  document.querySelectorAll('#svc-star-row .star-btn').forEach(b => {
    b.classList.toggle('active', parseInt(b.dataset.val) <= val);
  });
}

async function submitServiceReview() {
  const bookingId = document.getElementById('svc-review-booking-id')?.value;
  const comment = document.getElementById('svc-review-text')?.value.trim();
  if (!svcReviewRating) { toast('Select a rating', '', 'warn'); return; }
  if (!bookingId) return;

  // Get provider from booking
  const { data: booking } = await db.from('service_bookings').select('provider_id').eq('id', bookingId).single();
  if (!booking) { toast('Booking not found', '', 'error'); return; }

  try {
    const { error } = await db.from('service_reviews').insert({
      booking_id: bookingId,
      reviewer_id: currentUser.id,
      provider_id: booking.provider_id,
      rating: svcReviewRating,
      comment: validateInput(comment)
    });
    if (error) throw error;
    toast('Review Submitted! ⭐', 'Thank you for your feedback', 'success');
    closeModal('service-review-modal');
  } catch(e) {
    toast('Failed', e.message, 'error');
  }
}

// ════════════════════════════════════════════════════════════
//  FEATURE 8: ORDER TRACKING
// ════════════════════════════════════════════════════════════
async function showOrderTracking(orderId) {
  showModal('tracking-modal');
  const container = document.getElementById('tracking-timeline');
  if (!container) return;
  container.innerHTML = '<div class="skeleton" style="height:30px"></div>'.repeat(4);

  const { data: events } = await db.from('order_tracking')
    .select('*')
    .eq('order_id', orderId)
    .order('created_at', { ascending: true });

  const allStatuses = ['pending','confirmed','picked_up','in_transit','out_for_delivery','delivered'];
  const statusLabels = {pending:'Order Placed',confirmed:'Confirmed',picked_up:'Picked Up',in_transit:'In Transit',out_for_delivery:'Out for Delivery',delivered:'Delivered'};
  const statusIcons = {pending:'fa-receipt',confirmed:'fa-check',picked_up:'fa-box',in_transit:'fa-truck',out_for_delivery:'fa-motorcycle',delivered:'fa-house-circle-check'};

  const completedStatuses = (events||[]).map(e => e.status);

  container.innerHTML = allStatuses.map((status, i) => {
    const done = completedStatuses.includes(status);
    const event = (events||[]).find(e => e.status === status);
    const isCurrent = done && !completedStatuses.includes(allStatuses[i+1]);
    return `
    <div style="display:flex;gap:.75rem;padding-bottom:1.2rem;${i<allStatuses.length-1?'border-left:2px solid '+(done?'var(--green)':'var(--border)'):'border:none'};margin-left:11px;padding-left:1.2rem;position:relative">
      <div style="position:absolute;left:-12px;top:0;width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:.65rem;${done?'background:var(--green);color:#fff':'background:var(--cream);border:2px solid var(--border);color:var(--text3)'}${isCurrent?';box-shadow:0 0 0 4px rgba(25,168,71,.2)':''}">
        <i class="fa-solid ${statusIcons[status]||'fa-circle'}"></i>
      </div>
      <div>
        <div class="font-bold text-sm" style="${done?'':'color:var(--text3)'}">${statusLabels[status]||status}</div>
        ${event ? `<div class="text-xs color-text3">${fmtDate(event.created_at)}${event.note?' · '+escHtml(event.note):''}</div>` : ''}
      </div>
    </div>`;
  }).join('');

  document.getElementById('tracking-order-id').textContent = orderId;
}

// Seller: add tracking update
async function addTrackingUpdate(orderId) {
  const status = prompt('Enter status (picked_up, in_transit, out_for_delivery, delivered):');
  if (!status) return;
  const note = prompt('Add a note (optional):') || '';
  try {
    await db.from('order_tracking').insert({ order_id: orderId, status, note: validateInput(note), updated_by: currentUser.id });
    toast('Tracking Updated', `Status: ${status}`, 'success');
  } catch(e) { toast('Failed', e.message, 'error'); }
}

// ════════════════════════════════════════════════════════════
//  FEATURE 9: ADMIN REPORT EXPORT (CSV / PDF)
// ════════════════════════════════════════════════════════════
async 
// ====================================================
//  VOICE INPUT FOR AI
// ====================================================
let mediaRecorder = null;
let audioChunks = [];

async function toggleVoiceInput() {
  const btn = document.getElementById('voice-btn');
  const rec = document.getElementById('voice-recording');
  
  if (rec.classList.contains('hidden')) {
    // Start recording
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorder = new MediaRecorder(stream);
      audioChunks = [];
      
      mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
        transcribeAudio(audioBlob);
      };
      
      mediaRecorder.start();
      rec.classList.remove('hidden');
      btn.style.background = 'var(--red)';
      
      // Auto-stop after 30 seconds
      setTimeout(() => {
        if (mediaRecorder && mediaRecorder.state === 'recording') {
          mediaRecorder.stop();
          rec.classList.add('hidden');
          btn.style.background = 'var(--forest)';
        }
      }, 30000);
    } catch(e) {
      toast('Mic Error', 'Could not access microphone', 'error');
    }
  } else {
    // Stop recording
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      mediaRecorder.stop();
      mediaRecorder.stream.getTracks().forEach(t => t.stop());
    }
    rec.classList.add('hidden');
    btn.style.background = 'var(--forest)';
  }
}

async function transcribeAudio(audioBlob) {
  toast('Processing Voice...', '', 'info', 2000);
  
  try {
    // Use Web Speech API as fallback
    const audioUrl = URL.createObjectURL(audioBlob);
    const audio = new Audio(audioUrl);
    
    // Try Web Speech API
    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      const recognition = new SpeechRecognition();
      recognition.lang = 'en-NG';
      recognition.continuous = false;
      recognition.interimResults = false;
      
      recognition.onresult = event => {
        const transcript = event.results[0][0].text;
        document.getElementById('admin-ai-input').value = transcript;
        askAdminBot();
      };
      
      recognition.onerror = () => {
        toast('Speech Error', 'Try again or type', 'warn');
      };
      
      recognition.start();
    } else {
      // Fallback: convert to text with simple message
      toast('Voice input not supported', 'Please type your question', 'warn');
    }
  } catch(e) {
    toast('Error', e.message, 'error');
  }
}

// ====================================================
//  PREDICTIVE ANALYTICS
// ====================================================
let _predictionData = null;

async function loadPredictiveAnalytics() {
  if (!currentUser) return;
  const container = document.getElementById('predictive-analytics');
  if (!container) return;
  
  container.innerHTML = '<div class="skeleton" style="height:200px"></div>';
  
  try {
    const now = new Date();
    const last30Days = new Date(); last30Days.setDate(last30Days.getDate() - 30);
    const last60Days = new Date(); last60Days.setDate(last60Days.getDate() - 60);
    
    // Fetch historical data
    const [recentOrders, olderOrders, products, disputes] = await Promise.all([
      db.from('orders').select('id,total_amount,status,created_at').gte('created_at', last30Days.toISOString()),
      db.from('orders').select('id,total_amount,status,created_at').lte('created_at', last30Days.toISOString()).gte('created_at', last60Days.toISOString()),
      db.from('products').select('id,name,views,sold_count,category').eq('seller_id', currentUser.id),
      db.from('disputes').select('id,dispute_type,status').eq('status', 'open')
    ]);
    
    const recentData = recentOrders.data || [];
    const olderData = olderOrders.data || [];
    const productsData = products.data || [];
    
    // Calculate metrics
    const recentRevenue = recentData.reduce((s,o) => s + (o.total_amount||0), 0);
    const olderRevenue = olderData.reduce((s,o) => s + (o.total_amount||0), 0);
    const recentOrdersCount = recentData.length;
    const olderOrdersCount = olderData.length;
    
    // Growth rates
    const revenueGrowth = olderRevenue > 0 ? ((recentRevenue - olderRevenue) / olderRevenue * 100).toFixed(1) : 0;
    const ordersGrowth = olderOrdersCount > 0 ? ((recentOrdersCount - olderOrdersCount) / olderOrdersCount * 100).toFixed(1) : 0;
    
    // Average order value
    const avgOrderValue = recentOrdersCount > 0 ? recentRevenue / recentOrdersCount : 0;
    const avgOrderValueChange = olderOrdersCount > 0 ? ((recentRevenue/recentOrdersCount) - (olderRevenue/olderOrdersCount)) / (olderRevenue/olderOrdersCount) * 100 : 0;
    
    // Projections (simple linear)
    const projectedRevenue = recentRevenue * 1.2; // 20% growth assumption
    const projectedOrders = Math.ceil(recentOrdersCount * 1.15);
    
    // Top products analysis
    const topProducts = [...productsData].sort((a,b) => (b.sold_count||0) - (a.sold_count||0)).slice(0,5);
    const slowSellers = productsData.filter(p => (p.views||0) > 100 && (p.sold_count||0) === 0).slice(0,3);
    
    // Risk factors
    const riskFactors = [];
    if (parseFloat(revenueGrowth) < 0) riskFactors.push('📉 Revenue declining');
    if (recentData.filter(o => o.status === 'pending').length > 5) riskFactors.push('⏳ Many pending orders');
    if (slowSellers.length > 0) riskFactors.push('📦 Slow-moving inventory');
    if ((disputes.data||[]).length > 3) riskFactors.push('⚠️ Open disputes');
    
    // Store predictions
    _predictionData = {
      recentRevenue, olderRevenue, revenueGrowth, ordersGrowth, avgOrderValue, avgOrderValueChange,
      projectedRevenue, projectedOrders, topProducts, slowSellers, riskFactors, recentOrdersCount, olderOrdersCount
    };
    
    container.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:1rem;margin-bottom:1.5rem">
        <div class="card card-pad" style="text-align:center">
          <div class="text-xs color-text3 mb-1">📈 Revenue Growth</div>
          <div style="font-size:1.5rem;font-weight:800;color:${parseFloat(revenueGrowth) >= 0 ? 'var(--green)' : 'var(--red)'}">${revenueGrowth}%</div>
          <div class="text-xs color-text3">vs last 30 days</div>
        </div>
        <div class="card card-pad" style="text-align:center">
          <div class="text-xs color-text3 mb-1">🛒 Orders Growth</div>
          <div style="font-size:1.5rem;font-weight:800;color:${parseFloat(ordersGrowth) >= 0 ? 'var(--green)' : 'var(--red)'}">${ordersGrowth}%</div>
          <div class="text-xs color-text3">vs last 30 days</div>
        </div>
        <div class="card card-pad" style="text-align:center">
          <div class="text-xs color-text3 mb-1">💰 Avg Order Value</div>
          <div style="font-size:1.5rem;font-weight:800" id="p-avg-order">${fmtN(avgOrderValue)}</div>
          <div class="text-xs color-text3">${avgOrderValueChange >= 0 ? '↑' : '↓'} ${Math.abs(avgOrderValueChange).toFixed(1)}%</div>
        </div>
        <div class="card card-pad" style="text-align:center">
          <div class="text-xs color-text3 mb-1">🔮 Next 30 Days</div>
          <div style="font-size:1.5rem;font-weight:800;color:var(--purple)">${fmtN(projectedRevenue)}</div>
          <div class="text-xs color-text3">Projected revenue</div>
        </div>
      </div>
      
      ${riskFactors.length > 0 ? `
      <div class="card card-pad mb-3" style="border-left:3px solid var(--red)">
        <h3 class="mb-2"><i class="fa-solid fa-triangle-exclamation color-red"></i> Risk Alerts</h3>
        <div style="display:flex;flex-direction:column;gap:.5rem">
          ${riskFactors.map(r => `<div style="font-size:.85rem">${r}</div>`).join('')}
        </div>
      </div>
      ` : ''}
      
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem">
        <div class="card card-pad">
          <h3 class="mb-2"><i class="fa-solid fa-fire color-gold"></i> Top Performers</h3>
          ${topProducts.length ? topProducts.map((p,i) => `
            <div class="flex justify-between items-center py-2">
              <div class="text-sm">${i+1}. ${escHtml(p.name?.substring(0,20))}</div>
              <div class="font-bold color-green">${p.sold_count||0}</div>
            </div>
          `).join('') : '<p class="color-text3 text-sm">No sales yet</p>'}
        </div>
        <div class="card card-pad">
          <h3 class="mb-2"><i class="fa-solid fa-bell color-gold"></i> Needs Attention</h3>
          ${slowSellers.length ? slowSellers.map(p => `
            <div class="flex justify-between items-center py-2">
              <div class="text-sm">${escHtml(p.name?.substring(0,20))}</div>
              <span class="badge badge-red">${p.views||0} views, 0 sales</span>
            </div>
          `).join('') : '<p class="color-text3 text-sm">All products selling!</p>'}
        </div>
      </div>
      
      <div class="card card-pad mt-3">
        <h3 class="mb-2"><i class="fa-solid fa-crystal-ball color-purple"></i> AI Forecast</h3>
        <div style="font-size:.85rem;color:var(--text2);line-height:1.7">
          <p>Based on your last 60 days performance:</p>
          <ul style="margin-left:1rem">
            <li>Expected orders next 30 days: <strong>${projectedOrders}</strong></li>
            <li>Expected revenue: <strong>${fmtN(projectedRevenue)}</strong></li>
            <li>Recommended focus: <strong>${topProducts[0]?.name?.substring(0,15) || 'N/A'}</strong></li>
          </ul>
          <p class="mt-2 text-xs color-text3">* Projections are estimates based on linear growth trends.</p>
        </div>
      </div>`;
  } catch(e) {
    container.innerHTML = '<p class="color-text3">Error loading predictions</p>';
  }
}

// ====================================================
//  TREND ANALYSIS
// ====================================================
async function loadTrendAnalysis() {
  const container = document.getElementById('trend-analysis');
  if (!container) return;
  
  container.innerHTML = '<div class="skeleton" style="height:150px"></div>';
  
  try {
    const now = new Date();
    const periods = [
      { days: 7, label: 'This Week' },
      { days: 30, label: 'This Month' },
      { days: 90, label: 'Last 90 Days' }
    ];
    
    const data = await Promise.all(periods.map(async p => {
      const since = new Date(); since.setDate(since.getDate() - p.days);
      const { data: orders } = await db.from('orders')
        .select('total_amount,status,created_at')
        .eq('seller_id', currentUser.id)
        .gte('created_at', since.toISOString());
      
      const revenue = (orders||[]).reduce((s,o) => s + (o.total_amount||0), 0);
      const count = (orders||[]).length;
      const avg = count > 0 ? revenue / count : 0;
      
      return { label: p.label, revenue, count, avg, days: p.days };
    }));
    
    container.innerHTML = `
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>Period</th><th>Orders</th><th>Revenue</th><th>Avg Order</th></tr></thead>
          <tbody>
            ${data.map(d => `
              <tr>
                <td>${d.label}</td>
                <td>${d.count}</td>
                <td class="font-bold color-green">${fmtN(d.revenue)}</td>
                <td>${fmtN(d.avg)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>`;
  } catch(e) {
    container.innerHTML = '<p class="color-text3">Error loading trends</p>';
  }
}

// ====================================================
//  CUSTOMER SEGMENTATION
// ====================================================
async function loadCustomerSegmentation() {
  const container = document.getElementById('customer-segments');
  if (!container) return;
  
  container.innerHTML = '<div class="skeleton" style="height:150px"></div>';
  
  try {
    const { data: orders } = await db.from('orders')
      .select('buyer_id,total_amount,created_at,items')
      .eq('seller_id', currentUser.id)
      .order('created_at', { ascending: false })
      .limit(100);
    
    // Group by buyer
    const buyerMap = {};
    (orders||[]).forEach(o => {
      if (!o.buyer_id) return;
      if (!buyerMap[o.buyer_id]) {
        buyerMap[o.buyer_id] = { orders: 0, total: 0, lastOrder: o.created_at };
      }
      buyerMap[o.buyer_id].orders++;
      buyerMap[o.buyer_id].total += o.total_amount || 0;
      if (o.created_at > buyerMap[o.buyer_id].lastOrder) {
        buyerMap[o.buyer_id].lastOrder = o.created_at;
      }
    });
    
    const buyers = Object.entries(buyerMap)
      .map(([id, data]) => ({ id, ...data, avgOrder: data.total / data.orders }))
      .sort((a,b) => b.total - a.total);
    
    // Segment
    const vip = buyers.filter(b => b.total >= 100000);
    const regular = buyers.filter(b => b.total >= 20000 && b.total < 100000);
    const newBuyers = buyers.filter(b => b.total < 20000);
    
    container.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:1rem">
        <div class="card card-pad" style="text-align:center">
          <div style="font-size:1.5rem;font-weight:800;color:var(--purple)">${vip.length}</div>
          <div class="text-xs color-text3">VIP (₦100k+)</div>
        </div>
        <div class="card card-pad" style="text-align:center">
          <div style="font-size:1.5rem;font-weight:800;color:var(--green)">${regular.length}</div>
          <div class="text-xs color-text3">Regular</div>
        </div>
        <div class="card card-pad" style="text-align:center">
          <div style="font-size:1.5rem;font-weight:800;color:var(--blue)">${newBuyers.length}</div>
          <div class="text-xs color-text3">New</div>
        </div>
      </div>
      <div class="mt-3">
        <h4 class="mb-2">Top Customers</h4>
        ${buyers.slice(0,5).map((b,i) => `
          <div class="flex justify-between items-center py-2 border-b border-border">
            <div>${i+1}. ${b.id.substring(0,8)}...</div>
            <div class="font-bold">${fmtN(b.total)} (${b.orders} orders)</div>
          </div>
        `).join('')}
      </div>`;
  } catch(e) {
    container.innerHTML = '<p class="color-text3">Error loading segments</p>';
  }
}

// Load all analytics

// ====================================================
//  AI PRODUCT RECOMMENDATIONS FOR BUYERS
// ====================================================
async function loadAIRecommendations() {
  const container = document.getElementById('ai-recommendations');
  if (!container) return;
  
  container.innerHTML = '<div class="skeleton" style="height:120px"></div>';
  
  try {
    const { data: products } = await db.from('products')
      .select('id,name,category,price,images,avg_rating,sold_count,views')
      .eq('status', 'active')
      .order('avg_rating', { ascending: false })
      .limit(30);
    
    if (!products?.length) {
      container.innerHTML = '<p class="color-text3">No products to analyze</p>';
      return;
    }
    
    // Score products by multiple factors
    const scored = products.map(p => {
      let score = 0;
      // Rating weight (40%)
      score += (p.avg_rating || 0) * 20;
      // Sales weight (30%)
      score += Math.min((p.sold_count || 0) * 3, 30);
      // Views momentum (20%) - normalized
      score += Math.min((p.views || 0) / 50, 20);
      // Price value (10%) - prefer mid-range
      const priceScore = p.price > 1000 && p.price < 100000 ? 10 : 5;
      score += priceScore;
      
      return { ...p, aiScore: score };
    });
    
    // Top picks by category
    const categories = {};
    scored.forEach(p => {
      const cat = p.category || 'other';
      if (!categories[cat] || p.aiScore > categories[cat].aiScore) {
        categories[cat] = p;
      }
    });
    
    // Best value picks
    const valuePicks = [...scored]
      .filter(p => p.price < 50000)
      .sort((a,b) => b.aiScore - a.aiScore)
      .slice(0, 5);
    
    // Trending
    const trending = [...scored]
      .sort((a,b) => (b.views||0) - (a.views||0))
      .slice(0, 5);
    
    container.innerHTML = `
      <div class="card card-pad mb-3">
        <h3 class="mb-2"><i class="fa-solid fa-robot color-purple"></i> AI Top Picks</h3>
        <p class="text-xs color-text3 mb-3">Based on rating, sales, views & value</p>
        <div style="display:flex;flex-direction:column;gap:.75rem">
          ${scored.sort((a,b) => b.aiScore - a.aiScore).slice(0,5).map((p,i) => `
            <div class="flex items-center gap-3" style="padding:.5rem;background:var(--cream);border-radius:8px">
              <div style="font-size:1rem;font-weight:800;color:var(--purple);width:24px">${i+1}</div>
              <img src="${(p.images&&p.images[0])||''}" style="width:48px;height:48px;border-radius:6px;object-fit:cover" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 1 1%22><rect fill=%22%23f0f0f0%22 width=%221%22 height=%221%22/></svg>'">
              <div style="flex:1;min-width:0">
                <div class="font-600 text-sm" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(p.name)}</div>
                <div class="text-xs color-text3">${fmtN(p.price)} · ⭐ ${(p.avg_rating||0).toFixed(1)} · ${p.sold_count||0} sold</div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
      
      <div class="card card-pad mb-3">
        <h3 class="mb-2"><i class="fa-solid fa-fire color-gold"></i> Trending Now</h3>
        <div style="display:flex;gap:.5rem;overflow-x:auto;padding:.5rem 0">
          ${trending.map(p => `
            <div style="min-width:120px;cursor:pointer" onclick="openProduct('${p.id}')">
              <img src="${(p.images&&p.images[0])||''}" style="width:100%;height:80px;border-radius:8px;object-fit:cover" onerror="this.style.display='none'">
              <div class="text-xs mt-1" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(p.name?.substring(0,15))}</div>
              <div class="text-xs font-bold color-green">${fmtN(p.price)}</div>
            </div>
          `).join('')}
        </div>
      </div>
      
      <div class="card card-pad">
        <h3 class="mb-2"><i class="fa-solid fa-tag color-green"></i> Best Value</h3>
        <div style="display:flex;flex-direction:column;gap:.5rem">
          ${valuePicks.map((p,i) => `
            <div class="flex justify-between items-center py-2" style="padding:.5rem;background:var(--green-xlt);border-radius:6px">
              <div>
                <div class="text-sm font-600">${escHtml(p.name?.substring(0,25))}</div>
                <div class="text-xs color-text3">⭐ ${(p.avg_rating||0).toFixed(1)} (${p.sold_count||0} sales)</div>
              </div>
              <div class="font-bold" style="color:var(--green)">${fmtN(p.price)}</div>
            </div>
          `).join('')}
        </div>
      </div>`;
  } catch(e) {
    container.innerHTML = '<p class="color-text3">Error loading recommendations</p>';
  }
}

// ====================================================
//  COMPETITOR ANALYSIS
// ====================================================
async function loadCompetitorAnalysis() {
  const container = document.getElementById('competitor-analysis');
  if (!container) return;
  
  container.innerHTML = '<div class="skeleton" style="height:150px"></div>';
  
  try {
    // Get all sellers
    const { data: sellers } = await db.from('profiles')
      .select('id,name,email,seller_tier,created_at')
      .eq('role', 'seller')
      .eq('commission_paid', true)
      .order('created_at', { ascending: false })
      .limit(20);
    
    if (!sellers?.length) {
      container.innerHTML = '<p class="color-text3">No competitor data available</p>';
      return;
    }
    
    // Get product counts for each seller
    const sellerIds = sellers.map(s => s.id);
    const { data: allProducts } = await db.from('products')
      .select('id,name,category,price,seller_id,sold_count,views')
      .in('seller_id', sellerIds)
      .eq('status', 'active');
    
    // Group by seller
    const sellerStats = {};
    sellers.forEach(s => {
      sellerStats[s.id] = {
        name: s.name,
        tier: s.seller_tier || 'bronze',
        products: 0,
        totalViews: 0,
        totalSales: 0,
        categories: {}
      };
    });
    
    (allProducts||[]).forEach(p => {
      if (sellerStats[p.seller_id]) {
        sellerStats[p.seller_id].products++;
        sellerStats[p.seller_id].totalViews += p.views || 0;
        sellerStats[p.seller_id].totalSales += p.sold_count || 0;
        sellerStats[p.seller_id].categories[p.category] = (sellerStats[p.seller_id].categories[p.category] || 0) + 1;
      }
    });
    
    const ranked = Object.entries(sellerStats)
      .map(([id, s]) => ({ id, ...s }))
      .sort((a,b) => b.totalSales - a.totalSales);
    
    const tierColors = { verified: 'var(--green)', gold: 'var(--gold)', silver: 'var(--text2)', bronze: 'var(--text3)' };
    
    container.innerHTML = `
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>Rank</th><th>Seller</th><th>Tier</th><th>Products</th><th>Views</th><th>Sales</th></tr></thead>
          <tbody>
            ${ranked.slice(0,10).map((s,i) => `
              <tr>
                <td>${i+1}</td>
                <td>${escHtml(s.name?.substring(0,15))}</td>
                <td><span class="badge" style="background:${tierColors[s.tier]}33;color:${tierColors[s.tier]}">${s.tier}</span></td>
                <td>${s.products}</td>
                <td>${s.totalViews.toLocaleString()}</td>
                <td class="font-bold color-green">${s.totalSales}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      
      <div class="card card-pad mt-3">
        <h4 class="mb-2">Your Position</h4>
        <div id="your-rank-info"></div>
      </div>`;
    
    // Show user's rank
    const myRank = ranked.findIndex(s => s.id === currentUser?.id);
    const myRankEl = document.getElementById('your-rank-info');
    if (myRankEl && myRank >= 0) {
      myRankEl.innerHTML = `<div class="flex justify-between items-center py-3" style="padding:1rem;background:var(--purple-xlt);border-radius:8px">
        <div>
          <div class="font-bold" style="font-size:1.2rem">#${myRank + 1}</div>
          <div class="text-xs color-text3">of ${ranked.length} sellers</div>
        </div>
        <div class="text-right">
          <div class="font-bold color-green">${sellerStats[currentUser?.id]?.totalSales || 0} sales</div>
          <div class="text-xs color-text3">${sellerStats[currentUser?.id]?.totalViews || 0} views</div>
        </div>
      </div>`;
    }
  } catch(e) {
    container.innerHTML = '<p class="color-text3">Error loading competitors</p>';
  }
}

// ====================================================
//  SMART NOTIFICATIONS SYSTEM
// ====================================================
let _notificationSettings = {
  orderPlaced: true,
  orderShipped: true,
  newReview: true,
  lowStock: true,
  newMessage: true,
  priceDrop: false
};

async function loadNotificationSettings() {
  const container = document.getElementById('notification-settings');
  if (!container) return;
  
  container.innerHTML = `
    <div class="card card-pad">
      <h3 class="mb-3"><i class="fa-solid fa-bell color-gold"></i> Notification Preferences</h3>
      <div style="display:flex;flex-direction:column;gap:.75rem">
        <label class="flex justify-between items-center" style="padding:.5rem;background:var(--cream);border-radius:6px">
          <div>
            <div class="font-600 text-sm">New Orders</div>
            <div class="text-xs color-text3">Get notified when you receive a new order</div>
          </div>
          <input type="checkbox" checked onchange="_notificationSettings.orderPlaced = this.checked" style="width:20px;height:20px">
        </label>
        <label class="flex justify-between items-center" style="padding:.5rem;background:var(--cream);border-radius:6px">
          <div>
            <div class="font-600 text-sm">Order Shipped</div>
            <div class="text-xs color-text3">Order status updates</div>
          </div>
          <input type="checkbox" checked onchange="_notificationSettings.orderShipped = this.checked" style="width:20px;height:20px">
        </label>
        <label class="flex justify-between items-center" style="padding:.5rem;background:var(--cream);border-radius:6px">
          <div>
            <div class="font-600 text-sm">New Reviews</div>
            <div class="text-xs color-text3">When customers review your products</div>
          </div>
          <input type="checkbox" checked onchange="_notificationSettings.newReview = this.checked" style="width:20px;height:20px">
        </label>
        <label class="flex justify-between items-center" style="padding:.5rem;background:var(--cream);border-radius:6px">
          <div>
            <div class="font-600 text-sm">Low Stock Alerts</div>
            <div class="text-xs color-text3">When inventory is running low</div>
          </div>
          <input type="checkbox" checked onchange="_notificationSettings.lowStock = this.checked" style="width:20px;height:20px">
        </label>
        <label class="flex justify-between items-center" style="padding:.5rem;background:var(--cream);border-radius:6px">
          <div>
            <div class="font-600 text-sm">Messages</div>
            <div class="text-xs color-text3">New inbox messages</div>
          </div>
          <input type="checkbox" checked onchange="_notificationSettings.newMessage = this.checked" style="width:20px;height:20px">
        </label>
      </div>
      <button class="btn btn-primary btn-full mt-3" onclick="saveNotificationSettings()"><i class="fa-solid fa-save"></i> Save Preferences</button>
    </div>`;
}

async function saveNotificationSettings() {
  try {
    localStorage.setItem('bs_notification_settings', JSON.stringify(_notificationSettings));
    toast('Settings Saved!', 'Your preferences have been updated', 'success');
  } catch(e) {
    toast('Error', e.message, 'error');
  }
}

// Request notification permission
async function requestNotificationPermission() {
  if (!('Notification' in window)) {
    toast('Not Supported', 'This browser does not support notifications', 'warn');
    return;
  }
  
  if (Notification.permission === 'granted') {
    toast('Already Enabled', 'Notifications are enabled', 'info');
  } else if (Notification.permission !== 'denied') {
    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
      toast('Enabled!', 'You will receive notifications', 'success');
    }
  }
}

// Test notification
function testNotification() {
  if (Notification.permission === 'granted') {
    new Notification('BUYSELL Nigeria', {
      body: 'Test notification - Notifications are working!',
      icon: 'https://buysell.ng/favicon.ico'
    });
  } else {
    toast('Enable First', 'Please enable notifications in browser settings', 'warn');
  }
}

// ====================================================
//  PRICE INTELLIGENCE / COMPETITOR PRICING
// ====================================================
async function loadPriceIntelligence() {
  const container = document.getElementById('price-intelligence');
  if (!container) return;
  
  container.innerHTML = '<div class="skeleton" style="height:150px"></div>';
  
  try {
    const { data: myProducts } = await db.from('products')
      .select('id,name,category,price')
      .eq('seller_id', currentUser.id)
      .eq('status', 'active');
    
    if (!myProducts?.length) {
      container.innerHTML = '<p class="color-text3">No products to analyze</p>';
      return;
    }
    
    // Find same-category products from other sellers
    const categories = [...new Set(myProducts.map(p => p.category))];
    const { data: competitorProducts } = await db.from('products')
      .select('id,name,category,price,seller_id,profiles(name)')
      .in('category', categories)
      .eq('status', 'active')
      .neq('seller_id', currentUser.id);
    
    // Analyze each category
    const analysis = {};
    categories.forEach(cat => {
      const myProds = myProducts.filter(p => p.category === cat);
      const compProds = competitorProducts.filter(p => p.category === cat);
      
      if (myProds.length && compProds.length) {
        const myPrices = myProds.map(p => p.price).filter(p => p > 0);
        const compPrices = compProds.map(p => p.price).filter(p => p > 0);
        
        analysis[cat] = {
          myAvg: myPrices.length ? myPrices.reduce((s,p) => s + p, 0) / myPrices.length : 0,
          compAvg: compPrices.length ? compPrices.reduce((s,p) => s + p, 0) / compPrices.length : 0,
          myCount: myProds.length,
          compCount: compProds.length
        };
      }
    });
    
    container.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:1rem">
        ${Object.entries(analysis).map(([cat, data]) => {
          const diff = data.myAvg - data.compAvg;
          const pct = data.compAvg > 0 ? ((diff / data.compAvg) * 100).toFixed(1) : 0;
          const status = diff > 0 ? 'var(--red)' : diff < 0 ? 'var(--green)' : 'var(--text2)';
          const label = diff > 0 ? 'Above' : diff < 0 ? 'Below' : 'Same';
          
          return `
          <div class="card card-pad">
            <div class="flex justify-between items-center mb-2">
              <div class="font-bold">${escHtml(cat)}</div>
              <span class="badge" style="background:${status}22;color:${status}">${label} market by ${Math.abs(pct)}%</span>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;font-size:.8rem">
              <div>
                <div class="text-xs color-text3">Your Avg Price</div>
                <div class="font-bold">${fmtN(data.myAvg)}</div>
              </div>
              <div>
                <div class="text-xs color-text3">Competitors Avg</div>
                <div class="font-bold color-green">${fmtN(data.compAvg)}</div>
              </div>
            </div>
            <div class="text-xs color-text3 mt-2">You: ${data.myCount} products · Competitors: ${data.compCount} products</div>
          </div>`;
        }).join('')}
      </div>
      
      <div class="card card-pad mt-3">
        <h4 class="mb-2">💡 Pricing Insights</h4>
        <div style="font-size:.85rem;color:var(--text2);line-height:1.6">
          ${Object.entries(analysis).some(([_,d]) => d.myAvg > d.compAvg) ? 
            '<p>⚠️ Some of your prices are <strong>above</strong> market average. Consider adjusting to stay competitive.</p>' : 
            '<p>✅ Your prices are <strong>competitive</strong> or below market average!</p>'}
        </div>
      </div>`;
  } catch(e) {
    container.innerHTML = '<p class="color-text3">Error loading price data</p>';
  }
}

function loadAllAnalytics() {
  loadPredictiveAnalytics();
  loadTrendAnalysis();
  loadCustomerSegmentation();
}

async function exportAdminReport(type) {
  toast('Generating Report...', '', 'info', 2000);
  let rows = [];
  let filename = '';

  if (type === 'sellers') {
    const { data } = await db.from('profiles').select('name, email, role, commission_paid, trial_end, created_at, seller_tier').in('role', ['seller', 'service_provider']);
    rows = (data||[]).map(s => ({
      Name: s.name, Email: s.email, Role: s.role,
      'Commission Paid': s.commission_paid ? 'Yes' : 'No',
      'Trial End': s.trial_end || 'N/A',
      Tier: s.seller_tier || 'bronze',
      'Joined': s.created_at
    }));
    filename = 'buysell_sellers_report.csv';
  } else if (type === 'orders') {
    const { data } = await db.from('orders').select('id, total_amount, status, payment_method, created_at').order('created_at', { ascending: false }).limit(500);
    rows = (data||[]).map(o => ({
      'Order ID': o.id, Amount: o.total_amount, Status: o.status,
      Payment: o.payment_method, Date: o.created_at
    }));
    filename = 'buysell_orders_report.csv';
  } else if (type === 'revenue') {
    const { data } = await db.from('orders').select('total_amount, status, created_at').eq('status', 'delivered');
    const total = (data||[]).reduce((s,o) => s + (o.total_amount||0), 0);
    const commission = total * 0.03;
    rows = [
      { Metric: 'Total Delivered Orders', Value: (data||[]).length },
      { Metric: 'Total GMV', Value: total },
      { Metric: 'Platform Commission (3%)', Value: commission },
      { Metric: 'Report Date', Value: new Date().toLocaleDateString() }
    ];
    filename = 'buysell_revenue_report.csv';
  } else if (type === 'disputes') {
    const { data } = await db.from('disputes').select('id, order_id, dispute_type, status, description, created_at');
    rows = (data||[]).map(d => ({
      ID: d.id, 'Order ID': d.order_id, Type: d.dispute_type,
      Status: d.status, Description: (d.description||'').substring(0,100), Date: d.created_at
    }));
    filename = 'buysell_disputes_report.csv';
  }

  if (!rows.length) { toast('No data to export', '', 'warn'); return; }

  // Convert to CSV
  const headers = Object.keys(rows[0]);
  const csv = [headers.join(','), ...rows.map(r => headers.map(h => `"${String(r[h]||'').replace(/"/g,'""')}"`).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
  toast('Report Downloaded! 📊', filename, 'success');
}

// ════════════════════════════════════════════════════════════
//  FEATURE 10: PWA INSTALL PROMPT
// ════════════════════════════════════════════════════════════

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  const installBar = document.getElementById('pwa-install-bar');
  if (installBar) installBar.classList.remove('hidden');
});

function installPWA() {
  if (!deferredInstallPrompt) { toast('Already installed or not supported', '', 'info'); return; }
  deferredInstallPrompt.prompt();
  deferredInstallPrompt.userChoice.then(choice => {
    if (choice.outcome === 'accepted') {
      toast('App Installed! 📱', 'BUYSELL is now on your home screen', 'success');
    }
    deferredInstallPrompt = null;
    const installBar = document.getElementById('pwa-install-bar');
    if (installBar) installBar.classList.add('hidden');
  });
}

function dismissInstallBar() {
  const installBar = document.getElementById('pwa-install-bar');
  if (installBar) installBar.classList.add('hidden');
  sessionStorage.setItem('pwa_dismissed', '1');
}

// ════════════════════════════════════════════════════════════
//  FEATURE 11: SELLER ANALYTICS DASHBOARD
// ════════════════════════════════════════════════════════════
async function loadSellerAnalytics() {
  const container = document.getElementById('seller-analytics-content');
  if (!container || !currentUser) return;
  container.innerHTML = '<div class="skeleton" style="height:100px"></div>';

  try {
    const { data: products } = await db.from('products').select('id, name, views, status').eq('seller_id', currentUser.id);
    const { data: orders } = await db.from('orders').select('total_amount, status, created_at, items').eq('status', 'delivered');
    const { data: reviews } = await db.from('reviews').select('rating').eq('seller_id', currentUser.id);

    const totalViews = (products||[]).reduce((s,p) => s + (p.views||0), 0);
    const totalOrders = (orders||[]).length;
    const totalRevenue = (orders||[]).reduce((s,o) => s + (o.total_amount||0), 0);
    const avgRating = reviews?.length ? (reviews.reduce((s,r) => s + r.rating, 0) / reviews.length).toFixed(1) : '0.0';
    const conversionRate = totalViews > 0 ? ((totalOrders / totalViews) * 100).toFixed(1) : '0.0';

    // Top products
    const topProducts = (products||[])
      .sort((a,b) => (b.views||0) - (a.views||0))
      .slice(0, 5);

    container.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:1rem;margin-bottom:1.5rem">
        <div class="card card-pad" style="text-align:center">
          <div class="text-xs color-text3 mb-1">Total Views</div>
          <div style="font-size:1.4rem;font-weight:800;color:var(--blue)">${totalViews.toLocaleString()}</div>
        </div>
        <div class="card card-pad" style="text-align:center">
          <div class="text-xs color-text3 mb-1">Conversion Rate</div>
          <div style="font-size:1.4rem;font-weight:800;color:var(--purple)">${conversionRate}%</div>
        </div>
        <div class="card card-pad" style="text-align:center">
          <div class="text-xs color-text3 mb-1">Avg Rating</div>
          <div style="font-size:1.4rem;font-weight:800;color:var(--gold)">⭐ ${avgRating}</div>
        </div>
        <div class="card card-pad" style="text-align:center">
          <div class="text-xs color-text3 mb-1">Revenue</div>
          <div style="font-size:1.3rem;font-weight:800;color:var(--green)">${fmtN(totalRevenue)}</div>
        </div>
      </div>
      ${renderSellerBadge(totalOrders, parseFloat(avgRating))}
      <div class="card card-pad mt-3">
        <h3 class="mb-3"><i class="fa-solid fa-fire color-gold"></i> Top Products by Views</h3>
        ${topProducts.length ? topProducts.map((p, i) => `
          <div class="flex justify-between items-center py-2 ${i<topProducts.length-1?'border-b border-border':''}">
            <div class="text-sm font-600">${i+1}. ${escHtml(p.name)}</div>
            <div class="text-xs color-text3"><i class="fa-solid fa-eye"></i> ${(p.views||0).toLocaleString()}</div>
          </div>
        `).join('') : '<p class="color-text3 text-sm">No product data yet.</p>'}
      </div>`;
  } catch(e) { console.error('Analytics error:', e); }
}

// ════════════════════════════════════════════════════════════
//  FEATURE 12: MULTI-LANGUAGE SUPPORT (Pidgin, Hausa, Yoruba, Igbo)
// ════════════════════════════════════════════════════════════
const TRANSLATIONS = {
  en: { shop:'Shop', cart:'Cart', orders:'My Orders', services:'Hire Services', search:'Search products...',
        welcome:'Welcome to', tagline:'Nigeria\'s Marketplace', addToCart:'Add to Cart', buyNow:'Buy Now',
        checkout:'Checkout', wishlist:'Wishlist', compare:'Compare', messages:'Messages', hello:'Hello' },
  pcm: { shop:'Buy Things', cart:'My Basket', orders:'My Orders dem', services:'Hire Worker', search:'Find wetin you want...',
        welcome:'Welcome to', tagline:'Naija Marketplace', addToCart:'Put for basket', buyNow:'Buy am now',
        checkout:'Pay money', wishlist:'Things I like', compare:'Compare am', messages:'Message', hello:'How far' },
  ha: { shop:'Saya', cart:'Kayan Siye', orders:'Oda na', services:'Dauka Ma\'aikaci', search:'Nemo kaya...',
        welcome:'Barka da zuwa', tagline:'Kasuwar Nigeria', addToCart:'Saka cikin jaka', buyNow:'Saya yanzu',
        checkout:'Checkout', wishlist:'Abubuwan da nake so', compare:'Kwatanta', messages:'Sakonni', hello:'Sannu' },
  yo: { shop:'Ra', cart:'Apó Rírà', orders:'Àṣẹ mi', services:'Gbé Oníṣẹ', search:'Wá ohun tí o fẹ...',
        welcome:'Ẹ káàbọ̀ sí', tagline:'Ọjà Nigeria', addToCart:'Fi sí apó', buyNow:'Ra báyìí',
        checkout:'Sanwó', wishlist:'Ohun tí mo fẹ́ràn', compare:'Fi wéra', messages:'Ifiranṣẹ́', hello:'Pẹ̀lẹ́' },
  ig: { shop:'Zụta', cart:'Ngwá Ọzụzụ', orders:'Usoro m', services:'Goo Onye ọrụ', search:'Chọọ ngwa...',
        welcome:'Nnọọ na', tagline:'Ahịa Nigeria', addToCart:'Tinye n\'ime ngwá', buyNow:'Zụta ugbu a',
        checkout:'Kwụọ ụgwọ', wishlist:'Ihe ndị m chọrọ', compare:'Tụnyere', messages:'Ozi', hello:'Nnọọ' }
};

let currentLang = localStorage.getItem('bs_lang') || 'en';

function setLanguage(lang) {
  currentLang = lang;
  localStorage.setItem('bs_lang', lang);
  applyTranslations();
  toast('Language Changed', lang.toUpperCase(), 'success');
}

function t(key) { return TRANSLATIONS[currentLang]?.[key] || TRANSLATIONS.en[key] || key; }

function applyTranslations() {
  document.querySelectorAll('[data-t]').forEach(el => {
    const key = el.dataset.t;
    if (TRANSLATIONS[currentLang]?.[key]) el.textContent = TRANSLATIONS[currentLang][key];
  });
}

// ════════════════════════════════════════════════════════════
//  INIT: Load new features on page ready
// ════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  loadFlashSales();
  updateWishlistBadge();
  updateCompareBadge();
  applyTranslations();

  // After auth check
  const origOnAuth = typeof onAuthSuccess === 'function' ? onAuthSuccess : null;
  if (origOnAuth) {
    const _wrapped = onAuthSuccess;
    // loadWishlist and inbox on login handled elsewhere
  }
});

// Hook into showDash for seller analytics + coupons
const _origShowDash2 = showDash;
showDash = function(section) {
  _origShowDash2(section);
  if (section === 'analytics') loadSellerAnalytics();
  if (section === 'coupons') loadSellerCoupons();
  if (section === 'flash') loadFlashSaleProducts();
};

async function loadFlashSaleProducts() {
  if (!currentUser) return;
  const select = document.getElementById('flash-product');
  if (!select) return;
  const { data } = await db.from('products').select('id, name').eq('seller_id', currentUser.id);
  if (!data?.length) { select.innerHTML = '<option value="">No products available</option>'; return; }
  select.innerHTML = data.map(p => `<option value="${p.id}">${escHtml(p.name)}</option>`).join('');
}

// Toggle password visibility
function togglePasswordVisibility(inputId, btn) {
  const input = document.getElementById(inputId);
  if (!input || !btn) return;
  const isPassword = input.type === 'password';
  input.type = isPassword ? 'text' : 'password';
  btn.innerHTML = '<i class="fa-solid fa-eye' + (isPassword ? '-slash' : '') + '"></i>';
  btn.style.color = isPassword ? 'var(--green)' : 'var(--text3)';
}

const origOnAuthSucc = onAuthSuccess;
onAuthSuccess = async function(u) {
  if (origOnAuthSucc) await origOnAuthSucc(u);
  loadWishlist();
  loadInboxCount();
};
