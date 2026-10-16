#!/usr/bin/env python3
"""本地访问统计：增量解析 nginx access.log，累计 PV/UV 写入 SQLite，输出 stats.json。

用法：
  sitestats.py              增量处理自上次位置以来的新日志（cron 每 5 分钟执行）
  sitestats.py --backfill   从当前 access.log 开头全量解析（回填历史，处理完把游标推到末尾）
  sitestats.py --file X     指定日志文件（配合 --backfill 用，不移动主游标）
  sitestats.py --reset      清空统计与游标后全量回填
"""

import argparse
import hashlib
import json
import os
import re
import sqlite3
import sys
from datetime import datetime, timedelta, timezone

LOG = '/var/log/nginx/access.log'
DB = '/var/lib/sitestats/stats.db'
OUT = '/var/lib/sitestats/stats.json'
TZ = timezone(timedelta(hours=8))

# combined 格式 + 末尾可选的 "$cookie_vid"
LINE_RE = re.compile(
    r'^(\S+) \S+ \S+ \[([^\]]+)\] "([A-Z]+) (\S+) [^"]*" (\d{3}) \S+ "[^"]*" "([^"]*)"(?: "([^"]*)")?'
)
BOT_RE = re.compile(
    r'(bot|spider|crawl|slurp|baidu|bing|yandex|sogou|semrush|ahrefs|mj12|dotbot|petalbot|'
    r'bytespider|applebot|facebookexternalhit|duckduckbot|archive\.org|monitor|curl|wget|'
    r'python-requests|headless|go-http-client|okhttp|scrapy|feed|rss)',
    re.I,
)
SKIP_PATH_RE = re.compile(
    r'\.(css|js|mjs|json|xml|txt|png|jpe?g|gif|ico|svg|webp|woff2?|ttf|map)(\?|$)'
    r'|^/404\.html$|^/stats\.json$|^/robots\.txt$|^/sitemap\.xml$|^/key\.txt$',
    re.I,
)
VID_RE = re.compile(r'^[A-Za-z0-9_-]{8,64}$')
# 资源详情页 /resource/<id>/：仅对这一类做按资源聚合（其余页面不进 page 表）
RES_RE = re.compile(r'^/resource/([^/]+)/?$')


def log(msg):
    print(f'[{datetime.now(TZ).strftime("%F %T")}] {msg}', flush=True)


def connect():
    os.makedirs(os.path.dirname(DB), exist_ok=True)
    c = sqlite3.connect(DB)
    c.executescript(
        '''CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT);
           CREATE TABLE IF NOT EXISTS visitors(fp TEXT PRIMARY KEY, first_seen TEXT, last_seen TEXT);
           CREATE TABLE IF NOT EXISTS daily(d TEXT PRIMARY KEY, pv INTEGER DEFAULT 0);
           CREATE TABLE IF NOT EXISTS daily_uv(d TEXT, fp TEXT, PRIMARY KEY(d, fp));
           CREATE TABLE IF NOT EXISTS page_pv(id TEXT, day TEXT, pv INTEGER DEFAULT 0, PRIMARY KEY(id, day));
           CREATE TABLE IF NOT EXISTS page_uv(id TEXT, day TEXT, fp TEXT, PRIMARY KEY(id, day, fp));'''
    )
    return c


def meta_get(c, k, default=None):
    row = c.execute('SELECT value FROM meta WHERE key=?', (k,)).fetchone()
    return row[0] if row else default


def meta_set(c, k, v):
    c.execute('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', (k, v))


def fingerprint(ip, ua, vid):
    """访客指纹：v: 前缀 = 带 vid cookie 的真浏览器（计入 UV）；
    i: 前缀 = 无 cookie 的脚本 / 爬虫，只计 PV 不计 UV。"""
    if vid and VID_RE.match(vid):
        return 'v:' + vid
    return 'i:' + hashlib.sha1(f'{ip}|{ua}'.encode('utf-8', 'replace')).hexdigest()[:16]


def mark_visitor(c, day, fp, ts):
    """记一次访客：只有带 vid cookie（v: 前缀）的才写入，爬虫不计。"""
    if not fp.startswith('v:'):
        return
    c.execute(
        'INSERT INTO visitors(fp,first_seen,last_seen) VALUES(?,?,?) '
        'ON CONFLICT(fp) DO UPDATE SET last_seen=excluded.last_seen',
        (fp, ts, ts),
    )
    c.execute('INSERT OR IGNORE INTO daily_uv(d,fp) VALUES(?,?)', (day, fp))


def parse_raw(line):
    """只做基础解析，过滤条件交给 ingest（/hit 信标要单独走 UV 分支）。"""
    m = LINE_RE.match(line)
    if not m:
        return None
    ip, ts, method, path, status, ua, vid = m.groups()
    if not status.isdigit() or int(status) >= 400:
        return None
    if BOT_RE.search(ua):
        return None
    try:
        dt = datetime.strptime(ts, '%d/%b/%Y:%H:%M:%S %z').astimezone(TZ)
    except ValueError:
        return None
    return {
        'day': dt.strftime('%F'),
        'ts': dt.isoformat(),
        'fp': fingerprint(ip, ua, vid),
        'method': method,
        'path': path.split('?', 1)[0],
    }


