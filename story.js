/* iwi2me · « Notre histoire » : lecteur d'animation (pixel art 8 bits, sons WebAudio, sans dépendance).
   Le DÉROULÉ (textes, étapes) n'est PAS dans ce fichier : il vient de la base (privée), fiche par fiche.
   Utilisation : Story.open(fiche, { from: n, onClose: fn }) ; from = numéro d'étape (timecode) où démarrer. */
"use strict";
window.Story = (function () {
  let current = null;
  function open(SHEET, opts) {
    opts = opts || {};
    if (current) current.close();
    // polices pixel / BD (chargées seulement ici ; l'animation reste lisible sans elles)
    if (!document.getElementById("story-fonts")) {
      const l = document.createElement("link"); l.id = "story-fonts"; l.rel = "stylesheet";
      l.href = "https://fonts.googleapis.com/css2?family=Press+Start+2P&family=Comic+Neue:wght@700&display=swap";
      document.head.appendChild(l);
    }
    const root = document.createElement("div"); root.id = "story"; root.innerHTML = `<div id="stage">
  <div id="bg"></div><div id="back"></div><div id="tablel"></div><div id="front"></div><div id="fx"></div><div id="bub"></div>
  <div id="hud"><div id="place" class="pill"></div><div id="clock" class="pill"></div></div>
  <div id="cap"></div>
  <div id="phone" class="ov"><div class="pframe"><div class="phead"><span class="av" id="pav"></span><b id="pname"></b><span id="ptime" style="margin-left:auto;font-size:9px;opacity:.7"></span></div><div class="pbody" id="pbody"></div></div></div>
  <div id="zoom" class="ov"><span id="zemo"></span></div>
  <div id="battle"></div>
  <div id="fade"></div>
  <div id="quest"></div>
  <div id="end" class="ov"><div class="k">À SUIVRE…</div><h2 id="endT" style="margin:18px 0 14px;font-size:14px;line-height:1.6;font-weight:400"></h2><div id="endS" style="opacity:.85;font-size:8px;line-height:1.9;margin-bottom:30px"></div><button class="btn" id="again">↻ REJOUER</button><button class="btn" id="endClose" style="margin-top:16px;background:#C9A8FF">✕ FERMER</button></div>
  <div id="hint">TOUCHER POUR CONTINUER</div>
  <div class="ctl" id="bQuit" title="Quitter">✕</div><div class="ctl" id="bMute" title="Son">🔊</div><div class="ctl" id="bSkip" title="Passer">⏭</div>
</div>`;
    document.body.appendChild(root);
    const prevOverflow = document.body.style.overflow; document.body.style.overflow = "hidden";
    let START_AT = Math.max(0, +opts.from || 0);
    const RT = root;
    const esc = (t) => String(t == null ? "" : t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    let closeFn = () => {};
    function close() { closeFn(); }
    // ======================= moteur =======================

/* =====================================================================
   MOTEUR « Notre histoire » — aperçu chapitre 1, étapes 1 à 28
   - Personnages en SVG (même style que l'illustration d'accueil)
   - Un toucher n'importe où = étape suivante ; les étapes AUTO avancent seules
   - Sons synthétisés (WebAudio), aucun fichier externe
   ===================================================================== */
const OUT="#2B1646", S=.85;                  // contour + échelle des personnages
const $=s=>RT.querySelector(s);
const stage=$("#stage");
let FAST=START_AT>0;                          // on « rejoue en accéléré » les étapes avant le timecode choisi

/* ---------- mise à l'échelle de l'écran ---------- */
function fit(){const k=Math.min(innerWidth/390,innerHeight/760);stage.style.transform="scale("+k+")"}
addEventListener("resize",fit);fit();

/* ---------- SONS (WebAudio) ---------- */
let ctx=null,master=null,muted=false,amb=null;
function actx(){
  if(!ctx){ctx=new(window.AudioContext||window.webkitAudioContext)();master=ctx.createGain();master.gain.value=muted?0:1;master.connect(ctx.destination)}
  if(ctx.state==="suspended")ctx.resume();return ctx;
}
function tone(f,t=0,d=.1,type="square",v=.05,f2){
  if(FAST||!ctx)return;
  try{const c=ctx,o=c.createOscillator(),g=c.createGain(),t0=c.currentTime+t;
    o.type=type;o.frequency.setValueAtTime(f,t0);if(f2)o.frequency.exponentialRampToValueAtTime(f2,t0+d);
    g.gain.setValueAtTime(0,t0);g.gain.linearRampToValueAtTime(v,t0+.012);g.gain.exponentialRampToValueAtTime(.0001,t0+d);
    o.connect(g);g.connect(master);o.start(t0);o.stop(t0+d+.05)}catch(e){}
}
const SFX={
  blip(f){tone(f,0,.045,"square",.035)},
  pop(){tone(740,0,.08,"triangle",.07);tone(1180,.07,.1,"triangle",.07)},
  quest(){[523,659,784,1047].forEach((f,i)=>tone(f,i*.11,.2,"square",.05));tone(1319,.5,.7,"triangle",.07)},
  ding(){tone(1318,0,.35,"sine",.09);tone(1760,.12,.5,"sine",.07)},
  send(){tone(500,0,.12,"triangle",.06,1100)},
  plot(){tone(262,0,.16,"sawtooth",.06);tone(247,.18,.16,"sawtooth",.06);tone(196,.36,.18,"sawtooth",.06);tone(110,.56,.8,"sawtooth",.08,70)},
  door(){tone(660,0,.1,"sine",.06);tone(880,.1,.18,"sine",.06)},
  mwa(){tone(900,0,.06,"sine",.05,1500)},
  flick(){tone(1800,0,.03,"square",.04);tone(1200,.05,.05,"square",.04);tone(300,.1,.18,"sawtooth",.025)},
  sting(){tone(392,0,.12,"square",.05);tone(370,.12,.12,"square",.05);tone(311,.24,.4,"square",.06)},
  swoosh(){tone(300,0,.25,"sine",.04,900)},
  jingle(){[330,392,494,659,494,659,784].forEach((f,i)=>tone(f,i*.09,.12,"square",.05));tone(988,.7,.35,"square",.05)},
  hit(){tone(180,0,.15,"sawtooth",.08,60);tone(90,.05,.2,"square",.06)},
  crit(){tone(1046,0,.08,"square",.05);tone(1046,.13,.08,"square",.05)},
  heal(){[523,659,784,1047,1319].forEach((f,i)=>tone(f,i*.07,.12,"triangle",.06))},
  zap(){tone(1200,0,.25,"sawtooth",.05,300)},
  flee(){tone(700,0,.4,"square",.05,160)},
  win(){[523,523,523,659,784,1047].forEach((f,i)=>tone(f,i*.1,.14,"square",.05))}
};
function ambience(on){                       // petit brouhaha de terrasse, très doux
  if(FAST||!ctx)return;
  if(!on){if(amb){try{amb.stop()}catch(e){}amb=null}return}
  if(amb)return;
  const b=ctx.createBuffer(1,ctx.sampleRate*2,ctx.sampleRate),d=b.getChannelData(0);
  for(let i=0;i<d.length;i++)d[i]=Math.random()*2-1;
  const s=ctx.createBufferSource();s.buffer=b;s.loop=true;
  const f=ctx.createBiquadFilter();f.type="bandpass";f.frequency.value=420;f.Q.value=.5;
  const g=ctx.createGain();g.gain.value=.035;
  s.connect(f);f.connect(g);g.connect(master);s.start();amb=s;
}


/* ---------- MUSIQUE DE COMBAT (chiptune originale, boucle) ---------- */
const BGM={timer:null,next:0,step:0,on:false};
const mf=m=>440*Math.pow(2,(m-69)/12);
function toneAt(f,t0,d,type,v,f2){
  if(!ctx)return;
  try{const c=ctx,o=c.createOscillator(),g=c.createGain();
    o.type=type;o.frequency.setValueAtTime(f,t0);if(f2)o.frequency.exponentialRampToValueAtTime(f2,t0+d);
    g.gain.setValueAtTime(0,t0);g.gain.linearRampToValueAtTime(v,t0+.01);g.gain.exponentialRampToValueAtTime(.0001,t0+d);
    o.connect(g);g.connect(master);o.start(t0);o.stop(t0+d+.05)}catch(e){}
}
const LEAD=[ [69,0,72,0,76,0,72,0,69,0,72,0,76,79,76,72],
             [69,0,72,0,77,0,72,0,69,0,72,0,77,81,77,72],
             [71,0,74,0,79,0,74,0,71,74,79,83,79,74,71,0],
             [68,0,71,0,76,0,71,0,68,71,76,80,76,71,68,0] ];
const ROOT=[45,41,43,40];                       // La, Fa, Sol, Mi (graves)
function bgmStep(t,i){                          // i = numéro de double-croche depuis le début
  const D=.095;
  if(i<16){                                     // intro : la basse monte et grossit = l'attaque approche
    const m=33+i*.75,v=.012+i*.0017;
    toneAt(mf(m),t,D*1.2,"square",v);if(i%4===0)toneAt(120,t,.1,"sine",.05,45);
    if(i>=8)toneAt(mf(m+12),t,D,"triangle",v*.8);
    return}
  const j=i-16,bar=Math.floor(j/16)%4,k=j%16,r=ROOT[bar];
  toneAt(mf(r+(k%4===2?12:0)),t,D*1.1,"triangle",.07);               // basse qui galope
  const n=LEAD[bar][k];if(n)toneAt(mf(n),t,D*1.5,"square",.028);       // mélodie
  if(k%4===0)toneAt(130,t,.11,"sine",.09,40);                         // grosse caisse
  if(k%8===4)toneAt(900,t,.07,"sawtooth",.025,300);                   // caisse claire
  if(k%2===1)toneAt(5000,t,.02,"square",.008);                        // charleston
}
function bgmStart(){
  if(BGM.on||!ctx||FAST)return;BGM.on=true;BGM.step=0;BGM.next=ctx.currentTime+.1;
  BGM.timer=setInterval(()=>{while(BGM.next<ctx.currentTime+.5){bgmStep(BGM.next,BGM.step++);BGM.next+=.095}},120);
}
function bgmStop(){BGM.on=false;clearInterval(BGM.timer);BGM.timer=null}

/* ---------- ATTENTES (tap / pause) ---------- */
let token=0,tapRes=null,skipFn=null;
let paused=false;                            // animation en pause (onglet / appli en arrière-plan)
function tmo(fn,ms){let left=ms,id=setInterval(()=>{if(paused)return;left-=50;if(left<=0){clearInterval(id);fn()}},50);return id}  // comme setTimeout, mais le compte à rebours s'arrête en pause
const AUTO_MS=5000;                          // 5 s sans action : la suite se lance seule, l'histoire ne s'arrête JAMAIS
let lastMove=Date.now(),pendingChoice=null;  // dernier signe de vie + choix de menu en attente (pour le chien de garde)
function aborted(my){if(my!==token)throw"abort"}
function sleep(ms){
  const my=token;lastMove=Date.now();
  return new Promise(res=>{
    if(FAST)return res();
    let t=tmo(done,ms);
    function done(){clearTimeout(t);skipFn=null;res()}
    skipFn=done;
  }).then(()=>aborted(my));
}
function tap(){
  const my=token;lastMove=Date.now();
  if(FAST)return Promise.resolve();
  hint(true);
  return new Promise(res=>{
    const auto=tmo(()=>{if(tapRes)tapRes()},AUTO_MS);          // personne ne touche : la suite se lance seule
    tapRes=()=>{clearTimeout(auto);tapRes=null;res()};
  }).then(()=>{hint(false);aborted(my)});
}
const wd=setInterval(()=>{                    // chien de garde
  if(paused){lastMove=Date.now();return}      // en pause : on ne force rien (attente de toucher, de choix ou de texte sinon)
  if(Date.now()-lastMove<AUTO_MS+400)return;
  lastMove=Date.now();
  if(typing)typing();else if(tapRes)tapRes();else if(pendingChoice)pendingChoice();else if(skipFn)skipFn();
},1000);
function hint(on){$("#hint").style.opacity=on?.55:0}
stage.addEventListener("pointerdown",e=>{
  if(e.target.closest(".ctl")||e.target.closest(".btn")||e.target.closest(".mbtn"))return;
  if(typing){typing();return}                // 1er toucher = afficher tout le texte
  if(tapRes){SFX.blip(660);tapRes()}
});
$("#bSkip").onclick=()=>{if(typing)typing();else if(tapRes)tapRes();else if(skipFn)skipFn()};
$("#bMute").onclick=()=>{muted=!muted;if(master)master.gain.value=muted?0:1;$("#bMute").textContent=muted?"🔇":"🔊"};
$("#bQuit").onclick=()=>close();

/* ---------- PERSONNAGES PIXEL (grille 32×49, 1 case = P pixels d'écran) ---------- */
const P=5,GW=32,GH=49,HY=12,TY=HY+15,DK="#0f0c12";
function sprite(a){
  const g={},e={},isN=a.kind==="nelson",isS=a.kind==="sophie",isE=a.kind==="extra",m=!isN;       // m : miroir du bras à cigarette (Sophie)
  const skin=isE?a.skin:isN?"#A9693F":"#BC7E57",shade=isE?(a.shade||"#00000033"):isN?"#864F2F":"#9A6140";
  const shirt=isE?a.top:"#F4F4FA";
  const px=(x,y,c)=>{g[x+","+y]=c},ex=(x,y,c)=>{e[x+","+y]=c};
  const rc=(x,y,w,h,c,f=px)=>{for(let j=0;j<h;j++)for(let i=0;i<w;i++)f(x+i,y+j,c)};
  const mx=(x,w=1)=>m?GW-x-w:x;                        // miroir horizontal
  const hair=isE?a.hair:isN?"#1A1410":"#2B1B1B",hl=isN?"#4a3f3a":"#6A4A4A";
  // --- jambes (sauf assis : la table les cache)
  if(!a.sit){
    rc(10,TY+12,5,6,"#0B0B0B");rc(17,TY+12,5,6,"#0B0B0B");
    if(isN){rc(9,TY+18,6,2,"#14121A");rc(17,TY+18,6,2,"#14121A");rc(9,TY+19,3,1,"#fff");rc(20,TY+19,3,1,"#fff");rc(9,TY+20,6,1,"#fff");rc(17,TY+20,6,1,"#fff")}
    else{rc(9,TY+18,6,2,"#14121A");rc(17,TY+18,6,2,"#14121A");px(12,TY+18,"#C9A24A");px(19,TY+18,"#C9A24A")}
  }
  // --- cheveux de derrière (Sophie) + chignon
  if(isE&&a.long){rc(7,HY-1,18,12,hair)}
  if(isS){
    rc(7,HY-1,18,8,hair);rc(7,HY+7,2,4,hair);rc(23,HY+7,2,4,hair);px(7,HY+2,hl);px(24,HY+4,hl);
    rc(12,HY-6,8,4,hair);rc(13,HY-7,6,6,hair);px(14,HY-6,hl);px(15,HY-6,hl);px(17,HY-5,hl);
    rc(13,HY-2,6,1,"#FF8A3D");
  }
  // --- torse
  rc(14,HY+14,4,2,shade);
  if(isN){
    rc(9,TY,14,12,"#1A1A1A");rc(21,TY+3,2,9,"#111111");rc(9,TY+1,1,5,skin);rc(22,TY+1,1,5,skin);
    rc(12,TY,8,1,skin);rc(13,TY+1,6,1,skin);rc(14,TY+2,4,1,skin);   // débardeur hippie : col échancré, emmanchures larges
    // (débardeur tout noir : pas de motif)
  }else{
    rc(9,TY,14,12,shirt);rc(21,TY,2,12,"#00000022");rc(14,TY,4,1,skin);rc(15,TY+1,2,1,skin);
    if(isE&&a.apron){rc(10,TY+4,12,8,"#F4F4FA");rc(10,TY+12,12,6,"#F4F4FA");rc(10,TY+4,12,1,"#D0D0E2");rc(10,TY+17,12,1,"#D0D0E2");rc(15,TY+7,2,2,"#E5322D")}   // tablier blanc
    if(isS){px(13,TY,"#CFC8E0");px(18,TY,"#CFC8E0");for(const y of[4,7,10])px(15,TY+y,"#CFC8E0")}
  }
  // --- bras
  const sl=isN?skin:shirt;                          // haut de bras : peau (Nelson) / manche (Sophie)
  const arm=(f,mir)=>{                                  // f = dessin pour le bras gauche, mir = miroir
    const X=(x,w=1)=>mir?GW-x-w:x;
    if(f==="down"){rc(X(6,3),TY,3,5,sl);rc(X(6,3),TY+5,3,5,skin);if(isS)rc(X(6,3),TY+4,3,1,"#DAD6EA");rc(X(6,3),TY+10,3,2,skin)}
    if(f==="phone"){rc(X(6,3),TY,3,6,sl);if(isS)rc(X(6,3),TY+5,3,1,"#DAD6EA");rc(mir?X(7,6):7,TY+6,6,3,skin)}
  };
  if(a.pose==="phone"){
    arm("phone",false);arm("phone",true);
    rc(14,TY+3,4,7,"#14121A");rc(15,TY+4,2,5,"#8FD0FF");
  }else if(a.pose==="cig"){
    arm("down",m?false:true);                          // l'autre bras reste le long du corps
    rc(mx(23,3),TY,3,4,sl);rc(mx(25,2),HY+13,2,TY-HY-10,skin);rc(mx(24,3),HY+10,3,3,skin);
    rc(mx(19,6),HY+11,6,1,"#fff");rc(mx(19,2),HY+11,2,1,"#FF8A3D");
  }else if(a.pose==="chin"){                          // coude sur la table, menton dans la main
    arm("down",false);
    rc(23,TY,3,11,skin);rc(22,TY+7,3,4,skin);rc(20,TY+4,3,4,skin);rc(18,TY+1,3,4,skin);rc(16,TY-2,4,4,skin);
  }else{arm("down",false);arm("down",true)}
  // --- tête
  for(let r=0;r<14;r++){const x0=(r===0||r===13)?10:(r===1||r===12)?9:8,x1=(r===0||r===13)?21:(r===1||r===12)?22:23;
    rc(x0,HY+r,x1-x0+1,1,skin)}
  rc(22,HY+3,2,9,shade);rc(10,HY+13,12,1,shade);px(7,HY+7,skin);px(7,HY+8,skin);px(24,HY+7,skin);px(24,HY+8,skin);
  if(isN){px(7,HY+9,"#D8DEE9");px(6,HY+10,"#D8DEE9");px(7,HY+11,"#D8DEE9")}   // anneau à l'oreille
  // --- cheveux de devant
  if(isN){ // taper court : dessus ras, côtés dégradés
    rc(10,HY-1,12,3,hair);rc(9,HY+1,14,1,hair);px(12,HY-1,hl);px(13,HY-1,hl);px(14,HY-1,hl);
    rc(8,HY+1,2,2,"#3a2a20");rc(22,HY+1,2,2,"#3a2a20");rc(8,HY+3,2,2,"#5a3c2b");rc(22,HY+3,2,2,"#5a3c2b");rc(8,HY+5,1,1,"#74503a");rc(23,HY+5,1,1,"#74503a");}
  else if(isE){rc(9,HY-1,14,3,hair);rc(8,HY+1,2,4,hair);rc(22,HY+1,2,4,hair);rc(10,HY+2,12,1,hair)}
  else{rc(9,HY,14,2,hair);for(let x=9;x<=22;x++){if(x%3!==0)px(x,HY+2,hair);if(x%4===0)px(x,HY+3,hair)}px(11,HY,hl);px(17,HY,hl);px(20,HY+1,hl)}
  // --- visage
  const br=isN?"#1A1410":"#2B1B1B",dk=DK;
  const brows=(y)=>{rc(10,y,4,1,br);rc(18,y,4,1,br)};
  const eyesN=()=>{rc(11,HY+6,2,3,dk,ex);rc(19,HY+6,2,3,dk,ex);ex(11,HY+6,"#fff");ex(19,HY+6,"#fff")};
  const eyesH=()=>{for(const x0 of[10,18]){ex(x0,HY+8,dk);ex(x0+1,HY+7,dk);ex(x0+2,HY+7,dk);ex(x0+3,HY+8,dk)}};
  const bl=()=>{rc(9,HY+9,3,2,"#FF8FB5");rc(20,HY+9,3,2,"#FF8FB5")};
  const smile=()=>{px(14,HY+10,dk);px(15,HY+11,dk);px(16,HY+11,dk);px(17,HY+10,dk)};
  switch(a.expr){
    case"happy":eyesH();brows(HY+4);smile();bl();break;
    case"laugh":eyesH();brows(HY+4);rc(14,HY+10,4,3,dk);rc(14,HY+10,4,1,"#fff");rc(15,HY+12,2,1,"#E8478C");bl();break;
    case"shock":rc(10,HY+5,4,5,"#fff",ex);rc(18,HY+5,4,5,"#fff",ex);rc(12,HY+6,2,3,dk,ex);rc(18,HY+6,2,3,dk,ex);brows(HY+3);rc(15,HY+10,2,2,dk);break;
    case"think":rc(10,HY+5,3,4,"#fff",ex);rc(19,HY+5,3,4,"#fff",ex);rc(11,HY+5,2,2,dk,ex);rc(19,HY+5,2,2,dk,ex);rc(10,HY+3,4,1,br);rc(18,HY+2,4,1,br);rc(15,HY+11,3,1,dk);break;
    case"shy":eyesN();brows(HY+4);rc(14,HY+11,4,1,dk);bl();break;
    default:eyesN();brows(HY+4);smile();
  }
  // --- contour automatique + export SVG
  const has=(x,y)=>(x+","+y) in g;
  const ol=[];
  for(let y=-1;y<=GH;y++)for(let x=-1;x<=GW;x++)
    if(!has(x,y)&&(has(x-1,y)||has(x+1,y)||has(x,y-1)||has(x,y+1)))ol.push([x,y]);
  const svgRects=(map,extra="")=>{
    let out="";const rows={};
    for(const k in map){const[x,y]=k.split(",").map(Number);(rows[y]=rows[y]||[]).push([x,map[k]])}
    for(const y in rows){const r=rows[y].sort((p,q)=>p[0]-q[0]);let i=0;
      while(i<r.length){let j=i;while(j+1<r.length&&r[j+1][0]===r[j][0]+1&&r[j+1][1]===r[i][1])j++;
        out+=`<rect x="${r[i][0]}" y="${y}" width="${j-i+1}" height="1" fill="${r[i][1]}"/>`;i=j+1}}
    return out;
  };
  let o=ol.map(([x,y])=>`<rect x="${x}" y="${y}" width="1" height="1" fill="${DK}"/>`).join("");
  let smoke="";
  if(a.pose==="cig")smoke=`<g class="smoke">${[0,1,2].map(i=>`<rect x="${mx(18-i,1)}" y="${HY+9-i}" width="1" height="1" fill="#fff"/>`).join("")}</g>`;
  return `<svg viewBox="-1 -1 ${GW+2} ${GH+2}" width="${(GW+2)*(a.px||P)}" height="${(GH+2)*(a.px||P)}" shape-rendering="crispEdges"><g class="bob" style="animation-delay:${isN?0:.4}s">${o}${svgRects(g)}<g class="blink">${svgRects(e)}</g>${smoke}</g></svg>`;
}

/* ---------- ACTEURS ---------- */
const A={};                                  // id -> {kind,x,y,sit,pose,expr,el}
const back=$("#back"),front=$("#front"),fx=$("#fx"),bub=$("#bub");
function renderActor(a){a.el.innerHTML=sprite(a)}
function place(a,ms=0){
  a.el.style.setProperty("--d",(FAST?0:ms/1000)+"s");
  const q=a.px||P;a.el.style.transform=`translate(${a.x-17*q}px,${a.y-20*q}px)`;   // centre de la tête
}
function addActor(id,kind,o){
  const a=Object.assign({kind,x:195,y:450,sit:false,pose:"down",expr:"neutral"},o);
  a.el=document.createElement("div");a.el.className="actor";A[id]=a;
  renderActor(a);place(a,0);(a.sit?back:front).appendChild(a.el);
}
function set(id,p){
  const a=A[id];Object.assign(a,p);renderActor(a);
  (a.sit?back:front).appendChild(a.el);
}
async function walk(id,x,y,ms){
  const a=A[id];a.x=x;a.y=y;a.el.classList.add("walking");place(a,ms);
  await sleep(ms);a.el.classList.remove("walking");
}
const topOf=a=>a.y-(a.kind==="sophie"?14:8)*P-8;   // haut de la tête (chignon compris)

/* ---------- BULLES ---------- */
let typing=null,cur=[];
function clearBub(){cur.forEach(b=>b.remove());cur=[]}
function mkBubble(id,html,cls){
  const a=A[id],b=document.createElement("div");
  b.className="bubble "+cls+" "+id;b.innerHTML=html+'<i class="t1"></i><i class="t2"></i>';
  b.style.visibility="hidden";b.style.left="0px";bub.appendChild(b);
  const w=b.offsetWidth,left=Math.max(10,Math.min(390-w-10,a.x-w/2));
  b.style.left=left+"px";b.style.setProperty("--tx",Math.max(20,Math.min(w-20,a.x-left))+"px");
  b.style.bottom=(760-topOf(a)+(cls.includes("think")?40:22))+"px";b.style.visibility="visible";
  cur.push(b);return b;
}
async function say(id,text,think=false){
  clearBub();
  const prevExpr=A[id].expr,prevPose=A[id].pose;
  if(think)set(id,id==="nelson"?{expr:"think",pose:"chin"}:{expr:"think"});   // il pense : regard en l'air + coude sur la table
  else if(prevPose==="chin")set(id,{pose:"down"});                            // il parle : il se redresse
  const name=id==="nelson"?"NELSON":"SOPHIE";
  const b=mkBubble(id,`<span class="chip">${think?name+" PENSE…":name}</span><br><span class="tx">${text}</span>`,think?"think":"say");
  const tx=b.querySelector(".tx"),my=token;
  b.style.width=b.offsetWidth+"px";b.style.minHeight=b.offsetHeight+"px";tx.textContent="";   // taille fixée sur le texte complet
  await new Promise(res=>{
    if(FAST){tx.textContent=text;return res()}
    let i=0,done=false;
    const fin=()=>{if(done)return;done=true;clearInterval(iv);tx.textContent=text;typing=null;res()};
    const iv=setInterval(()=>{
      if(paused)return;
      i++;tx.textContent=text.slice(0,i);
      if(i%2===0)SFX.blip((id==="nelson"?250:420)+Math.random()*60);
      if(i>=text.length)fin();
    },think?24:30);
    typing=fin;
  });
  aborted(my);
  b.insertAdjacentHTML("beforeend",'<span class="more">▼</span>');
  await tap();
  b.remove();cur=cur.filter(x=>x!==b);
  if(think)set(id,{expr:prevExpr,pose:prevPose});
}
function emote(id,html,cls="",ms=900,dx=0,dy=0){
  const a=A[id],e=document.createElement("div");
  e.className="emote "+cls;e.innerHTML=html;fx.appendChild(e);
  e.style.left=(a.x+dx-10)+"px";e.style.top=(topOf(a)+dy-46)+"px";
  if(ms)setTimeout(()=>e.remove(),ms);return e;
}
function sparkles(x,y,n=4){
  for(let i=0;i<n;i++){const e=document.createElement("div");e.className="emote fl";e.textContent=["✦","✧","♥"][i%3];e.style.cssText=`left:${x+(i-n/2)*18}px;top:${y+(i%2)*10}px;font-size:18px;color:#FFD54A;animation-delay:${i*.1}s`;fx.appendChild(e);setTimeout(()=>e.remove(),1700)}
}

/* ---------- HUD : lieu + heure ---------- */
const clock=$("#clock"),placeEl=$("#place");
function setPlace(t){placeEl.textContent="📍 "+t;placeEl.classList.add("on")}
function setClock(t){clock.textContent=t;clock.classList.add("on")}
const toMin=t=>{const[h,m]=t.split("h");return+h*60+ +m};
const fmt=m=>String(Math.floor(m/60)).padStart(2,"0")+"h"+String(m%60).padStart(2,"0");
async function lapse(from,to,ms,light){
  const a=toMin(from),b=toMin(to),my=token,n=b-a;
  if(FAST){setClock(to);if(light!=null)setLight(light[1]);return}
  for(let i=0;i<=n;i++){setClock(fmt(a+i));if(light)setLight(light[0]+(light[1]-light[0])*i/n);await sleep(ms/(n+1))}
  aborted(my);
}

/* ---------- DÉCORS ---------- */
/* décor : dessiné en vectoriel puis réduit en gros pixels (look 8 bits) */
function pixelize(svg,scale,target){
  const w=Math.round(390/scale),h=Math.round(760/scale),img=new Image();
  return new Promise(res=>{
    img.onload=()=>{const c=document.createElement("canvas");c.width=w;c.height=h;
      c.getContext("2d").drawImage(img,0,0,w,h);
      c.style.cssText="position:absolute;inset:0;width:390px;height:760px;image-rendering:pixelated";
      target.appendChild(c);res()};
    img.onerror=res;
    img.src="data:image/svg+xml;charset=utf-8,"+encodeURIComponent(svg);
  });
}
function cafeSVG(){
  let win="",y0=[205,300];
  for(const y of y0)for(const x of[34,168,302]){
    win+=`<rect x="${x-6}" y="${y}" width="14" height="70" fill="#6E7CA8" stroke="${OUT}" stroke-width="3"/><rect x="${x+48}" y="${y}" width="14" height="70" fill="#6E7CA8" stroke="${OUT}" stroke-width="3"/><rect x="${x+8}" y="${y}" width="40" height="70" fill="#8FB8DD" stroke="${OUT}" stroke-width="3"/><path d="M${x+28} ${y}V${y+70}M${x+8} ${y+30}H${x+48}" stroke="${OUT}" stroke-width="3"/>`;
  }
  let rail="";for(let x=-4;x<395;x+=12)rail+=`<path d="M${x} 300V314" stroke="#2B2B3A" stroke-width="4"/>`;
  let awn="";for(let i=0;i<13;i++)awn+=`<path d="M${i*30-5} 372 L${i*30+25} 372 L${i*30+25} 402 L${i*30-5} 402Z" fill="${i%2?"#F4E9D2":"#C8402F"}" stroke="${OUT}" stroke-width="3"/>`;
  let cob="";for(let r=0;r<12;r++)for(let c=0;c<9;c++)cob+=`<path d="M${c*46+(r%2)*23} ${506+r*22}h22" stroke="#8C7A66" stroke-width="4" opacity=".4"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="390" height="760" viewBox="0 0 390 760"><defs>
  <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7FB2E8"/><stop offset=".5" stop-color="#F6C99A"/><stop offset="1" stop-color="#F7A978"/></linearGradient>
  <linearGradient id="pave" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#C9B79F"/><stop offset="1" stop-color="#A89580"/></linearGradient></defs>
  <rect width="390" height="760" fill="url(#sky)"/><circle cx="330" cy="70" r="46" fill="#FFE3A0"/>
  <g stroke="${OUT}" stroke-width="4" stroke-linejoin="miter">
    <rect x="40" y="70" width="22" height="70" fill="#C9B596"/><rect x="320" y="76" width="22" height="64" fill="#C9B596"/>
    <path d="M-5 195 L22 122 L368 122 L395 195Z" fill="#55608A"/>
    <rect x="-5" y="190" width="400" height="320" fill="#EBDCC3"/>
    ${[70,195,320].map(x=>`<path d="M${x-22} 190 V150 H${x+22} V190Z" fill="#EBDCC3"/><rect x="${x-12}" y="150" width="24" height="36" fill="#8FB8DD"/>`).join("")}
    ${win}
    <rect x="-5" y="292" width="400" height="8" fill="#CDBA98"/>${rail}
    <rect x="-5" y="410" width="400" height="100" fill="#1F4D3F"/>
    <rect x="22" y="420" width="120" height="76" fill="#A9DCE8"/><rect x="248" y="420" width="120" height="76" fill="#A9DCE8"/>
    <rect x="160" y="420" width="70" height="90" fill="#163A30"/>
    ${awn}
    <rect x="-5" y="504" width="400" height="260" fill="url(#pave)"/>
  </g>${cob}
  ${[34,168,302].map(x=>`<rect x="${x-10}" y="364" width="76" height="12" fill="#2f7a4a" stroke="${OUT}" stroke-width="3"/>${[0,1,2,3,4,5].map(i=>`<circle cx="${x-4+i*12}" cy="361" r="5" fill="${["#FF6F9C","#FFD54A","#FF8A3D","#FFFFFF","#FF6F9C","#FFD54A"][i]}"/>`).join("")}`).join("")}
  <path d="M0 336 Q50 352 100 336 T200 336 T300 336 T390 336" fill="none" stroke="#2B2B3A" stroke-width="3"/>
  ${[0,1,2,3,4,5,6,7,8,9,10,11,12].map(i=>`<circle cx="${i*32+4}" cy="${i%2?348:343}" r="5" fill="#FFE9A8" stroke="#E69B2E" stroke-width="2"/>`).join("")}
  <g stroke="${OUT}" stroke-width="4"><rect x="8" y="468" width="26" height="34" fill="#B5543A"/><circle cx="21" cy="458" r="20" fill="#2f7a4a"/><circle cx="12" cy="450" r="9" fill="#FF6F9C"/><circle cx="30" cy="456" r="9" fill="#FFD54A"/>
  <rect x="338" y="468" width="26" height="34" fill="#B5543A"/><circle cx="351" cy="458" r="20" fill="#2f7a4a"/><circle cx="342" cy="450" r="9" fill="#FF8A3D"/><circle cx="360" cy="456" r="9" fill="#FF6F9C"/></g>
  <g stroke="${OUT}" stroke-width="4"><rect x="14" y="440" width="46" height="62" fill="#2B2B3A"/><path d="M22 456h30M22 468h24M22 480h28" stroke="#fff" stroke-width="3"/></g>
  <g stroke="${OUT}" stroke-width="4"><path d="M368 330V506" stroke="#2B2B3A" stroke-width="8"/><circle cx="368" cy="326" r="11" fill="#FFE9A8"/><rect x="358" y="500" width="20" height="8" fill="#2B2B3A"/></g>
  <g stroke="#7A4A2A" stroke-width="7" fill="#C99A66"><rect x="70" y="440" width="80" height="120" rx="38"/><rect x="240" y="440" width="80" height="120" rx="38"/></g></svg>`;
}
function tableSVG(){
  return `<svg xmlns="http://www.w3.org/2000/svg" width="390" height="760" viewBox="0 0 390 760">
  <path d="M98 566 Q94 610 84 650 Q195 668 306 650 Q296 610 292 566Z" fill="#FFF3E2" stroke="${OUT}" stroke-width="4"/>
  <path d="M92 622 Q195 640 298 622" fill="none" stroke="#F2B27A" stroke-width="6"/>
  <ellipse cx="195" cy="566" rx="104" ry="24" fill="#FFF8EC" stroke="${OUT}" stroke-width="4"/>
  <g stroke="${OUT}" stroke-width="3">
  </g>
  ${[[32,512],[357,512]].map(([x,y])=>`<path d="M${x-30} ${y} Q${x-32} ${y+24} ${x-36} ${y+44} L${x+36} ${y+44} Q${x+32} ${y+24} ${x+30} ${y}Z" fill="#FFF3E2" stroke="${OUT}" stroke-width="3"/><ellipse cx="${x}" cy="${y}" rx="34" ry="9" fill="#FFF8EC" stroke="${OUT}" stroke-width="3"/><circle cx="${x-8}" cy="${y-3}" r="4" fill="#fff" stroke="${OUT}" stroke-width="2"/><circle cx="${x+10}" cy="${y-3}" r="4" fill="#E8B26A" stroke="${OUT}" stroke-width="2"/>`).join("")}</svg>`;
}
async function buildCafe(){
  const bg=$("#bg"),tb=$("#tablel");
  await pixelize(cafeSVG(),3,bg);await pixelize(tableSVG(),3,tb);
  bg.insertAdjacentHTML("beforeend",'<div style="position:absolute;z-index:2;left:97px;top:384px;width:196px;height:30px;background:#163A30;border:3px solid #D9A93B;box-shadow:0 -3px 0 #14122e,0 3px 0 #14122e,3px 3px 0 rgba(0,0,0,.4);color:#FFE2A6;font:400 15px \'Press Start 2P\',monospace;letter-spacing:4px;text-align:center;line-height:24px;text-shadow:2px 2px 0 #14122e">CHARLY</div><div id="lampglow" style="position:absolute;left:278px;top:236px;width:180px;height:180px;background:radial-gradient(circle,rgba(255,233,168,.9),rgba(255,233,168,0) 70%);opacity:0;transition:opacity 1s"></div><div id="dusk" style="position:absolute;inset:0;background:#1B1250;mix-blend-mode:multiply;opacity:.06;transition:opacity .4s"></div>');
  tb.insertAdjacentHTML("beforeend",'<svg class="wine" style="position:absolute;left:118px;top:526px;opacity:0;transition:opacity .4s" width="40" height="48" viewBox="0 0 10 12" shape-rendering="crispEdges"><path fill="#2B1646" d="M0 0h10v1H9v4H8v1H6v4h2v1H8v1H2v-1H2v-1h2V6H2V5H1V1H0z"/><rect x="2" y="1" width="6" height="1" fill="#FFFBE0"/><rect x="2" y="2" width="6" height="2" fill="#F7E9A6"/><rect x="3" y="4" width="4" height="1" fill="#F2DC7A"/><rect x="4" y="5" width="2" height="1" fill="#F2DC7A"/><rect x="4" y="6" width="2" height="4" fill="#DCE3F0"/><rect x="3" y="10" width="4" height="1" fill="#fff"/></svg><svg class="wine" style="position:absolute;left:232px;top:526px;opacity:0;transition:opacity .4s" width="40" height="48" viewBox="0 0 10 12" shape-rendering="crispEdges"><path fill="#2B1646" d="M0 0h10v1H9v4H8v1H6v4h2v1H8v1H2v-1H2v-1h2V6H2V5H1V1H0z"/><rect x="2" y="1" width="6" height="1" fill="#FFFBE0"/><rect x="2" y="2" width="6" height="2" fill="#F7E9A6"/><rect x="3" y="4" width="4" height="1" fill="#F2DC7A"/><rect x="4" y="5" width="2" height="1" fill="#F2DC7A"/><rect x="4" y="6" width="2" height="4" fill="#DCE3F0"/><rect x="3" y="10" width="4" height="1" fill="#fff"/></svg>');
  tb.insertAdjacentHTML("beforeend",'<svg id="fries" style="position:absolute;left:175px;top:526px;opacity:0;transition:opacity .2s" width="40" height="36" viewBox="0 0 10 9" shape-rendering="crispEdges"><rect x="1" y="0" width="1" height="4" fill="#FFD54A"/><rect x="3" y="1" width="1" height="3" fill="#F5C531"/><rect x="5" y="0" width="1" height="4" fill="#FFD54A"/><rect x="7" y="1" width="1" height="3" fill="#F5C531"/><rect x="2" y="2" width="1" height="2" fill="#FFE27A"/><rect x="6" y="2" width="1" height="2" fill="#FFE27A"/><rect x="0" y="4" width="10" height="5" fill="#E5322D"/><rect x="0" y="4" width="10" height="1" fill="#B8201C"/><rect x="3" y="6" width="4" height="1" fill="#FFF3E2"/></svg>');
  bg.insertAdjacentHTML("beforeend",'<div id="moon" style="position:absolute;left:308px;top:44px;width:56px;height:56px;border-radius:50%;background:#FFF6D6;box-shadow:0 0 30px 12px rgba(255,246,214,.45),inset -14px -6px 0 #E6DCB4;opacity:0;transition:opacity 2s;image-rendering:pixelated"></div>');
  tb.insertAdjacentHTML("beforeend",'<svg id="tph" style="position:absolute;left:170px;top:552px;opacity:0;transition:opacity .3s" width="40" height="24" viewBox="0 0 10 6" shape-rendering="crispEdges"><rect width="10" height="6" fill="#1a1028"/><rect x="1" y="1" width="8" height="4" fill="#14121A"/><rect x="2" y="2" width="6" height="2" fill="#8FD0FF"/></svg>');
}
function setLight(k){const d=$("#dusk");if(d)d.style.opacity=k;const l=$("#lampglow");if(l)l.style.opacity=Math.max(0,(k-.3)*1.4)}


/* =====================================================================
   COMBAT — écran RPG au tour par tour (original), réutilisable
   ===================================================================== */
const BT={me:100,foe:1000,meMax:100,foeMax:1000,crit:null};
function gridSVG(g,px,extra=""){
  const has=(x,y)=>(x+","+y) in g,ol=[];
  for(let y=-1;y<=GH;y++)for(let x=-1;x<=GW;x++)if(!has(x,y)&&(has(x-1,y)||has(x+1,y)||has(x,y-1)||has(x,y+1)))ol.push(`<rect x="${x}" y="${y}" width="1" height="1" fill="${DK}"/>`);
  let out="";const rows={};
  for(const k in g){const[x,y]=k.split(",").map(Number);(rows[y]=rows[y]||[]).push([x,g[k]])}
  for(const y in rows){const r=rows[y].sort((a,b)=>a[0]-b[0]);let i=0;
    while(i<r.length){let j=i;while(j+1<r.length&&r[j+1][0]===r[j][0]+1&&r[j+1][1]===r[i][1])j++;
      out+=`<rect x="${r[i][0]}" y="${y}" width="${j-i+1}" height="1" fill="${r[i][1]}"/>`;i=j+1}}
  return `<svg viewBox="-1 -1 ${GW+2} ${GH+2}" width="${(GW+2)*px}" height="${(GH+2)*px}" shape-rendering="crispEdges"><g>${ol.join("")}${out}${extra}</g></svg>`;
}
function ganjaSVG(px){
  const g={},P_=(x,y,c)=>{g[x+","+y]=c},rc=(x,y,w,h,c)=>{for(let j=0;j<h;j++)for(let i=0;i<w;i++)P_(x+i,y+j,c)};
  const skin="#A9693F",cols=["#4B2C20","#6B3F24","#B8742F","#4B2C20","#8A5428"];
  rc(10,TY+12,12,10,"#0B0B0B");rc(9,TY+20,6,2,"#14121A");rc(17,TY+20,6,2,"#14121A");rc(9,TY+21,2,1,"#fff");rc(21,TY+21,2,1,"#fff");
  rc(9,TY,14,12,"#1A1A1A");rc(21,TY+3,2,9,"#111111");
  rc(6,TY,3,10,skin);rc(6,TY+10,3,2,skin);rc(23,TY,3,10,skin);rc(23,TY+10,3,2,skin);
  for(let r=0;r<14;r++){const x0=(r===0||r===13)?10:(r===1||r===12)?9:8,x1=(r===0||r===13)?21:(r===1||r===12)?22:23;rc(x0,HY+r,x1-x0+1,1,"#3a2418")}
  for(let x=8;x<24;x+=2){const len=19+((x*7)%5);rc(x,HY-3,2,len,cols[(x>>1)%5]);P_(x,HY-3+len,cols[(x>>1)%5])}
  rc(9,HY-10,14,2,"#1E9E4A");rc(9,HY-8,14,2,"#FFD21F");rc(9,HY-6,14,2,"#E5322D");rc(8,HY-4,16,1,"#1E9E4A");   // bob : calotte rayée vert/jaune/rouge
  rc(6,HY-3,20,2,"#157A38");rc(7,HY-1,18,1,"#0E5A28");                                                      // bord large
  rc(26,TY+9,5,1,"#fff");P_(31,TY+9,"#FF8A3D");
  const smoke=[0,1,2].map(i=>`<rect x="${31+i%2}" y="${TY+7-i*2}" width="1" height="1" fill="#fff"/>`).join("");
  return gridSVG(g,px,smoke);
}
function setFoe(expr){$("#foeIn").innerHTML=sprite({kind:"sophie",pose:"down",expr,sit:false,px:4})}
function buildBattle(s){const title=esc(s.title||"");
  const b=$("#battle");
  b.innerHTML=`<div class="grid"></div><div class="bt-title">⚔ ${title}</div>
  <div class="bt-box" style="left:12px;top:46px"><b>${esc(s.foe||"")}</b><div class="bt-hp"><i>PV</i><div class="bt-bar" id="foeBar"><span></span></div></div><div class="bt-num" id="foeNum">1000/1000</div></div>
  <div id="foeWrap" style="position:absolute;left:215px;top:96px"><div id="foeIn" class="bs"></div></div>
  <div id="meWrap" style="position:absolute;left:12px;top:330px"><div id="meIn" class="bs"></div></div>
  <div class="bt-box" style="left:182px;top:430px"><b>${esc(s.me||"")} <span style="color:#3DDC97">${esc(s.tag||"")}</span></b><div class="bt-hp"><i>PV</i><div class="bt-bar" id="meBar"><span></span></div></div><div class="bt-num" id="meNum">100/100</div></div>
  <div id="btMsg"><div id="btText"></div><div id="btMenu"></div></div>`;
  BT.me=100;BT.foe=1000;setFoe("neutral");$("#meIn").innerHTML=ganjaSVG(5);
}
function typeText(el,text,f){
  const my=token;
  return new Promise(res=>{
    if(FAST){el.textContent=text;return res()}
    let i=0,done=false;
    const fin=()=>{if(done)return;done=true;clearInterval(iv);el.textContent=text;typing=null;res()};
    const iv=setInterval(()=>{if(paused)return;i++;el.textContent=text.slice(0,i);if(i%2===0)SFX.blip(f||330);if(i>=text.length)fin()},26);
    typing=fin;
  }).then(()=>aborted(my));
}
async function btSay(text,o={}){
  const t=$("#btText");$("#btMenu").innerHTML="";t.classList.remove("has-menu");
  t.innerHTML=`<span class="${o.sp?"sp":""}"></span>`;
  await typeText(t.firstChild,text,o.sp?260:330);
  if(o.wait!==false){t.insertAdjacentHTML("beforeend",'<span class="more">▼</span>');await tap()}
}
function btChoose(prompt,opts){                      // menu : les boutons non prévus sont grisés
  return new Promise(res=>{
    const t=$("#btText");t.classList.add("has-menu");t.textContent=prompt;
    const m=$("#btMenu");m.innerHTML="";lastMove=Date.now();
    let fini=false,timer=null;
    const done=id=>{if(fini)return;fini=true;clearTimeout(timer);pendingChoice=null;m.innerHTML="";res(id)};
    const prevu=opts.find(o=>o.on).id;
    for(const o of opts){const b=document.createElement("button");b.className="mbtn"+(o.on?"":" off");b.textContent=o.label;
      b.onclick=()=>{SFX.pop();done(o.id)};m.appendChild(b)}
    pendingChoice=()=>done(prevu);                    // pas de choix en 5 s : le choix prévu se lance seul
    timer=tmo(()=>done(prevu),AUTO_MS);
    if(FAST)done(prevu);
  });
}
async function setHP(side,to){
  const max=side==="me"?BT.meMax:BT.foeMax,from=BT[side];BT[side]=to;
  const bar=$("#"+side+"Bar"),num=$("#"+side+"Num"),pct=to/max;
  bar.firstElementChild.style.width=(pct*100)+"%";
  bar.classList.toggle("mid",pct<=.5&&pct>.2);bar.classList.toggle("low",pct<=.2);bar.classList.toggle("crit",side==="me"&&pct<=.2);
  if(side==="me"){clearInterval(BT.crit);BT.crit=null;if(pct<=.2)BT.crit=setInterval(()=>SFX.crit(),1000)}
  for(let i=1;i<=10;i++){num.textContent=Math.round(from+(to-from)*i/10)+"/"+max;if(!FAST)await sleep(70)}
}
function shake(id){const e=$("#"+id);e.classList.remove("shake");void e.offsetWidth;e.classList.add("shake")}
function flashW(){const d=document.createElement("div");d.className="flashw";$("#battle").appendChild(d);setTimeout(()=>d.remove(),400)}
function dmg(x,y,text,cls=""){const d=document.createElement("div");d.className="dmg "+cls;d.textContent=text;d.style.left=x+"px";d.style.top=y+"px";$("#battle").appendChild(d);setTimeout(()=>d.remove(),1400)}
async function proj(emoji,from,to){
  const e=document.createElement("div");e.className="proj";e.textContent=emoji;e.style.left=from[0]+"px";e.style.top=from[1]+"px";
  $("#battle").appendChild(e);SFX.zap();await sleep(40);e.style.left=to[0]+"px";e.style.top=to[1]+"px";await sleep(560);e.remove();
}
async function lunge(id,dx,dy){const e=$("#"+id);e.style.transform=`translate(${dx}px,${dy}px)`;await sleep(280);e.style.transform="";await sleep(280)}
function atkName(t){const d=document.createElement("div");d.className="atkname";d.textContent=t;$("#battle").appendChild(d);setTimeout(()=>d.remove(),1300)}

/* COMBAT : déroulé décrit dans la fiche (liste d'opérations « o ») */
async function runBattle(s){
  clearBub();ambience(false);
  for(let i=0;i<3;i++){$("#fade").style.transition="none";$("#fade").style.background=i%2?"#000":"#fff";$("#fade").style.opacity=1;await sleep(110);$("#fade").style.opacity=0;await sleep(90)}
  $("#fade").style.background="#000";$("#fade").style.transition="";
  buildBattle(s);$("#battle").style.display="block";SFX.jingle();
  await sleep(900);bgmStart();
  for(const o of s.script){
    aborted(token);
    switch(o.o){
      case"say":await btSay(o.text,{sp:!!o.sp,wait:o.wait!==0});break;
      case"menu":await btChoose(o.prompt,o.opts.map(([label,on],k)=>({id:k,label,on:!!on})));break;
      case"name":atkName(o.text);await sleep(o.ms||500);break;
      case"proj":await proj(o.emoji,o.from,o.to);break;
      case"flash":flashW();break;
      case"foe":setFoe(o.expr);break;
      case"lunge":await lunge(o.id,o.dx,o.dy);break;
      case"hit":SFX.hit();shake(o.shake);flashW();dmg(o.dmg[0],o.dmg[1],o.dmg[2],o.dmg[3]||"");if(o.foe)setFoe(o.foe);await setHP(o.hp[0],o.hp[1]);break;
      case"heal":SFX.heal();dmg(o.dmg[0],o.dmg[1],o.dmg[2],o.dmg[3]||"");await setHP(o.hp[0],o.hp[1]);break;
      case"flee":{const fe=$("#foeIn");fe.style.transition="transform .9s steps(9)";fe.style.transform="translateX(300px)";SFX.flee();break}
      case"win":SFX.win();break;
    }
  }
  clearInterval(BT.crit);BT.crit=null;bgmStop();
  $("#fade").style.opacity=1;await sleep(700);
  $("#battle").style.display="none";$("#battle").innerHTML="";ambience(true);
  set("nelson",{expr:"neutral"});
  $("#fade").style.opacity=0;await sleep(500);
}

/* ---------- ARRÊT / NETTOYAGE ---------- */
function resetScene(){
  bgmStop();clearInterval(BT.crit);BT.crit=null;$("#battle").style.display="none";$("#battle").innerHTML="";
  token++;if(tapRes)tapRes();if(skipFn)skipFn();typing=null;
  for(const k in A)delete A[k];
  ["#bg","#back","#tablel","#front","#fx","#bub"].forEach(s=>$(s).innerHTML="");
  clearBub();ambience(false);
  ["#phone","#zoom","#end","#quest","#cap"].forEach(s=>$(s).style.display="none");
  placeEl.classList.remove("on");clock.classList.remove("on");hint(false);
  $("#fade").style.opacity=0;
}

/* =====================================================================
   FICHE DE SCÈNE — chapitre 1 (étapes 1 à 28)
   Chaque entrée = une étape lue par le moteur (t = type d'étape)
   ===================================================================== */
// Correctif de texte appliqué à la lecture (la copie en base peut rester ancienne) : « QUE » en majuscules
const STEPS0=JSON.parse(JSON.stringify(SHEET.steps).replace(/fumes que des cigarettes/g,"fumes QUE des cigarettes"));
// Textes longs coupés en deux bulles (un toucher entre les deux). S'applique à la lecture, sans effet si le chapitre est déjà coupé.
// cut = début de la 2e bulle. map = ancien numéro d'étape → nouveau (pour les timecodes).
const SPLITS=[["caption","Lui alterne"],["say","Bon, STOP"],["say","Quand elle sera là"]];
const MAP=[],CH1=[];
STEPS0.forEach((st,i)=>{
  MAP[i]=CH1.length;
  const sp=SPLITS.find(x=>st.t===x[0]&&typeof st.text==="string"&&st.text.indexOf(x[1])>0);
  if(!sp){CH1.push(st);return}
  const k=st.text.indexOf(sp[1]),a=Object.assign({},st,{text:st.text.slice(0,k).trim()}),b=Object.assign({},st,{text:st.text.slice(k).trim()});
  delete a.after;delete a.then;delete a.clearSweat;delete a.bigEmoji;CH1.push(a,b);
});
START_AT=MAP[START_AT]!=null?MAP[START_AT]:START_AT;FAST=START_AT>0;

let sweatEl=null;                              // goutte de gêne de Nelson
async function runSheet(sheet){
  const my=token;
  for(let idx=0;idx<sheet.length;idx++){
    const s=sheet[idx];
    if(FAST&&idx>=START_AT)FAST=false;           // arrivé au timecode : on repasse en temps réel
    aborted(my);
    try{switch(s.t){
      case"title":{
        $("#fade").style.opacity=0;
        const o=$("#end");o.style.display="none";
        $("#quest").innerHTML=`<small style="color:#fff;letter-spacing:3px;margin-bottom:8px">${esc(s.date||"")}</small><small>${esc(s.tag||"✦ QUÊTE ACCEPTÉE ✦")}</small><b>${esc(s.name||"").replace(/\n/g,"<br>")}</b>`;$("#quest").style.display="block";SFX.quest();
        await tap();$("#quest").style.display="none";
        $("#fade").style.opacity=1;await sleep(500);
        break}
      case"scene":{
        await buildCafe();
        // voisins de terrasse (petits, au second plan, sans gêner la scène)
        addActor("e1","extra",{x:18,y:476,sit:true,px:1.4,skin:"#F1C7A0",shade:"#D9A57D",hair:"#8A4B2A",top:"#D95D5D",long:true,expr:"happy"});
        addActor("e2","extra",{x:45,y:478,sit:true,px:1.4,skin:"#8D5A3C",shade:"#6F4229",hair:"#1A1410",top:"#4A7BD9",expr:"happy"});
        addActor("e3","extra",{x:348,y:476,sit:true,px:1.4,skin:"#E6B58C",shade:"#C9916A",hair:"#E0B040",top:"#3DAA6E",long:true,expr:"neutral"});
        addActor("e4","extra",{x:373,y:478,sit:true,px:1.4,skin:"#F5D2B0",shade:"#DDB08A",hair:"#3A2A20",top:"#9460D0",expr:"happy"});
        addActor("nelson","nelson",{x:110,y:432,sit:true,pose:"phone",expr:"neutral"});
        setPlace(s.place);setClock(s.time);setLight(s.light);
        $("#fade").style.opacity=0;ambience(true);await sleep(900);break}
      case"caption":{
        const c=$("#cap");c.innerHTML=s.text+'<span class="more">▼</span>';c.style.display="block";
        await tap();c.style.display="none";break}
      case"phone":await phoneStep(s);break;
      case"set":{
        set(s.id,{pose:s.pose,expr:s.expr});
        if(s.phoneOnTable)$("#tph").style.opacity=1;
        await sleep(s.wait||400);break}
      case"say":{
        if(s.clearSweat&&sweatEl){sweatEl.remove();sweatEl=null}   // la gêne retombe quand Sophie répond
        const big=s.bigEmoji?emote(s.who,s.bigEmoji,"",0,52,20):null;if(big){big.style.fontSize="44px";SFX.pop()}
        await say(s.who,s.text,s.think);if(big)big.remove();
        if(s.after){set(s.after.id,{expr:s.after.expr});if(s.after.sweat)(()=>{sweatEl=emote(s.after.id,"💧","",0,20,34);sweatEl.style.fontSize="22px"})() /* goutte de gêne, au-dessus des cheveux */}
        if(s.then){SFX.flick();set(s.then.id,{pose:s.then.pose});await sleep(700)}
        break}
      case"lapse":{                                       // le temps passe : il alterne entre passants et téléphone
        const lp=lapse(s.from,s.to,s.ms);let k=0;
        if(!FAST)while(Date.now()<Date.now()+1&&k<4){set("nelson",{expr:k%2?"neutral":"think"});await sleep(s.ms/4);k++}
        await lp;set("nelson",{expr:"neutral"});break}
      case"arrive":await arriveStep();break;
      case"blabla":await blablaStep(s);break;
      case"nightfall":await nightfallStep(s);break;
      case"cig":{SFX.flick();set(s.id,{pose:"cig",expr:"happy"});await sleep(800);break}
      case"shock":{set("nelson",{expr:"shock"});SFX.sting();await sleep(1500);break}
      case"battle":await runBattle(s);break;
      case"happy":{                                       // 26 : plus de gêne, tous les deux très heureux
        if(sweatEl){sweatEl.remove();sweatEl=null}
        set("nelson",{expr:"happy"});set("sophie",{expr:"happy"});
        for(let k=0;k<3;k++){SFX.pop();sparkles(150+k*30,400,5);await sleep(700)}
        await sleep(600);break}
      case"end":{
        $("#endT").innerHTML=esc(s.title||"").replace(/\n/g,"<br>");$("#endS").innerHTML=esc(s.sub||"").replace(/\n/g,"<br>");
        $("#fade").style.opacity=1;await sleep(700);
        ambience(false);$("#end").style.display="flex";break}
    }}catch(e){if(e==="abort")throw e;console.error("étape ignorée :",s.t,e)}   // erreur : on passe à l'étape suivante
  }
}

/* étapes 3-5 : le téléphone */
async function phoneStep(s){
  const ph=$("#phone"),body=$("#pbody");body.innerHTML="";$("#pav").textContent=(s.contact||"?")[0];$("#pname").textContent=s.contact||"";$("#ptime").textContent=s.time||"";ph.style.display="flex";SFX.swoosh();await sleep(500);
  const tm=t=>t?`<span class="tm">${t}</span>`:"";
  for(const m of s.script.filter(x=>x.pre)){            // messages reçus à 17:25 : déjà là à l'ouverture
    const d=document.createElement("div");d.className="msg in";d.innerHTML=m.text+tm(m.time);body.appendChild(d);
  }
  await tap();
  for(const m of s.script.filter(x=>!x.pre)){
    const d=document.createElement("div");d.className="msg out"+(m.em?" em":"");d.innerHTML=m.text+(m.em?"":tm(m.time));body.appendChild(d);SFX.send();
    await tap();
  }
  // gros plan sur le smiley penché + son « plot twist »
  const z=$("#zoom");$("#zemo").textContent=s.zoom;z.style.display="flex";SFX.plot();
  await tap();
  z.style.display="none";ph.style.display="none";await sleep(300);
}

/* étapes 7-9 : Sophie arrive, la bise, ils s'assoient */
async function arriveStep(){
  addActor("sophie","sophie",{x:490,y:492,sit:false,pose:"down",expr:"happy"});
  SFX.door();await walk("sophie",330,492,2000);
  emote("nelson","!","ex",1100);SFX.pop();await sleep(450);
  emote("sophie","!","ex",1100);SFX.pop();await sleep(900);
  // Nelson se lève et vient la saluer
  $("#tph").style.opacity=0;
  set("nelson",{sit:false,expr:"happy",pose:"down"});A.nelson.y=492;place(A.nelson,0);await sleep(250);
  await walk("nelson",236,492,1300);
  // la bise (cordiale, ils ne se connaissent pas) : ils se penchent l'un vers l'autre deux fois
  for(let i=0;i<2;i++){
    A.nelson.el.classList.add("lean-r");A.sophie.el.classList.add("lean-l");
    SFX.blip(520);   // simple bise cordiale : juste le geste, sans bisou ni cœurw.style.color="#FF6F9C";
    await sleep(450);
    A.nelson.el.classList.remove("lean-r");A.sophie.el.classList.remove("lean-l");await sleep(350);
  }
  // ils s'assoient
  const p1=walk("nelson",110,492,1300),p2=walk("sophie",280,492,1000);
  await Promise.all([p1,p2]);
  A.nelson.y=432;A.sophie.y=432;
  set("nelson",{sit:true,expr:"neutral",pose:"down"});set("sophie",{sit:true,expr:"happy",pose:"down"});
  place(A.nelson,0);place(A.sophie,0);SFX.pop();await sleep(700);
}

/* étape 11 (AUTO) : « bla bla bla » pendant que l'heure défile */
async function blablaStep(s){
  const my=token,txt="bla bla bla…";
  document.querySelectorAll(".wine").forEach(w=>{w.style.opacity=1});SFX.pop();   // les verres de vin arrivent
  const lp=lapse(s.from,s.to,s.ms,s.light);
  if(FAST){await lp;return}
  const n=Math.max(2,2*Math.round(s.ms/780/2));        // nombre PAIR de bulles, même texte : autant de « bla bla bla » de chaque côté
  for(let i=0;i<n;i++){
    const who=i%2?"nelson":"sophie";
    clearBub();mkBubble(who,txt,"say mini "+who);
    set("sophie",{expr:who==="sophie"?"laugh":"happy"});set("nelson",{expr:"shy"});
    SFX.blip(who==="sophie"?440:260);await sleep(780);
  }
  clearBub();set("sophie",{expr:"happy"});await lp;aborted(my);
}

/* étape 27 : de 19h30 à 22h, le soleil tombe ; un serveur pose des frites qui ne bougeront plus jamais */
async function nightfallStep(s){
  const my=token;
  async function waiter(){
    if(FAST){$("#fries").style.opacity=1;return}
    await sleep(s.ms*.35);
    addActor("serveur","extra",{x:430,y:500,sit:false,px:4,apron:true,skin:"#E6B58C",shade:"#C9916A",hair:"#2A1A12",top:"#202020",expr:"neutral"});
    await walk("serveur",235,500,1500);SFX.pop();$("#fries").style.opacity=1;await sleep(500);
    await walk("serveur",440,500,1300);if(A.serveur){A.serveur.el.remove();delete A.serveur}
  }
  const w=waiter();
  await blablaStep({from:s.from,to:s.to,ms:s.ms,light:s.light});
  await w;aborted(my);
  $("#moon").style.opacity=1;await sleep(FAST?0:1800);
}

/* ---------- LANCEMENT ---------- */
async function play(){
  actx();
  try{await runSheet(CH1)}catch(e){if(e!=="abort")console.error(e)}
}
$("#again").onclick=()=>{resetScene();FAST=false;START_AT=0;play()};
$("#endClose").onclick=()=>close();
play();

    // ======================= fin du moteur =======================
    // Pause automatique quand on quitte le site (autre onglet, autre appli, écran verrouillé) : image, texte, compte à rebours et musique
    let blurred = false; const onBlur = () => { blurred = true; applyPause(); }, onFocus = () => { blurred = false; applyPause(); };
    function applyPause() {
      const p = document.hidden || blurred;
      if (p === paused) return;
      paused = p; RT.classList.toggle("paused", p);
      try { if (ctx) p ? ctx.suspend() : ctx.resume(); } catch (e) {}
      lastMove = Date.now();
    }
    document.addEventListener("visibilitychange", applyPause); addEventListener("blur", onBlur); addEventListener("focus", onFocus);
    closeFn = function () {
      document.removeEventListener("visibilitychange", applyPause); removeEventListener("blur", onBlur); removeEventListener("focus", onFocus); clearInterval(wd); paused = false;
      try { resetScene(); } catch (e) {}
      try { bgmStop(); ambience(false); if (ctx) ctx.close(); } catch (e) {}
      removeEventListener("resize", fit);
      document.body.style.overflow = prevOverflow;
      root.remove(); current = null;
      if (opts.onClose) opts.onClose();
    };
    current = { close };
    return current;
  }
  return { open, close() { if (current) current.close(); } };
})();
