#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
站点只读客户端。

唯一职责：通过 HTTPS 读取线上站点 www.wodewangpan.top 的公开内容并做匹配。
硬边界：
  - 只允许出站到 SITE_HOST 一个域名，代码里不提供任何其它地址的参数入口。
  - 不读写本地资源仓库（data/*.yaml 完全不参与），不打开任何本地文件。
  - 只有 GET，没有任何写操作。
"""

import json
import re
import time
import random
import urllib.request
import urllib.error
from urllib.parse import urlparse, quote

INDEX_PATH = "/search-index.json"
INDEX_TTL = 1800          # 索引缓存 30 分钟
TIMEOUT = 10
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36"

_cache = {"data": None, "at": 0.0}
_link_cache = {}          # id -> ([{name,url,code}], ts)
LINK_TTL = 6 * 3600


class SiteError(Exception):
    pass


def _get(url, host_lock):
    """只允许访问白名单主机。任何其他 host 直接拒绝，防止配置被改后乱发请求。"""
    host = urlparse(url).hostname or ""
    if host != host_lock:
        raise SiteError(f"拒绝访问非白名单主机：{host}")
    req = urllib.request.Request(url, headers={
        "User-Agent": UA,
        "Accept": "application/json,text/html;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9",
    })
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            return r.read()
    except urllib.error.HTTPError as e:
        raise SiteError(f"站点返回 {e.code}") from e
    except Exception as e:
        raise SiteError(f"请求失败：{e.__class__.__name__}") from e


def load_index(site_url):
    """返回全站资源列表。带 TTL 缓存，站点侧挂了才报错。"""
    host = urlparse(site_url).hostname or ""
    now = time.time()
    if _cache["data"] is not None and now - _cache["at"] < INDEX_TTL:
        return _cache["data"]
    raw = _get(site_url.rstrip("/") + INDEX_PATH, host)
    try:
        data = json.loads(raw.decode("utf-8"))
    except Exception as e:
        raise SiteError("索引解析失败") from e
    if not isinstance(data, list):
        raise SiteError("索引格式异常")
    _cache["data"] = data
    _cache["at"] = now
    return data


def _norm(s):
    return (s or "").lower().replace("　", " ").strip()


def _tokens(kw):
    return [t for t in re.split(r"[\s,，、]+", _norm(kw)) if t]


def _is_ascii(kw):
    return bool(re.fullmatch(r"[a-z0-9 ]+", _norm(kw)))


def score(item, kw):
    """标题优先，其次拼音、标签、分类。简介不参与，避免长文本造成假命中。"""
    k = _norm(kw)
    if not k:
        return 0
    title = _norm(item.get("title"))
    tags = _norm(" ".join(item.get("tags") or []))
    cat = _norm(item.get("category"))
    py = _norm(item.get("py"))
    py1 = _norm(item.get("py1"))
    s = 0

    if title == k:
        s += 120
    elif k and k in title:
        s += 70

    toks = _tokens(kw)
    if toks:
        hit = sum(1 for t in toks if t in title)
        if hit == len(toks) and len(toks) > 1:
            s += 45
        s += 18 * hit
        s += 10 * sum(1 for t in toks if t in tags)
        s += 6 * sum(1 for t in toks if t in cat)

    # 拼音搜索：qingzhixiang / qzx 都能命中
    if py or py1:
        compact = k.replace(" ", "")
        if compact and (py.startswith(compact) or py1.startswith(compact)):
            s += 50
        elif len(compact) >= 3 and (compact in py or compact in py1):
            s += 25

    return s


def search(site_url, kw, limit=3):
    """返回 (命中列表, 命中总数)。总数用于告诉用户"还有更多"。"""
    items = load_index(site_url)
    scored = [(score(it, kw), it) for it in items]
    scored = [x for x in scored if x[0] > 0]
    scored.sort(key=lambda x: x[1].get("date") or "", reverse=True)   # 先日期降序
    scored.sort(key=lambda x: -x[0])                                  # 稳定排序，再按分数降序
    return [it for _, it in scored[:limit]], len(scored)


def recent(site_url, n=8):
    items = load_index(site_url)
    return sorted(items, key=lambda x: (x.get("date") or "", x.get("id") or ""), reverse=True)[:n]


def today(site_url, n=8):
    """今天的更新；今天没有就退化为「不晚于今天」的最近一次更新日。
    站点里存在未来日期的条目（影片上映日），这里要排除，否则「今日」会显示未来资源。"""
    items = load_index(site_url)
    t = time.strftime("%Y-%m-%d")
    todays = [it for it in items if it.get("date") == t]
    if todays:
        return todays[:n], t
    past = [it for it in items if (it.get("date") or "") and it["date"] <= t]
    if not past:
        return [], None
    latest = max(it["date"] for it in past)
    return [it for it in past if it["date"] == latest][:n], latest


def categories(site_url):
    items = load_index(site_url)
    counts = {}
    for it in items:
        c = it.get("category") or "未分类"
        counts[c] = counts.get(c, 0) + 1
    return sorted(counts.items(), key=lambda x: -x[1]), len(items)


def pick_random(site_url):
    items = load_index(site_url)
    with_link = [it for it in items if it.get("href")]
    return random.choice(with_link) if with_link else None


_QUARK_RE = re.compile(r"https?://pan\.quark\.cn/s/[A-Za-z0-9]+")
_BAIDU_RE = re.compile(r"https?://pan\.baidu\.com/s/[A-Za-z0-9_\-]+")

# 详情页的网盘链接是结构化区块，一条链接一段：
#   <div class="linkrow"><span class="linkrow__name">百度网盘</span>
#   <code class="linkrow__url">https://pan.baidu.com/s/xxx</code>
#   <span class="linkrow__code">提取码 <b>fw1j</b>...</span></div>
_LINKROW_RE = re.compile(r'<div class="linkrow">(.*?)</div>', re.S)
_LR_NAME_RE = re.compile(r'class="linkrow__name">\s*([^<]+?)\s*<')
_LR_URL_RE = re.compile(r'class="linkrow__url">\s*(https?://[^<\s]+)\s*<')
_LR_CODE_RE = re.compile(r'class="linkrow__code">.*?<b>\s*([^<]+?)\s*</b>', re.S)


def _parse_links(html):
    """返回 [{name, url, code}]，顺序与页面一致（夸克在前、百度在后）。"""
    out = []
    for block in _LINKROW_RE.findall(html):
        mu = _LR_URL_RE.search(block)
        if not mu:
            continue
        url = mu.group(1)
        mn = _LR_NAME_RE.search(block)
        name = mn.group(1) if mn else ""
        if not name:
            name = "夸克网盘" if "quark" in url else ("百度网盘" if "baidu" in url else "网盘")
        mc = _LR_CODE_RE.search(block)
        out.append({"name": name, "url": url, "code": mc.group(1) if mc else ""})
    if out:
        return out

    # 老页面没有 linkrow 区块时回退：整页只抓一个链接
    m = _QUARK_RE.search(html)
    if m:
        return [{"name": "夸克网盘", "url": m.group(0), "code": ""}]
    m = _BAIDU_RE.search(html)
    if m:
        return [{"name": "百度网盘", "url": m.group(0), "code": ""}]
    return []


def fetch_links(site_url, item):
    """打开资源详情页，取出全部网盘链接。带 6 小时缓存，避免重复打站点。"""
    iid = item.get("id") or ""
    now = time.time()
    if iid in _link_cache:
        links, ts = _link_cache[iid]
        if now - ts < LINK_TTL:
            return links

    href = item.get("href") or ""
    if not href.startswith("/"):
        return []
    host = urlparse(site_url).hostname or ""
    html = _get(site_url.rstrip("/") + href, host).decode("utf-8", "ignore")

    links = _parse_links(html)
    if links:
        _link_cache[iid] = (links, now)
    return links


def stats(site_url):
    items = load_index(site_url)
    return len(items), sum(1 for x in items if x.get("href"))
