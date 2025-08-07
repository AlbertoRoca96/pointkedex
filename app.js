/* ---------- tunables ---------- */
const CONF_THR = 0.20;
const STABLE_N = 3;
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
    const [flv,cls]=await Promise.all([
      fetch("flavor_text.json"),
      fetch("class_indices.json")
    ]);
    flavor = flv.ok ? await flv.json() : {};
    const classIdx = cls.ok ? await cls.json() : {};
    labels=[];
    if(classIdx && typeof classIdx==="object"){
      Object.entries(classIdx).forEach(([name,idx])=>{
        if(typeof idx==="number") labels[idx]=name;
        else if(!isNaN(+name)) labels[+name]=idx;
      });
    }
  }catch(e){console.warn("[app.js] asset preload failed:",e);}
}

/* ---------- helpers ---------- */
const $      = q => document.querySelector(q);
const show   = el=>el&&(el.style.display="flex");
const hide   = el=>el&&(el.style.display="none");
const toID   = s => (typeof s==="string"?s.toLowerCase().replace(/[^a-z0-9]/g,""):"");
const makeUrl= p => `${(window.API_BASE||"").replace(/\/+$/,"")}/${p.replace(/^\/+/,"")}`;
const debug  = (...a)=>console.debug("[app.js]",...a);

/* ---------- speech helper ---------- */
function speakText(txt){
  if(!("speechSynthesis" in window)||!txt) return;
  try{speechSynthesis.cancel();}catch{}
  speaking=true;
  const u=new SpeechSynthesisUtterance(txt);
  u.onend=u.onerror=()=>{speaking=false;requestAnimationFrame(loop);};
  speechSynthesis.speak(u);
}

/* ---------- unit converters ---------- */
const mToFtIn=dm=>{
  const inches=dm*3.937007874;
  return `${Math.floor(inches/12)}'${Math.round(inches%12)}"`;
};
const kgToLb=hg=>{
  const kg=hg/10;
  return `${kg.toFixed(1)} kg (${(kg*2.205).toFixed(1)} lb)`;
};

/* ---------- regex helpers ---------- */
const CLEAN_MOVE_RE=/^(.*?)(?:Has|User|Usually|Hits|This|Target|More|Prevents|Doubles|Burns|Lowers|Raises|$)/i;
const NATURES=["Hardy","Lonely","Brave","Adamant","Naughty","Bold","Docile","Relaxed","Impish","Lax","Timid","Hasty","Serious","Jolly","Naive","Modest","Mild","Quiet","Bashful","Rash","Calm","Gentle","Sassy","Careful","Quirky"];
const EV_RE=/^\s*\d+\s+(HP|Atk|Def|SpA|SpD|Spe)\s*$/i;
const CREDIT_RE=/^(written|quality checked|grammar checked)\b/i;

