(function() {
  if (window.__discord_shield_v8_active) return;
  window.__discord_shield_v8_active = true;

  const regexLagChars = /[\u{10000}-\u{10FFFF}]/gu;
  const regexEscapedLag = /(?:\\u[dD][89abAB][0-9a-fA-F]{2}\\u[dD][c-fC-F][0-9a-fA-F]{2})|(?:u[dD][89abAB][0-9a-fA-F]{2}u[dD][c-fC-F][0-9a-fA-F]{2})/g;

  // 通信・データ用の無害化関数
  function TIGHT_SANITIZE(rawText) {
    if (typeof rawText !== 'string') return rawText;
    let temp = rawText;
    if (regexEscapedLag.test(temp)) temp = temp.replace(regexEscapedLag, 'SafeText');
    if (temp.match(regexLagChars)) temp = temp.replace(regexLagChars, 'SafeText');
    if (temp.includes('𩸽')) temp = temp.replaceAll('𩸽', 'SafeText');
    return temp;
  }

  // ==========================================
  // 新機能: 画面（HTML）に直接現れたラグ文字を消し去る
  // ==========================================
  function DOM_SANITIZE(node) {
    // テキストノード（文字そのもの）の場合
    if (node.nodeType === Node.TEXT_NODE) {
      if (node.nodeValue.match(regexLagChars) || node.nodeValue.includes('𩸽')) {
        node.nodeValue = node.nodeValue.replace(regexLagChars, 'SafeText').replaceAll('𩸽', 'SafeText');
      }
    } else {
      // 子ノードをループして全スキャン
      for (let child of node.childNodes) {
        DOM_SANITIZE(child);
      }
    }
  }

  // 画面の変化を24時間ミリ秒単位で監視するセンサー
  const observer = new MutationObserver((mutations) => {
    for (let mutation of mutations) {
      for (let addedNode of mutation.addedNodes) {
        DOM_SANITIZE(addedNode);
      }
    }
  });
  
  // ページ全体の監視を開始
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });

  // ==========================================
  // 1. WebSocket (リアルタイム通信の防御)
  // ==========================================
  const OriginalWebSocket = window.WebSocket;
  window.WebSocket = function(url, protocols) {
    const ws = new OriginalWebSocket(url, protocols);
    ws.addEventListener('message', function(event) {
      if (typeof event.data === 'string') {
        const cleanData = TIGHT_SANITIZE(event.data);
        Object.defineProperty(event, 'data', {
          configurable: true, enumerable: true, writable: false, value: cleanData
        });
      }
    });
    return ws;
  };

  // ==========================================
  // 2. Fetch (API通信の防御)
  // ==========================================
  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const url = (args[0] && typeof args[0] === 'object') ? args[0].url : (args[0] || "");
    const response = await originalFetch(...args);
    
    if (typeof url === 'string' && url.includes('/api/')) {
      const cloneRes = response.clone();
      let rawText = await cloneRes.text();
      rawText = TIGHT_SANITIZE(rawText);
      return new Response(rawText, {
        status: response.status, statusText: response.statusText, headers: response.headers
      });
    }
    return response;
  };

  console.log('%c🛡️ [Shield v8] 通信＋画面監視の究極ハイブリッドシールドが起動しました。', 'color: #00ffff; font-weight: bold;');
})();