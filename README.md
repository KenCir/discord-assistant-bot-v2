# discord-assistant-bot-v2

けんちる（aka. 博瀬 健）の Discord アシスタント Bot です。

## 機能

- Atlassian Statuspage 互換APIの監視
  - 監視対象の追加・更新・無効化
  - 現在ステータスのDiscordメッセージ作成・更新
  - 障害通知
  - メンテナンス予定通知
  - `ETag` / `304 Not Modified` 対応
  - 指定間隔での自動チェック
- VRChat向け動画セッションURL作成
  - YouTube URLを配信サーバーへPOST
  - 返却された `stream_url` をDiscordへ投稿
- ホストOS状態の常時表示
  - Bot起動時に指定チャンネルへEmbedを投稿
  - 一定間隔で同じメッセージを更新
  - Bot終了時にメッセージを削除
- GitHubリポジトリ監視
  - 登録したリポジトリのIssue/PR/CI/Release/最終Pushを表示
  - GitHub GraphQL APIで定期取得
  - Rate Limit情報を表示
- 基本ユーティリティ
  - `ping`
  - `user`

## コマンド一覧

### `/statuspage add`

Statuspage の監視対象を追加します。

```text
/statuspage add name:VRChat url:https://status.vrchat.com check_interval_minutes:10
```

| 引数 | 必須 | 説明 |
|---|---:|---|
| `name` | 必須 | 表示名 |
| `url` | 必須 | Statuspage のURL |
| `mention_role` | 任意 | 障害・重要更新時にメンションするロール |
| `check_interval_minutes` | 任意 | チェック間隔。最小5分、未指定時は10分 |

### `/statuspage list`

登録済み Statuspage を一覧表示します。ページングに対応しています。

```text
/statuspage list
```

### `/statuspage show`

指定した Statuspage の詳細を表示します。ページングに対応しています。

```text
/statuspage show target:https://status.vrchat.com
```

| 引数 | 必須 | 説明 |
|---|---:|---|
| `target` | 必須 | 登録ID、表示名、またはURL |

### `/statuspage update`

登録済み Statuspage の設定を更新します。

```text
/statuspage update target:https://status.vrchat.com name:VRChat Status check_interval_minutes:5 enabled:true
```

| 引数 | 必須 | 説明 |
|---|---:|---|
| `target` | 必須 | 登録ID、表示名、またはURL |
| `name` | 任意 | 新しい表示名 |
| `mention_role` | 任意 | 新しいメンションロール |
| `check_interval_minutes` | 任意 | 新しいチェック間隔。最小5分 |
| `enabled` | 任意 | 監視の有効・無効 |

### `/statuspage refresh`

指定した Statuspage を即時チェックします。

```text
/statuspage refresh target:https://status.vrchat.com
```

| 引数 | 必須 | 説明 |
|---|---:|---|
| `target` | 必須 | 登録ID、表示名、またはURL |

### `/statuspage remove`

指定した Statuspage の監視を無効化します。既存のDiscordメッセージは削除しません。

```text
/statuspage remove target:https://status.vrchat.com
```

| 引数 | 必須 | 説明 |
|---|---:|---|
| `target` | 必須 | 登録ID、表示名、またはURL |

### `/vrc session`

YouTube URLから、VRChat向け動画再生用のセッションURLを作成します。（あくまで自分用のため、他人の利用は想定していません）

```text
/vrc session youtube_url:https://www.youtube.com/watch?v=...
```

| 引数 | 必須 | 説明 |
|---|---:|---|
| `youtube_url` | 必須 | YouTube URL |

レスポンスの `stream_url` はコピーしやすいようにコードブロックで返します。

### `/github-watch add`

GitHubリポジトリを監視対象に追加します。

```text
/github-watch add owner:KenCir repo:discord-assistant-bot-v2
```

| 引数 | 必須 | 説明 |
|---|---:|---|
| `owner` | 必須 | リポジトリの owner |
| `repo` | 必須 | リポジトリ名 |

追加時にGitHub GraphQL APIで存在確認します。PATでアクセスできないリポジトリは追加できません。

### `/github-watch remove`

GitHubリポジトリを監視対象から削除します。

