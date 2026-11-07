# Drawing extensions and automatic compression

`.dsn` contains XML and `.dzn` contains a ZIP drawing. They describe the same single drawing and its sheets. Ordinary drawings save as `.dsn`. Automatic saving chooses `.dzn` when retained numerical buffers and solver logs total **at least 1 MiB**, measured before compression/base64 encoding. Removed results and sheets whose results are excluded from saving do not count. Storage settings also allow explicit XML or ZIP selection. A deliberately compressed compact copy uses `.dzn` even though it has no results.

Loading always inspects content. XML named `.dzn` and ZIP named `.dsn` remain readable; an invalid ZIP never falls back to XML. The extension determines the suggested output name, not the decoder. The ZIP manifest and internal MIME identifier are unchanged.

Electron registers both extensions and accepts them through startup arguments, macOS Open File events and Open dialogs. Filesystem Open offers both extensions. Save dialogs suggest the extension matching the encoded data. On local format changes, Save opens a new destination dialog and retains the original file; successful saving updates the open document's association. Drive preserves the existing file ID while uploading the new content, filename and MIME metadata together through a resumable upload.

## Google Drive deployment setting

The repository's Drive integration already accepts files opened by ID and decodes their bytes. Drive's own **Open with** association is configured separately in Google Cloud Console and cannot be deployed by a frontend build. Keep the existing OAuth client and Open/New URLs. In **Google Drive API → Drive UI integration**, add `dzn` to **Default file extensions** alongside `dsn` and `tclib`. The reference MIME/extension lists are in [config/google-drive-ui.json](../config/google-drive-ui.json); retain any other existing supported registrations. Google documents these Console settings in [Configure a Drive UI integration](https://developers.google.com/workspace/drive/api/guides/enable-sdk).

ZIP uploads use `application/x-tinycad-dsn+zip`; XML uploads use `application/xml`. Existing generic MIME associations can remain secondary associations. Updated uploads use Google's documented [resumable upload protocol](https://developers.google.com/workspace/drive/api/guides/manage-uploads), including metadata at initiation, so a transition to `.dzn` does not create a new Drive document or break its shared URL.
