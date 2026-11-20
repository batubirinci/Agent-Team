#!/usr/bin/env python3
"""Run a list of source mutants against one worktree, one test run per mutant.

Usage:
  python3 mutate.py --worktree <abs path> --list <mutants.json> --log <log file>
                    --cmd "<test command, {wt} = worktree>" [--jobs N]
                    [--fail-re REGEX] [--rm <relative path>]... [--raw-dir DIR] [id ...]
  python3 mutate.py --self-check      (temp git repo, no network, a few seconds; exit 0 = all hold)

List: JSON array of {"id": str, "edits": [{"file": rel path, "find": str,
"replace": str, "count": int}], "want": str}. `id` is [A-Za-z0-9._-]+ (not . or ..); `want` is a
substring of the fail line the mutant should trip. Every edit file and every --rm path must stay
inside the worktree after symlinks are resolved; a bad entry is refused (exit 2), nothing runs.

Per mutant: every `find` must occur exactly `count` times in the original file, else the line
is `<id>: PATTERN COUNT WRONG` and nothing runs. Edits are applied, the test command runs (its
stdout+stderr go to a temporary file, not a pipe, so output of any size is kept), and the
originals are ALWAYS restored in a finally block, byte-exact. Result classes, one line per id:
  KILLED        a fail line (--fail-re, default `^\\(fail\\)`, the bun / `claude plugin test`
                format) contains `want`
  KILLED-OTHER  fail lines, none contains `want`
  SURVIVED      exit 0, no fail lines
  UNPARSED      exit != 0 without fail lines (crash or harness error, not a survivor)
  TIMEOUT       the run passed 600 s
  ERROR         the tool itself failed on this mutant (missing file, command cannot start, ...);
                the line says why, the worker goes on, the tool exits 1 at the end
  PATTERN COUNT WRONG  see above

--jobs N (default min(4, mutants to run)): N detached worktrees <worktree>-mjob<k> of HEAD, mutants
split round-robin, run in parallel; removed after the run if clean (else kept and logged).
--jobs 1 runs in the given worktree. A dirty or non-git worktree is refused (exit 2). --rm paths
(e.g. a file the test run leaves behind) are deleted after every mutant. Stdlib only.
"""
import argparse
import datetime
import json
import os
import re
import shlex
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time

CRASH = re.compile(r"TypeError|ReferenceError|SyntaxError")
TIMEOUT_S = 600
CLASSES = ("KILLED", "KILLED-OTHER", "SURVIVED", "UNPARSED", "PATTERN COUNT WRONG", "ERROR", "TIMEOUT")
ID_RE = re.compile(r"[A-Za-z0-9._-]+")


def read_text(path):
    with open(path, encoding="utf-8", newline="") as f:
        return f.read()


def write_text(path, text):
    with open(path, "w", encoding="utf-8", newline="") as f:
        f.write(text)


def inside(wt, rel):
    """Resolved path of `rel` in the worktree; ValueError if it is absolute or leaves it."""
    if os.path.isabs(rel):
        raise ValueError(f"path must be relative to the worktree: {rel}")
    root = os.path.realpath(wt)
    full = os.path.realpath(os.path.join(root, rel))
    if not full.startswith(root + os.sep):
        raise ValueError(f"path escapes the worktree: {rel}")
    return full


def git_out(wt, *args):
    return subprocess.run(["git", "-C", wt, *args], capture_output=True, text=True).stdout


