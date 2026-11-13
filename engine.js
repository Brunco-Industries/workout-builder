/* engine.js — the fixed procedures for Stephen's workout builder (BUS 860).
   Pure functions only: no DOM, no storage, no network. Loaded by index.html and tests.html.
   Sources: knowledge/workout-rules.md §3 (blocks), §4 (equipment, nearest-valid), §8 (fill); CLAUDE.md v1.3.
   Every number in TIMING is a team assumption to verify by timing real sessions. */
(function (root) {
  'use strict';

  const APP_VERSION = '0.7.2'; // D5 TEMPLATE: start from the last session for the focus; swap, add or drop; the same checks
  const SPEC_VERSION = '1.6';

  /* ---------- allowed values (workout-rules.md §1) ---------- */
  const TIMES = []; for (let t = 15; t <= 120; t += 5) TIMES.push(t);
  const EQUIPMENT = [
    { key: 'full-gym', code: 'FG', label: 'Full gym' },
    { key: 'basic-gym', code: 'BG', label: 'Basic gym' },
    { key: 'dumbbells-only', code: 'DB', label: 'Dumbbells only' },
    { key: 'kettlebell-only', code: 'KB', label: 'Kettlebell only' },
    { key: 'bodyweight-only', code: 'BW', label: 'Bodyweight only' }
  ];
  // Machine ticks for Full gym and Basic gym. Full gym starts with all of them, benchmarked against a large commercial club's published list (workout-rules.md §4).
  const MACHINES = ['treadmill', 'bike', 'rower', 'elliptical', 'stairclimber', 'sled'];
  const MACHINE_LABELS = { treadmill: 'Treadmill', bike: 'Bike', rower: 'Rower', elliptical: 'Elliptical', stairclimber: 'Stair climber', sled: 'Sled' };
  const DEFAULT_MACHINES = { 'full-gym': MACHINES.slice(), 'basic-gym': [] };
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
  const TIME_ZONE = null; // decision 9 (2026-11-12): dates are the phone's local calendar day; 'America/Edmonton' was fixed here from 2026-10-04 to 2026-11-12
  const ROTATION_EPOCH = '2026-01-01';

  /* ---------- TIMING: every figure here is an ASSUMPTION (workout-rules.md §8) ---------- */
  const TIMING = {
    strength: { roundMinutes: 4, restSeconds: 90, maxRoundsPerPair: 5, // 4-min rounds, 90 s rests at every length: decision 2 (2026-11-12); before, 3 min / 60 s under a 60-min main block
      reps: '8–12', hold: '20–30 s', effort: 'a weight you could lift 1–2 more times', effortBodyweight: 'the hardest variation you can do for 8–12 clean reps' }, // 8–12: Stephen, 2026-11-12 (workout-rules.md §5)
    power: { roundMinutes: 3, restSeconds: 60, longRoundMinutes: 4, longRestSeconds: 90, longMainFrom: 60, maxRoundsPerPair: 5,
      reps: '3–5 fast', jumps: '3–5 jumps', hold: '20–30 s', effort: 'light to moderate; move fast, and stop the set when speed drops', effortBodyweight: 'move fast, and stop the set when speed drops' },
    endurance: { stationSeconds: 45, changeSeconds: 15, roundRestSeconds: 60, minStations: 3, maxStations: 8, minRounds: 2, maxRounds: 4, // at most 4 rounds per circuit: decision 4 (2026-11-12); 12 before
      reps: '12–20', effort: 'a weight you could lift 5+ more times; steady pace, strict form', effortBodyweight: 'steady pace, strict form' },
    cardio: { strengthHardMin: 2, strengthEasyMin: 1, powerOnSec: 20, powerOffSec: 100,
      effort: { endurance: 'a pace where you can speak in short sentences', strength: 'high resistance or a steep grade; hard but controlled', power: 'all-out on the work, fully easy on the recovery' } },
    coolDownCore: { stationSeconds: 45, changeSeconds: 15 },
    warmUp: { firstItemMinutesWhenFiveOrMore: 2 },
    carry: { distance: 'about 40 m' } // a team figure (library review, 2026-11-12): carries and the sled are counted by distance
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
    ['exercise', 'focus', 'types', 'needs', 'allowed_equipment', 'notes', 'pattern', 'load_class', 'dose', 'cooldown', 'cue'].forEach(h => {
      if (header.indexOf(h) < 0) throw new Error('exercise-library.csv is missing the column "' + h + '".');
    });
    const col = name => header.indexOf(name);
    const LOAD_CLASSES = ['barbell', 'weights', 'bodyweight'], DOSES = ['reps', 'time', 'distance'];
    return rows.slice(1).map((r, i) => {
      const name = r[col('exercise')];
      const pattern = r[col('pattern')];
      const loadClass = r[col('load_class')], dose = r[col('dose')], cooldown = r[col('cooldown')];
      // The library's own columns say how a row is counted and where it may appear (source-note.md, version 2); a row outside the lists is refused, never guessed.
      if (!LOAD_CLASSES.includes(loadClass)) throw new Error('exercise-library.csv row ' + (i + 2) + ' ("' + name + '") has load_class "' + loadClass + '", not barbell, weights or bodyweight.');
      if (!DOSES.includes(dose)) throw new Error('exercise-library.csv row ' + (i + 2) + ' ("' + name + '") has dose "' + dose + '", not reps, time or distance.');
      if (cooldown !== 'yes' && cooldown !== 'no') throw new Error('exercise-library.csv row ' + (i + 2) + ' ("' + name + '") has cooldown "' + cooldown + '", not yes or no.');
      return {
        index: i,
        name,
        focus: r[col('focus')].split(';').filter(Boolean),
        types: r[col('types')].split(';').filter(s => s && s !== '-'),
        needs: r[col('needs')] === 'none' ? [] : r[col('needs')].split(';').filter(Boolean).map(g => g.split('|')),
        allowed: r[col('allowed_equipment')].split(';').filter(Boolean),
        notes: r[col('notes')] || '',
        pattern,
        loadClass,
        dose,
        timed: dose === 'time',
        distance: dose === 'distance',
        cooldownOk: cooldown === 'yes',
        cue: r[col('cue')] || '',
        // one-sided moves get "per side" / "switch sides"; lunges, step-ups and bird dogs alternate within the set
        perSide: /one-arm|single-leg|suitcase|split squat|side plank|get-up|woodchop|pallof|copenhagen/i.test(name)
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
  /* Today's date. With no zone it is the phone's local calendar day (workout-rules.md §2, decision 9 of 2026-11-12); a named zone is
     still honoured for callers that pass one. From 2026-10-04 to 2026-11-12 the app fixed America/Edmonton (TIME_ZONE) instead. */
  function todayIn(zone, now) {
    const d = now || new Date();
    if (!zone) return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
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

  /* ---------- the session record (workout-rules.md §10, source-note.md): one row per main-block exercise of a logged workout ----------
     What he did is his; a blank is "not recorded", never zero and never the prescription. rotation_start keeps where the build's rotation
     began, so the next build for the focus can start where this one left off (decision 5). */
  const SESSION_FIELDS = ['date', 'row_id', 'order', 'exercise', 'prescribed', 'done_sets', 'done_reps', 'done_time', 'load', 'unit', 'feel', 'skipped', 'energy', 'soreness', 'rotation_start'];
  const FEELS = [{ key: 'easy', label: 'Easy' }, { key: 'right', label: 'Right' }, { key: 'too-hard', label: 'Too hard' }];
  const UNITS = ['kg', 'lb'];
  const LB_PER_KG = 2.20462; // a unit conversion for comparing bests only; loads are shown in the unit he recorded
  const blank = v => v === '' || v === null || v === undefined;
  const isWhole = v => /^\d+$/.test(String(v));
  function validateSessionRow(r, line) {
    const errs = [], at = line ? 'Line ' + line + ': ' : '';
    r = r || {};
    if (!isDate(r.date)) errs.push(at + 'date must be a real YYYY-MM-DD date.');
    if (blank(r.row_id)) errs.push(at + 'row_id must name the training-log row.');
    if (!isWhole(r.order) || Number(r.order) < 1) errs.push(at + 'order must be a whole number from 1.');
    if (blank(r.exercise)) errs.push(at + 'exercise must be named.');
    ['done_sets', 'done_reps', 'done_time'].forEach(f => { if (!blank(r[f]) && !isWhole(r[f])) errs.push(at + f + ' must be blank or a whole number.'); });
    if (!blank(r.load) && !/^\d+(\.\d+)?$/.test(String(r.load))) errs.push(at + 'load must be blank or a number.');
    if (!blank(r.load) && !UNITS.includes(r.unit)) errs.push(at + 'unit must be kg or lb when a load is given.');
    if (blank(r.load) && !blank(r.unit) && !UNITS.includes(r.unit)) errs.push(at + 'unit must be kg, lb or blank.');
    if (!blank(r.feel) && !FEELS.some(f => f.key === r.feel)) errs.push(at + 'feel must be blank, easy, right or too-hard.');
    if (r.skipped !== 'yes' && r.skipped !== 'no') errs.push(at + 'skipped must be yes or no.');
    if (!blank(r.energy) && !(isWhole(r.energy) && Number(r.energy) >= 1 && Number(r.energy) <= 5)) errs.push(at + 'energy must be blank or 1 to 5.');
    if (!blank(r.soreness) && String(r.soreness).split(';').some(t => !/^(upper|lower|core):(none|moderate|severe)$/.test(t.trim()))) errs.push(at + 'soreness must be area:level pairs separated by ";" (upper, lower, core; none, moderate, severe).');
    if (!blank(r.rotation_start) && !/^-?\d+$/.test(String(r.rotation_start))) errs.push(at + 'rotation_start must be blank or a whole number.');
    return errs;
  }
  function serializeSessions(rows) {
    return [SESSION_FIELDS.join(',')].concat((rows || []).map(r => SESSION_FIELDS.map(f => csvField(r[f])).join(','))).join('\n') + '\n';
  }
  function parseSessions(text) {
    const rows = parseCSV(text);
    if (!rows.length) return { rows: [], errors: ['The file is empty.'] };
    if (rows[0].join(',') !== SESSION_FIELDS.join(',')) return { rows: [], errors: ['The header must be exactly: ' + SESSION_FIELDS.join(',')] };
    const out = [], errors = [];
    rows.slice(1).forEach((r, i) => {
      const line = i + 2;
      if (r.length !== SESSION_FIELDS.length) { errors.push('Line ' + line + ': expected ' + SESSION_FIELDS.length + ' fields, found ' + r.length + '.'); return; }
      const row = {};
      SESSION_FIELDS.forEach((f, j) => { row[f] = r[j]; });
      ['order', 'done_sets', 'done_reps', 'done_time', 'energy', 'rotation_start'].forEach(f => { if (/^-?\d+$/.test(row[f])) row[f] = Number(row[f]); });
      if (/^\d+(\.\d+)?$/.test(row.load)) row.load = Number(row.load);
      const e = validateSessionRow(row, line);
      if (e.length) errors.push.apply(errors, e); else out.push(row);
    });
    return { rows: out, errors };
  }
  /* The rows a logged workout writes: every main exercise in order, with what he did if PERFORM captured it, and the check-in answers. */
  function sessionRowsFromWorkout(w, logRow, performed) {
    const c = w.checkIn && w.checkIn.answers;
    const energy = c && !unanswered(c.energy) ? c.energy : '';
    const soreness = c && c.soreness ? AREAS.map(a => c.soreness[a.key] ? a.key + ':' + c.soreness[a.key] : '').filter(Boolean).join(';') : '';
    return w.main.items.map((it, i) => {
      const p = (performed && performed[it.name]) || {};
      return { date: logRow.date, row_id: logRow.id, order: i + 1, exercise: it.name, prescribed: it.text,
        done_sets: blank(p.sets) ? '' : Number(p.sets), done_reps: blank(p.reps) ? '' : Number(p.reps), done_time: blank(p.time) ? '' : Number(p.time),
        load: blank(p.load) ? '' : Number(p.load), unit: blank(p.load) ? '' : (p.unit || ''), feel: p.feel || '', skipped: p.skipped ? 'yes' : 'no',
        energy, soreness, rotation_start: Number.isInteger(w.rotationStart) ? w.rotationStart : '' };
    });
  }
  const feelLabel = k => (FEELS.find(f => f.key === k) || {}).label || k;
  /* What he did, in his words and units: "3 × 10 at 20 kg · Right". Only recorded fields appear. */
  function performedText(r) {
    if (r.skipped === 'yes') return 'skipped';
    const sets = blank(r.done_sets) ? null : Number(r.done_sets);
    let s = '';
    if (!blank(r.done_reps)) s = (sets !== null ? sets + ' × ' : '') + r.done_reps + ' reps';
    else if (!blank(r.done_time)) s = (sets !== null ? sets + ' × ' : '') + r.done_time + ' s';
    else if (sets !== null) s = sets + ' set' + (sets === 1 ? '' : 's');
    if (!blank(r.load)) s += (s ? ' at ' : '') + r.load + ' ' + r.unit;
    if (!blank(r.feel)) s += (s ? ' · ' : '') + feelLabel(r.feel);
    return s;
  }
  const hasDetail = r => r.skipped === 'yes' || !blank(r.done_sets) || !blank(r.done_reps) || !blank(r.done_time) || !blank(r.load) || !blank(r.feel);
  /* "Last time": the latest recorded row for the exercise before a date, never an estimate. Null when nothing was recorded. */
  function lastTime(sessions, exercise, opts) {
    const before = opts && opts.before;
    let best = null;
    (sessions || []).forEach(r => {
      if (r.exercise !== exercise || !hasDetail(r)) return;
      if (before && r.date >= before) return;
      if (!best || r.date > best.date || (r.date === best.date && Number(r.order) > Number(best.order))) best = r;
    });
    return best ? { date: best.date, text: performedText(best), row: best } : null;
  }
  /* His best per exercise, from recorded numbers only: the heaviest load (compared in kg, shown in his unit), else the most reps, else the longest time; ties go to the latest date. */
  function bestPerExercise(sessions) {
    const by = {}, rank = { load: 2, reps: 1, time: 0 };
    (sessions || []).forEach(r => {
      if (r.skipped === 'yes') return;
      const kind = !blank(r.load) ? 'load' : !blank(r.done_reps) ? 'reps' : !blank(r.done_time) ? 'time' : null;
      if (!kind) return;
      const value = Number(kind === 'load' ? r.load : kind === 'reps' ? r.done_reps : r.done_time);
      const cmp = kind === 'load' ? (r.unit === 'lb' ? value / LB_PER_KG : value) : value;
      const cur = by[r.exercise];
      if (!cur || rank[kind] > rank[cur.kind] || (rank[kind] === rank[cur.kind] && (cmp > cur.cmp || (cmp === cur.cmp && r.date > cur.date)))) {
        by[r.exercise] = { exercise: r.exercise, kind, value, cmp, unit: kind === 'load' ? r.unit : kind === 'reps' ? 'reps' : 's',
          reps: kind === 'load' && !blank(r.done_reps) ? Number(r.done_reps) : null, sets: blank(r.done_sets) ? null : Number(r.done_sets), date: r.date };
      }
    });
    return Object.keys(by).sort().map(k => { const b = by[k]; delete b.cmp; return b; });
  }
  const bestText = b => (b.kind === 'load' ? b.value + ' ' + b.unit + (b.reps !== null ? ' × ' + b.reps + ' reps' : '') : b.value + ' ' + b.unit) + (b.sets !== null ? ' (' + b.sets + ' set' + (b.sets === 1 ? '' : 's') + ')' : '');
  /* Decision 5 (rotation offset): the next build for a focus starts where the last logged one left off, read from the session record;
     with no record for that focus, by the day and the count of logged workouts, as before. */
  function rotationStart(log, sessions, focus, today) {
    let last = null;
    (log || []).forEach(r => { if (r.focus === focus && r.status !== 'skipped' && (!last || r.date >= last.date)) last = r; });
    if (last) {
      const rows = (sessions || []).filter(s => s.row_id === last.id);
      const rs = rows.find(s => !blank(s.rotation_start));
      if (rs) return Number(rs.rotation_start) + rows.length;
    }
    return dayIndex(today) + focusCount(log, focus);
  }

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

  /* §4 nearest-valid for Total body: when its pool is smaller than the block needs, add upper- and lower-body rows of the same type.
     Rows of other types no longer join the same block: since 0.6.5 (decision 4) the rest of the block is filled with the next type as its own segment. */
  function extendPool(ctx, pool, needed, sessionType) {
    if (pool.length >= needed || ctx.sel.focus !== 'total') return pool;
    const before = pool.length;
    const added = addRows(pool, upperLowerRows(ctx.library, ctx.sel, sessionType).filter(r => !(ctx.usedMain && ctx.usedMain.has(r.name))));
    if (added.length) ctx.notes.push('Only ' + before + ' exercises fit ' + selectionText(ctx.sel) + '; added upper- and lower-body ' + sessionType + ' work to fill the block.');
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
    if (row.distance) work = TIMING.carry.distance;
    else if (t === 'strength') work = row.timed ? TIMING.strength.hold : TIMING.strength.reps;
    else if (t === 'power') work = row.timed ? TIMING.power.hold : (row.pattern === 'jump' ? TIMING.power.jumps : TIMING.power.reps);
    else work = row.timed ? TIMING.endurance.stationSeconds + ' s' : TIMING.endurance.reps;
    return sets + ' × ' + work + (row.perSide ? ' per side' : '') + (rest ? ' · rest ' + rest : '');
  }
  const item = (tag, row, text, minutes) => ({ tag, name: row.name, pattern: row.pattern, note: row.notes, text, minutes });

  /* Pairing exclusions (workout-rules.md §8, decision 2 of 2026-11-12): a pair never holds two barbell lifts, and never two
     whole-body compound lifts. A whole-body compound lift is a loaded row filed under Total body alone (focus exactly "total"):
     the thrusters, the snatches, the clean and press, the power clean. The definition is the team's, [PROPOSED] until Stephen confirms it. */
  function wholeBodyLift(r) { return r.loadClass !== 'bodyweight' && r.focus.length === 1 && r.focus[0] === 'total'; }
  function canPair(a, b) { return !(a.loadClass === 'barbell' && b.loadClass === 'barbell') && !(wholeBodyLift(a) && wholeBodyLift(b)); }

  /* Order by load class (workout-rules.md §8, decision 1 of 2026-11-12): the pairs run barbell first, then weights, then bodyweight,
     by the heavier row of each pair, and inside a pair the heavier row is A1. The rotation's order holds inside each class. */
  const LOAD_RANK = { barbell: 0, weights: 1, bodyweight: 2 };
  function loadRank(r) { return r.loadClass in LOAD_RANK ? LOAD_RANK[r.loadClass] : 1; }
  function orderByLoad(pairs) {
    pairs.forEach(pr => { if (loadRank(pr.a2) < loadRank(pr.a1)) { const t = pr.a1; pr.a1 = pr.a2; pr.a2 = t; } });
    return pairs.map((pr, i) => ({ pr, i })).sort((x, y) => (loadRank(x.pr.a1) - loadRank(y.pr.a1)) || (x.i - y.i)).map(x => x.pr);
  }

  /* Pairs from the ordered pool: A1 is the next unused row; A2 the next unused row of another pattern that may share a pair with it;
     failing another pattern, the next unused row that may, and the pair says so. A row with no allowed partner waits for a later pair. */
  function formPairs(ordered, P) {
    const used = ordered.map(() => false), pairs = [];
    for (let i = 0; i < ordered.length && pairs.length < P; i++) {
      if (used[i]) continue;
      const a1 = ordered[i];
      const find = pred => { for (let k = i + 1; k < ordered.length; k++) if (!used[k] && pred(ordered[k])) return k; return -1; };
      let j = find(r => r.pattern !== a1.pattern && canPair(a1, r)), samePattern = false;
      if (j < 0) { j = find(r => canPair(a1, r)); samePattern = j >= 0; }
      if (j < 0) continue;
      used[i] = used[j] = true;
      pairs.push({ a1, a2: ordered[j], samePattern });
    }
    return pairs;
  }

  /* The intro lines, shared with the check-in's reduction (§9), which rewrites them after taking a round off. */
  const pairsIntro = (type, cfg, effort, single, R, roundsPerPair, roundLen, ramp) => {
    const lo = Math.min.apply(null, roundsPerPair), hi = Math.max.apply(null, roundsPerPair);
    return typeLabel(type) + ': ' + cfg.reps + ' reps, ' + effort + '. ' +
      (single ? 'Straight sets; ' + R + ' sets' : 'A1, rest, A2, rest; ' + (lo === hi ? lo : lo + '–' + hi) + ' rounds per pair') + ', about ' + roundLen + ' min a round.' +
      (ramp ? ' Each barbell lift starts with a 1-minute ramp-up.' : '');
  };
  const circuitIntro = (S, N, effort) => {
    const c = TIMING.endurance;
    return 'Endurance circuit: ' + c.stationSeconds + ' s work, ' + c.changeSeconds + ' s change-over, ' + c.roundRestSeconds + ' s rest after each round. ' +
      S + ' station' + (S === 1 ? '' : 's') + ' × ' + N + ' rounds. Effort: ' + effort + '.';
  };

  /* ---------- the check-in (workout-rules.md §9, [PROPOSED] 2026-11-12, adapted from the team's S4 rule in Jason's build) ---------- */
  const ENERGY = [1, 2, 3, 4, 5];
  const AREAS = [{ key: 'upper', label: 'Upper body' }, { key: 'lower', label: 'Lower body' }, { key: 'core', label: 'Core' }];
  const SORENESS = ['none', 'moderate', 'severe'];
  /* The areas a focus trains, for "an area the focus trains": a team mapping, [PROPOSED] until Stephen confirms it. */
  const FOCUS_AREAS = { upper: ['upper'], lower: ['lower'], total: ['upper', 'lower', 'core'], core: ['core'], cardio: ['lower'] };
  const MIN_PAIR_ROUNDS = 2; // a pair never drops below 2 rounds when the check-in reduces (a team floor, [PROPOSED])
  const unanswered = v => v === undefined || v === null || v === '';
  function validateCheckIn(c) {
    const errs = [];
    if (unanswered(c)) return errs;
    if (typeof c !== 'object') return ['The check-in must be an object.'];
    if (!unanswered(c.energy) && !(Number.isInteger(c.energy) && c.energy >= 1 && c.energy <= 5)) errs.push('Energy must be a whole number from 1 to 5, or unanswered.');
    const s = c.soreness;
    if (!unanswered(s)) {
      if (typeof s !== 'object') errs.push('Soreness must name areas.');
      else Object.keys(s).forEach(k => {
        if (!AREAS.some(a => a.key === k)) errs.push('Unknown soreness area: ' + k + '.');
        else if (!unanswered(s[k]) && !SORENESS.includes(s[k])) errs.push('Soreness for ' + k + ' must be none, moderate or severe, or unanswered.');
      });
    }
    return errs;
  }
  /* What the check-in does to this selection: nothing, reduce (one round fewer on every pair and circuit), or rest (no workout is built).
     The line says what changed and why, never a cause or a diagnosis. */
  function checkInDecision(sel, c) {
    const errs = validateCheckIn(c);
    if (errs.length) throw new RangeError(errs.join(' '));
    const energy = c && !unanswered(c.energy) ? c.energy : null;
    const sore = {}; AREAS.forEach(a => { const v = c && c.soreness ? c.soreness[a.key] : null; sore[a.key] = unanswered(v) ? null : v; });
    const answered = energy !== null || AREAS.some(a => sore[a.key] !== null);
    const label = k => AREAS.find(a => a.key === k).label.toLowerCase();
    const trained = FOCUS_AREAS[sel.focus] || [];
    const severe = trained.filter(k => sore[k] === 'severe'), moderate = trained.filter(k => sore[k] === 'moderate');
    const reasons = [];
    let action = 'none';
    if (energy === 1) { action = 'rest'; reasons.push('energy 1'); }
    if (severe.length) { action = 'rest'; reasons.push('severe soreness (' + severe.map(label).join(', ') + ')'); }
    if (action !== 'rest') {
      if (energy === 2) { action = 'reduce'; reasons.push('energy 2'); }
      if (moderate.length) { action = 'reduce'; reasons.push('moderate soreness (' + moderate.map(label).join(', ') + ')'); }
    }
    const why = reasons.join(' and ').replace(/^./, ch => ch.toUpperCase());
    const alternatives = (action === 'rest' && energy !== 1) ? FOCUS.map(f => f.key).filter(k => k !== sel.focus && !(FOCUS_AREAS[k] || []).some(a => sore[a] === 'severe')) : [];
    let line;
    if (!answered) line = 'No check-in; nothing adapted.';
    else if (action === 'none') line = 'Check-in: ' + (energy !== null ? 'energy ' + energy : 'energy not given') + ', ' + (AREAS.some(a => sore[a.key] && sore[a.key] !== 'none') ? 'soreness outside this focus' : 'no soreness reported') + '; nothing adapted.';
    else if (action === 'reduce') line = why + ': one round fewer on every pair and circuit; the minutes freed are easy movement.';
    else line = why + ': a rest day is offered' + (alternatives.length ? ', or ' + alternatives.map(focusLabel).join(' or ') + ', which the soreness does not touch' : '') + '. You decide; nothing is logged.';
    return { action, reasons, line, alternatives, answered, energy, soreness: sore };
  }
  /* Reduce: one round fewer on every pair (never below MIN_PAIR_ROUNDS) and on every circuit (never below its minimum). Returns the minutes freed. */
  function reduceRounds(main, library) {
    let freed = 0;
    main.segments.forEach(s => {
      if (s.kind === 'pairs') {
        const groups = {};
        s.items.forEach(i => { const m = /^([A-Z])[12]$/.exec(i.tag), g = m ? m[1] : i.tag; (groups[g] = groups[g] || []).push(i); });
        let removed = 0; const roundsPerPair = [];
        Object.keys(groups).sort().forEach(g => {
          const its = groups[g];
          if (its.every(i => i.sets > MIN_PAIR_ROUNDS)) {
            its.forEach(i => { i.sets -= 1; const row = findRow(library, i.name); i.text = (row && row.loadClass === 'barbell' ? '1 min ramp-up, then ' : '') + prescribe(row, s.type, i.sets, i.rest); });
            removed++;
          }
          roundsPerPair.push(its[0].sets);
        });
        s.rounds -= removed; s.minutesUsed -= removed * s.roundMinutes; freed += removed * s.roundMinutes; s.roundsPerPair = roundsPerPair;
        s.intro = pairsIntro(s.type, TIMING[s.type], s.effort, s.single, s.rounds, roundsPerPair, s.roundMinutes, s.rampUpMinutes);
      } else if (s.kind === 'circuit' && s.rounds > TIMING.endurance.minRounds) {
        s.rounds -= 1; s.minutesUsed -= s.stations + 1; freed += s.stations + 1;
        s.items.forEach(i => { const row = findRow(library, i.name); i.text = s.rounds + ' × ' + TIMING.endurance.stationSeconds + ' s' + (row && row.perSide ? ', switch sides halfway' : ''); });
        s.intro = circuitIntro(s.stations, s.rounds, s.effort);
      }
    });
    return freed;
  }

  /* ---------- main block: strength and power as paired rounds ---------- */
  function pairsBlock(ctx, pool, main, type, minRounds) {
    const cfg = TIMING[type];
    const noteMark = ctx.notes.length;
    const bail = () => { ctx.notes.length = noteMark; return null; }; // nothing fits: the caller moves on, and no note is left behind
    const minR = minRounds || 1; // a fill segment needs 2 rounds (a team figure, workout-rules.md §8 the fill); the first segment 1
    const long = cfg.longMainFrom != null && (ctx.mainMinutes || main) >= cfg.longMainFrom; // the whole main block decides, not the segment's share
    const roundLen = long ? cfg.longRoundMinutes : cfg.roundMinutes;
    const rest = (long ? cfg.longRestSeconds : cfg.restSeconds) + ' s';
    let R = Math.floor(main / roundLen);
    if (R < minR || !pool.length) return bail();
    /* Pairs wanted: the fewest the cap allows; in a template build (story 6) as many as the rows and the rounds allow, at least 2 rounds each, so every exercise he kept or added is used. */
    const P0 = ctx.template ? Math.max(Math.ceil(R / cfg.maxRoundsPerPair), Math.min(Math.floor(pool.length / 2), Math.floor(R / MIN_PAIR_ROUNDS))) : Math.ceil(R / cfg.maxRoundsPerPair);
    const base = pool.slice();
    pool = extendPool(ctx, pool.slice(), 2 * P0, type);
    const ordered = orderedPool(base, pool, ctx.start);
    const items = [];
    const maxPairs = Math.floor(pool.length / 2);
    let roundsPerPair = [];
    let pairs = maxPairs < 1 ? [] : orderByLoad(formPairs(ordered, P0));
    const single = pairs.length ? null : ordered[0];
    if (!pairs.length && !single) return bail();
    /* Ramp-up (workout-rules.md §8, decision 3 of 2026-11-12): one minute inside the block before each barbell lift's first set, taken
       from the block's minutes. Fewer minutes can mean fewer rounds and so one pair fewer, dropped from the lighter end; the count settles. */
    const rowsOf = () => single ? [single] : pairs.reduce((a, pr) => a.concat(pr.a1, pr.a2), []);
    const rampOf = () => rowsOf().filter(r => r.loadClass === 'barbell').length;
    let ramp = rampOf();
    for (;;) {
      R = Math.floor((main - ramp) / roundLen);
      const need = ctx.template ? Math.max(1, Math.min(pairs.length, Math.floor(R / MIN_PAIR_ROUNDS))) : Math.max(1, Math.ceil(R / cfg.maxRoundsPerPair)); // a template keeps every pair the rounds allow
      if (!single && need < pairs.length) { pairs = pairs.slice(0, need); ramp = rampOf(); continue; }
      break;
    }
    if (R < minR) return bail();
    /* Caps (workout-rules.md §8, decision 4 of 2026-11-12): at most maxRoundsPerPair rounds per pair, or per exercise in straight sets;
       the rounds these rows cannot hold pass to the next segment of the block. */
    const cap = cfg.maxRoundsPerPair * (single ? 1 : pairs.length);
    const capped = R > cap;
    if (capped) R = cap;
    const rampText = row => row.loadClass === 'barbell' ? '1 min ramp-up, then ' : '';
    const withSets = (it, n) => { it.sets = n; it.rest = rest; return it; }; // kept on the item so a swap can re-prescribe the same dose
    if (single) {
      items.push(withSets(item('1', single, rampText(single) + prescribe(single, type, R, rest)), R));
      roundsPerPair = [R];
      ctx.notes.push(maxPairs < 1 ? (minR > 1 ? 'One ' + typeLabel(type).toLowerCase() + ' exercise is left for this part of the block: straight sets instead of pairs.' : 'Only one exercise fits this selection: straight sets instead of pairs.')
        : 'No two of the exercises that fit this selection may share a pair (two barbell lifts, or two whole-body lifts): straight sets instead of pairs.');
    } else {
      const P = pairs.length;
      const base = Math.floor(R / P), extra = R % P;
      pairs.forEach((pr, p) => {
        const rounds = base + (p < extra ? 1 : 0), L = String.fromCharCode(65 + p);
        if (pr.samePattern) ctx.notes.push('Pair ' + L + ': both exercises are ' + pr.a1.pattern + ' movements; no other pattern fits this selection.');
        items.push(withSets(item(L + '1', pr.a1, rampText(pr.a1) + prescribe(pr.a1, type, rounds, rest)), rounds),
          withSets(item(L + '2', pr.a2, rampText(pr.a2) + prescribe(pr.a2, type, rounds, rest)), rounds));
        roundsPerPair.push(rounds);
      });
    }
    const minutesUsed = R * roundLen + ramp;
    const effort = effortFor(ctx.sel, type);
    const intro = pairsIntro(type, cfg, effort, !!single, R, roundsPerPair, roundLen, ramp);
    return { kind: 'pairs', type, roundMinutes: roundLen, rounds: R, roundsPerPair, pairs: single ? 0 : items.length / 2, items, remainder: 0, minutesUsed, rampUpMinutes: ramp, capped,
      effort, single: !!single, intro, tail: '', used: items.map(i => i.name) };
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
    const noteMark = ctx.notes.length;
    const bail = () => { ctx.notes.length = noteMark; return null; }; // nothing fits: the caller moves on, and no note is left behind
    let pick = chooseCircuit(main, c.maxStations);
    if (!pick || !pool.length) return bail(); // not even the smallest circuit fits, or no rows
    const base = pool.slice();
    pool = extendPool(ctx, pool.slice(), pick.S + reserve, 'endurance');
    let maxS = Math.min(c.maxStations, pool.length - reserve);
    if (maxS < c.minStations) maxS = Math.min(c.maxStations, Math.max(1, pool.length)); // the cool-down core may then repeat, and says so
    pick = chooseCircuit(main, maxS);
    if (!pick) return bail();
    const rot = makeRotation(orderedPool(base, pool, ctx.start), 0);
    const items = [];
    let prev = null;
    for (let s = 0; s < pick.S; s++) {
      const row = rot.next(r => !prev || r.pattern !== prev.pattern) || rot.next();
      if (!row) break;
      items.push(item(String(s + 1), row, pick.N + ' × ' + c.stationSeconds + ' s' + (row.perSide ? ', switch sides halfway' : '')));
      prev = row;
    }
    if (items.length < pick.S) return bail(); // never a station without a row
    const effort = effortFor(ctx.sel, 'endurance');
    return { kind: 'circuit', type: 'endurance', stations: pick.S, rounds: pick.N, items, remainder: 0, minutesUsed: pick.N * (pick.S + 1),
      effort, intro: circuitIntro(pick.S, pick.N, effort), tail: '', used: items.map(i => i.name) };
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
    const corePool = ctx.library.filter(r => r.focus.includes('core') && r.cooldownOk && rowAllowed(r, ctx.sel.equipment, ctx.sel.machines)); // cooldown: no keeps heart-rate moves out (library review, 2026-11-12)
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
  /* ---------- the main block as segments (workout-rules.md §8, decision 4 of 2026-11-12) ---------- */
  const TYPE_ORDER = ['strength', 'power', 'endurance'];
  /* Caps and the fill: a pairs segment holds at most 5 rounds per pair and a circuit at most 4 rounds. When the rows for a type are used
     up before the block is full, Endurance first adds a further circuit of fresh rows; then the block continues with the next type for the
     same focus (strength → power → endurance, wrapping, each type at most once) and the header names the mix. What no segment can fill
     prints as change-over. */
  function fillMain(ctx, firstPool, main, type, reserve) {
    const segments = [];
    let left = main;
    const start = TYPE_ORDER.indexOf(type);
    for (let k = 0; k < TYPE_ORDER.length && left > 0; k++) {
      const segType = TYPE_ORDER[(start + k) % TYPE_ORDER.length];
      for (;;) { // one pairs segment per type; circuits repeat while fresh rows remain
        const pool = (segments.length ? poolFor(ctx.library, ctx.sel, ctx.sel.focus, segType) : firstPool).filter(r => !ctx.usedMain.has(r.name));
        const seg = segType === 'endurance' ? circuitBlock(ctx, pool, left, reserve) : pairsBlock(ctx, pool, left, segType, segments.length ? 2 : 1);
        if (!seg) break;
        segments.push(seg); seg.used.forEach(n => ctx.usedMain.add(n)); left -= seg.minutesUsed;
        if (seg.kind !== 'circuit' || left <= 0) break;
      }
    }
    if (!segments.length) throw new Error('No exercise fits ' + selectionText(ctx.sel) + '.');
    const m = composeMain(segments, main);
    if (m.types.length > 1) {
      const firstRows = segments.filter(s => s.type === m.types[0]).reduce((a, s) => a + s.items.length, 0);
      ctx.notes.push(typeLabel(m.types[0]) + ' rows for ' + focusLabel(ctx.sel.focus) + ' ran out after ' + firstRows + ' exercises; the block continues as ' + m.types.slice(1).map(typeLabel).join(', then ') + '.');
    }
    return m;
  }
  function composeMain(segments, main) {
    const minutesUsed = segments.reduce((a, s) => a + s.minutesUsed, 0), remainder = main - minutesUsed;
    const last = segments[segments.length - 1];
    last.remainder = remainder;
    last.tail = remainder ? (last.kind === 'circuit' ? 'Change-over · ' : last.kind === 'cardio' ? 'Easy finish · ' : 'Set-up and change-over · ') + remainder + ' min' : '';
    const items = [].concat.apply([], segments.map(s => s.items));
    const types = []; segments.forEach(s => { if (types[types.length - 1] !== s.type) types.push(s.type); });
    const m = { kind: segments.length === 1 ? segments[0].kind : 'mixed', segments, types, items, minutesUsed, remainder, intro: segments[0].intro, tail: last.tail,
      alternatives: segments.length === 1 ? segments[0].alternatives : undefined, used: items.map(i => i.name), rampUpMinutes: segments.reduce((a, s) => a + (s.rampUpMinutes || 0), 0) };
    if (segments.length === 1) ['type', 'roundMinutes', 'rounds', 'pairs', 'stations', 'capped'].forEach(k => { if (k in segments[0]) m[k] = segments[0][k]; });
    return m;
  }

  /* opts.startOffset (decision 19, "build another", 2026-11-12): moves the rotation start on by that many rows, the number the build on screen used. */
  function buildWorkout(library, sel, log, today, opts) {
    const errs = validateSelections(sel);
    if (errs.length) throw new RangeError(errs.join(' '));
    if (!isDate(today)) throw new RangeError('today must be a YYYY-MM-DD date.');
    const startOffset = opts && Number.isInteger(opts.startOffset) && opts.startOffset >= 0 ? opts.startOffset : 0;
    const b = blockMinutes(sel.time);
    const ae = allowedExercises(library, sel);
    const type = ae.deliveredType;
    /* A template (story 6): its exercises, in order, as the first pool; the rotation is off; what the equipment or the type refuses is left out and named. */
    const tpl = opts && opts.template && Array.isArray(opts.template.names) ? opts.template : null;
    let firstPool = ae.pool, tplInfo = null, tplKept = [];
    const tplNotes = [];
    if (tpl) {
      const kept = tplKept, left = [];
      tpl.names.forEach(n => {
        const r = findRow(library, n);
        if (!r) { left.push(n + ' (no longer in the library)'); return; }
        if (!rowAllowed(r, sel.equipment, sel.machines)) { left.push(n + ' (not allowed under ' + equipLabel(sel.equipment) + ')'); return; }
        if (!r.types.includes(type)) { left.push(n + ' (not a ' + type + ' exercise)'); return; }
        if ((r.pattern === 'cardio') !== (sel.focus === 'cardio')) { left.push(n + (sel.focus === 'cardio' ? ' (not a cardio modality)' : ' (a cardio row)')); return; }
        if (!kept.some(k => k.name === r.name)) kept.push(r);
      });
      if (!kept.length) throw new RangeError('Nothing from that session fits these choices' + (left.length ? ': ' + left.join(', ') : '') + '. Change the equipment or type, or build by rotation.');
      firstPool = kept;
      tplInfo = { rowId: tpl.rowId || null, date: tpl.date || null, type: tpl.type || type, names: tpl.names.slice(), kept: kept.map(r => r.name), left };
      tplNotes.push('Template: your ' + focusLabel(sel.focus) + ' · ' + typeLabel(tplInfo.type) + ' session' + (tpl.date ? ' of ' + longDate(tpl.date) : '') + ' (' + kept.length + ' exercise' + (kept.length === 1 ? '' : 's') + '); the rotation is off. Swap, add or drop below.' + (left.length ? ' Left out: ' + left.join(', ') + '.' : ''));
    }
    const ctx = { library, sel, notes: ae.notes.slice().concat(tplNotes), start: tpl ? 0 : rotationStart(log, opts && opts.sessions, sel.focus, today) + startOffset, usedMain: new Set(), mainMinutes: b.main, template: !!tpl };
    const main = sel.focus === 'cardio' ? composeMain([Object.assign(cardioBlock(ctx, firstPool, b.main, type), { type })], b.main)
      : fillMain(ctx, firstPool, b.main, type, sel.focus === 'core' ? b.minCore : 0);
    if (tpl && sel.focus !== 'cardio') {
      const unused = tplKept.filter(r => !ctx.usedMain.has(r.name)).map(r => r.name);
      if (unused.length) ctx.notes.push('Not used: ' + unused.join(', ') + ' (pairs take an even count, and the time allows ' + Math.floor(b.main / (TIMING[type] || TIMING.strength).roundMinutes) + ' rounds; drop one or add another).');
      tplInfo.unused = unused;
    }
    /* The check-in (§9): applied after the fill, so the minutes a reduction frees stay free, as easy movement at the end of the block. */
    let checkIn = null;
    if (opts && opts.checkIn !== undefined) {
      const d = checkInDecision(sel, opts.checkIn);
      if (d.action === 'rest') throw new RangeError('The check-in offers rest; no workout is built. ' + d.line);
      if (d.action === 'reduce') {
        const freed = reduceRounds(main, library);
        main.easyMinutes = freed;
        main.minutesUsed = main.segments.reduce((a, s) => a + s.minutesUsed, 0);
        main.remainder = b.main - main.minutesUsed;
        const last = main.segments[main.segments.length - 1], spare = main.remainder - freed;
        last.remainder = main.remainder;
        last.tail = (spare ? (last.kind === 'circuit' ? 'Change-over · ' : last.kind === 'cardio' ? 'Easy finish · ' : 'Set-up and change-over · ') + spare + ' min' : '') +
          (freed ? (spare ? ' · ' : '') + 'Easy movement · ' + freed + ' min (from the check-in: walk, cycle easy or stretch)' : '');
        main.tail = last.tail;
        main.items = [].concat.apply([], main.segments.map(s => s.items)); main.used = main.items.map(i => i.name);
        if (main.segments.length === 1) ['rounds', 'roundsPerPair', 'intro'].forEach(k => { if (k in main.segments[0]) main[k] = main.segments[0][k]; });
      }
      checkIn = { answers: unanswered(opts.checkIn) ? null : opts.checkIn, decision: d };
      ctx.notes.unshift(d.line);
    }
    const used = new Set(main.used);
    const core = coreBlock(ctx, b.minCore, used);
    core.items.forEach(i => used.add(i.name));
    const stretch = stretchBlock(ctx, b.cooldown - core.minutes, used);
    stretch.forEach(i => used.add(i.name));
    const warmup = warmupBlock(ctx, b.warmup, type, used);
    const w = {
      version: APP_VERSION, specVersion: SPEC_VERSION, date: today, startOffset, rotationStart: tpl ? null : ctx.start, template: tplInfo, // a template build records no rotation start
      selections: { time: sel.time, equipment: sel.equipment, machines: (sel.machines || []).slice(), focus: sel.focus, type: sel.type },
      header: {
        focus: focusLabel(sel.focus), type: main.types.map(typeLabel).join(', then '), mixed: main.types.length > 1, chosenType: typeLabel(sel.type), typeChanged: type !== sel.type,
        total: sel.time, equipment: equipLabel(sel.equipment), machines: (sel.machines || []).slice(),
        showsMachines: sel.equipment in DEFAULT_MACHINES
      },
      notes: ctx.notes, checkIn, blocks: b, warmup, main, cooldown: { stretch, core },
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
    L.push(w.header.equipment + (w.header.showsMachines ? (w.header.machines.length ? ' · machines: ' + w.header.machines.map(m => (MACHINE_LABELS[m] || m).toLowerCase()).join(', ') : ' · no machines ticked') : ''));
    w.notes.forEach(n => L.push('Note: ' + n));
    L.push('Warm-up · ' + w.blocks.warmup + ' min');
    w.warmup.forEach(i => L.push('  ' + i.name + ' · ' + i.text));
    L.push('Main block · ' + w.blocks.main + ' min');
    (w.main.segments || [w.main]).forEach(s => {
      L.push('  ' + s.intro);
      s.items.forEach(i => L.push('  ' + (i.tag ? i.tag + ' ' : '') + i.name + ' · ' + i.text + (i.note ? ' (' + i.note + ')' : '')));
      if (s.alternatives && s.alternatives.length) L.push('  Also fits: ' + s.alternatives.join(', '));
      if (s.tail) L.push('  ' + s.tail);
    });
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

  /* ---------- swap (workout-rules.md §8, decision 5 of 2026-11-12) ----------
     Replace one main exercise with the next allowed row, in library order and wrapping, of the same pattern and load class that is not
     already in the workout. The sum, the doses, the pairing rules and the order hold because the replacement shares the row's pattern and
     load class; a cardio modality swaps to the next alternative. Returns the changed workout, or null when no other row fits. */
  function swapExercise(library, w, name) {
    const sel = w.selections;
    const segs = w.main.segments || [w.main];
    let seg = null, k = -1;
    segs.forEach(s => { if (seg) return; const i = s.items.findIndex(it => it.name === name); if (i >= 0) { seg = s; k = i; } });
    const cur = seg ? findRow(library, name) : null;
    if (!cur) return null;
    const usedNames = new Set([].concat(w.warmup, w.main.items, w.cooldown.stretch, w.cooldown.core.items).map(i => i.name));
    let partner = null;
    if (seg.kind === 'pairs') { const m = /^([A-Z])([12])$/.exec(seg.items[k].tag); const other = m && seg.items.find(it => it.tag === m[1] + (m[2] === '1' ? '2' : '1')); partner = other ? findRow(library, other.name) : null; }
    const segType = seg.type || sel.type;
    let base = seg.kind === 'cardio' ? poolFor(library, sel, 'cardio', segType) : poolFor(library, sel, sel.focus, segType);
    if (seg.kind !== 'cardio' && sel.focus === 'total') base = base.concat(upperLowerRows(library, sel, segType).filter(r => !base.some(b => b.name === r.name)));
    const fits = r => r.name !== cur.name && !usedNames.has(r.name) && (seg.kind === 'cardio' || (r.pattern === cur.pattern && r.loadClass === cur.loadClass)) && (!partner || canPair(partner, r));
    const cands = base.filter(fits).sort((a, b) => a.index - b.index);
    if (!cands.length) return null;
    const next = cands.find(r => r.index > cur.index) || cands[0];
    const it = seg.items[k], old = it.name;
    it.name = next.name; it.note = next.notes; it.pattern = next.pattern;
    if (seg.kind === 'pairs') it.text = (next.loadClass === 'barbell' ? '1 min ramp-up, then ' : '') + prescribe(next, segType, it.sets, it.rest);
    else if (seg.kind === 'circuit') it.text = seg.rounds + ' × ' + TIMING.endurance.stationSeconds + ' s' + (next.perSide ? ', switch sides halfway' : '');
    seg.used = seg.items.map(i => i.name);
    if (seg.kind === 'cardio') seg.alternatives = base.filter(r => r.name !== next.name).map(r => r.name);
    w.main.items = [].concat.apply([], segs.map(s => s.items));
    w.main.used = w.main.items.map(i => i.name);
    if (segs.length === 1 && seg.kind === 'cardio') w.main.alternatives = seg.alternatives;
    w.swaps = (w.swaps || []).concat([{ from: old, to: next.name }]);
    w.text = workoutText(w);
    return w;
  }

  /* ---------- TEMPLATE (stories.md story 6, workout-rules.md §10): start from the last session for the focus ----------
     The last logged workout of the focus that has detail rows gives its exercises in order; a template build keeps that order with the
     rotation off, leaves out what the equipment or the type refuses and says so, and goes through the same blocks, pairing and core checks. */
  function lastSessionTemplate(log, sessions, focus) {
    let best = null;
    (log || []).forEach((r, idx) => {
      if (r.focus !== focus || r.status === 'skipped') return;
      const rows = (sessions || []).filter(s => s.row_id === r.id).sort((a, b) => Number(a.order) - Number(b.order));
      if (!rows.length) return;
      if (!best || r.date > best.row.date || (r.date === best.row.date && idx > best.idx)) best = { row: r, rows, idx };
    });
    if (!best) return null;
    return { rowId: best.row.id, date: best.row.date, type: best.row.type, equipment: best.row.equipment, exercises: best.rows.map(s => s.exercise), rows: best.rows };
  }
  /* The rows he may add to a template build: allowed for the focus and the block's type, not already in the workout. */
  function templateCandidates(library, sel, w) {
    const used = new Set([].concat(w.warmup, w.main.items, w.cooldown.stretch, w.cooldown.core.items).map(i => i.name).concat(w.template ? w.template.names : [])); // nor what the template already lists, used or not
    const type = (w.main.segments && w.main.segments[0] && w.main.segments[0].type) || sel.type;
    let base = sel.focus === 'cardio' ? poolFor(library, sel, 'cardio', type) : poolFor(library, sel, sel.focus, type);
    if (sel.focus === 'total') base = base.concat(upperLowerRows(library, sel, type).filter(r => !base.some(b => b.name === r.name)));
    return base.filter(r => !used.has(r.name)).map(r => r.name);
  }

  /* ---------- PERFORM (stories.md story 4): the workout as steps, one at a time, with the timers of §8 ----------
     A set step waits for him; rests, change-overs, circuit stations, cardio intervals, the ramp-up minute, the warm-up and cool-down items
     are timed. Every main exercise is reachable in order; what he does is recorded by the screen, never assumed here. */
  const secondsOf = txt => { const m = /^(\d+)\s*s$/.exec(txt || ''); return m ? Number(m[1]) : 0; };
  const doseOf = item => { const t = String(item.text || '').replace(/^1 min ramp-up, then /, ''); const m = /^\d+ × (.+?)(?: · rest .*)?$/.exec(t); return m ? m[1].replace(/ per side$/, '') : t; };
  function performSteps(w, library) {
    const steps = [], c = TIMING.endurance, cd = TIMING.cardio, cc = TIMING.coolDownCore;
    const cueOf = name => { const r = findRow(library, name); return r ? r.cue : ''; };
    const push = s => { s.index = steps.length; steps.push(s); };
    (w.warmup || []).forEach(i => push({ kind: 'timed', block: 'Warm-up', name: i.name, seconds: i.minutes * 60, text: i.text, cue: cueOf(i.name) }));
    const segs = w.main.segments || [w.main];
    segs.forEach(s => {
      const label = 'Main block' + (segs.length > 1 ? ' · ' + typeLabel(s.type) : '');
      if (s.kind === 'pairs') {
        const groups = {}, order = [];
        s.items.forEach(i => { const m = /^([A-Z])[12]$/.exec(i.tag), g = m ? m[1] : i.tag; if (!groups[g]) { groups[g] = []; order.push(g); } groups[g].push(i); });
        order.forEach(g => {
          const its = groups[g], rounds = Math.max.apply(null, its.map(i => i.sets || 0));
          for (let r = 1; r <= rounds; r++) its.forEach(i => {
            if (r > (i.sets || 0)) return;
            const rest = secondsOf(i.rest);
            if (r === 1 && /^1 min ramp-up/.test(i.text)) push({ kind: 'rampup', block: label, name: i.name, seconds: 60, text: 'Ramp-up: light sets, building to the working weight', exercise: i.name, cue: cueOf(i.name) });
            push({ kind: 'set', block: label, name: i.name, tag: i.tag, set: r, ofSets: i.sets, dose: doseOf(i), perSide: / per side/.test(i.text), restSeconds: rest, exercise: i.name, cue: cueOf(i.name), effort: s.effort || '' });
            if (rest) push({ kind: 'rest', block: label, name: 'Rest', seconds: rest, after: i.name });
          });
        });
      } else if (s.kind === 'circuit') {
        for (let n = 1; n <= s.rounds; n++) {
          s.items.forEach((i, k) => {
            push({ kind: 'work', block: label, name: i.name, seconds: c.stationSeconds, round: n, ofRounds: s.rounds, station: k + 1, ofStations: s.items.length, perSide: /switch sides/.test(i.text), exercise: i.name, cue: cueOf(i.name), effort: s.effort || '' });
            if (k < s.items.length - 1) push({ kind: 'change', block: label, name: 'Change over', seconds: c.changeSeconds, text: 'next: ' + s.items[k + 1].name });
          });
          if (n < s.rounds) push({ kind: 'rest', block: label, name: 'Rest', seconds: c.roundRestSeconds, text: 'then round ' + (n + 1) + ' of ' + s.rounds });
        }
      } else if (s.kind === 'cardio') {
        const i = s.items[0];
        if (s.type === 'endurance') push({ kind: 'work', block: label, name: i.name, seconds: s.minutesUsed * 60, text: 'steady effort', exercise: i.name, cue: cueOf(i.name) });
        else {
          const on = s.type === 'strength' ? cd.strengthHardMin * 60 : cd.powerOnSec, off = s.type === 'strength' ? cd.strengthEasyMin * 60 : cd.powerOffSec;
          const k = Math.floor(s.minutesUsed * 60 / (on + off));
          for (let r = 1; r <= k; r++) {
            push({ kind: 'work', block: label, name: i.name, seconds: on, text: (s.type === 'strength' ? 'hard' : 'all-out') + ' · interval ' + r + ' of ' + k, exercise: i.name, cue: cueOf(i.name) });
            push({ kind: 'easy', block: label, name: 'Easy', seconds: off, text: 'easy · interval ' + r + ' of ' + k });
          }
        }
      }
      if (s.tail) {
        const easy = /Easy movement · (\d+) min/.exec(s.tail), easyMin = easy ? Number(easy[1]) : 0;
        const spare = (s.remainder || 0) - easyMin;
        if (spare > 0) push({ kind: 'easy', block: label, name: /Easy finish/.test(s.tail) ? 'Easy finish' : 'Set-up and change-over', seconds: spare * 60, text: '' });
        if (easyMin > 0) push({ kind: 'easy', block: label, name: 'Easy movement', seconds: easyMin * 60, text: 'walk, cycle easy or stretch (from the check-in)' });
      }
    });
    (w.cooldown.stretch || []).forEach(i => push({ kind: 'timed', block: 'Cool-down', name: i.name, seconds: i.minutes * 60, text: i.text, cue: cueOf(i.name) }));
    (w.cooldown.core.items || []).forEach((i, k, arr) => {
      push({ kind: 'work', block: 'Cool-down · core', name: i.name, seconds: cc.stationSeconds, text: i.text, cue: cueOf(i.name) });
      if (k < arr.length - 1) push({ kind: 'change', block: 'Cool-down · core', name: 'Change over', seconds: cc.changeSeconds, text: 'next: ' + arr[k + 1].name });
    });
    push({ kind: 'done', block: 'Done', name: 'Workout complete' });
    return steps;
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
    w.cooldown.core.items.forEach(i => { const row = findRow(library, i.name); if (row && !row.cooldownOk) v.push('"' + i.name + '" is flagged cooldown: no'); });
    if (WEIGHT_RE.test(w.text)) v.push('a weight is stated');
    if (PUSH_THROUGH_RE.test(w.text)) v.push('"push through" language');
    if (w.text.indexOf(SAFETY_LINE) < 0) v.push('safety line missing');
    const segs = w.main.segments || [w.main];
    const segUsed = segs.reduce((a, s) => a + s.minutesUsed, 0);
    if (segUsed !== w.main.minutesUsed) v.push('segments use ' + segUsed + ' min, the block says ' + w.main.minutesUsed);
    if (segs.length > 1 && segs.some(s => s.type !== segs[0].type) && !/, then /.test(w.header.type)) v.push('a mixed block without a mixed header');
    segs.forEach((s, si) => {
      const where = segs.length > 1 ? ' (segment ' + (si + 1) + ')' : '';
      if (s.kind === 'circuit' && s.rounds > TIMING.endurance.maxRounds) v.push('circuit of ' + s.rounds + ' rounds, above ' + TIMING.endurance.maxRounds + where);
      if (s.kind !== 'pairs') return;
      const cfg = TIMING[s.type] || TIMING.strength;
      s.items.forEach(i => { if (i.sets > cfg.maxRoundsPerPair) v.push('"' + i.name + '" has ' + i.sets + ' rounds, above ' + cfg.maxRoundsPerPair + where); });
      const byPair = {};
      s.items.forEach(i => { const m = /^([A-Z])([12])$/.exec(i.tag); if (m) (byPair[m[1]] = byPair[m[1]] || [])[+m[2] - 1] = findRow(library, i.name); });
      let prevRank = -1;
      Object.keys(byPair).sort().forEach(L => {
        const a = byPair[L][0], b = byPair[L][1];
        if (!a || !b) return;
        if (a.loadClass === 'barbell' && b.loadClass === 'barbell') v.push('pair ' + L + ' holds two barbell lifts' + where);
        if (wholeBodyLift(a) && wholeBodyLift(b)) v.push('pair ' + L + ' holds two whole-body compound lifts' + where);
        if (loadRank(a) > loadRank(b)) v.push('pair ' + L + ' puts the lighter load class first' + where);
        if (loadRank(a) < prevRank) v.push('pair ' + L + ' (' + a.loadClass + ') comes after a lighter pair' + where);
        prevRank = loadRank(a);
      });
      const barbell = s.items.filter(i => i.tag && (findRow(library, i.name) || {}).loadClass === 'barbell');
      barbell.forEach(i => { if (!/^1 min ramp-up, then /.test(i.text)) v.push('"' + i.name + '" has no ramp-up minute'); });
      s.items.forEach(i => { if (i.tag && /ramp-up/.test(i.text) && (findRow(library, i.name) || {}).loadClass !== 'barbell') v.push('"' + i.name + '" has a ramp-up minute but is not a barbell lift'); });
      if ((s.rampUpMinutes || 0) !== barbell.length) v.push('ramp-up minutes (' + (s.rampUpMinutes || 0) + ') do not match the ' + barbell.length + ' barbell lifts' + where);
      if (s.rounds * s.roundMinutes + (s.rampUpMinutes || 0) !== s.minutesUsed) v.push('rounds, round length and ramp-up do not make the minutes used' + where);
      if (s.type === 'strength') {
        if (s.items.length > 1 && (!s.items.some(i => /^A1$/.test(i.tag)) || !s.items.some(i => /^A2$/.test(i.tag)))) v.push('strength block has no A1/A2 pair' + where);
        if (s.roundMinutes !== TIMING.strength.roundMinutes) v.push('strength rounds are ' + s.roundMinutes + ' min, not ' + TIMING.strength.roundMinutes + where);
        s.items.forEach(i => { const row = findRow(library, i.name); if (row && row.types.includes('strength') && !/8–12|20–30 s|about 40 m/.test(i.text)) v.push('"' + i.name + '" is not dosed 8–12 reps, a hold or a distance'); });
        s.items.forEach(i => { if (i.tag && !new RegExp('rest ' + TIMING.strength.restSeconds + ' s$').test(i.text)) v.push('"' + i.name + '" does not rest ' + TIMING.strength.restSeconds + ' s'); });
      }
    });
    return v;
  }

  root.Engine = {
    APP_VERSION, SPEC_VERSION, TIMES, EQUIPMENT, MACHINES, MACHINE_LABELS, DEFAULT_MACHINES, FOCUS, TYPES, STATUSES, LOG_FIELDS, SAFETY_LINE, TIMING, TIME_ZONE,
    parseCSV, csvField, parseLibrary, findRow, rowAllowed,
    blockMinutes, parseISO, isDate, addDays, mondayOf, dayIndex, todayIn, longDate,
    weeklyCount, lastTrained, focusCount,
    validateSelections, validateGoal, validateLogRow, serializeLog, parseLog,
    allowedExercises, buildWorkout, workoutText, audit, swapExercise, wholeBodyLift, canPair, loadRank,
    ENERGY, AREAS, SORENESS, FOCUS_AREAS, validateCheckIn, checkInDecision,
    SESSION_FIELDS, FEELS, UNITS, validateSessionRow, serializeSessions, parseSessions, sessionRowsFromWorkout, performedText, feelLabel, hasDetail, lastTime, bestPerExercise, bestText, rotationStart,
    performSteps, lastSessionTemplate, templateCandidates,
    equipLabel, focusLabel, typeLabel
  };
})(typeof window !== 'undefined' ? window : this);
