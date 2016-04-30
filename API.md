## dermail-api

Dermail-API the "central hub" of the Dermail system. It:
1. Receives emails from Dermail-MTA
2. Handles mail distribution
3. Handles filtering
4. Serves HTTP API

*Though the HTTP API is not RESTful*

## Authentication

Dermail-API uses two method of authentication:
1. JWT (for user-facing HTTP requests)
2. Symmetric key "remoteSecret" (for internal services)

JWT will be returned by the API after initial login (/__VERSION__/login).
Symmetric key (remoteSecret) needs to be configured beforehand.

## Endpoint version

As of 1.7.0, the endpoint version is arbitrary and is left for future compatibility issues.

## Definition

Say you have an email address "user@domain.com"

"Account" refers to "user",
"Domain" refers to "domain.com", and
"Complete Account" refers to "user@domain.com"

Sometimes "Complete Account" and "Account" are *synonymous*.

## Authentication

**These calls require JWT header:**
- /__VERSION__/read/ping (Health Check, also used to check if JWT token is valid)
- /__VERSION__/read/s3 (Returns S3 endpoint and bucket)
- /__VERSION__/read/getAccounts (Returns a list of Complete Accounts)
- /__VERSION__/read/getAccount (Returns a Complete Account)
- /__VERSION__/read/getFoldersInAccount (Returns a list of folders in an Account)
- /__VERSION__/read/getFolder (Returns a Folder)
- /__VERSION__/read/getMailsInFolder (Returns a list of emails in a Folder)
- /__VERSION__/read/getMail (Returns a Message)
- /__VERSION__/read/getAddress (Returns friendlyName of an email address)
- /__VERSION__/read/getFilters (Returns a list of Filters of an Account)
- /__VERSION__/read/searchWithFilter (Returns a list of Messages which match the criteria)
- /__VERSION__/read/searchMailsInAccount (Returns a list of Messages which the content and subject fuzzy-match the query string)
- /__VERSION__/write/modifyFilter (Add or delete a Filter)
- /__VERSION__/write/updateMail (Star, Read, Folder)
- /__VERSION__/write/updateFolder (Add, Edit, Remove, Truncate)
- /__VERSION__/write/pushSubscriptions (Web-push notifications)
- /__VERSION__/relay/sendMail (Queue email to be sent)

**These calls require remoteSecret:**
- /__VERSION__/rx/get-s3 (Returns complete S3 credentials)
- /__VERSION__/rx/check-recipient (Check if recipient is in Account list)
- /__VERSION__/rx/store (Receives and store email from Dermail-MTA)

**These calls do not require authentication:**
- /__VERSION__/read/getPayload (Endpoint for service worker to fetch payload when encrypted payload is not supported)
- /__VERSION__/safe/inline/* (Redirects to inline attachments)
- /__VERSION__/safe/image/* (Sanitize image requests)
- /__VERSION__/safe/href/* (Sanitize link redirects)
