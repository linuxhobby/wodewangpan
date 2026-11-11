#!/usr/bin/env bash
# 一键启用线上浏览量统计（本地统计管线）。
# 还原：nginx 配置已自动备份为 <conf>.bak.<时间戳>；cron 可用 crontab -e 删掉对应行。
#
# 用法：
#   bash deploy/enable-stats.sh                      # 用默认路径（全新站点，统计从零开始）
#   REPO_DIR=/srv/site DOMAIN=example.com NGINX_CONF=/etc/nginx/conf.d/site.conf bash deploy/enable-stats.sh
#   OLD_STATS_DB=/tmp/old-stats.db bash deploy/enable-stats.sh   # 迁移服务器：导入旧统计库，保留历史排名
#
# 前置：以 root 执行（需要 reload nginx、写 crontab）。仓库目录已 git pull 到最新。
# 迁移注意：统计库 /var/lib/sitestats/stats.db 不在仓库里，换服务器默认丢失，热门榜排名会全部重置。
#   想保留旧排名，先把旧机的库拷过来：scp 旧机:/var/lib/sitestats/stats.db /tmp/old-stats.db
#   再带 OLD_STATS_DB 跑本脚本。切勿在新机已跑过统计后导入（会覆盖新机增量）。

set -u

REPO_DIR="${REPO_DIR:-/opt/wodewangpan}"
NGINX_CONF="${NGINX_CONF:-/etc/nginx/conf.d/wodewangpan.conf}"
DOMAIN="${DOMAIN:-www.wodewangpan.top}"
STATS_DB="/var/lib/sitestats/stats.db"
STATS_OUT="/var/lib/sitestats/stats.json"
OLD_STATS_DB="${OLD_STATS_DB:-}"

need() { command -v "$1" >/dev/null 2>&1 || { echo "缺少命令: $1"; exit 1; }; }
need nginx; need python3; need crontab

echo "== 0. 前置检查 =="
[ -f "$NGINX_CONF" ] || { echo "未找到 $NGINX_CONF，请用 NGINX_CONF= 指定"; exit 1; }
[ -d "$REPO_DIR" ]   || { echo "未找到 $REPO_DIR，请用 REPO_DIR= 指定"; exit 1; }
if [ ! -f /etc/nginx/conf.d/00-sitestats.conf ]; then
  echo "[注意] 缺少 /etc/nginx/conf.d/00-sitestats.conf（定义 sitestats 日志格式）。"
  echo "        请先从仓库 deploy/00-sitestats.conf 复制过去并 reload，否则 access_log 会报未知格式。"
fi

BAK="${NGINX_CONF}.bak.$(date +%s)"
cp "$NGINX_CONF" "$BAK"
echo "已备份 nginx 配置 -> $BAK"

echo "== 1. 注入 nginx 统计配置 =="
python3 - "$NGINX_CONF" <<'PY'
import sys
p = sys.argv[1]
s = open(p).read()
changed = False

# ① access_log 用 sitestats 格式（带 $cookie_vid），否则 sitestats.py 解析不到、统计全 0
if 'access_log /var/log/nginx/access.log sitestats' not in s:
    if 'root /opt/wodewangpan/public;' in s:
        s = s.replace('root /opt/wodewangpan/public;',
                      'root /opt/wodewangpan/public;\n    access_log /var/log/nginx/access.log sitestats;', 1)
        changed = True
    else:
        print('[手动] 找不到 "root /opt/wodewangpan/public;" 锚点，请在 server 块加:')
        print('        access_log /var/log/nginx/access.log sitestats;')

# ② 暴露 /stats.json 与 /hit 信标
if 'location = /stats.json' not in s and 'location / {' in s:
    block = ('\n'
             '    location = /stats.json {\n'
             '        alias /var/lib/sitestats/stats.json;\n'
             '        default_type application/json;\n'
             '        add_header Cache-Control "no-store";\n'
             '        add_header Access-Control-Allow-Origin "*";\n'
             '    }\n'
             '    location = /hit { return 204; }\n')
    s = s.replace('location / {', block + '    location / {', 1)
    changed = True
elif 'location = /stats.json' not in s:
    print('[手动] 找不到 "location / {" 锚点，请手动加 /stats.json 与 /hit location（见 deploy/nginx-site.conf.example）')

open(p, 'w').write(s)
print('nginx 配置已更新' if changed else 'nginx 配置无需改动（已含统计配置）')
PY

nginx -t && systemctl reload nginx || { echo "nginx -t 失败，请用备份 $BAK 还原后检查"; exit 1; }
echo "nginx 已重载"

echo "== 2. 回填 sitestats =="
cd "$REPO_DIR" || exit 1
if [ -n "$OLD_STATS_DB" ]; then
  if [ ! -f "$OLD_STATS_DB" ]; then
    echo "[错误] OLD_STATS_DB=$OLD_STATS_DB 不存在，终止以免误清空现有统计。"; exit 1
  fi
  # 先确认这是一份可用的 SQLite（防止 scp 半截文件把库顶坏）
  if ! python3 - "$OLD_STATS_DB" <<'PY'
import sys, sqlite3
try:
    c = sqlite3.connect(sys.argv[1]); c.execute('SELECT COUNT(*) FROM sqlite_master'); c.close()
except Exception as e:
    print('[错误] 不是有效 SQLite 库:', e); sys.exit(1)
PY
  then exit 1; fi
  mkdir -p "$(dirname "$STATS_DB")"
  cp "$OLD_STATS_DB" "$STATS_DB"
  echo "已导入旧统计库 -> $STATS_DB（保留历史 PV/UV，迁移后新访问在其上累加）"
  # 关键：导入旧库后【不能】--reset，否则历史会被清掉；只回填当前 access.log（inode 不匹配会自动从日志头重读）
  python3 scripts/sitestats.py --backfill
else
  echo "未指定 OLD_STATS_DB：按全新站点重置统计（旧排名会丢失，热榜从零累积）"
  python3 scripts/sitestats.py --reset --backfill
fi
ls -l "$STATS_OUT"
python3 -c "import json;d=json.load(open('$STATS_OUT'));print('res 条数:',len(d['res']),'| 总PV:',d['pv'],'| 总UV:',d['uv'],'| since:',d.get('since'))"

echo "== 3. 配置 cron 增量（每 5 分钟） =="
LINE="*/5 * * * * cd $REPO_DIR && /usr/bin/python3 scripts/sitestats.py >> /var/log/sitestats.log 2>&1"
( crontab -l 2>/dev/null | grep -v 'scripts/sitestats.py'; echo "$LINE" ) | crontab -
echo "cron -> $LINE"

echo "== 4. 验证线上 =="
sleep 2
curl -s "https://${DOMAIN}/stats.json" -o /tmp/stats.json -w 'HTTP %{http_code}\n' \
  && python3 -c "import json;d=json.load(open('/tmp/stats.json'));print('res:',len(d['res']),'| pv:',d['pv'],'| uv:',d['uv'],'| today_pv:',d.get('today_pv'))" \
  || echo "[检查] curl 失败，请确认域名解析/证书；也可在 VPS 上 curl 127.0.0.1/stats.json 验证本地可访问"

echo "完成。刷新线上详情页，浏览量应已显示数字（首条数据需等下一个 cron 周期后稳定）。"
