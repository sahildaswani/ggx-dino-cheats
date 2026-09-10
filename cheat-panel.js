/* === GGX Dino Run — cheat panel v4 (UI overlay) ===
   Paste the whole file into DevTools Console while signed in to the game.
   A draggable panel appears top-right. Everything is also exposed
   on window.cheat for console use. */
(() => {
  if (window._cheatPanel) return console.log("panel already loaded");
  window._cheatPanel = true;

  /* ---------------- core cheat state ---------------- */
  const S = { farm: null, coins: null, flood: null, disco: null, spdMult: 1, jmpMult: 1, wasGround: true, hooked: false,
    fly: false, flyX: 0, flyY: 0, flySpd: 200, flyLast: 0 };
  const day = () => todayKey();

  // Runs after the game's own rAF each frame; overwrites the mutable
  // velocity on `me` that updateMe() derived from the frozen consts.
  function moveHook() {
    requestAnimationFrame(moveHook);
    if (!joined) return;
    if (S.fly) return flyStep();
    const stunned = performance.now() < me.stunUntil || !!me.hurt;
    if (S.spdMult > 1 && !stunned && !me.crouch) {
      if (keys.has("right")) me.vx = RUN * S.spdMult;
      else if (keys.has("left")) me.vx = -RUN * S.spdMult;
    }
    if (S.jmpMult !== 1 && S.wasGround && !me.onGround && me.vy < 0 && me.jumpHeld && !me.hurt)
      me.vy = JUMP_V * S.jmpMult;
    S.wasGround = me.onGround;
  }
  // Airbreak / free-fly: S.flyX/flyY is OUR authoritative position. Each frame we
  // pin me.x/me.y to it and zero the velocities, so updateMe()'s gravity + run
  // integration has nothing to accumulate — the body hovers. WASD drives it:
  // A/D = ←/→ (the game's left/right keys), S = down, W/Space/↑ = up (jumpHeld).
  // Note: this pins position, it doesn't disable tile collision — updateMe still
  // re-collides vertically, so you fly freely through open air but won't tunnel
  // straight down through solid ground (it resists at the surface).
  function flyStep() {
    const t = performance.now();
    const dt = Math.min(0.05, (t - (S.flyLast || t)) / 1000);
    S.flyLast = t;
    let dx = (keys.has("right") ? 1 : 0) - (keys.has("left") ? 1 : 0);
    let dy = (keys.has("down") ? 1 : 0) - (me.jumpHeld ? 1 : 0);
    if (dx && dy) { dx *= Math.SQRT1_2; dy *= Math.SQRT1_2; } // even diagonal speed
    S.flyX = wrapX(S.flyX + dx * S.flySpd * dt);
    S.flyY = Math.max(0, Math.min(WORLD_H, S.flyY + dy * S.flySpd * dt));
    me.x = S.flyX; me.y = S.flyY;
    me.vx = 0; me.vy = 0; me.onGround = false; me.crouch = false;
    if (dx > 0) me.face = "right"; else if (dx < 0) me.face = "left";
  }
  const ensureHook = () => { if (!S.hooked) { S.hooked = true; requestAnimationFrame(moveHook); } };

  const api = {
    // Paced score farm: uses the game's own writeScore queue, so every DB
    // write is identical to legit play. Auto-stops below admin flag thresholds.
    farm(on, el) {
      clearInterval(S.farm); S.farm = null;
      if (!on) return;
      S.farm = setInterval(() => {
        if (myTotal >= 19000 || myDaily >= 4500) { api.farm(false); if (el) el.checked = false; return log("farm stopped: near admin sus threshold"); }
        writeScore(2);
      }, 450);
    },
    // Coin vacuum: coin spawns are deterministic (seeded per wave), claims are
    // first-come transactions with no proximity check. Claims everything instantly.
    coins(on) {
      clearInterval(S.coins); S.coins = null;
      if (!on) return;
      S.coins = setInterval(() => {
        if (!joined) return;
        const w = Math.floor(now() / CFG.waveMs);
        for (const c of [...waveCoins(w), ...waveCoins(w - 1), ...caveCoins(w), ...caveCoins(w - 1)]) {
          if (claimed.has(c.id) || pickPending.has(c.id)) continue;
          pickPending.add(c.id);
          db.ref(`${coinsPath()}/${c.id}`).transaction(cur => (cur === null ? me.uid : undefined))
            .then(r => { if (r.committed && r.snapshot.val() === me.uid) { claimed.set(c.id, me.uid); writeScore(1); } })
            .catch(() => {}).finally(() => pickPending.delete(c.id));
        }
      }, 800);
    },
    // Chat flood: the anti-spam rule throttles writes, not messages — a
    // multi-path update spends one throttle slot on N messages.
    flood(on, text) {
      clearInterval(S.flood); S.flood = null;
      if (!on) return;
      S.flood = setInterval(() => {
        const up = {}, d = day();
        for (let i = 0; i < 20; i++) {
          const k = db.ref(chatPath(d)).push().key;
          up[`chat/${d}/${k}`] = { uid: me.uid, pid: me.pid, name: me.name, char: me.char, text: `${text} ${i}`, ts: TS };
        }
        up[`lastMsg/${me.uid}`] = TS;
        db.ref(BASE).update(up).catch(e => log("flood blocked: " + e.message));
      }, 1100);
    },
    speed(mult) { S.spdMult = mult; ensureHook(); },
    jump(mult) { S.jmpMult = mult; ensureHook(); },
    // Airbreak: freeze the body mid-air and steer its absolute position with WASD.
    fly(on) {
      S.fly = on;
      if (on) { S.flyX = me.x; S.flyY = me.y; S.flyLast = 0; ensureHook(); log("free-fly on — WASD; W/Space up, S down"); }
      else { me.vx = me.vy = 0; log("free-fly off — physics restored"); }
    },
    flySpeed(px) { S.flySpd = px; },
    tp(x) { me.x = wrapX(x); me.y = landingY(me.x); me.vx = me.vy = 0; syncMe(true); log("tp → " + Math.round(me.x)); },
    // Range is only checked in the button handler (doKick), not here.
    kick(pid) {
      const t = others.get(pid);
      if (!t) return log("player gone");
      lastActAt = 0;
      sendInteract("kick", t).then(() => log("kicked " + t.name)).catch(e => log("kick blocked: " + e.message));
    },
    players() { return [...others.values()].map(p => ({ pid: p.pid, name: p.name })); },
    // Impersonation: rules pin uid to auth.uid, but your display name is
    // client-chosen and never stored server-side — there is nothing to
    // validate it against. Every send just reads me.name, so we mutate it.
    as(name) {
      api._realName = api._realName || me.name;
      me.name = name;
      renderMe();
      log(`chatting as "${name}"`);
    },
    realName() { return api._realName || me.name; },
    // Disco: cycle all characters on a timer via the game's own setChar(),
    // so every write is legit-shaped — and fully visible to every client.
    disco(on, ms = 300, el) {
      clearInterval(S.disco); S.disco = null;
      if (!on) return;
      let i = CHAR_IDS.indexOf(me.char);
      S.disco = setInterval(() => { i = (i + 1) % CHAR_IDS.length; setChar(CHAR_IDS[i]); }, ms);
    },
    admin() {
      isAdmin = true;
      if ($adminTab) $adminTab.hidden = false;
      document.body.classList.add("is-admin");
      log("admin UI unlocked (client-side; DB rules still gate writes)");
    },
    admins() {
      return db.ref("admins").once("value").then(s => s.val() || {}).catch(() => null);
    },
  };
  window.cheat = api;

  /* ---------------- panel UI ---------------- */
  const css = `
    #chtpnl{position:fixed;top:12px;right:12px;width:230px;z-index:99999;background:#141b2df2;color:#dfe7f5;
      font:12px/1.4 system-ui,sans-serif;border:1px solid #2fa8ff55;border-radius:10px;box-shadow:0 6px 24px #000a;user-select:none}
    #chtpnl .hd{padding:7px 10px;font-weight:700;cursor:move;display:flex;justify-content:space-between;align-items:center;
      background:#1e2a4a;border-radius:10px 10px 0 0}
    #chtpnl .bd{padding:8px 10px;display:flex;flex-direction:column;gap:7px}
    #chtpnl .row{display:flex;align-items:center;gap:6px;justify-content:space-between}
    #chtpnl label{flex:1}
    #chtpnl input[type=range]{width:90px}
    #chtpnl input[type=text],#chtpnl input[type=number],#chtpnl select{background:#0d1424;color:#dfe7f5;
      border:1px solid #2fa8ff44;border-radius:5px;padding:3px 6px;width:100%;box-sizing:border-box}
    #chtpnl button{background:#2fa8ff;border:0;color:#04101f;font-weight:700;border-radius:5px;padding:4px 8px;cursor:pointer}
    #chtpnl button.ghost{background:#33415e;color:#dfe7f5}
    #chtpnl .log{min-height:14px;color:#8fa3c8;font-size:11px;word-break:break-all}
    #chtpnl .val{color:#ffcf1a;min-width:30px;text-align:right}
    #chtpnl.hidden .bd{display:none}
    #chtpnl.hidden .hd{border-radius:10px}`;
  const st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);

  const p = document.createElement("div");
  p.id = "chtpnl";
  p.innerHTML = `
    <div class="hd"><span>🦖 CHEATS</span><button class="ghost" id="cp-min">–</button></div>
    <div class="bd">
      <div class="row"><label>Online admins</label><span class="val" id="cp-adcount">–</span></div>
      <div class="row"><select id="cp-admins"></select></div>
      <div class="row"><label>Farm (safe pace)</label><input type="checkbox" id="cp-farm"></div>
      <div class="row"><label>Coin vacuum</label><input type="checkbox" id="cp-coins"></div>
      <div class="row"><label>Flood chat</label><input type="checkbox" id="cp-flood"></div>
      <div class="row"><label>Disco (cycle dinos)</label><input type="checkbox" id="cp-disco"></div>
      <div class="row"><input type="text" id="cp-floodtext" value="spam" placeholder="flood text"></div>
      <div class="row"><input type="text" id="cp-nick" placeholder="chat as…"><button class="ghost" id="cp-nickset">Set</button></div>
      <div class="row"><label>Speed</label><input type="range" id="cp-spd" min="1" max="8" step="0.5" value="1"><span class="val" id="cp-spdv">×1</span></div>
      <div class="row"><label>Jump</label><input type="range" id="cp-jmp" min="1" max="3" step="0.25" value="1"><span class="val" id="cp-jmpv">×1</span></div>
      <div class="row"><label>Free-fly (WASD)</label><input type="checkbox" id="cp-fly"></div>
      <div class="row"><label>Fly speed</label><input type="range" id="cp-flyspd" min="60" max="480" step="20" value="200"><span class="val" id="cp-flyspdv">200</span></div>
      <div class="row"><input type="number" id="cp-tpx" placeholder="x (0–3200)"><button id="cp-tp">TP</button></div>
      <div class="row"><select id="cp-pl"></select><button class="ghost" id="cp-rf">⟳</button></div>
      <div class="row"><button id="cp-kick" style="flex:1">Kick selected</button></div>
      <div class="row"><button id="cp-admin" style="flex:1">Unlock admin UI</button></div>
      <div class="log" id="cp-log"></div>
    </div>`;
  document.body.appendChild(p);

  const $q = id => p.querySelector("#" + id);
  function log(m) { const el = $q("cp-log"); el.textContent = m; setTimeout(() => { if (el.textContent === m) el.textContent = ""; }, 4000); }

  // keep game keys from firing while typing in the panel
  p.addEventListener("keydown", e => e.stopPropagation());
  p.addEventListener("keyup", e => e.stopPropagation());

  // drag + minimize
  $q("cp-min").onclick = () => { p.classList.toggle("hidden"); $q("cp-min").textContent = p.classList.contains("hidden") ? "+" : "–"; };
  const hd = p.querySelector(".hd");
  hd.addEventListener("pointerdown", e => {
    if (e.target.tagName === "BUTTON") return;
    const r = p.getBoundingClientRect(), ox = e.clientX - r.left, oy = e.clientY - r.top;
    const mv = ev => { p.style.left = (ev.clientX - ox) + "px"; p.style.top = (ev.clientY - oy) + "px"; p.style.right = "auto"; };
    const up = () => { removeEventListener("pointermove", mv); removeEventListener("pointerup", up); };
    addEventListener("pointermove", mv); addEventListener("pointerup", up);
  });

  // wiring
  $q("cp-farm").onchange = e => { api.farm(e.target.checked, e.target); log(e.target.checked ? "farm on (~4.4 pts/s)" : "farm off"); };
  $q("cp-coins").onchange = e => { api.coins(e.target.checked); log(e.target.checked ? "coin vacuum on" : "coin vacuum off"); };
  $q("cp-flood").onchange = e => { api.flood(e.target.checked, $q("cp-floodtext").value || "spam"); log(e.target.checked ? "flooding — expect a mute" : "flood off"); };
  $q("cp-disco").onchange = e => { api.disco(e.target.checked); log(e.target.checked ? "disco on (300ms)" : "disco off"); };
  $q("cp-nickset").onclick = () => {
    const v = $q("cp-nick").value.trim();
    api.as(v || api.realName());
    $q("cp-nick").value = ""; $q("cp-nick").placeholder = v ? `as: ${v}` : "chat as…";
  };
  $q("cp-spd").oninput = e => { api.speed(+e.target.value); $q("cp-spdv").textContent = "×" + e.target.value; };
  $q("cp-jmp").oninput = e => { api.jump(+e.target.value); $q("cp-jmpv").textContent = "×" + e.target.value; };
  $q("cp-fly").onchange = e => api.fly(e.target.checked);
  $q("cp-flyspd").oninput = e => { api.flySpeed(+e.target.value); $q("cp-flyspdv").textContent = e.target.value; };
  $q("cp-tp").onclick = () => { const x = +$q("cp-tpx").value; if (x >= 0) api.tp(x); };

  const refresh = () => {
    const sel = $q("cp-pl"), keep = sel.value;
    sel.innerHTML = "";
    for (const pl of api.players()) { const o = document.createElement("option"); o.value = pl.pid; o.textContent = pl.name; sel.appendChild(o); }
    if ([...sel.options].some(o => o.value === keep)) sel.value = keep;
  };
  $q("cp-rf").onclick = refresh;
  $q("cp-kick").onclick = () => { if ($q("cp-pl").value) api.kick($q("cp-pl").value); };
  $q("cp-admin").onclick = () => api.admin();
  setInterval(refresh, 5000); refresh();

  // Online admins dropdown = players currently in-world whose uid is in the
  // whitelist. "Am I an admin?" is decided by me.uid ∈ list (server truth), NOT
  // the isAdmin flag — the Unlock button fakes that, we don't fake this too.
  const refreshAdmins = async () => {
    const sel = $q("cp-admins"), count = $q("cp-adcount"), keep = sel.value;
    const map = await api.admins();
    sel.innerHTML = "";
    if (map === null) { count.textContent = "?"; sel.appendChild(mkOpt("", "admins list unreadable — no permission")); return; }
    const isAdminUid = uid => map[uid] === true;                 // match checkAdmin's === true
    const online = new Map();                                    // uid -> username (deduped by person)
    if (isAdminUid(me.uid)) online.set(me.uid, me.name + " (you)");
    for (const pl of others.values()) if (isAdminUid(pl.uid) && !online.has(pl.uid)) online.set(pl.uid, pl.name);
    count.textContent = String(online.size);
    if (!online.size) { sel.appendChild(mkOpt("", "no admins online")); return; }
    for (const [uid, name] of online) sel.appendChild(mkOpt(uid, name));   // textContent inside mkOpt: names are spoofable
    if ([...sel.options].some(o => o.value === keep)) sel.value = keep;
  };
  function mkOpt(value, text) { const o = document.createElement("option"); o.value = value; o.textContent = text; return o; }
  setInterval(refreshAdmins, 5000); refreshAdmins();

  console.log("cheat panel loaded — drag the header, '–' to collapse");
})();
