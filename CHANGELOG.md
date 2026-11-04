# Changelog

## 0.3.1

- Automate source synchronization from the private monorepo with an explicit publication file list.
- Build, test, package, and publish GitHub Releases through Actions, including SHA-256 asset verification.
- Follow the published Latest Release by default in the curl installer; explicit version installs remain available.
- Verify the downloaded installer and MCP model discovery after publication without a paid decision call.

## 0.3.0

- Add five local stdio MCP tools with shared CLI credentials and API handling.
- Bundle the runtime for installation without npm or Git and verify release checksums.

## 0.2.0

- Add local key login, status, logout, and version reporting.

## 0.1.0

- Initial CLI for models, decisions, status, activity, and balance.
