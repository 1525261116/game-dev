#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把浏览器另存的语雀页面抽取成干净的 Markdown。"""
import re
import sys
from html.parser import HTMLParser

SRC = sys.argv[1] if len(sys.argv) > 1 else "AI开发游戏保姆级教程.html"
OUT = sys.argv[2] if len(sys.argv) > 2 else "AI开发游戏保姆级教程.md"

raw = open(SRC, encoding="utf-8", errors="ignore").read()
i = raw.find('<article id="content"')
j = raw.find("</article>", i)
body = raw[i:j]

# 只在正文范围内截断，去掉点赞/评论等尾部模块
cut = body.find('article-content-reward')
if cut > 0:
    body = body[:cut]
cut2 = body.find('<div class="like-module')
if cut2 > 0:
    body = body[:cut2]

# 预处理
body = re.sub(r"<script\b.*?</script>", "", body, flags=re.S)
body = re.sub(r"<style\b.*?</style>", "", body, flags=re.S)
body = re.sub(r"<svg\b.*?</svg>", "", body, flags=re.S)
body = re.sub(r"<button\b.*?</button>", "", body, flags=re.S)
body = re.sub(r"<!--.*?-->", "", body, flags=re.S)
body = re.sub(r"<ne-heading-ext\b.*?</ne-heading-ext>", "", body, flags=re.S)
body = re.sub(r"<span class=\"ne-viewer-b-filler\"[^>]*>\s*<br/?>\s*</span>", "<br/>", body)
# 去掉图片上的 OCR 浮层文字与 UI 浮层
body = re.sub(r"<div class=\"ne-ui-image-ocr-text\"[^>]*>.*?</div>", "", body, flags=re.S)
body = re.sub(r"<div class=\"ne-ui-[^\"]*\"[^>]*></div>", "", body)

HEAD = {"ne-h1": "#", "ne-h2": "##", "ne-h3": "###", "ne-h4": "####",
        "h1": "#", "h2": "##", "h3": "###", "h4": "####"}
SKIP_TAGS = {"ne-heading-anchor", "ne-heading-fold", "ne-heading-ext"}


class MD(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.out = []
        self.link_buf = None      # (href, [text...])
        self.in_td = False
        self.cells = []
        self.rows = []
        self.alert_depth = 0

    def q(self):
        if self.alert_depth:
            self.w("> ")

    def w(self, s):
        if s:
            self.out.append(s)

    def blank(self, n=1):
        txt = "".join(self.out)
        want = "\n" * n
        if not txt:
            return
        if not txt.endswith("\n"):
            self.w("\n")
        tail = txt[len(txt.rstrip("\n")):]
        need = n - len(tail)
        if need > 0:
            self.w("\n" * need)

    def cur_line(self):
        return "".join(self.out).rsplit("\n", 1)[-1]

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        cls = a.get("class", "")

        if tag in SKIP_TAGS:
            return

        if tag in HEAD:
            self.blank(2)
            self.q()
            self.w(HEAD[tag] + " ")
        elif tag == "ne-p":
            self.blank(1)
            self.q()
        elif tag == "br":
            self.w("\n")
            self.q()
        elif tag == "ne-alert":
            self.blank(2)
            self.alert_depth += 1
            self.q()
        elif tag == "img":
            src = a.get("src", "")
            if src.lower().endswith((".ico",)) or "bookmark-icon" in cls or "NONE" in cls:
                return
            alt = a.get("alt", "")
            self.w("\n\n![%s](%s)\n\n" % (alt, src))
        elif tag == "a":
            href = a.get("href", "")
            self.link_buf = (href, [])
        elif tag == "ne-table":
            self.blank(2)
            self.rows = []
        elif tag == "ne-tr":
            self.cells = []
        elif tag == "ne-td":
            self.in_td = True
            self.cells.append([])
        elif tag == "ne-codeblock":
            self.blank(2)
            self.w("```\n")
        elif tag == "li":
            self.blank(1)
            self.w("- ")
        elif tag in ("strong", "b"):
            self.w("**")
        elif tag in ("em", "i"):
            self.w("*")
        elif tag == "code":
            self.w("`")

    def handle_endtag(self, tag):
        if tag in SKIP_TAGS:
            return

        if tag in HEAD:
            self.w("\n")
        elif tag == "ne-p":
            self.w("\n")
        elif tag == "ne-alert":
            self.blank(2)
            self.alert_depth = max(0, self.alert_depth - 1)
        elif tag == "a":
            if self.link_buf is not None:
                href, txt = self.link_buf
                label = "".join(txt).strip() or href
                self.w("[%s](%s)" % (label, href))
                self.link_buf = None
        elif tag == "ne-tr":
            self.rows.append([("".join(c).strip().replace("\n", " ")) for c in self.cells])
        elif tag == "ne-td":
            self.in_td = False
        elif tag == "ne-table":
            if self.rows:
                self.w("\n")
                self.w("| " + " | ".join(self.rows[0]) + " |\n")
                self.w("| " + " | ".join("---" for _ in self.rows[0]) + " |\n")
                for r in self.rows[1:]:
                    self.w("| " + " | ".join(r) + " |\n")
                self.w("\n")
        elif tag == "ne-codeblock":
            self.w("\n```\n")
        elif tag in ("strong", "b"):
            self.w("**")
        elif tag in ("em", "i"):
            self.w("*")
        elif tag == "code":
            self.w("`")

    def handle_data(self, data):
        if self.link_buf is not None:
            self.link_buf[1].append(data)
            return
        if self.in_td and self.cells:
            self.cells[-1].append(data)
            return
        self.w(data)


BLOCK_PREFIX = ""  # unused

# 生成 Markdown
p = MD()
p.feed(body)
text = "".join(p.out)

# 去掉空标题（如 "##" 单独一行）
text = re.sub(r"^#{1,6}\s*$", "", text, flags=re.M)
# 去掉只有 ">" 或 "> " 的行
text = re.sub(r"^>\s*$", "", text, flags=re.M)
# 压缩多余空行
text = re.sub(r"[ \t]+\n", "\n", text)
text = re.sub(r"\n{3,}", "\n\n", text)
text = text.strip() + "\n"

header = (
    "# AI开发游戏保姆级教程\n\n"
    "> 来源：语雀 · https://www.yuque.com/zeejk/kt12r4/moryiawbo9ftweqv\n"
    "> 抓取时间：2026-10-11\n\n---\n\n"
)
text = header + text

open(OUT, "w", encoding="utf-8").write(text)
print("wrote", OUT, len(text), "chars")
