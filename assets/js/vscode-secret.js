/* ==========================================================
   Password-protected posts
   - PBKDF2-SHA256 (600,000 rounds) -> AES-256-GCM, all in the browser
   - only ciphertext is committed; title / tags / body live inside it
   - public file keeps: placeholder title, date, categories, cipher
   ========================================================== */
(function () {
  'use strict';

  var FORMAT_VERSION = 1;
  var PBKDF2_ROUNDS = 600000;
  var SALT_BYTES = 16;
  var IV_BYTES = 12;
  var PLACEHOLDER_TITLE = '비밀글';
  var FRONT_MATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

  var unlockedPage = { path: null, password: null };

  /* ---------- encoding helpers ---------- */

  function bytesToBase64(bytes) {
    var view = new Uint8Array(bytes);
    var binary = '';
    var chunkSize = 0x8000;
    for (var i = 0; i < view.length; i += chunkSize) {
      binary += String.fromCharCode.apply(null, view.subarray(i, i + chunkSize));
    }
    return window.btoa(binary);
  }

  function base64ToBytes(encoded) {
    var binary = window.atob(String(encoded).replace(/\s/g, ''));
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  function randomBytes(length) {
    var bytes = new Uint8Array(length);
    window.crypto.getRandomValues(bytes);
    return bytes;
  }

  /* ---------- crypto ---------- */

  function isCryptoAvailable() {
    return !!(window.crypto && window.crypto.subtle && window.TextEncoder && window.TextDecoder);
  }

  function deriveKey(password, salt, rounds) {
    var subtle = window.crypto.subtle;
    return subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey'])
      .then(function (baseKey) {
        return subtle.deriveKey(
          { name: 'PBKDF2', salt: salt, iterations: rounds, hash: 'SHA-256' },
          baseKey,
          { name: 'AES-GCM', length: 256 },
          false,
          ['encrypt', 'decrypt']
        );
      });
  }

  function encryptText(plaintext, password) {
    if (!isCryptoAvailable()) {
      return Promise.reject(new Error('이 브라우저는 암호화(Web Crypto)를 지원하지 않아.'));
    }
    var salt = randomBytes(SALT_BYTES);
    var iv = randomBytes(IV_BYTES);
    return deriveKey(password, salt, PBKDF2_ROUNDS)
      .then(function (key) {
        return window.crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, new TextEncoder().encode(plaintext));
      })
      .then(function (encrypted) {
        return {
          v: FORMAT_VERSION,
          iter: PBKDF2_ROUNDS,
          salt: bytesToBase64(salt),
          iv: bytesToBase64(iv),
          data: bytesToBase64(encrypted)
        };
      });
  }

  function decryptText(cipher, password) {
    if (!isCryptoAvailable()) {
      return Promise.reject(new Error('이 브라우저는 복호화(Web Crypto)를 지원하지 않아.'));
    }
    if (!cipher || Number(cipher.v) !== FORMAT_VERSION || !cipher.salt || !cipher.iv || !cipher.data) {
      return Promise.reject(new Error('암호문 형식이 올바르지 않아.'));
    }
    var rounds = Number(cipher.iter) || PBKDF2_ROUNDS;
    return deriveKey(password, base64ToBytes(cipher.salt), rounds)
      .then(function (key) {
        return window.crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64ToBytes(cipher.iv) }, key, base64ToBytes(cipher.data));
      })
      .then(function (decrypted) {
        return new TextDecoder().decode(decrypted);
      }, function () {
        var error = new Error('비밀번호가 틀렸어.');
        error.wrongPassword = true;
        throw error;
      });
  }

  /* ---------- file format ---------- */

  function splitFrontMatter(text) {
    var match = FRONT_MATTER_PATTERN.exec(text);
    if (!match) {
      return { front: null, body: text };
    }
    return { front: match[1], body: text.slice(match[0].length) };
  }

  function readFrontValue(front, key) {
    var match = new RegExp('^' + key + ':[ \\t]*(.*)$', 'm').exec(front || '');
    if (!match) {
      return '';
    }
    return match[1].trim().replace(/^["']|["']$/g, '');
  }

  function readFrontLine(front, key) {
    var match = new RegExp('^' + key + ':.*$', 'm').exec(front || '');
    return match ? match[0] : null;
  }

  function isSecretRequested(text) {
    var parts = splitFrontMatter(text);
    return /^secret:[ \t]*true[ \t]*$/m.test(parts.front || '');
  }

  function readCipherFromFile(text) {
    var parts = splitFrontMatter(text);
    if (!parts.front || !/^secret:[ \t]*true/m.test(parts.front) || !/^cipher:/m.test(parts.front)) {
      return null;
    }
    var cipher = {};
    var pattern = /^[ \t]+(v|iter|salt|iv|data):[ \t]*"?([^"\r\n]*)"?[ \t]*$/gm;
    var match;
    while ((match = pattern.exec(parts.front)) !== null) {
      cipher[match[1]] = match[2];
    }
    return cipher;
  }

  function buildEncryptedFile(plaintext, password) {
    var parts = splitFrontMatter(plaintext);
    if (parts.front === null) {
      return Promise.reject(new Error('front matter(--- ... ---)가 있어야 비밀글로 저장할 수 있어.'));
    }
    var dateLine = readFrontLine(parts.front, 'date');
    var categoriesLine = readFrontLine(parts.front, 'categories');
    return encryptText(plaintext, password).then(function (cipher) {
      var lines = ['---', 'title: "' + PLACEHOLDER_TITLE + '"'];
      if (dateLine) {
        lines.push(dateLine);
      }
      if (categoriesLine) {
        lines.push(categoriesLine);
      }
      lines.push(
        'secret: true',
        'cipher:',
        '  v: ' + cipher.v,
        '  iter: ' + cipher.iter,
        '  salt: "' + cipher.salt + '"',
        '  iv: "' + cipher.iv + '"',
        '  data: "' + cipher.data + '"',
        '---',
        ''
      );
      return lines.join('\n');
    });
  }

  /* ---------- markdown renderer (vendored marked, loaded on demand) ---------- */

  var markedPromise = null;

  function loadMarked(scriptUrl) {
    if (window.marked) {
      return Promise.resolve(window.marked);
    }
    if (markedPromise) {
      return markedPromise;
    }
    markedPromise = new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      script.src = scriptUrl;
      script.async = true;
      script.onload = function () {
        if (window.marked) {
          resolve(window.marked);
        } else {
          reject(new Error('Markdown 렌더러가 비어 있어.'));
        }
      };
      script.onerror = function () {
        markedPromise = null;
        reject(new Error('Markdown 렌더러(' + scriptUrl + ')를 불러오지 못했어.'));
      };
      document.head.appendChild(script);
    });
    return markedPromise;
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function renderMarkdown(markedLibrary, markdown) {
    var parser = new markedLibrary.Marked({
      gfm: true,
      renderer: {
        code: function (token) {
          var language = String(token.lang || 'plaintext').split(/\s/)[0].replace(/[^\w-]/g, '') || 'plaintext';
          return '<div class="language-' + language + ' highlighter-rouge"><div class="highlight"><pre class="highlight"><code>' +
            escapeHtml(token.text) + '</code></pre></div></div>\n';
        }
      }
    });
    return parser.parse(markdown);
  }

  function renderPlainFallback(markdownNode, text) {
    var pre = document.createElement('pre');
    pre.textContent = text;
    markdownNode.textContent = '';
    markdownNode.appendChild(pre);
  }

  /* ---------- reader (lock box on a secret post page) ---------- */

  function readCipherFromLockBox(lockNode) {
    return {
      v: lockNode.getAttribute('data-v'),
      iter: lockNode.getAttribute('data-iter'),
      salt: lockNode.getAttribute('data-salt'),
      iv: lockNode.getAttribute('data-iv'),
      data: lockNode.getAttribute('data-data')
    };
  }

  function showDecryptedPost(lockNode, plaintext) {
    var parts = splitFrontMatter(plaintext);
    var realTitle = readFrontValue(parts.front, 'title') || PLACEHOLDER_TITLE;
    var titleNode = document.getElementById('doc-title-text');
    var markdownNode = document.getElementById('md');

    if (titleNode) {
      titleNode.textContent = realTitle;
    }
    document.title = realTitle + ' · ' + document.title.split(' · ').slice(1).join(' · ');
    lockNode.hidden = true;

    if (!markdownNode) {
      return Promise.resolve();
    }
    var markedUrl = lockNode.getAttribute('data-marked-src');
    return loadMarked(markedUrl)
      .then(function (markedLibrary) {
        markdownNode.innerHTML = renderMarkdown(markedLibrary, parts.body);
      })
      .catch(function (error) {
        console.error('[vsblog-secret]', error);
        renderPlainFallback(markdownNode, parts.body);
      })
      .then(function () {
        if (window.vsblog && window.vsblog.enhanceMarkdown) {
          window.vsblog.enhanceMarkdown(markdownNode);
        }
      });
  }

  function setLockBusy(lockNode, busy) {
    lockNode.classList.toggle('is-busy', busy);
    var button = lockNode.querySelector('button[type="submit"]');
    var field = lockNode.querySelector('input[type="password"]');
    if (button) {
      button.disabled = busy;
      button.textContent = busy ? '복호화 중...' : 'Unlock';
    }
    if (field) {
      field.disabled = busy;
    }
  }

  function initLockBox() {
    var lockNode = document.getElementById('secret-lock');
    if (!lockNode) {
      return;
    }
    var formNode = document.getElementById('secret-form');
    var passwordNode = document.getElementById('secret-password');
    var errorNode = document.getElementById('secret-error');

    if (!isCryptoAvailable()) {
      errorNode.textContent = '이 브라우저는 비밀글 복호화를 지원하지 않습니다.';
      return;
    }

    formNode.addEventListener('submit', function (event) {
      event.preventDefault();
      var password = passwordNode.value;
      if (!password) {
        return;
      }
      errorNode.textContent = '';
      setLockBusy(lockNode, true);
      decryptText(readCipherFromLockBox(lockNode), password)
        .then(function (plaintext) {
          unlockedPage.path = lockNode.getAttribute('data-path');
          unlockedPage.password = password;
          passwordNode.value = '';
          return showDecryptedPost(lockNode, plaintext);
        })
        .catch(function (error) {
          errorNode.textContent = error.wrongPassword ? '비밀번호가 틀렸습니다.' : error.message;
          passwordNode.select();
        })
        .then(function () {
          setLockBusy(lockNode, false);
        });
    });
  }

  /* ---------- public api (used by vscode-scm.js) ---------- */

  window.vsblogSecret = {
    PLACEHOLDER_TITLE: PLACEHOLDER_TITLE,
    isCryptoAvailable: isCryptoAvailable,
    decryptText: decryptText,
    isSecretRequested: isSecretRequested,
    readCipherFromFile: readCipherFromFile,
    buildEncryptedFile: buildEncryptedFile,
    getUnlockedPassword: function (path) {
      return unlockedPage.path && unlockedPage.path === path ? unlockedPage.password : null;
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initLockBox);
  } else {
    initLockBox();
  }
})();
