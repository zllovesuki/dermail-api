## Changelog

09/30/2016: 3.3.0 -> 3.3.1
1. new API (/updateAccount)
2. Initially it only has *newAccount* operation

09/30/2016: 3.2.0 -> 3.3.0
1. Folder unreadCount is now a separate API call (/getUnreadCountInAccount)
2. Please uses Webmail >= 4.1.0 with this new change.

07/23/2016: 3.1.0 > 3.2.0
1. Supprts active push to Webmail

07/17/2016: 3.1.0
1. Address book: edit friendlyName and/or fold the address friendlyName

06/28/2016: 2.x -> 3.0.0
1. Mails are now processed at API instead of at MTA. Please make sure that S3 is setup correctly, and you are running dermail-mta version 4.0.0+

06/07/2016: 1.x -> 2.0.0
1. Dermail now supports per (main) domain DKIM signing outbound and verifying inbound.
2. By default, Dermail checks for incoming emails for SPF. If SPF is not either "pass", "neutral", or "softfail", the emails will be moved to SPAM folder
3. By default, Dermail checks for incoming emails for DKIM. If *any* DKIM signature fails the verification (not "pass" or "tempfail"), the emails will be moved to SPAM folder

06/01/2016: 1.17.x-> 1.18.0
1. API now handles email manipulations when replying/forwarding. Field `inReplyTo` is now required to reply/forward
2. Please add a secondary index: `r.db('dermail').table("messages").indexCreate("_messageId")`
3. Please run migration script `usefulScripts/add_messageId.js`

06/01/2016: 1.16.x -> 1.17.0
1. API now provides domainName, DKIM selector, and the DKIM private key to TX. Please generate a key pair (You can use http://dkimcore.org/tools/), then setup the public key
2. Then, add `domainName` and `dkimSelector` in your `config.json` file
3. The private key will need to be in `ssl/dkim`
4. `domainName`, `dkimSelector`, and `ssl/dkim` must be present, or **TX will not start**

05/30/2016: 1.16.1 -> 1.16.2
1. Filters now have priorities: filter with more criteria has a higher priority

05/30/2016: 1.16.0 -> 1.16.1
1. Use contentId for efficient search.
2. Please add a secondary index: `r.db('dermail').table("attachments").indexCreate("contentId")`

05/18/2016: 1.15.x -> 1.16.0
1. Modernize TX: use web-worker on TX to compose mails instead of web-worked on API-Worker

05/16/2016: 1.15.0 -> 1.15.1
1. Uses `shortid` for generating new IDs

05/11/2016: 1.14.x -> 1.15.0
1. New process to clean up the Redis queue using Bull's clean() method
2. By default, the process will clean up "completed" jobs every 10 minutes, you can change the interval in `config.json` with key `cleanInterval`

05/06/2016 -> 1.13.x -> 1.14.0
1. new API: /write/updateDomain
2. Initial release supports update alias. More functionalities on the way.

05/06/2016 -> 1.13.1 -> 1.13.2
1. /read/getAccounts now returns domainId

05/06/2016 -> 1.12.x -> 1.13.1
1. Reverting to running Socket.io with API processes.
2. If you are running nginx, proxy '/' to load balancing, but proxy '/socket.io' to sticky session.

05/05/2016 -> 1.11.x -> 1.12.0
1. API breaking: Socket.io no longer runs with API processes; it is now running on a single process
2. This should make nginx load balancing a lot more easier
3. The default port is config.cluster.basePort - 1

05/04/2016 -> 1.11.x -> 1.11.2
1. CRITICAL: Please change your jwt secret to invalidate all jwt tokens.

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
