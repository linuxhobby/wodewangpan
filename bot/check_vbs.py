# -*- coding: utf-8 -*-
"""VBS 粗检：续行拼接后，检查每行引号成对、括号配对、If/End If 与 Function/End Function 配对。
不是完整语法分析，但能抓住续行写错、MsgBox 少个引号这类常见错误。"""
import io
import os
import sys


def strip_strings(line):
    """返回 (去字符串后的代码, 引号是否成对)。"""
    out = []
    in_str = False
    i = 0
    while i < len(line):
        ch = line[i]
        if ch == '"':
            in_str = not in_str
            out.append(" ")
        elif not in_str:
            out.append(ch)
        i += 1
    return "".join(out), not in_str


def check(path):
    raw = io.open(path, encoding="gbk").read().replace("\r\n", "\n")
    lines = raw.split("\n")
    problems = []

    # 1) 续行拼接成逻辑行
    logical = []          # (起始行号, 文本)
    buf, start = "", 0
    for idx, line in enumerate(lines, 1):
        s = line.rstrip()
        if not buf:
            start = idx
        if s.endswith(" _") or s.endswith("_"):
            buf += (s[:-1] if s.endswith(" _") else s[:-1]) + " "
            continue
        buf += line
        logical.append((start, buf))
        buf = ""
    if buf:
        logical.append((start, buf))

    # 2) 逐逻辑行检查
    depth_if = 0
    depth_fn = 0
    for ln, text in logical:
        code, quotes_ok = strip_strings(text)
        stripped = code.strip()
        if not stripped or stripped.startswith("'"):
            if not quotes_ok:
                problems.append((ln, "注释行引号不成对"))
            continue
        if not quotes_ok:
            problems.append((ln, "引号不成对（续行拼错？）"))
        if code.count("(") != code.count(")"):
            problems.append((ln, "括号不配对 %s/%s" % (code.count("("), code.count(")"))))
        low = stripped.lower()
        if low.startswith("if ") and " then" in low and not low.startswith("if not "):
            pass
        if low.startswith("if ") or low.startswith("if("):
            if low.endswith("then"):
                depth_if += 1
            elif " then " not in low:
                problems.append((ln, "If 行缺 Then"))
        elif low.startswith("end if"):
            depth_if -= 1
            if depth_if < 0:
                problems.append((ln, "多余的 End If"))
        elif low.startswith("function "):
            depth_fn += 1
        elif low.startswith("end function"):
            depth_fn -= 1
            if depth_fn < 0:
                problems.append((ln, "多余的 End Function"))
        elif low.startswith("sub "):
            depth_fn += 1
        elif low.startswith("end sub"):
            depth_fn -= 1

    if depth_if != 0:
        problems.append((0, "If/End If 不配对，差 %d" % depth_if))
    if depth_fn != 0:
        problems.append((0, "Function-Sub/End 不配对，差 %d" % depth_fn))
    return problems


def main():
    root = os.path.dirname(os.path.abspath(__file__))
    files = sorted(f for f in os.listdir(root) if f.lower().endswith(".vbs"))
    bad = 0
    for f in files:
        if f.endswith(".bak") or ".bak-" in f:
            continue
        problems = check(os.path.join(root, f))
        if problems:
            bad += 1
            print("✗ %s" % f)
            for ln, msg in problems[:8]:
                print("    第 %s 行：%s" % (ln or "-", msg))
        else:
            print("✓ %s" % f)
    print("\n%d 个文件，%d 个有问题" % (len(files), bad))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
