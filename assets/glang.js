/* ==========================================================================
   G-Lang 网页演练场 · 迷你解释器
   覆盖 v0.3 语法的主要子集：37 个关键字中的绝大部分、九种值、常用内置函数、
   三行制报错。实现在浏览器里跑，不联网、不依赖任何第三方库。
   ========================================================================== */
(function (global) {
  "use strict";

  /* ---------------- 值 ---------------- */

  function GF(v) { this.v = v; }              // 小数（与整数严格区分）
  function GDict() { this.m = new Map(); }     // 字典（插入有序）
  function GFunc(def) { this.def = def; }      // 用户函数 / 闭包
  function GBuiltin(name, fn, arity) { this.name = name; this.fn = fn; this.arity = arity; }
  function GError(o) {
    this.code = o.code || "";
    this.message = o.message || "出错了";
    this.hint = o.hint || "";
    this.line = o.line || 0;
    this.col = o.col || 0;
    this.len = o.len || 1;
    this.stack = o.stack || [];
  }
  function ReturnSignal(v) { this.v = v; }
  function BreakSignal() {}
  function ContinueSignal() {}
  function StopSignal() {}

  var INT = function (n) { return n; };
  var FLT = function (n) { return new GF(n); };

  function isF(v) { return v instanceof GF; }
  function isNum(v) { return typeof v === "number" || v instanceof GF; }
  function numv(v) { return v instanceof GF ? v.v : v; }
  function isInt(v) { return typeof v === "number" && Number.isInteger(v); }

  function typeName(v) {
    if (v === null) return "空";
    if (v instanceof GF) return "小数";
    if (typeof v === "number") return "整数";
    if (typeof v === "string") return "文本";
    if (typeof v === "boolean") return "布尔";
    if (Array.isArray(v)) return "列表";
    if (v instanceof GDict) return "字典";
    if (v instanceof GFunc || v instanceof GBuiltin) return "函数";
    if (v instanceof GError) return "错误";
    return "未知";
  }

  function fmtNum(n) {
    if (Number.isInteger(n) && Math.abs(n) < 1e16) return String(n);
    var s = String(n);
    if (s.indexOf("e") !== -1 || s.indexOf("E") !== -1) return s;
    return s;
  }

  function fmtFloat(n) {
    var s = String(n);
    if (s.indexOf("e") !== -1 || s.indexOf("E") !== -1) return s;
    if (s.indexOf(".") === -1) s += ".0";
    return s;
  }

  // 顶层打印：文本不加引号
  function toText(v) {
    if (v === null) return "空";
    if (v instanceof GF) return fmtFloat(v.v);
    if (typeof v === "number") return fmtNum(v);
    if (typeof v === "string") return v;
    if (typeof v === "boolean") return v ? "真" : "假";
    return inspect(v);
  }

  // 容器内部：文本加引号
  function inspect(v) {
    if (v === null) return "空";
    if (v instanceof GF) return fmtFloat(v.v);
    if (typeof v === "number") return fmtNum(v);
    if (typeof v === "string") return '"' + v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n") + '"';
    if (typeof v === "boolean") return v ? "真" : "假";
    if (Array.isArray(v)) return "[" + v.map(inspect).join(", ") + "]";
    if (v instanceof GDict) {
      var parts = [];
      v.m.forEach(function (val, k) { parts.push(inspect(k) + ": " + inspect(val)); });
      return "{" + parts.join(", ") + "}";
    }
    if (v instanceof GFunc) return "<函数" + (v.def.name ? " " + v.def.name : "") + ">";
    if (v instanceof GBuiltin) return "<内置函数 " + v.name + ">";
    if (v instanceof GError) return "<错误 " + v.code + ">";
    return String(v);
  }

  function truthy(v) {
    if (v === null) return false;
    if (v === false) return false;
    if (v === true) return true;
    if (typeof v === "number") return v !== 0;
    if (v instanceof GF) return v.v !== 0;
    if (typeof v === "string") return v.length > 0;
    if (Array.isArray(v)) return v.length > 0;
    if (v instanceof GDict) return v.m.size > 0;
    return true;
  }

  /* ---------------- 词法 ---------------- */

  var KEYWORDS = ["设", "为", "局部", "全局", "非局部", "常量", "输出", "写出", "输入", "如果", "否则如果", "否则", "结束",
    "重复", "从", "到", "步长", "当", "遍历", "在", "中", "跳出", "继续",
    "函数", "接受", "返回", "空", "默认", "自身", "并且", "或者", "不", "真", "假",
    "尝试", "捕获", "抛出"];

  var CMP_ALIAS = { "等于": "==", "不等于": "!=", "大于等于": ">=", "小于等于": "<=", "大于": ">", "小于": "<" };
  var LOGIC_ALIAS = { "并且": "&&", "或者": "||", "不": "!" };
  var BOOL_ALIAS = { "真": true, "假": false };

  // 全角 → 半角
  var FW = {
    "（": "(", "）": ")", "［": "[", "］": "]", "【": "[", "】": "]", "｛": "{", "｝": "}",
    "，": ",", "、": ",", "：": ":", "；": ";", "“": '"', "”": '"', "‘": "'", "’": "'",
    "＋": "+", "－": "-", "＊": "*", "／": "/", "＝": "=", "　": " ",
    "０": "0", "１": "1", "２": "2", "３": "3", "４": "4", "５": "5", "６": "6", "７": "7", "８": "8", "９": "9",
    "！": "!", "＞": ">", "＜": "<", "％": "%", "＃": "#", "．": "."
  };

  function normalizeSource(src) {
    src = src.replace(/\r\n?/g, "\n");
    var out = "", i = 0;
    while (i < src.length) {
      var ch = src[i];
      // 字符串内部原样保留（全角标点只在「代码里」被纠正）
      if (ch === '"' || ch === "\u201c" || ch === "\u201d") {
        out += '"';
        i++;
        while (i < src.length && src[i] !== '"' && src[i] !== "\u201c" && src[i] !== "\u201d" && src[i] !== "\n") {
          if (src[i] === "\\" && i + 1 < src.length) {
            out += src[i] + src[i + 1];
            i += 2;
            continue;
          }
          out += src[i];
          i++;
        }
        if (i < src.length && src[i] !== "\n") { out += '"'; i++; }
        continue;
      }
      out += (FW[ch] !== undefined ? FW[ch] : ch);
      i++;
    }
    return out;
  }

  function isNameStart(ch) {
    return /[A-Za-z_\u4e00-\u9fa5]/.test(ch);
  }
  function isNamePart(ch) {
    return /[A-Za-z0-9_\u4e00-\u9fa5]/.test(ch);
  }

  function tokenize(src) {
    var s = normalizeSource(src);
    var toks = [], i = 0, line = 1, col = 1, depth = 0;

    function push(t, v, l, c) { toks.push({ t: t, v: v, line: l, col: c }); }
    function adv(n) {
      for (var k = 0; k < n; k++) {
        if (s[i] === "\n") { line++; col = 1; } else { col++; }
        i++;
      }
    }

    while (i < s.length) {
      var ch = s[i];

      if (ch === "\n") {
        if (depth === 0) push("nl", "\n", line, col);
        adv(1);
        continue;
      }
      if (ch === " " || ch === "\t") { adv(1); continue; }

      // 注释：# 或 注
      if (ch === "#") {
        while (i < s.length && s[i] !== "\n") adv(1);
        continue;
      }
      if (ch === "注" && !isNamePart(s[i + 1] || "")) {
        while (i < s.length && s[i] !== "\n") adv(1);
        continue;
      }

      var l0 = line, c0 = col;

      // 文本
      if (ch === '"') {
        adv(1);
        var buf = "";
        var closed = false;
        while (i < s.length) {
          var c2 = s[i];
          if (c2 === '"') { adv(1); closed = true; break; }
          if (c2 === "\\") {
            var n2 = s[i + 1];
            if (n2 === "n") buf += "\n";
            else if (n2 === "t") buf += "\t";
            else if (n2 === '"') buf += '"';
            else if (n2 === "\\") buf += "\\";
            else buf += n2 === undefined ? "" : n2;
            adv(2);
            continue;
          }
          if (c2 === "\n") { break; }
          buf += c2;
          adv(1);
        }
        if (!closed) {
          throw new GError({ code: "E1002", message: "文本没有闭合引号", hint: "在这一行末尾补一个半角双引号 \"", line: l0, col: c0, len: 1 });
        }
        push("str", buf, l0, c0);
        continue;
      }

      // 数字
      if (/[0-9]/.test(ch)) {
        var j = i, dots = 0;
        while (j < s.length && (/[0-9]/.test(s[j]) || s[j] === ".")) {
          if (s[j] === ".") dots++;
          j++;
        }
        var raw = s.slice(i, j);
        if (dots > 1) {
          throw new GError({ code: "E1003", message: "数字格式不对：「" + raw + "」", hint: "小数点只能有一个，例如 3.14", line: l0, col: c0, len: raw.length });
        }
        var isFloat = raw.indexOf(".") !== -1;
        push("num", { n: parseFloat(raw), float: isFloat }, l0, c0);
        adv(raw.length);
        continue;
      }

      // 名字 / 关键字
      if (isNameStart(ch)) {
        var k0 = i;
        while (i < s.length && isNamePart(s[i])) adv(1);
        var word = s.slice(k0, i);
        if (CMP_ALIAS[word]) push("op", CMP_ALIAS[word], l0, c0);
        else if (LOGIC_ALIAS[word]) push("op", LOGIC_ALIAS[word], l0, c0);
        else if (BOOL_ALIAS[word] !== undefined) push("bool", BOOL_ALIAS[word], l0, c0);
        else if (word === "空") push("null", "空", l0, c0);
        else if (KEYWORDS.indexOf(word) !== -1) push("kw", word, l0, c0);
        else if (word === "and") push("op", "&&", l0, c0);
        else if (word === "or") push("op", "||", l0, c0);
        else if (word === "not") push("op", "!", l0, c0);
        else if (word === "true") push("bool", true, l0, c0);
        else if (word === "false") push("bool", false, l0, c0);
        else push("id", word, l0, c0);
        continue;
      }

      // 运算符
      var three = s.substr(i, 3);
      if (three === "...") { push("op", "...", l0, c0); adv(3); continue; }
      var two = s.substr(i, 2);
      if (two === "**" || two === "//" || two === "==" || two === "!=" || two === ">=" || two === "<=" || two === "&&" || two === "||") {
        push("op", two, l0, c0); adv(2); continue;
      }
      if ("+-*/%<>()[]{},:;!=.".indexOf(ch) !== -1) {
        if ("([{".indexOf(ch) !== -1) depth++;
        if (")]}".indexOf(ch) !== -1) depth = Math.max(0, depth - 1);
        push("op", ch, l0, c0);
        adv(1);
        continue;
      }

      throw new GError({
        code: "E1001", message: "无法识别的字符「" + ch + "」",
        hint: "这里的字符不在 G-Lang 的字符表里，删掉它，或者换成半角符号",
        line: l0, col: c0, len: 1
      });
    }

    push("eof", "", line, col);
    return toks;
  }

  /* ---------------- 语法 ---------------- */

  function Parser(toks, srcLines) {
    this.toks = toks;
    this.p = 0;
    this.src = srcLines;
  }

  Parser.prototype.peek = function (k) { return this.toks[this.p + (k || 0)]; };
  Parser.prototype.next = function () { return this.toks[this.p++]; };
  Parser.prototype.isOp = function (v, k) { var t = this.peek(k); return t && t.t === "op" && t.v === v; };
  Parser.prototype.isKw = function (v, k) { var t = this.peek(k); return t && t.t === "kw" && t.v === v; };
  Parser.prototype.acceptOp = function (v) { if (this.isOp(v)) { this.p++; return true; } return false; };
  Parser.prototype.expectOp = function (v, hint) {
    if (this.isOp(v)) return this.next();
    var t = this.peek();
    throw new GError({
      code: "E2001", message: "这里需要一个「" + v + "」",
      hint: hint || "检查这一行的写法，看看是不是漏了符号",
      line: t.line, col: t.col, len: 1
    });
  };
  Parser.prototype.skipNL = function () { while (this.peek().t === "nl" || this.isOp(";")) this.p++; };

  Parser.prototype.parseProgram = function () {
    var body = [];
    this.skipNL();
    while (this.peek().t !== "eof") {
      body.push(this.parseStatement());
      this.skipNL();
    }
    return { type: "block", body: body, line: 0 };
  };

  var STOP_KW = ["结束", "否则如果", "否则", "捕获"];

  Parser.prototype.parseBlock = function () {
    var body = [];
    this.skipNL();
    while (this.peek().t !== "eof" && !(this.peek().t === "kw" && STOP_KW.indexOf(this.peek().v) !== -1)) {
      body.push(this.parseStatement());
      this.skipNL();
    }
    return body;
  };

  Parser.prototype.endStatement = function () {
    if (this.isOp(";")) this.p++;
    var t = this.peek();
    if (t.t === "nl") { this.p++; return; }
    if (t.t === "eof") return;
    if (t.t === "kw" && STOP_KW.indexOf(t.v) !== -1) return;
    throw new GError({
      code: "E2001", message: "这一行写不完整，多出来「" + (t.v || t.t) + "」",
      hint: "一条语句占一行。想写下一句就换行；不确定是不是多打了个符号，就把它删掉",
      line: t.line, col: t.col, len: 1
    });
  };

  Parser.prototype.parseStatement = function () {
    var t = this.peek();

    if (t.t === "kw") {
      switch (t.v) {
        case "设": case "局部": case "全局": case "非局部": case "常量":
          return this.parseAssign();
        case "输出": case "写出":
          return this.parseOutput();
        case "输入":
          return this.parseInput();
        case "如果":
          return this.parseIf();
        case "重复":
          return this.parseRepeat();
        case "当":
          return this.parseWhile();
        case "遍历":
          return this.parseForeach();
        case "跳出": this.p++; this.endStatement(); return { type: "break", line: t.line, col: t.col };
        case "继续": this.p++; this.endStatement(); return { type: "continue", line: t.line, col: t.col };
        case "返回": {
          this.p++;
          var hasVal = !(this.peek().t === "nl" || this.peek().t === "eof" ||
            (this.peek().t === "kw" && STOP_KW.indexOf(this.peek().v) !== -1));
          var v = hasVal ? this.parseExpr() : null;
          this.endStatement();
          return { type: "return", value: v, line: t.line, col: t.col };
        }
        case "函数": {
          // 语句形式：函数 名字 [接受 ...]
          if (this.peek(1).t === "id") return this.parseFuncDecl();
          break;
        }
        case "尝试": return this.parseTry();
        case "抛出": {
          this.p++;
          var e = this.parseExpr();
          this.endStatement();
          return { type: "throw", value: e, line: t.line, col: t.col };
        }
        case "结束": case "否则": case "否则如果": case "捕获":
          throw new GError({
            code: "E2002", message: "「" + t.v + "」没有对应的块开头",
            hint: "这个关键字只能出现在块内部。检查是不是少写了「如果」或者多打了一个「" + t.v + "」",
            line: t.line, col: t.col, len: t.v.length
          });
      }
    }

    var expr = this.parseExpr();
    this.endStatement();
    return { type: "expr", expr: expr, line: t.line, col: t.col };
  };

  Parser.prototype.parseAssign = function () {
    var kw = this.next();
    var prefix = kw.v;
    var nm = this.peek();
    if (nm.t === "kw") {
      throw new GError({
        code: "E2006", message: "「" + nm.v + "」是关键字，不能当变量名",
        hint: "换一个名字，例如「" + nm.v + "值」「结果」或者拼音写法",
        line: nm.line, col: nm.col, len: nm.v.length
      });
    }
    if (nm.t !== "id") {
      throw new GError({
        code: "E2001", message: "「" + prefix + "」后面要跟一个变量名",
        hint: "写成「" + prefix + " 变量名 为 值」，例如「设 年龄 为 18」",
        line: nm.line, col: nm.col, len: 1
      });
    }
    this.p++;

    var typeAnn = null;
    if (this.isOp(":")) {
      this.p++;
      var tn = this.next();
      if (tn.t !== "id") {
        throw new GError({ code: "E3203", message: "类型标注写法不对", hint: "冒号后面写类型名，例如 整数 / 小数 / 文本 / 列表 / 字典", line: tn.line, col: tn.col, len: 1 });
      }
      typeAnn = tn.v;
    }

    var idx = null;
    if (this.isOp("[")) {
      this.p++;
      idx = this.parseExpr();
      this.expectOp("]", "下标要以 ] 收尾");
    }

    if (!this.isKw("为") && !this.isOp("=")) {
      var t2 = this.peek();
      throw new GError({
        code: "E2001", message: "「" + prefix + " " + nm.v + "」后面少了「为」",
        hint: "写成「" + prefix + " " + nm.v + " 为 值」",
        line: t2.line, col: t2.col, len: 1
      });
    }
    this.p++;
    var value = this.parseExpr();
    this.endStatement();
    return { type: "assign", prefix: prefix, name: nm.v, typeAnn: typeAnn, index: idx, value: value, line: kw.line, col: kw.col };
  };

  Parser.prototype.parseOutput = function () {
    var kw = this.next();
    var args = [this.parseExpr()];
    while (this.isOp(",")) { this.p++; args.push(this.parseExpr()); }
    this.endStatement();
    return { type: "output", newline: kw.v === "输出", args: args, line: kw.line, col: kw.col };
  };

  Parser.prototype.parseInput = function () {
    var kw = this.next();
    var t = this.peek();
    if (t.t === "id" && this.peek(1).t === "nl") {
      this.p++;
      this.endStatement();
      return { type: "input", name: t.v, line: kw.line, col: kw.col };
    }
    // 也允许 输入 名字, 第二个
    var names = [];
    while (this.peek().t === "id") {
      names.push(this.next().v);
      if (this.isOp(",")) { this.p++; continue; }
      break;
    }
    this.endStatement();
    return { type: "input", names: names, line: kw.line, col: kw.col };
  };

  Parser.prototype.parseIf = function () {
    var kw = this.next();
    var branches = [];
    var cond = this.parseExpr();
    var body = this.parseBlock();
    branches.push({ cond: cond, body: body });
    var elseBody = null;

    for (;;) {
      if (this.isKw("否则如果")) {
        this.p++;
        var c2 = this.parseExpr();
        var b2 = this.parseBlock();
        branches.push({ cond: c2, body: b2 });
        continue;
      }
      if (this.isKw("否则")) {
        this.p++;
        elseBody = this.parseBlock();
        continue;
      }
      break;
    }

    if (!this.isKw("结束")) {
      var t = this.peek();
      throw new GError({
        code: "E2003", message: "缺少「结束」",
        hint: "第 " + kw.line + " 行的「如果」没有闭合，在块的末尾补一个「结束」",
        line: t.line, col: t.col, len: 1
      });
    }
    this.p++;
    this.endStatement();
    return { type: "if", branches: branches, elseBody: elseBody, line: kw.line, col: kw.col };
  };

  Parser.prototype.parseRepeat = function () {
    var kw = this.next();
    var v = this.next();
    if (v.t !== "id") {
      throw new GError({ code: "E2001", message: "「重复」后面要跟循环变量名", hint: "写成「重复 i 从 1 到 10」", line: v.line, col: v.col, len: 1 });
    }
    if (!this.isKw("从")) {
      var t = this.peek();
      throw new GError({ code: "E2001", message: "「重复 " + v.v + "」后面少了「从」", hint: "写成「重复 i 从 1 到 10」", line: t.line, col: t.col, len: 1 });
    }
    this.p++;
    var from = this.parseExpr();
    if (!this.isKw("到")) {
      var t2 = this.peek();
      throw new GError({ code: "E2001", message: "「重复 " + v.v + " 从 …」后面少了「到」", hint: "写成「重复 i 从 1 到 10」", line: t2.line, col: t2.col, len: 1 });
    }
    this.p++;
    var to = this.parseExpr();
    var step = null;
    if (this.isKw("步长")) { this.p++; step = this.parseExpr(); }
    var body = this.parseBlock();
    if (!this.isKw("结束")) {
      var t3 = this.peek();
      throw new GError({ code: "E2003", message: "缺少「结束」", hint: "第 " + kw.line + " 行的「重复」没有闭合，补一个「结束」", line: t3.line, col: t3.col, len: 1 });
    }
    this.p++;
    this.endStatement();
    return { type: "repeat", name: v.v, from: from, to: to, step: step, body: body, line: kw.line, col: kw.col };
  };

  Parser.prototype.parseWhile = function () {
    var kw = this.next();
    var cond = this.parseExpr();
    var body = this.parseBlock();
    if (!this.isKw("结束")) {
      var t = this.peek();
      throw new GError({ code: "E2003", message: "缺少「结束」", hint: "第 " + kw.line + " 行的「当」没有闭合，补一个「结束」", line: t.line, col: t.col, len: 1 });
    }
    this.p++;
    this.endStatement();
    return { type: "while", cond: cond, body: body, line: kw.line, col: kw.col };
  };

  Parser.prototype.parseForeach = function () {
    var kw = this.next();
    var names = [];
    var v1 = this.next();
    if (v1.t !== "id") {
      throw new GError({ code: "E2001", message: "「遍历」后面要跟变量名", hint: "写成「遍历 项 在 列表 中」", line: v1.line, col: v1.col, len: 1 });
    }
    names.push(v1.v);
    if (this.isOp(",")) {
      this.p++;
      var v2 = this.next();
      if (v2.t !== "id") {
        throw new GError({ code: "E2001", message: "第二个遍历变量写错了", hint: "写成「遍历 元素, 下标 在 列表 中」", line: v2.line, col: v2.col, len: 1 });
      }
      names.push(v2.v);
    }
    if (!this.isKw("在")) {
      var t = this.peek();
      throw new GError({
        code: "E2001", message: "「遍历 " + names.join(", ") + "」后面少了「在」",
        hint: "完整写法是「遍历 项 在 列表 中」",
        line: t.line, col: t.col, len: 1
      });
    }
    this.p++;
    var iter = this.parseExpr();
    if (!this.isKw("中")) {
      var t2 = this.peek();
      throw new GError({
        code: "E2001", message: "「遍历」少了收尾的「中」",
        hint: "写成「遍历 项 在 列表 中」——v0.2 起「中」是必需的",
        line: t2.line, col: t2.col, len: 1
      });
    }
    this.p++;
    var body = this.parseBlock();
    if (!this.isKw("结束")) {
      var t3 = this.peek();
      throw new GError({ code: "E2003", message: "缺少「结束」", hint: "第 " + kw.line + " 行的「遍历」没有闭合，补一个「结束」", line: t3.line, col: t3.col, len: 1 });
    }
    this.p++;
    this.endStatement();
    return { type: "foreach", names: names, iter: iter, body: body, line: kw.line, col: kw.col };
  };

  Parser.prototype.parseParams = function () {
    var params = [];
    var retType = null;
    var paren = false;

    if (this.isOp("(")) { this.p++; paren = true; }
    else if (this.isKw("接受")) { this.p++; }
    else return { params: params, retType: null };

    while (this.peek().t === "id") {
      var nm = this.next();
      var p = { name: nm.v, type: null, def: null, variadic: false, line: nm.line, col: nm.col };

      if (this.isOp(":")) {
        this.p++;
        var tn = this.next();
        if (tn.t !== "id") {
          throw new GError({ code: "E3203", message: "类型标注写法不对", hint: "冒号后面写类型名", line: tn.line, col: tn.col, len: 1 });
        }
        p.type = tn.v;
      }
      if (this.isOp("...")) { this.p++; p.variadic = true; }
      if (this.isKw("默认")) {
        this.p++;
        p.def = this.parseExpr();
      }
      params.push(p);

      if (this.isOp(",")) { this.p++; continue; }
      break;
    }

    if (this.isOp(":")) {
      this.p++;
      var rt = this.next();
      if (rt.t === "id") retType = rt.v;
    }
    if (paren) this.expectOp(")", "参数列表的括号没有配对，补一个 )");
    return { params: params, retType: retType };
  };

  Parser.prototype.parseFuncDecl = function () {
    var kw = this.next();              // 函数
    var nm = this.next();              // 名字
    var ps = this.parseParams();
    var body = this.parseBlock();
    if (!this.isKw("结束")) {
      var t = this.peek();
      throw new GError({ code: "E2003", message: "缺少「结束」", hint: "第 " + kw.line + " 行的「函数 " + nm.v + "」没有闭合，补一个「结束」", line: t.line, col: t.col, len: 1 });
    }
    this.p++;
    this.endStatement();
    return { type: "funcdecl", name: nm.v, params: ps.params, retType: ps.retType, body: body, line: kw.line, col: kw.col };
  };

  Parser.prototype.parseTry = function () {
    var kw = this.next();
    var body = this.parseBlock();
    var catchName = null, catchBody = null;
    if (this.isKw("捕获")) {
      this.p++;
      var nm = this.next();
      if (nm.t === "id") catchName = nm.v;
      catchBody = this.parseBlock();
    }
    if (!this.isKw("结束")) {
      var t = this.peek();
      throw new GError({
        code: "E2003", message: "缺少「结束」",
        hint: catchName ? "第 " + kw.line + " 行的「尝试」没有闭合，补一个「结束」" : "「尝试」必须配一个「捕获」，最后用「结束」收尾",
        line: t.line, col: t.col, len: 1
      });
    }
    this.p++;
    this.endStatement();
    return { type: "try", body: body, catchName: catchName, catchBody: catchBody, line: kw.line, col: kw.col };
  };

  /* ---- 表达式 ---- */

  Parser.prototype.parseExpr = function () { return this.parseOr(); };

  Parser.prototype.parseOr = function () {
    var left = this.parseAnd();
    while (this.isOp("||")) {
      var op = this.next();
      var right = this.parseAnd();
      left = { type: "logic", op: "||", left: left, right: right, line: op.line, col: op.col };
    }
    return left;
  };

  Parser.prototype.parseAnd = function () {
    var left = this.parseCmp();
    while (this.isOp("&&")) {
      var op = this.next();
      var right = this.parseCmp();
      left = { type: "logic", op: "&&", left: left, right: right, line: op.line, col: op.col };
    }
    return left;
  };

  Parser.prototype.parseCmp = function () {
    var left = this.parseAdd();
    var ops = ["==", "!=", ">", "<", ">=", "<="];
    while (this.peek().t === "op" && ops.indexOf(this.peek().v) !== -1) {
      var op = this.next();
      var right = this.parseAdd();
      if (this.peek().t === "op" && ops.indexOf(this.peek().v) !== -1) {
        var t2 = this.peek();
        throw new GError({
          code: "E2005", message: "比较不能连写",
          hint: "把「1 < x < 10」拆成两个条件，用「并且」连接：" + "1 < x 并且 x < 10",
          line: t2.line, col: t2.col, len: 1
        });
      }
      left = { type: "bin", op: op.v, left: left, right: right, line: op.line, col: op.col };
    }
    return left;
  };

  Parser.prototype.parseAdd = function () {
    var left = this.parseMul();
    while (this.isOp("+") || this.isOp("-")) {
      var op = this.next();
      var right = this.parseMul();
      left = { type: "bin", op: op.v, left: left, right: right, line: op.line, col: op.col };
    }
    return left;
  };

  Parser.prototype.parseMul = function () {
    var left = this.parseUnary();
    while (this.isOp("*") || this.isOp("/") || this.isOp("//") || this.isOp("%")) {
      var op = this.next();
      var right = this.parseUnary();
      left = { type: "bin", op: op.v, left: left, right: right, line: op.line, col: op.col };
    }
    return left;
  };

  Parser.prototype.parseUnary = function () {
    if (this.isOp("-") || this.isOp("!")) {
      var op = this.next();
      var e = this.parseUnary();
      return { type: "unary", op: op.v, expr: e, line: op.line, col: op.col };
    }
    return this.parsePow();
  };

  Parser.prototype.parsePow = function () {
    var base = this.parsePostfix();
    if (this.isOp("**")) {
      var op = this.next();
      var exp = this.parseUnary();     // 右结合
      return { type: "bin", op: "**", left: base, right: exp, line: op.line, col: op.col };
    }
    return base;
  };

  Parser.prototype.parsePostfix = function () {
    var e = this.parsePrimary();
    for (;;) {
      if (this.isOp("(")) {
        var lp = this.next();
        var args = [];
        if (!this.isOp(")")) {
          args.push(this.parseExpr());
          while (this.isOp(",")) { this.p++; args.push(this.parseExpr()); }
        }
        this.expectOp(")", "函数调用的括号没有配对，补一个 )");
        e = { type: "call", callee: e, args: args, line: lp.line, col: lp.col };
        continue;
      }
      if (this.isOp("[")) {
        var lb = this.next();
        if (this.isOp(":")) {
          this.p++;
          var end = this.isOp("]") ? null : this.parseExpr();
          this.expectOp("]", "下标要以 ] 收尾");
          e = { type: "slice", obj: e, start: null, end: end, line: lb.line, col: lb.col };
          continue;
        }
        var idx = this.parseExpr();
        if (this.isOp(":")) {
          this.p++;
          var end2 = this.isOp("]") ? null : this.parseExpr();
          this.expectOp("]", "下标要以 ] 收尾");
          e = { type: "slice", obj: e, start: idx, end: end2, line: lb.line, col: lb.col };
          continue;
        }
        this.expectOp("]", "下标要以 ] 收尾");
        e = { type: "index", obj: e, index: idx, line: lb.line, col: lb.col };
        continue;
      }
      break;
    }
    return e;
  };

  Parser.prototype.parsePrimary = function () {
    var t = this.peek();

    if (t.t === "num") { this.p++; return { type: "num", value: t.v.n, float: t.v.float, line: t.line, col: t.col }; }
    if (t.t === "str") { this.p++; return { type: "str", value: t.v, line: t.line, col: t.col }; }
    if (t.t === "bool") { this.p++; return { type: "bool", value: t.v, line: t.line, col: t.col }; }
    if (t.t === "null") { this.p++; return { type: "null", line: t.line, col: t.col }; }
    if (t.t === "id") { this.p++; return { type: "var", name: t.v, line: t.line, col: t.col }; }

    if (t.t === "kw" && t.v === "自身") { this.p++; return { type: "self", line: t.line, col: t.col }; }

    if (t.t === "kw" && t.v === "函数") {
      this.p++;
      var ps = this.parseParams();
      var body = this.parseBlock();
      if (!this.isKw("结束")) {
        var tk = this.peek();
        throw new GError({ code: "E2003", message: "缺少「结束」", hint: "匿名函数也要用「结束」收尾", line: tk.line, col: tk.col, len: 1 });
      }
      this.p++;
      return { type: "funcexpr", params: ps.params, retType: ps.retType, body: body, line: t.line, col: t.col };
    }

    if (this.isOp("(")) {
      this.p++;
      var e = this.parseExpr();
      this.expectOp(")", "括号没有配对，补一个 )");
      return e;
    }

    if (this.isOp("[")) {
      this.p++;
      var items = [];
      while (!this.isOp("]")) {
        items.push(this.parseExpr());
        if (this.isOp(",")) { this.p++; continue; }
        break;
      }
      this.expectOp("]", "列表字面量要以 ] 收尾");
      return { type: "list", items: items, line: t.line, col: t.col };
    }

    if (this.isOp("{")) {
      this.p++;
      var entries = [];
      while (!this.isOp("}")) {
        var k = this.parseExpr();
        this.expectOp(":", "字典的键值之间要写冒号，例如 {\"名字\": \"小白\"}");
        var v = this.parseExpr();
        entries.push({ k: k, v: v });
        if (this.isOp(",")) { this.p++; continue; }
        break;
      }
      this.expectOp("}", "字典字面量要以 } 收尾");
      return { type: "dict", entries: entries, line: t.line, col: t.col };
    }

    throw new GError({
      code: "E2001",
      message: t.t === "eof" ? "程序在这里就结束了，还差一点内容" : "这里应该是一个值或者变量名，却看到「" + (t.v || t.t) + "」",
      hint: "检查这一行是不是只写了半句，比如「输出 +」",
      line: t.line, col: t.col, len: 1
    });
  };

  /* ---------------- 环境 ---------------- */

  function Env(kind, parent) {
    this.kind = kind;        // global | function | block
    this.parent = parent || null;
    this.vars = new Map();
  }
  Env.prototype.fnScope = function () {
    var e = this;
    while (e && e.kind === "block") e = e.parent;
    return e || this;
  };
  Env.prototype.root = function () {
    var e = this;
    while (e.parent) e = e.parent;
    return e;
  };
  Env.prototype.find = function (name) {
    var e = this;
    while (e) {
      if (e.vars.has(name)) return e;
      e = e.parent;
    }
    return null;
  };
  Env.prototype.get = function (name, node) {
    var e = this.find(name);
    if (!e) {
      throw new GError({
        code: "E3001", message: "变量「" + name + "」还没有赋值",
        hint: "先写「设 " + name + " 为 …」定义它，或者用「输入 " + name + "」读入",
        line: node ? node.line : 0, col: node ? node.col : 0, len: name.length
      });
    }
    return e.vars.get(name).value;
  };
  Env.prototype.def = function (name, value, opts) {
    this.vars.set(name, { value: value, isConst: !!(opts && opts.isConst) });
  };
  Env.prototype.setExisting = function (name, value, node) {
    var e = this.find(name);
    if (!e) {
      throw new GError({
        code: "E3001", message: "变量「" + name + "」还没有赋值",
        hint: "非局部只能修改外层函数里已经存在的变量；先在外层写「设 " + name + " 为 …」",
        line: node ? node.line : 0, col: node ? node.col : 0, len: name.length
      });
    }
    var slot = e.vars.get(name);
    if (slot.isConst) {
      throw new GError({
        code: "E3204", message: "常量「" + name + "」不能再赋值",
        hint: "常量用「常量」定义后就固定了。想改就用「设」重新定义一个新名字",
        line: node ? node.line : 0, col: node ? node.col : 0, len: name.length
      });
    }
    slot.value = value;
  };

  /* ---------------- 解释器 ---------------- */

  function Interp(src, stdin) {
    this.srcLines = normalizeSource(src).split("\n");
    this.stdin = (stdin || "").split(/\r?\n/);
    this.stdinPos = 0;
    this.out = [];
    this.lineBuf = "";
    this.steps = 0;
    this.depth = 0;
    this.maxSteps = 3000000;
  }

  Interp.prototype.emit = function (text, newline) {
    this.lineBuf += text;
    if (newline) { this.out.push(this.lineBuf); this.lineBuf = ""; }
  };

  Interp.prototype.flush = function () {
    if (this.lineBuf.length) { this.out.push(this.lineBuf); this.lineBuf = ""; }
  };

  Interp.prototype.readInput = function () {
    if (this.stdinPos >= this.stdin.length) return null;
    var line = this.stdin[this.stdinPos++];
    if (line === undefined) return null;
    if (/^-?\d+$/.test(line)) return parseInt(line, 10);
    if (/^-?\d*\.\d+$/.test(line)) return new GF(parseFloat(line));
    return line;
  };

  Interp.prototype.run = function () {
    var toks = tokenize(this.srcLines.join("\n"));
    var parser = new Parser(toks, this.srcLines);
    var program = parser.parseProgram();
    this.globalEnv = new Env("global");
    this.installBuiltins(this.globalEnv);
    this.execBlock(program.body, this.globalEnv);
    this.flush();
    return this.out.join("\n");
  };

  Interp.prototype.tick = function () {
    this.steps++;
    if (this.steps > this.maxSteps) {
      throw new GError({
        code: "", message: "运行时间太长，可能写成了死循环",
        hint: "检查「当」循环的条件有没有机会变成假；演练场对执行步数有限制",
        line: 0, col: 0, len: 1
      });
    }
  };

  Interp.prototype.execBlock = function (stmts, env) {
    var blockEnv = new Env("block", env);
    for (var i = 0; i < stmts.length; i++) {
      this.execStatement(stmts[i], blockEnv);
    }
  };

  Interp.prototype.execStatement = function (st, env) {
    this.tick();
    switch (st.type) {
      case "assign": return this.execAssign(st, env);
      case "output": {
        var parts = st.args.map(function (a) { return toText(this.eval(a, env)); }, this);
        this.emit(parts.join(""), st.newline);
        return;
      }
      case "input": {
        var names = st.names || [st.name];
        for (var i = 0; i < names.length; i++) {
          env.fnScope().def(names[i], this.readInput());
        }
        return;
      }
      case "if": {
        for (var b = 0; b < st.branches.length; b++) {
          if (truthy(this.eval(st.branches[b].cond, env))) {
            this.execBlock(st.branches[b].body, env);
            return;
          }
        }
        if (st.elseBody) this.execBlock(st.elseBody, env);
        return;
      }
      case "repeat": return this.execRepeat(st, env);
      case "while": {
        while (truthy(this.eval(st.cond, env))) {
          this.tick();
          try {
            this.execBlock(st.body, env);
          } catch (e) {
            if (e instanceof BreakSignal) return;
            if (e instanceof ContinueSignal) continue;
            throw e;
          }
        }
        return;
      }
      case "foreach": return this.execForeach(st, env);
      case "break": throw new BreakSignal();
      case "continue": throw new ContinueSignal();
      case "return": throw new ReturnSignal(st.value ? this.eval(st.value, env) : null);
      case "funcdecl": {
        var fn = new GFunc({ name: st.name, params: st.params, retType: st.retType, body: st.body, closure: env });
        env.fnScope().def(st.name, fn);
        return;
      }
      case "expr": this.eval(st.expr, env); return;
      case "try": {
        try {
          this.execBlock(st.body, env);
        } catch (e) {
          if (!(e instanceof GError)) throw e;
          if (!st.catchBody) throw e;
          var cenv = new Env("block", env);
          if (st.catchName) cenv.def(st.catchName, e);
          this.execBlock(st.catchBody, cenv);
        }
        return;
      }
      case "throw": {
        var val = this.eval(st.value, env);
        if (val instanceof GError) throw val;
        throw new GError({
          code: "E4001", message: "程序自己抛出的错误：" + toText(val),
          hint: "这一行是「抛出」，想让它不中断程序，就放进「尝试 … 捕获」里",
          line: st.line, col: st.col, len: 2
        });
      }
    }
  };

  Interp.prototype.execAssign = function (st, env) {
    var value = this.eval(st.value, env);

    if (st.typeAnn && !this.checkType(value, st.typeAnn, st)) {
      throw new GError({
        code: "E3201", message: "标注的类型是「" + st.typeAnn + "」，实际是「" + typeName(value) + "」",
        hint: "要么把标注改成「" + typeName(value) + "」，要么把值改成 " + st.typeAnn + "。整数和小数是分开算的：3 是整数，3.0 才是小数",
        line: st.line, col: st.col, len: (st.prefix + " " + st.name).length
      });
    }

    if (st.index) {
      var target = env.get(st.name, st);
      var idx = this.eval(st.index, env);
      if (Array.isArray(target)) {
        var i = this.toIndex(idx, target.length, st);
        target[i] = value;
        return;
      }
      if (target instanceof GDict) {
        target.m.set(idx, value);
        return;
      }
      throw new GError({
        code: "E3002", message: "「" + st.name + "」不是列表也不是字典，不能用下标赋值",
        hint: "只有列表和字典能写「设 表[0] 为 …」",
        line: st.line, col: st.col, len: st.name.length
      });
    }

    if (st.prefix === "局部") {
      env.def(st.name, value);
    } else if (st.prefix === "全局") {
      env.root().def(st.name, value);
    } else if (st.prefix === "非局部") {
      var e = env.parent;
      while (e && e.kind === "block") e = e.parent;
      if (e && e.parent) {
        e.parent.setExisting(st.name, value, st);
      } else {
        env.root().setExisting(st.name, value, st);
      }
    } else if (st.prefix === "常量") {
      var fs = env.fnScope();
      if (fs.vars.has(st.name)) {
        throw new GError({
          code: "E3204", message: "常量「" + st.name + "」不能再赋值",
          hint: "常量用「常量」定义后就固定了",
          line: st.line, col: st.col, len: st.name.length
        });
      }
      fs.def(st.name, value, { isConst: true });
    } else {
      var fe = env.fnScope();
      if (fe.vars.has(st.name)) fe.setExisting(st.name, value, st);
      else fe.def(st.name, value);
    }
  };

  Interp.prototype.toIndex = function (idx, len, st) {
    var n = numv(idx);
    if (typeof n !== "number" || !Number.isInteger(n)) {
      throw new GError({
        code: "E3002", message: "下标必须是整数，给的是「" + toText(idx) + "」",
        hint: "列表下标从 0 开始，写成 表[0]",
        line: st.line, col: st.col, len: 1
      });
    }
    var real = n < 0 ? len + n : n;
    if (real < 0 || real >= len) {
      throw new GError({
        code: "E3004", message: "下标「" + n + "」超出范围，列表只有 " + len + " 个元素",
        hint: len === 0 ? "这个列表是空的，先往里「追加」几个元素" : "合法下标是 0 到 " + (len - 1) + "（也可以写 -1 表示最后一个）",
        line: st.line, col: st.col, len: 1
      });
    }
    return real;
  };

  Interp.prototype.checkType = function (value, typeNameWanted, st) {
    if (typeNameWanted === "数字") return isNum(value);
    return typeName(value) === typeNameWanted;
  };

  Interp.prototype.execRepeat = function (st, env) {
    var from = this.toInt(this.eval(st.from, env), st);
    var to = this.toInt(this.eval(st.to, env), st);
    var step = st.step ? this.toInt(this.eval(st.step, env), st) : (from <= to ? 1 : -1);
    if (step === 0) {
      throw new GError({
        code: "E3012", message: "步长不能是 0",
        hint: "步长为 0 会永远出不来。想倒着数就写「步长 -1」",
        line: st.line, col: st.col, len: 2
      });
    }
    var guard = 0;
    for (var i = from; step > 0 ? i <= to : i >= to; i += step) {
      if (++guard > 1000000) break;
      this.tick();
      var iterEnv = new Env("block", env);
      iterEnv.def(st.name, i);
      try {
        this.execBlock(st.body, iterEnv);
      } catch (e) {
        if (e instanceof BreakSignal) return;
        if (e instanceof ContinueSignal) continue;
        throw e;
      }
    }
  };

  Interp.prototype.toInt = function (v, st) {
    if (typeof v === "number" && Number.isInteger(v)) return v;
    if (v instanceof GF && Number.isInteger(v.v)) return v.v;
    throw new GError({
      code: "E3002", message: "循环的起点、终点、步长必须是整数，给的是「" + toText(v) + "」",
      hint: "写成整数，例如「重复 i 从 1 到 10」",
      line: st.line, col: st.col, len: 2
    });
  };

  Interp.prototype.execForeach = function (st, env) {
    var it = this.eval(st.iter, env);
    var pairs = [];   // [first, second]
    if (Array.isArray(it)) {
      for (var i = 0; i < it.length; i++) pairs.push([it[i], i]);
    } else if (typeof it === "string") {
      var chars = Array.from(it);
      for (var j = 0; j < chars.length; j++) pairs.push([chars[j], j]);
    } else if (it instanceof GDict) {
      var self = this;
      it.m.forEach(function (v, k) { pairs.push([k, v]); });
    } else {
      throw new GError({
        code: "E3013", message: "「" + typeName(it) + "」不能遍历",
        hint: "能遍历的只有列表、文本、字典三种",
        line: st.line, col: st.col, len: 2
      });
    }

    for (var k = 0; k < pairs.length; k++) {
      this.tick();
      var iterEnv = new Env("block", env);
      iterEnv.def(st.names[0], pairs[k][0]);
      if (st.names[1]) iterEnv.def(st.names[1], pairs[k][1]);
      try {
        this.execBlock(st.body, iterEnv);
      } catch (e) {
        if (e instanceof BreakSignal) return;
        if (e instanceof ContinueSignal) continue;
        throw e;
      }
    }
  };

  /* ---- 表达式求值 ---- */

  Interp.prototype.eval = function (node, env) {
    switch (node.type) {
      case "num": return node.float ? new GF(node.value) : node.value;
      case "str": return node.value;
      case "bool": return node.value;
      case "null": return null;
      case "var": return env.get(node.name, node);
      case "self": {
        var f = env.get("__self__", node);
        if (!f) throw new GError({ code: "E3001", message: "「自身」只能在函数里用", hint: "匿名函数想递归，就在函数体里写「自身(…)」", line: node.line, col: node.col, len: 2 });
        return f;
      }
      case "list": return node.items.map(function (x) { return this.eval(x, env); }, this);
      case "dict": {
        var d = new GDict();
        for (var i = 0; i < node.entries.length; i++) {
          d.m.set(this.eval(node.entries[i].k, env), this.eval(node.entries[i].v, env));
        }
        return d;
      }
      case "unary": {
        var v = this.eval(node.expr, env);
        if (node.op === "-") {
          if (v instanceof GF) return new GF(-v.v);
          if (typeof v === "number") return -v;
          throw new GError({ code: "E3009", message: "负号只能作用在数字上，「" + typeName(v) + "」不行", hint: "检查这一项是不是文本或者空", line: node.line, col: node.col, len: 1 });
        }
        return !truthy(v);
      }
      case "logic": {
        var l = this.eval(node.left, env);
        if (node.op === "&&") return truthy(l) ? truthy(this.eval(node.right, env)) : false;
        return truthy(l) ? true : truthy(this.eval(node.right, env));
      }
      case "bin": return this.binop(node, env);
      case "index": return this.evalIndex(node, env);
      case "slice": return this.evalSlice(node, env);
      case "call": return this.evalCall(node, env);
      case "funcexpr": {
        var self = this;
        var fn = new GFunc({ name: "", params: node.params, retType: node.retType, body: node.body, closure: env });
        return fn;
      }
    }
    throw new Error("未知表达式 " + node.type);
  };

  Interp.prototype.binop = function (node, env) {
    var op = node.op;
    var a = this.eval(node.left, env);
    var b = this.eval(node.right, env);

    if ((a === null || b === null) && op !== "==" && op !== "!=") {
      throw new GError({
        code: "E3010", message: "「空」不能参与「" + op + "」运算",
        hint: "如果这个值来自「输入」，说明右下角输入区里的行已经用完了——每个「输入」占一行，先往里填值再运行",
        line: node.line, col: node.col, len: op.length
      });
    }

    if (op === "+") {
      if (typeof a === "string" || typeof b === "string") return toText(a) + toText(b);
    }

    if (op === "==" || op === "!=") {
      var eq;
      if (isNum(a) && isNum(b)) eq = numv(a) === numv(b);
      else if (typeof a === "string" && typeof b === "string") eq = a === b;
      else if (typeof a === "boolean" && typeof b === "boolean") eq = a === b;
      else if (a === null && b === null) eq = true;
      else eq = (a === b);
      return op === "==" ? eq : !eq;
    }

    if (op === ">" || op === "<" || op === ">=" || op === "<=") {
      if (!(isNum(a) && isNum(b)) && !(typeof a === "string" && typeof b === "string")) {
        throw new GError({
          code: "E3009", message: "「" + op + "」不能比较「" + typeName(a) + "」和「" + typeName(b) + "」",
          hint: "大小比较只能用在两个数字或两个文本之间",
          line: node.line, col: node.col, len: op.length
        });
      }
      var x = isNum(a) ? numv(a) : a, y = isNum(b) ? numv(b) : b;
      if (op === ">") return x > y;
      if (op === "<") return x < y;
      if (op === ">=") return x >= y;
      return x <= y;
    }

    if (!isNum(a) || !isNum(b)) {
      throw new GError({
        code: "E3009", message: "「" + op + "」不支持「" + typeName(a) + "」和「" + typeName(b) + "」",
        hint: op === "+" ? "文本拼接请用「连接(a, b)」；列表拼接请用「合并」" : "把两侧都换成数字再算",
        line: node.line, col: node.col, len: op.length
      });
    }

    var na = numv(a), nb = numv(b);
    var floatA = a instanceof GF, floatB = b instanceof GF;

    if (op === "/") {
      if (nb === 0) throw new GError({ code: "E3003", message: "不能除以零", hint: "先判断除数是不是 0，再除", line: node.line, col: node.col, len: 1 });
      return new GF(na / nb);
    }
    if (op === "//") {
      if (nb === 0) throw new GError({ code: "E3003", message: "不能除以零", hint: "先判断除数是不是 0，再整除", line: node.line, col: node.col, len: 2 });
      return Math.floor(na / nb);
    }
    if (op === "%") {
      if (nb === 0) throw new GError({ code: "E3003", message: "不能除以零", hint: "取余的除数也不能是 0", line: node.line, col: node.col, len: 1 });
      var r = na % nb;
      if (r !== 0 && (r < 0) !== (nb < 0)) r += nb;
      return r;
    }
    if (op === "**") {
      var p = Math.pow(na, nb);
      if (floatA || floatB || p % 1 !== 0) return new GF(p);
      return p;
    }

    var res = op === "+" ? na + nb : op === "-" ? na - nb : na * nb;
    if (floatA || floatB) return new GF(res);
    return res;
  };

  Interp.prototype.evalIndex = function (node, env) {
    var obj = this.eval(node.obj, env);
    var key = this.eval(node.index, env);

    if (Array.isArray(obj)) {
      var i = this.toIndex(key, obj.length, { line: node.line, col: node.col });
      return obj[i];
    }
    if (typeof obj === "string") {
      var chars = Array.from(obj);
      var j = this.toIndex(key, chars.length, { line: node.line, col: node.col });
      return chars[j];
    }
    if (obj instanceof GDict) {
      if (!obj.m.has(key)) {
        throw new GError({
          code: "E3005", message: "字典里没有「" + toText(key) + "」这个键",
          hint: "先判断「包含(字典, \"键\")」，或者用「取(字典, \"键\", 默认值)」给个兜底",
          line: node.line, col: node.col, len: 1
        });
      }
      return obj.m.get(key);
    }
    if (obj instanceof GError) {
      throw new GError({ code: "E3205", message: "错误对象不能取下标", hint: "用「错误信息 / 错误代码」这些函数读它", line: node.line, col: node.col, len: 1 });
    }
    throw new GError({
      code: "E3002", message: "「" + typeName(obj) + "」没有下标",
      hint: "只有列表、文本、字典能取下标",
      line: node.line, col: node.col, len: 1
    });
  };

  function clampSlice(range, len) {
    var s = range[0], e = range[1];
    if (s === null) s = 0;
    if (e === null) e = len;
    if (s < 0) s = Math.max(0, len + s);
    if (e < 0) e = Math.max(0, len + e);
    s = Math.min(Math.max(0, s), len);
    e = Math.min(Math.max(0, e), len);
    if (e < s) e = s;
    return [s, e];
  }

  Interp.prototype.evalSlice = function (node, env) {
    var obj = this.eval(node.obj, env);
    var s = node.start ? numv(this.eval(node.start, env)) : null;
    var e = node.end ? numv(this.eval(node.end, env)) : null;

    if (Array.isArray(obj)) {
      var r = clampSlice([s, e], obj.length);
      return obj.slice(r[0], r[1]);
    }
    if (typeof obj === "string") {
      var chars = Array.from(obj);
      var r2 = clampSlice([s, e], chars.length);
      return chars.slice(r2[0], r2[1]).join("");
    }
    throw new GError({
      code: "E3002", message: "「" + typeName(obj) + "」不能切片",
      hint: "切片只能用在列表和文本上，例如 数据[1:3]",
      line: node.line, col: node.col, len: 1
    });
  };

  Interp.prototype.evalCall = function (node, env) {
    var callee = this.eval(node.callee, env);
    var args = node.args.map(function (a) { return this.eval(a, env); }, this);
    return this.callValue(callee, args, node);
  };

  Interp.prototype.callValue = function (fn, args, node) {
    if (fn instanceof GBuiltin) {
      try {
        return fn.fn.apply(this, args);
      } catch (e) {
        if (e instanceof GError) {
          if (!e.line && node) { e.line = node.line; e.col = node.col; }
          throw e;
        }
        throw e;
      }
    }
    if (!(fn instanceof GFunc)) {
      throw new GError({
        code: "E3006", message: "「" + typeName(fn) + "」不是函数，不能调用",
        hint: "只有函数后面能写括号。检查是不是把变量名写错了",
        line: node.line, col: node.col, len: 1
      });
    }

    var def = fn.def;
    if (++this.depth > 800) {
      this.depth--;
      throw new GError({
        code: "E3008", message: "递归太深了（超过 800 层）",
        hint: "检查递归有没有出口；正式版 G-Lang 的上限是 2000 层",
        line: node.line, col: node.col, len: 1
      });
    }

    var callEnv = new Env("function", def.closure);
    callEnv.def("__self__", fn);

    var ai = 0;
    for (var i = 0; i < def.params.length; i++) {
      var p = def.params[i];
      var val;
      if (p.variadic) {
        val = args.slice(ai);
        ai = args.length;
      } else if (ai < args.length) {
        val = args[ai++];
      } else if (p.def) {
        val = this.eval(p.def, callEnv);
      } else {
        throw new GError({
          code: "E3007",
          message: "参数个数不对：函数需要 " + def.params.length + " 个，给了 " + args.length + " 个",
          hint: "检查调用时括号里的参数个数；有「默认」值的参数可以省略",
          line: node.line, col: node.col, len: 1
        });
      }
      if (p.type && !this.checkType(val, p.type, { line: node.line, col: node.col })) {
        throw new GError({
          code: "E3201", message: "参数「" + p.name + "」要的是「" + p.type + "」，给的是「" + typeName(val) + "」",
          hint: "调用时把这个参数换成 " + p.type + " 类型的值",
          line: node.line, col: node.col, len: 1
        });
      }
      callEnv.def(p.name, val);
    }

    if (ai < args.length) {
      throw new GError({
        code: "E3007",
        message: "参数个数不对：函数需要 " + def.params.length + " 个，给了 " + args.length + " 个",
        hint: "多了就往回收一收；想接任意多个，就把参数写成「名字...」",
        line: node.line, col: node.col, len: 1
      });
    }

    try {
      this.execBlock(def.body, callEnv);
      return null;
    } catch (e) {
      if (e instanceof ReturnSignal) {
        var rv = e.v;
        if (def.retType && !this.checkType(rv, def.retType, { line: node.line, col: node.col })) {
          throw new GError({
            code: "E3201", message: "返回值要的是「" + def.retType + "」，实际是「" + typeName(rv) + "」",
            hint: "函数的返回类型标注和「返回」的值要对上",
            line: node.line, col: node.col, len: 1
          });
        }
        return rv;
      }
      throw e;
    } finally {
      this.depth--;
    }
  };

  /* ---------------- 内置函数 ---------------- */

  function needList(v, fname) {
    if (!Array.isArray(v)) {
      throw new GError({ code: "E3002", message: fname + " 需要列表，给的是「" + typeName(v) + "」", hint: "第一个参数传一个列表，例如 [1, 2, 3]" });
    }
    return v;
  }
  function needDict(v, fname) {
    if (!(v instanceof GDict)) {
      throw new GError({ code: "E3002", message: fname + " 需要字典，给的是「" + typeName(v) + "」", hint: "第一个参数传一个字典，例如 {\"甲\": 1}" });
    }
    return v;
  }
  function needStr(v, fname) {
    if (typeof v !== "string") {
      throw new GError({ code: "E3002", message: fname + " 需要文本，给的是「" + typeName(v) + "」", hint: "用「转文本(x)」先把它变成文本" });
    }
    return v;
  }
  function needNum(v, fname) {
    if (!isNum(v)) {
      throw new GError({ code: "E3002", message: fname + " 需要数字，给的是「" + typeName(v) + "」", hint: "用「转小数(x)」先把它变成数字" });
    }
    return numv(v);
  }

  Interp.prototype.installBuiltins = function (env) {
    var self = this;
    var B = {};
    function def(name, fn) { B[name] = fn; }

    /* 数学 */
    def("绝对值", function (x) { var n = needNum(x, "绝对值"); return isF(x) ? new GF(Math.abs(n)) : Math.abs(n); });
    def("向下取整", function (x) { return Math.floor(needNum(x, "向下取整")); });
    def("向上取整", function (x) { return Math.ceil(needNum(x, "向上取整")); });
    def("四舍五入", function (x) { return Math.round(needNum(x, "四舍五入")); });
    def("开方", function (x) {
      var n = needNum(x, "开方");
      if (n < 0) throw new GError({ code: "E3003", message: "负数不能开方", hint: "开方前先判断「如果 x 大于等于 0」" });
      return new GF(Math.sqrt(n));
    });
    def("幂", function (a, b) {
      var p = Math.pow(needNum(a, "幂"), needNum(b, "幂"));
      return isF(a) || isF(b) || p % 1 !== 0 ? new GF(p) : p;
    });
    def("最大值", function () {
      var arr = Array.prototype.slice.call(arguments);
      if (arr.length === 1 && Array.isArray(arr[0])) arr = arr[0];
      return arr.reduce(function (m, v) { var n = needNum(v, "最大值"); return n > numv(m) ? v : m; });
    });
    def("最小值", function () {
      var arr = Array.prototype.slice.call(arguments);
      if (arr.length === 1 && Array.isArray(arr[0])) arr = arr[0];
      return arr.reduce(function (m, v) { var n = needNum(v, "最小值"); return n < numv(m) ? v : m; });
    });
    def("随机数", function (a, b) {
      var lo = Math.ceil(needNum(a, "随机数")), hi = Math.floor(needNum(b, "随机数"));
      return lo + Math.floor(Math.random() * (hi - lo + 1));
    });

    /* 文本 */
    def("长度", function (x) {
      if (typeof x === "string") return Array.from(x).length;
      if (Array.isArray(x)) return x.length;
      if (x instanceof GDict) return x.m.size;
      throw new GError({ code: "E3002", message: "长度() 只接受文本、列表、字典", hint: "给的是「" + typeName(x) + "」" });
    });
    def("截取", function (t, a, b) {
      var chars = Array.from(needStr(t, "截取"));
      var r = clampSlice([needNum(a, "截取"), needNum(b, "截取")], chars.length);
      return chars.slice(r[0], r[1]).join("");
    });
    def("查找", function (t, sub) { return needStr(t, "查找").indexOf(needStr(sub, "查找")); });
    def("替换", function (t, o, n) { return needStr(t, "替换").split(needStr(o, "替换")).join(needStr(n, "替换")); });
    def("分割", function (t, sep) {
      var s = needStr(t, "分割"), d = needStr(sep, "分割");
      return d === "" ? Array.from(s) : s.split(d);
    });
    def("合并", function (list, sep) {
      needList(list, "合并");
      var d = sep === undefined ? "" : toText(sep);
      return list.map(toText).join(d);
    });
    def("去空白", function (t) { return needStr(t, "去空白").replace(/^\s+|\s+$/g, ""); });
    def("大写", function (t) { return needStr(t, "大写").toUpperCase(); });
    def("小写", function (t) { return needStr(t, "小写").toLowerCase(); });

    /* 转换 */
    def("转整数", function (x) {
      if (typeof x === "number") return Math.trunc(x);
      if (x instanceof GF) return Math.trunc(x.v);
      if (typeof x === "string") {
        var s = x.replace(/^\s+|\s+$/g, "");
        if (/^-?\d+$/.test(s)) return parseInt(s, 10);
        if (/^-?\d*\.\d+$/.test(s)) return Math.trunc(parseFloat(s));
      }
      if (typeof x === "boolean") return x ? 1 : 0;
      throw new GError({ code: "E3002", message: "「" + toText(x) + "」转不成整数", hint: "只有长得像数字的文本才能转，例如 转整数(\"18\")" });
    });
    def("转小数", function (x) {
      if (isNum(x)) return new GF(numv(x));
      if (typeof x === "string") {
        var s = x.replace(/^\s+|\s+$/g, "");
        if (/^-?\d+(\.\d+)?$/.test(s)) return new GF(parseFloat(s));
      }
      throw new GError({ code: "E3002", message: "「" + toText(x) + "」转不成小数", hint: "只有长得像数字的文本才能转" });
    });
    def("转文本", function (x) { return toText(x); });
    def("转布尔", function (x) { return truthy(x); });

    /* 列表 */
    def("追加", function (l, v) { needList(l, "追加").push(v); return null; });
    def("插入", function (l, i, v) {
      needList(l, "插入");
      var n = Math.max(0, Math.min(l.length, needNum(i, "插入")));
      l.splice(n, 0, v);
      return null;
    });
    def("删除", function (l, i) {
      needList(l, "删除");
      var n = self.toIndex(i, l.length, { line: 0, col: 0 });
      return l.splice(n, 1)[0];
    });
    def("排序", function (l) {
      needList(l, "排序");
      l.sort(function (a, b) {
        if (isNum(a) && isNum(b)) return numv(a) - numv(b);
        if (typeof a === "string" && typeof b === "string") return a < b ? -1 : a > b ? 1 : 0;
        throw new GError({ code: "E3002", message: "排序要求列表里的元素类型一致", hint: "数字和文本不要混在一个列表里排序" });
      });
      return null;
    });
    def("反转", function (l) { needList(l, "反转").reverse(); return null; });
    def("求和", function (l) {
      needList(l, "求和");
      var s = 0, anyF = false;
      l.forEach(function (v) { if (v instanceof GF) anyF = true; s += needNum(v, "求和"); });
      return anyF ? new GF(s) : s;
    });
    def("包含", function (c, v) {
      if (Array.isArray(c)) return c.some(function (x) { return toText(x) === toText(v) || x === v; });
      if (typeof c === "string") return c.indexOf(needStr(v, "包含")) !== -1;
      if (c instanceof GDict) return c.m.has(v);
      throw new GError({ code: "E3002", message: "包含() 只接受列表、文本、字典", hint: "给的是「" + typeName(c) + "」" });
    });
    def("清空", function (l) { needList(l, "清空").length = 0; return null; });

    /* 输出与拼接 */
    def("换行", function () { self.emit("", true); return null; });
    def("连接", function () {
      return Array.prototype.slice.call(arguments).map(toText).join("");
    });

    /* 其他 */
    def("当前时间", function () {
      var d = new Date();
      var p = function (n) { return (n < 10 ? "0" : "") + n; };
      return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " +
        p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds());
    });
    def("延时", function () { return null; });
    def("停止", function () { throw new StopSignal(); });

    /* 类型 */
    def("类型", function (x) { return typeName(x); });
    def("是整数", function (x) { return typeName(x) === "整数"; });
    def("是小数", function (x) { return typeName(x) === "小数"; });
    def("是文本", function (x) { return typeName(x) === "文本"; });
    def("是布尔", function (x) { return typeName(x) === "布尔"; });
    def("是列表", function (x) { return typeName(x) === "列表"; });
    def("是字典", function (x) { return typeName(x) === "字典"; });
    def("是函数", function (x) { return typeName(x) === "函数"; });
    def("是空", function (x) { return x === null; });

    /* 容器 */
    def("取", function (c, k, dv) {
      if (Array.isArray(c)) {
        var n = numv(k);
        if (typeof n === "number" && Number.isInteger(n)) {
          var i = n < 0 ? c.length + n : n;
          if (i >= 0 && i < c.length) return c[i];
        }
        return dv === undefined ? null : dv;
      }
      if (c instanceof GDict) return c.m.has(k) ? c.m.get(k) : (dv === undefined ? null : dv);
      if (typeof c === "string") {
        var chars = Array.from(c);
        var m = numv(k);
        if (typeof m === "number" && m >= 0 && m < chars.length) return chars[m];
        return dv === undefined ? null : dv;
      }
      throw new GError({ code: "E3002", message: "取() 只接受列表、字典、文本", hint: "给的是「" + typeName(c) + "」" });
    });
    def("切片", function (c, a, b) {
      var arr = Array.isArray(c) ? c : Array.from(needStr(c, "切片"));
      var r = clampSlice([a === undefined ? null : numv(a), b === undefined ? null : numv(b)], arr.length);
      var out = arr.slice(r[0], r[1]);
      return Array.isArray(c) ? out : out.join("");
    });
    def("键列表", function (d) { var out = []; needDict(d, "键列表").m.forEach(function (v, k) { out.push(k); }); return out; });
    def("值列表", function (d) { var out = []; needDict(d, "值列表").m.forEach(function (v) { out.push(v); }); return out; });
    def("合并字典", function () {
      var out = new GDict();
      Array.prototype.slice.call(arguments).forEach(function (d) {
        needDict(d, "合并字典").m.forEach(function (v, k) { out.m.set(k, v); });
      });
      return out;
    });
    def("去重", function (l) {
      needList(l, "去重");
      var seen = new Set(), out = [];
      l.forEach(function (v) { var k = typeName(v) + ":" + inspect(v); if (!seen.has(k)) { seen.add(k); out.push(v); } });
      return out;
    });
    def("展平", function (l) {
      needList(l, "展平");
      var out = [];
      l.forEach(function (v) { if (Array.isArray(v)) v.forEach(function (x) { out.push(x); }); else out.push(v); });
      return out;
    });

    /* 高阶 */
    function each(list, fname) { return needList(list, fname); }
    def("映射", function (l, f) { return each(l, "映射").map(function (v) { return self.callValue(f, [v], { line: 0, col: 0 }); }); });
    def("过滤", function (l, f) { return each(l, "过滤").filter(function (v) { return truthy(self.callValue(f, [v], { line: 0, col: 0 })); }); });
    def("归约", function (l, f, init) {
      each(l, "归约");
      var acc = init === undefined ? null : init;
      for (var i = 0; i < l.length; i++) acc = self.callValue(f, [acc, l[i]], { line: 0, col: 0 });
      return acc;
    });
    def("任一", function (l, f) { return each(l, "任一").some(function (v) { return truthy(self.callValue(f, [v], { line: 0, col: 0 })); }); });
    def("全部", function (l, f) { return each(l, "全部").every(function (v) { return truthy(self.callValue(f, [v], { line: 0, col: 0 })); }); });
    def("计数满足", function (l, f) { return each(l, "计数满足").filter(function (v) { return truthy(self.callValue(f, [v], { line: 0, col: 0 })); }).length; });
    def("查找首个", function (l, f) {
      each(l, "查找首个");
      for (var i = 0; i < l.length; i++) if (truthy(self.callValue(f, [l[i]], { line: 0, col: 0 }))) return l[i];
      return null;
    });
    def("按函数排序", function (l, f) {
      each(l, "按函数排序");
      l.sort(function (a, b) { return truthy(self.callValue(f, [a, b], { line: 0, col: 0 })) ? -1 : 1; });
      return null;
    });

    /* 错误对象 */
    def("错误信息", function (e) { if (!(e instanceof GError)) throw new GError({ code: "E3002", message: "错误信息() 需要错误对象", hint: "传「捕获」后面那个变量" }); return e.message; });
    def("错误代码", function (e) { if (!(e instanceof GError)) throw new GError({ code: "E3002", message: "错误代码() 需要错误对象", hint: "传「捕获」后面那个变量" }); return e.code || "E4001"; });
    def("错误提示", function (e) { if (!(e instanceof GError)) throw new GError({ code: "E3002", message: "错误提示() 需要错误对象", hint: "传「捕获」后面那个变量" }); return e.hint || ""; });
    def("错误行号", function (e) { if (!(e instanceof GError)) throw new GError({ code: "E3002", message: "错误行号() 需要错误对象", hint: "传「捕获」后面那个变量" }); return e.line || 0; });
    def("错误调用栈", function (e) { if (!(e instanceof GError)) throw new GError({ code: "E3002", message: "错误调用栈() 需要错误对象", hint: "传「捕获」后面那个变量" }); return e.stack.slice(); });
    def("断言", function (cond, msg) {
      if (!truthy(cond)) {
        throw new GError({ code: "E4002", message: msg === undefined ? "断言失败" : toText(msg), hint: "断言不成立说明前面的假设错了，检查传进来的值" });
      }
      return null;
    });

    Object.keys(B).forEach(function (name) {
      env.def(name, new GBuiltin(name, B[name]));
    });
  };

  /* ---------------- 报错排版 ---------------- */

  function displayWidth(s) {
    var w = 0;
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      var wide = (c >= 0x1100 && c <= 0x115f) || (c >= 0x2e80 && c <= 0xa4cf) ||
        (c >= 0xac00 && c <= 0xd7a3) || (c >= 0xf900 && c <= 0xfaff) ||
        (c >= 0xfe30 && c <= 0xfe4f) || (c >= 0xff00 && c <= 0xff60) || (c >= 0xffe0 && c <= 0xffe6);
      w += wide ? 2 : 1;
    }
    return w;
  }

  function renderError(err, lines) {
    var lineNo = err.line || 1;
    var srcLine = lines[lineNo - 1] === undefined ? "" : lines[lineNo - 1];
    var gutter = String(lineNo);
    var pad = " ".repeat(gutter.length);

    var head = "第 " + lineNo + " 行：" + err.message + (err.code ? "  [" + err.code + "]" : "");
    var out = [];
    out.push(head);
    out.push(" " + gutter + " | " + srcLine);

    if (err.col && err.col > 0) {
      var before = srcLine.slice(0, Math.max(0, err.col - 1));
      var indent = displayWidth(before);
      var tokenText = srcLine.slice(Math.max(0, err.col - 1), Math.max(0, err.col - 1) + (err.len || 1));
      var caretLen = Math.max(1, displayWidth(tokenText));
      out.push(" " + pad + " | " + " ".repeat(indent) + "^".repeat(caretLen));
    }
    if (err.hint) out.push("提示：" + err.hint);
    return out.join("\n");
  }

  /* ---------------- 对外接口 ---------------- */

  function run(source, options) {
    options = options || {};
    var lines = normalizeSource(source).split("\n");
    var interp = new Interp(source, options.stdin || "");
    try {
      var output = interp.run();
      return { ok: true, output: output, error: null, steps: interp.steps, lines: lines };
    } catch (e) {
      interp.flush();
      var partial = interp.out.join("\n");
      if (e instanceof StopSignal) {
        return { ok: true, output: partial, error: null, stopped: true, steps: interp.steps, lines: lines };
      }
      if (e instanceof GError) {
        if (!e.line) e.line = 1;
        return { ok: false, output: partial, error: e, errorText: renderError(e, lines), steps: interp.steps, lines: lines };
      }
      if (e instanceof BreakSignal || e instanceof ContinueSignal) {
        var ge = new GError({
          code: "E2004", message: "「跳出」或「继续」不在循环里",
          hint: "它们只能写在 重复 / 当 / 遍历 的块内部", line: 1, col: 1, len: 1
        });
        return { ok: false, output: partial, error: ge, errorText: renderError(ge, lines), steps: interp.steps, lines: lines };
      }
      if (e instanceof ReturnSignal) {
        var ge2 = new GError({ code: "E2002", message: "「返回」不在函数里", hint: "把这段代码放进「函数 … 结束」里", line: 1, col: 1, len: 1 });
        return { ok: false, output: partial, error: ge2, errorText: renderError(ge2, lines), steps: interp.steps, lines: lines };
      }
      var ge3 = new GError({ code: "", message: "解释器内部出错：" + (e && e.message ? e.message : String(e)), hint: "换一段代码试试；如果每次都这样，说明演练场还不支持这个写法", line: 1, col: 1, len: 1 });
      return { ok: false, output: partial, error: ge3, errorText: renderError(ge3, lines), steps: interp.steps, lines: lines };
    }
  }

  global.GLang = { run: run, tokenize: tokenize, normalizeSource: normalizeSource };
})(typeof window !== "undefined" ? window : globalThis);
