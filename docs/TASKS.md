# Atlassian Statuspage 通知機能 実装タスク

このタスク一覧は [docs/SPEC.md](./SPEC.md) を実装へ落とし込むための作業分解です。

## 前提

- 説明・レビュー・完了報告は日本語で行う。
- `.env*` は変更しない。
- `git commit` / `git push` は実行しない。
- 新規の `.pnpm-store` は作成しない。
- 通知先チャンネルは DB やコマンド引数では扱わず、固定環境変数を使う。
  - `STATUS_CHANNEL_ID`
  - `INCIDENT_CHANNEL_ID`
- DB 接続は `DATABASE_URL` を使う。
- スラッシュコマンド権限は `ManageChannels` にする。

## 実装前に確認すること

- [x] DB マイグレーションの作成・適用方法
  - 採用方針: Drizzle の codebase first 方式で `drizzle-kit generate` / `drizzle-kit migrate` を使う
- [x] Drizzle 設定ファイルを追加してよいか
  - `drizzle.config.ts` を追加する
- [x] `DATABASE_URL` / `STATUS_CHANNEL_ID` / `INCIDENT_CHANNEL_ID` が実行環境に設定されているか
  - 実行時に設定する
- [x] 通知メンション用ロールをコマンド引数で受け取る仕様で問題ないか
  - 問題なし
- [x] 初回実装でテストコードまで追加するか、まず `pnpm build` / `pnpm lint` の確認に留めるか
  - テストコードは追加しない
  - `pnpm build` / `pnpm lint` で確認する

## Drizzle マイグレーション運用方針

このプロジェクトでは codebase first 方式を採用する。

1. `src/db/schema.ts` に Drizzle の TypeScript schema を書く。
2. `drizzle.config.ts` で schema の場所、DB 種別、マイグレーション出力先、DB 接続情報を定義する。
3. `pnpm drizzle-kit generate --name=init-statuspage` で SQL マイグレーションを生成する。
4. 生成された SQL を確認する。
5. `pnpm drizzle-kit migrate` で `DATABASE_URL` の DB に未適用マイグレーションを適用する。

想定ファイル:

```text
src/db/schema.ts
drizzle.config.ts
drizzle/
```

想定コマンド:

```text
pnpm drizzle-kit generate --name=init-statuspage
pnpm drizzle-kit migrate
```

注意:

- `drizzle-kit generate` は TypeScript schema と過去の migration snapshot の差分から SQL を生成する。
- `drizzle-kit migrate` は未適用の SQL migration だけを DB に適用する。
- 適用済み migration は DB 内の Drizzle 用 migration log table に記録される。
- `.env*` は編集せず、実行時の環境変数から `DATABASE_URL` を読む。
- `drizzle-kit push` は SQL ファイルを残さず DB に直接反映するため、初回実装では使わない。

## Phase 1: DB 基盤

- [x] `src/db/schema.ts` を追加する
  - `status_pages`
  - `status_page_events`
- [x] `src/db/client.ts` を追加する
  - `DATABASE_URL` を読み込む
  - 未設定時は分かりやすいエラーを出す
- [x] Drizzle の設定を追加する
  - `drizzle.config.ts`
  - マイグレーション出力先は `drizzle/`
  - `.env*` は編集しない
- [x] `status_pages` の repository を追加する
  - 追加
  - 更新
  - 削除または無効化
  - Guild 単位の一覧取得
  - 監視対象検索
- [x] `status_page_events` の repository を追加する
  - upsert
  - event ID 検索
  - message ID 更新
  - resolved 更新

完了条件:

- [x] DB schema が `docs/SPEC.md` の設計と一致している
- [x] 通知先チャンネル ID を DB に保存していない
- [x] `pnpm build` が通る

## Phase 2: Statuspage API クライアント

- [x] `src/statuspage/schemas.ts` を追加する
  - `summary.json` の Zod schema
  - incident
  - incident update
  - component
  - scheduled maintenance
- [x] `src/statuspage/client.ts` を追加する
  - `{baseUrl}/api/v2/summary.json` を取得する
  - `If-None-Match` に対応する
  - `304 Not Modified` を表現できる戻り値にする
  - `200 OK` の JSON を Zod で検証する
  - `429` / `5xx` / ネットワークエラーを呼び出し側で扱える形にする
