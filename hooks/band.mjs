// hooks/band.mjs — the band: one dim line above the prompt that says what the
// session is on ("Working on: ..."), what it needs from the user ("Needs you:
// ...") or that it is paused for the usage limit. It is named once, under
// "modules" in hooks/hooks.json, and docs/band.md says where each line comes from
// and what has not been checked.
//
// It only reads and draws. The plugin's hooks write the record
// (`<project root>/.orchestrator/band.json`, and the pause record beside it);
// this file may stat and read those two files, ask the session who it is and what
// it draws on, run a timer and ask for a redraw. A test (band-mod.test.mjs) holds
// it to that list: it calls nothing that writes a file, sends a prompt or a
// message, runs a command or a tool, calls a model, a helper, the network or an
// MCP server, and it registers only session.start, session.attach and
// ui.render. It carries no `$.state`, so there is nothing to write while drawing.
//
// With nothing drawing (a plain `claude -p`, the bench) no timer is started at
// all, so nothing of the band's can keep a headless run alive or read a file; a
// screen that attaches later (session.attach) starts it then.

import { bandLine, parseBand, parsePauseText } from '../skills/orchestrate/scripts/lib/band-line.mjs'

const EVERY_MS = 2000
// The close mark of a band is drawn over the last cell of its first row, so the
// line is kept two cells short of the width it is given.
const CLOSE_MARK = 2

let shown = ''
let timer = null
// What the last look found. A file is read again only when its modified time moved.
const seen = { cwd: '', root: '', bandAt: undefined, pauseAt: undefined, band: null, pause: null }

// The folder the hooks write in: the git root of the session's folder, or the
// folder itself outside a repository (lib/pause.mjs `pauseRoot`). Re-walked only
// when the session's folder moves.
async function projectRoot($) {
  const start = await $.session.root()
  if (start === seen.cwd && seen.root) return seen.root
  let dir = start
  let root = start
  for (let i = 0; i < 40; i++) {
    if (await $.fs.exists(dir + '/.git')) { root = dir; break }
    const up = dir.replace(/[\\/][^\\/]*$/, '')
    if (!up || up === dir) break
    dir = up
  }
  // A new folder starts from nothing: undefined is not any modified time, so
  // the next look reads (or clears) both records instead of keeping the old
  // project's line up when the new one has no record at all.
  seen.cwd = start
  seen.root = root
  seen.bandAt = undefined
  seen.pauseAt = undefined
  seen.band = null
  seen.pause = null
  return root
}

async function modified($, path) {
  try { return (await $.fs.stat(path)).mtimeMs } catch { return null }
}

// Looks at the two files, reads the one whose modified time moved, and asks for
// a redraw only when the line changed. The line is worked out on every look from
// what was read, since a record from another session stops showing with time.
async function drawsHere($) {
  const surfaces = await $.session.surfaces()
  return surfaces.includes('terminal') || surfaces.includes('desktop')
}

async function look($) {
  if (!(await drawsHere($))) return

  const root = await projectRoot($)
  const bandFile = root + '/.orchestrator/band.json'
  const pauseFile = root + '/.orchestrator/pause.json'

  const bandAt = await modified($, bandFile)
  if (bandAt !== seen.bandAt) {
    seen.bandAt = bandAt
    seen.band = null
    if (bandAt !== null) {
      try { seen.band = parseBand(await $.fs.read(bandFile)) } catch { seen.band = null }
    }
  }
  const pauseAt = await modified($, pauseFile)
  if (pauseAt !== seen.pauseAt) {
    seen.pauseAt = pauseAt
    seen.pause = null
    if (pauseAt !== null) {
      try { seen.pause = parsePauseText(await $.fs.read(pauseFile)) } catch { seen.pause = null }
    }
  }

  const line = bandLine({ pause: seen.pause, band: seen.band, session: await $.session.id(), now: await $.clock.now() })
  if (line !== shown) {
    shown = line
    $.ui.invalidate('ui.render')
  }
}

// Starts the poll once, and only where something draws. `starting` is set
// before the first wait, so two attaches in quick succession start one poll;
// a first look that fails (a network folder) still starts it, so a later look
// can recover after a folder move.
let starting = false
async function begin($) {
  if (timer || starting) return
  starting = true
  try {
    if (!(await drawsHere($))) return
    try { await look($) } catch { /* the poll tries again */ }
    timer = $.clock.every(EVERY_MS, async () => {
      try { await look($) } catch { /* the next look tries again */ }
    })
  } finally {
    starting = false
  }
}

export function register(on) {
  on('session.start', async ($, e, next) => {
    // A reload runs this again with the old timers dropped; a second start in
    // the same environment must not stack a second timer.
    if (timer) { timer.cancel(); timer = null }
    starting = false
    try { await begin($) } catch { /* the band shows nothing rather than fail the start */ }
    return next(e)
  })

  // A screen joining a session that started with none (the Desktop app picking
  // up a session) is when the poll starts there.
  on('session.attach', async ($, e, next) => {
    try { await begin($) } catch { /* nothing drawn rather than a failed attach */ }
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // Nothing to say, or the feedback survey has the spot: Claude Code's own.
    if (shown === '' || e.props.hasSurvey) return next(e)
    const { Text } = $.ui.resolve(e)
    const room = (e.props.bodyColumns || 80) - CLOSE_MARK
    const text = room > 1 && shown.length > room ? shown.slice(0, room - 1) + '…' : shown
    return Text({ dimColor: true, wrap: 'truncate-end', children: text })
  })
}
