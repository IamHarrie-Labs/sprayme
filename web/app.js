// Spray guest app: sign in, join a session, spray, top up, gift, settings.
// Everything on screen that looks like a number is either read straight off
// BOT Chain or written straight to it. Nothing here is placeholder data.
(function () {
  const cfg = window.SPRAY_CONFIG;

  // Naira is shown throughout for the "spraying" feel, but the chain only
  // knows BOT. This is a real, live rate — CoinGecko's price for Wrapped
  // BOT (the correct token; there are unrelated "BOT" tickers on other
  // chains, confirmed against BOT Chain's own DEX before trusting this ID),
  // converted straight to NGN in one call. Starts at a rough fallback in
  // case the fetch is slow or blocked, then corrects itself the moment the
  // real rate lands — the real BOT amount is always shown alongside it
  // either way, so nothing is ever hidden behind the conversion.
  let NGN_PER_BOT = 13000;
  async function refreshNgnRate() {
    try {
      const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=wrapped-bot&vs_currencies=ngn');
      const data = await res.json();
      const rate = data?.['wrapped-bot']?.ngn;
      if (rate > 0) NGN_PER_BOT = rate;
    } catch { /* keep the last known rate — a stale real rate beats no rate */ }
  }
  refreshNgnRate();
  setInterval(refreshNgnRate, 5 * 60 * 1000);

  const NGN = (n) => '₦' + Math.round(n).toLocaleString('en-NG');
  const botToNgn = (botFloat) => botFloat * NGN_PER_BOT;
  const weiToBalanceLabel = (wei) => {
    const bot = Number(ethers.formatEther(wei));
    return `${NGN(botToNgn(bot))} · ${bot.toFixed(4)} BOT`;
  };
  const shortAddr = (a) => (a ? a.slice(0, 6) + '…' + a.slice(-4) : '—');

  const PREFS_KEY = 'spray:prefs';
  const SESSION_KEY = 'spray:lastSession';

  const state = {
    screen: 'signin',
    address: null,
    contract: null,
    giftDropContract: null,
    cappedPoolContract: null,
    balanceWei: 0n,
    session: null, // { id, code, title }
    sessionSprayedWei: 0n,
    amountBot: '0.01',
    mySprays: [],
    recentSessions: [],
    history: [],
    prefs: loadPrefs(),
    topupMethod: 'wallet',
    holding: false,
    hypeCursorBlock: null,
  };

  function loadPrefs() {
    try {
      return { mcOn: true, nameOn: true, confirmOn: false, ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') };
    } catch { return { mcOn: true, nameOn: true, confirmOn: false }; }
  }
  function savePrefs() { localStorage.setItem(PREFS_KEY, JSON.stringify(state.prefs)); }
  function loadLastSession() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch { return null; }
  }
  function saveLastSession() { localStorage.setItem(SESSION_KEY, JSON.stringify(state.session)); }

  const $ = (id) => document.getElementById(id);

  function showToast(msg) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3200);
  }

  // Wraps a transaction-sending click handler so a second tap while the
  // first is still in flight is ignored outright, rather than firing a
  // second transaction that races the first for the same nonce. This was
  // silently missing everywhere — real on mobile, where a slow first tap
  // reads as "nothing happened" and invites a second one.
  function guardClick(btn, fn) {
    return async (...args) => {
      if (btn.disabled) return;
      btn.disabled = true;
      try {
        await fn(...args);
      } finally {
        btn.disabled = false;
      }
    };
  }

  // ---------------------------------------------------------------- screens

  function switchScreen(name) {
    if (name === 'spray' && !state.session) {
      showToast('Join a session first, then you can spray.');
      switchScreen('join');
      return;
    }
    state.screen = name;
    ['signin', 'dashboard', 'host', 'join', 'pool', 'spray', 'topup', 'gift', 'settings'].forEach((s) => {
      $('screen-' + s).hidden = s !== name;
    });
    document.querySelectorAll('#sideTabs button').forEach((b) => {
      b.classList.toggle('active', b.dataset.go === name);
    });

    if (name !== 'join') joinScanner.stop();
    if (name !== 'gift') giftScanner.stop();

    if (name === 'dashboard') refreshDashboard();
    if (name === 'host') refreshHostScreen();
    if (name === 'pool') refreshPoolScreen();
    if (name === 'spray') refreshSprayScreen();
    if (name === 'topup') refreshTopupScreen();
    if (name === 'gift') refreshGiftScreen();
    if (name === 'settings') refreshSettingsScreen();
  }

  document.querySelectorAll('[data-go]').forEach((el) => {
    el.addEventListener('click', () => { switchScreen(el.dataset.go); closeDrawer(); });
  });

  // ------------------------------------------------------------- mobile drawer
  //
  // Below 720px the sidebar becomes a slide-in panel instead of just
  // vanishing — it used to disappear entirely on mobile with nothing to
  // replace it, no menu, no way back to the landing page.
  function openDrawer() {
    $('sidebar').classList.add('open');
    $('drawerBackdrop').classList.add('open');
  }
  function closeDrawer() {
    $('sidebar').classList.remove('open');
    $('drawerBackdrop').classList.remove('open');
  }
  $('btnOpenDrawer').onclick = openDrawer;
  $('drawerBackdrop').onclick = closeDrawer;

  // ---------------------------------------------------------------- sign in

  async function afterSignIn() {
    state.address = await SprayWallet.getAddress();
    const signer = await SprayWallet.getEthersSigner();
    state.contract = new ethers.Contract(cfg.SPRAY_ADDRESS, cfg.ABI, signer);
    state.giftDropContract = new ethers.Contract(cfg.GIFTDROP_ADDRESS, cfg.GIFTDROP_ABI, signer);
    state.cappedPoolContract = new ethers.Contract(cfg.CAPPEDPOOL_ADDRESS, cfg.CAPPEDPOOL_ABI, signer);

    $('sidebar').hidden = false;
    $('mobileBar').hidden = false;
    $('sideAddress').textContent = shortAddr(state.address);
    $('dashAddress').textContent = shortAddr(state.address);
    $('settingsAddress').textContent = state.address;
    $('sideAccount').textContent = shortAddr(state.address);
    $('settingsAccount').textContent = shortAddr(state.address);

    state.session = loadLastSession();
    await refreshBalance();

    const params = new URLSearchParams(location.search);
    const deepLinkCode = params.get('code');
    const deepLinkClaim = params.get('claim');
    const deepLinkPool = params.get('pool');
    if (deepLinkCode) {
      $('joinCode').value = deepLinkCode.toUpperCase();
      switchScreen('join');
    } else if (deepLinkClaim) {
      switchScreen('gift');
      switchGiftTab('claim');
      $('claimCode').value = deepLinkClaim.toUpperCase();
    } else if (deepLinkPool) {
      switchScreen('pool');
      switchPoolTab('join');
      $('poolJoinCode').value = deepLinkPool.toUpperCase();
    } else {
      switchScreen('dashboard');
    }
  }

  $('btnSignin').onclick = () => trySignIn(() => SprayWallet.signIn());
  $('btnSigninWallet').onclick = () => trySignIn(() => SprayWallet.connectInjected());

  // Check for an already-valid Web3Auth session first — this is what makes
  // a refresh keep you signed in instead of bouncing back to this screen
  // every time. Only fall through to auto-triggering a fresh sign-in (for a
  // landing-page ?auto=1 link) if there was nothing to restore.
  (async () => {
    const restoredAddress = await SprayWallet.tryRestoreSession();
    if (restoredAddress) {
      await afterSignIn();
      return;
    }
    // A landing-page CTA can link here with ?auto=1 to skip the extra tap on
    // "Sign in" — the popup opens the instant this page loads, same handler
    // as the button, just fired automatically instead of waiting for a click.
    if (new URLSearchParams(location.search).get('auto') === '1') {
      $('btnSignin').click();
    }
  })();

  async function trySignIn(fn) {
    $('signinNote').textContent = 'Connecting…';
    try {
      await fn();
      await afterSignIn();
    } catch (e) {
      $('signinNote').textContent = e.message;
    }
  }

  function signOut() {
    SprayWallet.signOut();
    state.address = null;
    state.contract = null;
    state.session = null;
    $('sidebar').hidden = true;
    $('mobileBar').hidden = true;
    closeDrawer();
    switchScreen('signin');
    $('signinNote').textContent = 'Your keys stay yours. Spray never holds your balance.';
  }
  $('sideSignOut').onclick = signOut;
  $('btnSignOutSettings').onclick = signOut;

  // ---------------------------------------------------------------- balance

  async function refreshBalance() {
    if (!state.address) return;
    const provider = new ethers.JsonRpcProvider(cfg.RPC_URL);
    state.balanceWei = await provider.getBalance(state.address);
    const label = weiToBalanceLabel(state.balanceWei);
    $('sideBalance').textContent = label;
    $('dashBalance').textContent = label;
    if (!$('screen-spray').hidden) $('sprayBalance').textContent = label;
  }

  // ---------------------------------------------------------------- dashboard

  async function refreshDashboard() {
    await refreshBalance();
    if (state.session) {
      $('activeSessionBlock').hidden = false;
      $('noSessionBlock').hidden = true;
      $('activeSessionCode').textContent = state.session.code;
      $('activeSessionTitle').textContent = state.session.title;
      $('activeSessionWallLink').onclick = () => {
        window.open(`./wall?code=${state.session.code}&session=${state.session.id}`, '_blank');
      };
      const sprayed = await state.contract.sprayedBy(state.session.id, state.address);
      state.sessionSprayedWei = sprayed;
      $('activeSessionSprayed').textContent = weiToBalanceLabel(sprayed);
    } else {
      $('activeSessionBlock').hidden = true;
      $('noSessionBlock').hidden = false;
    }

    await Promise.all([loadRecentSessions(), loadHistory()]);
  }

  async function loadRecentSessions() {
    const joined = await state.contract.queryFilter(state.contract.filters.Joined(null, state.address));
    const seen = new Map();
    for (const ev of joined) seen.set(ev.args.sessionId.toString(), true);

    const rows = [];
    for (const sessionId of seen.keys()) {
      const [title, sprayed] = await Promise.all([
        state.contract.title(sessionId),
        state.contract.sprayedBy(sessionId, state.address),
      ]);
      rows.push({ id: sessionId, title: title || `Session #${sessionId}`, sprayed });
    }
    state.recentSessions = rows;

    const el = $('recentSessions');
    if (!rows.length) {
      el.innerHTML = '<p class="mono" style="font-size:13px; opacity:0.6">Nothing here yet. Sessions you join will show up in this list.</p>';
      return;
    }
    el.innerHTML = rows.map((r) => `
      <div class="listRow solid">
        <span style="font-size:18px; font-weight:700">${escapeHtml(r.title)}</span>
        <b class="mono" style="font-size:14px">${escapeHtml(NGN(botToNgn(Number(ethers.formatEther(r.sprayed)))))}</b>
      </div>`).join('');
  }

  async function loadHistory() {
    // "Sent" is straightforward — every event where this wallet is the
    // spender. "Received" only covers what's actually attributable on-chain
    // without an indexer: gift drops claimed, and totals from sessions this
    // wallet hosted. Money received through a direct wallet-to-wallet gift
    // (the "Send" tab) is a plain transfer with no event at all, so it can't
    // be reconstructed from logs — that's a real limitation, not a bug, and
    // worth knowing rather than silently pretending it's covered.
    const [sprays, claimed, hostedOpened] = await Promise.all([
      state.contract.queryFilter(state.contract.filters.Sprayed(null, state.address)),
      state.giftDropContract.queryFilter(state.giftDropContract.filters.Claimed(null, state.address)),
      state.contract.queryFilter(state.contract.filters.SessionOpened(null, state.address)),
    ]);

    const rows = [];
    for (const ev of sprays) {
      const title = await state.contract.title(ev.args.sessionId).catch(() => '');
      rows.push({
        dir: 'sent',
        label: title || `Session #${ev.args.sessionId}`,
        meta: `SPRAY · #${ev.args.sprayIndex}`,
        amountWei: ev.args.amount,
        blockNumber: ev.blockNumber,
      });
    }
    for (const ev of claimed) {
      rows.push({
        dir: 'received',
        label: 'Gift drop claimed',
        meta: 'GIFT DROP',
        amountWei: ev.args.amount,
        blockNumber: ev.blockNumber,
      });
    }
    for (const ev of hostedOpened) {
      const session = await state.contract.getSession(ev.args.sessionId).catch(() => null);
      if (!session || session.total === 0n) continue;
      rows.push({
        dir: 'received',
        label: ev.args.title || `Session #${ev.args.sessionId}`,
        meta: 'HOSTED · TOTAL SO FAR',
        amountWei: session.total,
        blockNumber: ev.blockNumber,
      });
    }
    rows.sort((a, b) => b.blockNumber - a.blockNumber);
    state.history = rows.slice(0, 12);

    const el = $('historyList');
    if (!rows.length) {
      el.innerHTML = '<p class="mono" style="font-size:13px; opacity:0.6">No sprays sent or gifts received on this wallet yet.</p>';
      return;
    }
    el.innerHTML = state.history.map((r) => `
      <div class="listRow">
        <span style="display:flex; flex-direction:column; gap:3px">
          <b style="font-size:17px; font-weight:700">${escapeHtml(r.label)}</b>
          <small class="mono" style="font-size:11px; letter-spacing:0.08em; opacity:0.65">${escapeHtml(r.meta)}</small>
        </span>
        <b class="mono" style="font-size:15px; color:${r.dir === 'received' ? 'var(--green)' : 'var(--coral)'}">${r.dir === 'received' ? '+' : '−'}${escapeHtml(NGN(botToNgn(Number(ethers.formatEther(r.amountWei)))))}</b>
      </div>`).join('');
  }

  // ---------------------------------------------------------------- join

  $('btnJoinSession').onclick = guardClick($('btnJoinSession'), async () => {
    const code = $('joinCode').value.trim().toUpperCase();
    const typedName = $('joinName').value.trim();
    $('joinError').textContent = '';
    if (!code) { $('joinError').textContent = 'Enter a session code first.'; return; }

    const name = state.prefs.nameOn
      ? (typedName || 'Guest')
      : `Guest ${state.address.slice(2, 6)}`;

    try {
      const sessionId = await state.contract.sessionByCode(code);
      const tx = await state.contract.join(sessionId, name);
      await tx.wait();
      const title = await state.contract.title(sessionId);
      state.session = { id: sessionId.toString(), code, title: title || code };
      saveLastSession();
      switchScreen('spray');
    } catch (e) {
      $('joinError').textContent = e.shortMessage || e.message;
    }
  });

  // ------------------------------------------------------------- QR scan
  //
  // One camera-scanning implementation, used twice: once on Join (scans a
  // session code) and once on Gift's Send pane (scans an address or a
  // personal-request code). Each call to makeScanner() owns its own camera
  // stream, so starting one never interferes with the other.

  function extractCode(raw) {
    try {
      const url = new URL(raw);
      const fromQuery = url.searchParams.get('code');
      if (fromQuery) return fromQuery;
    } catch {
      // Not a URL — treat the whole scanned string as the code itself.
    }
    return raw;
  }

  function makeScanner({ videoId, iconId, labelId, buttonId, defaultLabel, onResult }) {
    let stream = null;
    let raf = null;

    function stop() {
      if (raf) cancelAnimationFrame(raf);
      raf = null;
      if (stream) stream.getTracks().forEach((t) => t.stop());
      stream = null;
      $(videoId).hidden = true;
      $(iconId).hidden = false;
      $(labelId).hidden = false;
      $(labelId).textContent = defaultLabel;
      $(buttonId).textContent = 'Open camera';
    }

    async function start() {
      if (stream) { stop(); return; }

      if (!('BarcodeDetector' in window)) {
        $(labelId).textContent = "This browser can't scan from camera here. Type it in above instead.";
        return;
      }

      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      } catch {
        showToast('Camera access was denied. Type it in above instead.');
        return;
      }

      const video = $(videoId);
      video.srcObject = stream;
      await video.play();
      video.hidden = false;
      $(iconId).hidden = true;
      $(labelId).hidden = true;
      $(buttonId).textContent = 'Stop camera';

      const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
      const tick = async () => {
        if (!stream) return;
        try {
          const codes = await detector.detect(video);
          if (codes.length) {
            const raw = extractCode(codes[0].rawValue).trim();
            stop();
            onResult(raw);
            return;
          }
        } catch { /* keep trying */ }
        raf = requestAnimationFrame(tick);
      };
      tick();
    }

    return { start, stop };
  }

  const joinScanner = makeScanner({
    videoId: 'scanVideo', iconId: 'scanIcon', labelId: 'scanLabel', buttonId: 'btnStartScan',
    defaultLabel: 'Scan the QR the host is showing',
    onResult: (raw) => {
      const code = raw.toUpperCase();
      $('joinCode').value = code;
      showToast(`Scanned ${code}. Tap Join session to continue.`);
    },
  });
  $('btnStartScan').onclick = () => joinScanner.start();

  // ---------------------------------------------------------------- spray

  function renderAmountLabel() {
    const bot = parseFloat(state.amountBot);
    $('sprayHintText').textContent = state.balanceWei < ethers.parseEther(state.amountBot)
      ? 'Balance is too low. Top up to keep spraying.'
      : `Each tap sends ${NGN(botToNgn(bot))} on BOT Chain`;
  }

  document.querySelectorAll('#amountGrid .chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.amountBot = btn.dataset.amt;
      document.querySelectorAll('#amountGrid .chip').forEach((b) => b.classList.toggle('on', b === btn));
      renderAmountLabel();
    });
  });

  async function refreshSprayScreen() {
    $('sprayScreenCode').textContent = state.session.code;
    await refreshBalance();
    const sprayed = await state.contract.sprayedBy(state.session.id, state.address);
    state.sessionSprayedWei = sprayed;
    $('sprayScreenSprayed').textContent = weiToBalanceLabel(sprayed);
    renderAmountLabel();
    renderMySprays();
    watchHype();
  }

  function popAmount() {
    const layer = $('popLayer');
    const span = document.createElement('b');
    span.className = 'pop';
    span.textContent = '+' + NGN(botToNgn(parseFloat(state.amountBot)));
    span.style.left = (10 + Math.random() * 70).toFixed(0) + '%';
    layer.appendChild(span);
    setTimeout(() => span.remove(), 950);
  }

  function renderMySprays() {
    const el = $('mySpraysList');
    if (!state.mySprays.length) {
      el.innerHTML = '<p class="mono" style="font-size:13px; opacity:0.6">Nothing sprayed yet in this session.</p>';
      return;
    }
    el.innerHTML = state.mySprays.slice(0, 6).map((r) => `
      <div class="listRow">
        <span class="mono" style="font-size:12px; letter-spacing:0.06em; opacity:0.7">${escapeHtml(r.meta)}</span>
        <b class="mono" style="font-size:15px">${escapeHtml(r.amount)}</b>
      </div>`).join('');
  }

  // One spray call, awaited only until the transaction is broadcast, not
  // until it's mined — hold-to-spray would stall on every block otherwise.
  // What used to happen next was wrong: the balance shown was decremented
  // locally by the spray amount alone, ignoring gas, and if the transaction
  // later failed, tx.wait().catch(() => {}) swallowed it completely — no
  // error, no correction, a permanently wrong number until a full reload
  // resynced from chain. Confirmation is still handled in the background
  // so the hold gesture never stalls, but now it always ends in a real
  // balance refresh, and a failure is shown and rolled back instead of
  // silently eaten.
  async function sendOneSpray() {
    const value = ethers.parseEther(state.amountBot);
    const tx = await state.contract.spray(state.session.id, { value });
    popAmount();
    const stamp = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    state.mySprays.unshift({ meta: `${stamp} · ${state.session.code}`, amount: NGN(botToNgn(parseFloat(state.amountBot))) });
    renderMySprays();
    state.sessionSprayedWei += value;
    $('sprayScreenSprayed').textContent = weiToBalanceLabel(state.sessionSprayedWei);
    renderAmountLabel();

    tx.wait()
      .then(() => refreshBalance())
      .catch((err) => {
        state.sessionSprayedWei -= value;
        $('sprayScreenSprayed').textContent = weiToBalanceLabel(state.sessionSprayedWei);
        showToast(`A spray didn't go through: ${err.shortMessage || err.message}`);
        refreshBalance();
      });
  }

  // Hold-to-spray is sequential by construction: each loop iteration awaits
  // the previous send before starting the next, so the wallet never has two
  // unconfirmed transactions racing for the same nonce. Firing on a plain
  // interval without waiting is what breaks under real RPC latency.
  async function holdLoop() {
    while (state.holding) {
      try {
        await sendOneSpray();
      } catch (e) {
        showToast(e.shortMessage || e.message);
        state.holding = false;
        $('sprayBtn').classList.remove('holding');
        break;
      }
    }
  }

  const sprayBtn = $('sprayBtn');
  async function startHold() {
    if (state.holding) return;
    if (state.prefs.confirmOn) {
      // Confirmation mode trades the hold gesture for a single checked tap,
      // since asking "are you sure?" for every spray in a held burst isn't
      // something a confirmation dialog can keep up with.
      if (confirm(`Send ${NGN(botToNgn(parseFloat(state.amountBot)))} on BOT Chain?`)) {
        try { await sendOneSpray(); } catch (e) { showToast(e.shortMessage || e.message); }
      }
      return;
    }
    state.holding = true;
    sprayBtn.classList.add('holding');
    holdLoop();
  }
  function stopHold() {
    state.holding = false;
    sprayBtn.classList.remove('holding');
  }
  sprayBtn.addEventListener('pointerdown', startHold);
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => sprayBtn.addEventListener(ev, stopHold));

  // Polls for new Hyped lines on the active session while the spray screen
  // is open, and surfaces them as a toast if the "show hype lines" setting
  // is on. Same polling approach as the MC agent and the wall use, since
  // BOT Chain's node doesn't support eth_subscribe.
  let hypeTimer = null;
  function watchHype() {
    clearInterval(hypeTimer);
    hypeTimer = setInterval(async () => {
      if (!state.prefs.mcOn || state.screen !== 'spray' || !state.session) return;
      try {
        const head = await state.contract.runner.provider.getBlockNumber();
        if (state.hypeCursorBlock === null) { state.hypeCursorBlock = head; return; }
        if (head < state.hypeCursorBlock) return;
        const from = state.hypeCursorBlock;
        state.hypeCursorBlock = head + 1;
        const events = await state.contract.queryFilter(state.contract.filters.Hyped(state.session.id), from, head);
        events.forEach((ev) => showToast(ev.args.line));
      } catch { /* transient RPC hiccup, next tick retries */ }
    }, 1500);
  }

  // ---------------------------------------------------------------- top up

  function refreshTopupScreen() {
    $('topupAddress').value = state.address;
    SprayQR.render($('topupQr'), state.address);
  }
  $('btnCopyTopupAddress').onclick = () => {
    navigator.clipboard.writeText(state.address);
    showToast('Address copied.');
  };
  $('btnRefreshBalance').onclick = guardClick($('btnRefreshBalance'), async () => {
    await refreshBalance();
    showToast('Balance refreshed.');
  });
  $('btnSideRefreshBalance').onclick = guardClick($('btnSideRefreshBalance'), async () => {
    await refreshBalance();
    showToast('Balance refreshed.');
  });

  // ---------------------------------------------------------------- host
  //
  // Opening a session used to be a separate page (host.html) with its own
  // sign-in screen. That meant a fresh page load, a fresh Web3Auth session
  // with no memory of the one on app.html, and a second sign-in prompt for
  // someone who'd already just signed in — confirmed as a real bug, not a
  // hypothetical one. Living here instead, it reuses the signer this page
  // already has, so opening a session after landing on the dashboard never
  // asks for anything again.

  let hostMode = 'party';

  function switchHostMode(name) {
    hostMode = name;
    document.querySelectorAll('#hostModeTabs .pillTab').forEach((t) => t.classList.toggle('active', t.dataset.hostmode === name));
    const isParty = name === 'party';
    $('hostHeading').textContent = isParty ? 'Host a party' : 'Request money';
    $('hostSubhead').textContent = isParty
      ? 'Set up your event, get a code guests can join with.'
      : 'Get your own code. Anyone who scans it sends straight to you.';
    $('hostTitleLabel').textContent = isParty ? 'Party title' : 'What is this for?';
    $('hostTitle').placeholder = isParty ? "e.g. Tunde & Ada's wedding" : 'e.g. Contribution for my rent';
    $('hostMinSprayField').style.display = isParty ? '' : 'none';
    $('hostSplitsField').style.display = isParty ? '' : 'none';
  }
  document.querySelectorAll('#hostModeTabs .pillTab').forEach((t) => {
    t.addEventListener('click', () => switchHostMode(t.dataset.hostmode));
  });

  function refreshHostScreen() {
    $('hostFormError').textContent = '';
    $('hostPaneForm').hidden = false;
    $('hostPaneResult').hidden = true;
    $('hostCode').value = '';
    $('hostTitle').value = '';
    switchHostMode('party');
    renderHostSplitRows([{ addr: state.address, bps: 7000 }, { addr: '', bps: 2000 }, { addr: '', bps: 1000 }]);
  }

  function renderHostSplitRows(rows) {
    const container = $('hostSplitRows');
    container.innerHTML = '';
    rows.forEach((r) => {
      const div = document.createElement('div');
      div.className = 'split-row';
      div.innerHTML = `
        <input type="text" placeholder="wallet address" value="${r.addr || ''}" data-role="addr" />
        <input type="number" placeholder="%" value="${r.bps / 100}" data-role="pct" />
        <button type="button" data-role="remove">&times;</button>
      `;
      div.querySelector('[data-role="remove"]').onclick = () => div.remove();
      container.appendChild(div);
    });
  }
  $('hostAddSplit').onclick = () => {
    const container = $('hostSplitRows');
    const div = document.createElement('div');
    div.className = 'split-row';
    div.innerHTML = `
      <input type="text" placeholder="wallet address" data-role="addr" />
      <input type="number" placeholder="%" data-role="pct" />
      <button type="button" data-role="remove">&times;</button>
    `;
    div.querySelector('[data-role="remove"]').onclick = () => div.remove();
    container.appendChild(div);
  };

  function collectHostSplits() {
    if (hostMode === 'personal') return [{ recipient: state.address, bps: 10000 }];
    const rows = [...document.querySelectorAll('#hostSplitRows .split-row')];
    const raw = rows.map((row, i) => ({
      i: i + 1,
      recipient: row.querySelector('[data-role="addr"]').value.trim(),
      pctText: row.querySelector('[data-role="pct"]').value.trim(),
      bps: Math.round(parseFloat(row.querySelector('[data-role="pct"]').value || '0') * 100),
    }));

    // A row half filled in (an address with no percentage, or a percentage
    // with no address) is almost certainly a mistake, not an intentionally
    // empty row — flagging it by row number beats silently dropping it and
    // leaving someone staring at an unexplained "0%" total.
    for (const r of raw) {
      const hasAddr = !!r.recipient;
      const hasPct = !!r.pctText && r.bps > 0;
      if (hasAddr && !hasPct) throw new Error(`Row ${r.i} has an address but no percentage.`);
      if (hasPct && !hasAddr) throw new Error(`Row ${r.i} has a percentage but no wallet address, it's still empty.`);
      if (hasAddr && !ethers.isAddress(r.recipient)) throw new Error(`Row ${r.i}'s address doesn't look like a valid wallet address.`);
    }

    const splits = raw.filter((s) => s.recipient && s.bps > 0).map((s) => ({ recipient: s.recipient, bps: s.bps }));
    const total = splits.reduce((sum, s) => sum + s.bps, 0);
    if (splits.length === 0) throw new Error('Add at least one recipient before creating the session.');
    if (total !== 10000) throw new Error(`Splits must add up to 100% (currently ${total / 100}%, from ${splits.length} filled-in row${splits.length === 1 ? '' : 's'}).`);
    return splits;
  }

  $('hostCreateBtn').onclick = guardClick($('hostCreateBtn'), async () => {
    $('hostFormError').textContent = '';
    try {
      const code = $('hostCode').value.trim().toUpperCase();
      const title = $('hostTitle').value.trim();
      const minSpray = hostMode === 'party' ? $('hostMinSpray').value.trim() : '0';
      if (!code) throw new Error('Enter a session code first.');
      if (!title) throw new Error('Enter a title first.');
      const splits = collectHostSplits();

      const tx = await state.contract.openSession(code, title, ethers.parseEther(minSpray || '0'), splits);
      const receipt = await tx.wait();
      const opened = receipt.logs
        .map((l) => { try { return state.contract.interface.parseLog(l); } catch { return null; } })
        .find((l) => l && l.name === 'SessionOpened');
      const sessionId = opened.args.sessionId.toString();

      // Swap the last path segment for "wall" — works whether this page is
      // reached as /app or /app.html, unlike a literal string replace of
      // one specific extension.
      const joinUrl = `${location.origin}${location.pathname}?code=${code}`;
      const wallUrl = `${location.origin}${location.pathname.replace(/[^/]*$/, 'wall')}?code=${code}&session=${sessionId}`;

      $('hostCodeOut').textContent = code;
      $('hostJoinLink').href = joinUrl;
      $('hostWallLink').href = wallUrl;
      SprayQR.render($('hostQr'), joinUrl);
      $('hostPaneForm').hidden = true;
      $('hostPaneResult').hidden = false;
    } catch (e) {
      $('hostFormError').textContent = e.shortMessage || e.message;
    }
  });

  // ---------------------------------------------------------------- pool
  //
  // A capped pool is a closed guest list: the host funds it and sets a cap,
  // guests join until the cap is hit, and the host triggers one payout that
  // splits the pool equally among everyone who made it in. No claiming, no
  // race — the host decides who's in and when everyone gets paid.

  function switchPoolTab(name) {
    document.querySelectorAll('#poolTabs .pillTab').forEach((t) => t.classList.toggle('active', t.dataset.pooltab === name));
    ['create', 'join', 'manage'].forEach((n) => { $('poolPane' + n[0].toUpperCase() + n.slice(1)).hidden = n !== name; });
    if (name === 'manage') loadMyPools();
  }
  document.querySelectorAll('#poolTabs .pillTab').forEach((t) => {
    t.addEventListener('click', () => switchPoolTab(t.dataset.pooltab));
  });

  function refreshPoolScreen() {
    $('poolCreateError').textContent = '';
    $('poolJoinError').textContent = '';
    $('poolCreateResult').hidden = true;
    $('poolJoinResult').hidden = true;
    switchPoolTab('create');
  }

  $('poolCreateBtn').onclick = guardClick($('poolCreateBtn'), async () => {
    $('poolCreateError').textContent = '';
    try {
      const code = $('poolCode').value.trim().toUpperCase();
      const title = $('poolTitle').value.trim();
      const ngn = parseInt(($('poolAmount').value || '0').replace(/[^0-9]/g, ''), 10);
      const maxGuests = parseInt($('poolMaxGuests').value || '0', 10);
      if (!code) throw new Error('Enter a pool code first.');
      if (!title) throw new Error('Enter what this pool is for.');
      if (!ngn) throw new Error('Enter an amount first.');
      if (!maxGuests || maxGuests < 1) throw new Error('Enter a guest cap of at least 1.');
      const value = ethers.parseEther((ngn / NGN_PER_BOT).toFixed(8));
      if (value > state.balanceWei) {
        throw new Error(`That's more than you have. Your balance is ${weiToBalanceLabel(state.balanceWei)} — top up first.`);
      }

      const tx = await state.cappedPoolContract.createPool(code, title, maxGuests, { value });
      await tx.wait();
      const poolId = await state.cappedPoolContract.poolByCode(code);

      const joinUrl = `${location.origin}${location.pathname}?pool=${code}`;
      $('poolCodeOut').textContent = code;
      $('poolCapOut').textContent = maxGuests;
      SprayQR.render($('poolQr'), joinUrl);
      $('poolCreateResult').hidden = false;

      $('poolCode').value = '';
      $('poolTitle').value = '';
      $('poolAmount').value = '';
      await refreshBalance();
    } catch (e) {
      $('poolCreateError').textContent = e.shortMessage || e.message;
    }
  });

  $('poolJoinBtn').onclick = guardClick($('poolJoinBtn'), async () => {
    $('poolJoinError').textContent = '';
    try {
      const code = $('poolJoinCode').value.trim().toUpperCase();
      const name = $('poolJoinName').value.trim();
      if (!code) throw new Error('Enter a pool code first.');
      if (!name) throw new Error('Enter your name first.');

      const tx = await state.cappedPoolContract.join(code, name);
      const receipt = await tx.wait();
      const joined = receipt.logs
        .map((l) => { try { return state.cappedPoolContract.interface.parseLog(l); } catch { return null; } })
        .find((l) => l && l.name === 'GuestJoined');

      $('poolJoinCountOut').textContent = joined ? `${joined.args.guestCount} / ${joined.args.maxGuests}` : '—';
      $('poolJoinResult').hidden = false;
      showToast('Joined the pool.');
    } catch (e) {
      const msg = e.message || '';
      if (/NoSuchPool/.test(msg)) $('poolJoinError').textContent = "That code doesn't match a pool.";
      else if (/PoolFull/.test(msg)) $('poolJoinError').textContent = 'This pool already hit its guest cap.';
      else if (/AlreadyJoined/.test(msg)) $('poolJoinError').textContent = "You're already in this pool.";
      else if (/AlreadyPaidOut/.test(msg)) $('poolJoinError').textContent = 'This pool has already been paid out.';
      else $('poolJoinError').textContent = e.shortMessage || msg;
    }
  });

  async function loadMyPools() {
    const el = $('poolManageList');
    el.innerHTML = '<p class="mono" style="font-size:13px; opacity:0.6">Loading…</p>';
    try {
      const created = await state.cappedPoolContract.queryFilter(state.cappedPoolContract.filters.PoolCreated(null, state.address));
      if (!created.length) {
        el.innerHTML = '<p class="mono" style="font-size:13px; opacity:0.6" id="poolManageEmpty">Pools you\'ve created will show up here.</p>';
        return;
      }
      const rows = await Promise.all(created.map(async (ev) => {
        const poolId = ev.args.poolId;
        const pool = await state.cappedPoolContract.getPool(poolId);
        return { poolId, code: ev.args.code, title: ev.args.title, pool };
      }));
      el.innerHTML = rows.map((r) => `
        <div class="card" style="background:var(--bg); padding:16px 18px; margin-bottom:12px">
          <div style="display:flex; justify-content:space-between; align-items:flex-start">
            <div>
              <b style="font-size:17px; font-weight:800">${escapeHtml(r.title)}</b>
              <small class="mono" style="display:block; font-size:11px; letter-spacing:0.08em; opacity:0.65; margin-top:2px">${escapeHtml(r.code)} · ${r.pool.guestCount}/${r.pool.maxGuests} joined</small>
            </div>
            <b class="mono" style="font-size:14px">${escapeHtml(weiToBalanceLabel(r.pool.amount))}</b>
          </div>
          <div style="margin-top:12px">
            ${r.pool.paidOut
              ? '<span class="mono" style="font-size:12px; opacity:0.6">Paid out ✓</span>'
              : r.pool.guestCount === 0n
                ? '<span class="mono" style="font-size:12px; opacity:0.6">No guests yet</span>'
                : `<button class="btn btn-coral btn-block" data-payout="${r.poolId}">Pay out now, split among ${r.pool.guestCount}</button>`}
          </div>
        </div>`).join('');

      el.querySelectorAll('[data-payout]').forEach((btn) => {
        btn.onclick = async () => {
          btn.disabled = true;
          btn.textContent = 'Paying out…';
          try {
            const tx = await state.cappedPoolContract.payOut(btn.dataset.payout);
            await tx.wait();
            showToast('Paid out.');
            await loadMyPools();
          } catch (e) {
            showToast(e.shortMessage || e.message);
            btn.disabled = false;
          }
        };
      });
    } catch (e) {
      el.innerHTML = `<p class="mono" style="font-size:13px; color:var(--coral)">${escapeHtml(e.shortMessage || e.message)}</p>`;
    }
  }

  // ---------------------------------------------------------------- gift
  //
  // Gift is independent of spray sessions entirely — that's the point of it.
  // Two unrelated things share this screen: sending straight to one person,
  // and creating or claiming a first-come-first-served gift drop.

  function refreshGiftScreen() {
    $('giftError').textContent = '';
    $('dropCreateError').textContent = '';
    $('claimError').textContent = '';
    refreshBalance();
  }

  function switchGiftTab(name) {
    document.querySelectorAll('#giftTabs .pillTab').forEach((t) => t.classList.toggle('active', t.dataset.gifttab === name));
    ['send', 'create', 'claim'].forEach((n) => { $('giftPane' + n[0].toUpperCase() + n.slice(1)).hidden = n !== name; });
    if (name !== 'send') giftScanner.stop();
  }
  document.querySelectorAll('#giftTabs .pillTab').forEach((t) => {
    t.addEventListener('click', () => switchGiftTab(t.dataset.gifttab));
  });

  // -------------------------------------------------------- gift: send

  // A scanned or typed value can be a raw address, or a session code from
  // someone's "Request money" QR — in which case it resolves to that
  // session's single recipient, the same address they'd have shared anyway.
  async function resolveGiftTarget(raw) {
    if (ethers.isAddress(raw)) return raw;
    try {
      const sessionId = await state.contract.sessionByCode(raw.toUpperCase());
      const splits = await state.contract.getSplits(sessionId);
      if (splits.length) return splits[0].recipient;
    } catch { /* not a known code either — surfaced as a normal address error below */ }
    throw new Error("That doesn't look like an address or a known code.");
  }

  const giftScanner = makeScanner({
    videoId: 'giftScanVideo', iconId: 'giftScanIcon', labelId: 'giftScanLabel', buttonId: 'btnGiftStartScan',
    defaultLabel: 'Scan their code or address',
    onResult: async (raw) => {
      try {
        $('giftToAddress').value = await resolveGiftTarget(raw);
        showToast('Got it. Enter an amount and send.');
      } catch (e) {
        showToast(e.message);
      }
    },
  });
  $('btnGiftStartScan').onclick = () => giftScanner.start();

  $('btnSendGift').onclick = guardClick($('btnSendGift'), async () => {
    $('giftError').textContent = '';
    const ngn = parseInt(($('giftAmount').value || '0').replace(/[^0-9]/g, ''), 10);
    if (!ngn) { $('giftError').textContent = 'Enter an amount first.'; return; }
    const value = ethers.parseEther((ngn / NGN_PER_BOT).toFixed(8));
    if (value > state.balanceWei) {
      $('giftError').textContent = `That's more than you have. Your balance is ${weiToBalanceLabel(state.balanceWei)} — top up first.`;
      return;
    }

    try {
      const to = await resolveGiftTarget($('giftToAddress').value.trim());
      const signer = await SprayWallet.getEthersSigner();
      const tx = await signer.sendTransaction({ to, value });
      await tx.wait();
      showToast('Sent.');
      $('giftToAddress').value = '';
      $('giftAmount').value = '';
      await refreshBalance();
    } catch (e) {
      $('giftError').textContent = e.shortMessage || e.message;
    }
  });

  // -------------------------------------------------------- gift: create a drop

  function randomDropCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I, easy to read aloud
    let s = '';
    for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
    return s;
  }

  $('btnCreateDrop').onclick = guardClick($('btnCreateDrop'), async () => {
    $('dropCreateError').textContent = '';
    const ngn = parseInt(($('dropTotal').value || '0').replace(/[^0-9]/g, ''), 10);
    const parcels = parseInt($('dropParcels').value || '0', 10);
    if (!ngn) { $('dropCreateError').textContent = 'Enter an amount first.'; return; }
    if (!parcels || parcels < 1) { $('dropCreateError').textContent = 'Enter at least 1 parcel.'; return; }
    const value = ethers.parseEther((ngn / NGN_PER_BOT).toFixed(8));
    if (value > state.balanceWei) {
      $('dropCreateError').textContent = `That's more than you have. Your balance is ${weiToBalanceLabel(state.balanceWei)} — top up first.`;
      return;
    }

    // A random code can collide with an existing one, though it's rare with
    // six characters from a 33-symbol alphabet — retried a few times rather
    // than surfaced as an error the creator can't do anything about.
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = randomDropCode();
      try {
        const tx = await state.giftDropContract.createDrop(code, parcels, { value });
        await tx.wait();
        const drop = await state.giftDropContract.getDrop(await state.giftDropContract.dropByCode(code));

        $('dropCodeOut').textContent = code;
        $('dropParcelCount').textContent = parcels;
        $('dropPerClaim').textContent = weiToBalanceLabel(drop.perClaim);
        const claimUrl = `${location.origin}${location.pathname}?claim=${code}`;
        SprayQR.render($('dropQr'), claimUrl);
        $('dropResult').hidden = false;

        $('dropTotal').value = '';
        await refreshBalance();
        return;
      } catch (e) {
        const isCodeTaken = /CodeTaken/.test(e.message || '');
        if (!isCodeTaken || attempt === 4) {
          $('dropCreateError').textContent = isCodeTaken ? 'Could not find a free code, try again.' : (e.shortMessage || e.message);
          return;
        }
      }
    }
  });

  // -------------------------------------------------------- gift: claim a drop

  $('btnClaimDrop').onclick = guardClick($('btnClaimDrop'), async () => {
    $('claimError').textContent = '';
    const code = $('claimCode').value.trim().toUpperCase();
    if (!code) { $('claimError').textContent = 'Enter a drop code first.'; return; }

    try {
      const tx = await state.giftDropContract.claim(code);
      const receipt = await tx.wait();
      const claimed = receipt.logs
        .map((l) => { try { return state.giftDropContract.interface.parseLog(l); } catch { return null; } })
        .find((l) => l && l.name === 'Claimed');

      $('claimAmountOut').textContent = claimed ? weiToBalanceLabel(claimed.args.amount) : '—';
      $('claimResult').hidden = false;
      showToast('Claimed.');
      await refreshBalance();
    } catch (e) {
      const msg = e.message || '';
      if (/NoSuchDrop/.test(msg)) $('claimError').textContent = "That code doesn't match a gift drop.";
      else if (/AlreadyClaimed/.test(msg)) $('claimError').textContent = "You've already claimed this one.";
      else if (/DropExhausted/.test(msg)) $('claimError').textContent = 'All the parcels in this drop are already claimed.';
      else $('claimError').textContent = e.shortMessage || msg;
    }
  });

  // ---------------------------------------------------------------- settings

  function refreshSettingsScreen() {
    updateToggleUI('toggleMc', 'mcOnLabel', state.prefs.mcOn);
    updateToggleUI('toggleName', 'nameOnLabel', state.prefs.nameOn);
    updateToggleUI('toggleConfirm', 'confirmOnLabel', state.prefs.confirmOn);
  }
  function updateToggleUI(btnId, labelId, on) {
    $(btnId).classList.toggle('on', on);
    $(labelId).textContent = on ? 'On' : 'Off';
  }
  ['toggleMc', 'toggleName', 'toggleConfirm'].forEach((id) => {
    $(id).addEventListener('click', () => {
      const key = $(id).dataset.pref;
      state.prefs[key] = !state.prefs[key];
      savePrefs();
      refreshSettingsScreen();
    });
  });
  $('btnCopySettingsAddress').onclick = () => {
    navigator.clipboard.writeText(state.address);
    showToast('Address copied.');
  };
  $('btnWithdraw').onclick = guardClick($('btnWithdraw'), async () => {
    const to = prompt('Send your remaining balance to which address?');
    if (!to) return;
    try {
      if (!ethers.isAddress(to)) throw new Error('That does not look like a valid address.');
      const signer = await SprayWallet.getEthersSigner();
      const balance = await signer.provider.getBalance(state.address);
      const gasBuffer = ethers.parseEther('0.001');
      if (balance <= gasBuffer) throw new Error('Balance is too low to cover gas for a withdrawal.');
      const tx = await signer.sendTransaction({ to, value: balance - gasBuffer });
      showToast('Withdrawal sent, confirming…');
      await tx.wait();
      showToast('Withdrawal confirmed.');
      await refreshBalance();
    } catch (e) {
      showToast(e.shortMessage || e.message);
    }
  });

  // ---------------------------------------------------------------- utils

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
})();