```text
/github-watch remove owner:KenCir repo:discord-assistant-bot-v2
```

### `/github-watch list`

登録済みGitHub監視対象を一覧表示します。

```text
/github-watch list
```

### `/github-watch status`

登録済みGitHub監視対象の状態を即時取得して表示します。

```text
/github-watch status
```

### `/ping`

疎通確認用コマンドです。

```text
/ping
```

## Statuspage 監視の動作

Bot起動中は、DB上で `enabled = true` の監視対象を `check_interval_minutes` ごとに自動チェックします。

- 初回チェックは登録順に5秒ずつ分散します。
- 通常チェックは `ETag` を使います。
- `304 Not Modified` の場合も、status message の「最終確認」は更新します。
- 障害・メンテナンス通知は `INCIDENT_CHANNEL_ID` のチャンネルへ投稿します。
- 現在ステータスは `STATUS_CHANNEL_ID` のチャンネルへ投稿・更新します。
- 連続失敗時はバックオフします。
  - 1回失敗: 通常間隔
  - 2回連続失敗: 20分
  - 3回以上連続失敗: 30分

## ホストOS状態表示

`HOST_STATUS_ENABLED=true` の場合、Bot起動時に `HOST_STATUS_CHANNEL_ID` のチャンネルへホストOS状態のEmbedメッセージを作成します。

- 更新間隔は `HOST_STATUS_UPDATE_INTERVAL_MS` で指定します。
- 未指定時は60秒ごとに更新します。
- メッセージIDは永続化せず、メモリ上でのみ保持します。
- CPU使用率・メモリ使用率・Load Usageの直近60件をメモリ上に保持し、`host-status.png` の折れ線グラフとしてEmbedに添付します。
- グラフ生成に失敗した場合は、画像なしでEmbedだけ更新します。
- Bot終了時にステータスメッセージを削除します。
- Docker APIや `docker.sock` は使わず、`node:os` の情報だけを表示します。
- Dockerコンテナ内で実行した場合、`node:os` が返す値はホストOS寄りの値になる場合があります。

警告条件:

- メモリ使用率が80%以上
- 1分ロードアベレージ ÷ CPUコア数 が80%以上

## GitHub監視

`GITHUB_STATUS_ENABLED=true` の場合、Bot起動時に `GITHUB_STATUS_CHANNEL_ID` のチャンネルへGitHub StatusのEmbedメッセージを作成します。

- 更新間隔は `GITHUB_STATUS_UPDATE_INTERVAL_MS` で指定します。
- 未指定時は5分ごとに更新します。
- ステータスメッセージは監視対象リポジトリ1つにつき1件作成します。
- GitHub StatusのメッセージIDはPostgreSQLの `github_watched_repositories.status_message_id` に保存します。
- Bot終了時に保存済みのGitHub Statusメッセージを削除します。
- `/github-watch remove` 実行時は、対象リポジトリのGitHub Statusメッセージ削除も試みます。
- GitHub Webhook / Probot は使わず、BotからGitHub GraphQL APIを定期取得します。
- 監視対象リポジトリはPostgreSQLの `github_watched_repositories` に保存します。

表示項目:

- Open Issues数
- Open Pull Requests数
- Renovate PR数
- Dependabot PR数
- default branch基準の最新CI状態
- 最新Release
- 最終Push日時
- GitHub GraphQL APIのRate Limit

## 環境変数

`.env` に以下を設定します。

```env
DISCORD_TOKEN=...
APPLICATION_ID=...
STATUS_CHANNEL_ID=123456789012345678
INCIDENT_CHANNEL_ID=234567890123456789
VRC_VIDEO_SERVER_URL=http://example.com
HOST_STATUS_ENABLED=true
HOST_STATUS_CHANNEL_ID=345678901234567890
HOST_STATUS_UPDATE_INTERVAL_MS=60000
GITHUB_TOKEN=...
GITHUB_STATUS_ENABLED=true
GITHUB_STATUS_UPDATE_INTERVAL_MS=300000
GITHUB_STATUS_CHANNEL_ID=456789012345678901

POSTGRES_USER=discord_assistant_bot_v2
POSTGRES_PASSWORD=password
POSTGRES_DB=discord_assistant_bot_v2
DATABASE_URL=postgres://discord_assistant_bot_v2:password@postgres:5432/discord_assistant_bot_v2
```

