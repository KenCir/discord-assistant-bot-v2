# Atlassian Statuspage 通知機能 仕様書

## 目的

Atlassian Statuspage 互換の公開 API を定期的に確認し、登録済みサービスの障害・復旧・メンテナンス予定を Discord の固定チャンネルへ通知する。

例:

- VRChat: `https://status.vrchat.com`
- Discord: `https://discordstatus.com`

この機能では、サービスごとの Statuspage URL、メンション設定、表示用メッセージ ID などを DB に保存し、Bot の再起動後も継続して監視できるようにする。通知先チャンネルは個人用 Bot として固定環境変数で管理する。

## スコープ

### 対象

- Statuspage 互換 API の `summary.json` を利用したステータス取得
- Discord スラッシュコマンドによる監視対象の追加・削除・一覧表示・設定確認
- 登録済みサービスの定期チェック
- 現在ステータス表示メッセージの作成・更新
- インシデント通知メッセージの作成・更新
- メンテナンス予定通知メッセージの作成・更新
- 通知済みイベントの重複送信防止

### 対象外

- Statuspage 以外の独自ステータス API 対応
- 管理画面など Discord コマンド以外の UI
- 外部通知サービス連携
- PostgreSQL 以外の永続化

## 前提

- Bot は TypeScript + discord.js で実装する。
- DB は PostgreSQL + Drizzle ORM を利用する。
- DB 接続情報は `DATABASE_URL` 環境変数を利用する。
- Bot は `GatewayIntentBits.Guilds` を利用してスラッシュコマンドを処理する。
- 現在ステータス表示先は `STATUS_CHANNEL_ID` 環境変数を利用する。
- 障害通知・メンテナンス通知先は `INCIDENT_CHANNEL_ID` 環境変数を利用する。
- Statuspage の基本 API は以下を使う。
  - `GET {baseUrl}/api/v2/summary.json`
- API 取得時は可能な限り `ETag` / `If-None-Match` を利用し、変更がない場合は 304 応答を処理する。

## 用語

| 用語 | 意味 |
|---|---|
| 監視対象 | DB に登録された Statuspage のサービス設定 |
| base URL | `https://status.vrchat.com` のような Statuspage のルート URL |
| status message | 現在の全体ステータスを表示する Discord メッセージ |
| incident message | 個別インシデントを通知・更新する Discord メッセージ |
| maintenance message | 個別メンテナンス予定を通知・更新する Discord メッセージ |

## 環境変数

| 変数名 | 必須 | 説明 |
|---|---:|---|
| `DATABASE_URL` | 必須 | PostgreSQL 接続 URL |
| `STATUS_CHANNEL_ID` | 必須 | 現在ステータス表示メッセージの送信・更新先チャンネル ID |
| `INCIDENT_CHANNEL_ID` | 必須 | 障害通知・メンテナンス通知の送信・更新先チャンネル ID |

例:

```text
DATABASE_URL=postgres://user:password@localhost:5432/discord_assistant
STATUS_CHANNEL_ID=123456789012345678
INCIDENT_CHANNEL_ID=234567890123456789
```

## コマンド仕様

コマンド名は `statuspage` とする。

### `/statuspage add`

Statuspage の監視対象を追加する。

引数:

| 引数 | 型 | 必須 | 説明 |
|---|---|---:|---|
| `name` | string | 必須 | 表示名。例: `VRChat` |
| `url` | string | 必須 | Statuspage の base URL。例: `https://status.vrchat.com` |
| `mention_role` | role | 任意 | 新規障害・重要更新時にメンションするロール |
| `check_interval_minutes` | integer | 任意 | チェック間隔。未指定時はデフォルト値を使う |

制約:

- `url` は `http:` または `https:` のみ許可する。
- 保存前に末尾の `/` を取り除く。
- 同一 Guild 内で同じ `url` は重複登録しない。
- 通知先チャンネルはコマンド引数では受け取らず、`STATUS_CHANNEL_ID` / `INCIDENT_CHANNEL_ID` を利用する。
- 追加時に固定チャンネルへ Bot が送信・編集できることを確認する。
- `check_interval_minutes` は下限を 5 分にする。未指定時は 10 分をデフォルトにする。

成功時の返信例:

```text
VRChat を監視対象に追加しました。
URL: https://status.vrchat.com
チェック間隔: 10分
```

### `/statuspage remove`

監視対象を削除する。

引数:

| 引数 | 型 | 必須 | 説明 |
|---|---|---:|---|
| `target` | string | 必須 | 登録 ID、表示名、または URL |

挙動:

- DB 上の監視対象を無効化または削除する。
- 既存の Discord メッセージは原則削除しない。
- 削除後、その監視対象の定期チェックを停止する。

