// Shared embedded-wallet module, used by every page that needs to sign a
// transaction (app.html). wall.html does not need this, since it
// only reads chain state.
//
// Two sign-in paths, both producing a normal EIP-1193 provider:
//   - signInWithEmail(): Web3Auth email/social login -> embedded wallet.
//     This is the real target experience — a guest never sees a seed phrase
//     and the wallet survives a cleared browser, because it's keyed to their
//     login, not to local storage. Needs a Client ID from
//     https://developer.metamask.io (Web3Auth's dashboard now redirects
//     there — the product was folded into MetaMask's developer platform),
//     set as WEB3AUTH_CLIENT_ID in config.js.
//   - connectInjected(): a normal browser wallet (MetaMask etc). Kept as a
//     fallback so the app is testable today, before a Client ID exists.
//
// Both paths end up behind the same interface, so the rest of the app never
// has to know which one is in use.
window.SprayWallet = (function () {
  const cfg = window.SPRAY_CONFIG;
  let web3auth = null;
  let currentProvider = null; // EIP-1193 provider, from either path above

  async function initWeb3Auth() {
    if (web3auth) return web3auth;
    // The @web3auth/modal UMD bundle exports its global as `Modal`, with the
    // Web3Auth class nested at `Modal.Web3Auth` — confirmed by inspecting
    // window.Modal at runtime, since this isn't obvious from the package name.
    if (!window.Modal || !window.Modal.Web3Auth) {
      throw new Error("Web3Auth SDK failed to load (check the script tag / network).");
    }
    if (!window.EthereumProvider || !window.EthereumProvider.EthereumPrivateKeyProvider) {
      throw new Error("Web3Auth's Ethereum provider package failed to load (check the script tag / network).");
    }
    if (!cfg.WEB3AUTH_CLIENT_ID) {
      throw new Error("No Web3Auth Client ID set yet. Get a free one at developer.metamask.io and add it to web/config.js as WEB3AUTH_CLIENT_ID.");
    }

    const chainConfig = {
      chainNamespace: "eip155",
      chainId: cfg.CHAIN_ID_HEX,
      rpcTarget: cfg.RPC_URL,
      displayName: "BOT Chain",
      ticker: "BOT",
      tickerName: "BOT",
      blockExplorerUrl: cfg.EXPLORER_URL,
    };

    // This SDK version requires an explicit private-key provider rather than
    // accepting chainConfig on its own — passing chainConfig alone fails
    // with "privateKeyProvider is required". EthereumPrivateKeyProvider
    // ships in a separate package/script tag (@web3auth/ethereum-provider),
    // exposed as window.EthereumProvider.
    const privateKeyProvider = new window.EthereumProvider.EthereumPrivateKeyProvider({
      config: { chainConfig },
    });

    web3auth = new window.Modal.Web3Auth({
      clientId: cfg.WEB3AUTH_CLIENT_ID,
      // Client IDs issued through the current (MetaMask-run) dashboard are
      // provisioned against the production Sapphire network. "sapphire_devnet"
      // looks like the obvious choice for a test project but fails with
      // "Wallet is not ready yet, failed to fetch project configurations" —
      // confirmed by testing both values directly against a real Client ID.
      web3AuthNetwork: "sapphire_mainnet",
      chainConfig,
      privateKeyProvider,
      // uiConfig (appName, theme, borderRadiusType, etc.) is Web3Auth's
      // "whitelabel" feature, gated behind a paid plan — confirmed the hard
      // way: passing it doesn't error at initModal(), only at actual
      // connect() time, with "requesting features (whitelabel) are not
      // available on base plan". This account is on the free tier, so no
      // uiConfig at all. The popup shows Web3Auth's own default branding
      // until/unless that plan changes.
    });
    await web3auth.initModal();
    return web3auth;
  }

  // Web3Auth's modal already presents email, phone, and social choices on
  // its own screen. Calling it from three separate buttons on our screen
  // just made the user pick a method twice in a row — once on our page,
  // then again inside Web3Auth's popup. So there's one sign-in entry point
  // here, and Web3Auth's modal is the only place the method gets chosen.
  async function signIn() {
    const w3a = await initWeb3Auth();
    currentProvider = await w3a.connect();
    return addressFromProvider(currentProvider);
  }

  // Web3Auth's own session survives a refresh — our in-memory currentProvider
  // doesn't, since it's just a JS variable that resets on every page load.
  // initModal() itself already attempts to restore a prior session; when it
  // succeeds, .connected is true and .provider is ready immediately, no
  // popup, no connect() call. This is what makes a refresh feel signed-in
  // instead of bouncing back to the sign-in screen every time.
  async function tryRestoreSession() {
    try {
      const w3a = await initWeb3Auth();
      if (!w3a.connected || !w3a.provider) return null;
      currentProvider = w3a.provider;
      return addressFromProvider(currentProvider);
    } catch {
      return null;
    }
  }

  async function connectInjected() {
    if (!window.ethereum) throw new Error("No browser wallet found (e.g. MetaMask).");
    await window.ethereum.request({ method: "eth_requestAccounts" });
    await ensureChain(window.ethereum);
    currentProvider = window.ethereum;
    return addressFromProvider(currentProvider);
  }

  async function ensureChain(provider) {
    try {
      await provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: cfg.CHAIN_ID_HEX }],
      });
    } catch (err) {
      if (err.code === 4902) {
        await provider.request({
          method: "wallet_addEthereumChain",
          params: [{
            chainId: cfg.CHAIN_ID_HEX,
            chainName: "BOT Chain",
            nativeCurrency: { name: "BOT", symbol: "BOT", decimals: 18 },
            rpcUrls: [cfg.RPC_URL],
            blockExplorerUrls: [cfg.EXPLORER_URL],
          }],
        });
      } else {
        throw err;
      }
    }
  }

  async function addressFromProvider(provider) {
    const accounts = await provider.request({ method: "eth_accounts" });
    return accounts[0];
  }

  function getEthersSigner() {
    if (!currentProvider) throw new Error("Not signed in yet.");
    const browserProvider = new ethers.BrowserProvider(currentProvider);
    return browserProvider.getSigner();
  }

  function isSignedIn() {
    return !!currentProvider;
  }

  async function getAddress() {
    if (!currentProvider) throw new Error("Not signed in yet.");
    return addressFromProvider(currentProvider);
  }

  async function signOut() {
    if (web3auth && web3auth.connected) await web3auth.logout();
    currentProvider = null;
  }

  return {
    signIn, connectInjected, tryRestoreSession,
    getEthersSigner, getAddress, isSignedIn, signOut,
  };
})();
