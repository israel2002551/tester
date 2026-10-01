
let observer;
let scheduled = false;

function scheduleApply() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    applyFrontendUxRedesign();
  });
}

function openNotifications() {
  const shell = document.getElementById('bs-notification-center-shell');
  if (!shell) return;
  updateNotificationPermissionState();
  shell.classList.add('open');
  shell.querySelector('.bs-notification-center__close')?.focus();
  document.body.style.overflow = 'hidden';
}

function closeNotifications() {
  const shell = document.getElementById('bs-notification-center-shell');
  shell?.classList.remove('open');
  document.body.style.overflow = '';
}

function goToOrders() {
  closeNotifications();
  if (typeof window.switchBuyerTab === 'function') {
    window.showBuyerView?.();
    window.switchBuyerTab('orders');
    return;
  }
  window.location.href = '/?view=shop&page=orders';
}

function goToMessages() {
  closeNotifications();
  if (typeof window.showInbox === 'function') {
    window.showInbox();
    return;
  }
  window.location.href = '/?view=shop&page=messages';
}

async function managePushAlerts() {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'granted') {
    closeNotifications();
    window.showAccountPage?.();
    return;
  }
  await window.requestNotificationPermission?.();
  updateNotificationPermissionState();
}

function updateNotificationPermissionState() {
  const status = document.querySelector('[data-bs-notification-status]');
  const action = document.querySelector('[data-bs-notification-action]');
  if (!status || !action) return;

  if (!('Notification' in window)) {
    status.textContent = 'Not supported';
    action.textContent = 'Unavailable';
    action.disabled = true;
    return;
  }

  action.disabled = false;
  if (Notification.permission === 'granted') {
    status.textContent = 'Push alerts on';
    action.textContent = 'Settings';
  } else if (Notification.permission === 'denied') {
    status.textContent = 'Blocked in browser';
    action.textContent = 'Settings';
  } else {
    status.textContent = 'Push alerts off';
    action.textContent = 'Enable';
  }
}

function ensureNotificationCenter() {
  if (document.getElementById('bs-notification-center-shell')) return;

  const shell = document.createElement('div');
  shell.id = 'bs-notification-center-shell';
  shell.className = 'bs-notification-backdrop';
  shell.innerHTML = [
    '<aside class="bs-notification-center" role="dialog" aria-modal="true" aria-labelledby="bs-notification-title">',
    '  <div class="bs-notification-center__head">',
    '    <h2 id="bs-notification-title">Notifications</h2>',
    '    <button class="bs-notification-center__close" type="button" aria-label="Close notifications"><i class="fa-solid fa-xmark"></i></button>',
    '  </div>',
    '  <div class="bs-notification-center__body">',
    '    <button class="bs-notification-item" type="button" data-bs-notification-orders>',
    '      <span class="bs-notification-item__icon"><i class="fa-solid fa-box"></i></span>',
    '      <span><strong>Orders</strong><span>Purchases and delivery updates</span></span>',
    '      <i class="fa-solid fa-chevron-right"></i>',
    '    </button>',
    '    <button class="bs-notification-item" type="button" data-bs-notification-messages>',
    '      <span class="bs-notification-item__icon"><i class="fa-solid fa-message"></i></span>',
    '      <span><strong>Messages</strong><span>Replies from sellers and buyers</span></span>',
    '      <i class="fa-solid fa-chevron-right"></i>',
    '    </button>',
    '    <div class="bs-notification-setting">',
    '      <div><strong>Push alerts</strong><span data-bs-notification-status>Checking…</span></div>',
    '      <button type="button" data-bs-notification-action>Enable</button>',
    '    </div>',
    '  </div>',
    '</aside>'
  ].join('');

  shell.addEventListener('click', event => {
    if (event.target === shell) closeNotifications();
  });
  shell.querySelector('.bs-notification-center__close')?.addEventListener('click', closeNotifications);
  shell.querySelector('[data-bs-notification-orders]')?.addEventListener('click', goToOrders);
  shell.querySelector('[data-bs-notification-messages]')?.addEventListener('click', goToMessages);
  shell.querySelector('[data-bs-notification-action]')?.addEventListener('click', managePushAlerts);
  document.body.appendChild(shell);
  updateNotificationPermissionState();
}

function wireNotificationButtons() {
  document.querySelectorAll('#nav-notify-btn, [onclick*="handleNotificationBellClick"]').forEach(button => {
    if (button.dataset.bsNotificationWired === '1') return;
    button.dataset.bsNotificationWired = '1';
    button.removeAttribute('onclick');
    button.onclick = null;
    button.title = 'Notifications';
    button.setAttribute('aria-label', 'Open notifications');
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      openNotifications();
    });
  });
}