/* ---------- cleaners ---------- */
const cleanMoveName  = txt=>{const m=CLEAN_MOVE_RE.exec(txt.trim());return (m?m[1]:txt).replace(/[-–•]+$/,"").trim();};
const cleanItem      = txt=>txt.replace(/\bHolder'?s.*$/i,"").trim();
const cleanAbility   = txt=>txt.replace(/This Pokémon.*$/i,"").trim();
const cleanLineStart = txt=>txt.replace(/^[-–•\s]+/,"").trim();
const formatEV       = ev=>typeof ev==="string"
  ? ev
  : Object.entries(ev||{}).map(([k,v])=>`${v} ${k.toUpperCase()}`).join(" / ");

/* ---------- usage summary ---------- */
function renderUsageSummary(u){
  const box=$("#stats-usage");
  if(!box) return;
  box.innerHTML="";
  if(!u||(!u.moves?.length&&!u.abilities?.length&&!u.items?.length)){
    box.style.display="block";
    box.innerHTML="<div style='font-style:italic'>No competitive usage data yet.</div>";
    return;
  }
  box.style.display="block";
  ["Moves","Abilities","Items"].forEach(lbl=>{
    const arr=u[lbl.toLowerCase()];
    if(!arr?.length) return;
    const span=document.createElement("span");
    span.textContent=lbl+": ";
    box.appendChild(span);
    arr.slice(0,6).forEach(v=>{
      const tag=document.createElement("span");
      tag.className="tag";tag.textContent=v;box.appendChild(tag);
    });
    box.appendChild(document.createElement("br"));
  });
}

/* ---------- tabs ---------- */
function buildTierTabs(fullSets){
  let tabs=$("#usage-tabs"),content=$("#usage-content");
  if(!tabs){
    tabs=document.createElement("div");tabs.id="usage-tabs";tabs.className="tab-strip";
    $("#stats-panel .card").appendChild(tabs);
  }
  if(!content){
    content=document.createElement("div");content.id="usage-content";
    $("#stats-panel .card").appendChild(content);
  }
  tabs.innerHTML="";content.innerHTML="";
  const tiers=Object.keys(fullSets||{}).sort();
  if(!tiers.length) return;
  const activate=tier=>{
    tabs.querySelectorAll("button").forEach(b=>b.classList.remove("active"));
    tabs.querySelector(`button[data-tier='${tier}']`)?.classList.add("active");
    renderTierSets(fullSets[tier],content);
  };
  tiers.forEach((t,i)=>{
    const btn=document.createElement("button");
    btn.className="tab-btn";btn.dataset.tier=t;btn.textContent=t;
    btn.onclick=()=>activate(t);
    tabs.appendChild(btn);
    if(i===0) activate(t);
  });
}

/* ---------- move line parser ---------- */
function parseMoveLine(raw){
  const trimmed=cleanLineStart(raw);
  const name=cleanMoveName(trimmed);
  const desc=trimmed.slice(name.length).replace(/^[:\-–\s]+/,"").trim();
  return {name,desc};
}

/* ---------- set renderer ---------- */
function renderTierSets(list,container){
  container.innerHTML="";
  if(!Array.isArray(list)||!list.length){
    const p=document.createElement("p");
    p.style.fontStyle="italic";p.textContent="No sets for this tier.";
    container.appendChild(p);return;
  }

  const frag=document.createDocumentFragment();

  list.forEach((src,i)=>{
    const set={...src};              /* shallow clone */
    let rawMoves=[],credits=[];
    const push=lineRaw=>{
      const line=cleanLineStart(lineRaw);
      const low=line.toLowerCase();

      if(!line) return;
      if(CREDIT_RE.test(low)){credits.push(line);return;}

      if(low.startsWith("evs:")||EV_RE.test(line)){set.evs=set.evs?`${set.evs} / ${line}`:line;return;}
      if(low.startsWith("ivs:")){set.ivs=set.ivs?`${set.ivs} / ${line.slice(4).trim()}`:line.slice(4).trim();return;}

      if(NATURES.includes(line.trim())){set.nature=set.nature?`${set.nature} / ${line}`:line;return;}
      if(low.startsWith("nature:")){set.nature=line.split(":").slice(1).join(":").trim();return;}

      if(low.startsWith("ability:")){set.ability=cleanAbility(line.split(":").slice(1).join(":"));return;}
      if(/this pokemon'?s /i.test(low)){set.ability=cleanAbility(line);return;}

      if(low.startsWith("item:")||/(choice|band|scarf|boots|orb|helmet|leftovers|berry|vest|plate|seed|belt)/i.test(low)){
        const val=cleanItem(line.split(":").slice(1).join(":")||line);
        set.item=set.item?`${set.item} / ${val}`:val;return;
      }

      if(low.startsWith("tera")){const val=line.replace(/^tera( type)?:?/i,"").trim();
        set.teratypes=set.teratypes?`${set.teratypes} / ${val}`:val;return;}

      rawMoves.push(line);
    };

    (Array.isArray(set.moves)?set.moves:[]).forEach(push);

    /* dedupe + parse moves */
    const moveObjs=[...new Set(rawMoves)].map(parseMoveLine);

    if(credits.length) set.credits=[...new Set(credits)].join(" • ");

    ["item","ability","nature","teratypes"].forEach(k=>{
      if(typeof set[k]==="string") set[k]=set[k].replace(/\s*\/\s*\/\s*/g," / ");
    });

    /* ---- DOM ---- */
    const card=document.createElement("div");
    card.className="set-card";if(i>0) card.classList.add("collapsed");

    const header=document.createElement("button");
    header.className="set-header";header.type="button";
    header.innerHTML=`<span class="chev">▸</span><span>${set.name||"Set"}</span>`;
    header.onclick=()=>{
      card.classList.toggle("collapsed");
      const chev=header.querySelector(".chev");
      chev.textContent=card.classList.contains("collapsed")?"▸":"▾";
      chev.style.transform=card.classList.contains("collapsed")?"rotate(0deg)":"rotate(90deg)";
    };
    header.querySelector(".chev").style.transform=card.classList.contains("collapsed")?"rotate(0deg)":"rotate(90deg)";
    card.appendChild(header);

    const tbl=document.createElement("table");
    tbl.className="set-table";

    moveObjs.forEach(m=>{
      const trName=document.createElement("tr");
      trName.innerHTML=`<td class="move-name" colspan="2">${m.name}</td>`;
      tbl.appendChild(trName);

      if(m.desc){
        const trDesc=document.createElement("tr");
        trDesc.innerHTML=`<td class="move-desc" colspan="2">${m.desc}</td>`;
        tbl.appendChild(trDesc);
      }
    });

    const addRow=(lbl,val)=>{
      if(!val||(Array.isArray(val)&&!val.length)) return;
      const tr=document.createElement("tr");
      tr.innerHTML=`<th>${lbl}</th><td>${Array.isArray(val)?val.join(" / "):val}</td>`;
      tbl.appendChild(tr);
    };
    addRow("Item",set.item);
    addRow("Ability",set.ability);
    addRow("Nature",set.nature);
    addRow("EVs",formatEV(set.evs));
    addRow("IVs",formatEV(set.ivs));
    addRow("Tera",set.teratypes);
    addRow("Credits",set.credits);

    const body=document.createElement("div");
    body.className="set-body";body.appendChild(tbl);card.appendChild(body);
    frag.appendChild(card);
  });

  container.appendChild(frag);
}

/* toggle all */
function toggleAllSets(expand){
  $("#usage-content")?.querySelectorAll(".set-card").forEach(c=>{
    if(expand) c.classList.remove("collapsed");else c.classList.add("collapsed");
    const chev=c.querySelector(".chev");
    if(chev){
      chev.textContent=expand?"▾":"▸";
      chev.style.transform=expand?"rotate(90deg)":"rotate(0deg)";
    }
  });
}

/* ---------- stats render ---------- */
function renderStats(d){
  $("#stats-name").textContent=`${d.name}  (#${String(d.dex).padStart(4,"0")})`;
  $("#stats-desc").textContent=d.description||"";

  const types=$("#stats-types");
  if(types){
    types.innerHTML="";
    (d.types||[]).forEach(t=>{
      const s=document.createElement("span");
      s.className="type";s.textContent=t;types.appendChild(s);
    });
  }
  $("#stats-abilities").textContent=`Abilities: ${(d.abilities||[]).join(", ")}`;

  const tbl=$("#stats-table");
  if(tbl){
    tbl.innerHTML="";
    Object.entries(d.base_stats||{}).forEach(([k,v])=>{
      const tr=document.createElement("tr");
      tr.innerHTML=`<td>${k}</td><td>${v}</td>`;tbl.appendChild(tr);
    });
  }
  $("#stats-misc").textContent=`Height: ${mToFtIn(d.height)}   •   Weight: ${kgToLb(d.weight)}`;

  const slug=toID(d.name);
  fetch(makeUrl(`api/usage/${slug}`))
    .then(r=>r.ok?r.json():{})
    .then(u=>{renderUsageSummary(u);buildTierTabs(u.full_sets||{});})
    .catch(e=>console.warn("[usage] fetch error",e));
}

/* ---------- camera loop ---------- */
async function loop(){
  if(speaking||promptVisible||$("#stats-panel")?.style.display==="flex") return;
  const cam=$("#cam"),work=$("#worker"),label=$("#label");
  if(!cam||!work||!label||!cam.videoWidth) return requestAnimationFrame(loop);

  const portrait=cam.videoHeight>cam.videoWidth;
  const s=portrait?cam.videoWidth:cam.videoHeight;
  work.width=work.height=s;
  const ctx=work.getContext("2d");

  if(portrait){
    ctx.save();ctx.translate(0,s);ctx.rotate(-Math.PI/2);
    ctx.drawImage(cam,(cam.videoHeight-s)/2,(cam.videoWidth-s)/2,s,s,0,0,s,s);
    ctx.restore();
  }else{
    ctx.drawImage(cam,(cam.videoWidth-s)/2,(cam.videoHeight-s)/2,s,s,0,0,s,s);
  }

  const jpeg=work.toDataURL("image/jpeg",JPEG_QUAL);
  if(predictController) predictController.abort();
  predictController=new AbortController();

  let data={};
  try{
    const res=await fetch(makeUrl("api/predict"),{
      method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({image:jpeg}),signal:predictController.signal
    });
    if(!res.ok) return requestAnimationFrame(loop);
    data=await res.json();
  }catch(e){
    if(e.name!=="AbortError") console.warn("[predict] network/parse error",e);
    return requestAnimationFrame(loop);
  }

  const {name="",conf=0,stable=false}=data;
  label.textContent=`${name} ${(conf*100).toFixed(1)} %`;
  const idx=labels.indexOf(name);
  same=idx===last?same+1:1;last=idx;
  const ready=stable||(same>=STABLE_N&&conf>=CONF_THR);
  if(ready&&name){currentName=name;promptUser(name,conf);}
  else requestAnimationFrame(loop);
}

/* ---------- prompt ---------- */
function promptUser(n,c){
  $("#prompt-text").textContent=`Looks like ${n} (${(c*100).toFixed(1)}%). Show its stats?`;
  show($("#prompt"));promptVisible=true;
}

/* ---------- main ---------- */
$("#start").onclick=async()=>{
  if("speechSynthesis" in window) try{speechSynthesis.speak(new SpeechSynthesisUtterance(""));}catch{}
  hide($("#start"));await loadAssets();

  const cam=$("#cam");
  const openCam=async()=>{
    const ideal={facingMode:"environment",width:{ideal:1280},height:{ideal:720}};
    try{return await navigator.mediaDevices.getUserMedia({video:ideal});}
    catch{
      const dev=await navigator.mediaDevices.enumerateDevices();
      const rear=dev.find(d=>d.kind==="videoinput"&&/back/i.test(d.label));
      if(rear) return navigator.mediaDevices.getUserMedia({
        video:{deviceId:{exact:rear.deviceId},width:1280,height:720}});
      return navigator.mediaDevices.getUserMedia({video:true});
    }
  };
  try{cam.srcObject=await openCam();await cam.play();}
  catch(e){$("#alert").textContent=e.message;return;}
  requestAnimationFrame(loop);
};

$("#btn-stats").onclick=async()=>{
  hide($("#prompt"));promptVisible=false;
  const slug=toID(currentName);
  let d={};
  try{
    const r=await fetch(makeUrl(`api/pokemon/${slug}`));
    if(r.ok) d=await r.json(); else console.warn("pokemon fetch failed",r.status);
  }catch(e){console.warn("pokemon fetch error",e);}
  renderStats({...d,name:currentName});
  show($("#stats-panel"));
  const txt=d.description||(flavor[currentName.toLowerCase()]?.[0]||"");
  speakText(txt);
};

$("#btn-dismiss").onclick=()=>{hide($("#prompt"));promptVisible=false;requestAnimationFrame(loop);};
$("#stats-close").onclick=()=>{hide($("#stats-panel"));requestAnimationFrame(loop);};

/* ---------- keyboard shortcuts ---------- */
document.addEventListener("keydown",e=>{
  if(e.key==="Escape" && $("#stats-panel")?.style.display==="flex") $("#stats-close").click();
  if(e.key==="ArrowLeft"||e.key==="[")  toggleAllSets(false);
  if(e.key==="ArrowRight"||e.key==="]") toggleAllSets(true);
});
