---
description: 現在のセッションをテレメトリビューアで開く
---

OPENCODE_OBSERVABILITY_OPEN_MONITOR

このコマンドは opencode-observability プラグインの UserPromptExpansion フックが
モデル実行前に処理します。フックは
`npx --yes opencode-observability@latest hook claude` に委譲し、必要なら
ビューアサーバーを起動してからブラウザでセッションビューアを開きます。

もしこのテキストがモデルに届いている場合、フックが動作していません。
`npx --yes opencode-observability@latest hook claude` を実行できるか確認してください。
ビューアサーバーが起動していなければ `npx --yes opencode-observability@latest`
で起動してください。ユーザーに「/hooks でフックの信頼状態を確認するか、
プラグインを再インストールしてください」と伝え、それ以外の操作は行わないでください。
