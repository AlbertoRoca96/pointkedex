/* ---------- tunables ---------- */
const CONF_THR = 0.20;
const STABLE_N  = 3;
const JPEG_QUAL = 0.85;

/* ---------- globals ---------- */
let flavor = {};
let labels = [];
let last = -1, same = 0;
let speaking = false;
let currentName = "";
let promptVisible = false;
let predictController = null;

/* ---------- preload assets ---------- */
async function loadAssets(){
  try{
    const [flav,classIx] = await Promise.all([
      fetch("flavor_text.json"),
      fetch("class_indices.json")
    ]);
    flavor = flav.ok ? await flav.json() : {};
    const idx = classIx.ok ? await classIx.json() : {};
    labels = [];
    if(idx && typeof idx==="object"){
      Object.entries(idx).forEach(([n,i])=>{
        if(typeof i==="number") labels[i]=n;
        else if(!isNaN(Number(n))) labels[Number(n)]=i;
      });
    }
  }catch(e){console.warn("[app] preload err",e)}
}

/* ---------- tiny helpers ---------- */
const $     = q => document.querySelector(q);
const show  = el=>el&&(el.style.display="flex");
const hide  = el=>el&&(el.style.display="none");
const toID  = s=>(typeof s==="string"?s.toLowerCase().replace(/[^a-z0-9]/g,""):"");
const makeUrl = p=>`${(window.API_BASE||"").replace(/\/+$/,"")}/${p.replace(/^\/+/,"")}`;
const debug = (...a)=>console.debug("[app]",...a);

/* ---------- speech ---------- */
function speakText(t){
  if(!("speechSynthesis" in window)||!t) return;
  try{speechSynthesis.cancel();}catch{}
  speaking = true;
  const u = new SpeechSynthesisUtterance(t);
  u.onend = u.onerror = ()=>{speaking=false;requestAnimationFrame(loop)};
  speechSynthesis.speak(u);
}

/* ---------- converters ---------- */
const mToFtIn = dm=>{
  const inches = dm*3.937007874;
  return `${Math.floor(inches/12)}'${Math.round(inches%12)}"`;
};
const kgToLb = hg=>{
  const kg=hg/10;
  return `${kg.toFixed(1)} kg (${(kg*2.205).toFixed(1)} lb)`;
};

/* ---------- pretty helpers ---------- */
const cleanMove = s=>{
  if(typeof s!=="string") return "";
  const cut = s.indexOf("Type");
  return (cut>0?s.slice(0,cut):s).trim();
};
const formatEV = ev=>typeof ev==="string"?ev:Object.entries(ev||{}).map(([k,v])=>`${v} ${k.toUpperCase()}`).join(" / ");

/* ---------- usage summary ---------- */
function renderUsageSummary(u){
  const box=$("#stats-usage"); if(!box) return;
  box.innerHTML="";
  if(!u||(!u.moves?.length&&!u.abilities?.length&&!u.items?.length)){
    box.style.display="block";
    box.innerHTML="<div style='font-style:italic'>No competitive usage data yet.</div>";
    return;
  }
  box.style.display="block";
  ["Moves","Abilities","Items"].forEach(lbl=>{
    const list=u[lbl.toLowerCase()]; if(!list?.length) return;
    const span=document.createElement("span"); span.textContent=lbl+": "; box.appendChild(span);
    list.slice(0,6).forEach(v=>{
      const t=document.createElement("span"); t.className="tag"; t.textContent=v; box.appendChild(t);
    });
    box.appendChild(document.createElement("br"));
  });
}

/* ---------- tier tabs ---------- */
function buildTierTabs(full){
  let tabs=$("#usage-tabs"), pane=$("#usage-content");
  if(!tabs){tabs=document.createElement("div");tabs.id="usage-tabs";tabs.className="tab-strip";$("#stats-panel .card").appendChild(tabs);}
  if(!pane){pane=document.createElement("div");pane.id="usage-content";$("#stats-panel .card").appendChild(pane);}
  tabs.innerHTML=""; pane.innerHTML="";
  const tiers=Object.keys(full||{}).sort(); if(!tiers.length) return;

  const activate=t=>{
    tabs.querySelectorAll("button").forEach(b=>b.classList.remove("active"));
    const btn=tabs.querySelector(`button[data-tier='${t}']`); if(btn) btn.classList.add("active");
    renderTierSets(full[t],pane);
  };

  tiers.forEach((t,i)=>{
    const b=document.createElement("button"); b.className="tab-btn"; b.dataset.tier=t; b.textContent=t; b.onclick=()=>activate(t); tabs.appendChild(b);
    if(i===0) activate(t);
  });
}