def run_share(wt, mutants, a, rm_paths, cmd_tokens, fail_re, w, stop, procs):
    """Run one share of mutants in worktree `wt`; originals are always restored."""
    cmd = [t.replace("{wt}", wt) for t in cmd_tokens]
    for m in mutants:
        if stop.is_set():
            return
        mid, want = m["id"], m.get("want", "")
        originals = {}
        try:
            for e in m["edits"]:
                p = inside(wt, e["file"])
                if p not in originals:
                    originals[p] = read_text(p)
            if any(originals[inside(wt, e["file"])].count(e["find"]) != e["count"] for e in m["edits"]):
                w(f"{mid}: PATTERN COUNT WRONG", "PATTERN COUNT WRONG")
                continue
            cur = dict(originals)
            for e in m["edits"]:
                p = inside(wt, e["file"])
                cur[p] = cur[p].replace(e["find"], e["replace"])
            for p, text in cur.items():
                write_text(p, text)
            with tempfile.TemporaryFile() as of:  # a regular file: no pipe, no size cut
                proc = subprocess.Popen(cmd, stdout=of, stderr=subprocess.STDOUT,
                                        start_new_session=True)
                procs.add(proc)
                try:
                    proc.wait(timeout=TIMEOUT_S)
                except subprocess.TimeoutExpired:
                    try:
                        os.killpg(proc.pid, signal.SIGKILL)
                    except OSError:
                        pass
                    proc.wait()
                    w(f"{mid}: TIMEOUT; exit none; 0 failed; want {want}; got ; crash-lines no",
                      "TIMEOUT")
                    continue
                finally:
                    procs.discard(proc)
                of.seek(0)
                txt = of.read().decode("utf-8", "replace")
            if stop.is_set():
                return
            rc = proc.returncode
            if a.raw_dir:
                os.makedirs(a.raw_dir, exist_ok=True)
                with open(os.path.join(a.raw_dir, mid + ".txt"), "w", encoding="utf-8") as rf:
                    rf.write(f"exit {rc}\n{txt}")
            lines = txt.splitlines()
            fails = [l for l in lines if fail_re.search(l)]
            names = [l.strip()[:60].replace(",", ";") for l in fails][:3]
            crash = any(CRASH.search(l) for l in lines)
            if fails:
                res = "KILLED" if any(want in l for l in fails) else "KILLED-OTHER"
            elif rc != 0:
                res = "UNPARSED"  # failed run with no fail lines: not a surviving mutant
            else:
                res = "SURVIVED"
            w(f"{mid}: {res}; exit {rc}; {len(fails)} failed; want {want}; "
              f"got {','.join(names)}; crash-lines {'yes' if crash else 'no'}", res)
        except Exception as ex:  # one bad mutant must not drop the rest
            w(f"{mid}: ERROR; {type(ex).__name__}: {ex}", "ERROR")
        finally:
            for p, text in originals.items():
                try:
                    write_text(p, text)
                except OSError as ex:
                    w(f"{mid}: ERROR; restore of {p} failed: {ex}", "ERROR")
            for rp in rm_paths:
                try:
                    fp = inside(wt, rp)
                    if os.path.lexists(fp):
                        os.remove(fp)
                except (OSError, ValueError) as ex:
                    w(f"{mid}: ERROR; rm {rp} failed: {ex}", "ERROR")


CHECK_PY = """\
import os, stat, sys
wt = sys.argv[1]
s = open(wt + '/src.txt').read()
open(wt + '/junk.tmp', 'w').write('x')
out, rc = 'all pass\\n', 0
if 'big=yes' in s:
    out, rc = ('x' * 99 + '\\n') * 1100 + '(fail) test_big\\n', 1
elif 'mode=boom' in s:
    out, rc = 'harness crashed\\n', 3
elif 'mode=crlf' in s:
    out, rc = '(fail) test_crlf\\r\\n', 1
elif 'color=blue' in s:
    out, rc = '(fail) test_other\\n', 1
elif 'value=1' not in s:
    out, rc = '(fail) test_value\\n', 1
if not stat.S_ISREG(os.fstat(1).st_mode) and len(out) > 65536:
    out, rc = out[:65536], 0  # like `claude plugin test`: a pipe is cut at 64 KiB, no fail line, exit 0
sys.stdout.write(out)
sys.exit(rc)
"""


def self_check():
    """Build a tiny git repo, run this tool on it, assert every promised behaviour."""
    root = os.path.realpath(tempfile.mkdtemp(prefix="mutate-selfcheck-"))
    try:
        return _self_check(root)
    finally:
        shutil.rmtree(root, ignore_errors=True)


