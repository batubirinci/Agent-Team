#!/usr/bin/env python3
"""Run a list of source mutants against one worktree, one test run per mutant.

Usage:
  python3 mutate.py --worktree <abs path> --list <mutants.json> --log <log file>
                    --cmd "<test command, {wt} = worktree>" [--jobs N]
                    [--fail-re REGEX] [--rm <relative path>]... [--raw-dir DIR] [id ...]
  python3 mutate.py --self-check      (temp git repo, no network, a few seconds; exit 0 = all hold)

List: JSON array of {"id": str, "edits": [{"file": rel path, "find": str,
"replace": str, "count": int}], "want": str}. `want` is a substring of the fail line the
mutant should trip.

Per mutant: every `find` must occur exactly `count` times in the original file, else the line
is `<id>: PATTERN COUNT WRONG` and nothing runs. Edits are applied, the test command runs (its
stdout+stderr go to a temporary file, not a pipe, so output of any size is kept), and the
originals are ALWAYS restored in a finally block, byte-exact. Result classes, one line each:
  KILLED        a fail line (--fail-re, default `^\\(fail\\)`, the bun / `claude plugin test`
                format) contains `want`
  KILLED-OTHER  fail lines, none contains `want`
  SURVIVED      exit 0, no fail lines
  UNPARSED      exit != 0 without fail lines (crash or harness error, not a survivor)
  TIMEOUT       the run passed 600 s
  PATTERN COUNT WRONG  see above

--jobs N (default min(4, mutants to run)): N detached worktrees <worktree>-mjob<k> of HEAD, mutants
split round-robin, run in parallel; removed after the run if clean (else kept and logged).
--jobs 1 runs in the given worktree. A dirty given worktree is refused (exit 2). --rm paths
(e.g. a file the test run leaves behind) are deleted after every mutant. Stdlib only.
"""
import argparse
import datetime
import json
import os
import re
import shlex
import signal
import subprocess
import sys
import tempfile
import threading
import time

CRASH = re.compile(r"TypeError|ReferenceError|SyntaxError")
TIMEOUT_S = 600
CLASSES = ("KILLED", "KILLED-OTHER", "SURVIVED", "UNPARSED", "PATTERN COUNT WRONG", "TIMEOUT")


def read_text(path):
    with open(path, encoding="utf-8", newline="") as f:
        return f.read()


def write_text(path, text):
    with open(path, "w", encoding="utf-8", newline="") as f:
        f.write(text)


def inside(wt, rel):
    if os.path.isabs(rel):
        raise SystemExit(f"path must be relative to the worktree: {rel}")
    full = os.path.normpath(os.path.join(wt, rel))
    if not full.startswith(os.path.normpath(wt) + os.sep):
        raise SystemExit(f"path escapes the worktree: {rel}")
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
        edits = m["edits"]
        originals = {}
        for e in edits:
            p = inside(wt, e["file"])
            if p not in originals:
                originals[p] = read_text(p)
        bad = [e for e in edits
               if originals[inside(wt, e["file"])].count(e["find"]) != e["count"]]
        if bad:
            w(f"{mid}: PATTERN COUNT WRONG", "PATTERN COUNT WRONG")
            continue
        try:
            cur = dict(originals)
            for e in edits:
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
                    os.killpg(proc.pid, signal.SIGKILL)
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
            lines = txt.split("\n")
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
        finally:
            for p, text in originals.items():
                write_text(p, text)
            for rp in rm_paths:
                fp = inside(wt, rp)
                if os.path.lexists(fp):
                    os.remove(fp)


