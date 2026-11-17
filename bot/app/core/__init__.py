# -*- coding: utf-8 -*-
"""core —— 平台无关共享层。

放这里的东西不允许 import 任何平台模块：
  - handlers.py    指令路由与回复组装（TG 端使用）
  - site_client.py 线上站点只读客户端
  - config.py      config.json（common / telegram / feishu）的统一读取
  - runtime.py     日志 / 消息去重 / 限频

平台入口在 app/telegram/（以后新平台照此加目录）。
"""
