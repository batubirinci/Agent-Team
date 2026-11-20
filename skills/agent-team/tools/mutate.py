#!/usr/bin/env python3
"""Run a list of source mutants against one worktree, one test run per mutant.

Usage:
  python3 mutate.py --worktree <abs path> --list <mutants.json> --log <log file>
                    --cmd "<test command, {wt} = worktree>" [--jobs N]
                    [--fail-re REGEX] [--rm <relative path>]... [--raw-dir DIR] [id ...]
  python3 mutate.py --self-check      (temp git repo, no network, a few seconds; exit 0 = all hold)

List: JSON array of {"id": str, "edits": [{"file": rel path, "find": str,
"replace": str, "count": int}], "want": str}. `want` is a substring of the fail line the mutant
should trip. Stdlib only.

Contract (each item has a --self-check case):
 1. Refused with exit 2 before anything runs or is touched: a --worktree that is relative, not a
    git work tree, not its top level, or dirty; a leftover <worktree>-mjob<k>; an id that is not
    [A-Za-z0-9._-]+, is . or .., or is listed twice; an unknown id argument; an edit file that is
    absolute or resolves outside the worktree (symlinks resolved); an --rm path that is absolute,
    names . / .. / nothing, or whose parent resolves outside the worktree.
 2. Each mutant: every `find` must occur exactly `count` times in the original file, else
    `<id>: PATTERN COUNT WRONG` and nothing is written or run. Else the edits are written, the test
    command runs with stdout+stderr to a temporary file (no pipe, output of any size is kept).
 3. Cleanup after every mutant: each file actually written is put back byte-exact; a restore never
    writes through a symlink or to a path that now resolves elsewhere (that is a restore failure).
    Then each --rm entry is removed itself (a symlink as a link, never its target; a file only, not
    a directory), its parent re-checked inside the worktree at each removal.
 4. One result line per id, written after cleanup. Classes:
      KILLED        a fail line (--fail-re, default `^\\(fail\\)`, the bun / `claude plugin test`
                    format) contains `want`
      KILLED-OTHER  fail lines, none contains `want`
      SURVIVED      exit 0, no fail lines
      UNPARSED      exit != 0 without fail lines (crash or harness error, not a survivor)
      TIMEOUT       the run passed 600 s
      PATTERN COUNT WRONG  see 2
      ERROR         the tool failed on this mutant (missing file, command cannot start, a cleanup
                    failure — the line keeps the result from before cleanup); the worker goes on
 5. A restore failure stops that worker: each remaining id of its share gets
    `<id>: ERROR; not run: tree not restored`. Exit 1 when any ERROR happened.
 6. --jobs N (default min(4, mutants to run)): N detached worktrees <worktree>-mjob<k> of HEAD,
    mutants split round-robin, run in parallel; each removed after the run if clean (else kept and
    logged). --jobs 1 runs in the given worktree. The last line counts each class.
 7. --raw-dir DIR: each mutant's exit code and full test output go to DIR/<id>.txt.
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
    """Write `text`; never through a symlink at `path` (O_NOFOLLOW: the open fails instead)."""
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o644)
    with open(fd, "w", encoding="utf-8", newline="") as f:
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


def rm_target(wt, rel):
    """Path of the --rm entry itself: its parent is resolved and must be in the worktree, the
    entry is not (a symlink is removed as a link, never what it points to)."""
    if os.path.isabs(rel):
        raise ValueError(f"path must be relative to the worktree: {rel}")
    root = os.path.realpath(wt)
    parent = os.path.realpath(os.path.dirname(os.path.join(root, rel)))
    name = os.path.basename(rel)
    if name in ("", ".", "..") or not (parent == root or parent.startswith(root + os.sep)):
        raise ValueError(f"path escapes the worktree: {rel}")
    return os.path.join(parent, name)


def git_out(wt, *args):
    return subprocess.run(["git", "-C", wt, *args], capture_output=True, text=True).stdout


def test_mutant(wt, m, a, cmd, fail_re, stop, procs, originals, written):
    """Apply one mutant and run the test; -> its result line and class, or (None, None) when
    stopped by a signal. Fills `written` before each write so cleanup knows what to restore."""
    mid, want = m["id"], m.get("want", "")
    for e in m["edits"]:
        p = inside(wt, e["file"])
        if p not in originals:
            originals[p] = (e["file"], read_text(p))
    if any(originals[inside(wt, e["file"])][1].count(e["find"]) != e["count"] for e in m["edits"]):
        return f"{mid}: PATTERN COUNT WRONG", "PATTERN COUNT WRONG"
    cur = {p: text for p, (_, text) in originals.items()}
    for e in m["edits"]:
        p = inside(wt, e["file"])
        cur[p] = cur[p].replace(e["find"], e["replace"])
    for p, text in cur.items():
        written[p] = originals[p]
        write_text(p, text)
    with tempfile.TemporaryFile() as of:  # a regular file: no pipe, no size cut
        proc = subprocess.Popen(cmd, stdout=of, stderr=subprocess.STDOUT, start_new_session=True)
        procs.add(proc)
        try:
            proc.wait(timeout=TIMEOUT_S)
        except subprocess.TimeoutExpired:
            try:
                os.killpg(proc.pid, signal.SIGKILL)
            except OSError:
                pass
            proc.wait()
            return f"{mid}: TIMEOUT; exit none; 0 failed; want {want}; got ; crash-lines no", "TIMEOUT"
        finally:
            procs.discard(proc)
        of.seek(0)
        txt = of.read().decode("utf-8", "replace")
    if stop.is_set():
        return None, None
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
    return (f"{mid}: {res}; exit {rc}; {len(fails)} failed; want {want}; "
            f"got {','.join(names)}; crash-lines {'yes' if crash else 'no'}"), res


def restore(wt, p, rel, text):
    """Put `text` back at `p` unless it is already there; a path that now resolves elsewhere or
    is a symlink is refused (ValueError), never written through."""
    if inside(wt, rel) != p or os.path.islink(p):
        raise ValueError(f"{rel} is now a symlink or resolves elsewhere")
    if not os.path.lexists(p) or read_text(p) != text:
        write_text(p, text)


def run_one(wt, m, a, rm_paths, cmd, fail_re, stop, procs):
    """One mutant, cleaned up -> (result line or None, class, tree restored?)."""
    mid = m["id"]
    originals, written, errs = {}, {}, []
    line = cls = None
    try:
        line, cls = test_mutant(wt, m, a, cmd, fail_re, stop, procs, originals, written)
    except Exception as ex:  # one bad mutant must not drop the rest
        line, cls = f"{mid}: ERROR; {type(ex).__name__}: {ex}", "ERROR"
    finally:
        restored = True
        for p, (rel, text) in written.items():
            try:
                restore(wt, p, rel, text)
            except (OSError, ValueError) as ex:
                restored = False
                errs.append(f"restore of {rel} failed: {ex}")
        for rp in rm_paths:
            try:
                fp = rm_target(wt, rp)
                if os.path.lexists(fp):
                    os.remove(fp)
            except (OSError, ValueError) as ex:
                errs.append(f"rm {rp} failed: {ex}")
    if errs:
        before = line[len(mid) + 2:] if line else "none"
        line, cls = f"{mid}: ERROR; {'; '.join(errs)}; before cleanup: {before}", "ERROR"
    return line, cls, restored


def run_share(wt, mutants, a, rm_paths, cmd_tokens, fail_re, w, stop, procs):
    """Run one share of mutants in worktree `wt`, one result line each."""
    cmd = [t.replace("{wt}", wt) for t in cmd_tokens]
    for k, m in enumerate(mutants):
        if stop.is_set():
            return
        line, cls, restored = run_one(wt, m, a, rm_paths, cmd, fail_re, stop, procs)
        if line:
            w(line, cls)
        if not restored:  # no mutant runs on a tree that was not put back
            for rest in mutants[k + 1:]:
                w(f"{rest['id']}: ERROR; not run: tree not restored", "ERROR")
            return


CHECK_PY = """\
import os, shutil, stat, sys
wt = sys.argv[1]
s = open(wt + '/src.txt').read()
open(wt + '/sub/junk.tmp', 'w').write('x')
out, rc = 'all pass\\n', 0
if 'swap=yes' in open(wt + '/swap.txt').read():  # the test swaps an edited file for a link out
    os.remove(wt + '/swap.txt')
    os.symlink('../outside.txt', wt + '/swap.txt')