/* ---------- smarter set‑card renderer ---------- */
function renderTierSets(list,container){
  container.innerHTML="";
  if(!Array.isArray(list)||!list.length){const p=document.createElement("p");p.style.fontStyle="italic";p.textContent="No sets for this tier.";container.appendChild(p);return;}

  /* constants for detection */
  const NATURES=["Hardy","Lonely","Brave","Adamant","Naughty","Bold","Docile","Relaxed","Impish","Lax","Timid","Hasty","Serious","Jolly","Naive","Modest","Mild","Quiet","Bashful","Rash","Calm","Gentle","Sassy","Careful","Quirky"]; /* :contentReference[oaicite:3]{index=3} */
  const STAT_KEYS=["HP","Atk","Def","SpA","SpD","Spe"];

  list.forEach(raw=>{
    /* skip empty credit stubs */
    if((raw.name==="Credits"||raw.name==="Overview") && (!raw.moves||!raw.moves.some(m=>/Type[A-Za-z]+Category/.test(m)))) return;

    const set={...raw};
    const evParts=[], ivParts=[], creditLines=[];
    const items=[], abilities=[];

    const parsedMoves=[];
    (set.moves||[]).forEach(line=>{
      if(/Type[A-Za-z]+Category/.test(line)){ parsedMoves.push(line); return; } // real move

      /* credit / housekeeping lines */
      if(/^written by/i.test(line)||/^quality checked/i.test(line)||/^grammar checked/i.test(line)){creditLines.push(line);return;}

      /* natures */
      if(NATURES.includes(line.trim())){ set.nature=line.trim(); return; }

      /* EV / IV fragments */
      const evMatch=line.match(/^(\d+)\s+(HP|Atk|Def|SpA|SpD|Spe)$/i);
      if(evMatch){ evParts.push(`${evMatch[1]} ${evMatch[2].toUpperCase()}`); return; }

      /* held items – look for “Holder's” or Berry or Boots/Orb/Scarf etc. */
      if(/\bHolder'?s\b/i.test(line)||/\bBerry\b/i.test(line)||/\bBand\b|\bScarf\b|\bBoots\b|\bOrb\b/i.test(line)){
        items.push(cleanMove(line)); return;
      }

      /* abilities – heuristic: contains “This Pokemon” */
      if(/\bThis Pokemon\b/i.test(line)){ abilities.push(cleanMove(line)); return; }

      /* tera type (single word, capitalised) */
      if(/^Tera:?/i.test(line)){ set.teratypes=line.replace(/^Tera:?/i,"").trim(); return; }

      /* fallback: treat as move */
      parsedMoves.push(line);
    });

    if(evParts.length)   set.evs = evParts.join(" / ");
    if(ivParts.length)   set.ivs = ivParts.join(" / ");
    if(items.length)     set.item = items.join(" / ");
    if(abilities.length) set.ability = abilities.join(" / ");
    if(creditLines.length) set.credits = creditLines.join(" • ");

    set.moves = parsedMoves;

    /* ------- build DOM ------- */
    const card=document.createElement("div"); card.className="set-card";
    const tbl=document.createElement("table"); tbl.className="set-table";
    if(set.name){const c=document.createElement("caption");c.className="set-name";c.textContent=set.name;tbl.appendChild(c);}

    set.moves.forEach((m,i)=>{
      const tr=document.createElement("tr"); tr.className="move-row";
      tr.innerHTML=`<th class="move-index">Move ${i+1}</th><td class="move-name">${cleanMove(m)}</td>`;
      tbl.appendChild(tr);
    });

    const pushRow=(lab,val)=>{
      if(!val||(Array.isArray(val)&&!val.length)) return;
      const tr=document.createElement("tr");
      tr.innerHTML=`<th>${lab}</th><td>${Array.isArray(val)?val.join(" / "):val}</td>`;
      tbl.appendChild(tr);
    };
    pushRow("Item",set.item); pushRow("Ability",set.ability); pushRow("Nature",set.nature);
    if(set.evs)  pushRow("EVs",formatEV(set.evs));
    if(set.ivs)  pushRow("IVs",formatEV(set.ivs));
    if(set.teratypes) pushRow("Tera",set.teratypes);
    if(set.credits) pushRow("Credits",set.credits);

    card.appendChild(tbl); container.appendChild(card);
  });
}

