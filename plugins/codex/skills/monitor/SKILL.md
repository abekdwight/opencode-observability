---
name: monitor
description: 現在のセッションをテレメトリビューアで開く
---

OPENCODE_OBSERVABILITY_OPEN_MONITOR

この指示は通常、opencode-observability プラグインの UserPromptSubmit フックが
モデル実行前に横取りし、ブラウザでセッションビューアを開きます。

この指示がモデルに届いている場合、フックが動作していません。
フォールバックとして次を実行してください:

1. シェルで次の URL をプラットフォームのオープナーで開く
   （macOS: `open`、Linux: `xdg-open`）:
   `http://127.0.0.1:3737/sessions/codex/$CODEX_THREAD_ID`
2. ユーザーに「`/hooks` でフックの信頼を承認すると、次回からモデルを
   介さずに開けるようになります」と伝える。

それ以外の操作は行わないでください。
