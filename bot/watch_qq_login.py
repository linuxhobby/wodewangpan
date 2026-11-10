# -*- coding: utf-8 -*-
"""盯 NapCat 扫码登录状态：每 5 秒查一次 CheckLoginStatus，登录成功或超时退出。
二维码过期（Phase 回到 waiting_qrcode 且 url 变了）会自动刷新并重写本地二维码文件。
自己登录 NapCat WebUI（sha256(token + ".napcat")），不依赖手工留下的凭据，
桌面快捷方式可以直接双击使用。"""
import hashlib
import json
import os
import sys
import time
import urllib.parse
import urllib.request

TEMP = os.environ.get("TEMP", ".")
CRED_FILE = os.path.join(TEMP, "napcat_cred.txt")
QR_FILE = r"C:\Users\marco\Github\wodewangpan\bot\logs\qq-login-qr.png"
WEBUI_CFG = (r"C:\Users\marco\Downloads\NapCatOneKey\NapCat.52230.Shell"
             r"\versions\9.9.33-52230\resources\app\napcat\config\webui.json")
BASE = "http://127.0.0.1:6099"


def _raw(path, body=None, cred=""):
    req = urllib.request.Request(
        BASE + path,
        data=json.dumps(body or {}).encode(),
        headers={"Content-Type": "application/json",
                 "Authorization": ("Bearer " + cred) if cred else ""},
        method="POST")
    with urllib.request.urlopen(req, timeout=25) as r:
        return json.loads(r.read().decode("utf-8", "ignore"))


def _cred_alive(cred):
    try:
        return _raw("/api/QQLogin/CheckLoginStatus", cred=cred).get("code") == 0
    except Exception:
        return False


def _login():
    """用 webui.json 里的 token 登录 WebUI，返回凭据；成功后落盘供下次复用。"""
    tok = (json.load(open(WEBUI_CFG, encoding="utf-8")).get("token") or "").strip()
    h = hashlib.sha256((tok + ".napcat").encode()).hexdigest()
    j = _raw("/api/auth/login", {"hash": h, "totpCode": ""})
    cred = (j.get("data") or {}).get("Credential") or ""
    if not cred:
        raise RuntimeError("WebUI 登录失败：" + str(j.get("message"))[:120])
    try:
        open(CRED_FILE, "w").write(cred)
    except Exception:
        pass
    return cred


def _get_cred():
    """优先复用上次登录的凭据，失效或没有就重新登录。"""
    try:
        cred = open(CRED_FILE).read().strip()
        if cred and _cred_alive(cred):
            return cred
    except Exception:
        pass
    return _login()


def post(path, body=None, cred=""):
    try:
        return _raw(path, body, cred)
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
    try:
        cred = _get_cred()
        print("· WebUI 凭据就绪", flush=True)
    except Exception as e:
        print("× 拿不到 WebUI 凭据：%s" % e, flush=True)
        return 1
    deadline = time.time() + 600
    last_url = ""
    last_phase = ""
    while time.time() < deadline:
        j = post("/api/QQLogin/CheckLoginStatus", cred=cred)
        d = j.get("data") or {}
        phase = d.get("loginPhase") or "?"
        url = d.get("qrcodeurl") or ""
        is_login = bool(d.get("isLogin"))
        err = d.get("loginError") or ""
        if phase != last_phase or (url and url != last_url):
            print("[%s] phase=%s isLogin=%s err=%s" % (time.strftime("%H:%M:%S"), phase, is_login, err[:80]), flush=True)
            last_phase = phase
        if url and url != last_url and not is_login:
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
