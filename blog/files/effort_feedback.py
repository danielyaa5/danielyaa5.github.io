#!/usr/bin/env python3
"""Effort feedback: how your Claude Code effort and model choices worked out.

Reads the Claude Code transcripts under ~/.claude/projects and prints aggregate
feedback on the effort levels and models you used. It only reads files, and it
prints no prompts, code, file names or project names.

Usage: python3 effort_feedback.py [--days N | --since DATE --until DATE] [--min-turns N] [--root PATH]
                                 [--model TEXT] [--entrypoint NAMES] [--typed-only] [--details] [--fanout]
                                 [--export PATH]

--typed-only counts only prompts a person typed in their own session: it skips background task
notices, scheduled triggers and other app-injected turns (their work stays with the prompt before
them), and leaves out whole sessions driven from a Claude project thread, where another Claude
picked the effort level.

--details adds counts, 95% ranges, Fisher exact p-values, failure reasons, time per prompt,
change sizes and same-session comparisons, plus the subagent section below.

--fanout adds a section on subagents: each subagent run is linked to the prompt it started
under, and every model request, main thread and subagent, is priced with its input, cache
writes, cache reads and generated tokens. Prices are API list prices, used only as a stand-in
for how a plan's usage limits weigh tokens, which Anthropic doesn't publish.

--export writes one JSON line per prompt with numbers only (effort, model, kind of work,
tokens, cost, subagent runs, duration, files and lines changed, outcome flags, a hashed session
id); no prompt text, code, file names or project names.
"""
import argparse
import bisect
import hashlib
import json
import math
import os
import re
import statistics
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone

EFFORT_ORDER = ["low", "medium", "high", "xhigh", "max"]
EDIT_TOOLS = {"Edit", "MultiEdit", "Write", "NotebookEdit"}
SHELL_TOOLS = {"Bash", "BashOutput", "PowerShell"}
DELEGATE_TOOLS = {"Task", "Agent"}
BUILTIN_AGENTS = {"general-purpose", "Explore", "Plan", "statusline-setup", "claude-code-guide", "fork"}
# API list prices per million tokens: input, generated, cache read. Cache writes cost 1.25x input
# (5-minute) or 2x input (1-hour). From Anthropic's price list, October 2026. First match wins.
PRICES = [
    ("fable-5-1", 10, 50, 0.25), ("mythos-5-1", 10, 50, 0.25), ("fable-5", 10, 50, 1.00), ("mythos-5", 10, 50, 1.00),
    ("opus-5-5", 4, 20, 0.20), ("opus-5", 5, 25, 0.50), ("opus-4-1", 15, 75, 1.50), ("opus-4", 5, 25, 0.50),
    ("sonnet-5-5", 2, 10, 0.20), ("sonnet-5", 2, 10, 0.20), ("sonnet-4", 3, 15, 0.30),
    ("haiku-5-5", 0.10, 0.50, 0.01), ("haiku-4", 1, 5, 0.10),
]
DEFAULT_PRICE = (4, 20, 0.20)
PART_NAMES = ["input", "cache writes (5 min)", "cache writes (1 hour)", "cache reads", "generated (incl. thinking)"]
CATEGORY_ORDER = ["Questions", "Exploration", "Shell and tests", "Small edits", "Larger changes", "Debugging",
                  "Delegation"]

DEBUG_RE = re.compile(
    r"\b(bug|bugs|error|errors|fix|fails?|failing|failed|broken|crash(es|ed)?|exception|"
    r"traceback|stack ?trace|doesn'?t work|not working|regression)\b", re.I)
# A follow-up that reads like "that didn't work". Checked on the first 300 characters only.
CORRECTION_RE = re.compile(
    r"^\s*(no\b|nope\b|wrong\b|not quite\b|still\b|undo\b|revert\b|try again\b|that'?s (not|wrong)\b)|"
    r"\b(still (broken|failing|not working|wrong|doesn'?t|isn'?t)|didn'?t work|doesn'?t work|isn'?t working|"
    r"not working|you broke|that broke|broke it|is wrong|was wrong|incorrect|you missed|you forgot)\b", re.I)


def parse_time(value):
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def price(model):
    name = (model or "").lower()
    for key, cost_in, cost_out, cost_read in PRICES:
        if key in name:
            return cost_in, cost_out, cost_read
    return DEFAULT_PRICE


def usage_parts(usage):
    """Input, 5-minute cache writes, 1-hour cache writes, cache reads and generated tokens."""
    def num(source, key):
        try:
            return int(source.get(key) or 0)
        except (AttributeError, TypeError, ValueError):
            return 0
    written = num(usage, "cache_creation_input_tokens")
    detail = usage.get("cache_creation") if isinstance(usage.get("cache_creation"), dict) else None
    hour = min(written, num(detail, "ephemeral_1h_input_tokens")) if detail else 0
    return [num(usage, "input_tokens"), written - hour, hour, num(usage, "cache_read_input_tokens"),
            num(usage, "output_tokens")]


