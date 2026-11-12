/*
 * 경로 안내 파노라마 (MapService 파노라마 기능 이식)
 *
 * - 안내 시작 시 지도 아래에 작은 패널을 띄우고, 현재 지점 사진을 다음 지점 방향으로 잘라 보여준다.
 * - 패널을 탭하면 360° 전체화면 뷰어가 열리고, 진행 방향을 바라본 상태로 시작한다.
 * - 다음 지점으로 넘어가는 방식: GPS 자동 + 이전/다음 버튼 수동
 * - 사진이 없는 지점은 "사진 없음"으로 표시한다.
 *
 * script.js 에서는 PanoGuide.start / update / stop 만 호출한다.
 */
(function () {
  "use strict";

  var ADVANCE_DISTANCE_M = 15; // 다음 지점에 이만큼 가까워지면 자동으로 넘김 (상한)
  var MIN_ADVANCE_M = 5; // 노드 간격이 아주 짧을 때의 하한
  var MANUAL_HOLD_MS = 15000; // 수동 조작 후 자동 전환을 잠시 멈추는 시간
  var CUT_FOV_DEG = 90; // 패널 썸네일의 수평 시야각
  var MAX_TEXTURE_WIDTH = 4096; // 모바일 WebView 메모리 보호용 상한
  var IMAGE_CACHE_LIMIT = 4;

  var els = {};
  var state = {
    active: false,
    path: [],
    pathKey: "",
    step: 0,
    manualUntil: 0,
    renderToken: 0,
    overlayOpen: false,
  };
  var imageCache = new Map(); // url -> Promise<HTMLImageElement>

  var viewer = {
    renderer: null,
    scene: null,
    camera: null,
    mesh: null,
    animId: null,
    lon: 0,
    lat: 0,
    dragging: false,
    startX: 0,
    startY: 0,
    startLon: 0,
    startLat: 0,
    pointers: new Map(),
    pinchStart: 0,
    pinchFov: 75,
  };

  /* ---------- 유틸 ---------- */

  function toRad(deg) {
    return (deg * Math.PI) / 180;
  }

  function distanceMeters(lat1, lng1, lat2, lng2) {
    var dLat = toRad(lat2 - lat1);
    var dLng = toRad(lng2 - lng1);
    var a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  // 북=0, 동=90, 남=180, 서=270
  function bearingDegrees(lat1, lng1, lat2, lng2) {
    var dLng = toRad(lng2 - lng1);
    var y = Math.sin(dLng) * Math.cos(toRad(lat2));
    var x =
      Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
      Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLng);
    return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  }

  var ARROWS = ["↑", "↗", "→", "↘", "↓", "↙", "←", "↖"];
  var LABELS = ["북", "북동", "동", "남동", "남", "남서", "서", "북서"];

  function arrowFor(bearing) {
    return ARROWS[Math.round(bearing / 45) % 8];
  }

  function labelFor(bearing) {
    return LABELS[Math.round(bearing / 45) % 8];
  }

  function normalizeNode(node) {
    var lat = Number(node && (node.lat != null ? node.lat : node.latitude));
    var lng = Number(node && (node.lng != null ? node.lng : node.longitude));
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return {
      id: String(node.id != null ? node.id : lat + "," + lng),
      name: node.name || "경로 지점",
      lat: lat,
      lng: lng,
      panorama_url: node.panorama_url || node.panoramaUrl || null,
    };
  }

  function buildPath(route) {
    return ((route && route.path) || []).map(normalizeNode).filter(Boolean);
  }

  function pathKeyOf(path) {
    return path.map(function (node) { return node.id; }).join("|");
  }

  /* ---------- 이미지 로딩 ---------- */

  function loadPanorama(url) {
    if (imageCache.has(url)) return imageCache.get(url);

    var promise = new Promise(function (resolve, reject) {
      var img = new Image();
      img.decoding = "async";
      img.onload = function () { resolve(img); };
      img.onerror = function () {
        imageCache.delete(url);
        reject(new Error("panorama load failed"));
      };
      img.src = url;
    });

    imageCache.set(url, promise);
    while (imageCache.size > IMAGE_CACHE_LIMIT) {
      imageCache.delete(imageCache.keys().next().value);
    }
    return promise;
  }

  // equirectangular 이미지에서 bearing 방향을 잘라 canvas 에 그린다.
  // 이미지 왼쪽 끝이 북쪽이라는 MapService 의 가정을 그대로 따른다.
  function drawDirectionCut(canvas, img, bearing) {
    var ctx = canvas.getContext("2d");
    var cw = canvas.width;
    var ch = canvas.height;
    var srcW = img.naturalWidth;
    var srcH = img.naturalHeight;
    var cutW = srcW * (CUT_FOV_DEG / 360);
    var cutH = cutW * (ch / cw);
    var sy = Math.max(0, Math.min(srcH - cutH, srcH * 0.45 - cutH / 2));
    var sx = (bearing / 360) * srcW - cutW / 2;
    sx = ((sx % srcW) + srcW) % srcW;

    ctx.clearRect(0, 0, cw, ch);
    if (sx + cutW <= srcW) {
      ctx.drawImage(img, sx, sy, cutW, cutH, 0, 0, cw, ch);
    } else {
      var leftW = srcW - sx;
      var leftDw = (cw * leftW) / cutW;
      ctx.drawImage(img, sx, sy, leftW, cutH, 0, 0, leftDw, ch);
      ctx.drawImage(img, 0, sy, cutW - leftW, cutH, leftDw, 0, cw - leftDw, ch);
    }
  }

  /* ---------- 패널 렌더링 ---------- */

  function currentPair() {
    var from = state.path[state.step];
    var to = state.path[state.step + 1];
    return from && to ? { from: from, to: to } : null;
  }

  function render() {
    var pair = currentPair();
    if (!pair) return;

    var token = ++state.renderToken;
    var bearing = bearingDegrees(pair.from.lat, pair.from.lng, pair.to.lat, pair.to.lng);
    var total = state.path.length - 1;

    els.stepLabel.textContent = state.step + 1 + " / " + total + " 지점";
    els.fromName.textContent = pair.from.name;
    els.toName.textContent = "→ " + pair.to.name;
    els.direction.textContent = arrowFor(bearing) + " " + Math.round(bearing) + "° " + labelFor(bearing) + "쪽";
    els.prevBtn.disabled = state.step <= 0;
    els.nextBtn.disabled = state.step >= total - 1;

    if (!pair.from.panorama_url) {
      showEmpty("사진 없음");
    } else {
      showLoading();
      loadPanorama(pair.from.panorama_url).then(
        function (img) {
          if (token !== state.renderToken) return;
          drawDirectionCut(els.cutCanvas, img, bearing);
          els.cutCanvas.hidden = false;
          els.empty.hidden = true;
          els.thumbBtn.disabled = false;
        },
        function () {
          if (token !== state.renderToken) return;
          showEmpty("사진을 불러올 수 없습니다");
        }
      );
    }

    if (state.overlayOpen) showViewer();
  }

  function showEmpty(message) {
    els.cutCanvas.hidden = true;
    els.empty.hidden = false;
    els.empty.textContent = message;
    els.thumbBtn.disabled = true;
  }

  function showLoading() {
    els.cutCanvas.hidden = true;
    els.empty.hidden = false;
    els.empty.textContent = "불러오는 중...";
    els.thumbBtn.disabled = true;
  }

  function setPath(route) {
    var path = buildPath(route);
    var key = pathKeyOf(path);
    if (key === state.pathKey) return false;
    state.path = path;
    state.pathKey = key;
    state.step = 0;
    return true;
  }

  function showPanel(visible) {
    els.panel.hidden = !visible;
    document.body.classList.toggle("pano-guide-on", visible);
  }

  function goToStep(nextStep, manual) {
    var maxStep = state.path.length - 2;
    var clamped = Math.max(0, Math.min(nextStep, maxStep));
    if (manual) state.manualUntil = Date.now() + MANUAL_HOLD_MS;
    if (clamped === state.step) return;
    state.step = clamped;
    render();
  }

  /* ---------- script.js 에서 호출하는 API ---------- */

  function start(route) {
    if (!els.panel) return;
    state.active = true;
    state.manualUntil = 0;
    state.pathKey = "";
    if (route) setPath(route);
    if (state.path.length >= 2) {
      showPanel(true);
      render();
    } else {
      showPanel(false);
    }
  }

  function update(location, route) {
    if (!state.active || !els.panel) return;

    var changed = false;
    if (route && setPath(route)) changed = true;
    if (state.path.length < 2) {
      showPanel(false);
      return;
    }
    if (els.panel.hidden) {
      showPanel(true);
      changed = true;
    }

    var lat = Number(location && location.latitude);
    var lng = Number(location && location.longitude);
    if (Number.isFinite(lat) && Number.isFinite(lng) && Date.now() >= state.manualUntil) {
      var maxStep = state.path.length - 2;
      var next = state.step;
      while (next < maxStep) {
        var prev = state.path[next];
        var target = state.path[next + 1];
        // 노드 간격이 짧으면(수 m) 기준 거리를 줄여 여러 지점을 한꺼번에 건너뛰지 않게 한다
        var leg = distanceMeters(prev.lat, prev.lng, target.lat, target.lng);
        var threshold = Math.min(ADVANCE_DISTANCE_M, Math.max(MIN_ADVANCE_M, leg * 0.5));
        if (distanceMeters(lat, lng, target.lat, target.lng) > threshold) break;
        next += 1;
      }
      if (next !== state.step) {
        state.step = next;
        changed = true;
      }
    }

    if (changed) render();
  }

  function stop() {
    state.active = false;
    state.path = [];
    state.pathKey = "";
    state.step = 0;
    state.renderToken += 1;
    closeViewer();
    if (els.panel) showPanel(false);
  }

  /* ---------- 360° 전체화면 뷰어 (Three.js) ---------- */

  function ensureViewer() {
    if (viewer.renderer) return true;
    if (!window.THREE) return false;

    var THREE = window.THREE;
    var canvas = els.viewerCanvas;
    viewer.renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
    viewer.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    viewer.scene = new THREE.Scene();
    viewer.camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000);
    viewer.camera.position.set(0, 0, 0.01);

    var geometry = new THREE.SphereGeometry(500, 60, 40);
    geometry.scale(-1, 1, 1);
    viewer.mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: 0x111111 }));
    viewer.scene.add(viewer.mesh);

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);
    canvas.addEventListener(
      "wheel",
      function (event) {
        event.preventDefault();
        setFov(viewer.camera.fov + event.deltaY * 0.05);
      },
      { passive: false }
    );
    window.addEventListener("resize", resizeViewer);
    return true;
  }

  function setFov(value) {
    viewer.camera.fov = Math.min(110, Math.max(30, value));
    viewer.camera.updateProjectionMatrix();
  }

  function resizeViewer() {
    if (!viewer.renderer || !state.overlayOpen) return;
    var w = els.viewerCanvas.clientWidth;
    var h = els.viewerCanvas.clientHeight;
    if (!w || !h) return;
    viewer.renderer.setSize(w, h, false);
    viewer.camera.aspect = w / h;
    viewer.camera.updateProjectionMatrix();
  }

  function onPointerDown(event) {
    els.viewerCanvas.setPointerCapture(event.pointerId);
    viewer.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (viewer.pointers.size === 1) {
      viewer.dragging = true;
      viewer.startX = event.clientX;
      viewer.startY = event.clientY;
      viewer.startLon = viewer.lon;
      viewer.startLat = viewer.lat;
    } else if (viewer.pointers.size === 2) {
      viewer.dragging = false;
      viewer.pinchStart = pinchDistance();
      viewer.pinchFov = viewer.camera.fov;
    }
  }

  function onPointerMove(event) {
    if (!viewer.pointers.has(event.pointerId)) return;
    viewer.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (viewer.pointers.size === 2 && viewer.pinchStart > 0) {
      setFov(viewer.pinchFov * (viewer.pinchStart / pinchDistance()));
      return;
    }
    if (!viewer.dragging) return;
    viewer.lon = viewer.startLon - (event.clientX - viewer.startX) * 0.2;
    viewer.lat = viewer.startLat + (event.clientY - viewer.startY) * 0.2;
  }

  function onPointerUp(event) {
    viewer.pointers.delete(event.pointerId);
    viewer.dragging = false;
    viewer.pinchStart = 0;
  }

  function pinchDistance() {
    var points = Array.from(viewer.pointers.values());
    if (points.length < 2) return 1;
    return Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y) || 1;
  }

  function renderLoop() {
    viewer.animId = requestAnimationFrame(renderLoop);
    var THREE = window.THREE;
    viewer.lat = Math.max(-85, Math.min(85, viewer.lat));
    var phi = THREE.MathUtils.degToRad(90 - viewer.lat);
    var theta = THREE.MathUtils.degToRad(viewer.lon);
    viewer.camera.lookAt(
      500 * Math.sin(phi) * Math.cos(theta),
      500 * Math.cos(phi),
      500 * Math.sin(phi) * Math.sin(theta)
    );
    viewer.renderer.render(viewer.scene, viewer.camera);
  }

  function setViewerNotice(message) {
    els.viewerNotice.hidden = !message;
    els.viewerNotice.textContent = message || "";
  }

  function disposeMaterial() {
    var material = viewer.mesh && viewer.mesh.material;
    if (!material) return;
    if (material.map) material.map.dispose();
    material.dispose();
  }

  function showViewer() {
    var pair = currentPair();
    if (!pair || !ensureViewer()) return;

    var THREE = window.THREE;
    var token = state.renderToken;
    var bearing = bearingDegrees(pair.from.lat, pair.from.lng, pair.to.lat, pair.to.lng);

    els.viewerTitle.textContent = pair.from.name + " → " + pair.to.name;
    els.viewerPrev.disabled = state.step <= 0;
    els.viewerNext.disabled = state.step >= state.path.length - 2;

    // 진행 방향을 바라본 상태로 시작 (MapService 와 같은 보정값)
    viewer.lon = bearing - 90;
    viewer.lat = 0;
    setFov(75);

    disposeMaterial();
    viewer.mesh.material = new THREE.MeshBasicMaterial({ color: 0x1a1a2e });

    if (!pair.from.panorama_url) {
      setViewerNotice("이 지점에는 사진이 없습니다");
      return;
    }

    setViewerNotice("불러오는 중...");
    loadPanorama(pair.from.panorama_url).then(
      function (img) {
        if (!state.overlayOpen || token !== state.renderToken) return;
        var source = img;
        if (img.naturalWidth > MAX_TEXTURE_WIDTH) {
          var scale = MAX_TEXTURE_WIDTH / img.naturalWidth;
          source = document.createElement("canvas");
          source.width = MAX_TEXTURE_WIDTH;
          source.height = Math.round(img.naturalHeight * scale);
          source.getContext("2d").drawImage(img, 0, 0, source.width, source.height);
        }
        var texture = new THREE.Texture(source);
        texture.minFilter = THREE.LinearFilter;
        texture.generateMipmaps = false;
        texture.needsUpdate = true;
        disposeMaterial();
        viewer.mesh.material = new THREE.MeshBasicMaterial({ map: texture });
        setViewerNotice("");
      },
      function () {
        if (!state.overlayOpen || token !== state.renderToken) return;
        setViewerNotice("사진을 불러올 수 없습니다");
      }
    );
  }

  function openViewer() {
    if (!currentPair()) return;
    if (!window.THREE) {
      window.alert("360° 뷰어를 불러오지 못했습니다. 네트워크 연결을 확인해주세요.");
      return;
    }
    state.overlayOpen = true;
    els.overlay.hidden = false;
    ensureViewer();
    resizeViewer();
    showViewer();
    if (!viewer.animId) renderLoop();
  }

  function closeViewer() {
    state.overlayOpen = false;
    if (els.overlay) els.overlay.hidden = true;
    if (viewer.animId) {
      cancelAnimationFrame(viewer.animId);
      viewer.animId = null;
    }
    disposeMaterial();
  }

  /* ---------- 초기화 ---------- */

  function init() {
    els.panel = document.getElementById("panoGuide");
    if (!els.panel) return;

    els.thumbBtn = document.getElementById("panoThumbBtn");
    els.cutCanvas = document.getElementById("panoCutCanvas");
    els.empty = document.getElementById("panoEmpty");
    els.stepLabel = document.getElementById("panoStepLabel");
    els.fromName = document.getElementById("panoFromName");
    els.toName = document.getElementById("panoToName");
    els.direction = document.getElementById("panoDirection");
    els.prevBtn = document.getElementById("panoPrevBtn");
    els.nextBtn = document.getElementById("panoNextBtn");

    els.overlay = document.getElementById("panoOverlay");
    els.viewerCanvas = document.getElementById("panoViewerCanvas");
    els.viewerTitle = document.getElementById("panoViewerTitle");
    els.viewerNotice = document.getElementById("panoViewerNotice");
    els.viewerPrev = document.getElementById("panoViewerPrev");
    els.viewerNext = document.getElementById("panoViewerNext");

    els.thumbBtn.addEventListener("click", openViewer);
    els.prevBtn.addEventListener("click", function () { goToStep(state.step - 1, true); });
    els.nextBtn.addEventListener("click", function () { goToStep(state.step + 1, true); });
    els.viewerPrev.addEventListener("click", function () { goToStep(state.step - 1, true); });
    els.viewerNext.addEventListener("click", function () { goToStep(state.step + 1, true); });
    document.getElementById("panoViewerClose").addEventListener("click", closeViewer);
  }

  window.PanoGuide = { start: start, update: update, stop: stop };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