- [x] URL 正規化処理を追加する
  - `http:` / `https:` のみ許可
  - 末尾 `/` を取り除く
- [x] `/statuspage add` 用の API 検証処理を追加する
  - 追加前に `summary.json` を 1 回取得して検証する

完了条件:

- [x] `https://status.vrchat.com` が `https://status.vrchat.com/api/v2/summary.json` として扱われる
- [x] `https://discordstatus.com/` が `https://discordstatus.com` に正規化される
- [x] invalid URL の失敗理由をコマンド返信に使える
- [x] `pnpm build` が通る

## Phase 3: 表示フォーマット

- [x] `src/statuspage/formatter.ts` を追加する
  - 全体ステータスの日本語化
  - インシデント状態の日本語化
  - メンテナンス状態の日本語化
  - Discord Embed 生成
- [x] status message 用 Embed を作る
  - タイトル: `{サービス名} Status`
  - URL: Statuspage base URL
  - 現在ステータス
  - 発生中インシデント数
  - 予定メンテナンス数
  - 主要コンポーネント
  - 最終確認日時
- [x] コンポーネント表示順を実装する
  - `degraded_performance`
  - `partial_outage`
  - `major_outage`
  - `under_maintenance`
  - 同じ優先度では `updated_at` の新しい順
  - 最大 10 件
- [x] incident message 用 Embed を作る
- [x] maintenance message 用 Embed を作る
- [x] Discord Embed の field 数・文字数制限に収まるように切り詰める

完了条件:

- [x] 旧実装の日本語表示方針を引き継いでいる
- [x] 文字数超過で Discord API エラーになりにくい
- [x] `pnpm build` が通る

## Phase 4: スラッシュコマンド 完了

- [x] `src/commands/statuspage.ts` を追加する
  - `default_member_permissions` に `ManageChannels` を設定する
  - サブコマンドを定義する
- [x] `/statuspage add` を実装する
  - `name`
  - `url`
  - `mention_role`
  - `check_interval_minutes`
  - API 検証必須
  - 固定チャンネルの権限確認
  - 同一 Guild + URL の重複防止
- [x] `/statuspage list` を実装する
- [x] `/statuspage show` を実装する
- [x] `/statuspage remove` を実装する
  - 既存 Discord メッセージは削除しない
  - DB 上は削除または無効化
- [x] `/statuspage update` を実装する
  - `name`
  - `mention_role`
  - `check_interval_minutes`
  - `enabled`
- [x] `/statuspage refresh` を実装する
  - 1 分程度のクールダウン
  - 通常チェックと同じ差分判定を使う
- [x] コマンド返信を通常メッセージにする
  - ログを残す目的で、原則 ephemeral は使わない

完了条件:

- [x] チャンネル ID を引数に取らない
- [x] `ManageChannels` 権限がコマンド定義に反映されている
- [x] 各コマンドの成功・失敗メッセージが具体的
- [x] `pnpm build` が通る

## Phase 5: Discord チャンネル解決 完了

- [x] 固定チャンネル取得ユーティリティを追加する
  - `STATUS_CHANNEL_ID`
  - `INCIDENT_CHANNEL_ID`
- [x] チャンネル種別を確認する
  - テキスト系チャンネル
  - `isSendable()`
- [x] 必要な権限を確認する
  - 送信
  - メッセージ編集
  - Embed 送信
  - メンション利用
- [x] チャンネル取得失敗時のエラー文言を整える

完了条件:

- [x] `/statuspage add` 時に固定チャンネルの問題を検出できる
- [x] 定期チェック中のチャンネル問題は `last_error` に保存できる
- [x] `pnpm build` が通る

## Phase 6: チェック処理 完了

- [x] `src/statuspage/checker.ts` を追加する
  - 1 監視対象のチェック処理
  - status message 作成・更新
  - incident message 作成・更新
  - maintenance message 作成・更新
  - DB 差分判定
