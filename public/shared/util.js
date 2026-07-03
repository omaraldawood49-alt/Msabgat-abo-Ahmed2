/* أدوات مشتركة للواجهات */
(function (global) {
  'use strict';

  function fmt(n) {
    if (n === null || n === undefined || isNaN(n)) return '0';
    return Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
  }
  function fmtMoney(n) {
    return fmt(n) + ' ﷼';
  }
  function pct(n) {
    const v = Number(n) || 0;
    const sign = v > 0 ? '+' : '';
    return sign + v.toFixed(2) + '%';
  }
  function dirClass(dir) {
    return dir === 'up' ? 'up' : dir === 'down' ? 'down' : 'flat';
  }
  function dirArrow(dir) {
    return dir === 'up' ? '▲' : dir === 'down' ? '▼' : '＝';
  }
  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const k in attrs) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k.startsWith('on') && typeof attrs[k] === 'function') {
          node.addEventListener(k.slice(2).toLowerCase(), attrs[k]);
        } else if (attrs[k] !== null && attrs[k] !== undefined) {
          node.setAttribute(k, attrs[k]);
        }
      }
    }
    (children || []).forEach((c) => {
      if (c == null) return;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return node;
  }

  let toastRoot = null;
  function toast(msg, type) {
    if (!toastRoot) {
      toastRoot = document.getElementById('toast');
      if (!toastRoot) {
        toastRoot = el('div', { id: 'toast' });
        document.body.appendChild(toastRoot);
      }
    }
    const t = el('div', { class: 'toast-item ' + (type === 'err' ? 'toast-err' : type === 'ok' ? 'toast-ok' : ''), text: msg });
    toastRoot.appendChild(t);
    setTimeout(() => {
      t.style.transition = 'opacity .3s';
      t.style.opacity = '0';
      setTimeout(() => t.remove(), 300);
    }, 2600);
  }

  function qs(name) {
    return new URLSearchParams(location.search).get(name);
  }

  global.U = { fmt, fmtMoney, pct, dirClass, dirArrow, el, toast, qs };
})(window);
