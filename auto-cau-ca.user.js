// ==UserScript==
// @name         Auto Câu Rùa & Cá - Bến Dừa
// @namespace    https://ben-dua.vercel.app/
// @version      1.0
// @description  Tự động thả câu, tự động căn chuẩn 100% vùng xanh và lặp lại câu rùa Hồ Gươm / cá bến sông
// @match        https://ben-dua.vercel.app/*
// @match        https://vunguyen76.github.io/BenDua/*
// @grant        none
// ==/UserScript==

(function() {
  'use strict';

  let autoRunning = false;
  let totalCaught = 0;
  let lastActionTime = 0;
  let hitCooldown = false;
  let animFrameId = null;

  // Tạo Floating Control Panel trên giao diện game
  const panel = document.createElement('div');
  panel.id = 'auto-fishing-hud';
  panel.innerHTML = `
    <div style="font-weight: bold; font-size: 14px; margin-bottom: 8px; color: #ffe600; display: flex; justify-content: space-between; align-items: center;">
      <span>🎣 AUTO CÂU RÙA / CÁ</span>
      <span id="af-badge" style="font-size: 11px; background: #555; padding: 2px 6px; border-radius: 4px; color: #fff;">OFF</span>
    </div>
    <div style="font-size: 12px; margin-bottom: 6px; color: #ddd;">
      Trạng thái: <b id="af-status" style="color: #4ade80;">Sẵn sàng</b>
    </div>
    <div style="font-size: 12px; margin-bottom: 10px; color: #ddd;">
      Đã bắt: <b id="af-count" style="color: #60a5fa; font-size: 15px;">0</b> con
    </div>
    <div style="display: flex; gap: 6px;">
      <button id="af-toggle-btn" style="flex: 1; padding: 6px 10px; background: #22c55e; border: none; color: #fff; font-weight: bold; border-radius: 4px; cursor: pointer;">
        BẬT AUTO
      </button>
    </div>
    <div style="font-size: 10px; color: #aaa; margin-top: 8px; line-height: 1.3;">
      * Đứng mép nước Hồ Gươm / bến câu rồi bấm BẬT AUTO.
    </div>
  `;

  Object.assign(panel.style, {
    position: 'fixed',
    top: '12px',
    right: '12px',
    width: '210px',
    backgroundColor: 'rgba(20, 25, 30, 0.92)',
    backdropFilter: 'blur(6px)',
    border: '2px solid #3b82f6',
    borderRadius: '8px',
    padding: '12px',
    boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
    zIndex: '999999',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    color: '#fff',
    userSelect: 'none'
  });

  document.body.appendChild(panel);

  const statusEl = panel.querySelector('#af-status');
  const countEl = panel.querySelector('#af-count');
  const badgeEl = panel.querySelector('#af-badge');
  const toggleBtn = panel.querySelector('#af-toggle-btn');

  function updateStatus(text, color = '#4ade80') {
    if (statusEl) {
      statusEl.textContent = text;
      statusEl.style.color = color;
    }
  }

  function triggerCast() {
    const interactBtn = document.getElementById('interact');
    const prompt = document.getElementById('prompt');
    if (prompt && !prompt.hidden && interactBtn) {
      interactBtn.click();
      return true;
    }
    // Gửi phím E
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', code: 'KeyE', bubbles: true }));
    return true;
  }

  function triggerStop() {
    const stopBtn = document.querySelector('button.fishing-stop') || document.querySelector('button[data-testid="fishing-stop"]');
    if (stopBtn && !stopBtn.disabled) {
      // Bắn cả PointerEvent và click để đảm bảo ăn trigger 100%
      stopBtn.dispatchEvent(new PointerEvent('pointerdown', { button: 0, isPrimary: true, bubbles: true }));
      stopBtn.click();
      window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true }));
      return true;
    }
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true }));
    return true;
  }

  function loop() {
    if (!autoRunning) return;

    const now = performance.now();
    const fishingPanel = document.querySelector('.fishing-panel');
    const isFishing = fishingPanel && !fishingPanel.hidden;

    if (!isFishing) {
      // Chưa thả cần: Kiểm tra xem có đang đứng cạnh bến câu không
      updateStatus('Đang thả câu…', '#38bdf8');
      if (now - lastActionTime > 1200) {
        lastActionTime = now;
        triggerCast();
      }
    } else {
      // Đang trong giao diện câu cá
      const phase = fishingPanel.dataset.phase || '';
      const meter = fishingPanel.querySelector('.fishing-meter');
      const target = fishingPanel.querySelector('.fishing-target');
      const bubble = fishingPanel.querySelector('.fishing-bubble');

      if (phase === 'wait' || phase === 'cast') {
        updateStatus('Đang chờ cắn câu…', '#fbbf24');
      } else if (phase === 'bite') {
        updateStatus('CẮN CÂU! Chuẩn bị…', '#f87171');
      } else if (phase === 'timing' && meter && target) {
        updateStatus('Đang căn vùng xanh…', '#4ade80');

        const targetLeft = parseFloat(target.style.left) || 0;
        const targetWidth = parseFloat(target.style.width) || 0;
        const currentPos = parseFloat(meter.getAttribute('aria-valuenow')) || 0;

        // Vùng an toàn tuyệt đối (trong khoảng [left + 1%, left + width - 1%])
        const safeStart = targetLeft + 1;
        const safeEnd = targetLeft + targetWidth - 1;

        if (!hitCooldown && currentPos >= safeStart && currentPos <= safeEnd) {
          triggerStop();
          hitCooldown = true;
          setTimeout(() => { hitCooldown = false; }, 350);
        }
      } else if (phase === 'hit') {
        updateStatus('CHUẨN! Lượt tiếp…', '#34d399');
      } else if (phase === 'caught') {
        const msg = bubble?.textContent || 'Đã câu thành công!';
        updateStatus(msg, '#60a5fa');
        if (now - lastActionTime > 2500) {
          totalCaught++;
          countEl.textContent = totalCaught;
          lastActionTime = now;
        }
      } else if (phase === 'miss') {
        updateStatus('Bị tuột! Chuẩn bị lại…', '#ef4444');
      }
    }

    animFrameId = requestAnimationFrame(loop);
  }

  toggleBtn.onclick = () => {
    autoRunning = !autoRunning;
    if (autoRunning) {
      toggleBtn.textContent = 'DỪNG AUTO';
      toggleBtn.style.backgroundColor = '#ef4444';
      badgeEl.textContent = 'ON';
      badgeEl.style.backgroundColor = '#16a34a';
      updateStatus('Đang chạy…', '#4ade80');
      lastActionTime = performance.now();
      loop();
    } else {
      toggleBtn.textContent = 'BẬT AUTO';
      toggleBtn.style.backgroundColor = '#22c55e';
      badgeEl.textContent = 'OFF';
      badgeEl.style.backgroundColor = '#555';
      updateStatus('Đã dừng', '#9ca3af');
      if (animFrameId) cancelAnimationFrame(animFrameId);
    }
  };

  console.log('%c[Auto BenDua] Script Auto Câu Rùa & Cá đã sẵn sàng!', 'color: #22c55e; font-size: 14px; font-weight: bold;');
})();