成功時の返信例:

```text
VRChat の監視を削除しました。
既存の通知メッセージは削除していません。
```

### `/statuspage list`

Guild に登録されている監視対象を一覧表示する。

表示項目:

- 表示名
- URL
- 現在ステータス
- チェック間隔
- 最終チェック日時

表示例:

```text
登録済み Statuspage
1. VRChat - https://status.vrchat.com - 全てのシステムが稼働中 - 最終確認: 5分前
2. Discord - https://discordstatus.com - 部分的なシステム障害が発生中 - 最終確認: 1分前
```

### `/statuspage show`

監視対象の詳細設定を表示する。

引数:

| 引数 | 型 | 必須 | 説明 |
|---|---|---:|---|
| `target` | string | 必須 | 登録 ID、表示名、または URL |

表示項目:

- DB ID
- 表示名
- URL
- メンションロール
- チェック間隔
- 最終チェック日時
- 最終成功日時
- 最終エラー
- 保存済み status message ID

### `/statuspage refresh`

指定した監視対象を即時チェックする。

引数:

| 引数 | 型 | 必須 | 説明 |
|---|---|---:|---|
| `target` | string | 必須 | 登録 ID、表示名、または URL |

制約:

- 連続実行を避けるため、同一監視対象への手動 refresh は 1 分程度のクールダウンを設ける。
- 通常の定期チェックと同じ差分判定を利用する。

### `/statuspage update`

登録済み監視対象の設定を変更する。

引数:

| 引数 | 型 | 必須 | 説明 |
|---|---|---:|---|
| `target` | string | 必須 | 登録 ID、表示名、または URL |
| `name` | string | 任意 | 表示名 |
| `mention_role` | role | 任意 | メンションロール |
| `check_interval_minutes` | integer | 任意 | チェック間隔 |
| `enabled` | boolean | 任意 | 監視の有効・無効 |

## 権限仕様

- `statuspage` コマンド全体を Discord のスラッシュコマンド権限設定で制御する。
- 初期実装では `default_member_permissions` に `ManageChannels` を設定する。
- `add` / `remove` / `update` / `refresh` / `list` / `show` はすべて `ManageChannels` 権限を持つユーザーのみ実行可能にする。
- 将来的に閲覧権限を緩める場合も、Discord 側のスラッシュコマンド権限設定で調整する。

## DB 設計案

### `status_pages`

監視対象の基本設定を保存する。

| カラム | 型 | 説明 |
|---|---|---|
| `id` | uuid | 主キー |
| `guild_id` | text | Discord Guild ID |
| `name` | text | 表示名 |
| `base_url` | text | Statuspage base URL |
| `mention_role_id` | text nullable | メンション対象ロール ID |
| `check_interval_seconds` | integer | チェック間隔 |
| `enabled` | boolean | 監視有効フラグ |
| `last_etag` | text nullable | 直近の ETag |
| `last_status_indicator` | text nullable | 直近の全体ステータス |
| `last_checked_at` | timestamp nullable | 最終チェック日時 |
| `last_success_at` | timestamp nullable | 最終成功日時 |
| `last_error` | text nullable | 最終エラー |
| `status_message_id` | text nullable | 現在ステータス表示メッセージ ID |
| `created_at` | timestamp | 作成日時 |
| `updated_at` | timestamp | 更新日時 |

ユニーク制約:

- `(guild_id, base_url)`

### `status_page_events`

通知済みのインシデント・メンテナンスを保存する。

| カラム | 型 | 説明 |
|---|---|---|
| `id` | uuid | 主キー |
| `status_page_id` | uuid | `status_pages.id` |
| `external_id` | text | Statuspage 側の incident / maintenance ID |
| `event_type` | text | `incident` または `maintenance` |
| `name` | text | イベント名 |
| `status` | text | Statuspage 側のステータス |
| `impact` | text nullable | `none` / `minor` / `major` / `critical` |
| `shortlink` | text nullable | Statuspage の詳細 URL |
| `message_id` | text nullable | Discord に送信したメッセージ ID |
| `last_update_id` | text nullable | 最後に通知済みの update ID |
| `last_updated_at` | timestamp nullable | Statuspage 側の最終更新日時 |
| `resolved_at` | timestamp nullable | 解決日時 |
| `created_at` | timestamp | 作成日時 |
| `updated_at` | timestamp | 更新日時 |

ユニーク制約:

- `(status_page_id, event_type, external_id)`

## Statuspage API 取得仕様

取得 URL:

```text
{baseUrl}/api/v2/summary.json
```

例:

