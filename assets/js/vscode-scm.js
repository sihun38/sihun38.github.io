/* ==========================================================
   Source control for the VS Code style blog
   - real commits through the GitHub Contents API
   - only works with a token that has write access to the repo
     (GitHub enforces this; the owner check here is for the UI)
   ========================================================== */
(function () {
  'use strict';

  var API_ROOT = 'https://api.github.com';
  var API_VERSION = '2022-11-28';
  var SESSION_KEY = 'vsblog.githubSession';
  /* letters (incl. Korean), digits, spaces, - and _ ; must start with a letter or digit */
  var SLUG_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N} _-]*$/u;
  var SLUG_MAX_LENGTH = 80;
  var PAGES_DELAY_NOTE = 'GitHub Pages 반영까지 보통 1~2분 걸려.';

  var state = {
    token: null,
    login: null,
    branch: 'main',
    isOwner: false,
    busy: false
  };

  /* ---------- session storage (tab-scoped, cleared on close) ---------- */

  function readSession() {
    try {
      var raw = window.sessionStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      return null;
    }
  }

  function writeSession(session) {
    try {
      window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    } catch (error) {
      /* storage blocked: login lasts only for this page */
    }
  }

  function clearSession() {
    try {
      window.sessionStorage.removeItem(SESSION_KEY);
    } catch (error) {
      /* ignore */
    }
  }

  /* ---------- text helpers ---------- */

  function parseRepository(repository) {
    var parts = String(repository || '').split('/');
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      return null;
    }
    return { owner: parts[0], name: parts[1] };
  }

  function encodeBase64Utf8(text) {
    var bytes = new TextEncoder().encode(text);
    var binary = '';
    var chunkSize = 0x8000;
    for (var i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
    }
    return window.btoa(binary);
  }

  function decodeBase64Utf8(encoded) {
    var binary = window.atob(String(encoded).replace(/\s/g, ''));
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new TextDecoder().decode(bytes);
  }

  function encodeRepoPath(path) {
    return path.split('/').map(encodeURIComponent).join('/');
  }

  function padNumber(value) {
    return String(value).padStart(2, '0');
  }

  function formatDateOnly(date) {
    return date.getFullYear() + '-' + padNumber(date.getMonth() + 1) + '-' + padNumber(date.getDate());
  }

  function formatFrontMatterDate(date) {
    var offsetMinutes = -date.getTimezoneOffset();
    var sign = offsetMinutes >= 0 ? '+' : '-';
    var absolute = Math.abs(offsetMinutes);
    return formatDateOnly(date) + ' ' + padNumber(date.getHours()) + ':' + padNumber(date.getMinutes()) + ':00 ' +
      sign + padNumber(Math.floor(absolute / 60)) + padNumber(absolute % 60);
  }

  function normalizeSlug(text) {
    return String(text || '')
      .normalize('NFC')
      .replace(/\.md$/i, '')
      .trim()
      .replace(/\s+/g, ' ');
  }

  function getFileName(path) {
    return path.split('/').pop();
  }

  /* ---------- GitHub API ---------- */

  function createApiError(status, message) {
    var text;
    if (status === 401) {
      text = '인증 실패 (401): 토큰이 틀렸거나 만료됐어.';
    } else if (status === 403) {
      text = '권한 없음 (403): 이 토큰으로는 이 레포에 쓸 수 없어. ' + (message || '');
    } else if (status === 404) {
      text = '찾을 수 없음 (404): 파일이 없거나 토큰이 이 레포에 접근하지 못해.';
    } else if (status === 409) {
      text = '충돌 (409): 다른 곳에서 먼저 수정됐어. 파일을 다시 열어서 수정해 줘.';
    } else if (status === 422) {
      text = '요청 거부 (422): ' + (message || '입력값을 확인해 줘.');
    } else {
      text = 'GitHub API 오류 (' + status + '): ' + (message || 'unknown');
    }
    var error = new Error(text);
    error.status = status;
    return error;
  }

  function githubRequest(method, apiPath, body, tokenOverride) {
    var headers = {
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': API_VERSION
    };
    var token = tokenOverride || state.token;
    if (token) {
      headers.Authorization = 'Bearer ' + token;
    }
    if (body) {
      headers['Content-Type'] = 'application/json';
    }

    return fetch(API_ROOT + apiPath, {
      method: method,
      headers: headers,
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store'
    })
      .catch(function () {
        throw new Error('네트워크 오류: GitHub API에 연결할 수 없어.');
      })
      .then(function (response) {
        if (response.status === 204) {
          return null;
        }
        return response.json()
          .catch(function () { return {}; })
          .then(function (data) {
            if (!response.ok) {
              throw createApiError(response.status, data && data.message);
            }
            return data;
          });
      });
  }

  function contentsPath(repo, path) {
    return '/repos/' + repo.owner + '/' + repo.name + '/contents/' + encodeRepoPath(path);
  }

  function fetchFile(repo, path) {
    return githubRequest('GET', contentsPath(repo, path) + '?ref=' + encodeURIComponent(state.branch))
      .then(function (data) {
        if (Array.isArray(data) || data.type !== 'file') {
          throw new Error(path + ' 는 파일이 아니야.');
        }
        return { path: data.path, sha: data.sha, content: decodeBase64Utf8(data.content || '') };
      });
  }

  function fileExists(repo, path) {
    return fetchFile(repo, path)
      .then(function () { return true; })
      .catch(function (error) {
        if (error.status === 404) {
          return false;
        }
        throw error;
      });
  }

  function putFile(repo, path, content, sha, message) {
    var body = { message: message, content: encodeBase64Utf8(content), branch: state.branch };
    if (sha) {
      body.sha = sha;
    }
    return githubRequest('PUT', contentsPath(repo, path), body);
  }

  function deleteFile(repo, path, sha, message) {
    return githubRequest('DELETE', contentsPath(repo, path), { message: message, sha: sha, branch: state.branch });
  }

  function verifyToken(repo, token) {
    var userRequest = githubRequest('GET', '/user', null, token);
    var repoRequest = githubRequest('GET', '/repos/' + repo.owner + '/' + repo.name, null, token);
    return Promise.all([userRequest, repoRequest]).then(function (results) {
      var user = results[0];
      var repoInfo = results[1];
      var permissions = repoInfo.permissions || {};
      return {
        login: user.login,
        branch: repoInfo.default_branch || 'main',
        isOwner: String(user.login).toLowerCase() === repo.owner.toLowerCase() && permissions.push === true
      };
    });
  }

  /* ---------- status bar ---------- */

  function updateStatusBadge() {
    var badge = document.getElementById('scm-status');
    if (!badge) {
      return;
    }
    var label = '⎇ ' + state.branch;
    if (state.busy) {
      label += ' ⟳ committing';
    } else if (state.isOwner) {
      label += ' · ' + state.login + ' ✓';
    }
    badge.textContent = label;
    badge.classList.toggle('is-owner', state.isOwner);
    badge.classList.toggle('is-busy', state.busy);
  }

  function setBusy(busy) {
    state.busy = busy;
    updateStatusBadge();
  }

  /* ---------- quick input (command palette style) ---------- */

  function openQuickInput(options) {
    return new Promise(function (resolve) {
      var backdrop = document.createElement('div');
      backdrop.className = 'quick-input-backdrop';

      var box = document.createElement('div');
      box.className = 'quick-input';
      box.setAttribute('role', 'dialog');

      var title = document.createElement('p');
      title.className = 'quick-input__title';
      title.textContent = options.title || '';

      var field = document.createElement('input');
      field.className = 'quick-input__field';
      field.type = options.password ? 'password' : 'text';
      field.placeholder = options.placeholder || '';
      field.autocomplete = 'off';
      field.spellcheck = false;

      if (options.title) {
        box.appendChild(title);
      }
      box.appendChild(field);
      if (options.hintNodes) {
        var hint = document.createElement('p');
        hint.className = 'quick-input__hint';
        options.hintNodes.forEach(function (node) { hint.appendChild(node); });
        box.appendChild(hint);
      }

      function close(value) {
        backdrop.remove();
        box.remove();
        resolve(value);
      }

      field.addEventListener('keydown', function (event) {
        if (event.key === 'Enter') {
          event.preventDefault();
          close(field.value);
        } else if (event.key === 'Escape') {
          event.preventDefault();
          close(null);
        }
      });
      backdrop.addEventListener('click', function () { close(null); });

      document.body.appendChild(backdrop);
      document.body.appendChild(box);
      field.focus();
    });
  }

  /* ---------- post validation (warn before commit) ---------- */

  function readFrontMatter(content) {
    var match = /^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/.exec(content);
    return match ? match[1] : null;
  }

  function readCategories(frontMatter) {
    var match = /^categories:\s*\[([^\]]*)\]/m.exec(frontMatter);
    if (!match) {
      return [];
    }
    return match[1].split(',').map(function (item) {
      return item.trim().replace(/^["']|["']$/g, '');
    }).filter(Boolean);
  }

  function findPostProblems(path, content, folders) {
    if (path.indexOf('_posts/') !== 0) {
      return [];
    }
    var frontMatter = readFrontMatter(content);
    if (frontMatter === null) {
      return ['맨 위에 --- 로 감싼 front matter가 없어. 블로그 Explorer에 안 보여.'];
    }
    var problems = [];
    if (!/^title:/m.test(frontMatter)) {
      problems.push('title 이 없어.');
    }
    var categories = readCategories(frontMatter);
    var folderTitles = folders.map(function (folder) { return folder.title; });
    var matched = categories.some(function (category) { return folderTitles.indexOf(category) !== -1; });
    if (!matched) {
      problems.push('categories 가 폴더 이름과 안 맞아. 가능한 값: ' + folderTitles.join(', '));
    }
    return problems;
  }

  function confirmPostProblems(problems) {
    if (problems.length === 0) {
      return true;
    }
    return window.confirm('이 글은 블로그에 제대로 안 보일 수 있어.\n\n- ' + problems.join('\n- ') + '\n\n그래도 커밋할까?');
  }

  /* ---------- secret post helpers ---------- */

  var MIN_SECRET_PASSWORD = 8;

  function getSecretApi() {
    return window.vsblogSecret && window.vsblogSecret.isCryptoAvailable() ? window.vsblogSecret : null;
  }

  function askNewSecretPassword() {
    return openQuickInput({ title: '비밀글 비밀번호 설정 (' + MIN_SECRET_PASSWORD + '자 이상, 12자 이상 권장)', password: true })
      .then(function (first) {
        if (first === null) {
          return null;
        }
        if (first.length < MIN_SECRET_PASSWORD) {
          throw new Error('비밀번호는 ' + MIN_SECRET_PASSWORD + '자 이상이어야 해.');
        }
        return openQuickInput({ title: '비밀번호 한 번 더 입력', password: true }).then(function (second) {
          if (second === null) {
            return null;
          }
          if (second !== first) {
            throw new Error('두 비밀번호가 달라.');
          }
          return first;
        });
      });
  }

  /* returns the text to commit, or null when the user cancels */
  function prepareCommitContent(current, content) {
    var secretApi = getSecretApi();
    var wantsSecret = window.vsblogSecret ? window.vsblogSecret.isSecretRequested(content) : false;

    if (!wantsSecret) {
      if (current.secretPassword && !window.confirm('secret: true 가 빠졌어. 이대로 커밋하면 이 글이 암호화 없이 공개돼. 계속할까?')) {
        return Promise.resolve(null);
      }
      return Promise.resolve({ text: content, password: null });
    }
    if (!secretApi) {
      return Promise.reject(new Error('이 브라우저에서는 암호화를 할 수 없어서 비밀글을 저장할 수 없어.'));
    }
    var passwordPromise = current.secretPassword ? Promise.resolve(current.secretPassword) : askNewSecretPassword();
    return passwordPromise.then(function (password) {
      if (!password) {
        return null;
      }
      return secretApi.buildEncryptedFile(content, password).then(function (encrypted) {
        return { text: encrypted, password: password };
      });
    });
  }

  function unlockFileForEditing(context, file) {
    var secretApi = getSecretApi();
    var cipher = window.vsblogSecret ? window.vsblogSecret.readCipherFromFile(file.content) : null;
    if (!cipher) {
      return Promise.resolve(file);
    }
    if (!secretApi) {
      return Promise.reject(new Error('이 브라우저에서는 비밀글을 복호화할 수 없어.'));
    }
    var remembered = secretApi.getUnlockedPassword(file.path);
    var passwordPromise = remembered
      ? Promise.resolve(remembered)
      : openQuickInput({ title: '비밀글 비밀번호 (' + getFileName(file.path) + ')', password: true });
    return passwordPromise.then(function (password) {
      if (!password) {
        return null;
      }
      return secretApi.decryptText(cipher, password).then(function (plaintext) {
        return { path: file.path, sha: file.sha, content: plaintext, secretPassword: password };
      });
    });
  }

  /* ---------- file editor overlay ---------- */

  function updateGutter(gutterNode, text) {
    var lineCount = text.split('\n').length;
    var numbers = [];
    for (var i = 1; i <= lineCount; i += 1) {
      numbers.push(i);
    }
    gutterNode.textContent = numbers.join('\n');
  }

  function insertTabSpaces(textArea) {
    var start = textArea.selectionStart;
    var end = textArea.selectionEnd;
    textArea.value = textArea.value.slice(0, start) + '  ' + textArea.value.slice(end);
    textArea.selectionStart = textArea.selectionEnd = start + 2;
  }

  function createEditorButton(label, className) {
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'file-editor__btn' + (className ? ' ' + className : '');
    button.textContent = label;
    return button;
  }

  function openFileEditor(context, file) {
    var terminal = context.terminal;
    var current = { path: file.path, sha: file.sha, savedContent: file.content, secretPassword: file.secretPassword || null };

    var root = document.createElement('div');
    root.className = 'file-editor';
    root.setAttribute('role', 'dialog');

    var bar = document.createElement('div');
    bar.className = 'file-editor__bar';
    var tab = document.createElement('div');
    tab.className = 'file-editor__tab';
    var tabName = document.createElement('span');
    tabName.textContent = getFileName(file.path);
    var dirtyMark = document.createElement('span');
    dirtyMark.className = 'file-editor__dirty';
    tab.appendChild(tabName);
    tab.appendChild(dirtyMark);
    var pathLabel = document.createElement('div');
    pathLabel.className = 'file-editor__path';
    pathLabel.textContent = context.repo.owner + '/' + context.repo.name + ' › ' + state.branch + ' › ' + file.path;
    var spacer = document.createElement('div');
    spacer.className = 'file-editor__spacer';
    var actions = document.createElement('div');
    actions.className = 'file-editor__actions';
    var saveButton = createEditorButton('Commit (Ctrl+S)', 'file-editor__btn--primary');
    var closeButton = createEditorButton('Close (Esc)');
    actions.appendChild(saveButton);
    actions.appendChild(closeButton);
    bar.appendChild(tab);
    bar.appendChild(pathLabel);
    bar.appendChild(spacer);
    bar.appendChild(actions);

    var body = document.createElement('div');
    body.className = 'file-editor__body';
    var gutter = document.createElement('pre');
    gutter.className = 'file-editor__gutter';
    gutter.setAttribute('aria-hidden', 'true');
    var textArea = document.createElement('textarea');
    textArea.className = 'file-editor__text';
    textArea.spellcheck = false;
    textArea.value = file.content;
    body.appendChild(gutter);
    body.appendChild(textArea);

    var messageBar = document.createElement('label');
    messageBar.className = 'file-editor__msg';
    messageBar.appendChild(document.createTextNode('commit message'));
    var messageField = document.createElement('input');
    messageField.type = 'text';
    messageField.value = (file.sha ? 'post: update ' : 'post: add ') + getFileName(file.path);
    messageBar.appendChild(messageField);

    root.appendChild(bar);
    root.appendChild(body);
    root.appendChild(messageBar);

    function isDirty() {
      return textArea.value !== current.savedContent;
    }

    function refreshDirtyMark() {
      dirtyMark.textContent = isDirty() ? '●' : '';
    }

    function warnBeforeUnload(event) {
      if (isDirty()) {
        event.preventDefault();
        event.returnValue = '';
      }
    }

    function closeEditor() {
      if (isDirty() && !window.confirm('커밋하지 않은 수정 내용이 있어. 닫을까?')) {
        return;
      }
      window.removeEventListener('beforeunload', warnBeforeUnload);
      root.remove();
      terminal.inputNode && terminal.inputNode.focus();
    }

    function save() {
      if (state.busy) {
        return;
      }
      if (!isDirty() && current.sha) {
        terminal.printLine(terminal.createSpan('nothing to commit, working tree clean', 'term-dim'));
        return;
      }
      var message = messageField.value.trim() || ('post: update ' + getFileName(current.path));
      var content = textArea.value;
      if (!confirmPostProblems(findPostProblems(current.path, content, context.siteData.folders))) {
        terminal.printLine(terminal.createSpan('commit cancelled', 'term-dim'));
        return;
      }
      setBusy(true);
      saveButton.disabled = true;
      prepareCommitContent(current, content)
        .then(function (prepared) {
          if (!prepared) {
            terminal.printLine(terminal.createSpan('commit cancelled', 'term-dim'));
            return null;
          }
          return putFile(context.repo, current.path, prepared.text, current.sha, message).then(function (result) {
            current.sha = result.content.sha;
            current.savedContent = content;
            current.secretPassword = prepared.password;
            refreshDirtyMark();
            var shortSha = String(result.commit.sha).slice(0, 7);
            terminal.printLine([
              terminal.createSpan('[' + state.branch + ' ' + shortSha + '] ', 'term-ok'),
              message
            ]);
            if (prepared.password) {
              terminal.printLine(terminal.createSpan(' encrypted (AES-256-GCM) — 레포에는 암호문만 올라갔어', 'term-warn'));
            }
            terminal.printLine(terminal.createSpan(' 1 file changed: ' + current.path + ' · ' + PAGES_DELAY_NOTE, 'term-dim'));
            messageField.value = 'post: update ' + getFileName(current.path);
          });
        })
        .catch(function (error) {
          terminal.printError('commit 실패: ' + error.message);
          window.alert('commit 실패\n' + error.message);
        })
        .then(function () {
          setBusy(false);
          saveButton.disabled = false;
          terminal.scrollToBottom();
        });
    }

    textArea.addEventListener('input', function () {
      updateGutter(gutter, textArea.value);
      refreshDirtyMark();
    });
    textArea.addEventListener('scroll', function () {
      gutter.scrollTop = textArea.scrollTop;
    });
    root.addEventListener('keydown', function (event) {
      if ((event.ctrlKey || event.metaKey) && (event.key === 's' || event.key === 'S')) {
        event.preventDefault();
        save();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        closeEditor();
      } else if (event.key === 'Tab' && event.target === textArea) {
        event.preventDefault();
        insertTabSpaces(textArea);
        updateGutter(gutter, textArea.value);
        refreshDirtyMark();
      }
    });
    saveButton.addEventListener('click', save);
    closeButton.addEventListener('click', closeEditor);
    window.addEventListener('beforeunload', warnBeforeUnload);

    document.body.appendChild(root);
    updateGutter(gutter, textArea.value);
    refreshDirtyMark();
    textArea.focus();
  }

  /* ---------- path resolution ---------- */

  function resolveRepoPath(context, argument) {
    var siteData = context.siteData;
    if (!argument) {
      return siteData.page && siteData.page.path ? siteData.page.path : null;
    }
    var lower = argument.toLowerCase();
    if (lower === 'about.txt' || lower === 'about') {
      return '_pages/about.md';
    }
    var post = context.findPost(argument);
    if (post && post.path) {
      return post.path;
    }
    if (argument.indexOf('/') !== -1 || /\.(md|markdown|html|yml|yaml)$/i.test(argument)) {
      return argument.replace(/^\/+/, '');
    }
    return null;
  }

  /* ---------- commands ---------- */

  function requireOwner(terminal, commandName) {
    if (state.isOwner) {
      return true;
    }
    terminal.printError(commandName + ': permission denied — 블로그 소유자만 쓸 수 있는 명령이야. (login 필요)');
    return false;
  }

  function commandLogin(context) {
    var terminal = context.terminal;
    if (state.isOwner) {
      terminal.printLine(terminal.createSpan('already logged in as ' + state.login, 'term-ok'));
      return null;
    }
    return openQuickInput({
      placeholder: 'github_pat_...',
      password: true
    }).then(function (token) {
      if (!token || !token.trim()) {
        terminal.printLine(terminal.createSpan('login cancelled', 'term-dim'));
        return null;
      }
      var trimmed = token.trim();
      terminal.printLine(terminal.createSpan('verifying token with GitHub ...', 'term-dim'));
      return verifyToken(context.repo, trimmed).then(function (result) {
        if (!result.isOwner) {
          terminal.printError('login: ' + result.login + ' 은(는) 이 블로그 소유자가 아니거나 쓰기 권한이 없어. 토큰을 저장하지 않았어.');
          return;
        }
        state.token = trimmed;
        state.login = result.login;
        state.branch = result.branch;
        state.isOwner = true;
        writeSession({ token: trimmed, login: result.login, branch: result.branch });
        updateStatusBadge();
        terminal.setPromptUser(context.siteData.user);
        terminal.printLine([terminal.createSpan('logged in as ' + result.login, 'term-ok'), terminal.createSpan('  (branch: ' + result.branch + ')', 'term-dim')]);
        terminal.printLine(terminal.createSpan('new <dir> <slug> · edit [file] · rm <file> · git log 사용 가능', 'term-dim'));
      });
    });
  }

  function commandLogout(context) {
    state.token = null;
    state.login = null;
    state.isOwner = false;
    clearSession();
    updateStatusBadge();
    context.terminal.setPromptUser(null);
    context.terminal.printLine(context.terminal.createSpan('logged out. 토큰을 이 탭에서 지웠어.', 'term-dim'));
  }

  function commandNew(context, rawArgs, commandName) {
    var terminal = context.terminal;
    if (!requireOwner(terminal, commandName)) {
      return null;
    }
    var isSecret = rawArgs.indexOf('--secret') !== -1;
    var args = rawArgs.filter(function (arg) { return arg !== '--secret'; });
    if (args.length < 2) {
      terminal.printError('usage: ' + commandName + ' <dir> <slug> [--secret]   예) ' + commandName + ' ctf ret2libc');
      return null;
    }
    var folder = context.findFolder(args[0]);
    if (!folder) {
      terminal.printError(commandName + ': ' + args[0] + ': No such directory (ls 로 폴더 이름 확인)');
      return null;
    }
    var slug = normalizeSlug(args[1]);
    if (!SLUG_PATTERN.test(slug) || slug.length > SLUG_MAX_LENGTH) {
      terminal.printError(commandName + ': 파일 이름은 한글, 영어, 숫자, 공백, -, _ 만 쓸 수 있어. (첫 글자는 글자나 숫자, ' + SLUG_MAX_LENGTH + '자 이하)');
      return null;
    }
    var now = new Date();
    var path = '_posts/' + formatDateOnly(now) + '-' + slug + '.md';
    var template = [
      '---',
      'title: "제목을 입력하세요"',
      'date: ' + formatFrontMatterDate(now),
      'categories: [' + folder.title + ']',
      'tags: []'
    ].concat(isSecret ? ['secret: true'] : []).concat([
      '---',
      '',
      '## ',
      ''
    ]).join('\n');

    return fileExists(context.repo, path).then(function (exists) {
      if (exists) {
        terminal.printError(commandName + ': ' + path + ' 가 이미 있어. edit ' + slug + '.md 로 열어.');
        return;
      }
      terminal.printLine(terminal.createSpan('created buffer ' + path + ' (커밋해야 실제로 생성돼)', 'term-dim'));
      openFileEditor(context, { path: path, sha: null, content: template });
    });
  }

  function commandEdit(context, args) {
    var terminal = context.terminal;
    if (!requireOwner(terminal, 'edit')) {
      return null;
    }
    var path = resolveRepoPath(context, args[0]);
    if (!path) {
      terminal.printError('edit: ' + (args[0] ? args[0] + ': No such file' : '열 파일을 지정해 줘. 예) edit ctf-intro.md'));
      return null;
    }
    terminal.printLine(terminal.createSpan('opening ' + path + ' ...', 'term-dim'));
    return fetchFile(context.repo, path)
      .then(function (file) { return unlockFileForEditing(context, file); })
      .then(function (file) {
        if (!file) {
          terminal.printLine(terminal.createSpan('edit cancelled', 'term-dim'));
          return;
        }
        if (file.secretPassword) {
          terminal.printLine(terminal.createSpan('decrypted in browser — 저장하면 다시 암호화돼', 'term-warn'));
        }
        openFileEditor(context, file);
      });
  }

  function commandRm(context, args) {
    var terminal = context.terminal;
    if (!requireOwner(terminal, 'rm')) {
      return null;
    }
    var path = resolveRepoPath(context, args[0]);
    if (!args[0] || !path) {
      terminal.printError('rm: ' + (args[0] ? args[0] + ': No such file' : 'missing operand'));
      return null;
    }
    var fileName = getFileName(path);
    return openQuickInput({
      title: '정말 삭제하려면 파일 이름을 그대로 입력해: ' + fileName,
      placeholder: fileName
    }).then(function (answer) {
      if (answer === null || answer.trim() !== fileName) {
        terminal.printLine(terminal.createSpan('rm cancelled', 'term-dim'));
        return null;
      }
      setBusy(true);
      return fetchFile(context.repo, path)
        .then(function (file) {
          return deleteFile(context.repo, path, file.sha, 'post: remove ' + fileName);
        })
        .then(function (result) {
          var shortSha = String(result.commit.sha).slice(0, 7);
          terminal.printLine([terminal.createSpan('[' + state.branch + ' ' + shortSha + '] ', 'term-ok'), 'post: remove ' + fileName]);
          terminal.printLine(terminal.createSpan(' 1 file deleted · ' + PAGES_DELAY_NOTE, 'term-dim'));
        })
        .then(function () { setBusy(false); }, function (error) { setBusy(false); throw error; });
    });
  }

  function commandGitLog(context) {
    var terminal = context.terminal;
    var apiPath = '/repos/' + context.repo.owner + '/' + context.repo.name + '/commits?per_page=8&sha=' + encodeURIComponent(state.branch);
    return githubRequest('GET', apiPath).then(function (commits) {
      commits.forEach(function (commit) {
        var message = String(commit.commit.message).split('\n')[0];
        var date = String(commit.commit.author.date).slice(0, 10);
        terminal.printLine([
          terminal.createLink(commit.sha.slice(0, 7), commit.html_url, 'term-key'),
          terminal.createSpan('  ' + date + '  ', 'term-dim'),
          message
        ]);
      });
    });
  }

  function commandGitStatus(context) {
    var terminal = context.terminal;
    terminal.printLine('On branch ' + state.branch + '  (' + context.repo.owner + '/' + context.repo.name + ')');
    if (state.isOwner) {
      terminal.printLine(terminal.createSpan('logged in as ' + state.login + ' — new / edit / rm 사용 가능', 'term-ok'));
    } else {
      terminal.printLine(terminal.createSpan('read-only — 소유자는 login 으로 편집 권한을 켤 수 있어', 'term-dim'));
    }
  }

  function commandGit(context, args) {
    var sub = (args[0] || '').toLowerCase();
    if (sub === 'log') {
      return commandGitLog(context);
    }
    if (sub === 'status' || sub === '') {
      commandGitStatus(context);
      return null;
    }
    if (sub === 'push' || sub === 'commit') {
      context.terminal.printLine(context.terminal.createSpan('편집기에서 Ctrl+S 하면 바로 커밋 + 푸시돼.', 'term-dim'));
      return null;
    }
    context.terminal.printError('git: \'' + sub + '\' is not supported here. (status, log)');
    return null;
  }

  /* ---------- wiring ---------- */

  function restoreSession() {
    var session = readSession();
    if (session && session.token && session.login) {
      state.token = session.token;
      state.login = session.login;
      state.branch = session.branch || 'main';
      state.isOwner = true;
    }
  }

  function bindStatusBadge(context) {
    document.addEventListener('click', function (event) {
      if (!event.target.closest('[data-action="scm-status"]')) {
        return;
      }
      context.terminal.showPanel();
      context.terminal.run(state.isOwner ? 'git status' : 'login');
    });
  }

  function attach(api) {
    var repo = parseRepository(api.siteData.repository);
    if (!repo) {
      console.warn('[vsblog-scm] site.repository is missing, source control disabled');
      return;
    }
    if (!window.fetch || !window.TextEncoder) {
      console.warn('[vsblog-scm] browser lacks fetch/TextEncoder, source control disabled');
      return;
    }
    var context = {
      repo: repo,
      siteData: api.siteData,
      terminal: api.terminal,
      findPost: api.findPost,
      findFolder: api.findFolder
    };

    restoreSession();
    updateStatusBadge();
    if (state.isOwner) {
      api.terminal.setPromptUser(api.siteData.user);
    }

    var register = api.terminal.registerCommand;
    register('login', function () { return commandLogin(context); }, 'login', '(소유자) GitHub 토큰으로 편집 권한 켜기');
    register('logout', function () { commandLogout(context); }, 'logout', '편집 권한 끄기, 토큰 삭제');
    register('new', function (args) { return commandNew(context, args, 'new'); }, 'new <dir> <slug> [--secret]', '(소유자) 새 글 만들기, 이름에 한글·공백 가능, --secret 이면 비밀글');
    register('touch', function (args) { return commandNew(context, args, 'touch'); });
    register('edit', function (args) { return commandEdit(context, args); }, 'edit [file]', '(소유자) 글 수정, 생략하면 지금 보는 글');
    register('rm', function (args) { return commandRm(context, args); }, 'rm <file>', '(소유자) 글 삭제');
    register('git', function (args) { return commandGit(context, args); }, 'git status|log', '브랜치 상태, 최근 커밋 보기');

    bindStatusBadge(context);
  }

  if (window.vsblog) {
    attach(window.vsblog);
  } else {
    document.addEventListener('vsblog:ready', function (event) { attach(event.detail); }, { once: true });
  }
})();
