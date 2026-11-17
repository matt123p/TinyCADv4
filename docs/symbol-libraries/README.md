# Symbol inventory

Digital logic, Functional blocks and Sensors and interfaces use shared logical terminal contracts alongside their [library recipes](../../library-recipes). Internal generator inputs live under `library-sources/inventory/`; [libraries](../libraries.md) describes the bundled outputs and [simulation models](../teaching-simulation-models.md) describes model behaviour.

The shared inventory defines 102 reusable types: 96 component contracts and six native editor/connectivity types. Logical terminal IDs describe the generic symbol interface; they are not commercial package pinouts. Repeated component instances and different values do not require separate reusable types.

Native instruments, probes, independent waveform sources and controlled sources use the existing editor tools. Their configurations are maintained in [teaching-native-tools.mjs](../../scripts/lib/teaching-native-tools.mjs). Scope inputs are A+, A−, B+, B−; meter terminals are 1 V Ω, 2 COM and 3 A. Do not create disconnected decorative library symbols to replace these tools.

Artwork generation is reproducible from checked-in sources:

- `npm run libraries:digital` builds the digital logic bundle.
- `npm run libraries:functional` builds the functional interfaces bundle.
- `npm run libraries:sensors` builds the sensors and interfaces bundle.
- `npm run libraries:network` builds the physical network layout bundle.
- `npm run libraries:all` builds and packages the standard libraries.

Keep terminal names, electrical types, polarity and grid alignment consistent with the recipes. Model templates live in [teaching-models.mjs](../../scripts/lib/teaching-models.mjs); a symbol contract alone does not establish an executable or verified model. Test points and connectors use comment-only templates rather than artificial loads or shorts.