```text
https://status.vrchat.com/api/v2/summary.json
https://discordstatus.com/api/v2/summary.json
```

取得時の方針:

- `last_etag` がある場合は `If-None-Match` ヘッダーを付与する。
- `304 Not Modified` の場合は Discord 更新を行わず、`last_checked_at` のみ更新する。
- `200 OK` の場合は JSON を検証し、差分があれば Discord を更新する。
- `429` / `5xx` / ネットワークエラーの場合はログと DB の `last_error` に保存し、次回チェックで再試行する。
- レスポンス JSON は Zod で検証する。

## チェック間隔と負荷対策

初期値:

- デフォルトチェック間隔: 10 分
- 最小チェック間隔: 5 分
- 手動 refresh クールダウン: 1 分

負荷対策:

- 登録ごとに `check_interval_seconds` を持つ。
- 全登録を同時に叩かず、起動時に数秒単位で分散してチェックする。
- `ETag` を保存して `If-None-Match` を使う。
- エラーが連続した場合は一時的にバックオフする。

バックオフ例:

```text
通常: 10分
1回失敗: 次回も10分
2回連続失敗: 20分
3回以上連続失敗: 30分
成功したら通常間隔に戻す
```

## Discord 表示仕様

### 現在ステータス表示

監視対象ごとに 1 つの `status message` を `STATUS_CHANNEL_ID` のチャンネルに作成し、以後は同じメッセージを編集する。

Embed 内容:

- タイトル: `{サービス名} Status`
- URL: Statuspage base URL
- 説明:
  - 現在の全体ステータス
  - 発生中インシデント数
  - 予定メンテナンス数
- フィールド:
  - 主要コンポーネントの状態
  - 最終更新日時
- 色:
  - `none`: Green
  - `minor`: Yellow
  - `major`: Orange
  - `critical`: Red

コンポーネント表示:

- `degraded_performance` / `partial_outage` / `major_outage` / `under_maintenance` を優先して表示する。
- 同じ優先度の中では `updated_at` の新しい順に表示する。
- 最大 10 件まで表示する。

表示例:

```text
VRChat Status
現在のステータス: 全てのシステムが稼働中
発生中のインシデント: 0件
予定メンテナンス: 1件
最終確認: 2026-06-11 12:00
```

### インシデント通知

新規インシデント:

- `INCIDENT_CHANNEL_ID` のチャンネルに新規メッセージを送信する。
- `mention_role_id` が設定されている場合はメンションする。
- DB に `message_id` と `last_update_id` を保存する。

更新:

- 既存 `incident message` を編集する。
- 新しい incident update が増えている場合のみ、必要に応じて返信で更新通知する。

解決:

- 既存メッセージのタイトルに `[解決済み]` を付ける。
- 必要に応じて「インシデントは解決されました」と返信する。
- `resolved_at` を保存する。

Embed 内容:

- タイトル: `{インシデント名}`
- URL: `shortlink`
- 説明:
  - ステータス
  - 影響度
  - 最終更新
- フィールド:
  - 各 incident update の日時・状態・本文

### メンテナンス予定通知

対象:

- `scheduled_maintenances` に含まれる予定メンテナンス

新規予定:

- `INCIDENT_CHANNEL_ID` のチャンネルに通知する。

更新:

- 既存 `maintenance message` を編集する。
- 開始時・完了時・スケジュール変更時は必要に応じて返信通知する。

Embed 内容:

- タイトル: `{メンテナンス名}`
- URL: `shortlink`
- 説明:
  - ステータス
  - 開始予定
  - 終了予定
  - 最終更新

## 状態変換の日本語表示

### 全体ステータス

| Statuspage 値 | 表示 |
|---|---|
| `none` | 全てのシステムが稼働中 |
| `minor` | 部分的なシステム障害が発生中 |
| `major` | 大規模なシステム障害が発生中 |
| `critical` | システム全体の停止が発生中 |

### インシデント状態

| Statuspage 値 | 表示 |
|---|---|
| `investigating` | 調査中 |
| `identified` | 特定済み |
| `monitoring` | 監視中 |
| `resolved` | 解決済み |
| `postmortem` | 事後分析 |

### メンテナンス状態

| Statuspage 値 | 表示 |
|---|---|
| `scheduled` | 予定 |
| `in_progress` | 実施中 |
| `verifying` | 確認中 |
| `completed` | 完了 |

## 差分判定

通知の重複を防ぐため、以下を DB に保存して比較する。

- インシデント ID
- メンテナンス ID
- Statuspage 側の `updated_at`
- 最後に通知した update ID
- Discord message ID

判定例:

