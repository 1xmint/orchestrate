# The band

One dim line above the prompt that says what the session is on, what it needs
from you, or that it is paused for the usage limit. Hooks write a small record;
a Claude Code mod (`hooks/band.mjs`) reads it and draws the line. Section 4 of
the 0010 master plan (`docs/research/0010-master-plan.md`, "The mods track")
describes it; `docs/pause.md` says where the pause line comes from.

The band is for the person who directs the work and is not watching the
transcript: they look up from something else and want to know whether to come
back. It costs the model nothing. Nothing the band adds reaches the model's
context: the hooks print the same bytes with or without it (a test runs each
case twice, with and without the plugin's folder, and compares), and the mod only
draws.

## What it shows

| Line | When | Where it comes from |
|---|---|---|
| `Paused for the usage limit; keep-going stays on.` (or `Stopped on an API error (<kind>); ...`) | a turn ended on an API error and the same session has not stopped or been prompted since | the pause record, `.orchestrator/pause.json` (`docs/pause.md`); its own text, word for word |
| `Needs you: <question>` | the turn's last message ends on a question | `persist-check.mjs` at Stop, from the Stop payload's `last_assistant_message` (the transcript's last message when the payload has none), whether or not keep-going is on |
| `Working on: <text>` | a real prompt arrived, or a Stop was refused so the turn goes on, or a Stop passed because a helper or background command is still out | `router.mjs` at the prompt and `persist-check.mjs` at Stop; the text is the next open item, else the goal |
| nothing | the turn is finished, or nothing has been written | an `idle` record, no record, or a record from another session that has aged out |

The order is fixed: a pause, then a question, then the work. A pause wins over a
question because nothing the session says next arrives until it wakes.

The text is the user's own words where there are any, never reworded, cut at the
end to 100 characters (with three dots). It is the first of these that exists:

1. at a prompt and at a refused Stop: the next open task of the run this session
   is bound to, else the first numbered step under Next on the project page
   (`.orchestrator/PROJECT.md`), else the keep-going goal, else the first request
   the router pinned, else (at a prompt only) the prompt itself when it is a
   request;
2. at a Stop that passed on a wait: the fixed words "waiting on a helper or
   background command", and from its first minute how long the wait has gone
   on (", 12 min so far", ", 4 h 10 min so far"), worked out on every look
   from the record's time, so "is it stuck?" has an answer without typing.
   During a turn the session was woken for, the time still counts from the
   wait's Stop until the next Stop or prompt rewrites the record;
3. at a Stop that ends on a question: the question, the sentence the message
   closes on.

Who writes what:

- `router.mjs`, on a real user prompt: `working`. Not in a helper (`agent_id`),
  not a notice the host submits as a prompt (a finished helper's notice, a
  system reminder), not a slash command, not a repeat of the same prompt id. It
  writes for a muted router too, since the band is not model-facing. It writes
  nothing when the router is off in its settings.
- `persist-check.mjs`, at Stop, not in a helper: a refused Stop writes `working`;
  a Stop passed on a wait writes `working` with the waiting words; a closing
  question writes `needs`; anything else, `idle`. A question comes before a wait.
  At `StopFailure` it writes the pause record only, and the band record is left
  as it was.

A session that never armed keep-going has no `waiting` state: with a helper out
it still shows `idle` after a turn that ends without a question, because only the
keep-going loop decides what a Stop with background work out means.

## The record

`<project root>/.orchestrator/band.json`, in the same folder as the pause record
and found the same way (the git root of the payload's `cwd`, or `cwd` itself
outside a repository: `pauseRoot` in `lib/pause.mjs`). One record per project; a
later write replaces it.

```json
{ "session": "<session id>", "kind": "working", "text": "Fix the date parser",
  "at": "2026-10-03T09:00:00.000Z" }
```

- `kind` is `working`, `needs` or `idle`. An idle record carries no text.
- `session` is the id the host gave the hook, or null when it gave none.
- It is written only where the plugin's `.orchestrator` folder already exists, so
  a hook that runs in every folder a session opens leaves no folder behind in a
  project the plugin has done nothing in. `run-init.mjs` keeps the folder out of
  git through `.git/info/exclude`, and the commit check never counts it as
  uncommitted work, as for `pause.json`.
- Writing is a temporary file renamed over the old one, wrapped so that nothing
  throws: a failed write is a silent skip, and no hook's output or decision
  changes. The cost is one small file write per prompt and per Stop, and a
  second small read when the Stop payload carries no closing message.
- The pure half (the line, the record's shape, what a Stop leaves) is
  `lib/band-line.mjs`, which imports nothing; the file helpers are `lib/band.mjs`.

## The mod

`hooks/band.mjs` registers these events and nothing else:

- `session.start`: starts a poll every two seconds, but only when
  `$.session.surfaces()` includes `terminal` or `desktop`. In a plain `claude -p`
  run, the bench included, the list is empty and no timer is started, so nothing
  of the band's can hold a headless run open or read a file.
- `session.attach`: a screen joining a session that started with none (the
  Desktop app picking it up) starts the poll then, once.
- `ui.render` for `AbovePrompt`: draws one dim `Text` line, truncated, two cells
  short of the width it is given; or passes on (`next(e)`) when there is nothing
  to say or when the feedback survey has the spot (`e.props.hasSurvey`).

At each poll it stats `band.json` and `pause.json` under the session's root
(walking up from `$.session.root()` to the git root, as the hooks do), re-reads a
file only when its modified time moved, works the line out with a function that
takes no `$`, and calls `$.ui.invalidate('ui.render')` only when the line
changed.

It only reads and draws. It calls `$.session.root`, `.id` and `.surfaces`,
`$.fs.exists`, `.stat` and `.read`, `$.clock.now` and `.every`, and
`$.ui.invalidate` and `.resolve`. It calls nothing that writes a file, sends a
prompt or a message, runs a command or a tool, calls a model, a helper, the
network or an MCP server, and it has no `$.state`. `band-mod.test.mjs` scans the
source for every `$.<namespace>.<method>` against that list and for the two
events, so a new call fails the test and gets looked at. The host reads the same
source before it loads the module, and `claude plugin validate` printed this
before `session.attach` was added (CI's validate job checks the current file):

```
./band.mjs hooks: session.start, ui.render{component=AbovePrompt}
./band.mjs calls: $.clock.every, $.clock.now (via look), $.fs.exists (via projectRoot), $.fs.read (via look), $.fs.stat (via modified), $.session.id (via look), $.session.root (via projectRoot), $.session.surfaces (via look), $.ui.invalidate (via look), $.ui.resolve
```

Why the pure half is a separate file with no imports: validate refuses a module
that imports anything but its own files by relative path and `claude-code`:

```
modules../band.mjs: cannot import "node:fs" (from hooks/band.mjs): a hooks module imports its own files by relative path and "claude-code", nothing else
```

So the mod cannot import `lib/pause.mjs` (it reads files through Node's `fs`), and
`lib/band-line.mjs` carries `parsePauseText`, which reads a pause record the same
way; a test holds the two readers to the same answer for every state the file can
be in. The one file the mod imports must itself import nothing, and a test says so.

## Whose record it is

The hooks write the id the host hands them in the payload (`session_id`). The mod
reads the id `$.session.id()` gives it. Nobody has checked that the two are the
same string. So the line is shown in three cases:

- the ids are equal, or either side has none: it is this session's, shown plain;
- the ids differ and the record is at most 30 minutes old: shown with
  `(another session) ` in front, so a mismatch shows the line rather than hiding
  it, and a second session in the same folder is told apart from this one;
- the ids differ and the record is older: not shown, because a session that died
  mid-turn would otherwise leave `Working on` above every later session in that
  folder.

A pause from another session is treated the same way (a pause is one record per
project, so it can belong to a session that is not this one). A clock that
disagrees by up to a minute still counts as recent; a time that is not a time
never shows. The choice is the cost of not knowing: if the ids are the same string
the tag never appears; if they are not, the worst case is a tag on a true line.

## Compatibility: does a build that has no mods still load the plugin?

`"modules": ["./band.mjs"]` sits at the top level of `hooks/hooks.json`, beside
`"hooks"`. That is the only place the host looks for a plugin's module (a path
relative to that file, at most one per plugin), and the plugin manifest must not
carry a `hooks` key (`assets.test.mjs`), so there is no second place. The
question is what a build without mods, or with mods switched off, does with a
`hooks.json` that has the key. Answered from the bundled source of three builds,
each unpacked from the registry's own package (read, not run), and by installing
the branch under two of them (2026-10-03).

**2.1.286, the version the bench pins (`bench.yml`).** The file's schema names
`modules`, and the loader takes the command hooks and the module path from one
parse of the file:

```js
tSn=p(()=>u({$schema:…,description:…,hooks:ww(()=>TY()).optional()…,
  modules:A(o()).max(Op,{message:"hooks.json `modules` names one hooks module per plugin; a second entry is refused"}).optional()…,surface:…}))
…
S=tSn().parse(h)
…
return{hooks:S.hooks??{},modules:S.modules??[]}
```

A key the schema does not name is a warning, not a failure, and `modules` is on
the list of names it knows:

```js
xyn=new Set(["$schema","description","hooks","modules","surface"])
…
S=`hooks.json: unknown ${P(s.length,"key")} … ignored` … t(`Plugin ${e}: ${S} (${n})`,{level:"warn"})
```

Whether the module then loads is a separate switch, and it never touches the
command hooks. The default is on; the environment variable or a served-off
rollout switch turns it off:

```js
var u8e="tengu_plugin_hooks_modules";var FFt=!0;
var C6=()=>a.CLAUDE_CODE_ENABLE_FUNCTION_HOOKS??R(u8e,FFt);
var uUe=()=>C6()&&!Fr("hooks")&&!vr();
```

**2.1.250.** The same shape: `pbt=h(()=>m({description:…,hooks:CC(()=>dN()).optional()…,modules:H(i()).max(Ss,{message:"hooks.json \`modules\` names one hooks module per plugin; a second entry is refused"}).optional()…}))`,
parsed as `g=pbt().parse(p);return{hooks:g.hooks??{},modules:g.modules??[]}`.

**2.1.200, which has no mods at all.** The schema names `description` and `hooks`
only, and it is a plain object schema, which drops a key it does not name instead
of refusing the file:

```js
Obn=He(()=>A.object({description:A.string().optional()…,hooks:A.lazy(()=>zW())…}))
…
return Obn().parse(r).hooks
```

**Installed, not only read.** The branch was installed from a local marketplace
into a scratch config folder under 2.1.200 and under 2.1.286, with the `modules`
key in the installed copy of `hooks.json`, and `claude plugin details` listed
all eight command hook events under each (the same list as an install without the
key).

So the key is registered in `hooks/hooks.json`, and no separate plugin is needed:
a build that knows `modules` loads the command hooks and the module; a build that
does not drops the key and loads the command hooks. Two limits on that finding.
Builds between 2.1.200 and 2.1.250 were not read; the reading above is the
earliest and the nearest. And the key is known to the loader from 2.1.250 at
least, but the plan names 2.1.287 as the first build that announces mods, so what
a build between them does when it reaches the module (the switch above) is
unchecked.

Where mods are switched off by policy or by `--bare` the host skips the module
and says so on a dim line that names it (`hooks modules are turned off for
installed plugins in this process: CLAUDE_CODE_ENABLE_FUNCTION_HOOKS is 0 …`);
the command hooks load as before and the band shows nothing. The script install
(`scripts/install.mjs`, hooks written into `settings.json`) has no band: mods
load only from a plugin's `hooks.json`.

## Checks

- `lib/band.test.mjs`: the line, the record, the clip, the session rules, the
  file helpers, and that the pause reader agrees with `lib/pause.mjs`.
- `band-hooks.test.mjs`: the exact hook JSON through `router.mjs` and
  `persist-check.mjs` in a fake home: what each prompt and Stop writes, that a
  helper's Stop and prompt write nothing, that a pause wins over a question, and
  that the hooks print and decide the same with and without the band's folder.
- `band-mod.test.mjs`: the mod's source against the read-only list, its two
  events, `hooks.json`, and the mod run against a fake `$` (it stands down where
  nothing draws, reads a file only when its time moved, asks for a redraw only
  when the line changed).
- CI job `validate`: installs Claude Code at the bench's pin and runs
  `claude plugin validate` on the plugin and the marketplace. It reads the mod's
  source for the rules the host holds a module to, needs no sign-in and sends
  nothing. The same command passed on 2.1.286 and on the build used to write
  this, 2.1.288, with only the long-standing warning that a `CLAUDE.md` at the
  plugin root is not loaded as project context.
- There is no `*.test.ts` for `claude plugin test`: it needs mods enabled in the
  process (on 2.1.286 it refuses with "hooks modules are turned off here" under a
  policy that disables them), nobody has run it against this plugin, and the fake
  `$` above covers the same ground in Node.

## Left out

The plan's pick-list (a press that drafts the question into the prompt box with
`$.prompt.fill`) is not built. Whether that call lands in the box on Desktop is
unchecked (plan step 0), and the mod is held to calls that write nothing.

## Unchecked

- Whether `$.session.id()` equals the hook payload's `session_id`. The line shows
  either way (see "Whose record it is"); the first live session answers it, since
  a tag on a line that is this session's own says they differ.
- That the line draws at all on a real terminal or on Desktop. The overview says
  the band's slot is on both surfaces; nobody here has seen it. The mod has not
  been run in a live session, only against a fake `$` and the host's static read.
- The real shapes the fake `$` stands in for: that `$.fs.stat` carries `mtimeMs`,
  that `$.clock.now()` is a number of milliseconds, and the form of
  `$.session.root()` (a path, with `/` or `\`). The mod's walk to the git root
  follows `findRepoRoot` but joins with `/`; on Windows it is unseen.
- A session that moves into another repository or a worktree writes where the mod
  does not read: the hooks resolve the root from each payload's `cwd`, the mod
  from the session's root.
- That `StopFailure` fires, and with `rate_limit`, for a subscription limit, and
  on Desktop (`docs/pause.md`); until it does the pause line never appears.
- Whether the Stop payload always carries `last_assistant_message`; where it does
  not, the hook reads the transcript's tail, as the commit check does.
- That the rollout switch is on for a given user. It defaults to on in 2.1.286
  and the host can serve it off.
- What `claude plugin test` does with this plugin (see "Checks").

## Folders the band cannot read

A project on a network share (a UNC path or a mapped network drive on Windows)
may refuse `$.fs` reads; the band then stays blank there. When the session moves
to another folder (a worktree, `/cd`), the old project's line is dropped at the
next look, and the new folder's record, if it has one, is read fresh.