def cost_parts(calls):
    """Summed tokens and API-equivalent dollars, split as in usage_parts, for (model, effort, usage) calls."""
    tokens, dollars = [0] * 5, [0.0] * 5
    for model, _effort, usage in calls:
        cost_in, cost_out, cost_read = price(model)
        rates = (cost_in, cost_in * 1.25, cost_in * 2, cost_read, cost_out)
        for i, n in enumerate(usage_parts(usage)):
            tokens[i] += n
            dollars[i] += n * rates[i] / 1e6
    return tokens, dollars


def text_of(content):
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return " ".join(b.get("text", "") for b in content if isinstance(b, dict) and b.get("type") == "text")
    return ""


def edit_lines(name, tool_input):
    if not isinstance(tool_input, dict):
        return 0
    if name == "Edit":
        return len(str(tool_input.get("new_string", "")).splitlines()) or 1
    if name == "MultiEdit":
        return sum(len(str(e.get("new_string", "")).splitlines()) or 1
                   for e in tool_input.get("edits", []) if isinstance(e, dict))
    if name == "Write":
        return len(str(tool_input.get("content", "")).splitlines())
    if name == "NotebookEdit":
        return len(str(tool_input.get("new_source", "")).splitlines())
    return 0


class Turn:
    def __init__(self, prompt, when, session):
        self.prompt = prompt[:2000]
        self.prompt_chars = len(prompt)
        self.when = when
        self.last_when = when
        self.entrypoint = None
        self.session = session
        self.calls = {}      # API message id -> (model, effort, usage)
        self.tools = []      # (tool name, input) in order
        self.interrupted = False
        self.correction_next = False


class SubRun:
    """One subagent's model requests, keyed by its parent session and agent id."""
    def __init__(self, session, linked):
        self.session = session   # the parent session's transcript file name
        self.linked = linked     # False when the transcript gave no agent id; then each request stands alone
        self.first = None
        self.last = None
        self.calls = {}          # API message id -> (model, effort, usage)


class Stats:
    def __init__(self):
        self.turns = []
        self.sessions = set()
        self.versions = Counter()
        self.commands = Counter()
        self.runs = {}                          # (parent session, agent id) -> SubRun
        self.call_owner = {}                    # API message id -> SubRun key
        self.prompt_starts = defaultdict(list)  # session -> start time of every prompt read
        self.switches = 0
        self.switch_recache = 0
        self.effort_switches = 0
        self.oldest = None
        self.newest = None


def finish_turn(turn):
    if turn is None or not turn.calls:
        return None
    calls = list(turn.calls.values())
    efforts = Counter((c[1] or "unknown") for c in calls)
    models = Counter(c[0] for c in calls)
    nameset = {t[0] for t in turn.tools}

    # A retry: the same file edited again after a shell command ran in between.
    last_edit, last_shell, retry, files, lines = {}, -1, False, set(), 0
    for i, (name, tool_input) in enumerate(turn.tools):
        if name in SHELL_TOOLS:
            last_shell = i
        elif name in EDIT_TOOLS:
            path = ""
            if isinstance(tool_input, dict):
                path = str(tool_input.get("file_path") or tool_input.get("notebook_path") or "")
            if path in last_edit and last_shell > last_edit[path]:
                retry = True
            last_edit[path] = i
            files.add(path)
            lines += edit_lines(name, tool_input)

    debugging = bool(DEBUG_RE.search(turn.prompt))
    small = len(files) <= 1 and lines <= 30
    if nameset & EDIT_TOOLS:
        category = "Debugging" if debugging else ("Small edits" if small else "Larger changes")
    elif nameset & DELEGATE_TOOLS:
        category = "Delegation"
    elif nameset & SHELL_TOOLS:
        category = "Debugging" if debugging else "Shell and tests"
    elif nameset:
        category = "Exploration"
    else:
        category = "Questions"

    duration = None
    if turn.when and turn.last_when:
        duration = max(0, int((turn.last_when - turn.when).total_seconds()))
    out = sum(int(c[2].get("output_tokens") or 0) for c in calls)
    thinking_values = [(c[2].get("output_tokens_details") or {}).get("thinking_tokens") for c in calls]
    thinking = sum(int(v) for v in thinking_values if v is not None) if any(v is not None for v in thinking_values) else None
    first_recache = int(calls[0][2].get("cache_creation_input_tokens") or 0)
    main_tokens, main_dollars = cost_parts(calls)
    agent_types, agent_models = Counter(), Counter()
    for name, tool_input in turn.tools:
        if name in DELEGATE_TOOLS and isinstance(tool_input, dict):
            kind = str(tool_input.get("subagent_type") or "general-purpose")
            agent_types[kind if kind in BUILTIN_AGENTS else "custom"] += 1
            model_choice = str(tool_input.get("model") or "inherit").lower()
            agent_models[model_choice if model_choice in ("haiku", "sonnet", "opus", "fable", "inherit") else "other"] += 1
    return {
        "session": turn.session,
        "when": turn.when,
        "effort": efforts.most_common(1)[0][0],
        "model": models.most_common(1)[0][0],
        "category": category,
        "small": small,
        "calls": len(calls),
        "out": out,
        "thinking": thinking,
        "retry": retry,
        "interrupted": turn.interrupted,
        "first_recache": first_recache,
        "files": len(files),
        "lines": lines,
        "duration": duration,
        "prompt_chars": turn.prompt_chars,
        "entrypoint": turn.entrypoint or "unknown",
        "main_tokens": main_tokens,
        "main_dollars": main_dollars,
        "agent_types": agent_types,
        "agent_models": agent_models,
        "turn": turn,
    }


