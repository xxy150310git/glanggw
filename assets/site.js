(function () {
  "use strict";

  /* ---------- 提取码复制 ---------- */
  document.querySelectorAll("[data-copy]").forEach(function (el) {
    el.addEventListener("click", function () {
      var text = el.getAttribute("data-copy");
      var done = function () {
        var old = el.innerHTML;
        el.innerHTML = "已复制 " + text + " ✓";
        setTimeout(function () { el.innerHTML = old; }, 1400);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, fallback);
      } else {
        fallback();
      }
      function fallback() {
        var ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand("copy"); done(); } catch (e) { /* 忽略 */ }
        document.body.removeChild(ta);
      }
    });
  });

  /* ---------- 错误码筛选 ---------- */
  var table = document.getElementById("errTable");
  if (table) {
    var rows = Array.prototype.slice.call(table.querySelectorAll("tbody tr"));
    var chips = Array.prototype.slice.call(document.querySelectorAll(".filters .chip"));
    var search = document.getElementById("errSearch");
    var empty = document.getElementById("errEmpty");
    var group = "all";

    var apply = function () {
      var q = (search && search.value || "").trim().toLowerCase();
      var shown = 0;
      rows.forEach(function (tr) {
        var okGroup = group === "all" || tr.getAttribute("data-g") === group;
        var okText = !q || tr.textContent.toLowerCase().indexOf(q) !== -1;
        var visible = okGroup && okText;
        tr.style.display = visible ? "" : "none";
        if (visible) shown++;
      });
      if (empty) empty.hidden = shown !== 0;
      table.style.display = shown === 0 ? "none" : "";
    };

    chips.forEach(function (c) {
      c.addEventListener("click", function () {
        chips.forEach(function (x) { x.classList.remove("on"); });
        c.classList.add("on");
        group = c.getAttribute("data-g");
        apply();
      });
    });
    if (search) search.addEventListener("input", apply);
  }

  /* ---------- 目录高亮 ---------- */
  var tocLinks = Array.prototype.slice.call(document.querySelectorAll(".toc a[href^='#']"));
  if (tocLinks.length) {
    var targets = tocLinks.map(function (a) {
      return document.getElementById(a.getAttribute("href").slice(1));
    });
    var onScroll = function () {
      var y = window.scrollY + 120;
      var idx = -1;
      targets.forEach(function (t, i) {
        if (t && t.offsetTop <= y) idx = i;
      });
      tocLinks.forEach(function (a, i) { a.classList.toggle("active", i === idx); });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  }

  /* ---------- 代码块复制按钮 ---------- */
  document.querySelectorAll("pre.code").forEach(function (pre) {
    if (pre.closest(".codecard")) return;
    var box = document.createElement("div");
    box.className = "prebox";
    pre.parentNode.insertBefore(box, pre);
    box.appendChild(pre);

    var btn = document.createElement("button");
    btn.className = "copy-btn";
    btn.type = "button";
    btn.textContent = "复制";
    btn.addEventListener("click", function () {
      var text = pre.textContent;
      var done = function () {
        btn.textContent = "已复制";
        setTimeout(function () { btn.textContent = "复制"; }, 1400);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, function () {});
      } else {
        var ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand("copy"); done(); } catch (e) {}
        document.body.removeChild(ta);
      }
    });
    box.appendChild(btn);
  });
})();