/* ---------- stat panel ---------- */
function renderStats(d){
  $("#stats-name").textContent=`${d.name}  (#${String(d.dex).padStart(4,"0")})`;
  $("#stats-desc").textContent=d.description||"";
  const types=$("#stats-types"); if(types){types.innerHTML="";(d.types||[]).forEach(t=>{const s=document.createElement("span");s.className="type";s.textContent=t;types.appendChild(s);});}
  $("#stats-abilities").textContent=`Abilities: ${(d.abilities||[]).join(", ")}`;
  const tbl=$("#stats-table"); if(tbl){tbl.innerHTML="";Object.entries(d.base_stats||{}).forEach(([k,v])=>{const tr=document.createElement("tr");tr.innerHTML=`<td>${k}</td><td>${v}</td>`;tbl.appendChild(tr);});}
  $("#stats-misc").textContent=`Height: ${mToFtIn(d.height)}   •   Weight: ${kgToLb(d.weight)}`;

  fetch(makeUrl(`api/usage/${toID(d.name)}`))
    .then(r=>r.ok?r.json():{})
    .then(u=>{renderUsageSummary(u);buildTierTabs(u.full_sets||{});})
    .catch(e=>console.warn("[usage]",e));
}

/* ---------- camera loop ---------- */
async function loop(){
  if(speaking||promptVisible||$("#stats-panel")?.style.display==="flex") return;
  const cam=$("#cam"),work=$("#worker"),label=$("#label");
  if(!cam||!work||!label||!cam.videoWidth){return requestAnimationFrame(loop);}
  const portrait = cam.videoHeight>cam.videoWidth;
  const s = portrait?cam.videoWidth:cam.videoHeight;
  work.width=work.height=s;
  const ctx=work.getContext("2d");
  if(portrait){ctx.save();ctx.translate(0,s);ctx.rotate(-Math.PI/2);ctx.drawImage(cam,(cam.videoHeight-s)/2,(cam.videoWidth-s)/2,s,s,0,0,s,s);ctx.restore();}
  else{ctx.drawImage(cam,(cam.videoWidth-s)/2,(cam.videoHeight-s)/2,s,s,0,0,s,s);}
  const jpeg=work.toDataURL("image/jpeg",JPEG_QUAL);
  const endpoint=makeUrl("api/predict");
  if(predictController) predictController.abort();
  predictController=new AbortController();
  let res; try{res=await fetch(endpoint,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({image:jpeg}),signal:predictController.signal});}
  catch(e){if(e.name==="AbortError")return;console.warn("[predict] net",e);return requestAnimationFrame(loop);}
  if(!res.ok)return requestAnimationFrame(loop);
  let data; try{data=await res.json();}catch{console.warn("[predict] parse");return requestAnimationFrame(loop);}
  const {name="",conf=0,stable=false}=data;
  label.textContent=`${name} ${(conf*100).toFixed(1)} %`;
  const idx=labels.indexOf(name); same=idx===last?same+1:1; last=idx;
  const ready=stable||(same>=STABLE_N&&conf>=CONF_THR);
  if(ready&&name){currentName=name;promptUser(name,conf);}else{requestAnimationFrame(loop);}
}

/* ---------- UI wiring ---------- */
function promptUser(n,c){$("#prompt-text").textContent=`Looks like ${n} (${(c*100).toFixed(1)}%). Show its stats?`;show($("#prompt"));promptVisible=true;}

$("#start").onclick=async()=>{
  if("speechSynthesis" in window)try{speechSynthesis.speak(new SpeechSynthesisUtterance(""));}catch{}
  hide($("#start")); await loadAssets();
  const cam=$("#cam");
  const openCam=async()=>{
    const ideal={facingMode:"environment",width:{ideal:1280},height:{ideal:720}};
    try{return await navigator.mediaDevices.getUserMedia({video:ideal});}
    catch{const dev=await navigator.mediaDevices.enumerateDevices();const rear=dev.find(d=>d.kind==="videoinput"&&/back/i.test(d.label));if(rear)return navigator.mediaDevices.getUserMedia({video:{deviceId:{exact:rear.deviceId},width:1280,height:720}});return navigator.mediaDevices.getUserMedia({video:true});}
  };
  try{cam.srcObject=await openCam();await cam.play();}catch(e){$("#alert").textContent=e.message;return;}
  requestAnimationFrame(loop);
};

$("#btn-stats").onclick=async()=>{
  hide($("#prompt"));promptVisible=false;
  let d={};const slug=toID(currentName);
  try{const r=await fetch(makeUrl(`api/pokemon/${slug}`));if(r.ok)d=await r.json();}catch(e){console.warn("poke fetch",e);}
  renderStats({...d,name:currentName}); show($("#stats-panel"));
  const txt=d.description||(flavor[currentName.toLowerCase()]?.[0]||""); speakText(txt);
};
$("#btn-dismiss").onclick=()=>{hide($("#prompt"));promptVisible=false;requestAnimationFrame(loop);};
$("#stats-close").onclick=()=>{hide($("#stats-panel"));requestAnimationFrame(loop);}
