#!/bin/bash
# Owner rule: no push / PR create|merge|ready / write gh api call without the owner's approval.
# Parses the command shell-aware (wrappers, quoting, global flags, bash -c). Unparsable → ask.
exec /usr/bin/python3 -c '
import json, os, re, shlex, sys

ASK = {"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "ask",
       "permissionDecisionReason": "push / PR — sahibin onayı gerekiyor"}}

def ask(reason=None):
    out = json.loads(json.dumps(ASK))
    if reason:
        out["hookSpecificOutput"]["permissionDecisionReason"] += " (" + reason + ")"
    print(json.dumps(out)); sys.exit(0)

WRAPPERS = {"env", "command", "builtin", "exec", "nohup", "time", "sudo", "nice", "xargs", "caffeinate"}
SHELLS = {"sh", "bash", "zsh", "dash"}
GIT_OPT_ARG = {"-C", "-c", "--git-dir", "--work-tree", "--namespace", "--exec-path", "--super-prefix", "--config-env"}
GH_OPT_ARG = {"-R", "--repo", "--hostname"}
SEP = {";", "&&", "||", "|", "&", "|&", "(", ")", "\n", "{", "}"}

def tokens(cmd):
    lx = shlex.shlex(cmd, posix=True, punctuation_chars=";&|()")
    lx.whitespace_split = True
    lx.commenters = ""
    return list(lx)

def segments(toks):
    seg = []
    for t in toks:
        if t in SEP or set(t) <= set(";&|()"):
            if seg: yield seg
            seg = []
        else:
            seg.append(t)
    if seg: yield seg

HEREDOC = re.compile(r"(?<!<)<<(-?)[ \t]*([\x22\x27]?)([A-Za-z_][A-Za-z0-9_.-]*)\2")
FEEDS_SHELL = re.compile(r"(^|[;&|(\s/])(sh|bash|zsh|dash|ssh|eval)\b[^;&|<]*$")

def heredocs(cmd):
    # Heredoc bodies are data, not commands: drop them before parsing. A body fed to a shell is
    # returned so it gets checked. Unterminated heredoc → leave the command as it is.
    lines = cmd.split("\n"); out = []; shell_bodies = []; i = 0
    while i < len(lines):
        line = lines[i]; out.append(line); i += 1
        for m in HEREDOC.finditer(line):
            strip_tabs = m.group(1) == "-"; delim = m.group(3); body = []
            while i < len(lines):
                l = lines[i]; i += 1
                if (l.lstrip("\t") if strip_tabs else l) == delim: break
                body.append(l)
            else:
                return cmd, []
            if FEEDS_SHELL.search(line[:m.start()]): shell_bodies.append("\n".join(body))
    return "\n".join(out), shell_bodies

def check(cmd, depth=0):
    if depth > 3: ask("iç içe kabuk")
    # command substitutions: check their bodies too (unquoted heredocs expand them)
    for body in re.findall(r"\$\(([^()]*)\)|`([^`]*)`", cmd):
        for b in body:
            if b: check(b, depth + 1)
    cmd, shell_bodies = heredocs(cmd)
    for b in shell_bodies: check(b, depth + 1)
    try:
        toks = tokens(cmd.replace("\n", " ; "))
    except ValueError:
        if re.search(r"push|\bpr\b|\bapi\b", cmd): ask("ayrıştırılamadı")
        return
    for seg in segments(toks):
        i = 0
        while i < len(seg) and re.match(r"^[A-Za-z_][A-Za-z0-9_]*=", seg[i]): i += 1
        if i < len(seg) and os.path.basename(seg[i]) in WRAPPERS:
            # wrapper options may take values (sudo -u me, xargs -I {}): jump to the first known program
            known = {"git", "gh", "eval"} | SHELLS
            nxt = [k for k in range(i + 1, len(seg)) if os.path.basename(seg[k]) in known]
            if not nxt: continue
            i = nxt[0]
        if i >= len(seg): continue
        prog = os.path.basename(seg[i]); args = seg[i + 1:]
        if prog in SHELLS:
            for k, a in enumerate(args):
                if a == "-c" or (a.startswith("-") and "c" in a[1:] and not a.startswith("--")):
                    if k + 1 < len(args): check(args[k + 1], depth + 1)
                    break
            continue
        if prog in {"eval"}:
            check(" ".join(args), depth + 1); continue
        if prog == "git":
            j = 0
            while j < len(args) and args[j].startswith("-"):
                j += 2 if args[j] in GIT_OPT_ARG else 1
            if j < len(args) and args[j] == "push": ask()
        elif prog == "gh":
            j = 0
            while j < len(args) and args[j].startswith("-"):
                j += 2 if args[j] in GH_OPT_ARG else 1
            rest = args[j:]
            if not rest: continue
            if rest[0] == "pr":
                k = 1
                while k < len(rest) and rest[k].startswith("-"):
                    k += 2 if rest[k] in GH_OPT_ARG else 1
                if k < len(rest) and rest[k] in {"create", "merge", "ready"}: ask()
            elif rest[0] == "api":
                method = None; fields = False
                for k, a in enumerate(rest[1:], 1):
                    if a in ("-X", "--method") and k + 1 < len(rest): method = rest[k + 1].upper()
                    elif a.startswith("--method="): method = a.split("=", 1)[1].upper()
                    elif a.startswith("-X") and len(a) > 2: method = a[2:].upper()
                    elif a in ("-f", "-F", "--field", "--raw-field", "--input") or a.startswith(("--field=", "--raw-field=", "--input=")): fields = True
                if (method or ("POST" if fields else "GET")) != "GET": ask("gh api yazma")

try:
    data = json.load(sys.stdin)
    cmd = (data.get("tool_input") or {}).get("command") or ""
except Exception:
    ask("kanca girdisi okunamadı")
if not isinstance(cmd, str): ask("kanca girdisi okunamadı")
check(cmd)
sys.exit(0)
'
