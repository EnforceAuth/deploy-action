# GitHub Actions Skill

This is a GitHub Action repository. Key conventions:

## Project Structure
- `src/` - TypeScript source files
- `dist/` - Compiled output (committed to repo, required for actions)
- `action.yml` - Action metadata and inputs/outputs definition

## Build
```bash
bun run build
```

Uses `ncc` to bundle everything into `dist/index.js`. The dist folder MUST be committed.

## Testing Changes
To test changes to this action:
1. Push to a branch
2. Reference from another repo: `uses: EnforceAuth/deploy-action@branch-name`
3. Or create a test workflow in this repo

## Key Files
- `src/main.ts` - Entry point
- `src/oidc.ts` - GitHub OIDC token exchange
- `src/api-client.ts` - EnforceAuth API client
- `src/polling.ts` - Log-based deployment status polling
- `src/idempotency.ts` - Idempotency key generation

## Outputs
When adding new outputs:
1. Add to `action.yml` outputs section
2. Call `core.setOutput('name', value)` in main.ts