if 'f=2' in open(wt + '/lnk/f.txt').read():  # ... or an edited file's directory for a link out
    shutil.rmtree(wt + '/lnk')
    os.symlink('../outside_dir', wt + '/lnk')
if 'big=yes' in s:
    out, rc = ('x' * 99 + '\\n') * 1100 + '(fail) test_big\\n', 1
elif 'mode=boom' in s:
    out, rc = 'harness crashed\\n', 3
elif 'mode=link' in s:
    os.symlink('src.txt', wt + '/rmlink')
    os.symlink('nowhere', wt + '/rmdang')
elif 'mode=dyn' in s:  # the test makes an --rm parent a link out of the tree
    os.symlink('../outside_dir', wt + '/dyn')
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
    outside = {os.path.join(root, "outside.txt"): "SECRET\n",
               os.path.join(root, "outside_dir", "victim.txt"): "VICTIM\n",
               os.path.join(root, "repo_evil", "x.txt"): "EVIL\n"}  # a sibling sharing the prefix
    for p, t in outside.items():
        os.makedirs(os.path.dirname(p), exist_ok=True)
        write_text(p, t)
    files = {"src.txt": "value=1\ncolor=red\n# note: harmless comment\nmode=ok\nbig=no\n",
             "crlf.txt": "a=1\r\nb=2",  # CRLF, no trailing newline: restore must be byte-exact
             "ro.txt": "r=1\n", "swap.txt": "swap=no\n", "sub/keep.txt": "k\n", "lnk/f.txt": "f=1\n",
             "check.py": CHECK_PY}
    for d in ("sub", "lnk"):
        os.mkdir(os.path.join(repo, d))
    for n, t in files.items():
        write_text(os.path.join(repo, n), t)
    os.symlink("../outside.txt", os.path.join(repo, "link.txt"))
    os.symlink("../outside_dir", os.path.join(repo, "symdir"))
    git = ["git", "-C", repo, "-c", "user.name=t", "-c", "user.email=t@t"]
    for args in (["init", "-q"], ["add", "."], ["commit", "-q", "-m", "init"]):
        subprocess.run([*git, *args], check=True, capture_output=True)

    def ed(find, replace, count=1, file="src.txt"):
        return [{"file": file, "find": find, "replace": replace, "count": count}]

    def mu(mid, edits, want="x"):
        return {"id": mid, "edits": edits, "want": want}
    mutants = [
        mu("killed", ed("value=1", "value=2"), "test_value"),
        mu("killedother", ed("color=red", "color=blue"), "test_value"),
        mu("survived", ed("harmless", "changed")),
        mu("crlf", ed("b=2", "b=3", file="crlf.txt")),
        mu("wrongcount", ed("value=1", "value=2", 2)),
        mu("unparsed", ed("mode=ok", "mode=boom")),
        mu("bigoutput", ed("big=no", "big=yes"), "test_big"),
    ]
    want = {"killed": "KILLED", "killedother": "KILLED-OTHER", "survived": "SURVIVED",
            "crlf": "SURVIVED", "wrongcount": "PATTERN COUNT WRONG", "unparsed": "UNPARSED",
            "bigoutput": "KILLED"}
    summary = ("killed 2, killed-other 1, survived 2, unparsed 1, wrong-pattern 1, "
               "error 0, timeout 0")
    cmd = shlex.join([sys.executable, os.path.join(repo, "check.py"), "{wt}"])
    n = [0]

    def run(lst, *extra, wt=repo, c=cmd):
        n[0] += 1
        lf, log = os.path.join(root, f"list{n[0]}.json"), os.path.join(root, f"log{n[0]}.txt")
        write_text(lf, json.dumps(lst))
        r = subprocess.run([sys.executable, os.path.abspath(__file__), "--worktree", wt, "--list", lf,
                            "--log", log, "--cmd", c, "--rm", "sub/junk.tmp", *extra],
                           capture_output=True, text=True, cwd=root)
        return r, (read_text(log) if os.path.exists(log) else None)

    def line(log, mid):  # the one result line of `mid`; None unless there is exactly one
        found = [l for l in (log or "").splitlines() if l.startswith(mid + ":")]
        return found[0] if len(found) == 1 else None

    def result(log, mid):
        m = re.match(rf"{re.escape(mid)}: ([A-Za-z -]+?)(;|$)", line(log, mid) or "")
        return m.group(1) if m else None

    def tree_ok():  # given tree: every tracked regular file byte-exact, nothing else changed
        same = all(os.path.exists(os.path.join(repo, k))
                   and open(os.path.join(repo, k), "rb").read() == v.encode() for k, v in files.items())
        return same and not git_out(repo, "status", "--short").strip()

    def outside_ok():  # every outside file as it was, no new file next to them
        return (all(os.path.exists(p) and read_text(p) == t for p, t in outside.items())
                and sorted(os.listdir(os.path.join(root, "outside_dir"))) == ["victim.txt"])

    checks = {}
    raw = os.path.join(root, "raw")
    r1, log1 = run(mutants, "--jobs", "1", "--raw-dir", raw)
    checks["jobs 1: tool exit 0"] = r1.returncode == 0
    for i, c in want.items():
        checks[f"jobs 1: {i} is {c}, one line"] = result(log1, i) == c
    checks["jobs 1: summary line"] = summary in (log1 or "") and "jobs 1;" in (log1 or "")
    checks["jobs 1: originals byte-exact, tree clean"] = tree_ok()
    rawf = os.path.join(raw, "killed.txt")
    checks["--raw-dir: <id>.txt has exit code and output"] = (
        os.path.exists(rawf) and read_text(rawf) == "exit 1\n(fail) test_value\n")

    r2, log2 = run(mutants, "--jobs", "2")
    checks["jobs 2: tool exit 0"] = r2.returncode == 0
    for i, c in want.items():
        checks[f"jobs 2: {i} is {c}, one line"] = result(log2, i) == c
    checks["jobs 2: summary line"] = summary in (log2 or "") and "jobs 2;" in (log2 or "")
    checks["jobs 2: one removal line per job"] = (log2 or "").count("## removed job worktree") == 2
    checks["jobs 2: no job worktree left"] = (
        not [p for p in os.listdir(root) if "-mjob" in p]
        and git_out(repo, "worktree", "list").count("\n") == 1)
    checks["jobs 2: originals byte-exact, tree clean"] = tree_ok()

    r3, log3 = run([mu("missing", ed("a", "b", file="nope.txt")), mutants[0]], "--jobs", "1")
    checks["ERROR: exit 1"] = r3.returncode == 1
    checks["ERROR: line, next mutant still runs, counted"] = (
        result(log3, "missing") == "ERROR" and result(log3, "killed") == "KILLED"
        and "error 1," in (log3 or ""))
    checks["ERROR: tree clean"] = tree_ok()

    r4, log4 = run([mutants[0]], "--jobs", "1", c=shlex.join([os.path.join(root, "no-such-cmd"), "{wt}"]))
    checks["--cmd cannot start: ERROR line, exit 1, edits restored byte-exact"] = (
        r4.returncode == 1 and result(log4, "killed") == "ERROR" and tree_ok())

    # Cleanup failures: one line per id, nothing restored that was not written, worker goes on.
    os.chmod(os.path.join(repo, "ro.txt"), 0o444)
    r5, log5 = run([mu("rohalf", ed("value=1", "value=2") + ed("r=1", "r=2", file="ro.txt")),
                    mu("ropcw", ed("r=1", "r=2", 2, file="ro.txt")),
                    mu("dyn", ed("mode=ok", "mode=dyn")), mutants[0]],
                   "--jobs", "1", "--rm", "dyn/victim.txt", "--rm", "dyn")
    os.chmod(os.path.join(repo, "ro.txt"), 0o644)
    checks["failed write: one ERROR line, the written file restored"] = (
        result(log5, "rohalf") == "ERROR" and "restore" not in (line(log5, "rohalf") or ""))
    checks["PATTERN COUNT WRONG on a read-only file: one line, nothing restored"] = (
        result(log5, "ropcw") == "PATTERN COUNT WRONG")
    checks["--rm under a parent the test linked out: one ERROR line with the earlier result"] = (
        result(log5, "dyn") == "ERROR"
        and "before cleanup: SURVIVED" in (line(log5, "dyn") or ""))
    checks["cleanup failures: next mutant still runs, exit 1, counts match lines"] = (
        result(log5, "killed") == "KILLED" and r5.returncode == 1
        and "killed 1, killed-other 0, survived 0, unparsed 0, wrong-pattern 1, error 2," in (log5 or ""))
    checks["cleanup failures: tree clean, nothing outside touched"] = tree_ok() and outside_ok()

    r6, log6 = run([mu("swap", ed("swap=no", "swap=yes", file="swap.txt")), mutants[0]], "--jobs", "1")
    checks["restore refused through a test-swapped symlink: one ERROR line"] = (
        result(log6, "swap") == "ERROR" and "before cleanup: SURVIVED" in (line(log6, "swap") or ""))
    checks["after a failed restore the rest of the share is not run"] = (
        line(log6, "killed") == "killed: ERROR; not run: tree not restored" and r6.returncode == 1)
    checks["failed restore: nothing outside written"] = outside_ok()
    reset = ["git", "-C", repo, "checkout", "--"]
    if os.path.islink(os.path.join(repo, "swap.txt")):
        os.remove(os.path.join(repo, "swap.txt"))
    subprocess.run([*reset, "swap.txt"], capture_output=True)
    r6b, log6b = run([mu("swapdir", ed("f=1", "f=2", file="lnk/f.txt"))], "--jobs", "1")
    checks["restore refused under a test-swapped directory link: ERROR, nothing outside written"] = (
        result(log6b, "swapdir") == "ERROR" and r6b.returncode == 1 and outside_ok())
    if os.path.islink(os.path.join(repo, "lnk")):
        os.remove(os.path.join(repo, "lnk"))
    subprocess.run([*reset, "lnk"], capture_output=True)
    checks["failed restore: tree clean after manual reset"] = tree_ok()

    r7, log7 = run([mu("rmlink", ed("mode=ok", "mode=link"))],
                   "--jobs", "1", "--rm", "rmlink", "--rm", "rmdang")  # the test leaves two links
    checks["--rm removes in-tree and dangling symlinks as links, not their targets"] = (
        r7.returncode == 0 and result(log7, "rmlink") == "SURVIVED"
        and not os.path.lexists(os.path.join(repo, "rmlink"))
        and not os.path.lexists(os.path.join(repo, "rmdang")) and tree_ok())

    r8, log8 = run([mu("crlf-out", ed("mode=ok", "mode=crlf"), "test_crlf")],
                   "--jobs", "1", "--fail-re", "test_crlf$")  # CRLF output, $-anchored pattern
    checks["CRLF output with a $-anchored --fail-re is KILLED"] = result(log8, "crlf-out") == "KILLED"

    k = mutants[0]
    bad = {"edit ../": ([mu("k", ed("a", "b", file="../outside.txt"))], [], repo),
           "edit through a tracked symlink out": ([mu("k", ed("SECRET", "X", file="link.txt"))], [], repo),
           "edit absolute in-tree path": ([mu("k", ed("value=1", "value=2", file=os.path.join(repo, "src.txt")))], [], repo),
           "edit in a sibling with the same prefix": ([mu("k", ed("EVIL", "X", file="../repo_evil/x.txt"))], [], repo),
           "--rm ../": ([k], ["--rm", "../outside.txt"], repo),
           "--rm under a tracked symlinked parent": ([k], ["--rm", "symdir/victim.txt"], repo),
           "--rm in a sibling with the same prefix": ([k], ["--rm", "../repo_evil/x.txt"], repo),
           "--rm absolute in-tree path": ([k], ["--rm", os.path.join(repo, "sub", "junk.tmp")], repo),
           "--rm ..": ([k], ["--rm", ".."], repo),
           "--rm .": ([k], ["--rm", "."], repo),
           "--rm empty": ([k], ["--rm", ""], repo),
           "id ..": ([{**k, "id": ".."}], [], repo),
           "id .": ([{**k, "id": "."}], [], repo),
           "id a/b": ([{**k, "id": "a/b"}], [], repo),
           "duplicate id": ([k, k], [], repo),
           "unknown id argument": ([k], ["nosuchid"], repo),
           "relative --worktree": ([k], [], "repo"),
           "--worktree a subdirectory": ([k], [], os.path.join(repo, "sub")),
           "--worktree inside .git": ([k], [], os.path.join(repo, ".git")),
           "--worktree not in git": ([k], [], root)}
    for name, (lst, extra, wt) in bad.items():
        r, lg = run(lst, "--jobs", "1", *extra, wt=wt)
        checks[f"{name}: refused (exit 2, nothing run)"] = (
            r.returncode == 2 and lg is None and outside_ok() and tree_ok())

    write_text(os.path.join(repo, "dirty.txt"), "x")
    r9, log9 = run(mutants, "--jobs", "1")
    os.remove(os.path.join(repo, "dirty.txt"))
    checks["dirty worktree: refused (exit 2, nothing run)"] = r9.returncode == 2 and log9 is None

    left = repo + "-mjob0"
    os.makedirs(left, exist_ok=True)  # may be there already when a job worktree was kept
    write_text(os.path.join(left, "f"), "x")
    r10, log10 = run(mutants, "--jobs", "2")
    shutil.rmtree(left)
    checks["leftover job worktree: refused (exit 2, nothing run)"] = (
        r10.returncode == 2 and log10 is None and tree_ok())

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
                    help="relative path of a file deleted after every mutant (one the test run leaves)")
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
        refuse(f"--worktree must be an absolute path: {a.worktree}")
    wt = os.path.abspath(a.worktree)
    rm_paths = a.rm
    fail_re = re.compile(a.fail_re)
    cmd_tokens = shlex.split(a.cmd)  # split first, then substitute {wt} per token

    r = subprocess.run(["git", "-C", wt, "rev-parse", "--show-toplevel"], capture_output=True, text=True)
    if r.returncode or os.path.realpath(r.stdout.strip()) != os.path.realpath(wt):
        refuse(f"not the top level of a git work tree: {wt}")

    with open(a.listfile, encoding="utf-8") as f:
        mutants = json.load(f)
    try:  # everything that names a path or a file is checked before anything is touched
        seen = set()
        for m in mutants:
            if not ID_RE.fullmatch(m["id"]) or m["id"] in (".", ".."):
                refuse(f"bad mutant id: {m['id']!r}")
            if m["id"] in seen:
                refuse(f"duplicate mutant id: {m['id']!r}")
            seen.add(m["id"])
            for e in m["edits"]:
                inside(wt, e["file"])
        for rp in rm_paths:
            rm_target(wt, rp)
    except (ValueError, KeyError, TypeError) as ex:
        refuse(f"bad list or --rm entry: {type(ex).__name__}: {ex}")
    missing = [i for i in a.ids if i not in seen]
    if missing:
        refuse(f"unknown ids: {', '.join(missing)}")
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

    # Signals stop the workers; each still cleans up its current mutant.
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

    def w(line, res):
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
