# ScanSnap automatic renaming

Google Drive 上の ScanSnap PDF を定期的に見に行き、OCR と AI で分かりやすいファイル名へ変更する Google Apps Script プロジェクトです。

初期構成は小規模運用向けに `Google Apps Script + Drive + Spreadsheet log + external AI` でまとめています。重い OCR や高頻度処理が必要になったら、OCR / AI 部分だけ Cloud Run に切り出せる前提の作りです。

## What this project does

- 指定フォルダ内の新しい PDF を定期的に確認
- Google Drive OCR でテキスト抽出
- Gemini または OpenAI に命名候補を生成させる
- `YYYY-MM-DD_発行元_書類種別_要点.pdf` 形式へ整形
- `書類種別/発行元` のフォルダ構成で家族共有フォルダへコピー
- 重複ファイル名は `_2`, `_3` を付けて回避
- 結果をスプレッドシートへ記録
- `review` と `rename` の 2 モードに対応

## Files

- `src/`: Apps Script に push する本体
- `scripts/write-clasp-config.mjs`: `dotenvx` 管理の `CLASP_SCRIPT_ID` から `.clasp.json` を生成
- `scripts/bootstrap-remote-setup.mjs`: `clasp` で properties 設定、初期化、trigger 作成まで進める

## Setup

1. Google Apps Script で新しい standalone project を作ります。
2. Apps Script の `Project Settings` から script ID を控えます。
3. ローカルの `.env` を初期化して script ID を保存します。

```bash
bun run env:init
dotenvx set CLASP_SCRIPT_ID your-script-id
dotenvx set CLASP_PROJECT_ID your-gcp-project-id
```

4. `.clasp.json` を生成して push します。

```bash
bun run clasp:push
```

5. `clasp run` まで使う場合は、Apps Script の `Project Settings` でこの script を GCP project に紐付けます。
6. その GCP project 上で `Desktop App` の OAuth client を作り、`client_secret.json` をローカルへ保存します。
7. `clasp login --creds client_secret.json --use-project-scopes` を実行します。
8. Apps Script 側の `Project Settings > Script properties` に必要な値を入れます。
9. `setupScanRenameProject()` を 1 回実行して、ログ用スプレッドシートを自動作成します。
10. 最初は `RENAME_MODE=review` のまま `runScanRenameJob()` を実行し、提案名を確認します。
11. 問題なければ `RENAME_MODE=rename` に変更し、`installScanRenameTrigger()` を実行します。

または、必要な環境変数を `.env` に入れたうえで CLI からまとめて設定できます。

```bash
dotenvx set SCANSNAP_FOLDER_ID your-drive-folder-id
dotenvx set ARCHIVE_ROOT_FOLDER_URL https://drive.google.com/drive/folders/your-family-folder-id
dotenvx set GEMINI_API_KEY your-gemini-api-key
bun run setup:remote
```

このコマンドは `clasp push`、API executable deployment、script properties 設定、ログ初期化、trigger 作成までまとめて実行します。

前提として、`clasp run` を使うための `GCP project` 紐付けと `client_secret.json` による再ログインが必要です。

## Required script properties

| Key | Required | Example | Notes |
| --- | --- | --- | --- |
| `SCANSNAP_FOLDER_ID` | yes | `1AbCdEf...` | 監視対象の Drive folder ID |
| `ARCHIVE_ROOT_FOLDER_ID` | rename時に必要 | `1FamilyFolder...` | 共有アーカイブ先の Drive folder ID |
| `AI_PROVIDER` | no | `gemini` | `gemini` または `openai`。未指定時は `gemini` |
| `GEMINI_API_KEY` | provider=gemini | `AIza...` | Gemini を使う場合 |
| `OPENAI_API_KEY` | provider=openai | `sk-...` | OpenAI を使う場合 |
| `AI_MODEL` | no | `gemini-3.1-flash-lite-preview` | 未指定時は provider ごとの既定値 |
| `RENAME_MODE` | no | `review` | `review` または `rename` |
| `MIN_CONFIDENCE` | no | `0.75` | `rename` 時に自動確定する最低信頼度 |
| `MAX_FILES_PER_RUN` | no | `5` | 1 回の実行で処理する最大件数 |
| `FILE_STABLE_MINUTES` | no | `5` | 更新直後のファイルを避ける待機時間 |
| `OCR_LANGUAGE` | no | `ja` | Drive OCR の言語 |
| `TRIGGER_MINUTES` | no | `15` | `1, 5, 10, 15, 30` のいずれか |
| `TIMEZONE` | no | `Asia/Tokyo` | 日付整形用 |
| `FILENAME_PATTERN_HINT` | no | `YYYY-MM-DD_発行元_書類種別_要点` | AI に渡す命名ヒント |
| `LOG_SPREADSHEET_ID` | no | `1XyZ...` | 未設定なら初回実行時に自動作成 |

## Local commands

```bash
bun run env:init
bun run check
bun run clasp:push
bun run clasp:open
bun run setup:remote
```

## Apps Script functions

- `setupScanRenameProject()`: ログスプレッドシートを準備
- `runScanRenameJob()`: 未処理 PDF を走査して review / rename を実行
- `installScanRenameTrigger()`: 定期実行 trigger を再作成
- `removeScanRenameTriggers()`: 既存 trigger を削除
- `getScriptPropertiesTemplate()`: 設定キーのひな形を返す

## Notes

- OCR テキストがほぼ取れない場合は `review_needed` で止めます。
- `review` では `ARCHIVE_ROOT_FOLDER_ID` 未設定でも候補パスの確認までは実行できます。
- `review` で確認したファイルは、`rename` に切り替えた最初の実行で 1 回だけ再処理されます。
- `rename` ではファイル名がすでに確定していても、未コピーなら共有アーカイブへコピーします。
- 共有先コピーに失敗したファイルは `copy_failed` で記録され、次回実行で再試行されます。
- 再処理したいファイルは、ログシートから該当行を消して再実行してください。
- 大きい PDF や画像中心の PDF が増えたら、OCR / AI 呼び出しだけ Cloud Run へ切り出すのが次の一手です。
