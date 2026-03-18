# opencode-telemetry

OpenCode の SQLite DB から `role=user` のテキスト発話を抽出し、Markdown 形式で標準出力する CLI です。

## 使い方

```bash
npm install
npm run dev
```

DB パスは `os.homedir()` を基準に `~/.local/share/opencode/opencode.db` を解決します。
