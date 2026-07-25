# 環境設定

## 設定の分類

設定値は公開可能な値と秘密情報に分けます。

### クライアントへ公開される値

ルートの`.env.local`で管理します。

```dotenv
VITE_DISCORD_CLIENT_ID=
VITE_PLATFORM_MODE=auto
VITE_LOCAL_ROOM_ID=dev-room
VITE_LOCAL_USER_ID=alice
VITE_LOCAL_DISPLAY_NAME=Alice
```

`VITE_`接頭辞の値はブラウザへ組み込まれます。Client Secretや署名鍵を置いてはいけません。

### Workerの秘密情報

ローカルでは`apps/activity/.dev.vars`を使用します。

```dotenv
DISCORD_CLIENT_SECRET=replace-for-discord-testing
SESSION_SIGNING_SECRET=replace-with-at-least-32-random-characters
```

StagingとProductionではCloudflare Secretへ登録します。

```bash
cd apps/activity
npm exec -- wrangler secret put DISCORD_CLIENT_SECRET --env staging
npm exec -- wrangler secret put SESSION_SIGNING_SECRET --env staging
npm exec -- wrangler secret put DISCORD_CLIENT_SECRET --env production
npm exec -- wrangler secret put SESSION_SIGNING_SECRET --env production
```

## Cloudflareリソース

`apps/activity/wrangler.jsonc`の以下を環境ごとに置き換えます。

- `DISCORD_CLIENT_ID`
- D1の`database_id`
- Queue名
- Worker名
- `AUTH_RATE_LIMITER`のaccount内で一意な正整数`namespace_id`

Durable Object、D1、Queueはlocal／staging／productionで共有しません。

Worker binding型は`apps/activity/wrangler.jsonc`から生成します。binding、変数、必須Secretを変更したら、手書き型を追加せず次を実行して`worker-configuration.d.ts`をコミットしてください。

```bash
npm run cf:typegen
```

## D1マイグレーション

```bash
npm run db:migrate:local
npm run db:migrate:staging
npm run db:migrate:production
```

Staging／Productionへの適用前にSQLと後方互換性をレビューします。破壊的な変更は、既存コードと新コードの両方が動作する移行を挟んでください。

## Discord Application

開発用と本番用のDiscord Applicationを分けます。

一致させる値：

- Viteの`VITE_DISCORD_CLIENT_ID`
- Wranglerの`DISCORD_CLIENT_ID`
- Discord Developer Portal上のApplication ID

Discord Developer PortalのURL Mappingには、対象環境のWorker URLを設定します。ローカルでDiscord内検証を行う場合は、安全なHTTPSトンネルをローカルViteサーバーへ接続します。

## GitHub Actions

GitHub Environmentsとして`staging`と`production`を作成し、Productionには承認ルールを設定します。

Repository／Environment Secrets：

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

Variables：

- `STAGING_DISCORD_CLIENT_ID`
- `PRODUCTION_DISCORD_CLIENT_ID`

Worker側の`DISCORD_CLIENT_ID`は`wrangler.jsonc`の対象環境にも設定します。

## デプロイ

Vite Pluginでは`CLOUDFLARE_ENV`をビルド時に設定する必要があります。リポジトリのデプロイスクリプトが環境値を設定し、`vite build`後に`wrangler deploy`を実行します。

```bash
npm run deploy:staging
npm run deploy:production
```

デプロイワークフローとデプロイスクリプトは、D1マイグレーションやアップロードより先にプリフライトを実行します。プリフライトはplaceholder／ゼロD1 ID、環境名、Local Auth、必須Secret宣言、対象Workerに登録済みのSecret名、DO・D1・Queue・DLQ binding、ViteとWorkerのDiscord Client ID一致、Cloudflare資格情報の存在を検査します。Secret値そのものは取得・表示しません。

```bash
npm run deploy:preflight -- staging
npm run deploy:preflight -- production
```

リポジトリ内のstaging／production IDは初期状態ではplaceholderなので、実在値を設定するまでプリフライトは意図的に失敗します。
