# Discord Hero

Discord Activityとして複数人で遊べる、タスクバー風UIの協力型セミ放置ローグライトRPGです。

通常攻撃、スキル使用、遠征Lv.上昇、ルートやイベントの選択はサーバーが自動処理します。プレイヤーは遠征前にビルド、戦闘作戦、成長方針、進行方針、撤退基準を設定し、遠征中は必要な場合だけ自動判断へ介入できます。

クラスは固定された役割ではなくビルドの土台として扱い、武器、装備、スキル、パッシブ、作戦によって実際の戦い方が決まります。画面はロビー、ビルド・自動遠征設定、戦闘、結果へ分離し、その時点で必要な情報だけを表示する設計です。

## 収録内容

- npm workspacesによるTypeScriptモノレポ
- 決定論的なゲームコア
- Zodで検証する共有通信プロトコル
- ReactによるActivity UI
- PixiJSによる戦闘表示
- Discord／ローカル環境を差し替えるPlatform Bridge
- Cloudflare WorkerのHTTP API
- Durable Objectによるサーバー権威型ルーム
- WebSocket Hibernation対応の接続管理
- D1マイグレーションと冪等な試合結果保存
- Cloudflare Queueコンシューマー
- local／staging／productionの環境分離
- 厳格なTypeScript／ESLint設定
- 明示的な`any`、TypeScript抑制、危険な二重キャストを拒否する検査
- CI、依存更新、手動デプロイ用GitHub Actions
- AIコーディング用ハーネス、`AGENTS.md`、設計ドキュメント

ゲーム仕様書には完成時の製品仕様も含まれます。現在のコードは、自動戦闘・自動スキル・武器／防具／装飾品の装備スロットと効果・装備相性・スキルロードアウト・D1へ復元可能なクラス／ロードアウト／自動方針・実行中ルームへのサーバー権威型の途中参加・期限付きのルート／イベント判断と手動票上書き・救助可能なダウン状態、決定論的なプレイヤー別報酬、Queue経由の冪等なアカウント経験値／通貨精算とアンロック台帳更新、本人専用welcomeで復元されるアカウント進行表示、帰還結果、4クラス、複数人ルーム、再接続、試合結果保存、ロビー／設定／戦闘／結果の状態別画面までを通した基盤実装です。状態連携などの拡張要素は目標仕様として文書化されています。

## 必要環境

- Node.js 24（`.node-version`を正本とする。Node.js 22は22.13以降のみ対応）
- npm 12.0.1（`packageManager`を正本とする）
- Cloudflareアカウント（クラウドへデプロイする場合）
- Discord Developer Application（Discord内で動かす場合）

## ローカルセットアップ

```bash
npm ci
cp .env.example .env.local
cp apps/activity/.dev.vars.example apps/activity/.dev.vars
npm run dev
```

PowerShellでは`cp`の代わりに次を使用できます。

```powershell
Copy-Item .env.example .env.local
Copy-Item apps/activity/.dev.vars.example apps/activity/.dev.vars
```

`npm run dev`はローカルD1へ未適用のマイグレーションを適用してからViteを起動します。

通常ブラウザではLocal Platform Bridgeが選択されます。同じ`room`を指定した複数タブを開くと、Discordを使わずに複数人接続を確認できます。

```text
http://localhost:5173/?room=dev-room&user=alice&name=Alice
http://localhost:5173/?room=dev-room&user=bob&name=Bob
```

## 主要コマンド

```bash
npm run dev
npm run check
npm run agent:inspect
npm run agent:smoke
npm run agent:verify -- .ai/tasks/my-task.json
npm run check:dependencies
npm run build
npm run cf:typegen
npm run db:migrate:local
npm run deploy:staging
npm run deploy:production
```

## AIコーディング用ハーネス

AIへ実装を任せる場合は、タスク契約を作成してから検証します。

```bash
npm run agent:task -- my-task
npm run agent:inspect -- .ai/tasks/my-task.json
npm run agent:verify -- .ai/tasks/my-task.json
```

依存方向、ゲームコアの決定性、変更可能パス、依存監査、型検査、テスト、ビルドが一括検査され、`.artifacts/agent/`へ結果が出力されます。CIではbase revisionからのコミット済み差分と作業ツリーの両方を検査するため、クリーンcheckoutでも`allowedPaths`／`forbiddenPaths`が有効です。

## 環境

| 環境       | 認証                  | データ                   | 用途                   |
| ---------- | --------------------- | ------------------------ | ---------------------- |
| local      | Local Platform Bridge | ローカルD1／DO           | 通常の開発と自動テスト |
| staging    | Discord OAuth         | Staging D1／DO／Queue    | Discord結合確認        |
| production | Discord OAuth         | Production D1／DO／Queue | 公開環境               |

CloudflareのIDやDiscord Client IDはサンプル値です。`apps/activity/wrangler.jsonc`、`.dev.vars`、Cloudflare Secretsを環境ごとに設定してください。

## 依存関係の固定

`package-lock.json`、npm 12.0.1、依存パッケージのinstall script許可リストを固定しています。通常は`npm ci`を使用してください。依存更新後は`npm run check:dependencies`で依存木、high以上の脆弱性、未審査install scriptがないことを確認します。

## ドキュメント

- [ゲーム仕様](docs/GAME_SPEC.md)
- [画面構成・画面遷移仕様](docs/UI_SPEC.md)
- [アーキテクチャ](docs/ARCHITECTURE.md)
- [環境設定](docs/CONFIGURATION.md)
- [セキュリティ](docs/SECURITY.md)
- [運用設計](docs/OPERATIONS.md)
- [AIコーディング用ハーネス](docs/AI_CODING_HARNESS.md)
- [エージェント向け規約](AGENTS.md)

## 設計上の重要事項

- クライアントは戦闘結果を決定しません。
- ゲームコアはDiscordとCloudflareから独立しています。
- 外部入力はすべて`unknown`から実行時検証します。
- 戦闘中の状態をD1へ毎フレーム保存しません。
- 試合結果はQueue経由で冪等に保存します。
- 認証済みプレイヤーのクラス、ロードアウト、自動方針はD1へ保存し、次回のルーム参加時にサーバーが復元します。
- ローカル認証は`APP_ENV=local`かつ`ALLOW_LOCAL_AUTH=true`の場合だけ有効です。

## アセット管理

画像、スプライトシート、音声、フォント、データ、任意バイナリを論理IDで扱うアセット基盤を備えています。通常Git、Git LFS、ローカル専用ZIP、リモートZIP、外部CDN、生成物を同じランタイムカタログへ統合します。

```bash
npm run assets:list
npm run assets:install -- "path/to/asset-pack.zip"
npm run assets:validate
npm run assets:prepare:local
```

現在のTiny RPG Soldier & Orcはローカル専用パックとして導入済みです。素材が存在しない環境では図形によるフォールバック描画で起動します。詳しくは[`docs/ASSETS.md`](docs/ASSETS.md)を参照してください。
