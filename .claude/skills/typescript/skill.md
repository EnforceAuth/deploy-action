# TypeScript Standards

## Package Manager
Use `bun` for all operations:
- `bun install` - Install dependencies
- `bun run build` - Build the action
- `bun test` - Run tests (if configured)

## Code Style
- Use TypeScript strict mode
- Prefer `interface` over `type` for object shapes
- Export types that consumers need
- Use explicit return types on public functions

## Error Handling
- Use typed errors where possible
- Include actionable messages for user-facing errors
- Log debug info with `core.debug()`, warnings with `core.warning()`

## Validation
- Validate external inputs (API responses, timestamps)
- Use `Number.isNaN()` not global `isNaN()`
- Handle undefined/null explicitly