def read_session(path, stats, seen_calls, seen_prompts, since, until=None, typed_only=False):
    session = os.path.basename(path)
    turns, current, duplicate, entrypoint, project_thread = [], None, False, None, False
    try:
        handle = open(path, encoding="utf-8", errors="replace")
    except OSError:
        return []
    with handle:
        for line in handle:
            try:
                entry = json.loads(line)
            except ValueError:
                continue
            if not isinstance(entry, dict):
                continue
            if entry.get("version"):
                stats.versions[entry["version"]] += 1
            kind = entry.get("type")
            when = parse_time(entry.get("timestamp"))
            if entry.get("entrypoint") and not entrypoint:
                entrypoint = str(entry["entrypoint"])
            if kind == "user":
                message = entry.get("message") or {}
                content = message.get("content")
                if isinstance(content, list) and any(isinstance(b, dict) and b.get("type") == "tool_result" for b in content):
                    continue
                text = text_of(content)
                stripped = text.lstrip()
                if "[Request interrupted by user" in text:
                    if current is not None:
                        current.interrupted = True
                    continue
                if stripped.startswith("<command-name>") or "<command-name>/" in stripped[:200]:
                    match = re.search(r"<command-name>/?([\w:-]+)</command-name>", stripped)
                    if match:
                        stats.commands[match.group(1)] += 1
                    continue
                if (entry.get("isMeta") or entry.get("isCompactSummary") or entry.get("isSidechain")
                        or stripped.startswith("<local-command") or stripped.startswith("<bash-")
                        or stripped.startswith("<system-reminder>") or stripped.startswith("Caveat:")
                        or not stripped):
                    continue
                if typed_only:
                    origin = entry.get("origin")
                    if entry.get("projectsUserTurn") or (isinstance(origin, dict)
                                                         and origin.get("subkind") == "projects-relay"):
                        project_thread = True
                        continue
                    if entry.get("turnOrigin") not in (None, "human"):
                        continue   # a task notice or injected turn; its work stays with the current prompt
                # A real prompt: close the previous turn.
                if current is not None and not duplicate:
                    if CORRECTION_RE.search(stripped[:300]):
                        current.correction_next = True
                    turns.append(current)
                uid = entry.get("uuid")
                duplicate = uid in seen_prompts if uid else False
                if uid:
                    seen_prompts.add(uid)
                current = Turn(text, when, session)
                current.entrypoint = entrypoint
                if when:
                    stats.prompt_starts[session].append(when)
                if (since and when and when < since) or (until and when and when >= until):
                    duplicate = True   # outside the window; skip it
            elif kind == "assistant":
                message = entry.get("message") or {}
                model = message.get("model")
                if entry.get("isApiErrorMessage") or not model or model == "<synthetic>":
                    continue
                call_id = message.get("id") or entry.get("requestId") or entry.get("uuid")
                effort = entry.get("perTurnEffort") or entry.get("effort")
                usage = message.get("usage") or {}
                if entry.get("isSidechain"):
                    parent = entry.get("sessionId")
                    parent = f"{parent}.jsonl" if parent else session
                    agent = entry.get("agentId")
                    key = (parent, str(agent)) if agent else (parent, "request", call_id)
                    owner = stats.call_owner.get(call_id)
                    if owner is not None and owner != key:
                        continue   # already counted from another file
                    if owner is None and call_id in seen_calls:
                        continue
                    seen_calls.add(call_id)
                    stats.call_owner[call_id] = key
                    run = stats.runs.get(key)
                    if run is None:
                        run = stats.runs[key] = SubRun(parent, bool(agent))
                    run.calls[call_id] = (model, effort, usage)   # the last copy of a request has its final usage
                    if when:
                        run.first = min(run.first or when, when)
                        run.last = max(run.last or when, when)
                    continue
                if current is None or duplicate:
                    continue
                if call_id in seen_calls and call_id not in current.calls:
                    continue   # already counted from another file
                seen_calls.add(call_id)
                current.calls[call_id] = (model, effort, usage)
                if when:
                    current.last_when = max(current.last_when or when, when)
                for block in message.get("content") or []:
                    if isinstance(block, dict) and block.get("type") == "tool_use":
                        current.tools.append((block.get("name", ""), block.get("input")))
    if current is not None and not duplicate:
        turns.append(current)
    if project_thread:
        return []   # a Claude project thread drove this session and chose its effort level
    return turns


def plural(n, word):
    return f"{n} {word}" if n == 1 else f"{n} {word}s"


def pct(part, whole):
    return round(100.0 * part / whole) if whole else 0


def median(values):
    values = [v for v in values if v is not None]
    return int(statistics.median(values)) if values else None


def fmt(n):
    if n is None:
        return "-"
    if n >= 1_000_000:
        return f"{n / 1_000_000:.1f}M"
    if n >= 1000:
        return f"{n / 1000:.1f}k"
    return str(n)


