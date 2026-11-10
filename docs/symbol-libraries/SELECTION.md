# Completed artwork selection

Library Workshop has been retired. Its UI, HTTP server and review commands have been removed.

The selected decisions remain in [symbol-choices.json](symbol-choices.json), and the historical style rules remain in [selection-rules.json](selection-rules.json). A frozen copy of the selection and the selected component XML are checked into `library-sources/teaching/` for reproducible builds without the SQL dump.

`scripts/lib/selected-artwork.mjs` applies the recorded SQL adaptations: control/buzzer sizing, reed orientation, unique relay pins, common-anode/common-cathode display interfaces, and a corrected three-way header. Generated provenance records each source hash and adaptation.

Build all selected libraries with `npm run libraries:all`. See [the model guide](../teaching-simulation-models.md) for simulation parameters and qualification.
