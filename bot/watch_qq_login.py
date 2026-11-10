# -*- coding: utf-8 -*-
"""盯 NapCat 扫码登录状态：每 5 秒查一次 CheckLoginStatus，登录成功或超时退出。
二维码过期（Phase 回到 waiting_qrcode 且 url 变了）会自动刷新并重写本地二维码文件。"""
import json
import os
import sys
import time
import base64
import urllib.parse
import urllib.request

TEMP = os.environ.get("TEMP", ".")
CRED_FILE = os.path.join(TEMP, "napcat_cred.txt")
QR_FILE = r"C:\Users\marco\Github\wodewangpan\bot\logs\qq-login-qr.png"
BASE = "http://127.0.0.1:6099"


def post(path, body=None):
    cred = open(CRED_FILE).read().strip()
    req = urllib.request.Request(
        BASE + path,
        data=json.dumps(body or {}).encode(),
        headers={"Content-Type": "application/json", "Authorization": "Bearer " + cred},
        method="POST")
    try:
        with urllib.request.urlopen(req, timeout=25) as r:
            return json.loads(r.read().decode("utf-8", "ignore"))
    except Exception as e:
        return {"code": -999, "message": str(e)[:120]}


def refresh_qr(url):
    try:
        api = ("https://api.qrserver.com/v1/create-qr-code/?size=420x420&margin=12&data="
               + urllib.parse.quote(url, safe=""))
        with urllib.request.urlopen(api, timeout=25) as r:
            open(QR_FILE, "wb").write(r.read())
        return True
    except Exception:
        return False


def main():
    deadline = time.time() + 300
    last_url = ""
    last_phase = ""
    while time.time() < deadline:
        j = post("/api/QQLogin/CheckLoginStatus")
        d = j.get("data") or {}
        phase = d.get("loginPhase") or "?"
        url = d.get("qrcodeurl") or ""
        is_login = bool(d.get("isLogin"))
        err = d.get("loginError") or ""
        if phase != last_phase or (url and url != last_url):
            print("[%s] phase=%s isLogin=%s err=%s" % (time.strftime("%H:%M:%S"), phase, is_login, err[:80]), flush=True)
            last_phase = phase
        if url and url != last_url:
            last_url = url
            if refresh_qr(url):
                print("· 二维码已刷新并重写 " + QR_FILE, flush=True)
        if is_login:
            print("LOGIN_OK", flush=True)
            return 0
        time.sleep(5)
    print("TIMEOUT 5 分钟内没有登录成功", flush=True)
    return 1


if __name__ == "__main__":
    sys.exit(main())
