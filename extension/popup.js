(function initializePopup() {
  'use strict';

  const generateButton = document.getElementById('generateButton');
  const manualGenerateButton = document.getElementById('manualGenerateButton');
  const manualInput = document.getElementById('manualInput');
  const manualAccountId = document.getElementById('manualAccountId');
  const status = document.getElementById('status');
  const detailsPanel = document.getElementById('detailsPanel');
  const previewContent = document.getElementById('previewContent');
  const emailValue = document.getElementById('emailValue');
  const planValue = document.getElementById('planValue');
  const tokenExpiryValue = document.getElementById('tokenExpiryValue');
  const bridge = window.CodexAuthBridge;

  function setStatus(message, kind = 'neutral') {
    status.textContent = message;
    status.className = `status ${kind}`;
  }

  function setBusy(isBusy) {
    generateButton.disabled = isBusy;
    manualGenerateButton.disabled = isBusy;
    generateButton.querySelector('span:last-child').textContent = isBusy
      ? '正在读取登录态...'
      : '生成并复制 auth.json';
    manualGenerateButton.querySelector('span:last-child').textContent = isBusy
      ? '正在生成...'
      : '从手动输入生成并复制';
  }

  function formatRelativeTime(isoValue) {
    if (!isoValue) {
      return '未知';
    }

    const timestamp = Date.parse(isoValue);
    if (Number.isNaN(timestamp)) {
      return isoValue;
    }

    const diff = timestamp - Date.now();
    if (diff <= 0) {
      return `${isoValue}，已过期`;
    }

    const hours = diff / 3600000;
    if (hours < 1) {
      return `${isoValue}，约 ${Math.max(1, Math.round(diff / 60000))} 分钟后`;
    }

    if (hours < 24) {
      return `${isoValue}，约 ${hours.toFixed(1)} 小时后`;
    }

    return `${isoValue}，约 ${(hours / 24).toFixed(1)} 天后`;
  }

  async function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }

    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', 'readonly');
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();

    try {
      const ok = document.execCommand('copy');
      if (!ok) {
        throw new Error('剪贴板写入失败，请手动复制预览内容。');
      }
    } finally {
      document.body.removeChild(textarea);
    }
  }

  function renderDetails(result, authJson) {
    emailValue.textContent = result.meta.email || '未知';
    planValue.textContent = result.meta.planType || '未知';
    tokenExpiryValue.textContent = formatRelativeTime(result.meta.accessTokenExpiresAt);
    previewContent.textContent = authJson;
    detailsPanel.hidden = false;
  }

  async function generateAuthJson() {
    setBusy(true);
    setStatus('正在请求 chatgpt.com/api/auth/session ...');
    detailsPanel.hidden = true;

    try {
      const result = await bridge.buildFromBrowser();
      const authJson = JSON.stringify(result.auth, null, 2);

      renderDetails(result, authJson);
      await copyText(authJson);

      setStatus(
        [
          '已生成并复制到剪贴板。',
          `account_id: ${result.meta.accountId}`,
          '请覆盖到 ~/.codex/auth.json。'
        ].join('\n'),
        'success'
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function generateFromManualInput() {
    setBusy(true);
    setStatus('正在从手动输入生成 auth.json ...');
    detailsPanel.hidden = true;

    try {
      const result = bridge.buildFromManualInput(manualInput.value, {
        accountId: manualAccountId.value.trim() || undefined
      });
      const authJson = JSON.stringify(result.auth, null, 2);

      renderDetails(result, authJson);
      await copyText(authJson);

      setStatus(
        [
          '已从手动输入生成并复制到剪贴板。',
          `account_id: ${result.meta.accountId}`,
          '请覆盖到 ~/.codex/auth.json。'
        ].join('\n'),
        'success'
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(message, 'error');
    } finally {
      setBusy(false);
    }
  }

  generateButton.addEventListener('click', generateAuthJson);
  manualGenerateButton.addEventListener('click', generateFromManualInput);
})();
