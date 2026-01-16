#!/bin/bash
# Auto-rebuild when TypeScript files change
# Triggered by PostToolUse hook on Edit/Write

cd "$CLAUDE_PROJECT_DIR"

# Check if any .ts files were modified
if git diff --name-only HEAD 2>/dev/null | grep -q '\.ts$'; then
  # Run build silently, only show output on error
  if ! bun run build > /dev/null 2>&1; then
    echo "Build failed after file changes"
    exit 1
  fi
fi

exit 0
