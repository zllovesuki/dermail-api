## Changelog

04/29/2016 - 1.6.0 -> 1.7.0
1. Attachments on S3 will also be removed if the attachment is unique.
2. You will a secondary index: `r.db('dermail').table("attachments").indexCreate("checksum")`
3. Worker queue has been renamed to `dermail-api-worker`
