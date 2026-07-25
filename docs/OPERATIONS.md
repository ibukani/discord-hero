# 運用設計

## 環境

| 環境       | Discord App | Worker     | D1         | Queue      |
| ---------- | ----------- | ---------- | ---------- | ---------- |
| local      | 任意        | workerd    | ローカル   | ローカル   |
| staging    | 開発用      | Staging    | Staging    | Staging    |
| production | 本番用      | Production | Production | Production |

## 構造化ログ

ログはJSONオブジェクトとして出力し、次のキーを基本とします。

- `level`
- `event`
- `requestId`
- `roomIdHash`
- `matchId`
- `serverTick`
- `durationMs`
- `errorCode`

秘密情報と生のトークンは記録しません。

HTTPログの`route`は既知のテンプレートへ正規化し、Room IDを含む生pathは記録しません。WebSocket close reasonは外部入力なので本文を記録せず長さだけを記録します。Workers Logsは有効化し、全ログを収集しつつtraceはサンプリングします。

## 主要指標

- アクティブルーム数
- 同時接続数
- 平均ルーム人数
- 試合開始率
- 試合完了率
- 平均試合時間
- WebSocket切断率
- 再接続成功率
- ティック処理時間
- スナップショット保存時間
- Queue再試行数
- D1失敗数
- プロトコル違反数

## アラート対象

- 認証交換の急激な失敗増加
- Durable Object例外率
- Queueの継続的な再試行
- D1書き込み失敗
- ティック処理時間が固定ステップを継続的に超過
- 再接続失敗率の増加
- 対応外プロトコルの急増

## 障害時の挙動

| 障害                 | 挙動                                 |
| -------------------- | ------------------------------------ |
| クライアント切断     | キャラクターをAIへ移管               |
| WebSocket再接続      | 完全スナップショットまたは差分を送信 |
| Durable Object再起動 | 最新チェックポイントから復元         |
| Queue重複            | `eventId`で無視                      |
| D1一時障害           | Queue再試行                          |
| 古いクライアント     | 更新要求エラー                       |
| Discord SDK障害      | 再認証可能な画面を表示               |

## データ保持

- 戦闘中の細粒度ログは恒久保存しない
- 試合結果は分析に必要な集計値を保存
- 生のDiscordアクセストークンは保存しない
- スナップショットはルーム回復に必要な期間だけ保持

## デプロイ条件

- CIの`npm run check`が成功
- D1 migrationがレビュー済み
- Worker bindingとSecretが対象環境に存在
- `APP_ENV`が対象環境と一致
- Local AuthがStaging／Productionで無効
- 対応プロトコルとクライアントの互換性を確認
- `npm run deploy:preflight -- <environment>`が副作用前に成功
- npm依存木、脆弱性、install script許可リストが検証済み