- [x] `ETag` を DB に保存する
- [x] `304 Not Modified` の場合は status message の最終確認時刻だけ更新する
- [x] `last_checked_at` / `last_success_at` / `last_error` を更新する
- [x] 新規インシデント通知を実装する
- [x] インシデント更新通知を実装する
- [x] インシデント解決通知を実装する
- [x] 新規メンテナンス予定通知を実装する
- [x] メンテナンス開始・完了・スケジュール変更通知を実装する
- [x] 既存メッセージが削除されていた場合は新規作成して DB を更新する

完了条件:

- [x] 同じ incident / maintenance を重複通知しない
- [x] status message は同じメッセージを編集し続ける
- [x] resolved / completed の状態が DB に残る
- [x] `pnpm build` が通る

## Phase 7: 定期実行 完了

- [x] `ready` イベントから有効な監視対象を読み込む
- [x] 全登録を同時に叩かないように分散する
- [x] 監視対象ごとの `check_interval_seconds` を尊重する
- [x] エラー連続時のバックオフを実装する
  - 1 回失敗: 通常間隔
  - 2 回連続失敗: 20 分
  - 3 回以上連続失敗: 30 分
  - 成功時に通常間隔へ戻す
- [x] コマンドで追加・更新・削除された監視対象を実行中 checker に反映する
- [x] Bot 停止時に timer を止められる構造にする

完了条件:

- [x] 起動後、自動で登録済み Statuspage を監視する
- [x] 手動 refresh と定期チェックで同じ中核処理を使う
- [x] API へ過剰なリクエストを送らない
- [x] `pnpm build` が通る

## Phase 8: ログ・エラー処理 完了

- [x] ロガー方針を決める
  - `src/util/logger.ts` の pino logger を使う
- [x] API エラーをログに出す
- [x] DB エラーをログに出す
- [x] Discord API エラーをログに出す
- [x] ユーザー向けのコマンドエラー返信を整える
- [x] `last_error` に保存する内容を短く実用的にする

完了条件:

- [x] `/statuspage show` で直近エラーが確認できる
- [x] コマンド失敗時に原因と次の確認先が分かる
- [x] `pnpm build` が通る

## Phase 9: 検証

- [x] `pnpm build`
- [x] `pnpm lint`
- [x] テストコードは追加しない
- [x] コマンド登録処理の確認
  - 例: `pnpm build` 後に既存の deploy script を使う
- [x] ローカルまたは検証 Discord サーバーで `/statuspage add` を確認する
  - 例: `https://status.vrchat.com`
  - 例: `https://discordstatus.com`
- [x] `/statuspage list` を確認する
- [x] `/statuspage show` を確認する
- [x] `/statuspage refresh` を確認する
- [x] `STATUS_CHANNEL_ID` に status message が作成・更新されることを確認する
- [x] `INCIDENT_CHANNEL_ID` に incident / maintenance message が作成・更新されることを確認する
- [x] `.pnpm-store` が作成されていないことを確認する
  - 例: `ls -d .pnpm-store 2>/dev/null || echo "no local .pnpm-store"`

完了条件:

- [x] build / lint が通る
- [x] 主要コマンドが Discord 上で動作する
- [x] 固定チャンネル環境変数の運用で通知できる

## 後回し候補

初回実装で無理に入れず、必要になったら追加する。

- [x] VRC 動画再生用セッションURL作成コマンド
- [ ] より細かい通知タイミング設定
  - 例: メンテナンス予定は開始 24 時間前にも再通知する
- [ ] サービスごとのメンション抑制
- [x] `list` / `show` のページング
- [x] README / 運用手順の整備
- [ ] Statuspage 以外の API 対応
- [ ] 管理 UI
- [ ] テスト用 Statuspage fixture の整備

## 実装の区切り案

最初の実装単位:

1. Phase 1
2. Phase 2
3. Phase 3 の日本語表示・status Embed まで
4. Phase 4 の `add` / `list` / `show` / `remove`

次の実装単位:

1. Phase 4 の `update` / `refresh`
2. Phase 5
3. Phase 6 の status message 更新

最後の実装単位:

1. Phase 6 の incident / maintenance 通知
2. Phase 7
3. Phase 8
4. Phase 9
