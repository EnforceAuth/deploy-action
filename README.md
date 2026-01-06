# EnforceAuth Deploy Action

Deploy OPA bundles via EnforceAuth API using OIDC workload identity - no API keys required.

## Features

- **OIDC Authentication**: Uses GitHub Actions OIDC tokens - no secrets to manage
- **Automatic Retry**: Polls for deployment completion with exponential backoff
- **Idempotent**: Safe to retry - uses deterministic idempotency keys
- **Detailed Outputs**: Provides run ID, status, bundle version, and duration

## Prerequisites

1. **EnforceAuth Account**: You need an EnforceAuth account with a configured entity
2. **Trust Policy**: Configure a trust policy in EnforceAuth that trusts your GitHub repository
3. **Workflow Permissions**: Your workflow must have `id-token: write` permission

## Usage

### Basic Usage

```yaml
name: Deploy Policies
on:
  push:
    branches: [main]
    paths:
      - 'policies/**'

jobs:
  deploy:
    runs-on: ubuntu-latest
    permissions:
      id-token: write  # Required for OIDC
      contents: read
    
    steps:
      - uses: actions/checkout@v4
      
      - name: Deploy OPA Bundle
        uses: enforceauth/deploy-action@v1
        with:
          entity-id: ${{ vars.ENFORCEAUTH_ENTITY_ID }}
```

### With All Options

```yaml
- name: Deploy OPA Bundle
  id: deploy
  uses: enforceauth/deploy-action@v1
  with:
    entity-id: ${{ vars.ENFORCEAUTH_ENTITY_ID }}
    api-url: 'https://api.enforceauth.com'  # Optional, this is the default
    wait-for-completion: 'true'              # Optional, default: true
    timeout-minutes: '10'                    # Optional, default: 10
    dry-run: 'false'                         # Optional, default: false

- name: Show Deployment Results
  run: |
    echo "Run ID: ${{ steps.deploy.outputs.run-id }}"
    echo "Status: ${{ steps.deploy.outputs.status }}"
    echo "Bundle Version: ${{ steps.deploy.outputs.bundle-version }}"
    echo "Duration: ${{ steps.deploy.outputs.duration-seconds }} seconds"
```

### Fire and Forget

If you don't want to wait for the deployment to complete:

```yaml
- name: Deploy OPA Bundle
  uses: enforceauth/deploy-action@v1
  with:
    entity-id: ${{ vars.ENFORCEAUTH_ENTITY_ID }}
    wait-for-completion: 'false'
```

### Dry Run Mode

Test the action without actually deploying:

```yaml
- name: Test Deploy Action
  uses: enforceauth/deploy-action@v1
  with:
    entity-id: ${{ vars.ENFORCEAUTH_ENTITY_ID }}
    dry-run: 'true'
```

## Inputs

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `entity-id` | Entity ID to deploy | Yes | - |
| `api-url` | EnforceAuth API URL | No | `https://api.enforceauth.com` |
| `wait-for-completion` | Wait for deployment to complete | No | `true` |
| `timeout-minutes` | Timeout when waiting for completion (1-60) | No | `10` |
| `dry-run` | Test mode - skip actual deployment | No | `false` |

## Outputs

| Output | Description |
|--------|-------------|
| `run-id` | Deployment run ID |
| `status` | Final deployment status (`success`, `failed`, `timeout`, `pending`, `in_progress`) |
| `bundle-version` | Deployed bundle version (on success) |
| `duration-seconds` | Deployment duration in seconds |

## Configuring Trust Policies

Before using this action, you need to configure a trust policy in EnforceAuth that allows your GitHub repository to deploy to your entity.

### In the EnforceAuth Console

1. Navigate to your entity's settings
2. Go to **Trust Policies**
3. Click **Add Trust Policy**
4. Configure the policy:

```yaml
Name: Production Deploys
Provider: GitHub Actions
Repository: your-org/your-repo
Branch: refs/heads/main  # or refs/heads/* for any branch
Environment: production   # optional
```

### Trust Policy Conditions

All conditions must match for a deployment to be authorized:

| Condition | Description | Example |
|-----------|-------------|---------|
| Repository | GitHub repository name | `acme/policies` |
| Branch | Git ref pattern | `refs/heads/main`, `refs/heads/*` |
| Environment | GitHub environment name | `production` |
| Actor | GitHub username pattern | `*` (any) |

## Security

This action uses OIDC workload identity instead of API keys, which provides:

- **No secrets to manage**: GitHub generates a unique token for each workflow run
- **Short-lived tokens**: Tokens expire in minutes, not days
- **Fine-grained access**: Trust policies control exactly which repositories and branches can deploy
- **Full audit trail**: Every deployment includes GitHub context (repository, branch, commit, actor)

## Troubleshooting

### "Failed to get GitHub OIDC token"

Ensure your workflow has the required permissions:

```yaml
permissions:
  id-token: write
  contents: read
```

### "Token exchange failed: No matching trust policy"

Check that:
1. A trust policy exists for your repository in EnforceAuth
2. The trust policy matches your current branch
3. The trust policy is enabled

### "Deployment timed out"

- Increase `timeout-minutes` if deployments typically take longer
- Check the EnforceAuth console for deployment logs

## Development

### Building

```bash
npm install
npm run build
```

### Testing Locally

The action requires a GitHub Actions environment with OIDC support. For local testing:

1. Use `act` with a custom event
2. Mock the OIDC token endpoint
3. Run integration tests in a real workflow

## License

MIT
