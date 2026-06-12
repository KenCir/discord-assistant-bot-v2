# AGENTS.md

## Project Overview

- TypeScript + discord.jsのDiscordBot
- データベース: PostgreSQL + DrizzleORM（将来的に追加予定）
  
個人用のDiscord関係のアシスタントBotです。

## Commands

- Install dependencies: `pnpm install`
- Lint: `pnpm lint`
- Format: `pnpm format`
- Build: `pnpm build`

## Directory Structure

| ディレクトリ | 役割 |
|-------------|------|
| `src/commands/` | Botのコマンド |
| `src/events/` | discord.jsのイベントハンドラ |
| `src/util/` | ユーティリティ |

## Mandatory Requirements

- 日本語で説明すること
- 既存コードを尊重すること

## Boundaries

- `.env*` ファイルを変更・コミットしない
- 重要な判断を独断で進めない。必ず確認を求める（例として依存追加・DBスキーマ変更・外部API追加・大規模リファクタなど）
- 新規に.pnpm-storeを作らない、既にリンクしてある.pnpm-storeを使用する

## Git

- git commit は実行しないこと
- git push は実行しないこと
- 変更内容を提示し、人間の確認を待つこと

## Workflow

- 変更前に既存ファイルの内容を確認する
- 長時間タスクはステップ分割し、各完了後にファイル保存
- 説明には必ず具体例を含める

# Project Instructions

作業開始前に以下を読むこと:

- docs/SPEC.md
- docs/TASKS.md

実装前に仕様を確認すること。