| 変数名 | 必須 | 説明 |
|---|---:|---|
| `DISCORD_TOKEN` | 必須 | Discord Bot token |
| `APPLICATION_ID` | 必須 | Discord application ID |
| `DATABASE_URL` | 必須 | PostgreSQL 接続URL |
| `STATUS_CHANNEL_ID` | 必須 | 現在ステータス表示メッセージの送信・更新先 |
| `INCIDENT_CHANNEL_ID` | 必須 | 障害通知・メンテナンス通知の送信・更新先 |
| `VRC_VIDEO_SERVER_URL` | 必須 | VRChat動画再生用の配信サーバーURL |
| `HOST_STATUS_ENABLED` | 任意 | `true` の場合だけホストOS状態表示を有効化 |
| `HOST_STATUS_CHANNEL_ID` | 任意 | ホストOS状態Embedの送信・更新先 |
| `HOST_STATUS_UPDATE_INTERVAL_MS` | 任意 | ホストOS状態Embedの更新間隔。未指定時は60000 |
| `GITHUB_TOKEN` | 任意 | GitHub GraphQL API用のPAT。GitHub監視を使う場合は必須 |
| `GITHUB_STATUS_ENABLED` | 任意 | `true` の場合だけGitHub Status表示を有効化 |
| `GITHUB_STATUS_UPDATE_INTERVAL_MS` | 任意 | GitHub Status Embedの更新間隔。未指定時は300000 |
| `GITHUB_STATUS_CHANNEL_ID` | 任意 | GitHub Status Embedの送信・更新先 |
| `POSTGRES_USER` | 必須 | Docker Compose のPostgreSQL初期ユーザー |
| `POSTGRES_PASSWORD` | 必須 | Docker Compose のPostgreSQL初期パスワード |
| `POSTGRES_DB` | 必須 | Docker Compose のPostgreSQL初期データベース |

### `DATABASE_URL`

PostgreSQL の接続 URL です。

```text
postgres://ユーザー名:パスワード@ホスト名:ポート番号/データベース名
```

例:

```text
postgres://discord_assistant_bot_v2:password@postgres:5432/discord_assistant_bot_v2
```

Docker Compose の `app` コンテナから接続する場合は、ホスト名に `postgres` を使います。

```env
DATABASE_URL=postgres://discord_assistant_bot_v2:password@postgres:5432/discord_assistant_bot_v2
```

ホストPCから `pnpm db:migrate` を実行する場合は、ホスト名に `localhost` を使います。

```text
postgres://discord_assistant_bot_v2:password@localhost:5432/discord_assistant_bot_v2
```

Bot からのDB接続セッションは `Asia/Tokyo` で接続します。PostgreSQL の `timestamp with time zone` は内部的にはUTC基準で扱われますが、SQL上の表示・解釈はJSTになります。

## セットアップ

Docker Compose で PostgreSQL を起動します。

```sh
docker compose up -d postgres
```

Docker Compose でマイグレーションを実行します。

```sh
docker compose run --profile tools --rm migrate
```

Discord のスラッシュコマンドを登録します。

```sh
docker compose run --rm app node dist/util/deploy.js
```

BotをDocker Composeで起動します。

```sh
docker compose up -d app
```

ログを確認します。

```sh
docker compose logs -f app
```

Botを含めてまとめて起動する場合は以下でも問題ありません。

```sh
docker compose up -d
```

`app` は `postgres` の healthcheck が成功してから起動します。

## ローカル開発

ホストPC上でBotを起動する場合は、`DATABASE_URL` のホスト名を `localhost` にしてください。

```sh
pnpm install
pnpm build
pnpm start
```

## DB マイグレーション

schema を変更して新しい migration を作る場合は、以下を実行します。

```sh
pnpm db:generate --name=change-name
```

生成された `drizzle/` 配下の migration ファイルはコミット対象です。

未適用の migration をDBへ適用します。

```sh
docker compose run --rm migrate
```

## 開発用コマンド

```sh
pnpm build
pnpm lint
pnpm format
```
