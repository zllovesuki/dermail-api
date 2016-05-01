## Changelog

04/30/2016 - 1.7.0 -> 1.8.0
1. Filters now use folderId instead of folder's displayName
2. Please run usefulScripts/useFolderIdForFilters.js *once* to migrate

04/29/2016 - 1.6.0 -> 1.7.0
1. Attachments on S3 will also be removed if the attachment is unique.
2. You will a secondary index: `r.db('dermail').table("attachments").indexCreate("checksum")`
3. Worker queue has been renamed to `dermail-api-worker`