def ingest(c, lines):
    pv = 0
    for line in lines:
        r = parse_raw(line)
        if not r:
            continue
        day, ts, fp, method, path = r['day'], r['ts'], r['fp'], r['method'], r['path']

        # /hit：页面 JS 种完 cookie 后回发的确认信标，只用于补记首访 UV，不计入 PV
        if path == '/hit':
            mark_visitor(c, day, fp, ts)
            continue

        if method not in ('GET', 'HEAD') or SKIP_PATH_RE.search(path):
            continue

        c.execute('INSERT INTO daily(d,pv) VALUES(?,0) ON CONFLICT(d) DO NOTHING', (day,))
        c.execute('UPDATE daily SET pv=pv+1 WHERE d=?', (day,))
        # UV 只认带 vid cookie 的请求：cookie 由页面 JS 种植，跑过 JS 才算真人访客
        mark_visitor(c, day, fp, ts)
        pv += 1

        # 按资源聚合：仅资源详情页 /resource/<id>/ 入库，PV 全量（与 daily 口径一致），
        # UV 同样只认 v: 前缀（与 daily_uv 一致）。其余页面（首页 / 分类 / 标签页）不做细分。
        m = RES_RE.match(path)
        if m:
            rid = m.group(1)
            c.execute(
                'INSERT INTO page_pv(id,day,pv) VALUES(?,?,1) '
                'ON CONFLICT(id,day) DO UPDATE SET pv=pv+1',
                (rid, day),
            )
            if fp.startswith('v:'):
                c.execute('INSERT OR IGNORE INTO page_uv(id,day,fp) VALUES(?,?,?)', (rid, day, fp))
    return pv


def write_stats(c):
    pv = c.execute('SELECT COALESCE(SUM(pv),0) FROM daily').fetchone()[0]
    uv = c.execute('SELECT COUNT(*) FROM visitors').fetchone()[0]
    today = datetime.now(TZ).strftime('%F')
    row = c.execute('SELECT pv FROM daily WHERE d=?', (today,)).fetchone()
    t_pv = row[0] if row else 0
    t_uv = c.execute('SELECT COUNT(*) FROM daily_uv WHERE d=?', (today,)).fetchone()[0]
    since = c.execute('SELECT MIN(d) FROM daily').fetchone()[0]

    # 每资源 PV / UV：page_pv 含全量 PV，page_uv 仅去重真人，二者合并成 res 字典
    res = {}
    for rid, p in c.execute('SELECT id, COALESCE(SUM(pv),0) FROM page_pv GROUP BY id'):
        res[rid] = {'pv': p, 'uv': 0}
    for rid, u in c.execute('SELECT id, COUNT(*) FROM page_uv GROUP BY id'):
        res.setdefault(rid, {'pv': 0, 'uv': 0})['uv'] = u
    # 热门榜单：按 PV 降序取前 20，给人工巡检用（同时带 uv，更接近「真实人气」）
    top = sorted(
        ({'id': k, 'pv': v['pv'], 'uv': v['uv']} for k, v in res.items()),
        key=lambda x: x['pv'], reverse=True,
    )[:20]

    data = {
        'pv': pv,
        'uv': uv,
        'today_pv': t_pv,
        'today_uv': t_uv,
        'since': since or today,
        'res': res,
        'top': top,
        'updated': datetime.now(TZ).isoformat(timespec='seconds'),
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    tmp = OUT + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False)
    os.replace(tmp, OUT)
    return data


def read_chunk(path, offset, whole=False):
    """返回 (行列表, 新offset)。非 whole 模式只处理到最后一个换行，避免半行。"""
    with open(path, 'rb') as f:
        if offset:
            f.seek(offset)
        raw = f.read()
    if not raw:
        return [], offset
    if not whole:
        cut = raw.rfind(b'\n')
        if cut == -1:
            return [], offset
        raw = raw[: cut + 1]
    text = raw.decode('utf-8', 'replace')
    return [l for l in text.split('\n') if l.strip()], offset + len(raw)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--backfill', action='store_true', help='从文件开头全量解析')
    ap.add_argument('--file', help='指定日志文件（不移动主游标）')
    ap.add_argument('--reset', action='store_true', help='清空后重新统计')
    a = ap.parse_args()

    c = connect()
    if a.reset:
        c.executescript('DELETE FROM meta; DELETE FROM visitors; DELETE FROM daily; DELETE FROM daily_uv; DELETE FROM page_pv; DELETE FROM page_uv;')
        log('已清空历史统计')
        # 重置后默认从「此刻」起算：游标直接跳到当前日志末尾，不回填已有日志
        if not a.backfill and os.path.exists(LOG):
            meta_set(c, 'inode', str(os.stat(LOG).st_ino))
            meta_set(c, 'offset', str(os.stat(LOG).st_size))
            c.commit()

    if a.file:
        lines, _ = read_chunk(a.file, 0, whole=True)
        n = ingest(c, lines)
        c.commit()
        log(f'回填 {a.file}：{len(lines)} 行 → 计入 {n} PV')
        log('统计结果：' + json.dumps(write_stats(c), ensure_ascii=False))
        return 0

    if not os.path.exists(LOG):
        log(f'日志文件不存在：{LOG}')
        return 1

    st = os.stat(LOG)
    inode = str(st.st_ino)
    offset = int(meta_get(c, 'offset', '0') or 0)
    if meta_get(c, 'inode') != inode:
        offset = 0  # logrotate 后的新文件
        meta_set(c, 'inode', inode)
    if st.st_size < offset:
        offset = 0  # 被截断

    lines, new_off = read_chunk(LOG, offset, whole=a.backfill)
    n = ingest(c, lines) if lines else 0
    meta_set(c, 'offset', str(new_off))
    c.commit()
    log(f'新日志 {len(lines)} 行 → 计入 {n} PV（游标 {offset} → {new_off}）')
    log('统计结果：' + json.dumps(write_stats(c), ensure_ascii=False))
    c.close()
    return 0


if __name__ == '__main__':
    sys.exit(main())
