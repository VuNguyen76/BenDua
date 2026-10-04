// ==UserScript==
// @name         Auto Câu Rùa & Tự Động Đi Bán - Bến Dừa
// @namespace    https://ben-dua.vercel.app/
// @version      2.1
// @description  Tự động câu rùa chuẩn 100% tại Hồ Gươm, tự động đi tìm Cô Thu bán rùa khi đầy giỏ và tự quay lại hồ câu tiếp
// @match        https://ben-dua.vercel.app/*
// @match        https://vunguyen76.github.io/BenDua/*
// @grant        none
// ==/UserScript==

(function() {
  'use strict';

  // Định nghĩa mã phím chuẩn theo Phaser KeyboardPlugin
  const KEY_DEFS = {
    KeyW: { key: 'w', keyCode: 87, which: 87 },
    KeyA: { key: 'a', keyCode: 65, which: 65 },
    KeyS: { key: 's', keyCode: 83, which: 83 },
    KeyD: { key: 'd', keyCode: 68, which: 68 },
    ShiftLeft: { key: 'Shift', keyCode: 16, which: 16 },
    KeyE: { key: 'e', keyCode: 69, which: 69 },
    Space: { key: ' ', keyCode: 32, which: 32 },
    Escape: { key: 'Escape', keyCode: 27, which: 27 }
  };

  // Trạng thái bot
  // 'IDLE' | 'FISHING' | 'WALKING_TO_MERCHANT' | 'SELLING' | 'WALKING_TO_LAKE' | 'ADJUSTING_FACING'
  let state = 'IDLE';
  let isRunning = false;
  let autoSellEnabled = true;
  let sellThreshold = 10;
  let caughtInBag = 0;
  let totalCaughtAllTime = 0;

  // Thời gian chạy thực tế giữa bờ hồ và Cô Thu (mặc định 2200ms)
  let walkDurationMs = 2200;
  let walkStartTime = 0;
  let lastActionTime = 0;
  let hitCooldown = false;
  let animFrameId = null;

  const activeKeys = new Set();

  // === HỆ THỐNG GỬI SỰ KIỆN BÀN PHÍM CHUẨN PHASER ===
  function sendKeyEvent(type, code) {
    const def = KEY_DEFS[code] || { key: code, keyCode: 0, which: 0 };
    const evt = new KeyboardEvent(type, {
      key: def.key,
      code: code,
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window
    });

    // Ép buộc thuộc tính keyCode và which để Phaser KeyboardPlugin nhận diện
    Object.defineProperty(evt, 'keyCode', { value: def.keyCode, writable: false });
    Object.defineProperty(evt, 'which', { value: def.which, writable: false });

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

  // === KIỂM TRA PROMPT TƯƠNG TÁC (THẢ CÂU / CÔ THU) ===
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

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // === TẠO GIAO DIỆN BẢNG ĐIỀU KHIỂN NỔI (FLOATING HUD) ===
  const hud = document.createElement('div');
  hud.id = 'auto-fishing-merchant-hud';
  hud.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
      <span style="font-weight: bold; font-size: 13.5px; color: #ffd54f;">🐢 AUTO CÂU & BÁN RÙA V2.1</span>
      <span id="af-badge" style="font-size: 11px; font-weight: bold; background: #444; padding: 2px 6px; border-radius: 4px; color: #fff;">OFF</span>
    </div>

    <div style="background: rgba(0,0,0,0.4); padding: 8px; border-radius: 6px; margin-bottom: 8px; font-size: 12px; line-height: 1.5;">
      <div>Trạng thái: <b id="af-status" style="color: #4ade80;">Sẵn sàng</b></div>
      <div>Phát hiện: <b id="af-prompt-view" style="color: #f43f5e;">Chưa có mục tiêu</b></div>
      <div>Giỏ hiện tại: <b id="af-bag-count" style="color: #38bdf8;">0</b> / <span id="af-threshold-val">10</span> con</div>
      <div>Tổng đã câu: <b id="af-total-count" style="color: #facc15;">0</b> con</div>
    </div>

    <!-- Tùy chọn đi bán & thời gian di chuyển -->
    <div style="margin-bottom: 6px; font-size: 11.5px; display: flex; align-items: center; justify-content: space-between;">
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

    <div style="margin-bottom: 8px; font-size: 11px; display: flex; justify-content: space-between; align-items: center; color: #cbd5e1;">
      <span>Thời gian chạy bộ:</span>
      <div style="display: flex; align-items: center; gap: 4px;">
        <button id="af-time-dec" style="padding: 1px 6px; background: #334155; border: none; color: #fff; border-radius: 3px; cursor: pointer;">-</button>
        <span id="af-time-display" style="font-weight: bold; color: #38bdf8;">2.2s</span>
        <button id="af-time-inc" style="padding: 1px 6px; background: #334155; border: none; color: #fff; border-radius: 3px; cursor: pointer;">+</button>
      </div>
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

    <!-- Nút test kiểm tra di chuyển -->
    <div style="display: flex; gap: 4px; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 6px;">
      <button id="af-test-step" style="flex: 1; padding: 4px; background: #334155; border: none; color: #cbd5e1; border-radius: 3px; cursor: pointer; font-size: 10px;">
        Test bước đi (1 bước)
      </button>
      <button id="af-turn-lake" style="flex: 1; padding: 4px; background: #334155; border: none; color: #cbd5e1; border-radius: 3px; cursor: pointer; font-size: 10px;">
        Quay mặt ra hồ
      </button>
    </div>

    <div style="font-size: 9.5px; color: #94a3b8; margin-top: 6px; line-height: 1.3;">
      * Đứng mép hồ Hồ Gươm quay mặt ra nước, nút "Thả câu" sáng lên rồi bấm BẬT AUTO.
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
  const promptViewEl = hud.querySelector('#af-prompt-view');
  const bagCountEl = hud.querySelector('#af-bag-count');
  const totalCountEl = hud.querySelector('#af-total-count');
  const badgeEl = hud.querySelector('#af-badge');
  const toggleBtn = hud.querySelector('#af-toggle-btn');
  const optSell = hud.querySelector('#af-opt-sell');
  const optThreshold = hud.querySelector('#af-opt-threshold');
  const thresholdVal = hud.querySelector('#af-threshold-val');
  const forceSellBtn = hud.querySelector('#af-force-sell-btn');
  const forceLakeBtn = hud.querySelector('#af-force-lake-btn');
  const testStepBtn = hud.querySelector('#af-test-step');
  const turnLakeBtn = hud.querySelector('#af-turn-lake');
  const timeDecBtn = hud.querySelector('#af-time-dec');
  const timeIncBtn = hud.querySelector('#af-time-inc');
  const timeDisplay = hud.querySelector('#af-time-display');

  optThreshold.onchange = () => {
    sellThreshold = parseInt(optThreshold.value, 10);
    thresholdVal.textContent = sellThreshold;
  };

  optSell.onchange = () => {
    autoSellEnabled = optSell.checked;
  };

  timeDecBtn.onclick = () => {
    walkDurationMs = Math.max(1000, walkDurationMs - 200);
    timeDisplay.textContent = (walkDurationMs / 1000).toFixed(1) + 's';
  };

  timeIncBtn.onclick = () => {
    walkDurationMs = Math.min(5000, walkDurationMs + 200);
    timeDisplay.textContent = (walkDurationMs / 1000).toFixed(1) + 's';
  };

  testStepBtn.onclick = () => {
    // Thử bước 1 bước xuống phía dưới
    pressKey('KeyS');
    setTimeout(() => {
      releaseKey('KeyS');
    }, 200);
  };

  turnLakeBtn.onclick = () => {
    // Quay mặt lên hướng Bắc ra hồ
    pressKey('KeyW');
    setTimeout(() => releaseKey('KeyW'), 100);
  };

  function updateStatus(text, color = '#4ade80') {
    if (statusEl) {
      statusEl.textContent = text;
      statusEl.style.color = color;
    }
  }

  // === CHẠY ĐẾN CÔ THU (HƯỚNG NAM XUỐNG DƯỚI) ===
  function startWalkingToMerchant() {
    state = 'WALKING_TO_MERCHANT';
    walkStartTime = performance.now();
    updateStatus('Đang chạy đến Cô Thu…', '#38bdf8');
    releaseAllKeys();

    // Giữ phím S (Down), A (Trái nhẹ), Shift (Chạy nhanh)
    pressKey('KeyS');
    pressKey('KeyA');
    pressKey('ShiftLeft');
  }

  // === CHẠY VỀ BỜ HỒ (HƯỚNG BẮC LÊN TRÊN) ===
  function startWalkingToLake() {
    state = 'WALKING_TO_LAKE';
    walkStartTime = performance.now();
    updateStatus('Đang chạy về bờ hồ…', '#818cf8');
    releaseAllKeys();

    // Giữ phím W (Up), D (Phải nhẹ), Shift (Chạy nhanh)
    pressKey('KeyW');
    pressKey('KeyD');
    pressKey('ShiftLeft');
  }

  // === THỰC HIỆN BÁN RÙA TẠI QUẦY CÔ THU ===
  async function performSellingProcess() {
    state = 'SELLING';
    releaseAllKeys();
    updateStatus('Đang nói chuyện với Cô Thu…', '#fbbf24');

    triggerInteract();
    await sleep(700);

    // Bấm nút "Bán rùa trong giỏ" (testId: turtle-merchant-bag)
    const bagBtn = document.querySelector('button[data-testid="turtle-merchant-bag"]') ||
                   Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Bán rùa trong giỏ'));
    if (bagBtn) {
      bagBtn.click();
      await sleep(700);
    }

    // Bấm nút "Bán tất cả rùa trong giỏ" (testId: sell-caught-all)
    const sellAllBtn = document.querySelector('button[data-testid="sell-caught-all"]') ||
                       Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Bán') && b.textContent.includes('trong giỏ'));
    if (sellAllBtn && !sellAllBtn.disabled) {
      updateStatus('Đã bán hết rùa!', '#4ade80');
      sellAllBtn.click();
      await sleep(700);
      caughtInBag = 0;
      bagCountEl.textContent = '0';
    } else {
      updateStatus('Giỏ rùa đã trống.', '#94a3b8');
      await sleep(400);
    }

    // Đóng dialog (nút close-dialog hoặc phím Escape)
    const closeBtn = document.querySelector('button.close-dialog') ||
                     Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Đóng');
    if (closeBtn) {
      closeBtn.click();
    } else {
      tapKey('Escape', 100);
    }
    await sleep(600);

    // Bán xong -> chạy ngược về hồ
    startWalkingToLake();
  }

  // === QUY TRÌNH XOAY MẶT & BẮT ĐẦU CÂU TẠI BỜ HỒ ===
  async function adjustAndStartFishing() {
    state = 'ADJUSTING_FACING';
    releaseAllKeys();
    updateStatus('Đang quay mặt ra hồ…', '#38bdf8');

    // Nhấp phím W để nhân vật quay mặt về hướng Bắc nhìn ra mặt hồ
    pressKey('KeyW');
    await sleep(100);
    releaseKey('KeyW');
    await sleep(300);

    // Kiểm tra nếu nút "Thả câu" đã sáng lên
    let prompt = getNearbyPrompt();
    if (!prompt.includes('Thả câu')) {
      // Nhích nhẹ thêm 1 nhịp ngắn để đứng sát mép nước hơn
      pressKey('KeyW');
      await sleep(120);
      releaseKey('KeyW');
      await sleep(300);
    }

    prompt = getNearbyPrompt();
    if (prompt.includes('Thả câu')) {
      updateStatus('Đã vào bến câu! Thả câu…', '#4ade80');
      state = 'FISHING';
      lastActionTime = performance.now();
      triggerInteract();
    } else {
      updateStatus('Hãy đứng lại gần mép hồ một chút', '#f87171');
      state = 'FISHING';
    }
  }

  // === VÒNG LẶP ĐIỀU KHIỂN CHÍNH (MAIN LOOP) ===
  function mainLoop() {
    if (!isRunning) return;

    const now = performance.now();
    const promptText = getNearbyPrompt();

    // Hiển thị trực tiếp mục tiêu đang phát hiện
    if (promptViewEl) {
      promptViewEl.textContent = promptText || 'Không có mục tiêu';
      promptViewEl.style.color = promptText.includes('Thả câu') ? '#38bdf8' :
                                promptText.includes('Cô Thu') ? '#4ade80' : '#94a3b8';
    }

    const fishingPanel = document.querySelector('.fishing-panel');
    const isFishingActive = fishingPanel && !fishingPanel.hidden;

    // --- TRẠNG THÁI: DI CHUYỂN ĐẾN CÔ THU ---
    if (state === 'WALKING_TO_MERCHANT') {
      const elapsed = now - walkStartTime;

      // 1. Nếu phát hiện thấy Cô Thu trong tầm
      if (promptText.includes('Cô Thu') || promptText.includes('thu mua rùa')) {
        releaseAllKeys();
        performSellingProcess();
        animFrameId = requestAnimationFrame(mainLoop);
        return;
      }

      // 2. Nếu đã chạy hết thời gian cài đặt
      if (elapsed >= walkDurationMs) {
        releaseAllKeys();
        // Kiểm tra lại xem đã đứng gần chưa
        if (promptText.includes('Cô Thu') || promptText.includes('thu mua rùa')) {
          performSellingProcess();
        } else {
          // Thử nhích nhẹ 1 nhịp sang trái
          pressKey('KeyA');
          setTimeout(() => {
            releaseKey('KeyA');
            if (getNearbyPrompt().includes('Cô Thu')) {
              performSellingProcess();
            } else {
              updateStatus('Chưa tới quầy Cô Thu (tăng thời gian chạy)', '#f87171');
            }
          }, 300);
        }
        animFrameId = requestAnimationFrame(mainLoop);
        return;
      }
    }

    // --- TRẠNG THÁI: DI CHUYỂN VỀ BỜ HỒ ---
    else if (state === 'WALKING_TO_LAKE') {
      const elapsed = now - walkStartTime;

      // 1. Nếu đã thấy "Thả câu"
      if (promptText.includes('Thả câu')) {
        adjustAndStartFishing();
        animFrameId = requestAnimationFrame(mainLoop);
        return;
      }

      // 2. Nếu đã chạy hết thời gian cài đặt
      if (elapsed >= walkDurationMs) {
        adjustAndStartFishing();
        animFrameId = requestAnimationFrame(mainLoop);
        return;
      }
    }

    // --- TRẠNG THÁI: CÂU RÙA ---
    else if (state === 'FISHING' || state === 'IDLE') {
      if (state === 'IDLE') state = 'FISHING';

      // Kiểm tra nếu giỏ đã đủ số lượng cần đi bán
      if (autoSellEnabled && caughtInBag >= sellThreshold) {
        if (!isFishingActive) {
          startWalkingToMerchant();
          animFrameId = requestAnimationFrame(mainLoop);
          return;
        }
      }

      if (!isFishingActive) {
        // Chưa quăng cần: Thả câu
        if (promptText.includes('Thả câu')) {
          updateStatus('Đang quăng cần…', '#38bdf8');
          if (now - lastActionTime > 1300) {
            lastActionTime = now;
            triggerInteract();
          }
        } else {
          updateStatus('Cần đứng mép hồ quay mặt ra nước', '#fbbf24');
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

            // Kiểm tra ngay sau khi bắt: Nếu đủ số lượng thì chuyển sang đi bán
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

  console.log('%c[Auto BenDua V2.1] Script Auto Câu Rùa & Tự Bán đã sẵn sàng!', 'color: #eab308; font-size: 14px; font-weight: bold;');
})();
