# Use Modern Angular with Signals and TypeScript Domain Modules

Gones is an Angular single-page application. We decided to use modern standalone Angular components, zoneless change detection, Angular Router, services, and heavy use of Signals, while keeping tournament calculations and source-data rules in framework-independent TypeScript domain modules rather than embedding them in components. Angular's TypeScript build provides stronger contracts for domain data, backend-bridge persistence, and UI state.

Inline page inputs that edit an existing element should use a local draft while focused, then save through the application backend bridge when the user leaves the field or presses Enter to validate. After blur or Enter, the control returns to its display state. Larger source-data editing flows can still use explicit Save/Cancel drafts when multiple fields or destructive changes are grouped together.