def wilson(k, n, z=1.96):
    """95% range for a rate of k out of n."""
    if not n:
        return (0, 0)
    p = k / n
    centre = (p + z * z / (2 * n)) / (1 + z * z / n)
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / (1 + z * z / n)
    return (round(100 * max(0.0, centre - half)), round(100 * min(1.0, centre + half)))


def fisher_p(a, b, c, d):
    """Two-sided Fisher exact p-value for the table [[a, b], [c, d]]."""
    row1, row2, col1, n = a + b, c + d, a + c, a + b + c + d

    def logp(x):
        return (math.lgamma(row1 + 1) - math.lgamma(x + 1) - math.lgamma(row1 - x + 1)
                + math.lgamma(row2 + 1) - math.lgamma(col1 - x + 1) - math.lgamma(row2 - col1 + x + 1)
                - (math.lgamma(n + 1) - math.lgamma(col1 + 1) - math.lgamma(n - col1 + 1)))

    observed = logp(a)
    low, high = max(0, col1 - row2), min(row1, col1)
    total = sum(math.exp(logp(x)) for x in range(low, high + 1) if logp(x) <= observed + 1e-9)
    return min(1.0, total)


def failure_kinds(rows):
    retry = sum(1 for r in rows if r["retry"])
    interrupted = sum(1 for r in rows if r["interrupted"])
    correction = sum(1 for r in rows if r["turn"].correction_next)
    return retry, interrupted, correction


def fmt_secs(seconds):
    if seconds is None:
        return "-"
    if seconds >= 3600:
        return f"{seconds / 3600:.1f}h"
    if seconds >= 60:
        return f"{seconds / 60:.1f}m"
    return f"{seconds}s"


def effort_key(effort):
    return EFFORT_ORDER.index(effort) if effort in EFFORT_ORDER else len(EFFORT_ORDER)


def clean(rows):
    return [r for r in rows if not (r["retry"] or r["interrupted"] or r["turn"].correction_next)]


def table(headers, rows):
    widths = [max(len(str(x)) for x in col) for col in zip(headers, *rows)] if rows else [len(h) for h in headers]
    lines = ["  ".join(str(h).ljust(w) for h, w in zip(headers, widths)),
             "  ".join("-" * w for w in widths)]
    lines += ["  ".join(str(c).ljust(w) for c, w in zip(row, widths)) for row in rows]
    return "\n".join(lines)


def money(x):
    if x is None:
        return "-"
    if x >= 100:
        return f"${x:,.0f}"
    if x >= 1:
        return f"${x:.2f}"
    return f"${x:.3f}"


def fmedian(values):
    values = [v for v in values if v is not None]
    return statistics.median(values) if values else None


def stepped(r):
    return r["interrupted"] or r["turn"].correction_next


def short_model(model):
    name = (model or "unknown").lower().replace("claude-", "")
    return name.split("[")[0]


