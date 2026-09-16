/* 프리패스모빌리티 — 라이트 네트워크 패널 + 인터랙션 (신규, teamjpk 무관) */
(function () {
  "use strict";
  var $ = function (s) { return document.querySelector(s); };

  /* 생태계 마키 */
  var ECO = [
    { name: "팀JPK", tag: "렌터카 관리 ERP" },
    { name: "카벨 (carbell)", tag: "전국 정비 네트워크" },
    { name: "렌터카 착한거래", tag: "거래안전" }
  ];
  (function () {
    var el = $("#eco-mq"); if (!el) return;
    var loop = ECO.concat(ECO, ECO, ECO);
    el.innerHTML = loop.map(function (m) {
      return '<div class="mcard"><span class="mn">' + m.name + '</span><span class="mt"><span>' + m.tag + '</span></span></div>';
    }).join("");
  })();

  /* 라이트 네트워크 패널: 공급사(좌) ─ freepass 허브 ─ 영업파트너(우), 블루 빛 흐름 */
  var cv = $("#net");
  if (cv) {
    var cx = cv.getContext("2d"), W = 0, H = 0, dpr = Math.min(window.devicePixelRatio || 1, 2);
    var L = [], R = [], hub = [0, 0], motes = [];
    function rand(a, b) { return a + Math.random() * (b - a); }
    function size() {
      var p = cv.parentElement; W = p.clientWidth; H = p.clientHeight;
      cv.width = W * dpr; cv.height = H * dpr; cx.setTransform(dpr, 0, 0, dpr, 0, 0);
      hub = [W * 0.4, H * 0.5];                                  // 허브 왼쪽으로 (비대칭)
      L = [[W * 0.1, H * 0.4], [W * 0.12, H * 0.64]];            // 공급사 — 적게(2)
      R = [[W * 0.74, H * 0.16], [W * 0.9, H * 0.34], [W * 0.93, H * 0.56], [W * 0.82, H * 0.76], [W * 0.62, H * 0.88]]; // 영업파트너 — 많게(5), 부채꼴
      motes = [];
    }
    function node(n, big) {
      var R0 = big ? 30 : 13;
      var g = cx.createRadialGradient(n[0], n[1], 0, n[0], n[1], R0);
      g.addColorStop(0, big ? "rgba(23,99,214,.32)" : "rgba(59,141,240,.28)");
      g.addColorStop(1, "rgba(59,141,240,0)");
      cx.fillStyle = g; cx.beginPath(); cx.arc(n[0], n[1], R0, 0, 6.283); cx.fill();
      cx.fillStyle = big ? "#1763d6" : "#3b8df0"; cx.beginPath(); cx.arc(n[0], n[1], big ? 6 : 3.4, 0, 6.283); cx.fill();
      if (big) { cx.fillStyle = "#fff"; cx.beginPath(); cx.arc(n[0], n[1], 2.4, 0, 6.283); cx.fill(); }
    }
    function frame() {
      cx.clearRect(0, 0, W, H);
      // 배경 부유 점
      for (var i = 0; i < motes.length; i++) {
        var m = motes[i]; m.x += m.vx; m.y += m.vy;
        if (m.x < 0) m.x = W; if (m.x > W) m.x = 0; if (m.y < 0) m.y = H; if (m.y > H) m.y = 0;
        cx.beginPath(); cx.arc(m.x, m.y, m.r, 0, 6.283); cx.fillStyle = "rgba(23,99,214," + m.a + ")"; cx.fill();
      }
      var now = performance.now(), links = [], k, A, B;
      for (i = 0; i < L.length; i++) links.push([L[i], hub]);
      for (i = 0; i < R.length; i++) links.push([hub, R[i]]);
      cx.strokeStyle = "rgba(23,99,214,.16)"; cx.lineWidth = 1.3;
      for (i = 0; i < links.length; i++) { cx.beginPath(); cx.moveTo(links[i][0][0], links[i][0][1]); cx.lineTo(links[i][1][0], links[i][1][1]); cx.stroke(); }
      for (i = 0; i < links.length; i++) {
        A = links[i][0]; B = links[i][1];
        for (k = 0; k < 2; k++) {
          var t = ((now / 5600) + i * 0.11 + k * 0.5) % 1;
          var px = A[0] + (B[0] - A[0]) * t, py = A[1] + (B[1] - A[1]) * t;
          cx.beginPath(); cx.arc(px, py, 2.6, 0, 6.283);
          cx.fillStyle = "rgba(25,182,232," + (0.4 + 0.55 * Math.sin(t * Math.PI)) + ")"; cx.fill();
        }
      }
      for (i = 0; i < L.length; i++) node(L[i]);
      for (i = 0; i < R.length; i++) node(R[i]);
      var pa = 0.62 + 0.38 * Math.sin(now / 1600);
      cx.save(); cx.globalAlpha = pa; node(hub, true); cx.restore();
      requestAnimationFrame(frame);
    }
    size(); frame();
    var rz; window.addEventListener("resize", function () { clearTimeout(rz); rz = setTimeout(size, 200); });
  }

  /* 스크롤 리빌 */
  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }); }, { threshold: 0.12 });
    document.querySelectorAll(".reveal").forEach(function (el) { io.observe(el); });
  } else { document.querySelectorAll(".reveal").forEach(function (el) { el.classList.add("in"); }); }

  /* 카운트업 */
  function countUp(el) {
    var target = +el.dataset.count, dur = 1400, t0 = null;
    function tick(t) { if (!t0) t0 = t; var p = Math.min((t - t0) / dur, 1), e = 1 - Math.pow(1 - p, 3); el.textContent = Math.round(target * e).toLocaleString(); if (p < 1) requestAnimationFrame(tick); }
    requestAnimationFrame(tick);
  }
  if ("IntersectionObserver" in window) {
    var nio = new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) { countUp(e.target); nio.unobserve(e.target); } }); }, { threshold: 0.6 });
    document.querySelectorAll("[data-count]").forEach(function (el) { nio.observe(el); });
  }

  /* 네비 + 드로어 */
  var nav = $("#nav");
  function onScroll() { nav.classList.toggle("scr", window.scrollY > 30); }
  window.addEventListener("scroll", onScroll, { passive: true }); onScroll();
  $("#burger").addEventListener("click", function () { nav.classList.toggle("open"); });
  $("#drawer").addEventListener("click", function (e) { if (e.target.tagName === "A") nav.classList.remove("open"); });
})();
