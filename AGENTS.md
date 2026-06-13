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
