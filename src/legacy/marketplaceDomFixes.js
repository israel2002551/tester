const ADMIN_PORTAL_ID_PREFIX = 'admin-portal-';

function escapeAttributeValue(value) {
  if (window.CSS?.escape) return window.CSS.escape(String(value));
  return String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
}

function replaceReferenceTokens(value, idMap) {
  return String(value || '')
    .split(/(\s+)/)
    .map(token => idMap.get(token) || token)
    .join('');
}

function namespaceStandaloneAdminPortal(root) {
  const sellerAdmin = root.querySelector('#ds-admin');
  const portal = root.querySelector('#admin-portal-view');
  if (!sellerAdmin || !portal) return;

  const idMap = new Map();
  portal.querySelectorAll('[id]').forEach(node => {
    const legacyId = node.id;
    if (!legacyId || !sellerAdmin.querySelector(`[id="${escapeAttributeValue(legacyId)}"]`)) return;

    const namespacedId = `${ADMIN_PORTAL_ID_PREFIX}${legacyId}`;
    idMap.set(legacyId, namespacedId);
    node.dataset.adminLegacyId = legacyId;
    node.id = namespacedId;
  });

  if (!idMap.size) return;
  portal.querySelectorAll('[for]').forEach(node => {
    const nextId = idMap.get(node.htmlFor);
    if (nextId) node.htmlFor = nextId;
  });
  portal.querySelectorAll('[aria-controls], [aria-labelledby], [aria-describedby]').forEach(node => {
    ['ariaControls', 'ariaLabelledby', 'ariaDescribedby'].forEach(property => {
      if (node[property]) node[property] = replaceReferenceTokens(node[property], idMap);
    });
  });
}

function ensureUpcomingProductsContainer(root) {
  const buyerShop = root.querySelector('#buyer-shop-tab');
  if (!buyerShop || buyerShop.querySelector('#buyer-upcoming-section')) return;

  const section = document.createElement('section');
  section.id = 'buyer-upcoming-section';
  section.className = 'recently-viewed-section hidden';
  section.setAttribute('aria-label', 'Upcoming product drops');
  section.innerHTML = `
    <div class="mini-section-head">
      <h3><i class="fa-solid fa-bolt color-gold"></i> Upcoming Drops</h3>
      <a class="btn btn-ghost btn-sm" href="/upcoming">View all <i class="fa-solid fa-arrow-right"></i></a>
    </div>
    <div id="buyer-upcoming-grid" class="recently-viewed-grid"></div>`;

  const firstProductRegion = buyerShop.querySelector('#prods-skeleton, #prods-grid, #prods-empty');
  buyerShop.insertBefore(section, firstProductRegion || null);
}

function normaliseLegacyCopy(root) {
  root.querySelectorAll('#ds-flash, #admin-portal-view').forEach(scope => {
    const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);
    textNodes.forEach(node => {
      node.nodeValue = node.nodeValue.replace(/Flash\s+Flash\s+Sale(s?)/g, 'Flash Sale$1');
    });
  });
}

function preventPlaceholderNavigation(root) {
  root.querySelectorAll('.brand-logo[href="#"], .nav-brand-sm[href="#"], .dash-nav-item[href="#"]').forEach(link => {
    if (link.dataset.preventHashJump === 'true') return;
    link.dataset.preventHashJump = 'true';
    link.addEventListener('click', event => event.preventDefault());
  });
}

/**
 * Repairs the generated legacy marketplace markup before app.js binds to it.
 * The standalone portal receives namespaced IDs; data-admin-legacy-id keeps
 * the active-surface lookup in app.js stable for both portal layouts.
 */
export function prepareMarketplaceDom(root = document) {
  namespaceStandaloneAdminPortal(root);
  ensureUpcomingProductsContainer(root);
  normaliseLegacyCopy(root);
  preventPlaceholderNavigation(root);
}
