## Changelog

05/04/2016 -> 1.10.x -> 1.11.0
1. Deprecating the use of Dermail-Common. common functions are consolidated into a helper

05/04/2016 -> 1.9.x -> 1.10.0
1. The structure of jwt payload has changed, please change your jwt secret to invalidate all jwt tokens.

05/02/2016 -> 1.8.x -> 1.9.0
1. You can attach files when sending emails
2. All attachments will be uploaded to S3
3. Because of how the uploading works, `usefulScripts/deleteAttachmentsOnS3.js` will delete orphaned attachments. You can run that with Cron

04/31/2016 - 1.8.0 -> 1.8.2
1. Introduces rate limiting on /login.
2. If your API is running behind nginx (which you should be), please add an entry in `config.json`:

```JSON
"behindProxy": true
```

04/30/2016 - 1.7.0 -> 1.8.0
1. Filters now use folderId instead of folder's displayName
2. Please run usefulScripts/useFolderIdForFilters.js *once* to migrate

04/29/2016 - 1.6.0 -> 1.7.0
1. Attachments on S3 will also be removed if the attachment is unique.
2. You will a secondary index: `r.db('dermail').table("attachments").indexCreate("checksum")`
3. Worker queue has been renamed to `dermail-api-worker`
