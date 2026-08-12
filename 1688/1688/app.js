    let products = [
      {
        title: "Oversized cotton tee for private-label streetwear drops",
        category: "Fashion",
        price: "Â¥18",
        moq: "MOQ 20 pcs",
        supplier: "Shenzhen Yuanru Apparel",
        tags: ["Ready stock", "Custom logo"],
        image: "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?auto=format&fit=crop&w=700&q=80"
      },
      {
        title: "Compact USB-C power bank with retail packaging",
        category: "Electronics",
        price: "Â¥42",
        moq: "MOQ 50 pcs",
        supplier: "Dongguan Volt Factory",
        tags: ["CE option", "Fast sample"],
        image: "https://images.unsplash.com/photo-1609091839311-d5365f9ff1c5?auto=format&fit=crop&w=700&q=80"
      },
      {
        title: "Minimal ceramic dinnerware set for home retailers",
        category: "Home",
        price: "Â¥26",
        moq: "MOQ 12 sets",
        supplier: "Chaozhou Homeware Co.",
        tags: ["Gift box", "New colors"],
        image: "https://images.unsplash.com/photo-1516594798947-e65505dbb29d?auto=format&fit=crop&w=700&q=80"
      },
      {
        title: "Matte stand-up pouch with resealable zipper",
        category: "Packaging",
        price: "Â¥0.42",
        moq: "MOQ 1,000 pcs",
        supplier: "Yiwu Pack Source",
        tags: ["Food grade", "Custom print"],
        image: "https://images.unsplash.com/photo-1607344645866-009c320f6ab0?auto=format&fit=crop&w=700&q=80"
      },
      {
        title: "Portable LED desk lamp with dimmer controls",
        category: "Electronics",
        price: "Â¥31",
        moq: "MOQ 30 pcs",
        supplier: "Ningbo Bright Tech",
        tags: ["USB powered", "Low MOQ"],
        image: "https://images.unsplash.com/photo-1507473885765-e6ed057f782c?auto=format&fit=crop&w=700&q=80"
      },
      {
        title: "Reusable stainless steel tumbler for brand merch",
        category: "Home",
        price: "Â¥15",
        moq: "MOQ 100 pcs",
        supplier: "Zhejiang Daily Goods",
        tags: ["Laser logo", "BPA free"],
        image: "https://images.unsplash.com/photo-1602143407151-7111542de6e8?auto=format&fit=crop&w=700&q=80"
      },
      {
        title: "Women lightweight woven tote with inner pocket",
        category: "Fashion",
        price: "Â¥22",
        moq: "MOQ 30 pcs",
        supplier: "Guangzhou Carry Studio",
        tags: ["Hot seller", "OEM"],
        image: "https://images.unsplash.com/photo-1590874103328-eac38a683ce7?auto=format&fit=crop&w=700&q=80"
      },
      {
        title: "Corrugated shipping mailer for ecommerce orders",
        category: "Packaging",
        price: "Â¥1.10",
        moq: "MOQ 500 pcs",
        supplier: "Foshan Carton Works",
        tags: ["Recyclable", "Bulk price"],
        image: "https://images.unsplash.com/photo-1607166452427-7e4477079cb9?auto=format&fit=crop&w=700&q=80"
      }
    ];

    const accessProducts = [
      {
        title: "Sheepskin French-style wedge slip-on shoes",
        category: "Fashion",
        price: "CNY 79.00-99.00",
        moq: "MOQ 1 pair",
        supplier: "Huizhou Shunbuda Shoes Co.",
        tags: ["Real 1688 page", "Ships in 7 days", "Quality Assurance"],
        image: "https://images.unsplash.com/photo-1543163521-1bf539c55dd2?auto=format&fit=crop&w=700&q=80",
        url: "https://detail.1688.com/offer/1051231740308.html",
        note: "Extracted from the supplied 1688 detail page. Sizes 35-40, color Black spot."
      },
      {
        title: "Fashion and apparel on 1688",
        category: "Fashion",
        price: "Open 1688",
        moq: "Search clothing",
        supplier: "1688 category search",
        tags: ["Women's wear", "Men's wear"],
        image: "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?auto=format&fit=crop&w=700&q=80",
        url: "https://s.1688.com/selloffer/offer_search.htm?keywords=clothing"
      },
      {
        title: "Electronics and accessories on 1688",
        category: "Electronics",
        price: "Open 1688",
        moq: "Search gadgets",
        supplier: "1688 category search",
        tags: ["Power banks", "Phone parts"],
        image: "https://images.unsplash.com/photo-1609091839311-d5365f9ff1c5?auto=format&fit=crop&w=700&q=80",
        url: "https://s.1688.com/selloffer/offer_search.htm?keywords=electronics"
      },
      {
        title: "Home, kitchen, and daily goods on 1688",
        category: "Home",
        price: "Open 1688",
        moq: "Search home goods",
        supplier: "1688 category search",
        tags: ["Kitchen", "Homeware"],
        image: "https://images.unsplash.com/photo-1516594798947-e65505dbb29d?auto=format&fit=crop&w=700&q=80",
        url: "https://s.1688.com/selloffer/offer_search.htm?keywords=home%20goods"
      },
      {
        title: "Packaging materials on 1688",
        category: "Packaging",
        price: "Open 1688",
        moq: "Search packaging",
        supplier: "1688 category search",
        tags: ["Bags", "Boxes"],
        image: "https://images.unsplash.com/photo-1607344645866-009c320f6ab0?auto=format&fit=crop&w=700&q=80",
        url: "https://s.1688.com/selloffer/offer_search.htm?keywords=packaging"
      },
      {
        title: "Beauty and personal care on 1688",
        category: "Beauty",
        price: "Open 1688",
        moq: "Search beauty",
        supplier: "1688 category search",
        tags: ["Cosmetics", "Tools"],
        image: "https://images.unsplash.com/photo-1522335789203-aabd1fc54bc9?auto=format&fit=crop&w=700&q=80",
        url: "https://s.1688.com/selloffer/offer_search.htm?keywords=beauty"
      },
      {
        title: "Industrial supplies and tools on 1688",
        category: "Industrial",
        price: "Open 1688",
        moq: "Search tools",
        supplier: "1688 category search",
        tags: ["Hardware", "Machines"],
        image: "https://images.unsplash.com/photo-1504917595217-d4dc5ebe6122?auto=format&fit=crop&w=700&q=80",
        url: "https://s.1688.com/selloffer/offer_search.htm?keywords=industrial%20tools"
      },
      {
        title: "Sports and outdoor products on 1688",
        category: "Outdoor",
        price: "Open 1688",
        moq: "Search outdoor",
        supplier: "1688 category search",
        tags: ["Fitness", "Outdoor"],
        image: "https://images.unsplash.com/photo-1518611012118-696072aa579a?auto=format&fit=crop&w=700&q=80",
        url: "https://s.1688.com/selloffer/offer_search.htm?keywords=sports%20outdoor"
      },
      {
        title: "Find factories on 1688",
        category: "Factory",
        price: "Factory access",
        moq: "Browse makers",
        supplier: "1688 Find Factory",
        tags: ["Factory sourcing", "Manufacturers"],
        image: "https://images.unsplash.com/photo-1504917595217-d4dc5ebe6122?auto=format&fit=crop&w=700&q=80",
        url: "https://mind.1688.com/1688pc/pc-home/r3Dc8JjQaK4BfAz5xyw7/index.html?wh_pha=true&wh_pid=3650667",
        note: "Added from the supplied 1688 Find Factory page."
      },
      {
        title: "Super factories and leading origins",
        category: "Factory",
        price: "Open 1688",
        moq: "Factory ranking",
        supplier: "1688 factory channel",
        tags: ["Super factory", "Origin leaders"],
        image: "https://images.unsplash.com/photo-1581092335397-9583eb92d232?auto=format&fit=crop&w=700&q=80",
        url: "https://mind.1688.com/default/default/TjSf5m47xeXBj33j6NG7/index.html?wh_pha=true&wh_pid=3708552"
      },
      {
        title: "Factory ranking and hot categories",
        category: "Factory",
        price: "Open 1688",
        moq: "Latest ranking",
        supplier: "1688 factory rank",
        tags: ["Rankings", "Hot categories"],
        image: "https://images.unsplash.com/photo-1565688534245-05d6b5be184a?auto=format&fit=crop&w=700&q=80",
        url: "https://sale.1688.com/factory/bd_hot_category.html?__existtitle__=1&__removesafearea__=1"
      },
      {
        title: "Custom design factory sourcing",
        category: "Factory",
        price: "Open 1688",
        moq: "From 1 item",
        supplier: "1688 custom factory",
        tags: ["Custom design", "Add logo/text"],
        image: "https://images.unsplash.com/photo-1517048676732-d65bc937f952?auto=format&fit=crop&w=700&q=80",
        url: "https://mind.1688.com/find-factory/daily/dcndrtff4/index.html?wh_pha=true&wh_pid=3231437&__pageId__=3231437"
      },
      {
        title: "Industrial products homepage",
        category: "Industrial",
        price: "Industrial access",
        moq: "Browse industry",
        supplier: "1688 industrial channel",
        tags: ["Industrial goods", "B2B"],
        image: "https://images.unsplash.com/photo-1581092160607-ee22621dd758?auto=format&fit=crop&w=700&q=80",
        url: "https://mind.1688.com/1688pc/pc-home/wkjhxWbz6dfhkixKdyrW/index.html?wh_pha=true&wh_pid=3590995",
        note: "Added from the supplied 1688 Industrial Products page."
      },
      {
        title: "AI industrial product finder",
        category: "Industrial",
        price: "Open 1688",
        moq: "Image/parameter search",
        supplier: "1688 industry AI",
        tags: ["AI finder", "Industrial search"],
        image: "https://images.unsplash.com/photo-1581090700227-1e37b190418e?auto=format&fit=crop&w=700&q=80",
        url: "https://industrybot.1688.com/#/pc?from=home-center-card"
      },
      {
        title: "Enterprise procurement on 1688",
        category: "Industrial",
        price: "Official procurement",
        moq: "Business buying",
        supplier: "1688 enterprise procurement",
        tags: ["Enterprise", "Official"],
        image: "https://images.unsplash.com/photo-1556740758-90de374c12ad?auto=format&fit=crop&w=700&q=80",
        url: "https://b.1688.com/"
      },
      {
        title: "Main 1688 homepage",
        category: "all",
        price: "Open 1688",
        moq: "All products",
        supplier: "1688.com",
        tags: ["Homepage", "All categories"],
        image: "https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?auto=format&fit=crop&w=700&q=80",
        url: "https://www.1688.com/"
      }
    ];

    products = accessProducts;

    const productGrid = document.querySelector("#productGrid");
    const toast = document.querySelector("#toast");
    const cartCount = document.querySelector("#cartCount");
    const cartDrawer = document.querySelector("#cartDrawer");
    const cartList = document.querySelector("#cartList");
    const requestList = document.querySelector("#requestList");
    const extractPreview = document.querySelector("#extractPreview");
    const customProductsKey = "custom1688Products";
    const cartKey = "cart1688Products";
    const orderRequestsKey = "orderRequests1688";
    const supabaseSettingsKey = "supabase1688Settings";
    const configuredSupabase = window.APP_CONFIG?.supabase || {};
    const defaultSupabaseSettings = {
      supabaseUrl: configuredSupabase.url || "",
      anonKey: configuredSupabase.anonKey || "",
      adminPin: ""
    };
    const orderStatuses = ["Submitted", "Checking price", "Awaiting payment", "Ordered", "At China warehouse", "Shipped", "Delivered"];
    const seedProducts = products.map((product, index) => ({
      ...product,
      id: `seed-${index}`,
      url: product.url || "https://www.1688.com/"
    }));
    let customProducts = loadFromStorage(customProductsKey, []);
    let cart = loadFromStorage(cartKey, []);
    products = [...seedProducts, ...customProducts];

    function loadFromStorage(key, fallback) {
      try {
        return JSON.parse(localStorage.getItem(key)) || fallback;
      } catch (error) {
        return fallback;
      }
    }

    function saveToStorage(key, value) {
      localStorage.setItem(key, JSON.stringify(value));
    }

    function escapeHtml(value) {
      return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
    }

    function fallbackImageFor(title = "1688 product") {
      const label = String(title).slice(0, 42);
      const svg = `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 700 700">
          <rect width="700" height="700" fill="#fff3eb"/>
          <rect x="46" y="46" width="608" height="608" rx="24" fill="#ffffff" stroke="#ffd8bf" stroke-width="4"/>
          <circle cx="350" cy="250" r="82" fill="#ff5b00" opacity="0.92"/>
          <path d="M198 491c56-87 111-130 166-130 46 0 83 26 112 79 25-21 48-31 70-31 36 0 67 27 93 82H198z" fill="#202124" opacity="0.86"/>
          <text x="350" y="594" text-anchor="middle" font-family="Arial, sans-serif" font-size="32" font-weight="700" fill="#171717">${escapeHtml(label)}</text>
        </svg>
      `;
      return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
    }

    function imageAttrs(src, title) {
      return `src="${escapeHtml(src || fallbackImageFor(title))}" alt="${escapeHtml(title)}" referrerpolicy="no-referrer" onerror="this.onerror=null;this.src='${fallbackImageFor(title)}'"`;
    }

    function productById(id) {
      return products.find((product) => product.id === id);
    }

    function getSupabaseSettings() {
      const savedSettings = loadFromStorage(supabaseSettingsKey, {});
      return {
        supabaseUrl: savedSettings.supabaseUrl || defaultSupabaseSettings.supabaseUrl,
        anonKey: savedSettings.anonKey || defaultSupabaseSettings.anonKey,
        adminPin: savedSettings.adminPin || defaultSupabaseSettings.adminPin
      };
    }

    function normalizeOrder(order) {
      return {
        id: order.id,
        name: order.name,
        contact: order.contact,
        destination: order.destination,
        request: order.request,
        status: order.status || "Submitted",
        telegramResult: order.telegram_result || order.telegramResult || "pending",
        createdAt: order.created_at || order.createdAt || new Date().toISOString()
      };
    }

    async function callOrderWorkflow(action, payload = {}) {
      const settings = getSupabaseSettings();
      if (!settings.supabaseUrl || !settings.anonKey) {
        throw new Error("Supabase is not configured");
      }

      const response = await fetch(`${settings.supabaseUrl.replace(/\/$/, "")}/functions/v1/order-workflow`, {
        method: "POST",
        headers: {
          apikey: settings.anonKey,
          Authorization: `Bearer ${settings.anonKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ action, ...payload })
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || "Supabase request failed");
      }
      return data;
    }

    async function callProductExtractor(payload = {}) {
      const settings = getSupabaseSettings();
      if (!settings.supabaseUrl || !settings.anonKey) {
        throw new Error("Supabase is not configured");
      }

      const response = await fetch(`${settings.supabaseUrl.replace(/\/$/, "")}/functions/v1/extract-1688-product`, {
        method: "POST",
        headers: {
          apikey: settings.anonKey,
          Authorization: `Bearer ${settings.anonKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || "Product extraction failed");
      }
      return data.product;
    }

    function normalize1688Url(value) {
      const offerId = value.match(/offer[\/=](\d+)/i)?.[1] || value.match(/offerId["'=:%20]+(\d+)/i)?.[1] || value.match(/"offerId":(\d+)/)?.[1];
      return offerId ? `https://detail.1688.com/offer/${offerId}.html` : value.trim();
    }

    function readMatch(text, pattern) {
      const match = text.match(pattern);
      return match ? match[1].replace(/\\u002F/g, "/").replace(/\\"/g, '"').trim() : "";
    }

    function extractProductDetails(raw) {
      const text = raw.trim();
      const title = readMatch(text, /"subject":"([^"]+)"/) || readMatch(text, /<title>(.*?)\s*-\s*[^<]*<\/title>/is) || readMatch(text, /<title>(.*?)<\/title>/is);
      const image = readMatch(text, /"fullPathImageURI":"([^"]+)"/) || readMatch(text, /"imageUrl":"(https?:\/\/[^"]+)"/) || readMatch(text, /(https?:\/\/cbu01\.alicdn\.com\/[^"'<\s]+?\.(?:jpg|png|webp))/i);
      const price = readMatch(text, /"priceDisplay":"([^"]+)"/) || readMatch(text, /"originalPriceDisplay":"([^"]+)"/);
      const supplier = readMatch(text, /"companyName":"([^"]+)"/) || readMatch(text, /"loginId":"([^"]+)"/);
      const color = readMatch(text, /"prop":"Color","value":\[\{"(?:imageUrl":"[^"]+",)?"name":"([^"]+)"/);
      const sizesBlock = readMatch(text, /"prop":"Size","value":\[(.*?)\]/);
      const sizes = [...sizesBlock.matchAll(/"name":"([^"]+)"/g)].map((match) => match[1]).join(", ");
      const url = normalize1688Url(text);

      return {
        title,
        image,
        price: price ? `CNY ${price}` : "",
        supplier,
        variant: [color && `Color: ${color}`, sizes && `Sizes: ${sizes}`].filter(Boolean).join(" | "),
        moq: readMatch(text, /"beginAmount":(\d+)/) ? `MOQ ${readMatch(text, /"beginAmount":(\d+)/)}` : "",
        url
      };
    }

    function fillProductForm(details) {
      const form = document.querySelector("#addProductForm");
      if (details.title) form.elements.title.value = details.title;
      if (details.url) form.elements.url.value = details.url;
      if (details.image) form.elements.image.value = details.image;
      if (details.price) form.elements.price.value = details.price;
      if (details.moq) form.elements.moq.value = details.moq;
      if (details.supplier) form.elements.supplier.value = details.supplier;
      if (details.variant) form.elements.variant.value = details.variant;
      if (details.note) form.elements.note.value = details.note;
    }

    function renderExtractPreview(details) {
      const title = details.title || "Untitled 1688 product";
      const image = details.image || "https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?auto=format&fit=crop&w=700&q=80";
      const meta = [
        details.price && `Price: ${details.price}`,
        details.moq && `MOQ: ${details.moq}`,
        details.supplier && `Supplier: ${details.supplier}`,
        details.variant && `Variant: ${details.variant}`,
        details.url && `URL: ${details.url}`
      ].filter(Boolean);

      extractPreview.innerHTML = `
        <img ${imageAttrs(image, title)}>
        <div>
          <h3>${escapeHtml(title)}</h3>
          <div class="preview-meta">${meta.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</div>
          <div class="tool-actions">
            <button class="primary-btn" id="confirmExtractButton" type="button" style="border-radius:8px;min-height:42px">Add Preview to Cart</button>
            <button class="outline-btn" id="editExtractButton" type="button">Edit Details Below</button>
          </div>
          <p class="tool-note">Review the extracted product before adding it to cart. You can edit the fields below first.</p>
        </div>
      `;
      extractPreview.classList.add("show");
    }

    function build1688SearchUrl(query, mode = "1688 Search") {
      const term = query.trim() || "wholesale";
      if (mode === "Factories") {
        return "https://mind.1688.com/1688pc/pc-home/r3Dc8JjQaK4BfAz5xyw7/index.html?wh_pha=true&wh_pid=3650667";
      }
      if (mode === "Industrial") {
        return query.trim()
          ? `https://s.1688.com/selloffer/offer_search.htm?keywords=${encodeURIComponent(`${term} industrial`)}`
          : "https://mind.1688.com/1688pc/pc-home/wkjhxWbz6dfhkixKdyrW/index.html?wh_pha=true&wh_pid=3590995";
      }
      return `https://s.1688.com/selloffer/offer_search.htm?keywords=${encodeURIComponent(term)}`;
    }

    function showToast(message) {
      toast.textContent = message;
      toast.classList.add("show");
      window.clearTimeout(showToast.timer);
      showToast.timer = window.setTimeout(() => toast.classList.remove("show"), 2200);
    }

    function renderProducts(category = "all", query = "") {
      const normalizedQuery = query.trim().toLowerCase();
      const filtered = products.filter((product) => {
        const matchesCategory = category === "all" || product.category === category;
        const haystack = `${product.title} ${product.category} ${product.supplier} ${product.tags.join(" ")}`.toLowerCase();
        return matchesCategory && (!normalizedQuery || haystack.includes(normalizedQuery));
      });

      productGrid.innerHTML = filtered.map((product) => `
        <article class="product-card">
          <div class="product-image"><img ${imageAttrs(product.image, product.title)}></div>
          <div class="product-body">
            <div class="tag-row">${product.tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}</div>
            <div class="product-title">${escapeHtml(product.title)}</div>
            <div class="price-row"><span class="price">${escapeHtml(product.price)}</span><span class="moq">${escapeHtml(product.moq)}</span></div>
            <div class="supplier">${escapeHtml(product.supplier)}</div>
            ${product.note ? `<div class="supplier">${escapeHtml(product.note)}</div>` : ""}
            <div class="card-actions">
              <button class="outline-btn" type="button" data-action="quote" data-id="${escapeHtml(product.id)}">Ask Quote</button>
              <a class="link-btn" href="${escapeHtml(product.url)}" target="_blank" rel="noopener">Open Link</a>
              <button class="save-btn" type="button" data-action="save" data-id="${escapeHtml(product.id)}" aria-label="Add ${escapeHtml(product.title)} to cart">+</button>
            </div>
          </div>
        </article>
      `).join("");

      if (!filtered.length) {
        productGrid.innerHTML = `<div class="panel" style="grid-column: 1 / -1; padding: 24px;">No products found. Try another category or search term.</div>`;
      }
    }

    function setActiveCategory(category) {
      document.querySelectorAll("[data-category]").forEach((button) => {
        button.classList.toggle("active", button.dataset.category === category);
      });
      renderProducts(category, document.querySelector("#searchInput").value);
    }

    function updateCartCount() {
      cartCount.textContent = cart.reduce((total, item) => total + item.quantity, 0);
    }

    function renderCart() {
      if (!cart.length) {
        cartList.innerHTML = `<div class="buyer-card"><strong>Your cart is empty</strong><p>Add a 1688 product card or paste a new product link.</p></div>`;
        updateCartCount();
        return;
      }

      cartList.innerHTML = cart.map((item) => {
        const product = productById(item.id);
        if (!product) return "";
        return `
          <article class="cart-item">
            <img ${imageAttrs(product.image, product.title)}>
            <div>
              <strong>${escapeHtml(product.title)}</strong>
              <small>${escapeHtml(product.price)} - ${escapeHtml(product.moq)} - Qty ${item.quantity}</small>
              ${product.variant ? `<small>Variant: ${escapeHtml(product.variant)}</small>` : ""}
              ${product.note ? `<small>Note: ${escapeHtml(product.note)}</small>` : ""}
              <div class="cart-item-actions">
                <a href="${escapeHtml(product.url)}" target="_blank" rel="noopener">Open link</a>
                <button type="button" data-action="remove-cart" data-id="${escapeHtml(item.id)}">Remove</button>
              </div>
            </div>
          </article>
        `;
      }).join("");
      updateCartCount();
    }

    function addToCart(productId, quantity = 1) {
      const amount = Math.max(1, Number(quantity) || 1);
      const existing = cart.find((item) => item.id === productId);
      if (existing) {
        existing.quantity += amount;
      } else {
        cart.push({ id: productId, quantity: amount });
      }
      saveToStorage(cartKey, cart);
      renderCart();
      showToast("Product added to cart");
    }

    function renderRequests() {
      if (!requestList) return;
      const requests = loadFromStorage(orderRequestsKey, []).map(normalizeOrder);
      if (!requests.length) {
        requestList.innerHTML = `<div class="buyer-card"><strong>No order requests yet</strong><p>Submitted requests will appear here with Supabase sync, Telegram status, and workflow controls.</p></div>`;
        return;
      }

      requestList.innerHTML = requests.map((request) => `
        <article class="request-card">
          <header>
            <div>
              <h3>${escapeHtml(request.name)} - ${escapeHtml(request.destination)}</h3>
              <span class="status-pill">${escapeHtml(request.status || "Submitted")}</span>
            </div>
            <small>${escapeHtml(new Date(request.createdAt).toLocaleString())}</small>
          </header>
          <p>${escapeHtml(request.request)}</p>
          <p>Contact: ${escapeHtml(request.contact)}${request.telegramResult ? ` | Telegram: ${escapeHtml(request.telegramResult)}` : ""}</p>
          <div class="request-actions">
            <select data-action="status" data-id="${escapeHtml(request.id)}">
              ${orderStatuses.map((status) => `<option value="${escapeHtml(status)}" ${status === request.status ? "selected" : ""}>${escapeHtml(status)}</option>`).join("")}
            </select>
            <button type="button" data-action="resend-telegram" data-id="${escapeHtml(request.id)}">Send to Telegram</button>
            <button type="button" data-action="delete-request" data-id="${escapeHtml(request.id)}">Delete</button>
          </div>
        </article>
      `).join("");
    }

    function saveRequestUpdate(requestId, updater) {
      const requests = loadFromStorage(orderRequestsKey, []).map(normalizeOrder);
      const next = requests.map((request) => request.id === requestId ? updater(request) : request);
      saveToStorage(orderRequestsKey, next);
      renderRequests();
      return next.find((request) => request.id === requestId);
    }

    async function loadSupabaseOrders() {
      const settings = getSupabaseSettings();
      const data = await callOrderWorkflow("list_orders", { adminPin: settings.adminPin });
      const orders = (data.orders || []).map(normalizeOrder);
      saveToStorage(orderRequestsKey, orders);
      renderRequests();
      return orders;
    }

    document.querySelector("#tabs").addEventListener("click", (event) => {
      const button = event.target.closest("button[data-category]");
      if (button) setActiveCategory(button.dataset.category);
    });

    document.querySelector("#categoryList").addEventListener("click", (event) => {
      const button = event.target.closest("button[data-category]");
      if (button) setActiveCategory(button.dataset.category);
    });

    document.querySelector("#extractButton").addEventListener("click", async () => {
      const raw = document.querySelector("#pageCodeInput").value;
      if (!raw.trim()) {
        showToast("Paste a 1688 URL or page code first");
        return;
      }
      const looksLikeHtml = /<html|window\.context|<title|fullPathImageURI|priceDisplay/i.test(raw);

      try {
        const details = looksLikeHtml
          ? await callProductExtractor({ html: raw })
          : await callProductExtractor({ url: raw });
        fillProductForm(details || {});
        renderExtractPreview(details || {});
        showToast(details?.title || details?.url ? "Product details extracted by Supabase" : "Only partial details found");
      } catch (error) {
        const details = extractProductDetails(raw);
        fillProductForm(details);
        renderExtractPreview(details);
        showToast(details.title || details.url ? "Extracted locally as fallback" : "Extraction failed");
      }
    });

    extractPreview.addEventListener("click", (event) => {
      const confirmButton = event.target.closest("#confirmExtractButton");
      const editButton = event.target.closest("#editExtractButton");

      if (confirmButton) {
        document.querySelector("#addProductForm").requestSubmit();
      }

      if (editButton) {
        document.querySelector("#addProductForm").scrollIntoView({ behavior: "smooth" });
      }
    });

    document.querySelector("#searchForm").addEventListener("submit", (event) => {
      event.preventDefault();
      const active = document.querySelector(".tab.active")?.dataset.category || "all";
      const query = document.querySelector("#searchInput").value;
      const mode = document.querySelector("#searchMode").value;
      window.open(build1688SearchUrl(query, mode), "_blank", "noopener");
      renderProducts(active, query);
      document.querySelector("#products").scrollIntoView({ behavior: "smooth" });
    });

    productGrid.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-action]");
      if (!button) return;
      if (button.dataset.action === "save") {
        addToCart(button.dataset.id);
      }
      if (button.dataset.action === "quote") {
        const product = productById(button.dataset.id);
        document.querySelector("textarea[name='request']").value = `Please send price, MOQ, lead time, and sample options for: ${product.title} ${product.url}`;
        document.querySelector("#quote").scrollIntoView({ behavior: "smooth" });
        showToast("Quote request prepared");
      }
    });

    document.querySelector("#addProductForm").addEventListener("submit", (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const formData = new FormData(form);
      const quantity = Math.max(1, Number(formData.get("quantity")) || 1);
      const product = {
        id: `custom-${Date.now()}`,
        title: formData.get("title").trim(),
        category: formData.get("category"),
        price: formData.get("price").trim() || "Price on request",
        moq: formData.get("moq").trim() || "MOQ on request",
        supplier: formData.get("supplier").trim() || "1688 supplier",
        variant: formData.get("variant").trim(),
        note: formData.get("note").trim(),
        tags: ["Submitted URL", "Buyer item"],
        image: formData.get("image").trim() || "https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?auto=format&fit=crop&w=700&q=80",
        url: formData.get("url").trim()
      };

      customProducts.unshift(product);
      products = [...seedProducts, ...customProducts];
      saveToStorage(customProductsKey, customProducts);
      form.reset();
      extractPreview.classList.remove("show");
      extractPreview.innerHTML = "";
      setActiveCategory("all");
      addToCart(product.id, quantity);
      document.querySelector("#products").scrollIntoView({ behavior: "smooth" });
    });

    document.querySelector("#cartButton").addEventListener("click", () => {
      cartDrawer.classList.toggle("open");
      renderCart();
    });

    document.querySelector("#cartClose").addEventListener("click", () => {
      cartDrawer.classList.remove("open");
    });

    cartList.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-action='remove-cart']");
      if (!button) return;
      cart = cart.filter((item) => item.id !== button.dataset.id);
      saveToStorage(cartKey, cart);
      renderCart();
      showToast("Product removed from cart");
    });

    document.querySelector("#checkoutButton").addEventListener("click", () => {
      if (!cart.length) {
        showToast("Add at least one product first");
        return;
      }
      const lines = cart.map((item) => {
        const product = productById(item.id);
        if (!product) return "";
        const variant = product.variant ? ` | Variant: ${product.variant}` : "";
        const note = product.note ? ` | Note: ${product.note}` : "";
        return `Qty ${item.quantity}: ${product.title}${variant}${note} - ${product.url}`;
      }).filter(Boolean);
      document.querySelector("textarea[name='request']").value = `I want help ordering and delivering these 1688 products:\n${lines.join("\n")}`;
      cartDrawer.classList.remove("open");
      document.querySelector("#quote").scrollIntoView({ behavior: "smooth" });
      showToast("Cart added to order request");
    });

    const supabaseSettingsForm = document.querySelector("#supabaseSettingsForm");
    const loadOrdersButton = document.querySelector("#loadOrdersButton");

    if (supabaseSettingsForm) {
      supabaseSettingsForm.addEventListener("submit", (event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        saveToStorage(supabaseSettingsKey, {
          supabaseUrl: formData.get("supabaseUrl").trim(),
          anonKey: formData.get("anonKey").trim(),
          adminPin: formData.get("adminPin").trim()
        });
        showToast("Supabase settings saved");
      });
    }

    if (loadOrdersButton) {
      loadOrdersButton.addEventListener("click", async () => {
        try {
          await loadSupabaseOrders();
          showToast("Supabase orders loaded");
        } catch (error) {
          showToast("Could not load Supabase orders");
        }
      });
    }

    if (requestList) {
      requestList.addEventListener("change", async (event) => {
        const select = event.target.closest("select[data-action='status']");
        if (!select) return;
        const settings = getSupabaseSettings();
        try {
          const data = await callOrderWorkflow("update_status", {
            id: select.dataset.id,
            status: select.value,
            adminPin: settings.adminPin
          });
          saveRequestUpdate(select.dataset.id, () => normalizeOrder(data.order));
          showToast("Supabase order status updated");
        } catch (error) {
          saveRequestUpdate(select.dataset.id, (request) => ({ ...request, status: select.value }));
          showToast("Status updated locally");
        }
      });

      requestList.addEventListener("click", async (event) => {
        const button = event.target.closest("button[data-action]");
        if (!button) return;
        const requests = loadFromStorage(orderRequestsKey, []).map(normalizeOrder);
        const request = requests.find((item) => item.id === button.dataset.id);
        const settings = getSupabaseSettings();

        if (button.dataset.action === "delete-request") {
          try {
            await callOrderWorkflow("delete_order", { id: button.dataset.id, adminPin: settings.adminPin });
          } catch (error) {
            // Keep local delete useful even when Supabase is offline or not configured.
          }
          saveToStorage(orderRequestsKey, requests.filter((item) => item.id !== button.dataset.id));
          renderRequests();
          showToast("Order request deleted");
          return;
        }

        if (button.dataset.action === "resend-telegram" && request) {
          try {
            const data = await callOrderWorkflow("resend_telegram", { id: request.id, adminPin: settings.adminPin });
            saveRequestUpdate(request.id, () => normalizeOrder(data.order));
            showToast("Telegram message sent by Supabase");
          } catch (error) {
            saveRequestUpdate(request.id, (item) => ({ ...item, telegramResult: "failed" }));
            showToast("Supabase Telegram send failed");
          }
        }
      });
    }

    document.querySelector("#quoteForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      const formData = new FormData(event.currentTarget);
      const request = {
        id: `request-${Date.now()}`,
        name: formData.get("name").trim(),
        contact: formData.get("contact").trim(),
        destination: formData.get("destination").trim(),
        request: formData.get("request").trim(),
        status: "Submitted",
        telegramResult: "pending",
        createdAt: new Date().toISOString()
      };

      try {
        const data = await callOrderWorkflow("create_order", {
          name: request.name,
          contact: request.contact,
          destination: request.destination,
          request: request.request
        });
        const saved = normalizeOrder(data.order);
        const requests = loadFromStorage(orderRequestsKey, []).map(normalizeOrder);
        requests.unshift(saved);
        saveToStorage(orderRequestsKey, requests);
        request.telegramResult = saved.telegramResult;
      } catch (error) {
        const requests = loadFromStorage(orderRequestsKey, []).map(normalizeOrder);
        request.telegramResult = "local_only";
        requests.unshift(request);
        saveToStorage(orderRequestsKey, requests);
      }
      event.currentTarget.reset();
      renderRequests();
      showToast(request.telegramResult === "sent" ? "Order saved and sent to Telegram" : "Order saved locally");
    });

    const supabaseSettings = getSupabaseSettings();
    if (supabaseSettingsForm) {
      supabaseSettingsForm.elements.supabaseUrl.value = supabaseSettings.supabaseUrl || "";
      supabaseSettingsForm.elements.anonKey.value = supabaseSettings.anonKey || "";
      supabaseSettingsForm.elements.adminPin.value = supabaseSettings.adminPin || "";
    }
    renderProducts();
    renderCart();
    renderRequests();
