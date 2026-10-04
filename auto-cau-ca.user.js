// ==UserScript==
// @name         Auto Câu Rùa & Tự Động Đi Bán - Bến Dừa
// @namespace    https://ben-dua.vercel.app/
// @version      2.0
// @description  Tự động câu rùa chuẩn 100% tại Hồ Gươm, tự động đi tìm Cô Thu bán rùa khi đầy giỏ và tự quay lại hồ câu tiếp
// @match        https://ben-dua.vercel.app/*
// @match        https://vunguyen76.github.io/BenDua/*
// @grant        none
// ==/UserScript==

(function() {
  'use strict';

  // Trạng thái bot
  // STATE: 'IDLE' | 'FISHING' | 'WALKING_TO_MERCHANT' | 'SELLING' | 'WALKING_TO_LAKE'
  let state = 'IDLE';
  let isRunning = false;
  let autoSellEnabled = true;
  let sellThreshold = 10; // Bán khi đủ số lượng rùa này
  let caughtInBag = 0;
  let totalCaughtAllTime = 0;
  let totalCoinsEarned = 0;

  let animFrameId = null;
  let lastActionTime = 0;
  let hitCooldown = false;
  let walkStartTime = 0;
  const activeKeys = new Set();

  // === QUẢN LÝ PHÍM BÀN PHÍM CHO DI CHUYỂN & HÀNH ĐỘNG ===
  function pressKey(code, key) {
    if (activeKeys.has(code)) return;
    activeKeys.add(code);
    window.dispatchEvent(new KeyboardEvent('keydown', {
      code: code,
      key: key,
      keyCode: code === 'KeyE' ? 69 : code === 'Space' ? 32 : 0,
      bubbles: true,
      cancelable: true
    }));
  }

  function releaseKey(code, key) {
    if (!activeKeys.has(code)) return;
    activeKeys.delete(code);
    window.dispatchEvent(new KeyboardEvent('keyup', {
      code: code,
      key: key,
      bubbles: true,
      cancelable: true
    }));
  }

  function releaseAllKeys() {
    for (const code of Array.from(activeKeys)) {
      const key = code.startsWith('Key') ? code.replace('Key', '').toLowerCase() : code.toLowerCase();
      releaseKey(code, key);
    }
  }

  function tapKey(code, key, duration = 120) {
    pressKey(code, key);
    setTimeout(() => releaseKey(code, key), duration);
  }

  // === TẠO GIAO DIỆN BẢNG ĐIỀU KHIỂN NỔI (FLOATING HUD) ===
  const hud = document.createElement('div');
  hud.id = 'auto-fishing-merchant-hud';
  hud.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
      <span style="font-weight: bold; font-size: 13.5px; color: #ffd54f;">🐢 AUTO CÂU & BÁN RÙA V2.0</span>
      <span id="af-badge" style="font-size: 11px; font-weight: bold; background: #444; padding: 2px 6px; border-radius: 4px; color: #fff;">OFF</span>
    </div>

    <div style="background: rgba(0,0,0,0.35); padding: 8px; border-radius: 6px; margin-bottom: 8px; font-size: 12px; line-height: 1.5;">
      <div>Trạng thái: <b id="af-status" style="color: #4ade80;">Sẵn sàng</b></div>
      <div>Giỏ hiện tại: <b id="af-bag-count" style="color: #38bdf8;">0</b> / <span id="af-threshold-val">10</span> con</div>
      <div>Tổng đã câu: <b id="af-total-count" style="color: #facc15;">0</b> con</div>
    </div>

    <!-- Tùy chọn tự đi bán -->
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

    <!-- Nút điều khiển -->
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-bottom: 6px;">
      <button id="af-toggle-btn" style="grid-column: span 2; padding: 7px; background: #22c55e; border: none; color: #fff; font-weight: bold; border-radius: 4px; cursor: pointer; font-size: 13px;">
        BẬT AUTO TOÀN TẬP
      </button>
      <button id="af-force-sell-btn" style="padding: 5px; background: #3b82f6; border: none; color: #fff; border-radius: 4px; cursor: pointer; font-size: 11px;">
        🏃 ĐI BÁN NGAY
      </button>
      <button id="af-force-lake-btn" style="padding: 5px; background: #6366f1; border: none; color: #fff; border-radius: 4px; cursor: pointer; font-size: 11px;">
        🎣 QUAY LẠI HỒ
      </button>
    </div>

    <div style="font-size: 10px; color: #94a3b8; line-height: 1.3;">
      * Đứng tại mép hồ quay mặt ra nước rồi bấm BẬT AUTO.
    </div>
  `;

  Object.assign(hud.style, {
    position: 'fixed',
    top: '12px',
    right: '12px',
    width: '235px',
    backgroundColor: 'rgba(17, 24, 39, 0.94)',
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
  const bagCountEl = hud.querySelector('#af-bag-count');
  const totalCountEl = hud.querySelector('#af-total-count');
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

  // === KIỂM TRA TƯƠNG TÁC (PROMPT) ===
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
    tapKey('KeyE', 'e');
    return true;
  }

  function triggerFishingStop() {
    const stopBtn = document.querySelector('button.fishing-stop') || document.querySelector('button[data-testid="fishing-stop"]');
    if (stopBtn && !stopBtn.disabled) {
      stopBtn.dispatchEvent(new PointerEvent('pointerdown', { button: 0, isPrimary: true, bubbles: true }));
      stopBtn.click();
    }
    tapKey('Space', ' ');
  }

  // === DI CHUYỂN ĐẾN CÔ THU (XUỐNG NAM + TRÁI NHẸ) ===
  function startWalkingToMerchant() {
    state = 'WALKING_TO_MERCHANT';
    walkStartTime = performance.now();
    updateStatus('Đang chạy đến Cô Thu…', '#38bdf8');
    releaseAllKeys();
    // Giữ phím S (Down), A (Left một chút), Shift (Run)
    pressKey('KeyS', 's');
    pressKey('KeyA', 'a');
    pressKey('ShiftLeft', 'Shift');
  }

  // === DI CHUYỂN VỀ HỒ GƯƠM (LÊN BẮC + PHẢI NHẸ) ===
  function startWalkingToLake() {
    state = 'WALKING_TO_LAKE';
    walkStartTime = performance.now();
    updateStatus('Đang chạy về bờ hồ…', '#818cf8');
    releaseAllKeys();
    // Giữ phím W (Up), D (Right một chút), Shift (Run)
    pressKey('KeyW', 'w');
    pressKey('KeyD', 'd');
    pressKey('ShiftLeft', 'Shift');
  }

  // === THỰC HIỆN BÁN RÙA VỚI CÔ THU ===
  async function performSellingProcess() {
    state = 'SELLING';
    releaseAllKeys();
    updateStatus('Đang mở quầy Cô Thu…', '#fbbf24');

    triggerInteract();
    await sleep(600);

    // Bấm nút "Bán rùa trong giỏ" (testId: turtle-merchant-bag)
    const bagBtn = document.querySelector('button[data-testid="turtle-merchant-bag"]') ||
                   Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Bán rùa trong giỏ'));
    if (bagBtn) {
      bagBtn.click();
      await sleep(600);
    }

    // Bấm nút "Bán tất cả rùa trong giỏ" (testId: sell-caught-all)
    const sellAllBtn = document.querySelector('button[data-testid="sell-caught-all"]') ||
                       Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Bán') && b.textContent.includes('trong giỏ'));
    if (sellAllBtn && !sellAllBtn.disabled) {
      updateStatus('Đã bán hết rùa!', '#4ade80');
      sellAllBtn.click();
      await sleep(600);
      caughtInBag = 0;
      bagCountEl.textContent = '0';
    } else {
      updateStatus('Giỏ rùa đã trống.', '#94a3b8');
      await sleep(300);
    }

    // Đóng dialog (bấm nút close-dialog hoặc phím Escape)
    const closeBtn = document.querySelector('button.close-dialog') ||
                     Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Đóng');
    if (closeBtn) {
      closeBtn.click();
    } else {
      tapKey('Escape', 'Escape');
    }
    await sleep(500);

    // Sau khi bán xong, tự động chạy ngược lại bờ hồ
    startWalkingToLake();
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // === VÒNG LẶP CHÍNH (MAIN LOOP) ===
  function mainLoop() {
    if (!isRunning) return;

    const now = performance.now();
    const promptText = getNearbyPrompt();
    const fishingPanel = document.querySelector('.fishing-panel');
    const isFishingActive = fishingPanel && !fishingPanel.hidden;

    // --- TRẠNG THÁI: DI CHUYỂN ĐẾN CÔ THU ---
    if (state === 'WALKING_TO_MERCHANT') {
      // Kiểm tra nếu đã đến gần Cô Thu
      if (promptText.includes('Cô Thu') || promptText.includes('thu mua rùa')) {
        releaseAllKeys();
        performSellingProcess();
        animFrameId = requestAnimationFrame(mainLoop);
        return;
      }

      // Watchdog an toàn: nếu chạy quá 5 giây chưa thấy, chỉnh nhẹ hướng
      if (now - walkStartTime > 5500) {
        releaseAllKeys();
        // Nhấn nhẹ E thử tương tác xem đã đến chưa
        if (promptText.includes('Cô Thu')) {
          performSellingProcess();
        } else {
          updateStatus('Cần kiểm tra lại vị trí Cô Thu', '#f87171');
        }
      }
    }

    // --- TRẠNG THÁI: DI CHUYỂN VỀ BỜ HỒ ---
    else if (state === 'WALKING_TO_LAKE') {
      // Kiểm tra nếu đã đến mép nước bến câu
      if (promptText.includes('Thả câu')) {
        releaseAllKeys();
        // Nhấn nhẹ W để nhân vật quay mặt ra hồ
        tapKey('KeyW', 'w', 100);
        updateStatus('Đã về bờ hồ! Bắt đầu câu…', '#4ade80');
        state = 'FISHING';
        lastActionTime = now;
      }

      // Watchdog an toàn
      if (now - walkStartTime > 5500) {
        releaseAllKeys();
        tapKey('KeyW', 'w', 150);
        state = 'FISHING';
      }
    }

    // --- TRẠNG THÁI: CÂU RÙA ---
    else if (state === 'FISHING' || state === 'IDLE') {
      if (state === 'IDLE') state = 'FISHING';

      // Kiểm tra xem có cần đi bán rùa không
      if (autoSellEnabled && caughtInBag >= sellThreshold) {
        if (!isFishingActive) {
          startWalkingToMerchant();
          animFrameId = requestAnimationFrame(mainLoop);
          return;
        }
      }

      if (!isFishingActive) {
        // Chưa quăng cần: Thả câu
        updateStatus('Đang quăng cần…', '#38bdf8');
        if (now - lastActionTime > 1300) {
          lastActionTime = now;
          triggerInteract();
        }
      } else {
        // Đang trong giao diện câu cá
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

          // Căn trúng vùng xanh chuẩn xác
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
            caughtInBag++;
            totalCaughtAllTime++;
            bagCountEl.textContent = caughtInBag;
            totalCountEl.textContent = totalCaughtAllTime;
            lastActionTime = now;

            // Kiểm tra ngay sau khi bắt: Nếu đủ số lượng thì chuẩn bị đi bán
            if (autoSellEnabled && caughtInBag >= sellThreshold) {
              setTimeout(() => {
                if (isRunning) startWalkingToMerchant();
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

  // === NÚT ĐIỀU KHIỂN TRÊN GIAO DIỆN ===
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
    startWalkingToMerchant();
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
    startWalkingToLake();
  };

  console.log('%c[Auto BenDua V2.0] Script Auto Câu Rùa & Tự Bán đã sẵn sàng!', 'color: #eab308; font-size: 14px; font-weight: bold;');
})();
