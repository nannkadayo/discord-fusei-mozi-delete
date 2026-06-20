// ==========================================
// 🎛️ WebSocket インターセプター (ゴースト引き継ぎ・起動保証版)
// ==========================================
(function() {
    // 🚨 ゴースト状態を引き継ぐためのグローバルマーカー（初期起動は邪魔しない）
    if (window.__next_ws_ghost === undefined) {
        window.__next_ws_ghost = false;
    }

    const OriginalWebSocket = window.WebSocket;
    window.WebSocket = function(url, protocols) {
        const ws = new OriginalWebSocket(url, protocols);
        ws.binaryType = 'arraybuffer'; 

        const regexLagChars = /[\u{10000}-\u{10FFFF}]/gu;
        const regexEscapedLag = /(?:\\u[dD][89abAB][0-9a-fA-F]{2}\\u[dD][c-fC-F][0-9a-fA-F]{2})|(?:u[dD][89abAB][0-9a-fA-F]{2}u[dD][c-fC-F][0-9a-fA-F]{2})/g;

        let packetBuffer = new Uint8Array(0);
        
        // 🌟 すでに過去に検知済みなら、このソケットは生まれた瞬間からブロック状態でスタート
        let isBlocked = window.__next_ws_ghost;

        // zlibコンテキスト維持用
        const decompressor = new DecompressionStream('deflate');
        const decWriter = decompressor.writable.getWriter();
        const decReader = decompressor.readable.getReader();

        // 🛑 このソケットをフリーズさせ、次回の再接続にも呪いを引き継ぐ関数
        const freezeSocketComplete = () => {
            isBlocked = true;
            window.__next_ws_ghost = true; // 🌟 次に作られるソケットも最初からゴーストにする
            console.error('🛑 [Shield] ターゲットを検知！このソケットと、今後の再接続をすべて「ゴースト状態」にします。');

            ws.send = function() {}; // 送信破壊
            userOnMessage = null;    // コールバック破壊
        };

        // もし最初からブロック状態のソケットなら、念のため送信機能も即座に潰しておく
        if (isBlocked) {
            ws.send = function() {};
        }

        // メインハンドラー
        const handleMessage = async (event) => {
            if (isBlocked) {
                event.stopImmediatePropagation();
                event.preventDefault();
                return true;
            }

            // 平文チェック
            if (typeof event.data === 'string') {
                if (event.data.includes('"op":40') || event.data.includes('foregrounded')) {
                    freezeSocketComplete();
                    event.stopImmediatePropagation();
                    event.preventDefault();
                    return true;
                }
            }

            // バイナリパケット（zlib）の処理
            if (event.data instanceof ArrayBuffer) {
                try {
                    const chunk = new Uint8Array(event.data);
                    const newBuffer = new Uint8Array(packetBuffer.length + chunk.length);
                    newBuffer.set(packetBuffer);
                    newBuffer.set(chunk, packetBuffer.length);
                    packetBuffer = newBuffer;

                    const len = packetBuffer.length;
                    if (len >= 4 &&
                        packetBuffer[len - 4] === 0x00 &&
                        packetBuffer[len - 3] === 0x00 &&
                        packetBuffer[len - 2] === 0xff &&
                        packetBuffer[len - 1] === 0xff) {
                        
                        const fullPacket = packetBuffer;
                        packetBuffer = new Uint8Array(0); 

                        let decompressedText = "";
                        try {
                            decWriter.write(fullPacket);
                            const { value } = await decReader.read();
                            if (value) decompressedText = new TextDecoder().decode(value);
                        } catch (e) { return false; }

                        if (decompressedText) {
                            if (decompressedText.includes('"op":40') || decompressedText.includes('foregrounded')) {
                                freezeSocketComplete();
                                event.stopImmediatePropagation();
                                event.preventDefault();
                                return true;
                            }

                            // 通常のラグ文字クリーニング
                            if (regexLagChars.test(decompressedText) || decompressedText.includes('𩸽') || regexEscapedLag.test(decompressedText)) {
                                console.warn('🛡️ [Shield] ラグパケットを検知・書き換え中...');
                                let temp = decompressedText;
                                if (regexEscapedLag.test(temp)) temp = temp.replace(regexEscapedLag, '');
                                if (temp.match(regexLagChars)) temp = temp.replace(regexLagChars, '');
                                if (temp.includes('𩸽')) temp = temp.replaceAll('𩸽', '');
                                
                                try {
                                    const cs = new CompressionStream('deflate');
                                    const writer = cs.writable.getWriter();
                                    writer.write(new TextEncoder().encode(temp));
                                    writer.close();
                                    const reCompressedBuffer = await new Response(cs.readable).arrayBuffer();
                                    
                                    Object.defineProperty(event, 'data', {
                                        configurable: true, enumerable: true, writable: false, value: reCompressedBuffer
                                    });
                                } catch (err) {}
                            }
                        }
                    }
                } catch (err) {
                    packetBuffer = new Uint8Array(0);
                }
            }
            return isBlocked;
        };

        // 最優先登録
        ws.addEventListener('message', handleMessage, true);

        // セッター・ゲッターの乗っ取り
        let userOnMessage = null;
        Object.defineProperty(ws, 'onmessage', {
            get() { return userOnMessage; },
            set(callback) {
                userOnMessage = callback;
                
                ws.removeEventListener('message', handleMessage, true);
                ws.addEventListener('message', async function wrapper(event) {
                    const blocked = await handleMessage(event);
                    
                    if (blocked || isBlocked || event.defaultPrevented) {
                        event.stopImmediatePropagation();
                        event.preventDefault();
                        return;
                    }
                    
                    if (userOnMessage) {
                        userOnMessage.call(ws, event);
                    }
                }, true);
            }
        });

        return ws;
    };
})();
