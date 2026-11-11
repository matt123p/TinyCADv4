# Teaching examples

Use **File → Open Example** to browse the ten course groups, read the student instructions and open your own copy. The 214 activities cover every scenario in teaching documents 17–26. There are 201 `.dzn` simulations and 13 ordinary `.dsn` connection plans. Each includes student-facing Markdown text on the circuit sheet; simulations also include a configured Simulation sheet.

See the [review record](REVIEW.md) for image inspection, numerical checks and model assumptions.

These are starting circuits for the stated investigations. Tasks involving different component values, physical dimensions, real instruments, multiple constructions or programming require the student to make those changes and record observations. The notes identify educational model assumptions; the files do not claim to simulate physical construction, firmware or real radio equipment.

| Course | Activities |
| --- | ---: |
| [GCSE Physics](gcse-physics-aqa/README.md) | 18 |
| [A-level Physics](a-level-physics-aqa/README.md) | 43 |
| [BTEC First Engineering](btec-first-engineering/README.md) | 17 |
| [BTEC Applied Science 2016](btec-applied-science-2016/README.md) | 18 |
| [BTEC Applied Science AAQ](btec-applied-science-aaq/README.md) | 14 |
| [BTEC National Engineering](btec-national-electrical-electronic-engineering/README.md) | 21 |
| [BTEC HNC Engineering](btec-hnc-electrical-electronic-engineering/README.md) | 20 |
| [Degree Physics](degree-year1-physics/README.md) | 19 |
| [Degree Electronics](degree-year1-electronics/README.md) | 26 |
| [Degree Engineering](degree-year1-engineering/README.md) | 18 |

Regenerate with `npm run generate:teaching-examples`, then `npm run render:teaching-examples`. Rendering requires Playwright and Chromium; set `TINYCAD_PLAYWRIGHT_MODULE` to an existing Playwright module if it is not installed locally. The SVG previews use the application renderer. PNG previews and review contact sheets are produced in Chromium; contact sheets go to the ignored `build/teaching-examples/review` directory. The catalogue and course indexes are generated alongside the drawings.

Build the native engine with `npm run engine:native`, then run `npm run verify:teaching-examples` to reopen each drawing, rebuild its netlist and solve all simulations. Reports are written to `build/teaching-examples/verification.json`. Run `npm run test:teaching-examples` for curriculum coverage, saved-file, Markdown and preview checks. Generation never substitutes a generic circuit for an unknown activity: its plan must be explicitly listed in `scripts/teaching/scenarios.mjs`.
