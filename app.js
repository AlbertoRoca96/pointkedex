/* ---------- tunables ---------- */
const CONF_THR = 0.20;
const STABLE_N = 3;
const JPEG_QUAL = 0.85;

/* ---------- globals ---------- */
let flavor = {};
let labels = [];
let last = -1,
  same = 0;
let speaking = false;
let currentName = "";
let promptVisible = false;
let predictController = null;
let allUsage = {}; // cache of usage_data.json
let currentTiers = new Set(); // active tier filters

/* ---------- preload assets ---------- */
async function loadAssets() {
  try {
    const [flavResp, classResp, usageResp] = await Promise.all([
      fetch("flavor_text.json"),
      fetch("class_indices.json"),
      fetch("usage_data.json"),
    ]);

    if (!flavResp.ok) console.warn("[app.js] flavor_text.json fetch failed:", flavResp.status);
    if (!classResp.ok) console.warn("[app.js] class_indices.json fetch failed:", classResp.status);
    if (!usageResp.ok) console.warn("[app.js] usage_data.json fetch failed:", usageResp.status);

    flavor = flavResp.ok ? await flavResp.json() : {};
    const classIndices = classResp.ok ? await classResp.json() : {};
    labels = [];

    if (classIndices && typeof classIndices === "object") {
      Object.entries(classIndices).forEach(([name, idx]) => {
        if (typeof idx === "number") labels[idx] = name;
        else if (!isNaN(Number(name))) labels[Number(name)] = idx;
      });
    }

    allUsage = usageResp.ok ? await usageResp.json() : {};
    console.log("[app.js] loaded usage_data.json entries:", Object.keys(allUsage).length);
  } catch (e) {
    console.warn("[app.js] failed to preload assets:", e);
  }
}

/* ---------- helpers ---------- */
const $ = q => document.querySelector(q);
const $$ = q => Array.from(document.querySelectorAll(q));
const show = el => el && (el.style.display = "flex");
const hide = el => el && (el.style.display = "none");
const toID = s => (typeof s === "string" ? s.toLowerCase().replace(/[^a-z0-9]/g, "") : "");
const makeUrl = path => {
  const base = (window.API_BASE || "").replace(/\/+$/, "");
  return `${base}/${path.replace(/^\/+/, "")}`;
};
const debug = (...args) => console.debug("[app.js]", ...args);

/* parse move blob into structured object */
function parseMoveBlob(blob = "") {
  const result = {
    name: "",
    effect: "",
    type: "",
    category: "",
    power: null,
    accuracy: null,
    priority: null,
    raw: blob,
  };

  const nameMatch = blob.match(/^([A-Za-z0-9 \-]+)/);
  if (nameMatch) result.name = nameMatch[1].trim();

  const effectMatch = blob.match(/^[A-Za-z0-9 \-]+(.*?)Type/);
  if (effectMatch) result.effect = effectMatch[1].trim();

  const typeMatch = blob.match(/Type([A-Za-z]+)/i);
  if (typeMatch) result.type = typeMatch[1];

  const categoryMatch = blob.match(/Category([A-Za-z]+)/i);
  if (categoryMatch) result.category = categoryMatch[1];

  const powerMatch = blob.match(/Power(\d+)/i);
  if (powerMatch) result.power = parseInt(powerMatch[1], 10);

  const accuracyMatch = blob.match(/Accuracy(\d+)%/i);
  if (accuracyMatch) result.accuracy = `${accuracyMatch[1]}%`;

  const priorityMatch = blob.match(/Priority(\d+)/i);
  if (priorityMatch) result.priority = parseInt(priorityMatch[1], 10);

  return result;
}

/* ---------- renderers ---------- */
function renderUsage(u) {
  const box = $("#stats-usage");
  if (!box) return;
  box.innerHTML = "";

  if (!u || (!u.moves?.length && !u.abilities?.length && !u.items?.length)) {
    const msg = document.createElement("div");
    msg.textContent = "No competitive usage data yet.";
    msg.className = "placeholder";
    box.appendChild(msg);
    return;
  }

  const section = document.createElement("div");
  section.className = "usage-tags";

  [["Moves", u.moves], ["Abilities", u.abilities], ["Items", u.items]].forEach(([label, list]) => {
    if (!list?.length) return;
    const header = document.createElement("div");
    header.className = "usage-label";
    header.textContent = label + ":";
    section.appendChild(header);
    list.slice(0, 6).forEach(v => {
      const t = document.createElement("div");
      t.className = "tag";
      t.textContent = v;
      section.appendChild(t);
    });
  });

  box.appendChild(section);
}

