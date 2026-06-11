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

## Claude Code / Codex Integration

このリポジトリは Claude Code と Codex のプラグインマーケットプレイスを兼ねています。
それぞれのプラグインは `/monitor` で **現在のセッション** をビューア
(`/sessions/claude/<id>` / `/sessions/codex/<id>`) で開きます。
どちらもフック（Claude Code: `UserPromptExpansion` / Codex: `UserPromptSubmit`）が
**モデル実行前にプロンプトをブロック**して処理するため、トークンを消費しません。
OpenCode plugin の `command.execute.before` + キャンセルと同じ動作モデルです。

### Claude Code

```
/plugin marketplace add abekdwight/opencode-telemetry
/plugin install opencode-telemetry@opencode-telemetry
```

`/monitor` を実行すると、フックがブラウザでセッションビューアを開き
プロンプト展開をブロックします。プラグインのフックは初回に信頼の承認が必要です。

### Codex

```
codex plugin marketplace add abekdwight/opencode-telemetry
codex plugin add opencode-telemetry@opencode-telemetry
```

`/monitor`（または skill `@monitor`）でビューアを開きます。フックは初回に
`/hooks` で信頼を承認してください。フックが無効な場合は skill 本文の
フォールバックとして、モデルが `$CODEX_THREAD_ID` を使って URL を開きます
（この場合のみ 1 ターン消費）。

### 共通の前提・設定

- ビューアサーバーが起動していること（`npx opencode-observability`）。
  未起動の場合、フックは起動方法を案内するメッセージを返します
- フックスクリプトは `python3`（標準ライブラリのみ）で動作します
- `OPENCODE_TELEMETRY_URL`: ビューアの base URL（既定値 `http://127.0.0.1:3737`）

レイアウト: プラグイン本体は `plugins/claude-code/` と `plugins/codex/`、
マーケットプレイスマニフェストは `.claude-plugin/marketplace.json`（Claude Code）と
`.agents/plugins/marketplace.json`（Codex）にあります。

## Monitor Timeline

`/monitor` ページは各セッションカードに **インライン SVG タイムラインチャート** を直接埋め込んでいます。水平の時間軸は右端が「Now」、左端が「5m」で、新しい活動が右に、古い活動が左に流れるリアルタイムのチャートレーン表示です。セッションの選択パネルや Timeline ボタンはありません — タイムラインは常にカード内に表示されます。このタイムラインは **ライブ専用** のメモリ内ストリームです。

### エンドポイント

タイムライン feed は `/api/monitor/events` (スナップショット SSE) とは **独立した** 専用 SSE エンドポイント `GET /api/monitor/timeline/events` から配信されます。両者はそれぞれ独立して接続・再接続します。

### ライブ専用の動作

- タイムラインはページロード時点から開始します。**接続前に発生したイベントは含まれません。**
- ページをリロードするとブラウザ側のインメモリキャッシュがリセットされ、タイムラインは空の状態から再開します。
- サーバー側にイベント履歴のバックフィルや replay 機能はありません。

### チャートの視覚構造

- チャートレーン背景に水平グリッドライン (25%/50%/75%) と 1 分刻みの垂直グリッドラインを表示
- オペレーター向けアクション分類別のスタック棒グラフ（下から順に）:
  - **activity** (灰色, 低不透明度) — セッション作成・更新、ステータス変更 (idle/busy)、todo 更新などの非アクション対象イベント
  - **subagent** (青) — サブエージェント起動イベント
  - **pressure** (琥珀) — コンパクション、リトライ、warning レベルのアラートなどの劣化シグナル
  - **failure** (赤, 高不透明度) — エラーおよび error レベルのアラート。介入が必要なブロッキング問題
- feed が reconnecting/disconnected 状態のときはチャートの代わりに状態インジケータを表示

### メタデータ専用のプライバシー境界

ブラウザへ送信されるタイムラインイベントは `src/contracts/monitor-timeline.ts` で定義されたフィールドのみを含みます。メッセージ本文、プロンプト、ツール引数、スタックトレースなどの生ペイロードは含まれません。`MonitorTimelineEventMeta` には `status`、`category`、`level`、`todoCount`、`compactionCount`、`childSessionId` のみが許可されています。

### セッション詳細との関係

`/sessions/:harness/:id` は永続化されたセッション詳細ビューです。タイムライン feed はそのページに存在するデータのリアルタイムビューを提供しますが、v1 の feed とセッション詳細ビューの完全なイベント一致を保証しません。タイムラインには heartbeat 由来の暗黙 upsert イベントは含まれません。

### タイムライン容量

セッションごとに最大 200 イベントをインメモリにキャッシュします。上限到達時は古いイベントが自動的に破棄されます。

## Session Detail Syntax Highlight

`/sessions/:harness/:id` のメッセージ本文中のフェンスドコードブロックは [Shiki](https://shiki.style/) でシンタックスハイライトされます。Oniguruma WASM エンジンと各言語の文法は Vite のコード分割により遅延ロードされ、初回のコードブロック描画時にバックグラウンドで初期化されます。

### 対応言語

`typescript` (`ts`), `tsx`, `javascript` (`js`), `jsx`, `python` (`py`), `rust`, `go`, `php`, `ruby` (`rb`), `json`, `css`, `html`, `bash` (`sh` / `zsh`), `yaml` (`yml`), `markdown` (`md`), `sql`, `diff` の 17 言語に加え、`mermaid` (React コンポーネントによる SVG 描画 + ライトボックス) と `text` (プレーンテキスト、別名 `plain` / `txt`) を特殊扱いとして対応します。

### 未対応言語の扱い

未対応の言語識別子、および言語識別子の無いフェンスはプレーンテキストとして装飾なしで表示します。意図せず誤った文法で彩色される(嘘のハイライト)ことを防ぐため、デフォルト文法へのフォールバックは行いません。

### テーマ

`github-light` / `github-dark` のデュアルテーマで、ページのテーマトグルに同期します。Shiki が出力する `<pre class="shiki">` の背景色は CSS でリセットし、ページの `--color-bg-code` を単一の真実としてラッパーに適用します。

## Safety

- browser-facing contract は raw upstream payload を露出しません
- `/api/sessions/opencode/:sessionId` の DELETE は `x-opencode-confirm-delete: <sessionId>` が一致しない限り拒否します
- app shell は observability SSE の再接続を行い、接続不能時は degraded 表示に切り替えます
- markdown は `react-markdown` (raw HTML 非許可) で描画し、diff は escape 済みで表示します
