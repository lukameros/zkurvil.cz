(() => {
  const AVATARS = ["😈","💀","🧟","🦂","🐺","🦇","👻","🤡","🦴","🧨","🕷️","🧛"];
  const pickAvatar = () => AVATARS[Math.floor(Math.random() * AVATARS.length)];

  function escapeHtml(str){
    return String(str)
      .replaceAll("&","&amp;")
      .replaceAll("<","&lt;")
      .replaceAll(">","&gt;")
      .replaceAll("\"","&quot;")
      .replaceAll("'","&#039;");
  }

  function getPlayerName(){
    return (localStorage.getItem("playerName") || "").trim() || "Guest";
  }

  function ensureAvatar(){
    const key = "uiAvatar";
    let a = localStorage.getItem(key);
    if (!a){
      a = pickAvatar();
      localStorage.setItem(key, a);
    }
    return a;
  }

  function createUserBadge(){
    const name = getPlayerName();
    const avatar = ensureAvatar();
    const wrap = document.createElement("div");
    wrap.id = "uiUserBadge";
    wrap.innerHTML = `
      <div class="ui-avatar" title="Random avatar">${avatar}</div>
      <div class="ui-meta">
        <small>Logged as</small>
        <div class="name">${escapeHtml(name)}</div>
      </div>
    `;
    return wrap;
  }

  function createUpdatePanel(){
    const wrap = document.createElement("div");
    wrap.className = "ui-panel ui-update";
    wrap.id = "uiUpdatePanel";
    wrap.innerHTML = `
      <h3>📌 UPDATE 0.1</h3>
      <table class="ui-table" aria-label="Changelog">
        <tr><td>0.1.0</td><td>Menu + lobby</td></tr>
        <tr><td>0.1.1</td><td>Levels 1–10</td></tr>
        <tr><td>0.1.2</td><td>Shop + premium okno</td></tr>
        <tr><td>0.1.3</td><td>Guild systém (local)</td></tr>
        <tr><td>Hotfix</td><td>Reklama + „+“ otevírá balíčky</td></tr>
      </table>
    `;
    return wrap;
  }

  function createPromoBtn(){
    const btn = document.createElement("button");
    btn.id = "uiPromoBtn";
    btn.className = "ui-pulse";
    btn.type = "button";
    btn.innerHTML = `➕ Získat více mincí <span class="sub">✨ Balíčky (2 měsíce) – klikni</span>`;
    btn.addEventListener("click", openPremiumModal);
    return btn;
  }

  function createPremiumModal(){
    const modal = document.createElement("div");
    modal.id = "uiPremiumModal";
    modal.innerHTML = `
      <div class="modal-content" role="dialog" aria-modal="true" aria-label="Premium balíčky">
        <h2 style="color:#fbbf24;margin-bottom:1.5rem;text-align:center;">✨ Získej Více Energie a Mincí!</h2>

        <div class="premium-card">
          <div class="premium-title">⚡ Základní Balíček</div>
          <div class="premium-price">50 Kč / měsíc</div>
          <ul class="premium-features">
            <li>✅ 10 energie každých 10 minut</li>
            <li>✅ Rychlejší obnova</li>
            <li>✅ 100 bonusových mincí</li>
          </ul>
          <button class="btn btn-primary btn-wide" data-bundle="basic">Zakoupit</button>
        </div>

        <div class="premium-card">
          <div class="premium-title">🔥 Premium Balíček</div>
          <div class="premium-price">100 Kč / měsíc</div>
          <ul class="premium-features">
            <li>✅ 100 energie každých 10 minut</li>
            <li>✅ Téměř neomezené hraní</li>
            <li>✅ 500 bonusových mincí</li>
            <li>✅ Exkluzivní skiny zdarma</li>
          </ul>
          <button class="btn btn-primary btn-wide" data-bundle="premium">Zakoupit</button>
        </div>

        <button class="btn btn-secondary btn-wide" type="button" id="uiPremiumClose">Zavřít</button>
      </div>
    `;

    // close by backdrop
    modal.addEventListener("click", (e) => {
      if (e.target === modal) closePremiumModal();
    });

    modal.querySelector("#uiPremiumClose").addEventListener("click", closePremiumModal);

    modal.querySelectorAll("[data-bundle]").forEach(b => {
      b.addEventListener("click", () => {
        const bundle = b.getAttribute("data-bundle");
        localStorage.setItem("selectedBundle", bundle);
        // jump to shop for real purchase flow (but modal already shows balíčky)
        try { window.location.href = "shop.html#bundle=" + encodeURIComponent(bundle); } catch {}
      });
    });

    // ESC close
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && modal.classList.contains("show")) closePremiumModal();
    });

    return modal;
  }

  function openPremiumModal(){
    // If we're on shop page and its own modal exists, use it (exact same look)
    const shopModal = document.getElementById("premiumModal");
    if (shopModal && typeof window.showPremiumModal === "function"){
      window.showPremiumModal();
      return;
    }
    const modal = document.getElementById("uiPremiumModal");
    if (modal) modal.classList.add("show");
  }

  function closePremiumModal(){
    const shopModal = document.getElementById("premiumModal");
    if (shopModal && typeof window.closePremiumModal === "function"){
      window.closePremiumModal();
      return;
    }
    const modal = document.getElementById("uiPremiumModal");
    if (modal) modal.classList.remove("show");
  }

  function hijackPlusButtons(){
    // Any common "+" buttons should open premium modal instead of redirect
    const candidates = [
      ...document.querySelectorAll(".add-coins-small"),
      ...document.querySelectorAll(".add-coins-btn"),
      ...document.querySelectorAll("button")
    ];

    candidates.forEach(el => {
      const txt = (el.textContent || "").trim();
      const hasPlus = txt.startsWith("➕") || txt.startsWith("+") || el.classList.contains("add-coins-small");
      const looksLikeCoins = /minc|coin/i.test(txt) || el.title?.toLowerCase().includes("minc");
      const hasInlineShop = typeof el.getAttribute === "function" && (el.getAttribute("onclick") || "").includes("shop.html");

      if (hasInlineShop || (hasPlus && looksLikeCoins)){
        // override inline onclick
        el.onclick = (ev) => {
          ev?.preventDefault?.();
          openPremiumModal();
          return false;
        };
        el.addEventListener("click", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          openPremiumModal();
        }, { capture:true });
      }
    });
  }

  function mount(){
    if (!document.body) return;

    if (!document.getElementById("uiUserBadge")){
      document.body.appendChild(createUserBadge());
    }
    if (!document.getElementById("uiUpdatePanel")){
      document.body.appendChild(createUpdatePanel());
    }
    if (!document.getElementById("uiPromoBtn")){
      document.body.appendChild(createPromoBtn());
    }
    if (!document.getElementById("uiPremiumModal")){
      document.body.appendChild(createPremiumModal());
    }

    hijackPlusButtons();
    window.openPremiumModal = openPremiumModal;
    window.closePremiumModal = closePremiumModal;
  }

  if (document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
})();