/* ==========================================================
   Graph view — posts as nodes, [[wikilinks]] as edges
   force-directed layout on a canvas, no external library
   ========================================================== */
(function () {
  'use strict';

  var FOLDER_COLORS = ['#4daafc', '#ffb86b', '#c49bff', '#9cdcfe', '#ce9178', '#ffd479', '#f48fb1', '#80cbc4'];
  var MISSING_COLOR = '#6e7681';
  var EDGE_COLOR = 'rgba(160, 170, 180, 0.28)';
  var EDGE_HIGHLIGHT = 'rgba(77, 170, 252, 0.9)';
  var LABEL_COLOR = '#c8c8c8';
  var LABEL_FONT = '11px "JetBrains Mono", "Nanum Gothic Coding", monospace';

  var LINK_DISTANCE = 120;
  var REPULSION = 9000;
  var SPRING = 0.06;
  var GRAVITY = 0.005;
  var DAMPING = 0.82;
  var ALPHA_DECAY = 0.985;
  var MIN_ALPHA = 0.004;
  var WARMUP_STEPS = 260;
  var MIN_SCALE = 0.2;
  var MAX_SCALE = 4;
  var CLICK_TOLERANCE = 4;

  /* ---------- graph data ---------- */

  function getFolderIndex(siteData, post) {
    var category = post.categories[0] || '';
    for (var i = 0; i < siteData.folders.length; i += 1) {
      if (siteData.folders[i].title === category) {
        return i;
      }
    }
    return -1;
  }

  function createPostNode(siteData, post) {
    var folderIndex = getFolderIndex(siteData, post);
    return {
      id: post.url,
      label: post.secret ? post.slug : post.title,
      url: post.url,
      missing: false,
      folderIndex: folderIndex,
      color: folderIndex >= 0 ? FOLDER_COLORS[folderIndex % FOLDER_COLORS.length] : MISSING_COLOR,
      degree: 0,
      x: 0, y: 0, vx: 0, vy: 0, fixed: false
    };
  }

  function createMissingNode(target, key) {
    return {
      id: 'missing:' + key,
      label: target,
      target: target,
      missing: true,
      folderIndex: -1,
      color: MISSING_COLOR,
      degree: 0,
      x: 0, y: 0, vx: 0, vy: 0, fixed: false
    };
  }

  function buildGraph(api) {
    var siteData = api.siteData;
    var nodeMap = {};
    var edges = [];
    var edgeKeys = {};

    siteData.posts.forEach(function (post) {
      nodeMap[post.url] = createPostNode(siteData, post);
    });

    siteData.posts.forEach(function (post) {
      post.links.forEach(function (target) {
        var resolved = api.resolveWikilink(target);
        var targetId;
        if (resolved) {
          targetId = resolved.url;
        } else {
          var key = api.normalizeLinkKey(target);
          if (!key) {
            return;
          }
          targetId = 'missing:' + key;
          if (!nodeMap[targetId]) {
            nodeMap[targetId] = createMissingNode(target.trim(), key);
          }
        }
        if (targetId === post.url) {
          return;
        }
        var edgeKey = [post.url, targetId].sort().join('\u0000');
        if (edgeKeys[edgeKey]) {
          return;
        }
        edgeKeys[edgeKey] = true;
        edges.push({ source: nodeMap[post.url], target: nodeMap[targetId] });
        nodeMap[post.url].degree += 1;
        nodeMap[targetId].degree += 1;
      });
    });

    var nodes = Object.keys(nodeMap).map(function (id) { return nodeMap[id]; });
    return { nodes: nodes, edges: edges };
  }

  function placeNodesOnCircle(nodes) {
    var radius = Math.max(120, nodes.length * 14);
    nodes.forEach(function (node, index) {
      var angle = (index / Math.max(nodes.length, 1)) * Math.PI * 2;
      node.x = Math.cos(angle) * radius + (Math.random() - 0.5) * 20;
      node.y = Math.sin(angle) * radius + (Math.random() - 0.5) * 20;
    });
  }

  function getNodeRadius(node) {
    return Math.min(14, 4 + Math.sqrt(node.degree) * 2.2);
  }

  /* ---------- simulation ---------- */

  function applyRepulsion(nodes, alpha) {
    for (var i = 0; i < nodes.length; i += 1) {
      for (var j = i + 1; j < nodes.length; j += 1) {
        var a = nodes[i];
        var b = nodes[j];
        var dx = b.x - a.x;
        var dy = b.y - a.y;
        var distanceSquared = Math.max(dx * dx + dy * dy, 36);
        var distance = Math.sqrt(distanceSquared);
        var force = (REPULSION * alpha) / distanceSquared;
        var fx = (dx / distance) * force;
        var fy = (dy / distance) * force;
        a.vx -= fx; a.vy -= fy;
        b.vx += fx; b.vy += fy;
      }
    }
  }

  function applySprings(edges, alpha) {
    edges.forEach(function (edge) {
      var dx = edge.target.x - edge.source.x;
      var dy = edge.target.y - edge.source.y;
      var distance = Math.max(Math.sqrt(dx * dx + dy * dy), 0.01);
      var stretch = ((distance - LINK_DISTANCE) / distance) * SPRING * alpha * 10;
      var fx = dx * stretch * 0.5;
      var fy = dy * stretch * 0.5;
      edge.source.vx += fx; edge.source.vy += fy;
      edge.target.vx -= fx; edge.target.vy -= fy;
    });
  }

  function applyGravityAndMove(nodes, alpha) {
    nodes.forEach(function (node) {
      if (node.fixed) {
        node.vx = 0;
        node.vy = 0;
        return;
      }
      node.vx -= node.x * GRAVITY * alpha * 10;
      node.vy -= node.y * GRAVITY * alpha * 10;
      node.vx *= DAMPING;
      node.vy *= DAMPING;
      node.x += node.vx;
      node.y += node.vy;
    });
  }

  function stepSimulation(graph, alpha) {
    applyRepulsion(graph.visibleNodes, alpha);
    applySprings(graph.visibleEdges, alpha);
    applyGravityAndMove(graph.visibleNodes, alpha);
  }

  /* ---------- view ---------- */

  function createView() {
    return { scale: 1, offsetX: 0, offsetY: 0, width: 0, height: 0, ratio: window.devicePixelRatio || 1 };
  }

  function screenToWorld(view, screenX, screenY) {
    return {
      x: (screenX - view.width / 2 - view.offsetX) / view.scale,
      y: (screenY - view.height / 2 - view.offsetY) / view.scale
    };
  }

  function fitView(view, nodes) {
    if (nodes.length === 0) {
      return;
    }
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    nodes.forEach(function (node) {
      minX = Math.min(minX, node.x); maxX = Math.max(maxX, node.x);
      minY = Math.min(minY, node.y); maxY = Math.max(maxY, node.y);
    });
    var padding = 80;
    var spanX = Math.max(maxX - minX, 1) + padding * 2;
    var spanY = Math.max(maxY - minY, 1) + padding * 2;
    view.scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.min(view.width / spanX, view.height / spanY, 1.6)));
    view.offsetX = -((minX + maxX) / 2) * view.scale;
    view.offsetY = -((minY + maxY) / 2) * view.scale;
  }

  function resizeCanvas(canvas, view) {
    var box = canvas.parentNode.getBoundingClientRect();
    view.width = box.width;
    view.height = box.height;
    view.ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(box.width * view.ratio);
    canvas.height = Math.round(box.height * view.ratio);
    canvas.style.width = box.width + 'px';
    canvas.style.height = box.height + 'px';
  }

  /* ---------- drawing ---------- */

  function getNeighborIds(graph, node) {
    var ids = {};
    if (!node) {
      return ids;
    }
    ids[node.id] = true;
    graph.visibleEdges.forEach(function (edge) {
      if (edge.source === node) { ids[edge.target.id] = true; }
      if (edge.target === node) { ids[edge.source.id] = true; }
    });
    return ids;
  }

  function drawEdges(context, graph, hoverNode) {
    graph.visibleEdges.forEach(function (edge) {
      var isActive = hoverNode && (edge.source === hoverNode || edge.target === hoverNode);
      context.strokeStyle = isActive ? EDGE_HIGHLIGHT : EDGE_COLOR;
      context.globalAlpha = hoverNode && !isActive ? 0.25 : 1;
      context.lineWidth = isActive ? 1.6 : 1;
      context.beginPath();
      context.moveTo(edge.source.x, edge.source.y);
      context.lineTo(edge.target.x, edge.target.y);
      context.stroke();
    });
    context.globalAlpha = 1;
  }

  function drawNodes(context, graph, hoverNode, neighborIds) {
    graph.visibleNodes.forEach(function (node) {
      var radius = getNodeRadius(node);
      context.globalAlpha = hoverNode && !neighborIds[node.id] ? 0.25 : 1;
      context.beginPath();
      context.arc(node.x, node.y, radius, 0, Math.PI * 2);
      if (node.missing) {
        context.fillStyle = '#121314';
        context.fill();
        context.setLineDash([2, 2]);
        context.strokeStyle = MISSING_COLOR;
        context.lineWidth = 1.4;
        context.stroke();
        context.setLineDash([]);
      } else {
        context.fillStyle = node.color;
        context.fill();
      }
      if (node === hoverNode) {
        context.strokeStyle = '#ffffff';
        context.lineWidth = 2;
        context.stroke();
      }
    });
    context.globalAlpha = 1;
  }

  function drawLabels(context, graph, view, hoverNode, neighborIds) {
    var showAll = view.scale >= 0.75;
    context.font = LABEL_FONT;
    context.textAlign = 'center';
    context.textBaseline = 'top';
    graph.visibleNodes.forEach(function (node) {
      var isNeighbor = hoverNode && neighborIds[node.id];
      if (!showAll && !isNeighbor) {
        return;
      }
      context.globalAlpha = hoverNode && !isNeighbor ? 0.2 : (node.missing ? 0.6 : 0.9);
      context.fillStyle = node === hoverNode ? '#ffffff' : LABEL_COLOR;
      var label = node.label.length > 28 ? node.label.slice(0, 27) + '…' : node.label;
      context.save();
      context.translate(node.x, node.y + getNodeRadius(node) + 4);
      context.scale(1 / view.scale, 1 / view.scale);
      context.fillText(label, 0, 0);
      context.restore();
    });
    context.globalAlpha = 1;
  }

  function draw(canvas, graph, view, hoverNode) {
    var context = canvas.getContext('2d');
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.setTransform(
      view.ratio * view.scale, 0, 0, view.ratio * view.scale,
      view.ratio * (view.width / 2 + view.offsetX),
      view.ratio * (view.height / 2 + view.offsetY)
    );
    var neighborIds = getNeighborIds(graph, hoverNode);
    drawEdges(context, graph, hoverNode);
    drawNodes(context, graph, hoverNode, neighborIds);
    drawLabels(context, graph, view, hoverNode, neighborIds);
  }

  /* ---------- filters + legend ---------- */

  function applyFilters(graph, options) {
    graph.visibleNodes = graph.nodes.filter(function (node) {
      if (node.missing && !options.showMissing) {
        return false;
      }
      var visibleDegree = options.showMissing ? node.degree : countRealLinks(graph, node);
      return options.showOrphans || visibleDegree > 0;
    });
    var visibleIds = {};
    graph.visibleNodes.forEach(function (node) { visibleIds[node.id] = true; });
    graph.visibleEdges = graph.edges.filter(function (edge) {
      return visibleIds[edge.source.id] && visibleIds[edge.target.id];
    });
  }

  function countRealLinks(graph, node) {
    return graph.edges.filter(function (edge) {
      return (edge.source === node && !edge.target.missing) || (edge.target === node && !edge.source.missing);
    }).length;
  }

  function renderLegend(listNode, siteData, graph) {
    if (!listNode) {
      return;
    }
    listNode.textContent = '';
    siteData.folders.forEach(function (folder, index) {
      var count = graph.nodes.filter(function (node) { return node.folderIndex === index; }).length;
      listNode.appendChild(createLegendItem(FOLDER_COLORS[index % FOLDER_COLORS.length], folder.title, count, false));
    });
    var missingCount = graph.nodes.filter(function (node) { return node.missing; }).length;
    listNode.appendChild(createLegendItem(MISSING_COLOR, '아직 없는 문서', missingCount, true));
  }

  function createLegendItem(color, label, count, isMissing) {
    var item = document.createElement('li');
    var dot = document.createElement('span');
    dot.className = 'graph-legend__dot' + (isMissing ? ' is-missing' : '');
    dot.style.setProperty('--dot', color);
    var text = document.createElement('span');
    text.textContent = label;
    var number = document.createElement('span');
    number.className = 'graph-legend__count';
    number.textContent = count;
    item.appendChild(dot);
    item.appendChild(text);
    item.appendChild(number);
    return item;
  }

  /* ---------- interaction ---------- */

  function findNodeAt(graph, view, screenX, screenY) {
    var point = screenToWorld(view, screenX, screenY);
    for (var i = graph.visibleNodes.length - 1; i >= 0; i -= 1) {
      var node = graph.visibleNodes[i];
      var hitRadius = getNodeRadius(node) + 4 / view.scale;
      var dx = node.x - point.x;
      var dy = node.y - point.y;
      if (dx * dx + dy * dy <= hitRadius * hitRadius) {
        return node;
      }
    }
    return null;
  }

  function openNode(node, api) {
    if (!node.missing) {
      window.location.href = node.url;
      return;
    }
    var scm = window.vsblogScm;
    if (scm && scm.isOwner()) {
      scm.createFromWikilink(node.target, null);
    } else if (api.showToast) {
      api.showToast('아직 작성되지 않은 문서예요: ' + node.target);
    }
  }

  function getPointerPosition(canvas, event) {
    var box = canvas.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  }

  /* ---------- boot ---------- */

  function start(api) {
    var canvas = document.getElementById('graph-canvas');
    if (!canvas || !canvas.getContext || !canvas.getContext('2d')) {
      var emptyNode = document.getElementById('graph-empty');
      if (emptyNode) {
        emptyNode.textContent = '이 브라우저에서는 그래프를 그릴 수 없어요.';
        emptyNode.hidden = false;
      }
      return;
    }

    var graph = buildGraph(api);
    var view = createView();
    var options = { showOrphans: true, showMissing: true };
    var state = { alpha: 1, hoverNode: null, dragNode: null, panning: false, pointerStart: null, lastPointer: null, moved: 0, frame: null };

    applyFilters(graph, options);
    placeNodesOnCircle(graph.nodes);
    for (var i = 0; i < WARMUP_STEPS; i += 1) {
      stepSimulation(graph, Math.pow(ALPHA_DECAY, i));
    }
    state.alpha = 0.05;

    resizeCanvas(canvas, view);
    fitView(view, graph.visibleNodes);
    renderLegend(document.getElementById('graph-legend'), api.siteData, graph);

    var hasLinks = graph.edges.length > 0;
    document.getElementById('graph-empty').hidden = hasLinks;

    function redraw() {
      draw(canvas, graph, view, state.hoverNode);
    }

    function tick() {
      state.frame = null;
      if (state.alpha > MIN_ALPHA || state.dragNode) {
        stepSimulation(graph, Math.max(state.alpha, state.dragNode ? 0.1 : 0));
        state.alpha *= ALPHA_DECAY;
        redraw();
        state.frame = window.requestAnimationFrame(tick);
      } else {
        redraw();
      }
    }

    function reheat(amount) {
      state.alpha = Math.max(state.alpha, amount);
      if (!state.frame) {
        state.frame = window.requestAnimationFrame(tick);
      }
    }

    canvas.addEventListener('pointerdown', function (event) {
      var position = getPointerPosition(canvas, event);
      state.pointerStart = position;
      state.lastPointer = position;
      state.moved = 0;
      state.dragNode = findNodeAt(graph, view, position.x, position.y);
      state.panning = !state.dragNode;
      if (state.dragNode) {
        state.dragNode.fixed = true;
      }
      canvas.setPointerCapture(event.pointerId);
      canvas.classList.add('is-grabbing');
    });

    canvas.addEventListener('pointermove', function (event) {
      var position = getPointerPosition(canvas, event);
      if (state.pointerStart) {
        state.moved += Math.abs(position.x - state.lastPointer.x) + Math.abs(position.y - state.lastPointer.y);
      }
      if (state.dragNode) {
        var point = screenToWorld(view, position.x, position.y);
        state.dragNode.x = point.x;
        state.dragNode.y = point.y;
        reheat(0.3);
      } else if (state.panning) {
        view.offsetX += position.x - state.lastPointer.x;
        view.offsetY += position.y - state.lastPointer.y;
        redraw();
      } else {
        var hovered = findNodeAt(graph, view, position.x, position.y);
        if (hovered !== state.hoverNode) {
          state.hoverNode = hovered;
          canvas.style.cursor = hovered ? 'pointer' : 'grab';
          redraw();
        }
      }
      state.lastPointer = position;
    });

    canvas.addEventListener('pointerup', function (event) {
      canvas.releasePointerCapture(event.pointerId);
      canvas.classList.remove('is-grabbing');
      var clickedNode = state.dragNode;
      if (clickedNode) {
        clickedNode.fixed = false;
      }
      var wasClick = state.moved <= CLICK_TOLERANCE;
      state.dragNode = null;
      state.panning = false;
      state.pointerStart = null;
      if (wasClick && clickedNode) {
        openNode(clickedNode, api);
      }
    });

    canvas.addEventListener('pointerleave', function () {
      if (!state.pointerStart && state.hoverNode) {
        state.hoverNode = null;
        redraw();
      }
    });

    canvas.addEventListener('wheel', function (event) {
      event.preventDefault();
      var position = getPointerPosition(canvas, event);
      var before = screenToWorld(view, position.x, position.y);
      var nextScale = view.scale * Math.exp(-event.deltaY * 0.0015);
      view.scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, nextScale));
      view.offsetX = position.x - view.width / 2 - before.x * view.scale;
      view.offsetY = position.y - view.height / 2 - before.y * view.scale;
      redraw();
    }, { passive: false });

    document.getElementById('graph-orphans').addEventListener('change', function (event) {
      options.showOrphans = event.target.checked;
      applyFilters(graph, options);
      reheat(0.5);
    });

    document.getElementById('graph-missing').addEventListener('change', function (event) {
      options.showMissing = event.target.checked;
      applyFilters(graph, options);
      reheat(0.5);
    });

    document.getElementById('graph-reset').addEventListener('click', function () {
      fitView(view, graph.visibleNodes);
      redraw();
    });

    if (window.ResizeObserver) {
      new ResizeObserver(function () {
        resizeCanvas(canvas, view);
        redraw();
      }).observe(canvas.parentNode);
    }

    reheat(0.05);
  }

  if (window.vsblog) {
    start(window.vsblog);
  } else {
    document.addEventListener('vsblog:ready', function (event) { start(event.detail); }, { once: true });
  }
})();