def link_subagents(rows, stats):
    """Attach each subagent run to the prompt it started under. Returns the runs left unlinked."""
    by_start = {(r["session"], r["when"]): r for r in rows if r["when"]}
    starts = {session: sorted(set(times)) for session, times in stats.prompt_starts.items()}
    for r in rows:
        r["runs"], r["sub_calls"], r["sub_last"] = [], [], None
    unlinked = []
    for run in stats.runs.values():
        row = None
        times = starts.get(run.session)
        if run.first and times:
            i = bisect.bisect_right(times, run.first) - 1
            if i >= 0:
                row = by_start.get((run.session, times[i]))
        if row is None:
            unlinked.append(run)
            continue
        row["runs"].append(run)
        row["sub_calls"].extend(run.calls.values())
        if run.last:
            row["sub_last"] = max(row["sub_last"] or run.last, run.last)
    for r in rows:
        r["sub_tokens"], r["sub_dollars"] = cost_parts(r["sub_calls"])
        r["sub_runs"] = sum(1 for run in r["runs"] if run.linked)
        r["sub_cost"], r["main_cost"] = sum(r["sub_dollars"]), sum(r["main_dollars"])
        r["cost"] = r["sub_cost"] + r["main_cost"]
        ends = [t for t in (r["turn"].last_when, r["sub_last"]) if t]
        r["wall"] = max(0, int((max(ends) - r["when"]).total_seconds())) if ends and r["when"] else None
    return unlinked


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--root", default=os.path.expanduser("~/.claude/projects"))
    parser.add_argument("--days", type=int, default=0, help="only look at the last N days (default: everything on disk)")
    parser.add_argument("--min-turns", type=int, default=15, help="smallest group used for a comparison")
    parser.add_argument("--since", help="only prompts on or after this date (YYYY-MM-DD, UTC)")
    parser.add_argument("--until", help="only prompts before this date (YYYY-MM-DD, UTC)")
    parser.add_argument("--model", help="only prompts whose main model contains this text")
    parser.add_argument("--entrypoint", help="only sessions started from these entrypoints (comma-separated)")
    parser.add_argument("--typed-only", action="store_true",
                        help="only prompts typed in a person's own session (see the notes at the top)")
    parser.add_argument("--details", action="store_true", help="add counts, ranges, p-values and more")
    parser.add_argument("--fanout", action="store_true",
                        help="add the subagent section: full token cost per prompt, with and without subagents")
    parser.add_argument("--export", help="write one JSON line of numbers per prompt to this file")
    args = parser.parse_args()

    def day(value):
        return datetime.strptime(value, "%Y-%m-%d").replace(tzinfo=timezone.utc) if value else None

    since = datetime.now(timezone.utc) - timedelta(days=args.days) if args.days else None
    if args.since:
        since = day(args.since)
    until = day(args.until)
    entrypoints = {e.strip() for e in args.entrypoint.split(",")} if args.entrypoint else None
    paths = []
    for base, _dirs, files in os.walk(args.root):
        paths += [os.path.join(base, f) for f in files if f.endswith(".jsonl")]
    paths.sort(key=lambda p: os.path.getmtime(p))

    stats, seen_calls, seen_prompts, rows = Stats(), set(), set(), []
    for path in paths:
        previous = None
        for turn in read_session(path, stats, seen_calls, seen_prompts, since, until, args.typed_only):
            row = finish_turn(turn)
            if row is None:
                continue
            if args.model and args.model not in (row["model"] or ""):
                continue
            if entrypoints and row["entrypoint"] not in entrypoints:
                continue
            rows.append(row)
            stats.sessions.add(row["session"])
            if row["when"]:
                stats.oldest = min(stats.oldest or row["when"], row["when"])
                stats.newest = max(stats.newest or row["when"], row["when"])
            if previous is not None:
                if row["model"] != previous["model"]:
                    stats.switches += 1
                    stats.switch_recache += row["first_recache"]
                if row["effort"] != previous["effort"]:
                    stats.effort_switches += 1
            previous = row

    unlinked = link_subagents(rows, stats)

    print("Effort feedback for your Claude Code history")
    print("=" * 44)
    if not rows:
        print(f"No Claude Code turns found under {args.root}.")
        return
    known = [r for r in rows if r["effort"] != "unknown"]
    span = ""
    if stats.oldest and stats.newest:
        span = f", {stats.oldest.date()} to {stats.newest.date()}"
    print(f"{plural(len(rows), 'prompt')} in {plural(len(stats.sessions), 'session')}{span}.")
    if len(known) < len(rows):
        print(f"Effort level recorded for {pct(len(known), len(rows))}% of prompts "
              f"(older Claude Code versions didn't record it).")
    if stats.versions:
        versions = sorted(stats.versions, key=lambda v: [int(x) if x.isdigit() else 0 for x in re.split(r"[.-]", v)])
        print(f"Claude Code versions seen: {versions[0]} to {versions[-1]}.")
    print("Claude Code deletes transcripts after 30 days unless cleanupPeriodDays is raised, "
          "so older work isn't counted.\n")

    total_out = sum(r["out"] for r in rows) or 1
    by_effort = defaultdict(list)
    for r in rows:
        by_effort[r["effort"]].append(r)
    print("How you used effort")
    out_rows = []
    for effort in sorted(by_effort, key=effort_key):
        group = by_effort[effort]
        out_rows.append([effort, len(group), f"{pct(len(group), len(rows))}%",
                         f"{pct(sum(r['out'] for r in group), total_out)}%",
                         fmt(median(r["out"] for r in group)), fmt(median(r["thinking"] for r in group)),
                         f"{pct(len(clean(group)), len(group))}%"])
    print(table(["effort", "prompts", "share", "share of generated tokens", "median generated/prompt",
                 "median thinking/prompt", "clean finish"], out_rows))
    print("Clean finish = no retry after a shell command, no interruption, and your next message "
          "didn't read like a correction.\n")

    by_model_effort = Counter((r["model"], r["effort"]) for r in rows)
    print("Models and effort")
    print(table(["model", "effort", "prompts"],
                [[m, e, n] for (m, e), n in sorted(by_model_effort.items(), key=lambda x: (-x[1], x[0]))][:12]))
    print()

    print("By kind of work")
    cat_rows, groups = [], defaultdict(list)
    for r in rows:
        groups[(r["category"], r["effort"])].append(r)
    for category in CATEGORY_ORDER:
        for effort in sorted({e for (c, e) in groups if c == category}, key=effort_key):
            group = groups[(category, effort)]
            flag = "" if len(group) >= args.min_turns else " (small sample)"
            cat_rows.append([category, effort, f"{len(group)}{flag}", f"{pct(len(clean(group)), len(group))}%",
                             fmt(median(r["out"] for r in group)), fmt(median(r["thinking"] for r in group))])
    print(table(["kind", "effort", "prompts", "clean finish", "median generated", "median thinking"], cat_rows))
    print()

    findings = []
    for category in CATEGORY_ORDER:
        levels = [e for e in EFFORT_ORDER if len(groups.get((category, e), [])) >= args.min_turns]
        for lower, higher in zip(levels, levels[1:]):
            lo, hi = groups[(category, lower)], groups[(category, higher)]
            lo_clean, hi_clean = pct(len(clean(lo)), len(lo)), pct(len(clean(hi)), len(hi))
            lo_out, hi_out = median(r["out"] for r in lo) or 1, median(r["out"] for r in hi) or 0
            ratio = hi_out / lo_out
            if hi_clean - lo_clean <= 3 and ratio >= 1.3:
                findings.append(f"{category}: {higher} finished cleanly {hi_clean}% of the time and {lower} "
                                f"{lo_clean}%, but {higher} generated {ratio:.1f}x the tokens per prompt. "
                                f"Try {lower} as your default for this kind of work.")
            elif hi_clean - lo_clean >= 10:
                findings.append(f"{category}: {higher} finished cleanly {hi_clean}% of the time and {lower} "
                                f"only {lo_clean}%. Keep {higher} for this kind of work.")

    top = [r for r in known if r["effort"] in ("xhigh", "max")]
    light = [r for r in top if r["category"] in ("Questions", "Small edits")]
    if top and pct(len(light), len(top)) >= 40:
        findings.append(f"{pct(len(light), len(top))}% of your xhigh and max prompts were questions or small edits "
                        f"(one file, 30 lines or fewer). Those rarely need the top effort levels.")
    if known:
        dominant, count = Counter(r["effort"] for r in known).most_common(1)[0]
        if pct(count, len(known)) >= 85:
            findings.append(f"{pct(count, len(known))}% of your prompts ran at {dominant}, so there's little to "
                            f"compare against. For real feedback, use a different level for a week on everyday "
                            f"work, then run this again.")
    if stats.switches:
        findings.append(f"You switched models between prompts {plural(stats.switches, 'time')} inside a session. Claude Code "
                        f"docs say a model switch makes the next turn uncached; those turns re-cached "
                        f"{fmt(stats.switch_recache)} tokens.")
    if stats.commands.get("effort") or stats.commands.get("model"):
        findings.append(f"You ran /model {plural(stats.commands.get('model', 0), 'time')} and /effort "
                        f"{plural(stats.commands.get('effort', 0), 'time')}.")
    linked_out = sum(r["sub_tokens"][4] for r in rows)
    other_out = cost_parts([c for run in unlinked for c in run.calls.values()])[0][4]
    if linked_out or other_out:
        findings.append(f"Subagents generated {fmt(linked_out)} tokens for these prompts, not counted in the tables "
                        f"above (another {fmt(other_out)} in sessions or dates left out). --fanout shows their cost.")

    print("Feedback")
    if findings:
        for f in findings:
            print(f"- {f}")
    else:
        print(f"- No effort level differed enough from its neighbour, with at least {args.min_turns} prompts "
              f"each, to call. Run again with more history or a lower --min-turns.")
    print("\nThis compares your own past work, so it shows patterns, not proof. Harder tasks tend to get "
          "higher effort, which is why it compares within the same kind of work.")

    if args.details:
        print_details(rows, groups, args.min_turns)
    if args.details or args.fanout:
        print_fanout(rows, unlinked)
    if args.export:
        with open(args.export, "w", encoding="utf-8") as handle:
            for r in rows:
                handle.write(json.dumps({
                    "date": r["when"].strftime("%Y-%m-%d") if r["when"] else None,
                    "hour": r["when"].hour if r["when"] else None,
                    "session": hashlib.sha256(r["session"].encode()).hexdigest()[:12],
                    "entrypoint": r["entrypoint"], "model": r["model"], "effort": r["effort"],
                    "kind": r["category"], "calls": r["calls"], "generated": r["out"],
                    "thinking": r["thinking"], "files": r["files"], "lines": r["lines"],
                    "seconds": r["duration"], "prompt_chars": r["prompt_chars"],
                    "retry": r["retry"], "interrupted": r["interrupted"],
                    "correction_next": r["turn"].correction_next,
                    "main_tokens": dict(zip(["input", "write_5m", "write_1h", "read", "generated"], r["main_tokens"])),
                    "sub_tokens": dict(zip(["input", "write_5m", "write_1h", "read", "generated"], r["sub_tokens"])),
                    "main_cost": round(r["main_cost"], 5), "sub_cost": round(r["sub_cost"], 5),
                    "sub_runs": r["sub_runs"], "sub_requests": len(r["sub_calls"]), "wall_seconds": r["wall"],
                }) + "\n")
        print(f"\nWrote {plural(len(rows), 'prompt')} of numbers to {args.export}.")


