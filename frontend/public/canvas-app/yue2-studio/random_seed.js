/* Secure positive seeds that fit JavaScript's exact integer range. */
(() => {
  // randomUUID is secure-context-only; getRandomValues also works on LAN HTTP.
  if (globalThis.crypto && !globalThis.crypto.randomUUID) {
    globalThis.crypto.randomUUID = () => {
      const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
      bytes[6] = (bytes[6] & 15) | 64;
      bytes[8] = (bytes[8] & 63) | 128;
      const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
      return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
    };
  }
  globalThis.YuE2Clipboard = {
    async writeText(text) {
      if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
      const field = document.createElement('textarea');
      field.value = text;
      field.style.cssText = 'position:fixed;left:-9999px;top:0';
      document.body.appendChild(field);
      const previous = document.activeElement;
      try {
        field.select();
        if (!document.execCommand('copy')) throw new Error('浏览器拒绝复制，请手动选择复制');
      } finally {
        field.remove();
        previous?.focus();
      }
    }
  };
  const issued = new Set();
  function randomSeed(previous, entropy = globalThis.crypto) {
    if (!entropy?.getRandomValues) throw new Error('浏览器不支持安全随机数，请使用本机 localhost 页面，或取消随机并填写固定种子');
    const words = new Uint32Array(2);
    for (let attempt = 0; attempt < 128; attempt++) {
      entropy.getRandomValues(words);
      const seed = (words[0] & 0x1fffff) * 0x100000000 + words[1];
      if (seed > 0 && seed !== Number(previous) && !issued.has(seed)) {
        issued.add(seed);
        return seed;
      }
    }
    throw new Error('未能取得新的安全随机种子，请重试或填写固定种子');
  }
  const api = {randomSeed};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else globalThis.YuE2Seeds = api;
})();
