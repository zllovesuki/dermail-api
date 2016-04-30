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

As of 1.7.0, the endpoint version is arbitrary and is left for future backward compatibility.

## Definition

Say you have an email address "user@domain.com"

"Account" refers to "user",
"Domain" refers to "domain.com", and
"Complete Account" refers to "user@domain.com"

Sometimes "Complete Account" and "Account" are *synonymous*.

## Authentication

**These calls require JWT header:**
- GET /__VERSION__/read/ping (Health Check, also used to check if JWT token is valid)
- GET /__VERSION__/read/s3 (Returns S3 endpoint and bucket)
- GET /__VERSION__/read/getAccounts (Returns a list of Complete Accounts)
- POST /__VERSION__/read/getAccount (Returns a Complete Account)
- POST /__VERSION__/read/getFoldersInAccount (Returns a list of folders in an Account)
- POST /__VERSION__/read/getFolder (Returns a Folder)
- POST /__VERSION__/read/getMailsInFolder (Returns a list of emails in a Folder)
- POST /__VERSION__/read/getMail (Returns a Message)
- POST /__VERSION__/read/getAddress (Returns friendlyName of an email address)
- POST /__VERSION__/read/getFilters (Returns a list of Filters of an Account)
- POST /__VERSION__/read/searchWithFilter (Returns a list of Messages which match the criteria)
- POST /__VERSION__/read/searchMailsInAccount (Returns a list of Messages which the content and subject fuzzy-match the query string)
- POST /__VERSION__/write/modifyFilter (Add or delete a Filter)
- POST /__VERSION__/write/updateMail (Star, Read, Folder)
- POST /__VERSION__/write/updateFolder (Add, Edit, Remove, Truncate)
- POST /__VERSION__/write/pushSubscriptions (Web-push notifications)
- POST /__VERSION__/relay/sendMail (Queue email to be sent)

**These calls require remoteSecret:**
- POST /__VERSION__/rx/get-s3 (Returns complete S3 credentials)
- POST /__VERSION__/rx/check-recipient (Check if recipient is in Account list)
- POST /__VERSION__/rx/store (Receives and store email from Dermail-MTA)

**These calls do not require authentication:**
- GET /__VERSION__/read/getPayload (Endpoint for service worker to fetch payload when encrypted payload is not supported)
- GET /__VERSION__/safe/inline/* (Redirects to inline attachments)
- GET /__VERSION__/safe/image/* (Sanitize image requests)
- GET /__VERSION__/safe/href/* (Sanitize link redirects)
- POST /__VERSION__/login (Returns JWT if authenticated)

## Endpoints

`GET /__VERSION__/read/ping`
- pre: none
- post: "pong" is returned in the body

`GET /__VERSION__/read/s3`
- pre: none
- post:
```JSON
{
  "endpoint": "ENDPOINT",
  "bucket": "BUCKET"
}
```
