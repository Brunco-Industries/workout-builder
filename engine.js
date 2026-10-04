/* engine.js — the fixed procedures for Stephen's workout builder (BUS 860).
   Pure functions only: no DOM, no storage, no network. Loaded by index.html and tests.html.
   Sources: knowledge/workout-rules.md §3 (blocks), §4 (equipment, nearest-valid), §8 (fill); CLAUDE.md v1.3.
   Every number in TIMING is a team assumption to verify by timing real sessions. */
(function (root) {
  'use strict';

  const APP_VERSION = '0.3.3'; // Phase 4 fix: the update banner no longer renders while hidden
  const SPEC_VERSION = '1.3';

  /* ---------- allowed values (workout-rules.md §1) ---------- */
  const TIMES = []; for (let t = 15; t <= 120; t += 5) TIMES.push(t);
  const EQUIPMENT = [
    { key: 'full-gym', code: 'FG', label: 'Full gym' },
    { key: 'basic-gym', code: 'BG', label: 'Basic gym' },
    { key: 'dumbbells-only', code: 'DB', label: 'Dumbbells only' },
    { key: 'kettlebell-only', code: 'KB', label: 'Kettlebell only' },
    { key: 'bodyweight-only', code: 'BW', label: 'Bodyweight only' }
  ];
  const MACHINES = ['treadmill', 'bike', 'rower', 'elliptical'];
  const DEFAULT_MACHINES = { 'full-gym': ['treadmill', 'bike', 'rower'], 'basic-gym': [] };
  const FOCUS = [
    { key: 'upper', label: 'Upper body', short: 'upper-body' },
    { key: 'lower', label: 'Lower body', short: 'lower-body' },
    { key: 'total', label: 'Total body', short: 'total-body' },
    { key: 'cardio', label: 'Cardio', short: 'cardio' },
    { key: 'core', label: 'Core only', short: 'core' }
  ];
  const TYPES = [
    { key: 'strength', label: 'Strength' },
    { key: 'power', label: 'Power' },
    { key: 'endurance', label: 'Endurance' }
  ];
  const STATUSES = ['done', 'shortened', 'swapped', 'skipped'];
  const COUNTS_TOWARD_GOAL = { done: true, shortened: true, swapped: true };
  const LOG_FIELDS = ['date', 'week_start', 'time_selected_min', 'equipment', 'focus', 'type', 'status', 'actual_min', 'note'];
  const SAFETY_LINE = 'Stop if you feel sharp pain, and see a professional.';
  const TIME_ZONE = 'America/Edmonton';
  const ROTATION_EPOCH = '2026-01-01';

  /* ---------- TIMING: every figure here is an ASSUMPTION (workout-rules.md §8) ---------- */
  const TIMING = {
    strength: { roundMinutes: 3, longRoundMinutes: 4, longMainFrom: 60, maxRoundsPerPair: 5,
      reps: '3–6', hold: '20–30 s', effort: 'a weight you could lift 1–2 more times', effortBodyweight: 'the hardest variation you can do for 3–6 clean reps' },
    power: { roundMinutes: 3, longRoundMinutes: 4, longMainFrom: 60, maxRoundsPerPair: 5,
      reps: '3–5 fast', jumps: '3–5 jumps', hold: '20–30 s', effort: 'light to moderate; move fast, and stop the set when speed drops', effortBodyweight: 'move fast, and stop the set when speed drops' },
    endurance: { stationSeconds: 45, changeSeconds: 15, roundRestSeconds: 60, minStations: 3, maxStations: 8, minRounds: 2, maxRounds: 12,
      reps: '12–20', effort: 'a weight you could lift 5+ more times; steady pace, strict form', effortBodyweight: 'steady pace, strict form' },
    cardio: { strengthHardMin: 2, strengthEasyMin: 1, powerOnSec: 20, powerOffSec: 100,
      effort: { endurance: 'a pace where you can speak in short sentences', strength: 'high resistance or a steep grade; hard but controlled', power: 'all-out on the work, fully easy on the recovery' } },
    coolDownCore: { stationSeconds: 45, changeSeconds: 15 },
    warmUp: { firstItemMinutesWhenFiveOrMore: 2 }
  };

  /* Warm-up and stretch choices by focus. Names must exist in the library; a struck row is skipped. */
  const WARMUP_PREF = {
    upper: ['Arm circles', 'Inchworm', "World's greatest stretch", 'Leg swings', 'Bodyweight squat'],
    lower: ['Leg swings', 'Bodyweight squat', "World's greatest stretch", 'Inchworm', 'Arm circles'],
    total: ["World's greatest stretch", 'Leg swings', 'Inchworm', 'Bodyweight squat', 'Arm circles'],
    cardio: ['Leg swings', 'Bodyweight squat', 'Arm circles', "World's greatest stretch", 'Inchworm'],
    core: ['Inchworm', "World's greatest stretch", 'Arm circles', 'Leg swings', 'Bodyweight squat']
  };
  const STRETCH_PREF = {
    upper: ['Doorway chest stretch', 'Lat stretch (hands on wall or chair)', "Child's pose", 'Hip flexor stretch', 'Hamstring stretch'],
    lower: ['Hamstring stretch', 'Hip flexor stretch', 'Figure-4 glute stretch', 'Quad stretch', "Child's pose"],
    total: ['Hamstring stretch', 'Doorway chest stretch', 'Hip flexor stretch', 'Lat stretch (hands on wall or chair)', 'Figure-4 glute stretch'],
    cardio: ['Hamstring stretch', 'Quad stretch', 'Hip flexor stretch', 'Figure-4 glute stretch', "Child's pose"],
    core: ["Child's pose", 'Hip flexor stretch', 'Lat stretch (hands on wall or chair)', 'Hamstring stretch', 'Doorway chest stretch']
  };
  const MARCH = 'Brisk walk or march in place';
  const EASY_CARDIO = 'Easy cardio (any machine ticked)';
  const RAMP_UP = 'Light ramp-up sets of first exercise';

  /* ---------- lookups ---------- */
  const byKey = (list, key) => list.find(x => x.key === key) || null;
  const equipCode = key => (byKey(EQUIPMENT, key) || {}).code;
  const equipLabel = key => (byKey(EQUIPMENT, key) || {}).label || key;
  const focusLabel = key => (byKey(FOCUS, key) || {}).label || key;
  const focusShort = key => (byKey(FOCUS, key) || {}).short || key;
  const typeLabel = key => (byKey(TYPES, key) || {}).label || key;

  /* ---------- CSV ---------- */
  function parseCSV(text) {
    const rows = []; let row = [], field = '', inQuotes = false;
    text = String(text).replace(/\r\n?/g, '\n');
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; }
        else field += c;
      } else if (c === '"') inQuotes = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else field += c;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows.filter(r => !(r.length === 1 && r[0] === ''));
  }
  function csvField(v) {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  /* ---------- the library ---------- */
  function parseLibrary(csvText) {
    const rows = parseCSV(csvText);
    if (!rows.length) throw new Error('The exercise library is empty.');
    const header = rows[0];
    ['exercise', 'focus', 'types', 'needs', 'allowed_equipment', 'notes', 'pattern'].forEach(h => {
      if (header.indexOf(h) < 0) throw new Error('exercise-library.csv is missing the column "' + h + '".');
    });
    const col = name => header.indexOf(name);
    return rows.slice(1).map((r, i) => {
      const name = r[col('exercise')];
      const pattern = r[col('pattern')];
      return {
        index: i,
        name,
        focus: r[col('focus')].split(';').filter(Boolean),
        types: r[col('types')].split(';').filter(s => s && s !== '-'),
        needs: r[col('needs')] === 'none' ? [] : r[col('needs')].split(';').filter(Boolean).map(g => g.split('|')),
        allowed: r[col('allowed_equipment')].split(';').filter(Boolean),
        notes: r[col('notes')] || '',
        pattern,
        timed: pattern === 'brace' || pattern === 'carry' || /\b(hold|sit|plank|carry)\b/i.test(name),
        // one-sided moves get "per side" / "switch sides"; lunges, step-ups and bird dogs alternate within the set
        perSide: /one-arm|single-leg|suitcase|split squat|side plank|get-up|woodchop|pallof/i.test(name)
      };
    });
  }
  const findRow = (library, name) => library.find(r => r.name === name) || null;

  /* workout-rules.md §4: allowed under the option, and any machine it needs is ticked. */
  function rowAllowed(row, equipment, machines) {
    if (!row.allowed.includes(equipCode(equipment))) return false;
    const ticked = machines || [];
    return row.needs.every(group => {
      const ms = group.filter(x => MACHINES.includes(x));
      return ms.length === 0 || ms.some(x => ticked.includes(x));
    });
  }

  /* ---------- workout-rules.md §3 ---------- */
  function blockMinutes(total) {
    if (!Number.isInteger(total) || !TIMES.includes(total)) {
      throw new RangeError('Time must be 15 to 120 minutes in 5-minute steps; got ' + JSON.stringify(total) + '.');
    }
    let w, c, k;
    if (total <= 25) { w = 3; c = 3; k = 2; }
    else if (total <= 45) { w = 5; c = 5; k = 3; }
    else if (total <= 75) { w = 8; c = 8; k = 4; }
    else { w = 10; c = 10; k = 5; }
    return { warmup: w, main: total - w - c, cooldown: c, minCore: k };
  }

  /* ---------- dates: plain YYYY-MM-DD strings; "today" is the America/Edmonton calendar date ---------- */
  const pad2 = n => String(n).padStart(2, '0');
  function parseISO(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s));
    if (!m) throw new RangeError('Not a date: ' + s);
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    if (d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) throw new RangeError('Not a real date: ' + s);
    return d;
  }
  const fmtISO = d => d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
  function isDate(s) { try { parseISO(s); return true; } catch (e) { return false; } }
  function addDays(iso, n) { const d = parseISO(iso); d.setUTCDate(d.getUTCDate() + n); return fmtISO(d); }
  function mondayOf(iso) { const d = parseISO(iso); const dow = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - dow); return fmtISO(d); }
  function dayIndex(iso) { return Math.round((parseISO(iso) - parseISO(ROTATION_EPOCH)) / 86400000); }
  function todayIn(zone, now) {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: zone || TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now || new Date());
    const get = t => parts.find(p => p.type === t).value;
    return get('year') + '-' + get('month') + '-' + get('day');
  }
  function longDate(iso) {
    return parseISO(iso).toLocaleDateString('en-CA', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  }

  /* ---------- the log (workout-rules.md §2, source-note.md) ---------- */
  function weeklyCount(log, today) {
    const ws = mondayOf(today), we = addDays(ws, 6);
    return (log || []).filter(r => r.date >= ws && r.date <= we && COUNTS_TOWARD_GOAL[r.status]).length;
  }
  function lastTrained(log, focus, opts) {
    const before = opts && opts.before;
    let best = null;
    (log || []).forEach(r => {
      if (r.focus !== focus || r.status === 'skipped') return;
      if (before && r.date >= before) return;
      if (!best || r.date > best) best = r.date;
    });
    return best;
  }
  const focusCount = (log, focus) => (log || []).filter(r => r.focus === focus && r.status !== 'skipped').length;

  /* ---------- validation: refuse, never round or default ---------- */
  function validateSelections(sel) {
    const errs = [];
    sel = sel || {};
    if (!TIMES.includes(sel.time)) errs.push('Time must be 15 to 120 minutes in 5-minute steps.');
    if (!byKey(EQUIPMENT, sel.equipment)) errs.push('Equipment must be one of: ' + EQUIPMENT.map(e => e.label).join(', ') + '.');
    const m = sel.machines || [];
    if (!Array.isArray(m) || m.some(x => !MACHINES.includes(x))) errs.push('Cardio machines must be from: ' + MACHINES.join(', ') + '.');
    else if (m.length && !(sel.equipment in DEFAULT_MACHINES)) errs.push('Cardio machines apply only to Full gym and Basic gym.');
    if (!byKey(FOCUS, sel.focus)) errs.push('Focus must be one of: ' + FOCUS.map(f => f.label).join(', ') + '.');
    if (!byKey(TYPES, sel.type)) errs.push('Type must be one of: ' + TYPES.map(t => t.label).join(', ') + '.');
    return errs;
  }
  function validateGoal(v) {
    const s = String(v === undefined || v === null ? '' : v).trim();
    if (!/^\d+$/.test(s) || +s < 1 || +s > 7) return 'The goal must be a whole number from 1 to 7.';
    return null;
  }
  function validateLogRow(row, line) {
    const errs = [], at = line ? 'Line ' + line + ': ' : '';
    if (!isDate(row.date)) errs.push(at + 'date must be a real YYYY-MM-DD date.');
    else if (row.week_start !== mondayOf(row.date)) errs.push(at + 'week_start must be the Monday of date (' + mondayOf(row.date) + ').');
    if (!TIMES.includes(Number(row.time_selected_min)) || !/^\d+$/.test(String(row.time_selected_min))) errs.push(at + 'time_selected_min must be 15 to 120 in 5-minute steps.');
    if (!byKey(EQUIPMENT, row.equipment)) errs.push(at + 'equipment must be one of ' + EQUIPMENT.map(e => e.key).join(', ') + '.');
    if (!byKey(FOCUS, row.focus)) errs.push(at + 'focus must be one of ' + FOCUS.map(f => f.key).join(', ') + '.');
    if (!byKey(TYPES, row.type)) errs.push(at + 'type must be one of ' + TYPES.map(t => t.key).join(', ') + '.');
    if (!STATUSES.includes(row.status)) errs.push(at + 'status must be one of ' + STATUSES.join(', ') + '.');
    const am = row.actual_min;
    if (!(am === '' || am === null || am === undefined || (/^\d+$/.test(String(am)) && Number(am) >= 1))) errs.push(at + 'actual_min must be blank or a whole number of at least 1.');
    return errs;
  }
  function serializeLog(rows) {
    return [LOG_FIELDS.join(',')].concat((rows || []).map(r => LOG_FIELDS.map(f => csvField(r[f])).join(','))).join('\n') + '\n';
  }
  function parseLog(text) {
    const rows = parseCSV(text);
    if (!rows.length) return { rows: [], errors: ['The file is empty.'] };
    if (rows[0].join(',') !== LOG_FIELDS.join(',')) return { rows: [], errors: ['The header must be exactly: ' + LOG_FIELDS.join(',')] };
    const out = [], errors = [];
    rows.slice(1).forEach((r, i) => {
      const line = i + 2;
      if (r.length !== LOG_FIELDS.length) { errors.push('Line ' + line + ': expected ' + LOG_FIELDS.length + ' fields, found ' + r.length + '.'); return; }
      const row = {};
      LOG_FIELDS.forEach((f, j) => { row[f] = r[j]; });
      if (/^\d+$/.test(row.time_selected_min)) row.time_selected_min = Number(row.time_selected_min);
      if (/^\d+$/.test(row.actual_min)) row.actual_min = Number(row.actual_min);
      const e = validateLogRow(row, line);
      if (e.length) errors.push.apply(errors, e); else out.push(row);
    });
    return { rows: errors.length ? [] : out, errors };
  }

  /* ---------- pools and the nearest-valid steps (workout-rules.md §4) ---------- */
  /* Rows whose pattern is "cardio" are modalities (machines, runs, the bodyweight circuit): they appear only under the Cardio focus. */
  function poolFor(library, sel, focus, type) {
    return library.filter(r => r.focus.includes(focus) && (!type || r.types.includes(type)) && (focus === 'cardio' || r.pattern !== 'cardio') && rowAllowed(r, sel.equipment, sel.machines));
  }
  function upperLowerRows(library, sel, type) {
    return library.filter(r => (r.focus.includes('upper') || r.focus.includes('lower')) && (!type || r.types.includes(type)) && r.pattern !== 'cardio' && rowAllowed(r, sel.equipment, sel.machines));
  }
  function addRows(pool, rows) {
    const names = new Set(pool.map(r => r.name)), added = [];
    rows.forEach(r => { if (!names.has(r.name)) { pool.push(r); names.add(r.name); added.push(r); } });
    return added;
  }
  function selectionText(sel) { return focusLabel(sel.focus) + ' · ' + typeLabel(sel.type) + ' with ' + equipLabel(sel.equipment); }

  function allowedExercises(library, sel) {
    const base = poolFor(library, sel, sel.focus, sel.type);
    const pool = base.slice(), notes = [];
    let deliveredType = sel.type;
    const min = sel.focus === 'cardio' ? 1 : 2;
    if (pool.length < min) {
      const head = selectionText(sel) + (base.length ? ' has only one exercise in the library.' : ' has no exercise in the library.');
      if (sel.focus === 'total') {
        const added = addRows(pool, upperLowerRows(library, sel, sel.type));
        if (added.length) notes.push(head + ' Using upper- and lower-body ' + sel.type + ' exercises.');
      }
      if (pool.length < min) {
        const hadBase = pool.length > 0;
        const added = addRows(pool, poolFor(library, sel, sel.focus, 'endurance'));
        if (added.length) {
          if (!hadBase) { deliveredType = 'endurance'; notes.push(head + ' This is ' + focusLabel(sel.focus) + ' · Endurance.'); }
          else notes.push(head + ' Added ' + focusShort(sel.focus) + ' endurance work.');
        }
      }
      if (pool.length < min) notes.push(head + ' Nothing in the library fits; choose other equipment or another focus.');
    }
    return { base, pool, notes, deliveredType };
  }

  /* Decision 2: when a pool is smaller than the block needs, extend it in a fixed order.
     Total body keeps the chosen type as long as it can (upper- and lower-body rows of the same type first). */
  function extendPool(ctx, pool, needed, sessionType) {
    if (pool.length >= needed) return pool;
    const before = pool.length, what = [];
    const tryAdd = (rows, label) => { if (pool.length >= needed) return; if (addRows(pool, rows).length) what.push(label); };
    if (ctx.sel.focus === 'total') tryAdd(upperLowerRows(ctx.library, ctx.sel, sessionType), 'upper- and lower-body ' + sessionType);
    if (sessionType !== 'endurance') tryAdd(poolFor(ctx.library, ctx.sel, ctx.sel.focus, 'endurance'), focusShort(ctx.sel.focus) + ' endurance');
    TYPES.forEach(t => { if (t.key !== sessionType && t.key !== 'endurance') tryAdd(poolFor(ctx.library, ctx.sel, ctx.sel.focus, t.key), focusShort(ctx.sel.focus) + ' ' + t.key); });
    if (ctx.sel.focus === 'total') tryAdd(upperLowerRows(ctx.library, ctx.sel, null), 'upper- and lower-body');
    if (pool.length > before) ctx.notes.push('Only ' + before + ' exercises fit ' + selectionText(ctx.sel) + '; added ' + what.join(', then ') + ' work to fill the block.');
    return pool;
  }

  /* The base pool, rotated to the day's start, then any extension rows in the order they were added:
     the exercises that truly fit the selection are always used before any filler. */
  function orderedPool(base, extended, start) {
    const n = base.length;
    const k = n ? ((start % n) + n) % n : 0;
    return base.slice(k).concat(base.slice(0, k)).concat(extended.slice(n));
  }

  /* Rotation: walk a list in order, each exercise at most once, optionally with a predicate. */
  function makeRotation(pool, start) {
    const used = pool.map(() => false);
    let pos = pool.length ? ((start % pool.length) + pool.length) % pool.length : 0;
    return {
      next(pred) {
        for (let k = 0; k < pool.length; k++) {
          const i = (pos + k) % pool.length;
          if (!used[i] && (!pred || pred(pool[i]))) { used[i] = true; pos = (i + 1) % pool.length; return pool[i]; }
        }
        return null;
      }
    };
  }

  /* Effort in words, never a weight (workout-rules.md §7). Bodyweight days get wording without a load. */
  function effortFor(sel, type) {
    const cfg = TIMING[type] || TIMING.endurance;
    return sel.equipment === 'bodyweight-only' && cfg.effortBodyweight ? cfg.effortBodyweight : cfg.effort;
  }

  /* What one exercise shows: sets × reps or time, rest. Rows outside the session type keep their own type's dose. */
  function prescribe(row, sessionType, sets, rest) {
    const t = row.types.includes(sessionType) ? sessionType : (row.types[0] || sessionType);
    let work;
    if (t === 'strength') work = row.timed ? TIMING.strength.hold : TIMING.strength.reps;
    else if (t === 'power') work = row.timed ? TIMING.power.hold : (row.pattern === 'jump' ? TIMING.power.jumps : TIMING.power.reps);
    else work = row.timed ? TIMING.endurance.stationSeconds + ' s' : TIMING.endurance.reps;
    return sets + ' × ' + work + (row.perSide ? ' per side' : '') + (rest ? ' · rest ' + rest : '');
  }
  const item = (tag, row, text, minutes) => ({ tag, name: row.name, pattern: row.pattern, note: row.notes, text, minutes });

  /* ---------- main block: strength and power as paired rounds ---------- */
  function pairsBlock(ctx, pool, main, type) {
    const cfg = TIMING[type];
    const roundLen = main >= cfg.longMainFrom ? cfg.longRoundMinutes : cfg.roundMinutes;
    const rest = roundLen === cfg.roundMinutes ? '60 s' : '90 s';
    const R = Math.floor(main / roundLen);
    let P = Math.ceil(R / cfg.maxRoundsPerPair);
    const base = pool.slice();
    pool = extendPool(ctx, pool.slice(), 2 * P, type);
    const rot = makeRotation(orderedPool(base, pool, ctx.start), 0);
    const items = [];
    const maxPairs = Math.floor(pool.length / 2);
    let roundsPerPair = [];
    if (maxPairs < 1) {
      const row = rot.next();
      if (!row) throw new Error('No exercise fits ' + selectionText(ctx.sel) + '.');
      items.push(item('1', row, prescribe(row, type, R, rest)));
      roundsPerPair = [R];
      ctx.notes.push('Only one exercise fits this selection: straight sets instead of pairs.');
    } else {
      if (P > maxPairs) { P = maxPairs; ctx.notes.push('Rounds per pair above ' + cfg.maxRoundsPerPair + ': only ' + pool.length + ' exercises fit this selection.'); }
      const base = Math.floor(R / P), extra = R % P;
      for (let p = 0; p < P; p++) {
        const rounds = base + (p < extra ? 1 : 0), L = String.fromCharCode(65 + p);
        const a1 = rot.next();
        let a2 = rot.next(r => r.pattern !== a1.pattern);
        if (!a2) { a2 = rot.next(); ctx.notes.push('Pair ' + L + ': both exercises are ' + a1.pattern + ' movements; no other pattern fits this selection.'); }
        items.push(item(L + '1', a1, prescribe(a1, type, rounds, rest)), item(L + '2', a2, prescribe(a2, type, rounds, rest)));
        roundsPerPair.push(rounds);
      }
    }
    const remainder = main - R * roundLen;
    const lo = Math.min.apply(null, roundsPerPair), hi = Math.max.apply(null, roundsPerPair);
    const effort = effortFor(ctx.sel, type);
    const intro = typeLabel(type) + ': ' + (type === 'strength' ? cfg.reps + ' reps, ' + effort : cfg.reps + ' reps, ' + effort) +
      '. A1, rest, A2, rest; ' + (lo === hi ? lo : lo + '–' + hi) + ' rounds per pair, about ' + roundLen + ' min a round.';
    return { kind: 'pairs', roundMinutes: roundLen, rounds: R, pairs: items.length / 2, items, remainder, minutesUsed: R * roundLen,
      intro, tail: remainder ? 'Set-up and change-over · ' + remainder + ' min' : '', used: items.map(i => i.name) };
  }

  /* ---------- main block: endurance as a circuit ---------- */
  function chooseCircuit(main, maxS) {
    const c = TIMING.endurance;
    let best = null;
    for (let S = Math.min(c.minStations, maxS); S <= maxS; S++) {
      for (let N = c.minRounds; N <= c.maxRounds; N++) {
        const t = N * (S + 1);
        if (t > main) continue;
        const rem = main - t;
        const better = !best || rem < best.rem || (rem === best.rem && (Math.abs(S - 5) < Math.abs(best.S - 5) || (Math.abs(S - 5) === Math.abs(best.S - 5) && N > best.N)));
        if (better) best = { S, N, rem };
      }
    }
    return best;
  }
  function circuitBlock(ctx, pool, main, reserve) {
    const c = TIMING.endurance;
    let pick = chooseCircuit(main, c.maxStations);
    const base = pool.slice();
    pool = extendPool(ctx, pool.slice(), pick.S + reserve, 'endurance');
    let maxS = Math.min(c.maxStations, pool.length - reserve);
    if (maxS < c.minStations) maxS = Math.min(c.maxStations, Math.max(1, pool.length)); // the cool-down core may then repeat, and says so
    pick = chooseCircuit(main, maxS);
    const rot = makeRotation(orderedPool(base, pool, ctx.start), 0);
    const items = [];
    let prev = null;
    for (let s = 0; s < pick.S; s++) {
      const row = rot.next(r => !prev || r.pattern !== prev.pattern) || rot.next();
      if (!row) break;
      items.push(item(String(s + 1), row, pick.N + ' × ' + c.stationSeconds + ' s' + (row.perSide ? ', switch sides halfway' : '')));
      prev = row;
    }
    const remainder = main - pick.N * (pick.S + 1);
    const intro = 'Endurance circuit: ' + c.stationSeconds + ' s work, ' + c.changeSeconds + ' s change-over, ' + c.roundRestSeconds + ' s rest after each round. ' +
      pick.S + ' station' + (pick.S === 1 ? '' : 's') + ' × ' + pick.N + ' rounds. Effort: ' + effortFor(ctx.sel, 'endurance') + '.';
    return { kind: 'circuit', stations: pick.S, rounds: pick.N, items, remainder, minutesUsed: pick.N * (pick.S + 1),
      intro, tail: remainder ? 'Change-over · ' + remainder + ' min' : '', used: items.map(i => i.name) };
  }

  /* ---------- main block: cardio as one modality (exercise-reference.md §5) ---------- */
  function cardioBlock(ctx, pool, main, type) {
    const c = TIMING.cardio;
    const rot = makeRotation(pool, ctx.start);
    const row = rot.next();
    if (!row) throw new Error('No cardio option fits ' + selectionText(ctx.sel) + '.');
    const alternatives = pool.filter(r => r.name !== row.name).map(r => r.name);
    let text, intro, tail = '', minutesUsed = main;
    if (type === 'endurance') {
      text = main + ' min steady effort';
      intro = 'Steady effort for the whole block, ' + c.effort.endurance + '.';
    } else if (type === 'strength') {
      const unit = c.strengthHardMin + c.strengthEasyMin, k = Math.floor(main / unit), rem = main - k * unit;
      text = k + ' × (' + c.strengthHardMin + ' min hard + ' + c.strengthEasyMin + ' min easy)';
      intro = 'Resisted cardio, ' + c.effort.strength + '. Work intervals of ' + c.strengthHardMin + ' min.';
      minutesUsed = k * unit; if (rem) tail = 'Easy finish · ' + rem + ' min';
    } else {
      const unitMin = (c.powerOnSec + c.powerOffSec) / 60, k = Math.floor(main / unitMin), rem = main - k * unitMin;
      text = k + ' × (' + c.powerOnSec + ' s all-out + ' + c.powerOffSec + ' s easy)';
      intro = 'Short all-out efforts with full recovery (1:5), ' + c.effort.power + '.';
      minutesUsed = k * unitMin; if (rem) tail = 'Easy finish · ' + rem + ' min';
    }
    return { kind: 'cardio', items: [item('', row, text)], alternatives, remainder: main - minutesUsed, minutesUsed, intro, tail, used: [row.name] };
  }

  /* ---------- cool-down: stretching, then the core portion (workout-rules.md §3 and §6) ---------- */
  function allocate(rows, minutes) {
    if (!rows.length || minutes <= 0) return [];
    const n = Math.min(rows.length, minutes), base = Math.floor(minutes / n), extra = minutes % n;
    return rows.slice(0, n).map((row, i) => item('', row, (base + (i < extra ? 1 : 0)) + ' min', base + (i < extra ? 1 : 0)));
  }
  function coreBlock(ctx, minCore, usedNames) {
    const c = TIMING.coolDownCore;
    const corePool = ctx.library.filter(r => r.focus.includes('core') && rowAllowed(r, ctx.sel.equipment, ctx.sel.machines));
    const ordered = corePool.filter(r => r.types.includes('endurance')).concat(corePool.filter(r => !r.types.includes('endurance')));
    const unused = ordered.filter(r => !usedNames.has(r.name));
    const seq = unused.length >= minCore ? unused : unused.concat(ordered.filter(r => usedNames.has(r.name)));
    const rot = makeRotation(seq, unused.length >= minCore ? ctx.start : 0);
    const items = [];
    let repeated = false;
    for (let i = 0; i < minCore; i++) {
      const row = rot.next();
      if (!row) break;
      if (usedNames.has(row.name)) repeated = true;
      items.push(item('', row, c.stationSeconds + ' s' + (row.perSide ? ', switch sides halfway' : ''), 1));
    }
    if (repeated) ctx.notes.push('The cool-down core repeats moves from the main block: the core pool for this equipment is used up.');
    return { minutes: items.length, items, tail: c.changeSeconds + ' s between core moves' };
  }
  function stretchBlock(ctx, minutes, usedNames) {
    const rows = STRETCH_PREF[ctx.sel.focus].map(n => findRow(ctx.library, n)).filter(r => r && rowAllowed(r, ctx.sel.equipment, ctx.sel.machines) && !usedNames.has(r.name));
    return allocate(rows, minutes);
  }

  /* ---------- warm-up: easy movement first, mobility, then ramp-up sets for strength and power ---------- */
  function warmupBlock(ctx, w, sessionType, usedNames) {
    const lib = ctx.library, sel = ctx.sel, items = [];
    const ramp = (sessionType !== 'endurance' && sel.focus !== 'cardio') ? findRow(lib, RAMP_UP) : null;
    let left = w - (ramp ? 1 : 0);
    const easy = findRow(lib, EASY_CARDIO), march = findRow(lib, MARCH);
    const first = (easy && rowAllowed(easy, sel.equipment, sel.machines)) ? easy : (march && rowAllowed(march, sel.equipment, sel.machines) ? march : null);
    const firstMin = w >= 5 ? TIMING.warmUp.firstItemMinutesWhenFiveOrMore : 1;
    if (first) { items.push(item('', first, firstMin + ' min', firstMin)); left -= firstMin; }
    const mobility = WARMUP_PREF[sel.focus].map(n => findRow(lib, n)).filter(r => r && rowAllowed(r, sel.equipment, sel.machines) && !usedNames.has(r.name));
    allocate(mobility, left).forEach(it => items.push(it));
    if (ramp) items.push(item('', ramp, '1 min', 1));
    const sum = items.reduce((a, it) => a + it.minutes, 0);
    if (sum < w && items.length) { items[0].minutes += w - sum; items[0].text = items[0].minutes + ' min'; } // only if the library lost its mobility rows
    return items;
  }

  /* ---------- the workout ---------- */
  function buildWorkout(library, sel, log, today) {
    const errs = validateSelections(sel);
    if (errs.length) throw new RangeError(errs.join(' '));
    if (!isDate(today)) throw new RangeError('today must be a YYYY-MM-DD date.');
    const b = blockMinutes(sel.time);
    const ae = allowedExercises(library, sel);
    const type = ae.deliveredType;
    const ctx = { library, sel, notes: ae.notes.slice(), start: dayIndex(today) + focusCount(log, sel.focus) };
    let main;
    if (sel.focus === 'cardio') main = cardioBlock(ctx, ae.pool, b.main, type);
    else if (type === 'endurance') main = circuitBlock(ctx, ae.pool, b.main, sel.focus === 'core' ? b.minCore : 0);
    else main = pairsBlock(ctx, ae.pool, b.main, type);
    const used = new Set(main.used);
    const core = coreBlock(ctx, b.minCore, used);
    core.items.forEach(i => used.add(i.name));
    const stretch = stretchBlock(ctx, b.cooldown - core.minutes, used);
    stretch.forEach(i => used.add(i.name));
    const warmup = warmupBlock(ctx, b.warmup, type, used);
    const w = {
      version: APP_VERSION, specVersion: SPEC_VERSION, date: today,
      selections: { time: sel.time, equipment: sel.equipment, machines: (sel.machines || []).slice(), focus: sel.focus, type: sel.type },
      header: {
        focus: focusLabel(sel.focus), type: typeLabel(type), chosenType: typeLabel(sel.type), typeChanged: type !== sel.type,
        total: sel.time, equipment: equipLabel(sel.equipment), machines: (sel.machines || []).slice(),
        showsMachines: sel.equipment in DEFAULT_MACHINES
      },
      notes: ctx.notes, blocks: b, warmup, main, cooldown: { stretch, core },
      effort: sel.focus === 'cardio' ? TIMING.cardio.effort[type] : effortFor(sel, type),
      safety: SAFETY_LINE
    };
    w.check = {
      sum: b.warmup + b.main + b.cooldown, total: sel.time,
      coreMinutes: core.minutes, minCore: b.minCore,
      ok: b.warmup + b.main + b.cooldown === sel.time && core.minutes >= b.minCore
    };
    w.text = workoutText(w);
    return w;
  }

  function workoutText(w) {
    const L = [];
    L.push(w.header.focus + ' · ' + w.header.type + (w.header.typeChanged ? ' (you chose ' + w.header.chosenType + ')' : '') + ' · ' + w.header.total + ' min');
    L.push(w.header.equipment + (w.header.showsMachines ? (w.header.machines.length ? ' · machines: ' + w.header.machines.join(', ') : ' · no cardio machines ticked') : ''));
    w.notes.forEach(n => L.push('Note: ' + n));
    L.push('Warm-up · ' + w.blocks.warmup + ' min');
    w.warmup.forEach(i => L.push('  ' + i.name + ' · ' + i.text));
    L.push('Main block · ' + w.blocks.main + ' min');
    L.push('  ' + w.main.intro);
    w.main.items.forEach(i => L.push('  ' + (i.tag ? i.tag + ' ' : '') + i.name + ' · ' + i.text + (i.note ? ' (' + i.note + ')' : '')));
    if (w.main.alternatives && w.main.alternatives.length) L.push('  Also fits: ' + w.main.alternatives.join(', '));
    if (w.main.tail) L.push('  ' + w.main.tail);
    L.push('Cool-down · ' + w.blocks.cooldown + ' min');
    w.cooldown.stretch.forEach(i => L.push('  ' + i.name + ' · ' + i.text));
    L.push('  Core · ' + w.cooldown.core.minutes + ' min');
    w.cooldown.core.items.forEach(i => L.push('    ' + i.name + ' · ' + i.text));
    L.push('  ' + w.cooldown.core.tail);
    L.push('Block check: ' + w.blocks.warmup + ' + ' + w.blocks.main + ' + ' + w.blocks.cooldown + ' = ' + w.check.sum + ' min' + (w.check.sum === w.check.total ? ' ✓' : ' ✗') +
      ' · core ' + w.check.coreMinutes + ' ≥ ' + w.check.minCore + (w.check.coreMinutes >= w.check.minCore ? ' ✓' : ' ✗'));
    L.push(w.safety);
    return L.join('\n');
  }

  /* ---------- audit: the checks a reviewer runs on any generated workout ---------- */
  const WEIGHT_RE = /\b\d+(\.\d+)?\s?(kg|kgs|kilo|kilos|lb|lbs|pound|pounds)\b/i;
  const PUSH_THROUGH_RE = /push(ing)? through/i;
  function audit(w, library) {
    const v = [];
    const sel = w.selections, b = w.blocks;
    if (b.warmup + b.main + b.cooldown !== sel.time) v.push('blocks do not sum to the selected time');
    const warmMin = w.warmup.reduce((a, i) => a + i.minutes, 0);
    if (warmMin !== b.warmup) v.push('warm-up items sum to ' + warmMin + ', not ' + b.warmup);
    if (w.main.minutesUsed + w.main.remainder !== b.main) v.push('main block does not account for its minutes');
    const stretchMin = w.cooldown.stretch.reduce((a, i) => a + i.minutes, 0);
    if (stretchMin + w.cooldown.core.minutes !== b.cooldown) v.push('cool-down items sum to ' + (stretchMin + w.cooldown.core.minutes) + ', not ' + b.cooldown);
    if (w.cooldown.core.minutes < b.minCore) v.push('core ' + w.cooldown.core.minutes + ' min is below the minimum ' + b.minCore);
    const all = [].concat(w.warmup, w.main.items, w.cooldown.stretch, w.cooldown.core.items);
    all.forEach(i => {
      const row = findRow(library, i.name);
      if (!row) v.push('"' + i.name + '" is not in the library');
      else if (!rowAllowed(row, sel.equipment, sel.machines)) v.push('"' + i.name + '" is not allowed under ' + sel.equipment + (sel.machines.length ? ' with ' + sel.machines.join('/') : ''));
    });
    const seen = new Set();
    [].concat(w.warmup, w.main.items, w.cooldown.stretch).forEach(i => { if (seen.has(i.name)) v.push('"' + i.name + '" repeats'); seen.add(i.name); });
    const coreRepeats = w.cooldown.core.items.filter(i => seen.has(i.name));
    if (coreRepeats.length && !w.notes.some(n => /cool-down core repeats/.test(n))) v.push('cool-down core repeats without saying so');
    if (WEIGHT_RE.test(w.text)) v.push('a weight is stated');
    if (PUSH_THROUGH_RE.test(w.text)) v.push('"push through" language');
    if (w.text.indexOf(SAFETY_LINE) < 0) v.push('safety line missing');
    if (w.main.kind === 'pairs' && w.selections.type === 'strength' && !w.header.typeChanged) {
      if (!w.main.items.some(i => /^A1$/.test(i.tag)) || !w.main.items.some(i => /^A2$/.test(i.tag))) v.push('strength block has no A1/A2 pair');
      w.main.items.forEach(i => { const row = findRow(library, i.name); if (row && row.types.includes('strength') && !/3–6|20–30 s/.test(i.text)) v.push('"' + i.name + '" is not dosed 3–6 reps'); });
    }
    return v;
  }

  root.Engine = {
    APP_VERSION, SPEC_VERSION, TIMES, EQUIPMENT, MACHINES, DEFAULT_MACHINES, FOCUS, TYPES, STATUSES, LOG_FIELDS, SAFETY_LINE, TIMING, TIME_ZONE,
    parseCSV, csvField, parseLibrary, findRow, rowAllowed,
    blockMinutes, parseISO, isDate, addDays, mondayOf, dayIndex, todayIn, longDate,
    weeklyCount, lastTrained, focusCount,
    validateSelections, validateGoal, validateLogRow, serializeLog, parseLog,
    allowedExercises, buildWorkout, workoutText, audit,
    equipLabel, focusLabel, typeLabel
  };
})(typeof window !== 'undefined' ? window : this);
