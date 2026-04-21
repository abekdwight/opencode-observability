# AGENTS.md

## DBスキーマ変更に関する重要規約
- このシステムは opencode の plugin であるため、plugin 側から DB schema の変更を行ってはならない。
- plugin 側から DB index の追加・変更・削除を行ってはならない。
- 理由は、opencode 本体が生成・管理する schema と migration の整合性を崩し、本体側の migration を阻害するリスクが高いためである。

## 修正時の必須ルール
- コード修正を行った場合は、完了報告前に必ず `npm run build` を実行し、成功を確認する。
- `npm run build` が失敗した場合は、失敗ログの要点と失敗原因を報告する。
