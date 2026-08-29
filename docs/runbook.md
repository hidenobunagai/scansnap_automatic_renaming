# Runbook — 運用メモ

## 日常運用

- `runScanRenameJob()` はトリガーで定期実行。ログは `scan_rename_log` シートに蓄積。
- `review` モード: 候補名を確認するだけ（`ARCHIVE_ROOT_FOLDER_ID` なくても動作）。
- `rename` モード: 信頼度 `MIN_CONFIDENCE` 以上のものだけリネーム + アーカイブへコピー。

## よくあるステータス

| status | 意味 | 次の一手 |
|---|---|---|
| `renamed` | リネーム + アーカイブ成功 | なし |
| `skipped` | 提案名が既存名と一致 | なし |
| `review_needed` | 信頼度不足 / OCR不良 / reviewモード | シートで提案名を確認し、`confidence` が高ければ手動リネーム or `MIN_CONFIDENCE` を下げる |
| `retry` | 手動で再処理対象に指定された状態 | 次回定期実行またはメニュー「未処理分を即時実行」で再処理 |
| `copy_failed` | リネームは成功したがアーカイブコピー失敗 | 次回実行で自動リトライ。3回続く場合は Drive 権限 / フォルダID を確認 |
| `error` | OCR/AI/Drive 例外 | `errorMessage` 列を確認。APIキー期限切れや quota 超過が最多 |

## 再処理したいとき

- **方法1（推奨）**: ログシートで該当行の `status` 列を `retry` に書き換えるか、行を選択してスプレッドシートのメニュー `ScanSnap操作 > 選択行を再処理(status=retry)` を実行。次回定期実行（または `ScanSnap操作 > 未処理分を即時実行`）で自動再処理されます。
- **方法2**: ログシートから該当行を削除して `runScanRenameJob()` を再実行。

## quota / 429 エラー時

`fetchJson_` は 429/5xx で最大2回リトライする。連続する場合は `MAX_FILES_PER_RUN` を下げるか `TRIGGER_MINUTES` を延ばす。

## OCR 一時ファイルが残ったとき

`ocr_XXXX` という一時 Google Doc が Drive に残ることがあります（`extractTextFromPdf_` のクリーンアップが失敗時など）。`runScanRenameJob()` の実行開始時に 60分以上経過した古い一時ファイルは自動でゴミ箱へ送られます（`cleanupOcrTempDocuments_`）。即座に整理したい場合は手動でゴミ箱へ移動してください。

## アーカイブ補正コマンド

- `migrateArchiveFolderStructure()`: 旧 `書類種別/発行元` → 新 `発行元/書類種別`
- `normalizeArchiveIssuerNames()`: 発行元フォルダの半角英数正規化
- `correctArchiveIssuerFolders()`: 弱い発行元ラベルを OCR/ログから強い組織名へ補正

いずれも冪等・再開可能。途中失敗しても `last*` プロパティで次回は続きから。

## 通知

- `NOTIFICATION_EMAIL` を設定すると、`error` / `copy_failed` が1件でもあれば実行後に `MailApp.sendEmail` で通知。
- `NOTIFICATION_WEBHOOK_URL` を設定すると、失敗時に Slack / Discord 互換の JSON POST で Webhook 通知を送信。未設定なら通知なし。
- 初回メール通知は要再認証（`script.send_mail` スコープ追加のため）。`clasp push` 後にエディタで `runScanRenameJob` を手動実行して承認。

## Gemini PDF 直接解析モード (`PDF_INPUT_MODE=direct_ai`)

- デフォルトの `drive_ocr` は Google Drive の OCR 変換（Google Docs 一時作成）経由でテキスト抽出します。
- `PDF_INPUT_MODE=direct_ai`（かつ `AI_PROVIDER=gemini`）に設定すると、PDF を Base64 で直接 Gemini API に送信して解析します。OCR ドキュメントの一時生成が不要になり、表組みや画像の認識精度が向上し高速に動作します。

## セキュリティ

- `executionApi.access` は `MYSELF`（オーナーのみ）。`clasp deployments` でデプロイ一覧を確認し、不要なら `clasp undeploy <id>`。
- `.env` は `dotenvx` で暗号化。平文 `.env` をコミットしない。`.env.example` を参照。

## Drive API v3 への完全移行

`appsscript.json` で `Drive` Advanced Service を `v3` に移行済みです。
- `src/drive-compat.js` により v3 (`name`, `pageSize`, `files`, `Drive.Files.create/update`) と旧 v2 (`title`, `maxResults`, `items`, `Drive.Files.insert/patch/trash`) の差異を吸収し、クエリ（`title` ↔ `name`）やパラメータも透過的に正規化して動作します。

