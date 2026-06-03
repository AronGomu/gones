# Use Modern Angular with Signals and TypeScript Domain Modules

Gones is an Angular single-page application. We decided to use modern standalone Angular components, zoneless change detection, Angular Router, services, and heavy use of Signals, while keeping tournament calculations and source-data rules in framework-independent TypeScript domain modules rather than embedding them in components. Angular's TypeScript build provides stronger contracts for domain data, backend-bridge persistence, and UI state.
