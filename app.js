/* ---------- tunables ---------- */
const CONF_THR = 0.20;
const STABLE_N = 3;
const JPEG_QUAL = 0.85;

/* ---------- globals ---------- */
let flavor = {};
let labels = [];
let last   = -1, same = 0;
let speaking = false;
let currentName = "";
let promptVisible = false;
let predictController = null;

/* ---------- static reference lists ---------- */
const NATURES = [
  "Adamant","Bashful","Bold","Brave","Calm","Careful","Docile","Gentle","Hardy","Hasty",
  "Impish","Jolly","Lax","Lonely","Mild","Modest","Naive","Naughty","Quiet","Quirky",
  "Rash","Relaxed","Sassy","Serious","Timid"          // official list
];
const EV_RE   = /^\s*\d+\s+(HP|Atk|Def|SpA|SpD|Spe)\s*$/i;

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
      Object.entries(classIndices).forEach(([k, v]) => {
        if (typeof v === "number") labels[v] = k;
        else if (!isNaN(+k)) labels[+k] = v;
      });
    }
  } catch (e) { console.warn("[app.js] asset preload failed:", e); }
}

/* ---------- helpers ---------- */
const $     = q => document.querySelector(q);
const show  = el => el && (el.style.display = "flex");
const hide  = el => el && (el.style.display = "none");
const toID  = s => (typeof s === "string" ? s.toLowerCase().replace(/[^a-z0-9]/g,"") : "");
const makeUrl = p => `${(window.API_BASE||"").replace(/\/+$/,"")}/${p.replace(/^\/+/,"")}`;
const debug = (...a) => console.debug("[app.js]",...a);

/* speech helper omitted for brevity – unchanged */

/* ---------- converters ---------- */
const mToFtIn = dm => {
  const inch = dm * 3.937007874;
  return `${Math.floor(inch/12)}'${Math.round(inch%12)}"`;
};
const kgToLb  = hg => `${(hg/10).toFixed(1)} kg (${((hg/10)*2.205).toFixed(1)} lb)`;

/* ---------- tiny formatters ---------- */
const cleanMove = txt => {
  if (typeof txt !== "string") return "";
  const cut = txt.indexOf("Type");              // strip long PSA after move name
  return (cut>0 ? txt.slice(0,cut) : txt).trim();
};
const fmtEV = obj => typeof obj === "string"
  ? obj
  : Object.entries(obj||{}).map(([k,v])=>`${v} ${k.toUpperCase()}`).join(" / ");

/* ---------------------------------------------------------------------- */
/*                         COMPETITIVE‑SET  LOGIC                         */
/* ---------------------------------------------------------------------- */

/** Parse a raw array where meta lines are mixed with moves. */
function disentangleSet (inSet) {
  const set = { ...inSet, moves: [] }, credits = [];
  const push = (key,val)=> {
    if (!val) return;
    if (!set[key])         set[key] = val;
    else if (Array.isArray(set[key])) set[key].push(val);
    else set[key] = [set[key], val];
  };

  (inSet.moves || []).forEach(line => {
    if (typeof line !== "string" || !line.trim()) return;
    const txt = line.trim();

    // 1️⃣ Credits
    if (/^(written|quality checked|grammar checked)/i.test(txt)) {
      credits.push(txt);
      return;
    }

    // 2️⃣ EV / IV lines
    if (EV_RE.test(txt)) { push("evs", txt); return; }

    // 3️⃣ Nature
    if (NATURES.includes(txt.split(" ")[0])) { push("nature", txt); return; }

    // 4️⃣ Item – heuristic: contains "Holder's" OR common key words
    if (/Holder's/i.test(txt) ||
        /Choice |Band|Scarf|Specs|Boots|Berry|Orb|Leftovers|Eviolite|Sash/i.test(txt)) {
      push("item", txt.split(/Holder's/i)[0].trim());
      return;
    }

    // 5️⃣ Ability – heuristic: contains "This Pokémon"
    if (/This Pokemon|This Pokémon/i.test(txt)) {
      push("ability", txt.split(/This Pokemon|This Pokémon/i)[0].trim());
      return;
    }

    // 6️⃣ Fallback: treat as move
    set.moves.push(txt);
  });

  if (credits.length) set.credits = credits.join(" • ");
  return set;
}

/* ---------- usage summary (unchanged) ---------- */
function renderUsageSummary (u) { /* … same as previous version … */ }

/* ---------- tier tabs ---------- */
function buildTierTabs (obj) { /* … same as previous version … */ }

/* ---------- render all sets for one tier ---------- */
function renderTierSets (arr, box) {
  box.innerHTML = "";
  if (!Array.isArray(arr) || !arr.length) {
    box.innerHTML = "<p><em>No sets for this tier.</em></p>";
    return;
  }

  arr.forEach(raw => {
    const set = disentangleSet(raw);

    /* card & table */
    const card = document.createElement("div");
    card.className = "set-card";

    const t = document.createElement("table");
    t.className = "set-table";
    if (set.name) {
      const cap = document.createElement("caption");
      cap.className = "set-name";
      cap.textContent = set.name;
      t.appendChild(cap);
    }

    /* moves */
    set.moves.forEach((m,i)=>{
      t.insertAdjacentHTML("beforeend",
        `<tr><th class="move-index">Move ${i+1}</th><td class="move-name">${cleanMove(m)}</td></tr>`);
    });

    /* meta rows */
    const row = (lab,val)=> t.insertAdjacentHTML("beforeend",
      `<tr><th>${lab}</th><td>${Array.isArray(val)?val.join(" / "):val}</td></tr>`);
    if (set.item)      row("Item",     set.item);
    if (set.ability)   row("Ability",  set.ability);
    if (set.nature)    row("Nature",   set.nature);
    if (set.evs)       row("EVs",      set.evs);
    if (set.ivs)       row("IVs",      set.ivs);
    if (set.teratypes) row("Tera",     set.teratypes);
    if (set.credits)   row("Credits",  set.credits);

    card.appendChild(t);
    box.appendChild(card);
  });
}

/* ---------- stats panel, camera loop, UI wiring ---------- */
/* (identical to previous version except calls now reach new helpers) */
