/* ──────────────────────────────────────────────────────────
 *  app.js — full file, rewritten 2025‑08‑07
 *  ‑ Adds robust meta‑line extraction so items / abilities /
 *    natures / EVs etc. are no longer mis‑identified as moves.
 *  ‑ No content omitted; copy‑paste as‑is.
 * ────────────────────────────────────────────────────────── */

/* ---------- tunables ---------- */
const CONF_THR  = 0.20;   /* minimum confidence before asking user   */
const STABLE_N  = 3;      /* frames in a row to consider “stable”    */
const JPEG_QUAL = 0.85;   /* camera capture quality (0‑1)            */

/* ---------- globals ---------- */
let flavor            = {};
let labels            = [];
let last              = -1, same = 0;
let speaking          = false;
let currentName       = "";
let promptVisible     = false;
let predictController = null;

/* ---------- preload assets ---------- */
async function loadAssets () {
  try {
    const [flavResp, classResp] = await Promise.all([
      fetch("flavor_text.json"),
      fetch("class_indices.json")
    ]);
    flavor = flavResp.ok ? await flavResp.json() : {};
    const classIndices = classResp.ok ? await classResp.json() : {};
    labels = [];
    if (classIndices && typeof classIndices === "object") {
      Object.entries(classIndices).forEach(([name, idx]) => {
        if (typeof idx === "number")          labels[idx]       = name;
        else if (!isNaN(Number(name)))        labels[+name]     = idx;
      });
    }
  } catch (e) {
    console.warn("[app.js] failed to preload assets:", e);
  }
}

/* ---------- tiny helpers ---------- */
const $      = q  => document.querySelector(q);
const show   = el => el && (el.style.display = "flex");
const hide   = el => el && (el.style.display = "none");
const toID   = s  => (typeof s === "string"
                      ? s.toLowerCase().replace(/[^a-z0-9]/g, "")
                      : "");
const makeUrl = path => {
  const base = (window.API_BASE || "").replace(/\/+$/, "");
  return `${base}/${path.replace(/^\/+/, "")}`;
};
const debug = (...a) => console.debug("[app.js]", ...a);

/* ---------- text‑to‑speech ---------- */
function speakText (txt) {
  if (!("speechSynthesis" in window) || !txt) return;
  try { speechSynthesis.cancel(); } catch {}
  speaking = true;
  const u  = new SpeechSynthesisUtterance(txt);
  u.onend  = u.onerror = () => { speaking = false; requestAnimationFrame(loop); };
  speechSynthesis.speak(u);
}

/* ---------- unit converters ---------- */
const mToFtIn = dm => {
  const inches = dm * 3.937007874;
  return `${Math.floor(inches / 12)}'${Math.round(inches % 12)}"`;
};
const kgToLb = hg => {
  const kg = hg / 10;
  return `${kg.toFixed(1)} kg (${(kg * 2.205).toFixed(1)} lb)`;
};

/* ---------- helpers for Smogon‑style set display ---------- */
const NATURES = [
  "adamant","bashful","bold","brave","calm","careful","docile",
  "gentle","hardy","hasty","impish","jolly","lax","lonely","mild",
  "modest","naive","naughty","quiet","quirky","rash","relaxed",
  "sassy","serious","timid"
];
const cleanMove = m => {
  if (typeof m !== "string") return "";
  const cut = m.indexOf("Type");
  return (cut > 0 ? m.slice(0, cut) : m).trim();
};
const formatEV = ev =>
  typeof ev === "string"
    ? ev
    : Object.entries(ev || {})
        .map(([k, v]) => `${v} ${k.toUpperCase()}`)
        .join(" / ");

/* ---------- competitive usage summary ---------- */
function renderUsageSummary (u) {
  const box = $("#stats-usage");
  if (!box) return;
  box.innerHTML = "";

  if (!u || (!u.moves?.length && !u.abilities?.length && !u.items?.length)) {
    box.style.display = "block";
    const msg          = document.createElement("div");
    msg.textContent    = "No competitive usage data yet.";
    msg.style.fontStyle = "italic";
    box.appendChild(msg);
    debug("no usage data to render", u);
    return;
  }

  box.style.display = "block";
  ["Moves","Abilities","Items"].forEach(label => {
    const key  = label.toLowerCase();
    const list = u[key];
    if (!list?.length) return;
    const span = document.createElement("span");
    span.textContent = `${label}: `;
    box.appendChild(span);
    list.slice(0, 6).forEach(v => {
      const t   = document.createElement("span");
      t.className = "tag";
      t.textContent = v;
      box.appendChild(t);
    });
    box.appendChild(document.createElement("br"));
  });
}