function ensureAuthStory() {
  const modal = document.getElementById('auth-modal');
  const box = modal?.querySelector('.modal-box');
  if (!box || box.dataset.bsRedesignWrapped === '1') return;

  box.dataset.bsRedesignWrapped = '1';
  const existingChildren = Array.from(box.childNodes);
  const story = document.createElement('aside');
  story.className = 'bs-auth-story';
  story.innerHTML = [
    '<div class="bs-auth-story__mark"><img src="/brand/svg/buysell_icon_transparent.svg" alt=""></div>',
    '<div>',
    '  <div class="bs-auth-story__steps" aria-hidden="true"><span></span><span></span><span></span></div>',
    '  <h2>One account. Your marketplace.</h2>',
    '  <p>Buy what you need, run your store, or sell in bulk without learning a different platform.</p>',
    '</div>'
  ].join('');

  const panel = document.createElement('div');
  panel.className = 'bs-auth-panel';
  existingChildren.forEach(node => panel.appendChild(node));
  box.appendChild(story);
  box.appendChild(panel);

  const sellerLabel = panel.querySelector('#role-card-seller .role-card-label');
  const sellerSub = panel.querySelector('#role-card-seller .role-card-sub');
  if (sellerLabel) sellerLabel.textContent = 'Seller / Wholesaler';
  if (sellerSub) sellerSub.textContent = 'Sell retail or bulk';

  const bothLabel = panel.querySelector('#role-card-both .role-card-label');
  const bothSub = panel.querySelector('#role-card-both .role-card-sub');
  if (bothLabel) bothLabel.textContent = 'Buy + Sell';
  if (bothSub) bothSub.textContent = 'Use both sides';
}

function ensureCheckoutHeader() {
  const modal = document.getElementById('checkout-modal');
  const box = modal?.querySelector('.modal-box');
  if (!box || box.querySelector('.bs-checkout-page-head')) return;

  const header = document.createElement('div');
  header.className = 'bs-checkout-page-head';
  header.innerHTML = [
    '<img src="/brand/svg/buysell_icon_transparent.svg" alt="">',
    '<div><strong>Secure checkout</strong><small>Your existing BUYSELL payment flow</small></div>'
  ].join('');
  box.prepend(header);
}

function ensureAccountControls() {
  const account = document.getElementById('account-view');
  const card = account?.querySelector('.account-page-card');
  if (!card) return;

  const danger = card.querySelector('.danger-zone');
  if (danger && !danger.closest('.account-danger-details')) {
    const details = document.createElement('details');
    details.className = 'account-danger-details';
    const summary = document.createElement('summary');
    summary.textContent = 'Account deletion';
    danger.parentNode.insertBefore(details, danger);
    details.appendChild(summary);
    details.appendChild(danger);
  }

  if (!card.querySelector('.bs-account-signout')) {
    const row = document.createElement('div');
    row.className = 'bs-account-signout';
    row.innerHTML = [
      '<div><strong>Sign out</strong><p>End this session on this device.</p></div>',
      '<button type="button"><i class="fa-solid fa-arrow-right-from-bracket"></i> Sign out</button>'
    ].join('');
    row.querySelector('button')?.addEventListener('click', async () => {
      if (typeof window.logoutUser === 'function') {
        await window.logoutUser();
        return;
      }
      await window.BUYSELL_AUTH?.logoutUser?.('/?entry=buyer&mode=login');
    });
    card.appendChild(row);
  }
}

function labelExistingSurfaces() {
  document.getElementById('checkout-modal')?.setAttribute('aria-label', 'Checkout');
  document.getElementById('cart-modal')?.setAttribute('aria-label', 'Shopping cart');

  const landingAuthText = document.getElementById('landing-auth-text');
  if (landingAuthText?.textContent?.trim() === 'Sign In') landingAuthText.textContent = 'Sign in';

  document.querySelectorAll('.portal-card .portal-feat').forEach((node, index) => {
    if (index > 5) node.classList.add('bs-secondary-copy');
  });
}

export function applyFrontendUxRedesign() {
  document.body.classList.add('bs-redesign');
  ensureNotificationCenter();
  wireNotificationButtons();
  ensureAuthStory();
  ensureCheckoutHeader();
  ensureAccountControls();
  labelExistingSurfaces();
}

export function installFrontendUxRedesign() {
  applyFrontendUxRedesign();
  if (!observer) {
    observer = new MutationObserver(scheduleApply);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style']
    });
  }
  window.addEventListener('popstate', scheduleApply);
  window.addEventListener('bs:navigate', scheduleApply);
}
