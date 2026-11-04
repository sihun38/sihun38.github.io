/* ==========================================================
   VS Code style shell — explorer, outline, terminal
   ========================================================== */
(function () {
  'use strict';

  var STORAGE_KEYS = {
    panelHidden: 'vsblog.panelHidden',
    sidebarHidden: 'vsblog.sidebarHidden',
    panelHeight: 'vsblog.panelHeight'
  };
  var PANEL_MIN_HEIGHT = 90;
  var EDITOR_MIN_HEIGHT = 120;
  var MOBILE_QUERY = '(max-width: 820px)';
  var HOST_NAME = 'research';

  var COMMAND_LIST = [
    ['help', '사용 가능한 명령 목록'],
    ['ls [dir]', '디렉터리 내용 보기 (예: ls ctf)'],
    ['cd <dir>', '카테고리로 이동 (cd .. / cd ~)'],
    ['cat <file>', '글 열기 (예: cat ctf-intro.md, cat about.txt)'],
    ['open <file>', 'cat 과 같음'],
    ['tree', '전체 글 트리 출력'],
    ['find <word>', '제목 / 태그 / 파일명 검색'],
    ['tags [tag]', '태그 목록, 또는 태그별 글'],
    ['whoami', '블로그 주인 정보'],
    ['neofetch', '시스템 정보'],
    ['pwd', '현재 경로'],
    ['history', '입력한 명령 기록'],
    ['clear', '터미널 지우기'],
    ['exit', '터미널 닫기 (Ctrl+` 로 다시 열기)']
  ];

  /* ---------- storage (optional, may be blocked) ---------- */

  function readStorage(key) {
    try {
      return window.localStorage.getItem(key);
    } catch (error) {
      return null;
    }
  }

  function writeStorage(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch (error) {
      /* storage unavailable: ignore */
    }
  }

  /* ---------- site data ---------- */

  function createEmptySiteData() {
    return {
      user: 'guest', bio: '', title: '', subtitle: '',
      home: '/', about: '/about/', tagsPage: '/tags/', postsPage: '/categories/',
      folders: [], posts: [], page: {}
    };
  }

  function loadSiteData() {
    var fallback = createEmptySiteData();
    var dataNode = document.getElementById('site-data');
    if (!dataNode) {
      console.warn('[vsblog] #site-data not found, terminal runs with empty data');
      return fallback;
    }
    try {
      var parsed = JSON.parse(dataNode.textContent);
      var merged = Object.assign(fallback, parsed);
      merged.posts = (merged.posts || []).map(normalizePost);
      merged.folders = (merged.folders || []).map(normalizeFolder);
      merged.page = merged.page || {};
      return merged;
    } catch (error) {
      console.error('[vsblog] failed to parse #site-data', error);
      return fallback;
    }
  }

  function normalizePost(post) {
    return {
      title: post.title || '',
      url: post.url || '#',
      slug: post.slug || '',
      path: post.path || '',
      date: post.date || '',
      categories: Array.isArray(post.categories) ? post.categories : [],
      tags: Array.isArray(post.tags) ? post.tags : []
    };
  }

  function normalizeFolder(folder) {
    return {
      title: folder.title || '',
      url: folder.url || '#',
      slug: getLastPathSegment(folder.url || '')
    };
  }

  function getLastPathSegment(url) {
    var parts = url.split('/').filter(Boolean);
    return parts.length ? parts[parts.length - 1] : '';
  }

  /* same rule as Jekyll's default slugify: keep letters/digits (unicode), others -> '-' */
  function slugify(text) {
    return String(text)
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/g, '');
  }

  /* ---------- layout toggles ---------- */

  function isMobile() {
    return window.matchMedia && window.matchMedia(MOBILE_QUERY).matches;
  }

  function restoreLayoutState(ideNode) {
    if (readStorage(STORAGE_KEYS.sidebarHidden) === '1') {
      ideNode.classList.add('is-sidebar-hidden');
    }
    var storedPanel = readStorage(STORAGE_KEYS.panelHidden);
    var panelHidden = storedPanel === null ? isMobile() : storedPanel === '1';
    ideNode.classList.toggle('is-panel-hidden', panelHidden);
  }

  function toggleSidebar(ideNode) {
    if (isMobile()) {
      ideNode.classList.toggle('is-sidebar-open');
      return;
    }
    var hidden = ideNode.classList.toggle('is-sidebar-hidden');
    writeStorage(STORAGE_KEYS.sidebarHidden, hidden ? '1' : '0');
  }

  function setPanelHidden(ideNode, hidden) {
    ideNode.classList.toggle('is-panel-hidden', hidden);
    if (hidden) {
      ideNode.classList.remove('is-panel-max');
    }
    writeStorage(STORAGE_KEYS.panelHidden, hidden ? '1' : '0');
  }

  function togglePanel(ideNode, inputNode) {
    var willHide = !ideNode.classList.contains('is-panel-hidden');
    setPanelHidden(ideNode, willHide);
    if (!willHide && inputNode) {
      inputNode.focus();
    }
  }

  /* ---------- panel resize ---------- */

  function clampPanelHeight(groupNode, height) {
    var maxHeight = groupNode.clientHeight - EDITOR_MIN_HEIGHT;
    return Math.round(Math.min(Math.max(height, PANEL_MIN_HEIGHT), Math.max(maxHeight, PANEL_MIN_HEIGHT)));
  }

  function applyPanelHeight(panelNode, height) {
    panelNode.style.height = height + 'px';
  }

  function restorePanelHeight(panelNode, groupNode) {
    var stored = Number(readStorage(STORAGE_KEYS.panelHeight));
    if (stored > 0) {
      applyPanelHeight(panelNode, clampPanelHeight(groupNode, stored));
    }
  }

  function resetPanelHeight(panelNode) {
    panelNode.style.height = '';
    writeStorage(STORAGE_KEYS.panelHeight, '');
  }

  function initPanelResize(ideNode) {
    var sashNode = document.getElementById('panel-sash');
    var panelNode = document.getElementById('panel');
    var groupNode = document.querySelector('.editor-group');
    if (!sashNode || !panelNode || !groupNode) {
      return;
    }
    restorePanelHeight(panelNode, groupNode);

    var startY = 0;
    var startHeight = 0;

    function onPointerMove(event) {
      var nextHeight = clampPanelHeight(groupNode, startHeight + (startY - event.clientY));
      applyPanelHeight(panelNode, nextHeight);
    }

    function onPointerUp(event) {
      sashNode.releasePointerCapture(event.pointerId);
      sashNode.removeEventListener('pointermove', onPointerMove);
      sashNode.removeEventListener('pointerup', onPointerUp);
      ideNode.classList.remove('is-resizing');
      writeStorage(STORAGE_KEYS.panelHeight, String(panelNode.offsetHeight));
    }

    sashNode.addEventListener('pointerdown', function (event) {
      if (ideNode.classList.contains('is-panel-max')) {
        ideNode.classList.remove('is-panel-max');
      }
      event.preventDefault();
      startY = event.clientY;
      startHeight = panelNode.offsetHeight;
      ideNode.classList.add('is-resizing');
      sashNode.setPointerCapture(event.pointerId);
      sashNode.addEventListener('pointermove', onPointerMove);
      sashNode.addEventListener('pointerup', onPointerUp);
    });

    sashNode.addEventListener('dblclick', function () {
      resetPanelHeight(panelNode);
    });

    window.addEventListener('resize', function () {
      if (panelNode.style.height) {
        applyPanelHeight(panelNode, clampPanelHeight(groupNode, panelNode.offsetHeight));
      }
    });
  }

  function togglePanelMax(ideNode) {
    if (ideNode.classList.contains('is-panel-hidden')) {
      setPanelHidden(ideNode, false);
    }
    ideNode.classList.toggle('is-panel-max');
  }

  function closeMobileSidebarOnOutsideClick(ideNode, targetNode) {
    if (!isMobile() || !ideNode.classList.contains('is-sidebar-open')) {
      return;
    }
    if (!targetNode.closest('#sidebar')) {
      ideNode.classList.remove('is-sidebar-open');
    }
  }

  function bindLayoutActions(ideNode, terminal) {
    document.addEventListener('click', function (event) {
      var trigger = event.target.closest('[data-action]');
      if (!trigger) {
        closeMobileSidebarOnOutsideClick(ideNode, event.target);
        return;
      }
      var action = trigger.getAttribute('data-action');
      if (action === 'toggle-sidebar') {
        toggleSidebar(ideNode);
      } else if (action === 'toggle-panel') {
        togglePanel(ideNode, terminal.inputNode);
      } else if (action === 'toggle-panel-max') {
        togglePanelMax(ideNode);
      } else if (action === 'focus-find') {
        setPanelHidden(ideNode, false);
        terminal.prefill('find ');
      }
    });

    document.addEventListener('keydown', function (event) {
      if (!event.ctrlKey && !event.metaKey) {
        return;
      }
      if (event.key === '`') {
        event.preventDefault();
        togglePanel(ideNode, terminal.inputNode);
      } else if (event.key === 'b' || event.key === 'B') {
        event.preventDefault();
        toggleSidebar(ideNode);
      }
    });
  }

  /* ---------- markdown enhancements ---------- */

  function addHeadingPrefixes(markdownNode) {
    var headings = markdownNode.querySelectorAll('h2, h3, h4');
    headings.forEach(function (heading) {
      var level = Number(heading.tagName.charAt(1));
      var prefix = document.createElement('span');
      prefix.className = 'md-prefix';
      prefix.textContent = '#'.repeat(level);
      heading.insertBefore(prefix, heading.firstChild);
    });
  }

  function buildOutline(markdownNode) {
    var outlineNode = document.getElementById('outline');
    var listNode = document.getElementById('outline-list');
    if (!outlineNode || !listNode) {
      return;
    }
    var headings = markdownNode.querySelectorAll('h2, h3');
    if (headings.length === 0) {
      return;
    }
    headings.forEach(function (heading, index) {
      if (!heading.id) {
        heading.id = 'section-' + (index + 1);
      }
      var item = document.createElement('li');
      item.className = heading.tagName === 'H3' ? 'is-h3' : 'is-h2';
      var link = document.createElement('a');
      link.href = '#' + heading.id;
      link.textContent = getHeadingText(heading);
      item.appendChild(link);
      listNode.appendChild(item);
    });
    outlineNode.hidden = false;
  }

  function getHeadingText(heading) {
    var clone = heading.cloneNode(true);
    var prefix = clone.querySelector('.md-prefix');
    if (prefix) {
      prefix.remove();
    }
    return clone.textContent.trim();
  }

  function enhanceCodeBlocks(markdownNode) {
    var blocks = markdownNode.querySelectorAll('div.highlighter-rouge, figure.highlight');
    blocks.forEach(function (block) {
      var languageClass = Array.prototype.find.call(block.classList, function (name) {
        return name.indexOf('language-') === 0;
      });
      if (languageClass && languageClass !== 'language-plaintext') {
        block.setAttribute('data-lang', languageClass.replace('language-', ''));
      }
      block.appendChild(createCopyButton(block));
    });
  }

  function createCopyButton(block) {
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'copy-btn';
    button.textContent = 'copy';
    button.addEventListener('click', function () {
      var codeNode = block.querySelector('code') || block.querySelector('pre');
      copyText(codeNode ? codeNode.textContent : '', button);
    });
    return button;
  }

  function copyText(text, button) {
    if (!navigator.clipboard || !navigator.clipboard.writeText) {
      flashButton(button, 'unsupported');
      return;
    }
    navigator.clipboard.writeText(text)
      .then(function () { flashButton(button, 'copied!'); })
      .catch(function (error) {
        console.error('[vsblog] copy failed', error);
        flashButton(button, 'failed');
      });
  }

  function flashButton(button, label) {
    button.textContent = label;
    window.setTimeout(function () { button.textContent = 'copy'; }, 1400);
  }

  function trackLineNumber(editorNode, statusNode) {
    var numbered = editorNode.querySelectorAll('.frontmatter > .fm-line, .doc__title, .md > *');
    if (!statusNode || numbered.length === 0) {
      return;
    }
    function updateLine() {
      var top = editorNode.scrollTop + 8;
      var line = 1;
      for (var i = 0; i < numbered.length; i += 1) {
        if (numbered[i].offsetTop - editorNode.offsetTop <= top) {
          line = i + 1;
        } else {
          break;
        }
      }
      statusNode.textContent = 'Ln ' + line + ', Col 1';
    }
    editorNode.addEventListener('scroll', updateLine, { passive: true });
    updateLine();
  }

  /* ---------- terminal: output helpers ---------- */

  function createSpan(text, className) {
    var span = document.createElement('span');
    span.textContent = text;
    if (className) {
      span.className = className;
    }
    return span;
  }

  function createLink(text, href, className) {
    var link = document.createElement('a');
    link.textContent = text;
    link.href = href;
    if (className) {
      link.className = className;
    }
    return link;
  }

  /* ---------- terminal: path helpers ---------- */

  function findFolder(siteData, name) {
    var target = String(name).replace(/^~\/?/, '').replace(/^posts\/?/, '').replace(/\/+$/, '');
    if (!target) {
      return null;
    }
    var lower = target.toLowerCase();
    return siteData.folders.find(function (folder) {
      return folder.slug.toLowerCase() === lower || folder.title.toLowerCase() === lower;
    }) || null;
  }

  function findPost(siteData, name) {
    var target = String(name).split('/').pop().replace(/\.md$/i, '').toLowerCase();
    if (!target) {
      return null;
    }
    return siteData.posts.find(function (post) {
      return post.slug.toLowerCase() === target;
    }) || null;
  }

  function getPostsInFolder(siteData, folder) {
    return siteData.posts.filter(function (post) {
      return post.categories.indexOf(folder.title) !== -1;
    });
  }

  function getCurrentFolder(siteData) {
    var page = siteData.page;
    if (page.taxonomy) {
      return findFolder(siteData, page.taxonomy);
    }
    if (page.isPost && Array.isArray(page.categories) && page.categories.length) {
      return findFolder(siteData, page.categories[0]);
    }
    return null;
  }

  function isRootPath(path) {
    return ['', '~', '~/', '/', 'posts', '~/posts', '~/posts/'].indexOf(path) !== -1;
  }

  /* ---------- terminal ---------- */

  function createTerminal(siteData, ideNode) {
    var outputNode = document.getElementById('terminal-output');
    var formNode = document.getElementById('terminal-form');
    var inputNode = document.getElementById('terminal-input');
    var terminalNode = document.getElementById('terminal');
    var promptPathNode = document.getElementById('prompt-path');

    var history = [];
    var historyIndex = 0;
    var currentFolder = getCurrentFolder(siteData);
    var currentPath = currentFolder ? '~/posts/' + currentFolder.slug : '~';

    if (!outputNode || !formNode || !inputNode) {
      console.warn('[vsblog] terminal elements missing');
      return { inputNode: null, prefill: function () {}, run: function () {} };
    }

    if (promptPathNode) {
      promptPathNode.textContent = currentPath;
    }

    function printLine(parts, className) {
      var line = document.createElement('div');
      line.className = 'term-line' + (className ? ' ' + className : '');
      (Array.isArray(parts) ? parts : [parts]).forEach(function (part) {
        line.appendChild(typeof part === 'string' ? document.createTextNode(part) : part);
      });
      outputNode.appendChild(line);
      return line;
    }

    function printError(message) {
      printLine(createSpan(message, 'term-err'));
    }

    function printEcho(rawCommand) {
      printLine([
        createSpan(siteData.user + '@' + HOST_NAME, 'prompt__user'),
        ':',
        createSpan(currentPath, 'prompt__path'),
        createSpan('$', 'prompt__sign'),
        rawCommand
      ], 'term-line--echo');
    }

    function scrollToBottom() {
      if (terminalNode) {
        terminalNode.scrollTop = terminalNode.scrollHeight;
      }
    }

    function navigateTo(url, label) {
      printLine([createSpan('opening ', 'term-dim'), createSpan(label, 'term-ok'), createSpan(' ...', 'term-dim')]);
      window.setTimeout(function () { window.location.href = url; }, 180);
    }

    function resolveFolderPath(argument) {
      if (!argument || argument === '.') {
        return currentFolder ? { folder: currentFolder } : { root: true };
      }
      if (argument === '..') {
        return { root: true };
      }
      if (isRootPath(argument)) {
        return { root: true };
      }
      var folder = findFolder(siteData, argument);
      return folder ? { folder: folder } : null;
    }

    /* ----- commands ----- */

    function commandHelp() {
      printLine(createSpan('available commands:', 'term-dim'));
      COMMAND_LIST.forEach(function (entry) {
        printLine([createSpan(entry[0].padEnd(14, ' '), 'term-key'), createSpan(entry[1], 'term-dim')]);
      });
    }

    function listRoot() {
      siteData.folders.forEach(function (folder) {
        var count = getPostsInFolder(siteData, folder).length;
        printLine([
          createLink(folder.slug + '/', folder.url, 'term-dir'),
          createSpan('  ' + folder.title + ' (' + count + ')', 'term-dim')
        ]);
      });
      printLine(createLink('about.txt', siteData.about));
      printLine(createLink('tags.json', siteData.tagsPage));
    }

    function listFolder(folder) {
      var posts = getPostsInFolder(siteData, folder);
      if (posts.length === 0) {
        printLine(createSpan('(empty directory)', 'term-dim'));
        return;
      }
      posts.forEach(function (post) {
        printLine([
          createSpan(post.date + '  ', 'term-dim'),
          createLink(post.slug + '.md', post.url),
          createSpan('  # ' + post.title, 'term-dim')
        ]);
      });
    }

    function commandLs(args) {
      var target = resolveFolderPath(args[0]);
      if (!target) {
        if (findPost(siteData, args[0])) {
          printLine(args[0]);
          return;
        }
        printError('ls: cannot access \'' + args[0] + '\': No such file or directory');
        return;
      }
      if (target.root) {
        listRoot();
      } else {
        listFolder(target.folder);
      }
    }

    function commandCd(args) {
      var target = resolveFolderPath(args[0] || '~');
      if (!target) {
        printError('cd: ' + args[0] + ': No such file or directory');
        return;
      }
      if (target.root) {
        navigateTo(siteData.home, '~');
      } else {
        navigateTo(target.folder.url, '~/posts/' + target.folder.slug);
      }
    }

    function commandCat(args, commandName) {
      var name = args[0];
      if (!name) {
        printError(commandName + ': missing file operand');
        return;
      }
      var lower = name.toLowerCase();
      if (lower === 'about.txt' || lower === 'about') {
        navigateTo(siteData.about, 'about.txt');
        return;
      }
      if (lower === 'tags.json' || lower === 'tags') {
        navigateTo(siteData.tagsPage, 'tags.json');
        return;
      }
      if (findFolder(siteData, name)) {
        printError(commandName + ': ' + name + ': Is a directory');
        return;
      }
      var post = findPost(siteData, name);
      if (!post) {
        printError(commandName + ': ' + name + ': No such file or directory');
        return;
      }
      navigateTo(post.url, post.slug + '.md');
    }

    function commandTree() {
      printLine(createSpan('~/posts', 'term-dir'));
      siteData.folders.forEach(function (folder, folderIndex) {
        var isLastFolder = folderIndex === siteData.folders.length - 1;
        printLine([
          createSpan(isLastFolder ? '└── ' : '├── ', 'term-dim'),
          createLink(folder.slug + '/', folder.url, 'term-dir')
        ]);
        var posts = getPostsInFolder(siteData, folder);
        posts.forEach(function (post, postIndex) {
          var isLastPost = postIndex === posts.length - 1;
          printLine([
            createSpan((isLastFolder ? '    ' : '│   ') + (isLastPost ? '└── ' : '├── '), 'term-dim'),
            createLink(post.slug + '.md', post.url)
          ]);
        });
      });
      printLine(createSpan(siteData.folders.length + ' directories, ' + siteData.posts.length + ' files', 'term-dim'));
    }

    function commandFind(args) {
      var keyword = args.join(' ').toLowerCase();
      if (!keyword) {
        printError('find: usage: find <word>');
        return;
      }
      var matches = siteData.posts.filter(function (post) {
        var haystack = [post.title, post.slug].concat(post.tags, post.categories).join(' ').toLowerCase();
        return haystack.indexOf(keyword) !== -1;
      });
      if (matches.length === 0) {
        printLine(createSpan('no match for "' + keyword + '"', 'term-dim'));
        return;
      }
      matches.forEach(function (post) {
        var folder = findFolder(siteData, post.categories[0] || '');
        var path = './' + (folder ? folder.slug + '/' : '') + post.slug + '.md';
        printLine([createLink(path, post.url), createSpan('  # ' + post.title, 'term-dim')]);
      });
    }

    function collectTagCounts() {
      var counts = {};
      siteData.posts.forEach(function (post) {
        post.tags.forEach(function (tag) {
          counts[tag] = (counts[tag] || 0) + 1;
        });
      });
      return counts;
    }

    function commandTags(args) {
      var counts = collectTagCounts();
      var tagNames = Object.keys(counts).sort();
      if (args[0]) {
        var wanted = args[0].replace(/^#/, '').toLowerCase();
        var tagged = siteData.posts.filter(function (post) {
          return post.tags.some(function (tag) { return tag.toLowerCase() === wanted; });
        });
        if (tagged.length === 0) {
          printError('tags: ' + args[0] + ': no such tag');
          return;
        }
        tagged.forEach(function (post) {
          printLine([createLink(post.slug + '.md', post.url), createSpan('  # ' + post.title, 'term-dim')]);
        });
        return;
      }
      if (tagNames.length === 0) {
        printLine(createSpan('(no tags)', 'term-dim'));
        return;
      }
      var line = printLine([]);
      tagNames.forEach(function (tag) {
        line.appendChild(createLink('#' + tag, siteData.tagsPage + '#tag-' + slugify(tag), 'term-key'));
        line.appendChild(createSpan('(' + counts[tag] + ')  ', 'term-dim'));
      });
    }

    function commandWhoami() {
      printLine(createSpan(siteData.user, 'term-ok'));
      if (siteData.subtitle) {
        printLine(createSpan(siteData.subtitle, 'term-dim'));
      }
    }

    function commandNeofetch() {
      var info = [
        ['OS', siteData.user + ' os 1.0 — security research archive'],
        ['Focus', siteData.subtitle],
        ['Posts', String(siteData.posts.length)],
        ['Dirs', String(siteData.folders.length)],
        ['Tags', String(Object.keys(collectTagCounts()).length)],
        ['Shell', 'liquid / jekyll'],
        ['Uptime', 'since ' + (siteData.posts.length ? siteData.posts[siteData.posts.length - 1].date : '-')]
      ];
      printLine([createSpan(siteData.user, 'term-ok'), '@', createSpan(HOST_NAME, 'term-ok')]);
      printLine(createSpan('-----------------', 'term-dim'));
      info.forEach(function (entry) {
        printLine([createSpan(entry[0], 'term-key'), ': ' + entry[1]]);
      });
    }

    function commandHistory() {
      history.forEach(function (entry, index) {
        printLine([createSpan(String(index + 1).padStart(4, ' ') + '  ', 'term-dim'), entry]);
      });
    }

    function commandSudo() {
      printError(siteData.user + ' is not in the sudoers file. This incident will be reported.');
    }

    var commandTable = {
      help: commandHelp,
      ls: commandLs,
      ll: commandLs,
      dir: commandLs,
      cd: commandCd,
      cat: function (args) { commandCat(args, 'cat'); },
      open: function (args) { commandCat(args, 'open'); },
      vim: function (args) { commandCat(args, 'vim'); },
      code: function (args) { commandCat(args, 'code'); },
      tree: commandTree,
      find: commandFind,
      grep: commandFind,
      tags: commandTags,
      whoami: commandWhoami,
      neofetch: commandNeofetch,
      pwd: function () { printLine(currentPath.replace('~', '/home/' + siteData.user)); },
      echo: function (args) { printLine(args.join(' ')); },
      date: function () { printLine(new Date().toString()); },
      history: commandHistory,
      clear: function () { outputNode.textContent = ''; },
      exit: function () { setPanelHidden(ideNode, true); },
      sudo: commandSudo
    };

    function run(rawCommand) {
      var trimmed = rawCommand.trim();
      printEcho(rawCommand);
      if (!trimmed) {
        scrollToBottom();
        return;
      }
      history.push(trimmed);
      historyIndex = history.length;

      var words = trimmed.split(/\s+/);
      var name = words[0].toLowerCase();
      var args = words.slice(1).map(function (arg) { return arg.replace(/^["']|["']$/g, ''); });
      var handler = commandTable[name];

      if (!handler) {
        printError(name + ': command not found. try \'help\'');
        scrollToBottom();
        return;
      }
      var result;
      try {
        result = handler(args);
      } catch (error) {
        console.error('[vsblog] command failed', error);
        printError(name + ': internal error');
      }
      scrollToBottom();
      if (result && typeof result.then === 'function') {
        result
          .catch(function (error) {
            console.error('[vsblog] async command failed', error);
            printError(name + ': ' + (error && error.message ? error.message : 'internal error'));
          })
          .then(scrollToBottom);
      }
    }

    function registerCommand(name, handler, usage, description) {
      commandTable[name] = handler;
      if (usage) {
        COMMAND_LIST.push([usage, description || '']);
      }
    }

    /* ----- input handling ----- */

    function getCompletionCandidates(isFirstWord) {
      if (isFirstWord) {
        return Object.keys(commandTable);
      }
      var folderNames = siteData.folders.map(function (folder) { return folder.slug + '/'; });
      var postNames = siteData.posts.map(function (post) { return post.slug + '.md'; });
      return folderNames.concat(postNames, ['about.txt', 'tags.json']);
    }

    function completeInput() {
      var value = inputNode.value;
      var words = value.split(' ');
      var lastWord = words[words.length - 1];
      var candidates = getCompletionCandidates(words.length === 1).filter(function (candidate) {
        return candidate.indexOf(lastWord) === 0;
      });
      if (candidates.length === 1) {
        words[words.length - 1] = candidates[0] + (words.length === 1 ? ' ' : '');
        inputNode.value = words.join(' ');
      } else if (candidates.length > 1) {
        printEcho(value);
        printLine(createSpan(candidates.join('  '), 'term-dim'));
        scrollToBottom();
      }
    }

    function moveHistory(step) {
      if (history.length === 0) {
        return;
      }
      historyIndex = Math.min(Math.max(historyIndex + step, 0), history.length);
      inputNode.value = historyIndex === history.length ? '' : history[historyIndex];
    }

    formNode.addEventListener('submit', function (event) {
      event.preventDefault();
      var value = inputNode.value;
      inputNode.value = '';
      run(value);
    });

    inputNode.addEventListener('keydown', function (event) {
      if (event.key === 'Tab') {
        event.preventDefault();
        completeInput();
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        moveHistory(-1);
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        moveHistory(1);
      } else if (event.key === 'l' && event.ctrlKey) {
        event.preventDefault();
        outputNode.textContent = '';
      }
    });

    if (terminalNode) {
      terminalNode.addEventListener('click', function (event) {
        var chip = event.target.closest('[data-command]');
        if (chip) {
          run(chip.getAttribute('data-command'));
          inputNode.focus();
          return;
        }
        if (!event.target.closest('a') && !window.getSelection().toString()) {
          inputNode.focus();
        }
      });
    }

    printLine(createSpan(siteData.user + ' os 1.0 — security research archive', 'term-ok'));
    printLine(createSpan('\'help\' 를 입력하면 사용 가능한 명령을 볼 수 있어요. Tab 자동완성, ↑↓ 기록 지원.', 'term-dim'));

    return {
      inputNode: inputNode,
      run: run,
      registerCommand: registerCommand,
      printLine: printLine,
      printError: printError,
      createSpan: createSpan,
      createLink: createLink,
      scrollToBottom: scrollToBottom,
      showPanel: function () { setPanelHidden(ideNode, false); },
      prefill: function (text) {
        inputNode.value = text;
        inputNode.focus();
      }
    };
  }

  /* other scripts (vscode-scm.js) attach through this object */
  function exposeApi(siteData, terminal) {
    window.vsblog = {
      siteData: siteData,
      terminal: terminal,
      findPost: function (name) { return findPost(siteData, name); },
      findFolder: function (name) { return findFolder(siteData, name); }
    };
    document.dispatchEvent(new CustomEvent('vsblog:ready', { detail: window.vsblog }));
  }

  /* ---------- boot ---------- */

  function init() {
    var ideNode = document.getElementById('ide');
    if (!ideNode) {
      return;
    }
    var siteData = loadSiteData();
    restoreLayoutState(ideNode);

    var markdownNode = document.getElementById('md');
    if (markdownNode) {
      addHeadingPrefixes(markdownNode);
      buildOutline(markdownNode);
      enhanceCodeBlocks(markdownNode);
    }

    var editorNode = document.getElementById('editor');
    if (editorNode) {
      trackLineNumber(editorNode, document.getElementById('status-line'));
    }

    var terminal = createTerminal(siteData, ideNode);
    bindLayoutActions(ideNode, terminal);
    initPanelResize(ideNode);
    exposeApi(siteData, terminal);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
