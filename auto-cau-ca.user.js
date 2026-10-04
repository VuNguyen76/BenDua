// ==UserScript==
// @name         Auto Câu Rùa & Tự Động Đi Bán - Bến Dừa
// @namespace    https://ben-dua.vercel.app/
// @version      3.0
// @description  Tự động câu rùa chuẩn 100% tại Hồ Gươm, tự động đi tìm Cô Thu bán rùa khi đầy giỏ và tự quay lại hồ câu tiếp
// @match        https://ben-dua.vercel.app/*
// @match        https://vunguyen76.github.io/BenDua/*
// @grant        none
// ==/UserScript==

(function() {
  'use strict';

  // Khai báo bảng mã keyCode chuẩn Phaser
  const KEY_CODES = {
    KeyW: 87,
    KeyA: 65,
    KeyS: 83,
    KeyD: 68,
    ShiftLeft: 16,
    KeyE: 69,
    Space: 32,
    Escape: 27
  };

  // Trạng thái bot
  // 'IDLE' | 'FISHING' | 'WALKING_TO_MERCHANT' | 'SELLING' | 'WALKING_TO_LAKE'
  let state = 'IDLE';
  let isRunning = false;
  let autoSellEnabled = true;
  let sellThreshold = 10;
  let caughtInBag = 0;
  let totalCaughtAllTime = 0;

  let animFrameId = null;
  let lastActionTime = 0;
  let hitCooldown = false;
  let walkStartTime = 0;
  let isNavigating = false;

  const activeKeys = new Set();

  // === ĐỌC TRẠNG THÁI REAL-TIME TỪ GAME LOCALSTORAGE ===
  function getGameAccountKey() {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('xom-nuoc-demo-v1:account:')) {
        return k;
      }
    }
    return null;
  }

  function getPlayerData() {
    const key = getGameAccountKey();
    if (!key) return null;
    try {
      return JSON.parse(localStorage.getItem(key) || '{}');
    } catch (e) {
      return null;
    }
  }

  // === GỬI SỰ KIỆN BÀN PHÍM CHUẨN PHASER ENGINE ===
  function sendKeyEvent(type, code) {
    const keyCode = KEY_CODES[code] || 0;
    const key = code === 'Space' ? ' ' : code.startsWith('Key') ? code.replace('Key', '').toLowerCase() : code;

    const evt = new KeyboardEvent(type, {
      key: key,
      code: code,
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window
    });

    Object.defineProperty(evt, 'keyCode', { value: keyCode, writable: false });
    Object.defineProperty(evt, 'which', { value: keyCode, writable: false });

    window.dispatchEvent(evt);
    document.dispatchEvent(evt);

    const canvas = document.querySelector('#game canvas') || document.querySelector('canvas');
    if (canvas) canvas.dispatchEvent(evt);
  }

  function pressKey(code) {
    if (activeKeys.has(code)) return;
    activeKeys.add(code);
    sendKeyEvent('keydown', code);
  }

  function releaseKey(code) {
    if (!activeKeys.has(code)) return;
    activeKeys.delete(code);
    sendKeyEvent('keyup', code);
  }

  function releaseAllKeys() {
    for (const code of Array.from(activeKeys)) {
      releaseKey(code);
    }
    activeKeys.clear();
  }

  function tapKey(code, duration = 120) {
    pressKey(code);
    setTimeout(() => releaseKey(code), duration);
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // === KIỂM TRA NÚT TƯƠNG TÁC (PROMPT) TRÊN HUD ===
  function getNearbyPrompt() {
    const prompt = document.getElementById('prompt');
    const label = document.getElementById('prompt-label');
    if (prompt && !prompt.hidden && label) {
      return label.textContent.trim();
    }
    return '';
  }

  function triggerInteract() {
    const interactBtn = document.getElementById('interact');
    if (interactBtn) {
      interactBtn.click();
      return true;
    }
    tapKey('KeyE', 100);
    return true;
  }

  function triggerFishingStop() {
    const stopBtn = document.querySelector('button.fishing-stop') || document.querySelector('button[data-testid="fishing-stop"]');
    if (stopBtn && !stopBtn.disabled) {
      stopBtn.dispatchEvent(new PointerEvent('pointerdown', { button: 0, isPrimary: true, bubbles: true }));
      stopBtn.click();
    }
    tapKey('Space', 60);
  }

  // === TẠO GIAO DIỆN BẢNG ĐIỀU KHIỂN NỔI (FLOATING HUD) ===
  const hud = document.createElement('div');
  hud.id = 'auto-fishing-merchant-hud';
  hud.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
      <span style="font-weight: bold; font-size: 13.5px; color: #ffd54f;">🐢 AUTO CÂU & BÁN RÙA V3.0</span>
      <span id="af-badge" style="font-size: 11px; font-weight: bold; background: #444; padding: 2px 6px; border-radius: 4px; color: #fff;">OFF</span>
    </div>

    <div style="background: rgba(0,0,0,0.4); padding: 8px; border-radius: 6px; margin-bottom: 8px; font-size: 11.5px; line-height: 1.5;">
      <div>Trạng thái: <b id="af-status" style="color: #4ade80;">Sẵn sàng</b></div>
      <div>Vị trí: <span id="af-pos" style="color: #cbd5e1;">X: - | Y: -</span></div>
      <div>Mục tiêu: <b id="af-prompt-view" style="color: #38bdf8;">-</b></div>
      <div>Giỏ hiện tại: <b id="af-bag-count" style="color: #38bdf8;">0</b> / <span id="af-threshold-val">10</span> con</div>
      <div>Tiền ví: <b id="af-money" style="color: #facc15;">-</b></div>
    </div>

    <!-- Tùy chọn đi bán -->
    <div style="margin-bottom: 8px; font-size: 11.5px; display: flex; align-items: center; justify-content: space-between;">
      <label style="display: flex; align-items: center; gap: 5px; cursor: pointer;">
        <input type="checkbox" id="af-opt-sell" checked style="cursor: pointer;">
        <span>Tự đi bán khi đủ:</span>
      </label>
      <select id="af-opt-threshold" style="background: #222; color: #fff; border: 1px solid #555; border-radius: 4px; padding: 2px 4px; font-size: 11px;">
        <option value="5">5 con</option>
        <option value="10" selected>10 con</option>
        <option value="20">20 con</option>
        <option value="50">50 con</option>
        <option value="100">100 con (Đầy giỏ)</option>
      </select>
    </div>

    <!-- Nút điều khiển chính -->
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-bottom: 6px;">
      <button id="af-toggle-btn" style="grid-column: span 2; padding: 8px; background: #22c55e; border: none; color: #fff; font-weight: bold; border-radius: 4px; cursor: pointer; font-size: 13px;">
        BẬT AUTO TOÀN TẬP
      </button>
      <button id="af-force-sell-btn" style="padding: 6px; background: #0284c7; border: none; color: #fff; border-radius: 4px; cursor: pointer; font-size: 11px; font-weight: bold;">
        🏃 ĐI BÁN NGAY
      </button>
      <button id="af-force-lake-btn" style="padding: 6px; background: #4f46e5; border: none; color: #fff; border-radius: 4px; cursor: pointer; font-size: 11px; font-weight: bold;">
        🎣 VỀ BỜ HỒ NGAY
      </button>
    </div>

    <div style="font-size: 9.5px; color: #94a3b8; line-height: 1.3;">
      * Đứng mép hồ Hồ Gươm quay mặt ra nước, bấm BẬT AUTO để tự động câu & tự đi bán rùa vòng lặp!
    </div>
  `;

  Object.assign(hud.style, {
    position: 'fixed',
    top: '12px',
    right: '12px',
    width: '240px',
    backgroundColor: 'rgba(15, 23, 42, 0.95)',
    backdropFilter: 'blur(8px)',
    border: '2px solid #eab308',
    borderRadius: '10px',
    padding: '12px',
    boxShadow: '0 10px 30px rgba(0,0,0,0.6)',
    zIndex: '999999',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    color: '#f8fafc',
    userSelect: 'none'
  });

  document.body.appendChild(hud);

  const statusEl = hud.querySelector('#af-status');
  const posEl = hud.querySelector('#af-pos');
  const promptViewEl = hud.querySelector('#af-prompt-view');
  const bagCountEl = hud.querySelector('#af-bag-count');
  const moneyEl = hud.querySelector('#af-money');
  const badgeEl = hud.querySelector('#af-badge');
  const toggleBtn = hud.querySelector('#af-toggle-btn');
  const optSell = hud.querySelector('#af-opt-sell');
  const optThreshold = hud.querySelector('#af-opt-threshold');
  const thresholdVal = hud.querySelector('#af-threshold-val');
  const forceSellBtn = hud.querySelector('#af-force-sell-btn');
  const forceLakeBtn = hud.querySelector('#af-force-lake-btn');

  optThreshold.onchange = () => {
    sellThreshold = parseInt(optThreshold.value, 10);
    thresholdVal.textContent = sellThreshold;
  };

  optSell.onchange = () => {
    autoSellEnabled = optSell.checked;
  };

  function updateStatus(text, color = '#4ade80') {
    if (statusEl) {
      statusEl.textContent = text;
      statusEl.style.color = color;
    }
  }

  // === THUẬT TOÁN ĐI ĐẾN CÔ THU THEO TỌA ĐỘ REAL-TIME ===
  async function walkToMerchant() {
    if (isNavigating) return;
    isNavigating = true;
    state = 'WALKING_TO_MERCHANT';
    updateStatus('Đang đi tới Cô Thu…', '#38bdf8');
    releaseAllKeys();

    const start = performance.now();
    // Bước 1: Đi xuống (S) cho tới khi y >= 640
    pressKey('KeyS');

    while (performance.now() - start < 5000) {
      const p = getPlayerData();
      const prompt = getNearbyPrompt();

      // Kiểm tra nếu đã thấy Cô Thu trong bán kính tương tác
      if (prompt.includes('Cô Thu') || prompt.includes('thu mua rùa')) {
        break;
      }

      if (p && p.y >= 640) {
        // Đã đến ngang tầm Y của Cô Thu
        break;
      }
      await sleep(50);
    }
    releaseKey('KeyS');

    // Bước 2: Chỉnh nhẹ X nếu cần
    const p1 = getPlayerData();
    if (p1) {
      if (p1.x > 675) {
        pressKey('KeyA');
        await sleep(200);
        releaseKey('KeyA');
      } else if (p1.x < 650) {
        pressKey('KeyD');
        await sleep(200);
        releaseKey('KeyD');
      }
    }

    await sleep(200);
    releaseAllKeys();

    // Bước 3: Thực hiện bán rùa
    await performSellingProcess();
    isNavigating = false;
  }

  // === THUẬT TOÁN ĐI VỀ BỜ HỒ THEO TỌA ĐỘ REAL-TIME & XOAY MẶT RA NƯỚC ===
  async function walkToLake() {
    if (isNavigating) return;
    isNavigating = true;
    state = 'WALKING_TO_LAKE';
    updateStatus('Đang về bờ hồ…', '#818cf8');
    releaseAllKeys();

    const start = performance.now();
    // Đi lên phía bờ hồ (W) cho tới khi y <= 618
    pressKey('KeyW');

    while (performance.now() - start < 5000) {
      const p = getPlayerData();
      const prompt = getNearbyPrompt();

      if (prompt.includes('Thả câu')) {
        break;
      }

      if (p && p.y <= 618) {
        break;
      }
      await sleep(50);
    }
    releaseKey('KeyW');

    // Chỉnh X về phía lan can hồ (x tầm 675 ~ 690)
    const p2 = getPlayerData();
    if (p2 && p2.x < 675) {
      pressKey('KeyD');
      await sleep(200);
      releaseKey('KeyD');
    }

    await sleep(200);

    // BƯỚC QUAN TRỌNG NHẤT: Xoay mặt sang phải (D) hướng ra mặt hồ Hồ Gươm
    updateStatus('Xoay mặt ra hồ…', '#38bdf8');
    pressKey('KeyD');
    await sleep(150);
    releaseKey('KeyD');
    await sleep(300);

    releaseAllKeys();

    // Kiểm tra nút Thả câu
    const prompt = getNearbyPrompt();
    if (prompt.includes('Thả câu')) {
      updateStatus('Đã vào bến câu! Thả câu…', '#4ade80');
      state = 'FISHING';
      lastActionTime = performance.now();
      triggerInteract();
    } else {
      // Nếu chưa hiện, nhích nhẹ 1 nhịp ngắn
      pressKey('KeyD');
      await sleep(80);
      releaseKey('KeyD');
      await sleep(200);
      state = 'FISHING';
      if (getNearbyPrompt().includes('Thả câu')) {
        triggerInteract();
      }
    }

    isNavigating = false;
  }

  // === THỰC HIỆN BÁN RÙA TẠI QUẦY CÔ THU ===
  async function performSellingProcess() {
    state = 'SELLING';
    releaseAllKeys();
    updateStatus('Đang mở quầy Cô Thu…', '#fbbf24');

    // Click nút tương tác E
    triggerInteract();
    await sleep(600);

    // 1. Click "Bán rùa trong giỏ" (testId: turtle-merchant-bag)
    const bagBtn = document.querySelector('button[data-testid="turtle-merchant-bag"]') ||
                   Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Bán rùa trong giỏ'));
    if (bagBtn) {
      bagBtn.click();
      await sleep(600);
    }

    // 2. Click "Bán rùa trong giỏ · ...đ" (testId: sell-caught-all)
    const sellAllBtn = document.querySelector('button[data-testid="sell-caught-all"]') ||
                       Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Bán') && b.textContent.includes('trong giỏ'));
    if (sellAllBtn && !sellAllBtn.disabled) {
      updateStatus('Đang bán sạch rùa…', '#4ade80');
      sellAllBtn.click();
      await sleep(600);
      caughtInBag = 0;
      bagCountEl.textContent = '0';
    } else {
      updateStatus('Giỏ rùa đã trống.', '#94a3b8');
      await sleep(300);
    }

    // 3. Đóng dialog (nút close-dialog hoặc Escape)
    const closeBtn = document.querySelector('button.close-dialog') ||
                     Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Đóng');
    if (closeBtn) {
      closeBtn.click();
    } else {
      tapKey('Escape', 100);
    }
    await sleep(500);

    // Bán xong -> chạy ngược về hồ
    await walkToLake();
  }

  // === VÒNG LẶP ĐIỀU KHIỂN CHÍNH (MAIN LOOP) ===
  function mainLoop() {
    if (!isRunning) return;

    const now = performance.now();
    const promptText = getNearbyPrompt();
    const pData = getPlayerData();

    // Cập nhật telemetry lên HUD
    if (pData) {
      posEl.textContent = `X: ${Math.round(pData.x)} | Y: ${Math.round(pData.y)} (${pData.facing || '-'})`;
      moneyEl.textContent = Number(pData.money || 0).toLocaleString('vi-VN') + 'đ';
      if (pData.fishing?.bag) {
        caughtInBag = pData.fishing.bag.length;
        bagCountEl.textContent = caughtInBag;
      }
    }

    if (promptViewEl) {
      promptViewEl.textContent = promptText || 'Không có mục tiêu';
      promptViewEl.style.color = promptText.includes('Thả câu') ? '#38bdf8' :
                                promptText.includes('Cô Thu') ? '#4ade80' : '#94a3b8';
    }

    // Nếu đang trong quá trình di chuyển hoặc bán thì chờ
    if (isNavigating || state === 'WALKING_TO_MERCHANT' || state === 'WALKING_TO_LAKE' || state === 'SELLING') {
      animFrameId = requestAnimationFrame(mainLoop);
      return;
    }

    const fishingPanel = document.querySelector('.fishing-panel');
    const isFishingActive = fishingPanel && !fishingPanel.hidden;

    // --- TRẠNG THÁI: CÂU RÙA ---
    if (state === 'FISHING' || state === 'IDLE') {
      if (state === 'IDLE') state = 'FISHING';

      // Kiểm tra nếu giỏ đã đủ số lượng cần đi bán
      if (autoSellEnabled && caughtInBag >= sellThreshold) {
        if (!isFishingActive) {
          walkToMerchant();
          animFrameId = requestAnimationFrame(mainLoop);
          return;
        }
      }

      if (!isFishingActive) {
        // Chưa quăng cần: Thả câu nếu nút Thả câu đang sáng
        if (promptText.includes('Thả câu')) {
          updateStatus('Đang quăng cần…', '#38bdf8');
          if (now - lastActionTime > 1200) {
            lastActionTime = now;
            triggerInteract();
          }
        } else {
          updateStatus('Chờ nút Thả câu…', '#fbbf24');
        }
      } else {
        // Đang trong trận câu
        const phase = fishingPanel.dataset.phase || '';
        const meter = fishingPanel.querySelector('.fishing-meter');
        const target = fishingPanel.querySelector('.fishing-target');
        const bubble = fishingPanel.querySelector('.fishing-bubble');

        if (phase === 'wait' || phase === 'cast') {
          updateStatus('Chờ rùa cắn câu…', '#fbbf24');
        } else if (phase === 'bite') {
          updateStatus('RÙA CẮN CÂU!', '#f87171');
        } else if (phase === 'timing' && meter && target) {
          updateStatus('Đang căn vùng xanh…', '#4ade80');

          const targetLeft = parseFloat(target.style.left) || 0;
          const targetWidth = parseFloat(target.style.width) || 0;
          const currentPos = parseFloat(meter.getAttribute('aria-valuenow')) || 0;

          const safeStart = targetLeft + 1;
          const safeEnd = targetLeft + targetWidth - 1;

          if (!hitCooldown && currentPos >= safeStart && currentPos <= safeEnd) {
            triggerFishingStop();
            hitCooldown = true;
            setTimeout(() => { hitCooldown = false; }, 350);
          }
        } else if (phase === 'hit') {
          updateStatus('CHUẨN! Lượt tiếp…', '#34d399');
        } else if (phase === 'caught') {
          const msg = bubble?.textContent || 'Đã câu được rùa!';
          updateStatus(msg, '#60a5fa');
          if (now - lastActionTime > 2500) {
            totalCaughtAllTime++;
            lastActionTime = now;

            // Kiểm tra ngay sau khi bắt: Nếu đủ số lượng thì chuyển sang đi bán
            if (autoSellEnabled && (caughtInBag + 1) >= sellThreshold) {
              setTimeout(() => {
                if (isRunning) walkToMerchant();
              }, 1200);
            }
          }
        } else if (phase === 'miss') {
          updateStatus('Bị tuột! Chuẩn bị lại…', '#ef4444');
        }
      }
    }

    animFrameId = requestAnimationFrame(mainLoop);
  }

  // === NÚT ĐIỀU KHIỂN TRÊN MENU ===
  toggleBtn.onclick = () => {
    isRunning = !isRunning;
    if (isRunning) {
      toggleBtn.textContent = 'DỪNG AUTO';
      toggleBtn.style.backgroundColor = '#ef4444';
      badgeEl.textContent = 'ON';
      badgeEl.style.backgroundColor = '#16a34a';
      state = 'FISHING';
      lastActionTime = performance.now();
      updateStatus('Đang chạy…', '#4ade80');
      mainLoop();
    } else {
      toggleBtn.textContent = 'BẬT AUTO TOÀN TẬP';
      toggleBtn.style.backgroundColor = '#22c55e';
      badgeEl.textContent = 'OFF';
      badgeEl.style.backgroundColor = '#444';
      state = 'IDLE';
      isNavigating = false;
      releaseAllKeys();
      updateStatus('Đã dừng', '#9ca3af');
      if (animFrameId) cancelAnimationFrame(animFrameId);
    }
  };

  forceSellBtn.onclick = () => {
    if (!isRunning) {
      isRunning = true;
      toggleBtn.textContent = 'DỪNG AUTO';
      toggleBtn.style.backgroundColor = '#ef4444';
      badgeEl.textContent = 'ON';
      badgeEl.style.backgroundColor = '#16a34a';
      mainLoop();
    }
    walkToMerchant();
  };

  forceLakeBtn.onclick = () => {
    if (!isRunning) {
      isRunning = true;
      toggleBtn.textContent = 'DỪNG AUTO';
      toggleBtn.style.backgroundColor = '#ef4444';
      badgeEl.textContent = 'ON';
      badgeEl.style.backgroundColor = '#16a34a';
      mainLoop();
    }
    walkToLake();
  };

  console.log('%c[Auto BenDua V3.0] Auto Câu & Bán Rùa closed-loop telemetry đã sẵn sàng!', 'color: #eab308; font-size: 14px; font-weight: bold;');
})();
