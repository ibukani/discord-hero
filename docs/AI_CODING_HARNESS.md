# AIコーディング用ハーネス

## 目的

AIがリポジトリを変更するときに、規約を読むだけでなく、依存境界、型安全性、受入条件、テスト、ビルドを機械的に検査するための基盤です。

## 構成

| 要素                          | 役割                                       |
| ----------------------------- | ------------------------------------------ |
| `AGENTS.md`                   | 守るべき設計・型・セキュリティ規約         |
| `.ai/task.schema.json`        | AIタスク契約の形式                         |
| `.ai/architecture-rules.json` | ワークスペース間の許可依存と禁止API        |
| `.ai/REPOSITORY_MAP.md`       | 自動生成されるリポジトリ案内               |
| `packages/test-kit`           | 決定論的試合、固定時計、通信フィクスチャ   |
| `scripts/agent`               | 検査、案内生成、作業範囲監査、結果レポート |
| `.artifacts/agent`            | 機械可読・人間可読のローカル検証結果       |

## タスク契約

`.ai/task.template.json`をコピーし、目的、制約、受入条件、実行必須チェックID、変更可能範囲を記述します。

```bash
npm run agent:task -- my-task
npm run agent:inspect -- .ai/tasks/my-task.json
```

AI検証ではタスク契約の明示指定が必須です。変更ファイルが`allowedPaths`内にあり、`forbiddenPaths`へ一致しないことを確認します。`requiredChecks`には`typecheck`、`test`、`build`など、スキーマで定義された検査IDだけを指定します。

スコープ検査は、未コミット差分、staging済み差分、未追跡ファイルを常に対象にします。`--base <git-ref>`または`AGENT_BASE_REF`を指定すると、base revisionから`HEAD`までのコミット済み差分も加わります。renameでは移動元と移動先の両方を検査します。CIはPR base SHAまたはpush前SHAを渡し、変更範囲内にタスク契約が1件だけあれば自動選択します。タスク契約の削除、不正なファイル名、複数契約の同時変更は選択エラーとして拒否します。人間がタスク契約なしで変更する場合は`npm run check`を使用します。

## 検証コマンド

```bash
npm run agent:task -- my-task
npm run agent:map
npm run agent:inspect
npm run agent:smoke
npm run agent:harness:self-test
npm run agent:verify -- .ai/tasks/my-task.json
```

`agent:verify`は次を順番に実行します。

1. 明示的な型安全性回避の検査
2. アーキテクチャ境界の検査
3. タスク契約と変更範囲の検査
4. リポジトリマップの同期確認
5. 違反注入によるハーネス自己テスト
6. npmバージョン、依存木、脆弱性、install script許可の検査
7. Wrangler生成型の同期検査
8. Prettier
9. ESLint
10. TypeScript型検査
11. 単体・Workers runtime統合テスト
12. 本番ビルド

依存関係をまだ導入できない環境では、次のコマンドでNode.js標準機能だけを使う検査を実行できます。

```bash
npm run agent:verify:static -- .ai/tasks/my-task.json
```

完全検証ではありません。最終判定には`npm run agent:verify`が必要です。

## アーキテクチャ検査

現在、以下を自動的に拒否します。

- `game-core`からUI、Discord、Cloudflare、他ワークスペースへの依存
- `game-core`内の`Date.now()`、`Math.random()`、環境変数、ambient UUID生成
- 許可されていないワークスペース依存
- ワークスペース循環依存
- ActivityクライアントとWorkerの相互直接参照
- WorkerからReact、PixiJS、Discord Embedded App SDKへの依存
- `package.json`へ宣言されていないワークスペース参照

規則を変える場合は、コードを迂回させず`.ai/architecture-rules.json`と設計文書を同時に更新します。

## 共通テストキット

`@discord-hero/test-kit`は以下を提供します。

- `MatchHarness`
- コマンドと時間ステップの操作ログ
- 同一シード・同一操作列による試合再生
- 重複`actionId`の検証
- `FakeClock`
- Zod検証済み通信メッセージ生成

Activityの統合テストではWorkers Vitest Integrationを使い、実際のDurable Objectバインディング上でWebSocket認証、チケット再利用拒否、チェックポイント復旧を検証します。

## 型安全性と依存関係

`check:no-any`は`.d.ts`以外のTypeScriptにある明示的`any`、`@ts-ignore`／`@ts-nocheck`／`@ts-expect-error`、`as unknown as`二重キャストを拒否します。Worker binding型は`wrangler types`が生成する`worker-configuration.d.ts`を正本とし、手書きのbinding interfaceは置きません。

`check:dependencies`は固定npmバージョン、`npm ls`、high以上の`npm audit`、npm 12の`allowScripts`未審査項目を検査します。依存更新で`esbuild`や`workerd`のバージョンが変わった場合は、install scriptを確認してから許可リストを更新します。

## 検証レポート

`npm run agent:verify`は次を生成します。

```text
.artifacts/agent/verification.json
.artifacts/agent/verification.md
```

JSONは自動処理向け、Markdownは自己レビューとPR確認向けです。失敗したコマンドの出力も保存されます。

## Asset-aware verification

`agent:verify` reaches `npm run check`, which validates asset manifests, repository policies, checksums, image dimensions, and generated catalog compatibility. Asset tasks should include `assets/**`, `packages/assets/**`, `scripts/assets/**`, and the relevant client loader paths in their task contract.
