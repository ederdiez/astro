(function () {
  "use strict";

  var notes = new Set();

  function setNotes(files) {
    notes = new Set();
    files.forEach(function (f) {
      notes.add(f);
      if (f.endsWith(".md")) {
        notes.add(f.slice(0, -3));
        notes.add(f.split("/").pop().slice(0, -3));
      }
    });
  }

  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function isBlank(s) {
    return !s.trim();
  }

  function hid(marker, shown, cls) {
    return (
      '<span class="lp-mk' +
      (shown ? " show" : "") +
      (cls ? " lp-" + cls : "") +
      '">' +
      esc(marker) +
      "</span>"
    );
  }

  var CONTAINERS = ["lp-quote", "lp-list", "lp-code", "lp-table"];

  function isContainerClass(cls) {
    for (var i = 0; i < CONTAINERS.length; i++) {
      if (cls.contains(CONTAINERS[i])) return true;
    }
    return false;
  }

  // ---------- inline ----------

  function inlineOut(md, lineStart, caret, allShown) {
    var out = "";
    var i = 0;
    var n = md.length;
    var abs = function (p) {
      return lineStart + p;
    };
    var shown = function (a, b) {
      return allShown || (caret >= a && caret < b);
    };

    while (i < n) {
      var rest = md.slice(i);

      if (md[i] === "\\" && i + 1 < n && "*_~`[|#".indexOf(md[i + 1]) !== -1) {
        out += esc(md[i + 1]);
        i += 2;
        continue;
      }

      var code = /^`([^`\n]+?)`/.exec(rest);
      if (code) {
        var a = abs(i);
        var b = abs(i + code[0].length);
        var sh = shown(a, b);
        out +=
          '<code class="lp-code">' +
          hid("`", sh) +
          esc(code[1]) +
          hid("`", sh) +
          "</code>";
        i += code[0].length;
        continue;
      }

      var wl = /^\[\[([^\]\n]*?)\]\]/.exec(rest);
      if (wl) {
        var a = abs(i);
        var b = abs(i + wl[0].length);
        var sh = shown(a, b);
        var target = wl[1].trim();
        var dead = !(notes.has(target) || notes.has(target + ".md"));
        out +=
          '<span class="lp-wikilink' +
          (dead ? " lp-dead" : "") +
          '" data-note="' +
          esc(target) +
          '">' +
          hid("[[", sh) +
          esc(wl[1]) +
          hid("]]", sh) +
          "</span>";
        i += wl[0].length;
        continue;
      }

      var link = /^\[([^\]\n]*?)\]\(([^)\n]*)\)/.exec(rest);
      if (link) {
        var a = abs(i);
        var b = abs(i + link[0].length);
        var sh = shown(a, b);
        out +=
          '<span class="lp-link" data-url="' +
          esc(link[2].trim()) +
          '">' +
          hid("[", sh) +
          esc(link[1]) +
          hid("](", sh) +
          hid(link[2].trim(), sh, "url") +
          hid(")", sh) +
          "</span>";
        i += link[0].length;
        continue;
      }

      var img = /^!\[([^\]\n]*?)\]\(([^)\n]*)\)/.exec(rest);
      if (img) {
        var a = abs(i);
        var b = abs(i + img[0].length);
        var sh = shown(a, b);
        out +=
          '<span class="lp-link" data-url="' +
          esc(img[2].trim()) +
          '">' +
          hid("!", sh) +
          hid("[", sh) +
          esc(img[1]) +
          hid("](", sh) +
          hid(img[2].trim(), sh, "url") +
          hid(")", sh) +
          "</span>";
        i += img[0].length;
        continue;
      }

      var st = /^~~([^\n]+?)~~/.exec(rest);
      if (st) {
        var a = abs(i);
        var b = abs(i + st[0].length);
        var sh = shown(a, b);
        var cs = abs(i + st[0].length - st[1].length);
        out +=
          "<del>" +
          hid("~~", sh) +
          inlineOut(st[1], cs, caret, sh) +
          hid("~~", sh) +
          "</del>";
        i += st[0].length;
        continue;
      }

      var bt = /^(\*\*\*|___)([^\n]+?)\1/.exec(rest);
      if (bt) {
        var a = abs(i);
        var b = abs(i + bt[0].length);
        var sh = shown(a, b);
        var cs = abs(i + bt[0].length - bt[2].length);
        out +=
          "<strong><em>" +
          hid(bt[1], sh) +
          inlineOut(bt[2], cs, caret, sh) +
          hid(bt[1], sh) +
          "</em></strong>";
        i += bt[0].length;
        continue;
      }

      var b2 = /^(\*\*|__)([^\n]+?)\1/.exec(rest);
      if (b2) {
        var a = abs(i);
        var b = abs(i + b2[0].length);
        var sh = shown(a, b);
        var cs = abs(i + b2[0].length - b2[2].length);
        out +=
          "<strong>" +
          hid(b2[1], sh) +
          inlineOut(b2[2], cs, caret, sh) +
          hid(b2[1], sh) +
          "</strong>";
        i += b2[0].length;
        continue;
      }

      var em = null;
      if (md[i] === "*") {
        em = /^\*([^\n*]+?)\*/.exec(rest);
      } else if (md[i] === "_") {
        var before = i > 0 ? md[i - 1] : " ";
        if (!/[A-Za-z0-9]/.test(before)) {
          em = /^_([^\n_]+?)_(?![A-Za-z0-9])/.exec(rest);
        }
      }
      if (em) {
        var a = abs(i);
        var b = abs(i + em[0].length);
        var sh = shown(a, b);
        var cs = abs(i + em[0].length - em[1].length);
        out +=
          "<em>" +
          hid(em[0][0], sh) +
          inlineOut(em[1], cs, caret, sh) +
          hid(em[0][0], sh) +
          "</em>";
        i += em[0].length;
        continue;
      }

      out += esc(md[i]);
      i++;
    }
    return out;
  }

  // ---------- blocks ----------

  function liveRender(md, caret) {
    caret = typeof caret === "number" ? caret : -1;
    md = (md || "").replace(/\r\n?/g, "\n");
    var lines = md.split("\n");
    var offs = [];
    var acc = 0;
    var k;
    for (k = 0; k < lines.length; k++) {
      offs.push(acc);
      acc += lines[k].length + 1;
    }
    var L = lines.length;
    var inCaret = function (a, b) {
      return caret >= a && caret < b;
    };
    var isSep = function (s) {
      return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(s);
    };

    function lineEl(cls, inner) {
      return '<div class="lp-line ' + cls + '">' + inner + "</div>";
    }

    var out = "";
    var i = 0;

    while (i < L) {
      var line = lines[i];
      var start = offs[i];
      var end = start + line.length;

      if (isBlank(line)) {
        out += lineEl("lp-blank", "");
        i++;
        continue;
      }

      // ---- fenced code ----
      var fence = /^```+(\S*)\s*$/.exec(line);
      if (fence) {
        var j = i + 1;
        while (j < L && !/^```+\s*$/.test(lines[j])) j++;
        var closed = j < L;
        var bStart = start;
        var bEnd = closed
          ? offs[j] + lines[j].length
          : offs[L - 1] + lines[L - 1].length;
        var sh = inCaret(bStart, bEnd + 1);
        var bt = /^```+/.exec(line)[0];
        var lang = line.slice(bt.length).trim();
        var c =
          lineEl(
            "lp-codeline lp-code-open",
            hid(bt, sh) +
              '<span class="lp-code-lang' +
              (sh ? " show" : "") +
              '">' +
              esc(lang) +
              "</span>"
          );
        for (var bi = i + 1; bi < (closed ? j : L); bi++) {
          c += lineEl("lp-codeline", esc(lines[bi]));
        }
        if (closed) {
          c += lineEl("lp-codeline lp-code-close", hid(lines[j].trim(), sh));
        }
        out += '<div class="lp-code">' + c + "</div>";
        i = closed ? j + 1 : L;
        continue;
      }

      // ---- heading ----
      var hd = /^(#{1,6})[ \t]+(.*)$/.exec(line);
      if (hd) {
        var lvl = hd[1].length;
        var sh = inCaret(start, end + 1);
        var cs = start + hd[0].length - hd[2].length;
        out += lineEl(
          "lp-h lp-h" + lvl,
          hid(hd[1] + " ", sh) + inlineOut(hd[2], cs, caret)
        );
        i++;
        continue;
      }

      // ---- horizontal rule ----
      var hr = /^(-{3,}|\*{3,}|_{3,})\s*$/.exec(line);
      if (hr) {
        var sh = inCaret(start, end + 1);
        out += lineEl("lp-hr" + (sh ? " edit" : ""), hid(line.trim(), sh));
        i++;
        continue;
      }

      // ---- blockquote ----
      if (/^[ \t]*>/.test(line)) {
        var j = i;
        var rows = [];
        while (j < L && /^[ \t]*>/.test(lines[j])) {
          var l = lines[j];
          var m = /^([ \t]*)(>+[ \t]*)(.*)$/.exec(l);
          var prefix = m[2];
          var cs = offs[j] + m[1].length + prefix.length;
          rows.push({
            prefix: prefix,
            content: m[3],
            cs: cs,
            start: offs[j],
            end: offs[j] + l.length,
          });
          j++;
        }
        var sh = false;
        for (var r = 0; r < rows.length; r++) {
          if (inCaret(rows[r].start, rows[r].end + 1)) sh = true;
        }
        var c = "";
        for (var r = 0; r < rows.length; r++) {
          c += lineEl(
            "lp-qline",
            hid(rows[r].prefix, sh) + inlineOut(rows[r].content, rows[r].cs, caret)
          );
        }
        out += '<div class="lp-quote">' + c + "</div>";
        i = j;
        continue;
      }

      // ---- lists ----
      var om = /^([ \t]*)(\d+[.)])([ \t]+)(.*)$/.exec(line);
      var um = /^([ \t]*)([*+-])([ \t]+)(.*)$/.exec(line);
      if (om || um) {
        var isOl = !!om;
        var olRe = /^([ \t]*)(\d+[.)])([ \t]+)(.*)$/;
        var ulRe = /^([ \t]*)([*+-])([ \t]+)(.*)$/;
        var re = isOl ? olRe : ulRe;
        var j = i;
        var items = [];
        while (j < L) {
          var m = re.exec(lines[j]);
          if (!m) break;
          var cs = offs[j] + m[1].length + m[2].length + m[3].length;
          items.push({
            indent: m[1],
            marker: m[2],
            sep: m[3],
            content: m[4],
            cs: cs,
            start: offs[j],
            end: offs[j] + lines[j].length,
          });
          j++;
        }
        var sh = false;
        for (var r = 0; r < items.length; r++) {
          if (inCaret(items[r].start, items[r].end + 1)) sh = true;
        }
        var c = "";
        for (var r = 0; r < items.length; r++) {
          var it = items[r];
          if (isOl) {
            c += lineEl(
              "lp-li lp-ol",
              esc(it.indent) +
                '<span class="lp-num">' +
                esc(it.marker + it.sep) +
                "</span>" +
                inlineOut(it.content, it.cs, caret)
            );
          } else {
            c += lineEl(
              "lp-li",
              esc(it.indent) + hid(it.marker + it.sep, sh) + inlineOut(it.content, it.cs, caret)
            );
          }
        }
        out += '<div class="lp-list' + (sh ? " edit" : "") + '">' + c + "</div>";
        i = j;
        continue;
      }

      // ---- tables ----
      var tableStart =
        line.indexOf("|") !== -1 && i + 1 < L && isSep(lines[i + 1]);
      if (tableStart) {
        var j = i;
        var rows = [];
        while (j < L && !isBlank(lines[j]) && lines[j].indexOf("|") !== -1) {
          rows.push({ text: lines[j], start: offs[j], end: offs[j] + lines[j].length });
          j++;
        }
        var hasSep = false;
        for (var r = 0; r < rows.length; r++) {
          if (isSep(rows[r].text)) hasSep = true;
        }
        if (!hasSep) {
          out += lineEl("lp-p", inlineOut(line, start, caret));
          i++;
          continue;
        }
        var cellsByRow = [];
        for (var r = 0; r < rows.length; r++) {
          var parts = rows[r].text.split("|");
          var leadPipe = rows[r].text.charAt(0) === "|";
          var trailPipe = rows[r].text.charAt(rows[r].text.length - 1) === "|";
          var startIdx = leadPipe ? 1 : 0;
          var endIdx = trailPipe ? parts.length - 2 : parts.length - 1;
          var cells = [];
          var pacc = rows[r].start + (leadPipe ? 1 : 0);
          for (var ci = startIdx; ci <= endIdx; ci++) {
            cells.push({ text: parts[ci], at: pacc });
            pacc += parts[ci].length + 1;
          }
          cellsByRow.push({ lead: leadPipe, trail: trailPipe, cells: cells });
        }
        var ncol = 1;
        for (var r = 0; r < cellsByRow.length; r++) {
          ncol = Math.max(ncol, cellsByRow[r].cells.length);
        }
        var widths = [];
        for (var c2 = 0; c2 < ncol; c2++) {
          var w = 1;
          for (var r = 0; r < rows.length; r++) {
            if (isSep(rows[r].text)) continue;
            var cell = cellsByRow[r].cells[c2];
            if (cell) w = Math.max(w, cell.text.length);
          }
          widths.push(w);
        }
        var sh = false;
        for (var r = 0; r < rows.length; r++) {
          if (inCaret(rows[r].start, rows[r].end + 1)) sh = true;
        }
        var c = "";
        for (var r = 0; r < rows.length; r++) {
          var row = rows[r];
          var cr = cellsByRow[r];
          var isS = isSep(row.text);
          var cellsHtml = cr.lead ? hid("|", sh) : "";
          for (var c2 = 0; c2 < ncol; c2++) {
            var cell = cr.cells[c2] || { text: "", at: row.end };
            var content = isS
              ? hid(cell.text, sh)
              : inlineOut(cell.text, cell.at, caret);
            if (c2 < ncol - 1) content += hid("|", sh);
            cellsHtml +=
              '<span class="lp-tcell' +
              (isS ? " lp-tsep" : "") +
              '" style="width:' +
              (widths[c2] + 2) +
              'ch">' +
              content +
              "</span>";
          }
          cellsHtml += cr.trail ? hid("|", sh) : "";
          c +=
            '<div class="lp-line lp-trow' +
            (isS ? " lp-tsep" : "") +
            '">' +
            cellsHtml +
            "</div>";
        }
        out += '<div class="lp-table">' + c + "</div>";
        i = j;
        continue;
      }

      // ---- paragraph ----
      out += lineEl("lp-p", inlineOut(line, start, caret));
      i++;
    }

    return out;
  }

  // ---------- source & caret mapping ----------

  function nodeTextLen(node) {
    var n = 0;
    if (node.nodeType === Node.TEXT_NODE) return node.data.length;
    if (node.nodeType !== Node.ELEMENT_NODE) return 0;
    for (var c = 0; c < node.childNodes.length; c++) {
      var ch = node.childNodes[c];
      if (ch.nodeType === Node.TEXT_NODE) n += ch.data.length;
      else if (ch.nodeType === Node.ELEMENT_NODE) {
        if (ch.tagName === "BR") n += 1;
        else n += nodeTextLen(ch);
      }
    }
    return n;
  }

  function isLineLike(node, el) {
    return !!(
      node.classList &&
      (node.classList.contains("lp-line") ||
        (node.parentNode === el &&
          node.tagName === "DIV" &&
          !isContainerClass(node.classList)))
    );
  }

  function liveSource(el) {
    var out = "";
    function walk(node) {
      for (var c = 0; c < node.childNodes.length; c++) {
        var ch = node.childNodes[c];
        if (ch.nodeType === Node.TEXT_NODE) {
          out += ch.data;
          continue;
        }
        if (ch.nodeType !== Node.ELEMENT_NODE) continue;
        if (ch.tagName === "BR") {
          out += "\n";
          continue;
        }
        walk(ch);
        if (isLineLike(ch, el)) out += "\n";
      }
    }
    walk(el);
    return out.replace(/^\n+|\n+$/g, "");
  }

  function childCharLen(ch, el) {
    if (ch.nodeType === Node.TEXT_NODE) return ch.data.length;
    if (ch.nodeType !== Node.ELEMENT_NODE) return 0;
    if (ch.tagName === "BR") return 1;
    return nodeTextLen(ch) + (isLineLike(ch, el) ? 1 : 0);
  }

  function caretOffset(el) {
    var sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return 0;
    var r = sel.getRangeAt(0);
    if (!el.contains(r.startContainer)) return -1;
    if (r.startContainer === el) {
      var off = 0;
      for (var k = 0; k < r.startOffset; k++) {
        var ch = el.childNodes[k];
        if (!ch) continue;
        off += childCharLen(ch, el);
      }
      return off;
    }
    var target = r.startContainer;
    var tOff = r.startOffset;
    var acc = 0;
    function walk(node) {
      for (var c = 0; c < node.childNodes.length; c++) {
        var ch = node.childNodes[c];
        if (ch === target) {
          if (ch.nodeType === Node.TEXT_NODE) return acc + tOff;
          var pos = acc;
          for (var k2 = 0; k2 < tOff && k2 < ch.childNodes.length; k2++) {
            pos += childCharLen(ch.childNodes[k2], el);
          }
          return pos;
        }
        if (ch.nodeType === Node.TEXT_NODE) {
          acc += ch.data.length;
          continue;
        }
        if (ch.nodeType !== Node.ELEMENT_NODE) continue;
        if (ch.tagName === "BR") {
          acc += 1;
          continue;
        }
        var found = walk(ch);
        if (found !== null) return found;
        if (isLineLike(ch, el)) acc += 1;
      }
      return null;
    }
    var res = walk(el);
    return res === null ? acc : res;
  }

  function setCaret(el, offset) {
    offset = typeof offset === "number" && offset > 0 ? offset : 0;
    var lastText = null;

    function applyRange(r) {
      var s = window.getSelection();
      s.removeAllRanges();
      s.addRange(r);
    }
    function select(node, off) {
      var r = document.createRange();
      r.setStart(node, off);
      r.collapse(true);
      applyRange(r);
    }
    function selectEndOf(node) {
      var r = document.createRange();
      r.selectNodeContents(node);
      r.collapse(false);
      applyRange(r);
    }
    function selectEl() {
      var r = document.createRange();
      r.selectNodeContents(el);
      r.collapse(false);
      applyRange(r);
    }

    var pos = offset;

    function place(node) {
      for (var c = 0; c < node.childNodes.length; c++) {
        var ch = node.childNodes[c];
        if (ch.nodeType === Node.TEXT_NODE) {
          lastText = ch;
          if (pos <= ch.data.length) {
            select(ch, pos);
            return true;
          }
          pos -= ch.data.length;
        } else if (ch.nodeType === Node.ELEMENT_NODE) {
          if (ch.tagName === "BR") {
            if (pos === 0) {
              if (lastText) select(lastText, lastText.data.length);
              else selectEl();
              return true;
            }
            pos -= 1;
          } else {
            if (place(ch)) return true;
            if (isLineLike(ch, el)) {
              if (pos === 0) {
                selectEndOf(ch);
                return true;
              }
              pos -= 1;
            }
          }
        }
      }
      return false;
    }

    if (!place(el)) {
      if (lastText) select(lastText, lastText.data.length);
      else selectEl();
    }
  }

  window.LiveEditor = {
    render: liveRender,
    source: liveSource,
    caretOffset: caretOffset,
    setCaret: setCaret,
    setNotes: setNotes,
  };
})();
