# opencode-observability

`opencode-observability` は OpenCode plugin から受け取る runtime event/heartbeat を集約し、複数 OpenCode instance を 1 つの monitor で監視する observability-first Node.js アプリケーションです。npm package は OpenCode plugin (`default export`) と monitor server CLI (`opencode-observability`) を同梱します。OpenCode plugin が起動時に local monitor server を検出し、未起動なら `127.0.0.1:3737` を単一起動して ingest を開始します。

## Requirements

- Node.js 22 以上
- npm 10 以上
- OpenCode plugin を利用する場合は OpenCode の `plugin` 設定で `opencode-observability` を指定

## Environment

- `PORT`: server の待受ポート。既定値は `3737`
- `HOST`: server の待受ホスト。既定値は `127.0.0.1`
- `OPENCODE_MONITOR_HEARTBEAT_TTL_MS`: heartbeat が途切れた source を inactive 扱いにするまでの猶予。既定値は `90000` (ms)
- `OPENCODE_MONITOR_INGEST_TOKEN`: ingest endpoint 用の共有トークン。設定時は `Authorization: Bearer <token>` か `x-opencode-observability-token: <token>` が必須（互換として `x-opencode-telemetry-token` も受理）
- `OPENCODE_OBSERVABILITY_INGEST_URL`: plugin の ingest 送信先。既定値は `http://127.0.0.1:3737/api/monitor/ingest`
- `OPENCODE_OBSERVABILITY_AUTOSTART`: plugin による local server 自動起動フラグ。`0` で無効化
- `OPENCODE_OBSERVABILITY_AUTOSTART_TIMEOUT_MS`: plugin が local server 起動完了を待つ上限時間。既定値は `20000` (ms)

`.env.example` を元に環境変数を設定できます。

## Commands

基本検証:

```bash
npm ci
npm run lint
npm run typecheck
npm run test
```

開発起動:

```fish
npm run dev:server
npm run dev:app
npm run dev:full
```

ビルドと E2E:

```fish
npm run build
npm run test:e2e
```

fixture DB を使う場合:

```fish
set -x OPENCODE_DB_PATH tests/fixtures/opencode-telemetry.sqlite
npm run test
set -e OPENCODE_DB_PATH
```

## Route Ownership

- `/api/*`: Hono read-only API
- all other non-static routes: React Router app shell

## Architecture

- `src/repositories/`: SQL access
- `src/services/`: route/API 向け集計と view model 生成
- `src/contracts/`: browser-facing contract
- `src/server/`: Hono API、plugin ingest aggregator、app shell 配信
- `web/`: React + Vite app shell
- `tests/`: Vitest
- `e2e/`: Playwright

## OpenCode Integration

OpenCode 設定 (`opencode.json` または `~/.config/opencode/opencode.json`) に次を追加します。

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-observability"]
}
```

plugin は `session.status`、`session.updated`、`session.idle`、`session.error`、`session.alert`、`session.compacted`、`todo.updated` と heartbeat を `POST /api/monitor/ingest` に送信します。heartbeat の `activeSessionIds` は busy だけでなく idle を含む「開いているセッション集合」として扱い、monitor 側は source heartbeat TTL が生きている限り表示を維持します。

`OPENCODE_OBSERVABILITY_INGEST_URL` が local (`localhost` / `127.0.0.1` / `::1`) を指す場合、plugin は monitor server を health check し、未起動なら lock 付きで単一起動します。複数 OpenCode process が同時に起動しても server は 1 つだけ常駐します。

ingest payload 例:

```json
{
  "source": {
    "instanceId": "macbook-pro:12345",
    "label": "terminal-main"
  },
  "heartbeat": {
    "at": "2026-03-21T09:30:00.000Z",
    "activeSessionIds": ["ses_abc", "ses_def"]
  },
  "events": [
    {
      "type": "session.upsert",
      "session": {
        "id": "ses_abc",
        "title": "Investigate flaky monitor test",
        "directory": "/workspace/opencode-observability",
        "updatedAt": "2026-03-21T09:29:59.000Z",
        "messageCount": 18,
        "toolCallCount": 9,
        "compactionCount": 1,
        "todoCount": 2
      }
    },
    {
      "type": "session.status",
      "session": { "id": "ses_abc" },
      "status": "idle"
    },
    {
      "type": "session.alert",
      "session": { "id": "ses_abc" },
      "category": "network",
      "level": "error",
      "message": "network retry triggered"
    }
  ]
}
```

## Safety

- browser-facing contract は raw upstream payload を露出しません
- `/api/session/:sessionId` の DELETE は `x-opencode-confirm-delete: <sessionId>` が一致しない限り拒否します
- app shell は observability SSE の再接続を行い、接続不能時は degraded 表示に切り替えます
- markdown と diff は sanitize helper 経由で描画します
