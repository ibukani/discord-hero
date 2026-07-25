# Implementation prompt

`AGENTS.md`、`.ai/REPOSITORY_MAP.md`、指定されたタスク契約を最初に読む。

実装では受入条件を一つずつ満たし、必要なテストを同じ変更に含める。型エラーや境界違反を型アサーションで隠さない。完了前に`npm run agent:verify`を実行し、`.artifacts/agent/verification.md`に失敗または未実行項目が残っていないことを確認する。
