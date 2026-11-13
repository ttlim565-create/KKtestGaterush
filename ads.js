// 广告封装：只在应用内、玩家自然停顿处展示。
// TEST = true 时使用 Google 官方测试广告 ID，开发期间请保持 true。
// 上线前：TEST 改 false，并把下面的 ID 换成你在 AdMob 后台创建的真实广告单元 ID。
(function () {
  const TEST = true;
  const IDS = {
    interstitial: 'ca-app-pub-3940256099942544/1033173712', // 官方测试插屏
    rewarded: 'ca-app-pub-3940256099942544/5224354917'      // 官方测试激励视频
  };
  const MIN_GAP_MS = 60000; // 两次插屏之间至少间隔 60 秒

  const cap = window.Capacitor;
  const native = !!(cap && cap.isNativePlatform && cap.isNativePlatform());
  let AdMob = null;
  if (native) { try { AdMob = cap.registerPlugin('AdMob'); } catch (e) { AdMob = null; } }
  let lastInterstitial = 0;

  async function init() {
    if (!AdMob) return;
    try { await AdMob.initialize({ initializeForTesting: TEST }); } catch (e) {}
  }

  // 插屏：间隔不足或加载失败时直接继续游戏，不会卡住
  async function maybeInterstitial(done) {
    let finished = false;
    const finish = () => { if (!finished) { finished = true; done(); } };
    if (!AdMob || Date.now() - lastInterstitial < MIN_GAP_MS) { finish(); return; }
    try {
      const handle = await AdMob.addListener('onInterstitialAdDismissed', () => {
        try { handle.remove(); } catch (e) {}
        finish();
      });
      await AdMob.prepareInterstitial({ adId: IDS.interstitial, isTesting: TEST });
      lastInterstitial = Date.now();
      await AdMob.showInterstitial();
      setTimeout(finish, 60000);
    } catch (e) { finish(); }
  }

  // 激励视频：玩家主动点击才会出现，看完才给奖励
  async function showRewarded(onReward, onFail) {
    if (!AdMob) {
      // 网页预览时的模拟
      if (window.confirm('（测试）模拟看完一条激励广告？')) onReward(); else onFail();
      return;
    }
    let rewarded = false, settled = false;
    const settle = () => { if (settled) return; settled = true; if (rewarded) onReward(); else onFail(); };
    try {
      const h1 = await AdMob.addListener('onRewardedVideoAdReward', () => { rewarded = true; });
      const h2 = await AdMob.addListener('onRewardedVideoAdDismissed', () => {
        try { h1.remove(); h2.remove(); } catch (e) {}
        settle();
      });
      await AdMob.prepareRewardVideoAd({ adId: IDS.rewarded, isTesting: TEST });
      await AdMob.showRewardVideoAd();
    } catch (e) { settle(); }
  }

  window.Ads = { init, maybeInterstitial, showRewarded };
})();
