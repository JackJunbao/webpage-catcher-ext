// 网页长截图 & PDF —— 纯离线实现
// 原理：通过 chrome.debugger（CDP）调用 Chrome 内置的整页截图 / 打印接口，
// 结果直接转存为本地文件，全程无任何网络请求。

'use strict';

const MAX_DIM = 16000; // Chrome 单张截图纹理上限约 16384px，留余量

const $ = (id) => document.getElementById(id);
const status = (msg, cls = '') => {
  const el = $('status');
  el.textContent = msg;
  el.className = cls;
};

/* ---------- 基础工具 ---------- */

function base64ToBlob(b64, mime) {
  const bin = atob(b64);
  const len = bin.length;
  const buf = new Uint8Array(len);
  for (let i = 0; i < len; i++) buf[i] = bin.charCodeAt(i);
  return new Blob([buf], { type: mime });
}

function safeName(title) {
  let t = (title || '网页').replace(/[\\/:*?"<>|\r\n]+/g, '_').trim();
  if (!t) t = '网页';
  if (t.length > 60) t = t.slice(0, 60);
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const ts = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  return `${t}_${ts}`;
}

// CDP 命令封装（回调式，兼容所有 Chrome 版本）
function cdp(target, method, params) {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand(target, method, params || {}, (res) => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message));
      else resolve(res);
    });
  });
}

async function withDebugger(tabId, fn) {
  const target = { tabId };
  await new Promise((resolve, reject) => {
    chrome.debugger.attach(target, '1.3', () => {
      chrome.runtime.lastError
        ? reject(new Error(chrome.runtime.lastError.message))
        : resolve();
    });
  });
  try {
    return await fn(target);
  } finally {
    try { await new Promise((r) => chrome.debugger.detach(target, () => r())); } catch (e) { /* ignore */ }
  }
}

// 滚动一遍页面，触发懒加载图片，然后回到原位置
async function preloadLazy(target) {
  try {
    await cdp(target, 'Runtime.evaluate', {
      expression: `(async () => {
        const d = document.scrollingElement || document.documentElement;
        const old = d.scrollTop, step = Math.max(600, window.innerHeight);
        for (let y = 0; y < d.scrollHeight; y += step) { d.scrollTop = y; await new Promise(r => setTimeout(r, 120)); }
        await new Promise(r => setTimeout(r, 400));
        d.scrollTop = old;
      })()`,
      awaitPromise: true
    });
  } catch (e) { /* 懒加载预滚动失败不影响截图 */ }
}

// 隐藏 position:fixed / sticky 元素（如公众号底部悬浮栏），避免其在整页截图中横在页面中间
// 返回隐藏数量；配合 restoreFixed 使用
async function hideFixed(target) {
  try {
    const res = await cdp(target, 'Runtime.evaluate', {
      expression: `(() => {
        window.__wph = [];
        let n = 0;
        for (const el of document.querySelectorAll('body *')) {
          const cs = getComputedStyle(el);
          if (cs.position === 'fixed' || cs.position === 'sticky') {
            const r = el.getBoundingClientRect();
            if (r.width > 1 && r.height > 1) {
              window.__wph.push([el, el.style.cssText]);
              el.style.setProperty('visibility', 'hidden', 'important');
              n++;
            }
          }
        }
        return n;
      })()`
    });
    return res && res.result ? res.result.value : 0;
  } catch (e) { return 0; }
}

async function restoreFixed(target) {
  try {
    await cdp(target, 'Runtime.evaluate', {
      expression: `(() => {
        if (window.__wph) {
          for (const [el, css] of window.__wph) { try { el.style.cssText = css; } catch (e) {} }
          window.__wph = undefined;
        }
      })()`
    });
  } catch (e) { /* ignore */ }
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function assertNormalPage(tab) {
  const url = tab && tab.url ? tab.url : '';
  if (!/^(https?|file):/.test(url)) {
    throw new Error('当前页面类型不支持（浏览器内部页 chrome://、商店页等无法截图）');
  }
}

/* ---------- 两个核心功能 ---------- */

async function captureFullPagePNG(tab) {
  assertNormalPage(tab);
  return withDebugger(tab.id, async (target) => {
    await preloadLazy(target);
    const hidden = await hideFixed(target);
    try {
      const metrics = await cdp(target, 'Page.getLayoutMetrics');
      const w = Math.ceil(metrics.contentSize.width);
      const h = Math.ceil(metrics.contentSize.height);
      if (!w || !h) throw new Error('无法读取页面尺寸');
      const scale = Math.min(1, MAX_DIM / Math.max(w, h)); // 超长页面自动缩小防失败
      const res = await cdp(target, 'Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: true,
        clip: { x: 0, y: 0, width: w, height: h, scale: scale }
      });
      if (!res || !res.data) throw new Error('截图返回为空');
      return res.data;
    } finally {
      await restoreFixed(target);
    }
  });
}

async function exportPagePDF(tab) {
  assertNormalPage(tab);
  return withDebugger(tab.id, async (target) => {
    await hideFixed(target);
    try {
      const res = await cdp(target, 'Page.printToPDF', { printBackground: true });
      if (!res || !res.data) throw new Error('PDF 生成返回为空');
      return res.data;
    } finally {
      await restoreFixed(target);
    }
  });
}

async function saveFile(base64, mime, ext) {
  const tab = await getActiveTab();
  const blob = base64ToBlob(base64, mime);
  const url = URL.createObjectURL(blob);
  const name = safeName(tab && tab.title) + ext;
  return new Promise((resolve, reject) => {
    chrome.downloads.download({ url, filename: name, saveAs: true }, (id) => {
      const err = chrome.runtime.lastError;
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      err ? reject(new Error(err.message)) : resolve(id);
    });
  });
}

/* ---------- 事件绑定 ---------- */

async function run(buttonId, taskName) {
  const btn = $(buttonId);
  btn.disabled = true;
  try {
    const tab = await getActiveTab();
    let data, mime, ext, okMsg;
    if (taskName === 'png') {
      status('正在整页截图（长页面会多等几秒）…');
      data = await captureFullPagePNG(tab);
      mime = 'image/png'; ext = '.png'; okMsg = '✅ 长截图已生成，请选择保存位置';
    } else {
      status('正在导出 PDF…');
      data = await exportPagePDF(tab);
      mime = 'application/pdf'; ext = '.pdf'; okMsg = '✅ PDF 已生成，请选择保存位置';
    }
    await saveFile(data, mime, ext);
    status(okMsg, 'ok');
  } catch (e) {
    status('❌ ' + (e && e.message ? e.message : '未知错误'), 'err');
  } finally {
    btn.disabled = false;
  }
}

$('shot').addEventListener('click', () => run('shot', 'png'));
$('pdf').addEventListener('click', () => run('pdf', 'pdf'));
