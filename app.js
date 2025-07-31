/* ---------- tunables ---------- */
const CONF_THR = 0.20;
const STABLE_N = 3;
const RESUME_MS = 6000;
const JPEG_QUAL = 0.85;

/* ---------- globals ---------- */
let flavor = {}, labels = [];
let last = -1, same = 0, speaking = false;
let currentName = "";

/* ---------- preload assets ---------- */
(async () => {
  flavor = await fetch("flavor_text.json").then(r => r.json());
  labels = Object.entries(await fetch("class_indices.json").then(r => r.json()))
                 .reduce((arr,[n,i]) => (arr[i]=n,arr),[]);
})();

/* ---------- UI helpers ---------- */
const $ = sel => document.querySelector(sel);
const show = el => el.style.display = "flex";
const hide = el => el.style.display = "none";

const alertBox = msg => { $("#alert").textContent = msg; $("#alert").style.display="block"; };

const renderStats = data => {
  $("#stats-name").textContent = data.name || currentName;
  $("#stats-desc").textContent = data.description || "";
  const typeBox = $("#stats-types");
  typeBox.innerHTML = "";
  (data.types||[]).forEach(t=>{
    const span=document.createElement("span");
    span.className="type";
    span.textContent=t;
    typeBox.appendChild(span);
  });
  const tbl = $("#stats-table");
  tbl.innerHTML = "";
  if(data.base_stats){
    Object.entries(data.base_stats).forEach(([k,v])=>{
      const tr=document.createElement("tr");
      tr.innerHTML=`<td>${k}</td><td>${v}</td>`;
      tbl.appendChild(tr);
    });
  }
  $("#stats-misc").textContent = `Height: ${data.height}   Weight: ${data.weight}`;
};

/* ---------- main entry ---------- */
$("#start").onclick = async () => {
  if ("speechSynthesis" in window) try{ speechSynthesis.speak(new SpeechSynthesisUtterance("")); }catch{}
  $("#start").style.display="none";

  const cam   = $("#cam");
  const work  = $("#worker");
  const label = $("#label");
  const endpoint = (window.API_BASE||"")+"api/predict";

  async function openCamera(){
    const ideal={facingMode:"environment",width:{ideal:1280},height:{ideal:720}};
    try{return await navigator.mediaDevices.getUserMedia({video:ideal});}
    catch{
      const devs=await navigator.mediaDevices.enumerateDevices();
      const rear=devs.find(d=>d.kind==="videoinput"&&/back/i.test(d.label));
      if(!rear)throw new Error("no rear camera");
      return navigator.mediaDevices.getUserMedia({video:{deviceId:{exact:rear.deviceId},width:1280,height:720}});
    }
  }
  try{ cam.srcObject=await openCamera(); await cam.play(); }catch(e){ alertBox("❌ camera error (“"+e.message+"”)"); return; }

  requestAnimationFrame(loop);

  async function loop(){
    if(speaking||$("#prompt").style.display==="flex"||$("#stats-panel").style.display==="flex")return;
    if(!cam.videoWidth||!cam.videoHeight){return requestAnimationFrame(loop);}

    const portrait=cam.videoHeight>cam.videoWidth;
    const s=portrait?cam.videoWidth:cam.videoHeight;
    work.width=work.height=s;
    const ctx=work.getContext("2d");
    if(portrait){
      ctx.save(); ctx.translate(0,s); ctx.rotate(-Math.PI/2);
      ctx.drawImage(cam,(cam.videoHeight-s)/2,(cam.videoWidth-s)/2,s,s,0,0,s,s);
      ctx.restore();
    }else{
      ctx.drawImage(cam,(cam.videoWidth-s)/2,(cam.videoHeight-s)/2,s,s,0,0,s,s);
    }

    const jpeg=work.toDataURL("image/jpeg",JPEG_QUAL);
    let res;
    try{ res=await fetch(endpoint,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({image:jpeg})}); }
    catch{ alertBox("❌ network error"); return;}
    if(!res.ok){ alertBox("API error"); return;}

    const {name,conf,stable}=await res.json();
    label.textContent=`${name}  ${(conf*100).toFixed(1)} %`;

    const idx=labels.indexOf(name);
    same=(idx===last?same+1:1); last=idx;
    const shouldPrompt = stable===true ? stable : (same>=STABLE_N && conf>=CONF_THR);
    if(shouldPrompt){ currentName=name; promptUser(name,conf); }
    else requestAnimationFrame(loop);
  }

  function promptUser(name,conf){
    $("#prompt-text").textContent=`Looks like ${name} (${(conf*100).toFixed(1)}%). Show its stats?`;
    show($("#prompt"));
  }

  /* ---------- prompt buttons ---------- */
  $("#btn-stats").onclick = async ()=>{
    hide($("#prompt"));
    try{
      const data=await fetch(`${window.API_BASE}api/pokemon/${currentName.toLowerCase()}`).then(r=>r.json());
      renderStats({...data,name:currentName});
      show($("#stats-panel"));
      if("speechSynthesis"in window){
        const speakTxt=data.description||flavor[currentName.toLowerCase()]?.[0]||"";
        if(speakTxt){
          speaking=true;
          const u=new SpeechSynthesisUtterance(speakTxt);
          u.onend=u.onerror=()=>{speaking=false; requestAnimationFrame(loop);};
          speechSynthesis.speak(u);
        }
      }
    }catch(e){
      alertBox("Failed to fetch stats");
      requestAnimationFrame(loop);
    }
  };
  $("#btn-dismiss").onclick = ()=>{ hide($("#prompt")); requestAnimationFrame(loop); };

  $("#stats-close").onclick = ()=>{ hide($("#stats-panel")); requestAnimationFrame(loop); };
};