def self_check():
    """Build a tiny git repo, run this tool on it, assert every promised behaviour."""
    root = os.path.realpath(tempfile.mkdtemp(prefix="mutate-selfcheck-"))
    repo = os.path.join(root, "repo")
    os.mkdir(repo)
    big = "x" * 100 + "\\n"
    # The "test suite": prints fail lines for a wrong value, a crash with no fail line, or 100 KiB
    # of noise with the fail line last; always leaves junk.tmp behind (tests --rm).
    files = {
        "src.txt": "value=1\ncolor=red\n# note: harmless comment\nmode=ok\nbig=no\n",
        "check.py": (
            "import sys\n"
            "s = open(sys.argv[1] + '/src.txt').read()\n"
            "open(sys.argv[1] + '/junk.tmp', 'w').write('x')\n"
            "if 'big=yes' in s:\n"
            f"    sys.stdout.write('{big}' * 1100)\n"
            "    print('(fail) test_big'); sys.exit(1)\n"
            "if 'mode=boom' in s:\n"
            "    print('Traceback: harness crashed'); sys.exit(3)\n"
            "if 'value=1' not in s:\n"
            "    print('(fail) test_value'); sys.exit(1)\n"
            "print('all pass')\n"),
    }
    for n, t in files.items():
        write_text(os.path.join(repo, n), t)
    git = ["git", "-C", repo, "-c", "user.name=t", "-c", "user.email=t@t"]
    for args in (["init", "-q"], ["add", "."], ["commit", "-q", "-m", "init"]):
        subprocess.run([*git, *args], check=True, capture_output=True)

    def ed(find, replace, count=1):
        return [{"file": "src.txt", "find": find, "replace": replace, "count": count}]
    mutants = [
        {"id": "killed", "edits": ed("value=1", "value=2"), "want": "test_value"},
        {"id": "survived", "edits": ed("harmless", "changed"), "want": "x"},
        {"id": "wrongcount", "edits": ed("value=1", "value=2", 2), "want": "x"},
        {"id": "unparsed", "edits": ed("mode=ok", "mode=boom"), "want": "x"},
        {"id": "bigoutput", "edits": ed("big=no", "big=yes"), "want": "test_big"},
    ]
    lst, log = os.path.join(root, "list.json"), os.path.join(root, "log.txt")
    write_text(lst, json.dumps(mutants))
    r = subprocess.run([sys.executable, os.path.abspath(__file__), "--worktree", repo, "--list", lst,
                        "--log", log, "--cmd", f"{sys.executable} {repo}/check.py {{wt}}",
                        "--rm", "junk.tmp", "--jobs", "2"], capture_output=True, text=True)
    out = read_text(log) if os.path.exists(log) else ""
    want = {"killed": "KILLED", "survived": "SURVIVED", "wrongcount": "PATTERN COUNT WRONG",
            "unparsed": "UNPARSED", "bigoutput": "KILLED"}
    got = {i: any(l.startswith(f"{i}: {c}") for l in out.split("\n")) for i, c in want.items()}
    checks = {f"{i} is {c}": got[i] for i, c in want.items()}
    checks["tool exit 0"] = r.returncode == 0
    checks["originals restored"] = read_text(os.path.join(repo, "src.txt")) == files["src.txt"]
    checks["given tree clean"] = not git_out(repo, "status", "--short").strip()
    checks["job worktrees removed"] = (
        not [p for p in os.listdir(root) if "-mjob" in p]
        and git_out(repo, "worktree", "list").count("\n") == 1)
    checks["summary line"] = "killed 2," in out and "survived 1," in out and "unparsed 1," in out
    for name, ok in checks.items():
        print(f"{'ok  ' if ok else 'FAIL'} {name}")
    if not all(checks.values()):
        print(r.stdout, r.stderr, out)
        return 1
    subprocess.run(["rm", "-rf", root])
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

    if not os.path.isabs(a.worktree):
        raise SystemExit("--worktree must be an absolute path")
    wt = os.path.abspath(a.worktree)
    rm_paths = a.rm
    fail_re = re.compile(a.fail_re)
    cmd_tokens = shlex.split(a.cmd)  # split first, then substitute {wt} per token

    with open(a.listfile, encoding="utf-8") as f:
        mutants = json.load(f)
    known = {m["id"] for m in mutants}
    missing = [i for i in a.ids if i not in known]
    if missing:
        raise SystemExit(f"unknown ids: {', '.join(missing)}")
    if a.ids:
        mutants = [m for m in mutants if m["id"] in a.ids]

    if git_out(wt, "status", "--short").strip():
        print(f"refusing: worktree is dirty: {wt}", file=sys.stderr)
        sys.exit(2)
    jobs = max(1, min(a.jobs if a.jobs is not None else 4, len(mutants)))
    paths = [wt] if jobs == 1 else [f"{wt}-mjob{k}" for k in range(jobs)]
    if jobs > 1:
        busy = [p for p in paths if os.path.lexists(p)]
        if busy:
            print(f"refusing: leftover job worktree(s): {', '.join(busy)}", file=sys.stderr)
            sys.exit(2)

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
        f"wrong-pattern {counts['PATTERN COUNT WRONG']}, timeout {counts['TIMEOUT']}; "
        f"jobs {jobs}; wall {time.monotonic() - t0:.0f}s")
    out.close()
    if stop.signal:
        sys.exit(128 + stop.signal)


if __name__ == "__main__":
    main()