function renderStats(d, usage) {
  const nameEl = $("#stats-name");
  if (nameEl) nameEl.textContent = `${d.name}  (#${String(d.dex).padStart(4, "0")})`;
  const descEl = $("#stats-desc");
  if (descEl) descEl.textContent = d.description || "";

  const types = $("#stats-types");
  if (types) {
    types.innerHTML = "";
    (d.types || []).forEach(t => {
      const s = document.createElement("div");
      s.className = "type";
      s.textContent = t;
      types.appendChild(s);
    });
  }

  const abilitiesEl = $("#stats-abilities");
  if (abilitiesEl)
    abilitiesEl.textContent = `Abilities: ${(d.abilities || []).join(", ")}`;

  const tbl = $("#stats-table");
  if (tbl) {
    tbl.innerHTML = "";
    Object.entries(d.base_stats || {}).forEach(([k, v]) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${k}</td><td>${v}</td>`;
      tbl.appendChild(tr);
    });
  }

  const misc = $("#stats-misc");
  if (misc)
    misc.textContent = `Height: ${mToFtIn(d.height)}   •   Weight: ${kgToLb(d.weight)}`;

  renderUsage(usage);
}

/* builds tier filter pills */
function populateTierFilters() {
  const container = $("#tier-filters");
  if (!container) return;
  container.innerHTML = "";
  const tiers = new Set();

  Object.values(allUsage).forEach(entry => {
    if (entry.full_sets) {
      Object.keys(entry.full_sets).forEach(t => tiers.add(t));
    }
  });

  if (currentTiers.size === 0) tiers.forEach(t => currentTiers.add(t));

  Array.from(tiers)
    .sort()
    .forEach(tier => {
      const pill = document.createElement("div");
      pill.className = "tier-pill" + (currentTiers.has(tier) ? " active" : "");
      pill.textContent = tier;
      pill.dataset.tier = tier;
      pill.onclick = () => {
        if (currentTiers.has(tier)) currentTiers.delete(tier);
        else currentTiers.add(tier);
        pill.classList.toggle("active");
        if (currentName) fetchAndRender(currentName);
      };
      container.appendChild(pill);
    });
}

/* suggestion hints */
function buildSuggestions(set, usageEntry) {
  const suggestions = [];
  if ((!set.abilities || set.abilities.every(a => !a.trim())) && usageEntry?.abilities?.length) {
    suggestions.push({
      type: "ability",
      message: `Common abilities: ${usageEntry.abilities.slice(0, 2).join(", ")}`,
      items: usageEntry.abilities.slice(0, 2),
    });
  }
  if ((!set.items || set.items.every(i => !i.trim())) && usageEntry?.items?.length) {
    suggestions.push({
      type: "item",
      message: `Common items: ${usageEntry.items.slice(0, 2).join(", ")}`,
      items: usageEntry.items.slice(0, 2),
    });
  }
  return suggestions;
}

/* render set variant cards */
function renderSetCards(slug, data) {
  const container = $("#cards-container");
  if (!container) return;
  container.innerHTML = "";

  const usageEntry = allUsage[slug] || {};
  const availableTiers = Object.keys(data.full_sets || {}).filter(t => currentTiers.has(t));
  if (!availableTiers.length) {
    const fallback = document.createElement("div");
    fallback.textContent = "No sets available for selected tiers.";
    container.appendChild(fallback);
    return;
  }

  availableTiers.forEach(tier => {
    const sets = data.full_sets[tier] || [];
    sets.forEach(set => {
      const tpl = document.getElementById("card-template");
      if (!tpl) return;
      const card = tpl.content.firstElementChild.cloneNode(true);
      const setNameEl = card.querySelector(".set-name");
      if (setNameEl) setNameEl.textContent = set.name || "Unnamed";
      const setSourceEl = card.querySelector(".set-source");
      if (setSourceEl) setSourceEl.textContent = set.source || "";

      const tierBadgeContainer = card.querySelector(".tier-badges");
      if (tierBadgeContainer) {
        const badge = document.createElement("div");
        badge.className = "tier-badge";
        badge.textContent = tier;
        tierBadgeContainer.appendChild(badge);
      }

      // Moves
      const movesList = card.querySelector(".moves-list");
      if (movesList) {
        movesList.innerHTML = "";
        const movesRaw = (set.moves || []).filter(m => typeof m === "string");
        movesRaw.slice(0, 6).forEach(blob => {
          const mv = parseMoveBlob(blob);
          const mvEl = document.createElement("div");
          mvEl.className = "move-card";

          const main = document.createElement("div");
          main.className = "move-main";

          const nameSpan = document.createElement("div");
          nameSpan.className = "move-name";
          nameSpan.textContent = mv.name || "(unknown)";
          main.appendChild(nameSpan);

          if (mv.type) {
            const t = document.createElement("div");
            t.className = "badge";
            t.textContent = mv.type;
            main.appendChild(t);
          }
          if (mv.category) {
            const c = document.createElement("div");
            c.className = "badge";
            c.textContent = mv.category;
            main.appendChild(c);
          }
          if (mv.priority !== null) {
            const p = document.createElement("div");
            p.className = "badge";
            p.textContent = `Priority ${mv.priority}`;
            main.appendChild(p);
          }

          mvEl.appendChild(main);

          const details = document.createElement("div");
          details.className = "move-details";
          if (mv.power !== null) {
            const power = document.createElement("div");
            power.textContent = `Power: ${mv.power}`;
            details.appendChild(power);
          }
          if (mv.accuracy) {
            const acc = document.createElement("div");
            acc.textContent = `Accuracy: ${mv.accuracy}`;
            details.appendChild(acc);
          }
          if (mv.effect) {
            const eff = document.createElement("div");
            eff.className = "effect";
            eff.textContent = `Effect: ${mv.effect}`;
            details.appendChild(eff);
          }

          mvEl.appendChild(details);
          movesList.appendChild(mvEl);
        });
      }

      // Abilities
      const abilitiesList = card.querySelector(".abilities-list");
      if (abilitiesList) {
        abilitiesList.innerHTML = "";
        (set.abilities || []).forEach(a => {
          const t = document.createElement("div");
          t.className = "tag";
          t.textContent = a || "(none)";
          abilitiesList.appendChild(t);
        });
      }

      // Items
      const itemsList = card.querySelector(".items-list");
      if (itemsList) {
        itemsList.innerHTML = "";
        (set.items || []).forEach(i => {
          const t = document.createElement("div");
          t.className = "tag";
          t.textContent = i || "(none)";
          itemsList.appendChild(t);
        });
      }

      // Spread heuristics
      const natureEl = card.querySelector(".nature");
      const nature = (set.moves || []).find(m => /^[A-Za-z]+$/.test(m) && m.toLowerCase() === m && !m.includes(" ")) || "";
      if (natureEl) natureEl.textContent = nature ? `Nature: ${nature}` : "";

      const evsEl = card.querySelector(".evs");
      const evs = [];
      ["252 Atk", "252 Spe", "252 HP", "4 Def", "4 SpD", "4 SpA"].forEach(e => {
        if ((set.moves || []).includes(e)) evs.push(e);
      });
      if (evsEl) evsEl.textContent = evs.length ? `EVs: ${evs.join(", ")}` : "";

      // Suggestions
      const footerSug = card.querySelector(".suggestions");
      if (footerSug) {
        footerSug.innerHTML = "";
        const suggestions = buildSuggestions(set, usageEntry);
        suggestions.forEach(s => {
          const div = document.createElement("div");
          div.className = "tag suggestion";
          div.textContent = s.message;
          div.onclick = () => {
            if (s.type === "ability" && abilitiesList) {
              abilitiesList.innerHTML = "";
              const t = document.createElement("div");
              t.className = "tag";
              t.textContent = s.items[0];
              abilitiesList.appendChild(t);
            }
            if (s.type === "item" && itemsList) {
              itemsList.innerHTML = "";
              const t = document.createElement("div");
              t.className = "tag";
              t.textContent = s.items[0];
              itemsList.appendChild(t);
            }
          };
          footerSug.appendChild(div);
        });
      }

      // Credits
      const creditsEl = card.querySelector(".credits");
      if (creditsEl) {
        const credits = (set.moves || []).filter(m =>
          /Written by|Quality checked by|Grammar checked by/i.test(m)
        );
        creditsEl.textContent = credits.join(" • ");
      }

      container.appendChild(card);
    });
  });
}

/* utility converters */
const mToFtIn = dm => {
  const inches = dm * 3.937007874;
  return `${Math.floor(inches / 12)}'${Math.round(inches % 12)}"`;
};
const kgToLb = hg => {
  const kg = hg / 10;
  return `${kg.toFixed(1)} kg (${(kg * 2.205).toFixed(1)} lb)`;
};

/* ---------- core loop ---------- */
async function loop() {
  if (speaking || promptVisible || $("#stats-panel")?.style.display === "flex") return;

  const cam = $("#cam"),
    work = $("#worker"),
    label = $("#label");
  if (!cam || !work || !label || !cam.videoWidth) {
    return requestAnimationFrame(loop);
  }

  const portrait = cam.videoHeight > cam.videoWidth;
  const s = portrait ? cam.videoWidth : cam.videoHeight;
  work.width = work.height = s;
  const ctx = work.getContext("2d");

  if (portrait) {
    ctx.save();
    ctx.translate(0, s);
    ctx.rotate(-Math.PI / 2);
    ctx.drawImage(
      cam,
      (cam.videoHeight - s) / 2,
      (cam.videoWidth - s) / 2,
      s,
      s,
      0,
      0,
      s,
      s
    );
    ctx.restore();
  } else {
    ctx.drawImage(
      cam,
      (cam.videoWidth - s) / 2,
      (cam.videoHeight - s) / 2,
      s,
      s,
      0,
      0,
      s,
      s
    );
  }

  const jpeg = work.toDataURL("image/jpeg", JPEG_QUAL);
  const endpoint = makeUrl("api/predict");

  if (predictController) predictController.abort();
  predictController = new AbortController();
  const signal = predictController.signal;

  let res;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: jpeg }),
      signal,
    });
  } catch (e) {
    if (e.name === "AbortError") return;
    console.warn("[predict] network error", e);
    return requestAnimationFrame(loop);
  }

  if (!res.ok) return requestAnimationFrame(loop);

  let data;
  try {
    data = await res.json();
  } catch {
    console.warn("[predict] parse error");
    return requestAnimationFrame(loop);
  }

  const { name = "", conf = 0, stable = false } = data;
  const labelEl = $("#label");
  if (labelEl) labelEl.textContent = `${name} ${(conf * 100).toFixed(1)} %`;

  const idx = labels.indexOf(name);
  same = idx === last ? same + 1 : 1;
  last = idx;
  const ready = stable || (same >= STABLE_N && conf >= CONF_THR);

  if (ready && name) {
    currentName = name;
    promptUser(name, conf);
  } else {
    requestAnimationFrame(loop);
  }
}

