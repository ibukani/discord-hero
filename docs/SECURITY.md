# セキュリティ設計

## 信頼境界

次の値はすべて信頼しません。

- HTTP body、query、header
- WebSocketメッセージ
- Discord SDKから得たクライアント側情報
- Queueメッセージ
- D1のJSON列
- Durable Objectスナップショット
- 環境変数

境界では`unknown`として受け取り、スキーマ検証後だけ利用します。

## 認証情報

- Discord Client SecretはCloudflare Secretに保存
- セッション署名鍵はCloudflare Secretに保存
- DiscordアクセストークンはD1へ保存しない
- 認可コード、アクセストークン、セッション、ルームチケットをログへ出さない
- `VITE_`接頭辞へ秘密情報を置かない

## セッション

アプリセッションとルームチケットはHMAC-SHA-256で署名します。

- 用途を`kind`で分離
- 発行時刻と有効期限を必須化
- アプリセッションを認証開始時のRoom IDへ固定
- ルームチケットは対象ルームを固定
- チケットのユーザーIDを接続ユーザーとして採用
- クライアント送信のユーザーIDを権威情報として使用しない

Activity instance IDはDiscord SDKから得るクライアント境界値であり、現状はDiscord参加者名簿のサーバー側証明ではありません。そのためルームは「推測困難な非公開リンク＋短命なルーム固定セッション」として扱い、Room ID単体を機密データへの認可根拠にはしません。Discordが参加証明APIを提供する場合は、セッション発行境界へ検証を追加します。

## 入力制限

- HTTP body上限
- WebSocketメッセージ上限
- ルームID、表示名、アクションIDの長さ制限
- WebSocket接続単位のメッセージレート制限
- ルーム全体8接続、プレイヤー単位2接続の上限
- 認証、ルームチケット、WebSocket入口のWorker Rate Limiting binding
- 対応外プロトコルの拒否
- 状態に不適切なコマンドの拒否

## 不正対策

- サーバー権威型
- クールタイムをサーバー判定
- 候補に存在しない強化を拒否
- 参加していないユーザーの操作を拒否
- 同じ`actionId`を一度だけ処理
- 試合結果をクライアントから受け取らない

## ローカル認証

ローカル認証は以下をすべて要求します。

- `APP_ENV`が`local`
- `ALLOW_LOCAL_AUTH`が文字列`true`
- Hostがlocalhost系
- Staging／Productionでは`ALLOW_LOCAL_AUTH=false`を明示する
- 起動時の環境スキーマ検証とデプロイ前プリフライトを通過する

## ログ

ログでは次をハッシュ化または省略します。

- Discord User ID
- Activity instance ID
- Room ID
- IPアドレス

個人を直接識別する情報は、障害解析に必要な最小限だけにします。

Room IDを含むHTTP pathと、クライアントが指定できるWebSocket close reasonはそのまま記録しません。環境検証エラーや境界検証エラーは入力値を含めず、安定したerror codeだけを記録します。

## 依存関係

- 依存パッケージ名を公式配布元で確認
- 初回インストールで生成したlockfileをレビューしてコミット
- lockfileがあるCIとデプロイでは`npm ci`を使用
- Node.jsとnpmのバージョンを固定し、CIも同じmajorを使用
- npm 12の`allowScripts`は審査した正確なパッケージバージョンだけを許可
- `npm audit`のhigh／criticalと壊れた依存木をCIで拒否
- Dependabot等で更新PRを作成
- 依存更新時も型検査、テスト、ビルドをすべて実行