/* ---------- tier tab builder ---------- */
function buildTierTabs (fullSets) {
  let tabs = $("#usage-tabs"),
      pane = $("#usage-content");
  if (!tabs) {
    tabs           = document.createElement("div");
    tabs.id        = "usage-tabs";
    tabs.className = "tab-strip";
    $("#stats-panel .card").appendChild(tabs);
  }
  if (!pane) {
    pane           = document.createElement("div");
    pane.id        = "usage-content";
    $("#stats-panel .card").appendChild(pane);
  }
  tabs.innerHTML = "";
  pane.innerHTML = "";

  const tiers = Object.keys(fullSets || {}).sort();
  if (!tiers.length) return;

  function activate (tier) {
    tabs.querySelectorAll("button").forEach(b => b.classList.remove("active"));
    const btn = tabs.querySelector(`button[data-tier='${tier}']`);
    if (btn) btn.classList.add("active");
    renderTierSets(fullSets[tier], pane);
  }

  tiers.forEach((t, i) => {
    const b = document.createElement("button");
    b.className   = "tab-btn";
    b.textContent = t;
    b.dataset.tier = t;
    b.onclick     = () => activate(t);
    tabs.appendChild(b);
    if (i === 0) activate(t);
  });
}

/* ---------- Smogon‑style set renderer ---------- */
function renderTierSets (list, container) {
  container.innerHTML = "";
  if (!Array.isArray(list) || !list.length) {
    const p      = document.createElement("p");
    p.textContent = "No sets for this tier.";
    p.style.fontStyle = "italic";
    container.appendChild(p);
    return;
  }

  /* heuristic helpers ---------------------------------------------------- */
  const looksLikeEV = s => /^\d+\s+(HP|Atk|Def|Sp[AD]|Spe)$/i.test(s.trim());
  const looksLikeIV = s => /^\d+\s+(HP|Atk|Def|Sp[AD]|Spe)$/i.test(s.trim());
  const looksLikeNature = s => NATURES.includes(s.trim().toLowerCase());
  const looksLikeItem = s => /holder'?s\s|restores|if held/i.test(s);
  const looksLikeAbility = s => /this pokemon|prevents|user/i.test(s);

  list.forEach(raw => {
    /* clone so we never mutate upstream data */
    const set = { ...raw, moves: Array.isArray(raw.moves) ? [...raw.moves] : [] };

    /* pull meta lines out of the “moves” field --------------------------- */
    const realMoves = [];
    set.moves.forEach(line => {
      const l = line.trim();
      if (l.match(/^item:/i)       || looksLikeItem(l))         set.item      = l.replace(/^item:\s*/i,"").trim();
      else if (l.match(/^ability:/i) || looksLikeAbility(l))    set.ability   = l.replace(/^ability:\s*/i,"").trim();
      else if (l.match(/^nature:/i)  || looksLikeNature(l))     set.nature    = l.replace(/^nature:\s*/i,"").trim();
      else if (l.match(/^evs:/i)     || looksLikeEV(l))         set.evs       = l.replace(/^evs:\s*/i,"").trim();
      else if (l.match(/^ivs:/i)     || looksLikeIV(l))         set.ivs       = l.replace(/^ivs:\s*/i,"").trim();
      else if (l.match(/^tera/i))                                set.teratypes = l.replace(/^tera type?:?\s*/i,"").trim();
      else                                                       realMoves.push(l); /* actual move */
    });
    set.moves = realMoves;

    /* build card ---------------------------------------------------------- */
    const card        = document.createElement("div");
    card.className    = "set-card";
    const table       = document.createElement("table");
    table.className   = "set-table";

    if (set.name) {
      const cap       = document.createElement("caption");
      cap.className   = "set-name";
      cap.textContent = set.name;
      table.appendChild(cap);
    }

    /* numbered moves */
    set.moves.forEach((m, i) => {
      const tr  = document.createElement("tr");
      tr.className = "move-row";
      tr.innerHTML = `<th class="move-index">Move ${i + 1}</th><td class="move-name">${cleanMove(m)}</td>`;
      table.appendChild(tr);
    });

    /* meta rows */
    const add = (label,val) => {
      if (!val) return;
      const tr = document.createElement("tr");
      const th = document.createElement("th");
      const td = document.createElement("td");
      th.textContent = label;
      td.textContent = Array.isArray(val) ? val.join(" / ") : val;
      tr.append(th,td);
      table.appendChild(tr);
    };
    add("Item",   set.item);
    add("Ability",set.ability);
    add("Nature", set.nature);
    add("EVs",    set.evs && formatEV(set.evs));
    add("IVs",    set.ivs && formatEV(set.ivs));
    add("Tera",   set.teratypes);

    card.appendChild(table);
    container.appendChild(card);
  });
}

