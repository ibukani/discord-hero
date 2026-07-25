# AI coding harness

このディレクトリは、AIコーディング作業の入力契約、機械検査規則、リポジトリ案内を管理する。

## 標準フロー

1. `AGENTS.md`と`.ai/REPOSITORY_MAP.md`を読む。
2. `npm run agent:task -- <task-id>`でタスクファイルを作る。
3. `npm run agent:inspect -- .ai/tasks/<task>.json`を実行する。
4. 実装後に同じタスクファイルを指定して`npm run agent:verify -- .ai/tasks/<task>.json`を実行する。
5. `.artifacts/agent/verification.md`を確認し、失敗を残さない。

## 保証すること

- ワークスペース間の依存方向を検査する。
- `game-core`内の非決定的・環境依存APIを拒否する。
- タスク契約の必須項目と受入条件IDを検査する。
- リポジトリマップが実体と一致しているか検査する。
- 型、Lint、テスト、ビルドを単一コマンドで実行し、機械可読レポートを残す。

## 生成物

`.artifacts/agent/`はローカル生成物であり、通常はコミットしない。
