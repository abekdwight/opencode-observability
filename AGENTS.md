# AGENTS.md

## DBスキーマ変更に関する重要規約
- このシステムは opencode の plugin であるため、plugin 側から DB schema の変更を行ってはならない。
- plugin 側から DB index の追加・変更・削除を行ってはならない。
- 理由は、opencode 本体が生成・管理する schema と migration の整合性を崩し、本体側の migration を阻害するリスクが高いためである。

## 修正時の必須ルール（実装と検証は常に一体）

コード（`src/` / `web/` / `tests/` / `e2e/` / `scripts/` / 設定ファイル）を変更したら、**完了報告および push の前に必ず以下を全て実行し、成功を確認する**。これは CI（`.github/workflows/ci.yml`）と同一のゲートであり、省略・先送りは禁止する。

```bash
npm run lint        # biome check .
npm run typecheck
npm run test
npm run build
```

### 失敗を放置しないこと
- いずれかが失敗したら、その失敗を **放置してはならない**。原因を特定して修正する。
- 自分の変更と無関係な既存の失敗（既存の lint 負債など）を見つけた場合も、見逃さず必ず報告する。
- 「動くから」「lint だけだから」を理由に、赤いまま完了報告・push をしてはならない。
- push した場合は CI が green であることまで確認する責務を負う。赤くなったら即座に是正する。
- 検証を実行できない事情がある場合は、その旨と未検証であることを明示して報告する。

## コミット規約（絶対遵守）

`main` へのマージは semantic-release により自動でバージョン採番・タグ付け・npm 公開される。したがって**全コミットメッセージは Conventional Commits に従うことを絶対ルールとする**。コミットの「型」と破壊的フラグが、公開されるバージョンを直接決定するためである。

### 型とバージョンの対応

| 型 | 例 | 採番（現行 0.1.0 からの例） |
| --- | --- | --- |
| `fix:` | `fix: セッション取得のリークを修正` | PATCH → 0.1.1 |
| `perf:` | `perf: 集計クエリを高速化` | PATCH → 0.1.1 |
| `feat:` | `feat: 検索フィルタを追加` | MINOR → 0.2.0 |
| 破壊的変更（`feat!:` 等／本文に `BREAKING CHANGE:`） | `feat!: API レスポンス形式を変更` | MAJOR → 1.0.0 |
| `docs:` `style:` `refactor:` `test:` `build:` `ci:` `chore:` | `chore: 依存を整理` | リリースなし（公開・タグ付けされない） |

### 規約の要点
- バージョンを決めるのは**型と破壊的フラグのみ**。スコープ（`feat(dashboard):` の `dashboard`）は採番に影響しない。
- 1回のマージに複数コミットが含まれる場合、**最も重い変更**が採用される（`fix` と `feat` 混在 → MINOR、`BREAKING CHANGE` が1つでもあれば MAJOR）。
- **破壊的変更は 0.x でも 1.0.0 へ跳ねる**（semantic-release は厳密 semver）。`1.0.0` を出す意図がない限り `!` / `BREAKING CHANGE:` を使ってはならない。
- リリース不要な変更は `chore:` / `ci:` / `docs:` 等を使い、不要な公開を避ける。
