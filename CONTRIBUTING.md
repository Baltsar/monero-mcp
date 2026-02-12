# Contributing

## Workflow

1. Fork the repo
2. Create a branch from `main`
3. Implement and test (prefer stagenet)
4. Open a pull request with a clear description and risk notes

## Good first issues

- Improve rate-limiting ergonomics and diagnostics
- Improve RPC/network error messages
- Add transaction memo support where wallet RPC allows it
- Add a stagenet end-to-end test harness (currently unit tests are mock-based only)

## Help wanted

- Tor proxy support for RPC transport
- Multisig-safe tool workflows
- Cold-signing workflow integrations

## Code style

- TypeScript strict mode
- Keep modules focused and testable
- Use Biome or ESLint for formatting/linting consistency

## PR process

1. Fork and create a feature branch
2. Run tests/build locally
3. Validate behavior on stagenet when modifying transfer logic
4. Submit PR with before/after behavior and security impact notes