- DB に存在しないインシデント ID が API に存在する: 新規通知
- DB に存在するが `updated_at` が新しい: 既存メッセージ編集
- `incident_updates[0].id` が保存済み `last_update_id` と違う: 更新返信の候補
- `status` が `resolved` になった: 解決通知
- API から消えた予定メンテナンス: 原則何もしない。DB には履歴として残す。

## エラー処理

### URL または API が不正

`/statuspage add` 実行時に `summary.json` を 1 回取得して検証する。

失敗例:

```text
指定された URL から Statuspage API を取得できませんでした。
確認した URL: https://example.com/api/v2/summary.json
```

### Discord メッセージ編集失敗

原因例:

- チャンネルが削除された
- Bot の権限がなくなった
- メッセージが削除された

対応:

- `status_message_id` が取得できない場合は新規作成して DB を更新する。
- incident / maintenance message が取得できない場合は新規作成して DB を更新する。
- 権限不足の場合は `last_error` に保存し、管理者が `/statuspage show` で確認できるようにする。

## 実装方針

### モジュール案

```text
src/commands/statuspage.ts
src/statuspage/client.ts
src/statuspage/schemas.ts
src/statuspage/formatter.ts
src/statuspage/checker.ts
src/statuspage/repository.ts
src/db/schema.ts
src/db/client.ts
```

役割:

- `commands/statuspage.ts`: スラッシュコマンド定義と入力検証
- `statuspage/client.ts`: Statuspage API 取得
- `statuspage/schemas.ts`: Zod スキーマ
- `statuspage/formatter.ts`: Discord Embed と日本語文言生成
- `statuspage/checker.ts`: 定期チェックと差分処理
- `statuspage/repository.ts`: DB 読み書き
- `db/schema.ts`: Drizzle のテーブル定義
- `db/client.ts`: PostgreSQL 接続

### 起動時の流れ

1. Bot が Discord にログインする。
2. `ready` イベントで DB から有効な監視対象を読み込む。
3. 監視対象ごとに次回チェック時刻を計算する。
4. 定期的に due になった監視対象だけをチェックする。
5. コマンドで追加・削除・更新された場合は実行中の checker に反映する。

## 実装順序案

1. Statuspage API 用 Zod スキーマと fetch クライアントを追加する。
2. Drizzle の DB 接続と `status_pages` / `status_page_events` の schema を追加する。
3. `/statuspage add/list/show/remove` を実装する。
4. 1 件の監視対象を手動 refresh できる処理を実装する。
5. `ready` イベントから定期チェックを起動する。
6. status message の作成・更新を実装する。
7. incident message の作成・更新・解決通知を実装する。
8. maintenance message の作成・更新・完了通知を実装する。
9. エラー処理、バックオフ、重複通知防止を固める。

## 決定事項

2026-06-11 時点の決定事項:

1. DB 接続情報の環境変数名
   - `DATABASE_URL`
2. 管理コマンドの権限
   - `ManageChannels`
3. `list` / `show` を管理者限定にするか
   - `ManageChannels` 権限限定
4. メンションのタイミング
   - 新規障害、障害更新、解決、メンテナンス開始のみ
5. 既存メッセージ削除の扱い
   - `/statuspage remove` では削除しない
6. コンポーネント一覧をどこまで表示するか
   - degraded / outage / maintenance のコンポーネントを優先しつつ、同じ優先度内では最新更新順で表示する。全件表示は最大 10 件まで
7. メンテナンス予定を何日前から通知するか
   - API に出てきた時点で通知する
8. Statuspage URL の追加時に API 検証を必須にするか
   - 必須
9. 通知先チャンネルの扱い
   - 個人用 Bot のため、`STATUS_CHANNEL_ID` / `INCIDENT_CHANNEL_ID` の固定環境変数を使う。DB とコマンド引数には通知先チャンネル ID を持たせない

## 参考: 既存コードから引き継ぐ方針

添付された旧実装から、以下の方針を引き継ぐ。

- `summary.json` を Zod で検証する。
- `ETag` / `If-None-Match` を使う。
- 現在ステータスの Discord メッセージは新規作成後、以後は編集する。
- インシデントごとの Discord メッセージ ID を保存し、更新時は既存メッセージを編集する。
- インシデントの状態表示を日本語化する。
- 通知先は `STATUS_CHANNEL_ID` / `INCIDENT_CHANNEL_ID` の固定環境変数を利用する。

旧実装から変更する点:

- JSON ファイル保存ではなく DB 保存にする。
- 1 サービス固定ではなく、Guild ごとに複数サービスを登録できるようにする。
- 障害だけでなく、メンテナンス予定も管理する。
- ポーリング間隔とメンションロールをコマンドで設定できるようにする。
