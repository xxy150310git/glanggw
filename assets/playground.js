/* G-Lang 演练场：编辑器、高亮、运行 */
(function () {
  "use strict";

  var KW = ["设", "为", "局部", "全局", "非局部", "常量", "输出", "写出", "输入", "如果", "否则如果", "否则", "结束",
    "重复", "从", "到", "步长", "当", "遍历", "在", "中", "跳出", "继续", "函数", "接受", "返回", "空", "默认", "自身",
    "并且", "或者", "不", "真", "假", "尝试", "捕获", "抛出",
    "等于", "不等于", "大于", "小于", "大于等于", "小于等于"];

  var BUILTINS = ["绝对值", "向下取整", "向上取整", "四舍五入", "开方", "幂", "最大值", "最小值", "随机数",
    "长度", "截取", "查找", "替换", "分割", "合并", "去空白", "大写", "小写",
    "转整数", "转小数", "转文本", "转布尔",
    "追加", "插入", "删除", "排序", "反转", "求和", "包含", "清空", "换行", "连接", "当前时间", "延时", "停止",
    "类型", "是整数", "是小数", "是文本", "是布尔", "是列表", "是字典", "是函数", "是空",
    "取", "切片", "键列表", "值列表", "合并字典", "去重", "展平",
    "映射", "过滤", "归约", "任一", "全部", "计数满足", "查找首个", "按函数排序",
    "错误信息", "错误代码", "错误提示", "错误行号", "错误调用栈", "断言"];

  var ta = document.getElementById("code");
  var hl = document.getElementById("hl");
  var gutter = document.getElementById("gutter");
  var consoleEl = document.getElementById("console");
  var stdinEl = document.getElementById("stdin");
  var sel = document.getElementById("examples");
  var status = document.getElementById("status");
  var stText = document.getElementById("st-text");
  var stPos = document.getElementById("st-pos");
  var stLines = document.getElementById("st-lines");
  var stFile = document.getElementById("st-file");

  var examples = window.GLANG_EXAMPLES || [];
  var current = examples[0];
  var dirty = false;

  function esc(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function highlight(src) {
    var re = /(#[^\n]*|(?:^|\n)\s*注[^\n]*)|("(?:[^"\\\n]|\\.)*")|(\d+(?:\.\d+)?)|([A-Za-z_\u4e00-\u9fa5][A-Za-z0-9_\u4e00-\u9fa5]*)/g;
    var out = "", last = 0, m;
    while ((m = re.exec(src)) !== null) {
      out += esc(src.slice(last, m.index));
      var text = m[0];
      if (m[1]) out += '<span class="tok-c">' + esc(text) + "</span>";
      else if (m[2]) out += '<span class="tok-s">' + esc(text) + "</span>";
      else if (m[3]) out += '<span class="tok-n">' + esc(text) + "</span>";
      else {
        if (KW.indexOf(text) !== -1) out += '<span class="tok-k">' + esc(text) + "</span>";
        else if (BUILTINS.indexOf(text) !== -1) out += '<span class="tok-f">' + esc(text) + "</span>";
        else out += esc(text);
      }
      last = m.index + text.length;
    }
    out += esc(src.slice(last));
    return out + "\n";
  }

  function paint() {
    hl.innerHTML = highlight(ta.value);
    var n = ta.value.split("\n").length;
    var nums = "";
    for (var i = 1; i <= n; i++) nums += i + (i < n ? "\n" : "");
    gutter.textContent = nums;
    stLines.textContent = "共 " + n + " 行";
    syncScroll();
  }

  function syncScroll() {
    hl.scrollTop = ta.scrollTop;
    hl.scrollLeft = ta.scrollLeft;
    gutter.scrollTop = ta.scrollTop;
  }

  function updateCursor() {
    var before = ta.value.slice(0, ta.selectionStart);
    var lines = before.split("\n");
    stPos.textContent = "行 " + lines.length + ", 列 " + (lines[lines.length - 1].length + 1);
  }

  function setStatus(kind, text) {
    status.className = "pg-status " + kind;
    stText.textContent = text;
  }

  function clearConsole() { consoleEl.innerHTML = ""; }

  function writeOut(text, cls) {
    var span = document.createElement("span");
    if (cls) span.className = cls;
    span.textContent = text;
    consoleEl.appendChild(span);
  }

  function renderErrorBlock(errorText) {
    var lines = errorText.split("\n");
    lines.forEach(function (line, i) {
      var cls = "";
      if (line.indexOf("提示：") === 0) cls = "e-hint";
      else if (/^\s*\d+\s*\|/.test(line)) cls = "e-src";
      else if (/^\s*\|/.test(line) || /\^/.test(line)) cls = "e-caret";
      else if (line.indexOf("第 ") === 0) cls = "e-line";
      writeOut((i ? "\n" : "") + line, cls);
    });
  }

  function run() {
    var src = ta.value;
    setStatus("running", "运行中");
    clearConsole();
    var t0 = performance.now();
    var result;
    try {
      result = window.GLang.run(src, { stdin: stdinEl.value });
    } catch (e) {
      setStatus("error", "出错");
      writeOut("解释器内部错误：" + (e && e.message ? e.message : String(e)), "err");
      return;
    }
    var ms = Math.max(1, Math.round(performance.now() - t0));

    if (result.output) writeOut(result.output, "");

    if (result.ok) {
      writeOut((result.output ? "\n" : "") + "\n[完成] 用时 " + ms + " ms", "sys");
      setStatus("ready", "完成");
    } else {
      if (result.output) writeOut("\n", "");
      if (result.errorText) renderErrorBlock(result.errorText);
      writeOut("\n[退出码 " + (result.error.code && result.error.code.indexOf("E2") === 0 ? 1 : 2) + "] " + ms + " ms", "sys");
      setStatus("error", "出错 " + (result.error.code || ""));
    }
    consoleEl.scrollTop = consoleEl.scrollHeight;
  }

  function loadExample(i) {
    var ex = examples[i];
    if (!ex) return;
    if (dirty && !confirm("当前代码还没保存，切换示例会丢掉修改。继续吗？")) {
      sel.value = String(i);
      return;
    }
    current = ex;
    ta.value = ex.source;
    stdinEl.value = ex.stdin || "";
    dirty = false;
    stFile.textContent = ex.name + ".gl";
    clearConsole();
    setStatus("ready", "就绪");
    paint();
    updateCursor();
  }

  /* ---- 事件 ---- */

  ta.addEventListener("input", function () { dirty = true; paint(); updateCursor(); });
  ta.addEventListener("scroll", syncScroll);
  ta.addEventListener("keydown", function (e) {
    if (e.key === "Tab") {
      e.preventDefault();
      var s = ta.selectionStart, en = ta.selectionEnd;
      if (s === en) {
        ta.value = ta.value.slice(0, s) + "    " + ta.value.slice(s);
        ta.selectionStart = ta.selectionEnd = s + 4;
      } else {
        var head = ta.value.slice(0, s), body = ta.value.slice(s, en), tail = ta.value.slice(en);
        ta.value = head + body.replace(/^/gm, "    ") + tail;
        ta.selectionStart = s;
        ta.selectionEnd = en + (body.split("\n").length * 4);
      }
      paint();
      updateCursor();
      return;
    }
    if (e.key === "F11" || (e.key === "Enter" && (e.ctrlKey || e.metaKey))) {
      e.preventDefault();
      run();
    }
  });
  ta.addEventListener("click", updateCursor);
  ta.addEventListener("keyup", updateCursor);

  sel.addEventListener("change", function () { loadExample(parseInt(sel.value, 10)); });
  document.getElementById("run").addEventListener("click", run);
  document.getElementById("reset").addEventListener("click", function () {
    if (!current) return;
    ta.value = current.source;
    dirty = false;
    paint();
    clearConsole();
    setStatus("ready", "就绪");
  });
  document.getElementById("clear").addEventListener("click", function () {
    ta.value = "";
    dirty = true;
    paint();
    updateCursor();
  });

  window.addEventListener("keydown", function (e) {
    if (e.key === "F11") {
      e.preventDefault();
      run();
    }
  });

  /* ---- 初始化 ---- */
  examples.forEach(function (ex, i) {
    var o = document.createElement("option");
    o.value = String(i);
    o.textContent = ex.name;
    sel.appendChild(o);
  });

  var fromHash = parseInt((location.hash || "").replace("#", ""), 10);
  loadExample(isNaN(fromHash) || !examples[fromHash] ? 0 : fromHash);
})();