/* ---------- prompt + UI wiring ---------- */
function promptUser(n, c) {
  fetchAndRender(n);
}

/* fetch and render both detail and set cards */
async function fetchAndRender(name) {
  const slug = toID(name);
  debug("fetching for", name, slug);
  let dex = {};
  try {
    const r = await fetch(makeUrl(`api/pokemon/${slug}`));
    if (r.ok) dex = await r.json();
  } catch (e) {
    console.warn("pokemon fetch error", e);
  }
  const usageEntry = allUsage[slug] || {};

  renderStats({ ...dex, name }, usageEntry);
  populateTierFilters();
  const statsWrapper = document.getElementById("stats-wrapper");
  if (statsWrapper) statsWrapper.classList.remove("hidden");
  show($("#stats-panel"));

  if (usageEntry) {
    renderSetCards(slug, usageEntry);
  }
}

/* ---------- DOM-ready wiring ---------- */
document.addEventListener("DOMContentLoaded", () => {
  const startBtn = $("#start");
  if (startBtn) {
    startBtn.onclick = async () => {
      if ("speechSynthesis" in window)
        try {
          speechSynthesis.speak(new SpeechSynthesisUtterance(""));
        } catch {}
      hide(startBtn);
      await loadAssets();

      const cam = $("#cam");
      const openCam = async () => {
        const ideal = {
          facingMode: "environment",
          width: { ideal: 1280 },
          height: { ideal: 720 },
        };
        try {
          return await navigator.mediaDevices.getUserMedia({ video: ideal });
        } catch {
          const dev = await navigator.mediaDevices.enumerateDevices();
          const rear = dev.find(d => d.kind === "videoinput" && /back/i.test(d.label));
          if (rear)
            return navigator.mediaDevices.getUserMedia({
              video: { deviceId: { exact: rear.deviceId }, width: 1280, height: 720 },
            });
          return navigator.mediaDevices.getUserMedia({ video: true });
        }
      };

      try {
        cam.srcObject = await openCam();
        await cam.play();
      } catch (e) {
        const alertEl = $("#alert");
        if (alertEl) alertEl.textContent = e.message;
        return;
      }

      requestAnimationFrame(loop);
    };
  } else {
    console.warn("[app.js] #start button missing in DOM");
  }

  const btnStats = $("#btn-stats");
  if (btnStats) {
    btnStats.onclick = async () => {
      hide($("#prompt"));
      promptVisible = false;
      if (!currentName) return;
      await fetchAndRender(currentName);
    };
  }

  const btnDismiss = $("#btn-dismiss");
  if (btnDismiss) {
    btnDismiss.onclick = () => {
      hide($("#prompt"));
      promptVisible = false;
      requestAnimationFrame(loop);
    };
  }

  const statsClose = $("#stats-close");
  if (statsClose) {
    statsClose.onclick = () => {
      hide($("#stats-panel"));
    };
  }
});