def print_details(rows, groups, min_turns):
    print("\nDetails")
    print("=" * 7)
    entry_counts = Counter(r["entrypoint"] for r in rows)
    print("Sessions started from: " + ", ".join(f"{e} {n}" for e, n in entry_counts.most_common()))
    print()

    by_effort = defaultdict(list)
    for r in rows:
        by_effort[r["effort"]].append(r)
    print("Outcome by effort (clean = no retry, no interruption, no correction next)")
    out_rows = []
    for effort in sorted(by_effort, key=effort_key):
        group = by_effort[effort]
        k = len(clean(group))
        lo, hi = wilson(k, len(group))
        retry, interrupted, correction = failure_kinds(group)
        out_rows.append([effort, f"{k}/{len(group)}", f"{pct(k, len(group))}% ({lo}-{hi}%)", retry, interrupted,
                         correction, fmt_secs(median(r["duration"] for r in group)),
                         median(r["prompt_chars"] for r in group)])
    print(table(["effort", "clean/prompts", "clean (95% range)", "retried", "interrupted", "corrected",
                 "median time", "median prompt chars"], out_rows))
    print()

    print("By kind of work, with counts")
    cat_rows = []
    for category in CATEGORY_ORDER:
        for effort in sorted({e for (c, e) in groups if c == category}, key=effort_key):
            group = groups[(category, effort)]
            k = len(clean(group))
            lo, hi = wilson(k, len(group))
            retry, interrupted, correction = failure_kinds(group)
            cat_rows.append([category, effort, f"{k}/{len(group)}", f"{pct(k, len(group))}% ({lo}-{hi}%)",
                             retry, interrupted, correction, fmt_secs(median(r["duration"] for r in group)),
                             median(r["files"] for r in group), median(r["lines"] for r in group),
                             fmt(sum(r["out"] for r in group))])
    print(table(["kind", "effort", "clean/prompts", "clean (95% range)", "retried", "interrupted", "corrected",
                 "median time", "median files", "median lines", "total generated"], cat_rows))
    print()

    print("Max and high against xhigh, same kind of work (Fisher exact test on clean finishes)")
    test_rows = []
    for category in CATEGORY_ORDER + ["All work"]:
        for other in ("high", "max"):
            if category == "All work":
                a_rows, b_rows = by_effort.get(other, []), by_effort.get("xhigh", [])
            else:
                a_rows, b_rows = groups.get((category, other), []), groups.get((category, "xhigh"), [])
            if len(a_rows) < 5 or len(b_rows) < 5:
                continue
            a, b = len(clean(a_rows)), len(clean(b_rows))
            p = fisher_p(a, len(a_rows) - a, b, len(b_rows) - b)
            ratio = (median(r["out"] for r in a_rows) or 0) / (median(r["out"] for r in b_rows) or 1)
            test_rows.append([category, f"{other} vs xhigh", f"{a}/{len(a_rows)} vs {b}/{len(b_rows)}",
                              f"{pct(a, len(a_rows))}% vs {pct(b, len(b_rows))}%", f"{p:.3f}", f"{ratio:.1f}x"])
    print(table(["kind", "pair", "clean", "rate", "p", "median tokens"], test_rows))
    print()

    print("Larger changes by size (lines written)")
    size_rows = []
    larger = [r for r in rows if r["category"] == "Larger changes"]
    buckets = [("31-100 lines or 2+ files", 0, 100), ("101-300 lines", 101, 300), ("301+ lines", 301, 10 ** 9)]
    for label, lo_lines, hi_lines in buckets:
        for effort in ("high", "xhigh", "max"):
            group = [r for r in larger if r["effort"] == effort and lo_lines <= r["lines"] <= hi_lines]
            if not group:
                continue
            k = len(clean(group))
            size_rows.append([label, effort, f"{k}/{len(group)}", f"{pct(k, len(group))}%",
                              median(r["files"] for r in group), fmt(median(r["out"] for r in group)),
                              fmt_secs(median(r["duration"] for r in group))])
    print(table(["size", "effort", "clean/prompts", "clean", "median files", "median generated", "median time"],
                size_rows))
    print()

    print("Sessions that used both xhigh and max (same project and task context)")
    sessions = defaultdict(lambda: defaultdict(list))
    for r in rows:
        sessions[r["session"]][r["effort"]].append(r)
    both = [s for s in sessions.values() if s.get("xhigh") and s.get("max")]
    pair_rows = []
    for effort in ("xhigh", "max"):
        group = [r for s in both for r in s[effort]]
        k = len(clean(group))
        pair_rows.append([effort, len(both), f"{k}/{len(group)}", f"{pct(k, len(group))}%",
                          fmt(median(r["out"] for r in group))])
    print(table(["effort", "sessions", "clean/prompts", "clean", "median generated"], pair_rows))
    print()

    print("Effort by week (prompts)")
    weeks = defaultdict(Counter)
    for r in rows:
        if r["when"]:
            year, week, _ = r["when"].isocalendar()
            weeks[f"{year}-W{week:02d}"][r["effort"]] += 1
    efforts = sorted({r["effort"] for r in rows}, key=effort_key)
    print(table(["week"] + efforts, [[w] + [weeks[w].get(e, 0) for e in efforts] for w in sorted(weeks)]))


