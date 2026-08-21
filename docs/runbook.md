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
| `copy_failed` | リネームは成功したがアーカイブコピー失敗 | 次回実行で自動リトライ。3回続く場合は Drive 権限 / フォルダID を確認 |
| `error` | OCR/AI/Drive 例外 | `errorMessage` 列を確認。APIキー期限切れや quota 超過が最多 |

## 再処理したいとき

ログシートから該当行を削除して `runScanRenameJob()` を再実行。`fileId` ベースで再処理される。

## quota / 429 エラー時

`fetchJson_` は 429/5xx で最大2回リトライする。連続する場合は `MAX_FILES_PER_RUN` を下げるか `TRIGGER_MINUTES` を延ばす。

## OCR 一時ファイルが残ったとき

`ocr_XXXX` という一時 Google Doc が Drive に残ることがある（`extractTextFromPdf_` のクリーンアップが失敗）。手動でゴミ箱へ。

## アーカイブ補正コマンド

- `migrateArchiveFolderStructure()`: 旧 `書類種別/発行元` → 新 `発行元/書類種別`
- `normalizeArchiveIssuerNames()`: 発行元フォルダの半角英数正規化
- `correctArchiveIssuerFolders()`: 弱い発行元ラベルを OCR/ログから強い組織名へ補正

いずれも冪等・再開可能。途中失敗しても `last*` プロパティで次回は続きから。

## 通知

- `NOTIFICATION_EMAIL` を設定すると、`error` / `copy_failed` が1件でもあれば実行後に `MailApp.sendEmail` で通知。未設定ならログのみ。
- 初回は要再認証（`script.send_mail` スコープ追加のため）。`clasp push` 後にエディタで `runScanRenameJob` を手動実行して承認。

## セキュリティ

- `executionApi.access` は `MYSELF`（オーナーのみ）。`clasp deployments` でデプロイ一覧を確認し、不要なら `clasp undeploy <id>`。
- `.env` は `dotenvx` で暗号化。平文 `.env` をコミットしない。`.env.example` を参照。

## Drive API v2 について

現在 `Drive` Advanced Service v2 (`Drive.Files.*`, `items/title`) を使用。Google は v2 を非推奨としており、将来 v3 移行が必要（`files/name/parents`）。
- `src/drive-compat.js` に v2/v3 互換レイヤ（`title↔name`, `items↔files`, `patch↔update`, `insert↔create`, `maxResults↔pageSize`）を実装済み。現 manifest は v2 のまま、コードは両対応。
- 完全移行（`appsscript.json` の `version: "v3"` + `title→name` クエリ変更）は別ブランチで `clasp` 手動検証してから実施すること。
