# Contributing

## Setup

```bash
npm ci
```

fixture DB で作業する場合:

```fish
set -x OPENCODE_DB_PATH tests/fixtures/opencode-telemetry.sqlite
```

## Validation

変更前後で次を通します。

```bash
npm run lint
npm run typecheck
npm run test
npm run build
npm run test:e2e
```

fixture DB を再生成する場合:

```bash
npm run fixtures:build
```

## Route Rules

- `/api/*` は Hono が所有します
- `/assets/*` は static middleware が所有します
- それ以外の route は React Router app shell が所有します
- 新規 browser-facing data は contract を先に定義し、route から raw DB shape を返しません

## Safety Rules

- markdown / diff は sanitize helper を経由させます
- destructive action は確認値を server で再検証します
- E2E は happy path と degraded path の両方を更新します