def print_fanout(rows, unlinked):
    print("\nSubagents and full cost")
    print("=" * 23)
    print("Cost here is every model request priced at API list prices: input, cache writes, cache reads and\n"
          "generated tokens. It stands in for how plan usage limits weigh tokens, which isn't published.\n")

    main_t, main_d, sub_t, sub_d = [0] * 5, [0.0] * 5, [0] * 5, [0.0] * 5
    for r in rows:
        for i in range(5):
            main_t[i] += r["main_tokens"][i]
            main_d[i] += r["main_dollars"][i]
            sub_t[i] += r["sub_tokens"][i]
            sub_d[i] += r["sub_dollars"][i]
    total = sum(main_d) + sum(sub_d) or 1
    print("Where the cost went")
    part_rows = []
    for label, t, d in (("main thread", main_t, main_d), ("subagents", sub_t, sub_d)):
        for i in range(5):
            if t[i]:
                part_rows.append([label, PART_NAMES[i], fmt(t[i]), money(d[i]), f"{pct(d[i], total)}%"])
    print(table(["where", "tokens", "count", "cost", "share"], part_rows))
    print(f"Main thread {money(sum(main_d))} ({pct(sum(main_d), total)}%), subagents {money(sum(sub_d))} "
          f"({pct(sum(sub_d), total)}%). Generated tokens were {pct(main_d[4] + sub_d[4], total)}% of the cost.")
    if unlinked:
        other_t, other_d = cost_parts([c for run in unlinked for c in run.calls.values()])
        runs = sum(1 for run in unlinked if run.linked)
        print(f"Not counted: {plural(runs, 'subagent run')} from sessions, dates or filters left out "
              f"({money(sum(other_d))}).")
    print()

    print("Cost and outcome per prompt, by effort, with and without subagents")
    by_effort = defaultdict(list)
    for r in rows:
        by_effort[r["effort"]].append(r)
    out_rows = []
    for effort in sorted(by_effort, key=effort_key):
        for flag in (False, True):
            group = [r for r in by_effort[effort] if bool(r["sub_calls"]) == flag]
            if not group:
                continue
            spent = sum(r["cost"] for r in group)
            out_rows.append([effort, "yes" if flag else "no", len(group), money(spent / len(group)),
                             money(fmedian(r["cost"] for r in group)),
                             f"{pct(sum(r['sub_cost'] for r in group), spent)}%" if flag else "-",
                             median(r["sub_runs"] for r in group) if flag else "-",
                             f"{pct(sum(1 for r in group if stepped(r)), len(group))}%",
                             f"{pct(len(clean(group)), len(group))}%",
                             fmt_secs(median(r["wall"] for r in group))])
    print(table(["effort", "subagents", "prompts", "mean cost", "median cost", "subagent share", "median runs",
                 "stepped in", "clean", "median wall time"], out_rows))
    print("Effort is the main thread's. Wall time runs until the last main or subagent request. Clean finish\n"
          "only sees the main thread's edits, so stepped in is the fairer outcome for prompts with subagents.\n")

    runs = [run for r in rows for run in r["runs"] if run.linked]
    if runs:
        print("Subagent runs by model and effort")
        groups = defaultdict(list)
        for run in runs:
            calls = list(run.calls.values())
            model = Counter(short_model(c[0]) for c in calls).most_common(1)[0][0]
            effort = Counter((c[1] or "unknown") for c in calls).most_common(1)[0][0]
            groups[(model, effort)].append(calls)
        run_rows = []
        for (model, effort), group in sorted(groups.items(), key=lambda x: -len(x[1])):
            costs = [cost_parts(calls) for calls in group]
            spent = sum(sum(d) for _t, d in costs) or 1
            reading = sum(sum(d[:4]) for _t, d in costs)
            run_rows.append([model, effort, len(group), money(fmedian(sum(d) for _t, d in costs)),
                             fmt(median(t[4] for t, _d in costs)), median(len(calls) for calls in group),
                             fmt(median(sum(t[:4]) // max(1, len(calls)) for (t, _d), calls in zip(costs, group))),
                             f"{pct(reading, spent)}%"])
        print(table(["model", "effort", "runs", "median cost/run", "median generated/run", "median requests/run",
                     "median context/request", "share spent reading"], run_rows[:12]))
        print("Context/request is input plus cache tokens per request. Share spent reading is the part of the\n"
              "cost that isn't generated tokens.\n")

    print("Prompts by number of subagent runs")
    buckets = [("0", 0, 0), ("1", 1, 1), ("2-3", 2, 3), ("4-9", 4, 9), ("10+", 10, 10 ** 9), ("not known", -1, -1)]
    width_rows = []
    for label, lo, hi in buckets:
        if lo < 0:   # subagent requests from older transcripts that don't say which run they belong to
            group = [r for r in rows if r["sub_calls"] and not r["sub_runs"]]
        else:
            group = [r for r in rows if lo <= r["sub_runs"] <= hi and (lo > 0 or not r["sub_calls"])]
        if not group:
            continue
        width_rows.append([label, len(group), money(fmedian(r["cost"] for r in group)),
                           money(fmedian(r["sub_cost"] for r in group)) if lo else "-",
                           fmt_secs(median(r["wall"] for r in group)),
                           f"{pct(sum(1 for r in group if stepped(r)), len(group))}%",
                           f"{pct(len(clean(group)), len(group))}%"])
    print(table(["runs", "prompts", "median cost", "median subagent cost", "median wall time", "stepped in", "clean"],
                width_rows))
    print()

    types, models = Counter(), Counter()
    for r in rows:
        types.update(r["agent_types"])
        models.update(r["agent_models"])
    if types:
        print("Subagent calls by type: " + ", ".join(f"{k} {n}" for k, n in types.most_common()))
        print("Model asked for: " + ", ".join(f"{k} {n}" for k, n in models.most_common()))


if __name__ == "__main__":
    main()
