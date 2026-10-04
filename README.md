# Workout builder

A one-person workout builder built for BUS 860 Managing Intelligence (Alberta School of Business EMBA), version 1.
Pick time, equipment, focus and type; get a workout whose blocks add up exactly and that always ends with core; log it as done, shortened, swapped or skipped.

- Static web app: `index.html`, `engine.js` (the fixed procedures), `library.js` (the exercise library, embedded), `sw.js` and `manifest.webmanifest` (offline use, home screen), `tests.html` (the checks).
- No backend, no account, no analytics, no external calls. The training log lives only in the user's browser; **Export log** writes it as a CSV and **Import log** restores it.
- The exercise library here is team-written and under review; it is not professional exercise prescription. Stop if you feel sharp pain, and see a professional.

The living spec (`CLAUDE.md`), the knowledge folder and the governance log live in the course project folder, not in this repository.