def _self_check(root):
    repo = os.path.join(root, "repo")
    os.mkdir(repo)
    outside = os.path.join(root, "outside.txt")
    write_text(outside, "SECRET\n")
    files = {"src.txt": "value=1\ncolor=red\n# note: harmless comment\nmode=ok\nbig=no\n",
             "crlf.txt": "a=1\r\nb=2",  # CRLF, no trailing newline: restore must be byte-exact
             "check.py": CHECK_PY}
    for n, t in files.items():
        write_text(os.path.join(repo, n), t)
    os.symlink("../outside.txt", os.path.join(repo, "link.txt"))
    git = ["git", "-C", repo, "-c", "user.name=t", "-c", "user.email=t@t"]
    for args in (["init", "-q"], ["add", "."], ["commit", "-q", "-m", "init"]):
        subprocess.run([*git, *args], check=True, capture_output=True)

    def ed(find, replace, count=1, file="src.txt"):
        return [{"file": file, "find": find, "replace": replace, "count": count}]
    mutants = [
        {"id": "killed", "edits": ed("value=1", "value=2"), "want": "test_value"},
        {"id": "killedother", "edits": ed("color=red", "color=blue"), "want": "test_value"},
        {"id": "survived", "edits": ed("harmless", "changed"), "want": "x"},
        {"id": "crlf", "edits": ed("b=2", "b=3", file="crlf.txt"), "want": "x"},
        {"id": "wrongcount", "edits": ed("value=1", "value=2", 2), "want": "x"},
        {"id": "unparsed", "edits": ed("mode=ok", "mode=boom"), "want": "x"},
        {"id": "bigoutput", "edits": ed("big=no", "big=yes"), "want": "test_big"},
    ]
    want = {"killed": "KILLED", "killedother": "KILLED-OTHER", "survived": "SURVIVED",
            "crlf": "SURVIVED", "wrongcount": "PATTERN COUNT WRONG", "unparsed": "UNPARSED",
            "bigoutput": "KILLED"}
    summary = ("killed 2, killed-other 1, survived 2, unparsed 1, wrong-pattern 1, "
               "error 0, timeout 0")
    cmd = shlex.join([sys.executable, os.path.join(repo, "check.py"), "{wt}"])
    n = [0]

    def run(lst, *extra):
        n[0] += 1
        lf, log = os.path.join(root, f"list{n[0]}.json"), os.path.join(root, f"log{n[0]}.txt")
        write_text(lf, json.dumps(lst))
        r = subprocess.run([sys.executable, os.path.abspath(__file__), "--worktree", repo, "--list", lf,
                            "--log", log, "--cmd", cmd, "--rm", "junk.tmp", *extra],
                           capture_output=True, text=True)
        return r, (read_text(log) if os.path.exists(log) else None)

    def result(log, mid):
        m = re.search(rf"^{re.escape(mid)}: ([A-Za-z -]+?)(;|$)", log or "", re.M)
        return m.group(1) if m else None

    def tree_ok():  # given tree: every tracked regular file byte-exact, nothing else changed
        same = all(open(os.path.join(repo, k), "rb").read() == v.encode() for k, v in files.items())
        return same and not git_out(repo, "status", "--short").strip()

    checks = {}
    r1, log1 = run(mutants, "--jobs", "1")
    checks["jobs 1: tool exit 0"] = r1.returncode == 0
    for i, c in want.items():
        checks[f"jobs 1: {i} is {c}"] = result(log1, i) == c
    checks["jobs 1: summary line"] = summary in (log1 or "") and "jobs 1;" in (log1 or "")
    checks["jobs 1: originals byte-exact, tree clean"] = tree_ok()

    r2, log2 = run(mutants, "--jobs", "2")
    checks["jobs 2: tool exit 0"] = r2.returncode == 0
    for i, c in want.items():
        checks[f"jobs 2: {i} is {c}"] = result(log2, i) == c
    checks["jobs 2: summary line"] = summary in (log2 or "") and "jobs 2;" in (log2 or "")
    checks["jobs 2: one removal line per job"] = (log2 or "").count("## removed job worktree") == 2
    checks["jobs 2: no job worktree left"] = (
        not [p for p in os.listdir(root) if "-mjob" in p]
        and git_out(repo, "worktree", "list").count("\n") == 1)
    checks["jobs 2: originals byte-exact, tree clean"] = tree_ok()

    r3, log3 = run([{"id": "missing", "edits": ed("a", "b", file="nope.txt"), "want": "x"},
                    mutants[0]], "--jobs", "1")
    checks["ERROR: exit 1"] = r3.returncode == 1
    checks["ERROR: line, next mutant still runs, counted"] = (
        result(log3, "missing") == "ERROR" and result(log3, "killed") == "KILLED"
        and "error 1," in (log3 or ""))
    checks["ERROR: tree clean"] = tree_ok()

    write_text(os.path.join(repo, "dirty.txt"), "x")
    r4, log4 = run(mutants, "--jobs", "1")
    os.remove(os.path.join(repo, "dirty.txt"))
    checks["dirty worktree refused (exit 2, nothing run)"] = r4.returncode == 2 and log4 is None

    bad = {"../ path": ([{**mutants[0], "edits": ed("a", "b", file="../outside.txt")}], []),
           "symlink out": ([{**mutants[0], "edits": ed("SECRET", "X", file="link.txt")}], []),
           "--rm ../": ([mutants[0]], ["--rm", "../outside.txt"]),
           "id ..": ([{**mutants[0], "id": ".."}], []),
           "id a/b": ([{**mutants[0], "id": "a/b"}], [])}
    for name, (lst, extra) in bad.items():
        r, lg = run(lst, "--jobs", "1", *extra)
        checks[f"{name} refused (exit 2, nothing run)"] = (
            r.returncode == 2 and lg is None and read_text(outside) == "SECRET\n")

    r5, log5 = run([{"id": "crlf-out", "edits": ed("mode=ok", "mode=crlf"), "want": "test_crlf"}],
                   "--jobs", "1", "--fail-re", "test_crlf$")  # CRLF output, $-anchored pattern
    checks["CRLF output with a $-anchored --fail-re is KILLED"] = result(log5, "crlf-out") == "KILLED"

    r6 = subprocess.run([sys.executable, os.path.abspath(__file__), "--worktree", root, "--list",
                         os.path.join(root, "list1.json"), "--log", os.path.join(root, "log-ng.txt"),
                         "--cmd", cmd], capture_output=True, text=True)
    checks["non-git worktree refused (exit 2)"] = r6.returncode == 2

    for name, ok in checks.items():
        print(f"{'ok  ' if ok else 'FAIL'} {name}")
    if not all(checks.values()):
        for i in range(1, n[0] + 1):
            lg = os.path.join(root, f"log{i}.txt")
            print(f"--- log{i}\n{read_text(lg) if os.path.exists(lg) else '(none)'}")
        return 1
    print("self-check passed")
    return 0


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--self-check", action="store_true", help="prove the tool's behaviour in a temp repo")
    ap.add_argument("--worktree")
    ap.add_argument("--list", dest="listfile")
    ap.add_argument("--log")
    ap.add_argument("--cmd", help="test command; {wt} = the worktree it runs against")
    ap.add_argument("--fail-re", default=r"^\(fail\)", help="regex for a failed-test line")
    ap.add_argument("--rm", action="append", default=[],
                    help="relative path deleted after every mutant (a file the test run leaves)")
    ap.add_argument("--jobs", type=int, default=None,
                    help="parallel worktrees (default min(4, mutants to run))")
    ap.add_argument("--raw-dir", default=None,
                    help="write each mutant's full test output to <dir>/<id>.txt")
    ap.add_argument("ids", nargs="*")
    a = ap.parse_args()
    if a.self_check:
        sys.exit(self_check())
    for name in ("worktree", "listfile", "log", "cmd"):
        if not getattr(a, name):
            ap.error(f"--{name.replace('listfile', 'list')} is required")

    def refuse(msg):
        print(f"refusing: {msg}", file=sys.stderr)
        sys.exit(2)

    if not os.path.isabs(a.worktree):
        raise SystemExit("--worktree must be an absolute path")
    wt = os.path.abspath(a.worktree)
    rm_paths = a.rm
    fail_re = re.compile(a.fail_re)
    cmd_tokens = shlex.split(a.cmd)  # split first, then substitute {wt} per token

    r = subprocess.run(["git", "-C", wt, "rev-parse", "--is-inside-work-tree"],
                       capture_output=True, text=True)
    if r.returncode or r.stdout.strip() != "true":
        refuse(f"not a git work tree: {wt}")

    with open(a.listfile, encoding="utf-8") as f:
        mutants = json.load(f)
    try:  # everything that names a path or a file is checked before anything is touched
        for m in mutants:
            if not ID_RE.fullmatch(m["id"]) or m["id"] in (".", ".."):
                refuse(f"bad mutant id: {m['id']!r}")
            for e in m["edits"]:
                inside(wt, e["file"])
        for rp in rm_paths:
            inside(wt, rp)
    except (ValueError, KeyError, TypeError) as ex:
        refuse(f"bad list or --rm entry: {type(ex).__name__}: {ex}")
    known = {m["id"] for m in mutants}
    missing = [i for i in a.ids if i not in known]
    if missing:
        raise SystemExit(f"unknown ids: {', '.join(missing)}")
    if a.ids:
        mutants = [m for m in mutants if m["id"] in a.ids]

    if git_out(wt, "status", "--short").strip():
        refuse(f"worktree is dirty: {wt}")
    jobs = max(1, min(a.jobs if a.jobs is not None else 4, len(mutants)))
    paths = [wt] if jobs == 1 else [f"{wt}-mjob{k}" for k in range(jobs)]
    if jobs > 1:
        busy = [p for p in paths if os.path.lexists(p)]
        if busy:
            refuse(f"leftover job worktree(s): {', '.join(busy)}")

    stop = threading.Event()
    procs = set()

    def on_signal(sig, _f):
        stop.set()
        for p in list(procs):
            try:
                os.killpg(p.pid, signal.SIGTERM)
            except OSError:
                pass
        stop.signal = sig

    # Signals stop the workers; their finally blocks still restore the originals.
    stop.signal = None
    for sig in (signal.SIGHUP, signal.SIGTERM, signal.SIGINT):
        signal.signal(sig, on_signal)

    out = open(a.log, "a", encoding="utf-8")
    lock = threading.Lock()
    counts = dict.fromkeys(CLASSES, 0)

    def log(line):
        with lock:
            out.write(line + "\n")
            out.flush()
            print(line, flush=True)

    def w(line, res=None):
        if res:
            with lock:
                counts[res] += 1
        log(line)

    t0 = time.monotonic()
    head = git_out(wt, "rev-parse", "HEAD").strip()
    now = datetime.datetime.now().isoformat(timespec="seconds")
    log(f"\n## mutation run {now}; worktree {wt}; HEAD {head}; jobs {jobs}")
    log(f"## list {a.listfile}; cmd {shlex.join(cmd_tokens)}; rm {','.join(rm_paths)}")

    made = []
    try:
        if jobs > 1:
            for p in paths:
                r = subprocess.run(["git", "-C", wt, "worktree", "add", "--detach", p, "HEAD"],
                                   capture_output=True, text=True)
                if r.returncode:
                    raise SystemExit(f"worktree add failed for {p}: {r.stderr.strip()}")
                made.append(p)
        shares = [mutants[k::jobs] for k in range(jobs)]
        threads = [threading.Thread(target=run_share,
                                    args=(p, sh, a, rm_paths, cmd_tokens, fail_re, w, stop, procs))
                   for p, sh in zip(paths, shares)]
        for t in threads:
            t.start()
        for t in threads:
            while t.is_alive():
                t.join(0.5)
    finally:
        for p in paths:
            if not os.path.isdir(p):
                continue
            st = git_out(p, "status", "--short").strip()
            log(f"## tree after run{'' if jobs == 1 else ' ' + p}: " + (st if st else "clean"))
            log(f"## HEAD after run{'' if jobs == 1 else ' ' + p}: {git_out(p, 'rev-parse', 'HEAD').strip()}")
        for p in made:
            if git_out(p, "status", "--short").strip():
                log(f"## KEPT dirty job worktree {p}")
                continue
            r = subprocess.run(["git", "-C", wt, "worktree", "remove", p],
                               capture_output=True, text=True)
            log(f"## removed job worktree {p}" if r.returncode == 0
                else f"## KEPT job worktree {p}: {r.stderr.strip()}")

    log(f"killed {counts['KILLED']}, killed-other {counts['KILLED-OTHER']}, "
        f"survived {counts['SURVIVED']}, unparsed {counts['UNPARSED']}, "
        f"wrong-pattern {counts['PATTERN COUNT WRONG']}, error {counts['ERROR']}, "
        f"timeout {counts['TIMEOUT']}; jobs {jobs}; wall {time.monotonic() - t0:.0f}s")
    out.close()
    if stop.signal:
        sys.exit(128 + stop.signal)
    if counts["ERROR"]:
        sys.exit(1)


if __name__ == "__main__":
    main()