/* ---------- full stats panel renderer ---------- */
function renderStats (d) {
  $("#stats-name").textContent = `${d.name}  (#${String(d.dex).padStart(4,"0")})`;
  $("#stats-desc").textContent = d.description || "";

  const types = $("#stats-types");
  if (types) {
    types.innerHTML = "";
    (d.types || []).forEach(t => {
      const sp   = document.createElement("span");
      sp.className = "type";
      sp.textContent = t;
      types.appendChild(sp);
    });
  }

  $("#stats-abilities").textContent = `Abilities: ${(d.abilities || []).join(", ")}`;

  const bst = $("#stats-table");
  if (bst) {
    bst.innerHTML = "";
    Object.entries(d.base_stats || {}).forEach(([k,v]) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${k}</td><td>${v}</td>`;
      bst.appendChild(tr);
    });
  }

  $("#stats-misc").textContent =
      `Height: ${mToFtIn(d.height)}   •   Weight: ${kgToLb(d.weight)}`;

  const slug = toID(d.name);
  fetch(makeUrl(`api/usage/${slug}`))
    .then(r => r.ok ? r.json() : {})
    .then(u => {
      renderUsageSummary(u);
      buildTierTabs(u.full_sets || {});
    })
    .catch(e => console.warn("[usage] error", slug, e));
}

/* ---------- camera prediction loop ---------- */
async function loop () {
  if (speaking || promptVisible || $("#stats-panel")?.style.display === "flex") return;

  const cam   = $("#cam"),
        work  = $("#worker"),
        label = $("#label");
  if (!cam || !work || !label || !cam.videoWidth)
    return requestAnimationFrame(loop);

  const portrait = cam.videoHeight > cam.videoWidth;
  const s        = portrait ? cam.videoWidth : cam.videoHeight;
  work.width = work.height = s;
  const ctx = work.getContext("2d");

  if (portrait) {
    ctx.save();
    ctx.translate(0, s);
    ctx.rotate(-Math.PI / 2);
    ctx.drawImage(cam,(cam.videoHeight - s)/2,(cam.videoWidth - s)/2,s,s,0,0,s,s);
    ctx.restore();
  } else {
    ctx.drawImage(cam,(cam.videoWidth - s)/2,(cam.videoHeight - s)/2,s,s,0,0,s,s);
  }

  const jpeg = work.toDataURL("image/jpeg", JPEG_QUAL);
  if (predictController) predictController.abort();
  predictController = new AbortController();
  const signal = predictController.signal;

  let res;
  try {
    res = await fetch(makeUrl("api/predict"), {
      method : "POST",
      headers: { "Content-Type": "application/json" },
      body   : JSON.stringify({ image: jpeg }),
      signal
    });
  } catch (e) {
    if (e.name === "AbortError") return;
    console.warn("[predict] network error", e);
    return requestAnimationFrame(loop);
  }
  if (!res.ok) return requestAnimationFrame(loop);

  let data;
  try { data = await res.json(); }
  catch { console.warn("[predict] parse error"); return requestAnimationFrame(loop); }

  const { name = "", conf = 0, stable = false } = data;
  label.textContent = `${name} ${(conf * 100).toFixed(1)} %`;

  const idx  = labels.indexOf(name);
  same       = idx === last ? same + 1 : 1;
  last       = idx;
  const ready = stable || (same >= STABLE_N && conf >= CONF_THR);

  if (ready && name) { currentName = name; promptUser(name, conf); }
  else               { requestAnimationFrame(loop); }
}

/* ---------- small prompt / modal helpers ---------- */
function promptUser (n, c) {
  $("#prompt-text").textContent =
      `Looks like ${n} (${(c * 100).toFixed(1)}%). Show its stats?`;
  show($("#prompt"));
  promptVisible = true;
}

/* ---------- main — wire up UI & camera ---------- */
$("#start").onclick = async () => {
  if ("speechSynthesis" in window)
    try { speechSynthesis.speak(new SpeechSynthesisUtterance("")); } catch {}

  hide($("#start"));
  await loadAssets();

  const cam = $("#cam");
  const openCam = async () => {
    const ideal = { facingMode:"environment", width:{ideal:1280}, height:{ideal:720} };
    try { return await navigator.mediaDevices.getUserMedia({ video: ideal }); }
    catch {
      const dev  = await navigator.mediaDevices.enumerateDevices();
      const rear = dev.find(d => d.kind === "videoinput" && /back/i.test(d.label));
      if (rear) return navigator.mediaDevices.getUserMedia({
        video:{ deviceId:{ exact: rear.deviceId }, width:1280, height:720 }
      });
      return navigator.mediaDevices.getUserMedia({ video: true });
    }
  };

  try { cam.srcObject = await openCam(); await cam.play(); }
  catch (e) { $("#alert").textContent = e.message; return; }

  requestAnimationFrame(loop);
};

$("#btn-stats").onclick = async () => {
  hide($("#prompt")); promptVisible = false;
  const slug = toID(currentName);
  let data   = {};
  try {
    const r = await fetch(makeUrl(`api/pokemon/${slug}`));
    if (r.ok) data = await r.json();
  } catch (e) { console.warn("pokemon fetch error", e); }
  renderStats({ ...data, name: currentName });

  show($("#stats-panel"));
  const txt = data.description || (flavor[currentName.toLowerCase()]?.[0] || "");
  speakText(txt);
};

$("#btn-dismiss").onclick = () => {
  hide($("#prompt"));
  promptVisible = false;
  requestAnimationFrame(loop);
};

$("#stats-close").onclick = () => {
  hide($("#stats-panel"));
  requestAnimationFrame(loop);
};
