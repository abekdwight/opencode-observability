---
name: monitor
description: 現在のセッションをテレメトリビューアで開く
---

OPENCODE_OBSERVABILITY_OPEN_MONITOR

この指示は通常、opencode-observability プラグインの UserPromptSubmit フックが
モデル実行前に横取りします。フックは
`npx --yes opencode-observability@latest hook codex` に委譲し、必要なら
ビューアサーバーを起動してからブラウザでセッションビューアを開きます。

この指示がモデルに届いている場合、フックが動作していません。
フォールバックとして次を実行してください:

1. シェルで `npx --yes opencode-observability@latest hook codex` を実行できるか確認する
2. ビューアサーバーが起動していなければ、シェルで
   `npx --yes opencode-observability@latest` を実行する
3. シェルで次の URL をプラットフォームのオープナーで開く
   （macOS: `open`、Linux: `xdg-open`）:
   `http://127.0.0.1:3737/sessions/codex/$CODEX_THREAD_ID`
4. ユーザーに「`/hooks` でフックの信頼を承認すると、次回からモデルを
   介さずに開けるようになります」と伝える。

それ以外の操作は行わないでください。
